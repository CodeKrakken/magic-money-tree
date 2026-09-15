import fs from "node:fs/promises";
import path from "node:path";

interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface HourlyMarket {
    symbol: string;
    binanceArrayPosition: number;
    candleCount: number;
    firstCandleTime: number | null;
    lastCandleTime: number | null;
    candles: Candle[];
}

interface HourlyData {
    interval: string;
    startTime: number;
    endTimeExclusive: number;
    startTimeIso: string;
    endTimeExclusiveIso: string;
    expectedCandleCount: number;
    markets: HourlyMarket[];
}

interface StrategyMarket {
    symbol: string;
    datasetGroup: string;
    marketIndex: number;
    binanceArrayPosition: number;
    netProfit: number;
    returnPct: number;
}

interface StrategyData {
    sample?: {
        markets?: StrategyMarket[];
    };
    outOfSample?: {
        markets?: StrategyMarket[];
    };
}

interface FeatureSet {
    [feature: string]: number;
}

interface MarketResult {
    symbol: string;
    binanceArrayPosition: number;
    datasetGroup: string;
    netProfit: number;
    returnPct: number;
}

interface CorrelationResult {
    feature: string;
    spearman: number;
    pearson: number;
}

interface GroupComparison {
    feature: string;
    positiveMedian: number;
    flatMedian: number;
    negativeMedian: number;
}

interface OutputData {
    generatedAt: string;

    source: {
        hourlyFile: string;
        strategyFile: string;
        interval: string;
        startTimeIso: string;
        endTimeExclusiveIso: string;
    };

    summary: {
        hourlyMarkets: number;
        marketsWithCandles: number;
        matchedMarkets: number;
        unmatchedHourlyMarkets: number;
        positiveMarkets: number;
        flatMarkets: number;
        negativeMarkets: number;
    };

    correlations: CorrelationResult[];

    groupComparisons: GroupComparison[];

    markets: MarketResult[];
}

const HOURLY_FILE =
    "research/data/binance-august-2026-1h-2026-09-15T16-55-45Z.json";

const STRATEGY_FILE =
    "research/output/market-strategy-ranking-independent-1789232701426.json";

const OUTPUT_DIR =
    "research/output";

const TOP_GROUP_FEATURES = 10;

function mean(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return (
        values.reduce(
            (sum, value) => sum + value,
            0,
        ) / values.length
    );
}

function median(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort(
        (a, b) => a - b,
    );

    const middle =
        Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (
            (sorted[middle - 1] +
                sorted[middle]) /
            2
        );
    }

    return sorted[middle];
}

function standardDeviation(
    values: number[],
): number {
    if (values.length < 2) {
        return 0;
    }

    const average = mean(values);

    const variance =
        values.reduce(
            (sum, value) =>
                sum +
                (value - average) ** 2,
            0,
        ) / values.length;

    return Math.sqrt(variance);
}

function pearson(
    x: number[],
    y: number[],
): number {
    if (
        x.length !== y.length ||
        x.length < 2
    ) {
        return 0;
    }

    const meanX = mean(x);
    const meanY = mean(y);

    let numerator = 0;
    let denominatorX = 0;
    let denominatorY = 0;

    for (let i = 0; i < x.length; i += 1) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;

        numerator += dx * dy;
        denominatorX += dx ** 2;
        denominatorY += dy ** 2;
    }

    const denominator =
        Math.sqrt(denominatorX) *
        Math.sqrt(denominatorY);

    if (denominator === 0) {
        return 0;
    }

    return numerator / denominator;
}

function ranks(values: number[]): number[] {
    const indexed = values.map(
        (value, index) => ({
            value,
            index,
        }),
    );

    indexed.sort(
        (a, b) => a.value - b.value,
    );

    const result =
        new Array<number>(
            values.length,
        );

    let i = 0;

    while (i < indexed.length) {
        let j = i + 1;

        while (
            j < indexed.length &&
            indexed[j].value ===
                indexed[i].value
        ) {
            j += 1;
        }

        const rank =
            (i + j - 1) / 2 + 1;

        for (let k = i; k < j; k += 1) {
            result[indexed[k].index] =
                rank;
        }

        i = j;
    }

    return result;
}

function spearman(
    x: number[],
    y: number[],
): number {
    return pearson(
        ranks(x),
        ranks(y),
    );
}

function round(
    value: number,
    decimals = 6,
): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    const multiplier =
        10 ** decimals;

    return (
        Math.round(
            value * multiplier,
        ) / multiplier
    );
}

function getReturns(
    closes: number[],
): number[] {
    const result: number[] = [];

    for (
        let i = 1;
        i < closes.length;
        i += 1
    ) {
        if (
            closes[i - 1] === 0 ||
            !Number.isFinite(
                closes[i - 1],
            ) ||
            !Number.isFinite(
                closes[i],
            )
        ) {
            continue;
        }

        result.push(
            closes[i] /
                closes[i - 1] -
                1,
        );
    }

    return result;
}

function cumulativeReturn(
    closes: number[],
    hours: number,
): number {
    if (closes.length <= hours) {
        return 0;
    }

    const start =
        closes[
            closes.length -
                1 -
                hours
        ];

    const end =
        closes[closes.length - 1];

    return start === 0
        ? 0
        : end / start - 1;
}

function rollingVolatility(
    values: number[],
    hours: number,
): number {
    if (values.length < hours) {
        return 0;
    }

    return standardDeviation(
        values.slice(
            values.length - hours,
        ),
    );
}

function rollingRange(
    candles: Candle[],
    hours: number,
): number {
    if (candles.length < hours) {
        return 0;
    }

    const recent =
        candles.slice(
            candles.length - hours,
        );

    let highest =
        Number.NEGATIVE_INFINITY;

    let lowest =
        Number.POSITIVE_INFINITY;

    for (const candle of recent) {
        highest = Math.max(
            highest,
            candle.high,
        );

        lowest = Math.min(
            lowest,
            candle.low,
        );
    }

    const start =
        recent[0].close;

    return start === 0
        ? 0
        : (highest - lowest) /
              start;
}

function rollingEfficiency(
    closes: number[],
    hours: number,
): number {
    if (closes.length < hours + 1) {
        return 0;
    }

    const start =
        closes[
            closes.length -
                1 -
                hours
        ];

    const end =
        closes[closes.length - 1];

    let pathLength = 0;

    for (
        let i =
            closes.length - hours;
        i < closes.length;
        i += 1
    ) {
        pathLength += Math.abs(
            closes[i] -
                closes[i - 1],
        );
    }

    return pathLength === 0
        ? 0
        : Math.abs(end - start) /
              pathLength;
}

function rollingTrendSlope(
    closes: number[],
    hours: number,
): number {
    if (closes.length < hours) {
        return 0;
    }

    const values =
        closes.slice(
            closes.length - hours,
        );

    const first = values[0];

    if (first === 0) {
        return 0;
    }

    const normalised =
        values.map(
            (value) =>
                value / first,
        );

    const n = normalised.length;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (
        let i = 0;
        i < n;
        i += 1
    ) {
        sumX += i;
        sumY += normalised[i];
        sumXY +=
            i * normalised[i];
        sumXX += i * i;
    }

    const denominator =
        n * sumXX -
        sumX ** 2;

    if (denominator === 0) {
        return 0;
    }

    return (
        (n * sumXY -
            sumX * sumY) /
        denominator
    );
}

function maxRun(
    values: number[],
    positive: boolean,
): number {
    let current = 0;
    let maximum = 0;

    for (const value of values) {
        const qualifies = positive
            ? value > 0
            : value < 0;

        if (qualifies) {
            current += 1;
            maximum = Math.max(
                maximum,
                current,
            );
        } else {
            current = 0;
        }
    }

    return maximum;
}

function reversalRate(
    values: number[],
): number {
    if (values.length < 2) {
        return 0;
    }

    let reversals = 0;
    let comparisons = 0;

    for (
        let i = 1;
        i < values.length;
        i += 1
    ) {
        if (
            values[i] === 0 ||
            values[i - 1] === 0
        ) {
            continue;
        }

        comparisons += 1;

        if (
            Math.sign(values[i]) !==
            Math.sign(values[i - 1])
        ) {
            reversals += 1;
        }
    }

    return comparisons === 0
        ? 0
        : reversals / comparisons;
}

function autocorrelation1h(
    values: number[],
): number {
    if (values.length < 3) {
        return 0;
    }

    return pearson(
        values.slice(0, -1),
        values.slice(1),
    );
}

function correlationWith(
    x: number[],
    y: number[],
): number {
    const length =
        Math.min(
            x.length,
            y.length,
        );

    if (length < 2) {
        return 0;
    }

    return pearson(
        x.slice(0, length),
        y.slice(0, length),
    );
}

function calculateFeatures(
    candles: Candle[],
): FeatureSet {
    const closes =
        candles.map(
            (candle) =>
                candle.close,
        );

    const hourlyReturns =
        getReturns(closes);

    const volumes =
        candles.map(
            (candle) =>
                candle.volume,
        );

    const ranges =
        candles.map(
            (candle) =>
                candle.close === 0
                    ? 0
                    : (candle.high -
                          candle.low) /
                      candle.close,
        );

    return {
        totalReturn:
            closes.length < 2
                ? 0
                : closes[
                      closes.length - 1
                  ] /
                      closes[0] -
                  1,

        meanHourlyReturn:
            mean(hourlyReturns),

        medianHourlyReturn:
            median(hourlyReturns),

        hourlyVolatility:
            standardDeviation(
                hourlyReturns,
            ),

        positiveHourRate:
            hourlyReturns.length === 0
                ? 0
                : hourlyReturns.filter(
                      (value) =>
                          value > 0,
                  ).length /
                  hourlyReturns.length,

        negativeHourRate:
            hourlyReturns.length === 0
                ? 0
                : hourlyReturns.filter(
                      (value) =>
                          value < 0,
                  ).length /
                  hourlyReturns.length,

        maxHourlyGain:
            hourlyReturns.length === 0
                ? 0
                : Math.max(
                      ...hourlyReturns,
                  ),

        maxHourlyLoss:
            hourlyReturns.length === 0
                ? 0
                : Math.min(
                      ...hourlyReturns,
                  ),

        maxPositiveRun:
            maxRun(
                hourlyReturns,
                true,
            ),

        maxNegativeRun:
            maxRun(
                hourlyReturns,
                false,
            ),

        reversalRate:
            reversalRate(
                hourlyReturns,
            ),

        autocorrelation1h:
            autocorrelation1h(
                hourlyReturns,
            ),

        meanVolume:
            mean(volumes),

        volumeVolatility:
            standardDeviation(
                volumes,
            ),

        volumeReturnCorrelation:
            correlationWith(
                volumes.slice(1),
                hourlyReturns,
            ),

        volumeRangeCorrelation:
            correlationWith(
                volumes,
                ranges,
            ),

        return6h:
            cumulativeReturn(
                closes,
                6,
            ),

        return12h:
            cumulativeReturn(
                closes,
                12,
            ),

        return24h:
            cumulativeReturn(
                closes,
                24,
            ),

        return72h:
            cumulativeReturn(
                closes,
                72,
            ),

        return168h:
            cumulativeReturn(
                closes,
                168,
            ),

        volatility6h:
            rollingVolatility(
                hourlyReturns,
                6,
            ),

        volatility12h:
            rollingVolatility(
                hourlyReturns,
                12,
            ),

        volatility24h:
            rollingVolatility(
                hourlyReturns,
                24,
            ),

        volatility72h:
            rollingVolatility(
                hourlyReturns,
                72,
            ),

        volatility168h:
            rollingVolatility(
                hourlyReturns,
                168,
            ),

        range24h:
            rollingRange(
                candles,
                24,
            ),

        efficiency24h:
            rollingEfficiency(
                closes,
                24,
            ),

        trendSlope24h:
            rollingTrendSlope(
                closes,
                24,
            ),

        range72h:
            rollingRange(
                candles,
                72,
            ),

        efficiency72h:
            rollingEfficiency(
                closes,
                72,
            ),

        trendSlope72h:
            rollingTrendSlope(
                closes,
                72,
            ),

        range168h:
            rollingRange(
                candles,
                168,
            ),

        efficiency168h:
            rollingEfficiency(
                closes,
                168,
            ),

        trendSlope168h:
            rollingTrendSlope(
                closes,
                168,
            ),
    };
}

function getStrategyMarkets(
    data: StrategyData,
): StrategyMarket[] {
    const markets: StrategyMarket[] =
        [];

    if (
        Array.isArray(
            data.sample?.markets,
        )
    ) {
        markets.push(
            ...data.sample.markets,
        );
    }

    if (
        Array.isArray(
            data.outOfSample?.markets,
        )
    ) {
        markets.push(
            ...data.outOfSample.markets,
        );
    }

    return markets;
}

function buildCorrelation(
    markets: Array<{
        features: FeatureSet;
        netProfit: number;
    }>,
    feature: string,
): CorrelationResult {
    const values: number[] = [];
    const profits: number[] = [];

    for (const market of markets) {
        const value =
            market.features[feature];

        if (!Number.isFinite(value)) {
            continue;
        }

        values.push(value);
        profits.push(
            market.netProfit,
        );
    }

    return {
        feature,
        spearman: round(
            spearman(
                values,
                profits,
            ),
        ),
        pearson: round(
            pearson(
                values,
                profits,
            ),
        ),
    };
}

function buildGroupComparison(
    feature: string,
    markets: Array<{
        features: FeatureSet;
        netProfit: number;
    }>,
): GroupComparison {
    const positive: number[] = [];
    const flat: number[] = [];
    const negative: number[] = [];

    for (const market of markets) {
        const value =
            market.features[feature];

        if (!Number.isFinite(value)) {
            continue;
        }

        if (market.netProfit > 0) {
            positive.push(value);
        } else if (
            market.netProfit < 0
        ) {
            negative.push(value);
        } else {
            flat.push(value);
        }
    }

    return {
        feature,

        positiveMedian: round(
            median(positive),
        ),

        flatMedian: round(
            median(flat),
        ),

        negativeMedian: round(
            median(negative),
        ),
    };
}

async function main(): Promise<void> {
    const startedAt =
        Date.now();

    console.log(
        "============================================================",
    );
    console.log(
        "August 2026 hourly market behaviour runner",
    );
    console.log(
        "============================================================",
    );
    console.log();

    console.log(
        `Hourly data:   ${HOURLY_FILE}`,
    );

    console.log(
        `Strategy data: ${STRATEGY_FILE}`,
    );

    console.log();

    const hourlyText =
        await fs.readFile(
            path.resolve(
                HOURLY_FILE,
            ),
            "utf8",
        );

    const strategyText =
        await fs.readFile(
            path.resolve(
                STRATEGY_FILE,
            ),
            "utf8",
        );

    const hourlyData =
        JSON.parse(
            hourlyText,
        ) as HourlyData;

    const strategyData =
        JSON.parse(
            strategyText,
        ) as StrategyData;

    if (
        !Array.isArray(
            hourlyData.markets,
        )
    ) {
        throw new Error(
            "Hourly data is missing markets[].",
        );
    }

    const strategyMarkets =
        getStrategyMarkets(
            strategyData,
        );

    if (
        strategyMarkets.length === 0
    ) {
        throw new Error(
            "Could not find strategy market results under sample.markets or outOfSample.markets.",
        );
    }

    console.log(
        `Strategy market results: ${strategyMarkets.length}`,
    );

    console.log(
        `Hourly markets: ${hourlyData.markets.length}`,
    );

    const strategyBySymbol =
        new Map<
            string,
            StrategyMarket
        >();

    for (const market of strategyMarkets) {
        strategyBySymbol.set(
            market.symbol,
            market,
        );
    }

    const analysed: Array<{
        result: MarketResult;
        features: FeatureSet;
    }> = [];

    let marketsWithCandles = 0;
    let unmatchedHourlyMarkets = 0;

    for (
        const hourlyMarket of
            hourlyData.markets
    ) {
        if (
            hourlyMarket.candles.length ===
            0
        ) {
            continue;
        }

        marketsWithCandles += 1;

        const strategy =
            strategyBySymbol.get(
                hourlyMarket.symbol,
            );

        if (!strategy) {
            unmatchedHourlyMarkets += 1;
            continue;
        }

        const candles =
            [...hourlyMarket.candles].sort(
                (a, b) =>
                    a.time - b.time,
            );

        analysed.push({
            result: {
                symbol:
                    strategy.symbol,

                binanceArrayPosition:
                    strategy.binanceArrayPosition,

                datasetGroup:
                    strategy.datasetGroup,

                netProfit:
                    round(
                        strategy.netProfit,
                    ),

                returnPct:
                    round(
                        strategy.returnPct,
                    ),
            },

            features:
                calculateFeatures(
                    candles,
                ),
        });
    }

    const correlationInput =
        analysed.map(
            (market) => ({
                features:
                    market.features,
                netProfit:
                    market.result.netProfit,
            }),
        );

    const featureNames =
        Object.keys(
            analysed[0]?.features ??
                {},
        );

    const correlations =
        featureNames
            .map((feature) =>
                buildCorrelation(
                    correlationInput,
                    feature,
                ),
            )
            .sort(
                (a, b) =>
                    Math.abs(
                        b.spearman,
                    ) -
                    Math.abs(
                        a.spearman,
                    ),
            );

    const strongestFeatures =
        correlations
            .slice(
                0,
                TOP_GROUP_FEATURES,
            )
            .map(
                (item) =>
                    item.feature,
            );

    const groupComparisons =
        strongestFeatures.map(
            (feature) =>
                buildGroupComparison(
                    feature,
                    correlationInput,
                ),
        );

    const markets =
        analysed
            .map(
                (market) =>
                    market.result,
            )
            .sort(
                (a, b) =>
                    b.netProfit -
                    a.netProfit,
            );

    const positiveMarkets =
        markets.filter(
            (market) =>
                market.netProfit > 0,
        );

    const flatMarkets =
        markets.filter(
            (market) =>
                market.netProfit === 0,
        );

    const negativeMarkets =
        markets.filter(
            (market) =>
                market.netProfit < 0,
        );

    const output: OutputData = {
        generatedAt:
            new Date().toISOString(),

        source: {
            hourlyFile:
                HOURLY_FILE,

            strategyFile:
                STRATEGY_FILE,

            interval:
                hourlyData.interval,

            startTimeIso:
                hourlyData.startTimeIso,

            endTimeExclusiveIso:
                hourlyData.endTimeExclusiveIso,
        },

        summary: {
            hourlyMarkets:
                hourlyData.markets.length,

            marketsWithCandles,

            matchedMarkets:
                markets.length,

            unmatchedHourlyMarkets,

            positiveMarkets:
                positiveMarkets.length,

            flatMarkets:
                flatMarkets.length,

            negativeMarkets:
                negativeMarkets.length,
        },

        correlations,

        groupComparisons,

        markets,
    };

    await fs.mkdir(
        path.resolve(OUTPUT_DIR),
        {
            recursive: true,
        },
    );

    const timestamp =
        new Date()
            .toISOString()
            .replace(
                /:/g,
                "-",
            )
            .replace(
                /\.\d{3}Z$/,
                "Z",
            );

    const jsonPath = path.join(
        OUTPUT_DIR,
        `august-market-behaviour-${timestamp}.json`,
    );

    const csvPath = path.join(
        OUTPUT_DIR,
        `august-market-behaviour-${timestamp}.csv`,
    );

    await fs.writeFile(
        path.resolve(jsonPath),
        JSON.stringify(
            output,
            null,
            2,
        ),
        "utf8",
    );

    const csvLines = [
        [
            "symbol",
            "binanceArrayPosition",
            "datasetGroup",
            "netProfit",
            "returnPct",
        ].join(","),
    ];

    for (const market of markets) {
        csvLines.push(
            [
                market.symbol,
                market.binanceArrayPosition,
                market.datasetGroup,
                market.netProfit,
                market.returnPct,
            ].join(","),
        );
    }

    await fs.writeFile(
        path.resolve(csvPath),
        csvLines.join("\n"),
        "utf8",
    );

    console.log();
    console.log(
        "============================================================",
    );
    console.log(
        "Results",
    );
    console.log(
        "============================================================",
    );

    console.log(
        `Markets analysed: ${markets.length}`,
    );

    console.log(
        `Positive: ${positiveMarkets.length}`,
    );

    console.log(
        `Flat:     ${flatMarkets.length}`,
    );

    console.log(
        `Negative: ${negativeMarkets.length}`,
    );

    console.log();
    console.log(
        "Strongest correlations:",
    );

    for (
        const correlation of correlations.slice(
            0,
            10,
        )
    ) {
        console.log(
            `  ${correlation.feature.padEnd(
                28,
            )} Spearman=${correlation.spearman.toFixed(
                4,
            )}`,
        );
    }

    console.log();
    console.log(
        `JSON output: ${jsonPath}`,
    );

    console.log(
        `CSV output:  ${csvPath}`,
    );

    console.log(
        `Completed in ${(
            (Date.now() -
                startedAt) /
            1000
        ).toFixed(1)} seconds.`,
    );
}

main().catch(
    (error: unknown) => {
        console.error();
        console.error(
            "Runner failed:",
        );
        console.error(error);
        process.exit(1);
    },
);