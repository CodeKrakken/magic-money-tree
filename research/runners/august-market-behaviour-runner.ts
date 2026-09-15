import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESEARCH_DIR = join(__dirname, "..");
const DATA_DIR = join(RESEARCH_DIR, "data");
const OUTPUT_DIR = join(RESEARCH_DIR, "output");

const HOURLY_FILE =
    "binance-august-2026-1h-2026-09-15T16-55-45Z.json";

const STRATEGY_FILE =
    "market-strategy-ranking-independent-1789232701426.json";

interface HourlyCandle {
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
    firstCandleTime: number;
    lastCandleTime: number;
    candles: HourlyCandle[];
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
    datasetGroup?: string;
    marketIndex?: number;
    binanceArrayPosition?: number;
    netProfit?: number;
    returnPct?: number;
    accepted?: number;
    rejectedByCapacity?: number;
    winningPositions?: number;
    losingPositions?: number;
    signals?: number;
    [key: string]: unknown;
}

interface StrategyRoot {
    sample?: {
        markets?: StrategyMarket[];
    };
    outOfSample?: {
        markets?: StrategyMarket[];
    };
}

interface MarketBehaviour {
    symbol: string;
    binanceArrayPosition: number;
    candleCount: number;

    firstCandleTime: number;
    lastCandleTime: number;

    strategyDatasetGroup: string;
    strategyNetProfit: number;
    strategyReturnPct: number;

    totalReturnPct: number;

    hourlyReturnMeanPct: number;
    hourlyReturnMedianPct: number;
    hourlyReturnStdPct: number;

    positiveHourRatePct: number;
    negativeHourRatePct: number;

    meanHourlyRangePct: number;
    medianHourlyRangePct: number;
    hourlyRangeStdPct: number;

    maxHourlyGainPct: number;
    maxHourlyLossPct: number;

    maxPositiveRunHours: number;
    maxNegativeRunHours: number;
    reversalRatePct: number;
    returnAutocorrelation1h: number;

    meanVolume: number;
    medianVolume: number;
    volumeStd: number;

    meanQuoteVolumeProxy: number;
    medianQuoteVolumeProxy: number;
    quoteVolumeProxyStd: number;

    volumeReturnCorrelation: number;
    volumeRangeCorrelation: number;

    rolling6hReturnMeanPct: number;
    rolling6hReturnStdPct: number;

    rolling12hReturnMeanPct: number;
    rolling12hReturnStdPct: number;

    rolling24hReturnMeanPct: number;
    rolling24hReturnStdPct: number;

    rolling72hReturnMeanPct: number;
    rolling72hReturnStdPct: number;

    rolling168hReturnMeanPct: number;
    rolling168hReturnStdPct: number;

    rolling24hVolatilityPct: number;
    rolling72hVolatilityPct: number;
    rolling168hVolatilityPct: number;

    rolling24hRangeMeanPct: number;
    rolling72hRangeMeanPct: number;
    rolling168hRangeMeanPct: number;

    rolling24hEfficiencyMean: number;
    rolling72hEfficiencyMean: number;
    rolling168hEfficiencyMean: number;

    rolling24hTrendSlopeMeanPct: number;
    rolling72hTrendSlopeMeanPct: number;
    rolling168hTrendSlopeMeanPct: number;
}

interface CorrelationResult {
    feature: string;
    pearson: number;
    spearman: number;
    sampleCount: number;
}

interface Output {
    generatedAt: string;
    experiment: string;

    source: {
        hourlyFile: string;
        strategyFile: string;
        interval: string;
        period: {
            start: string;
            endExclusive: string;
        };
        expectedCandleCount: number;
    };

    summary: {
        hourlyMarkets: number;
        marketsWithCandles: number;
        marketsWithoutCandles: number;
        partialMarkets: number;
        fullCoverageMarkets: number;

        matchedMarkets: number;
        unmatchedHourlyMarkets: number;

        positiveStrategyMarkets: number;
        flatStrategyMarkets: number;
        negativeStrategyMarkets: number;

        positiveStrategyNetProfit: number;
        negativeStrategyNetProfit: number;
    };

    correlations: CorrelationResult[];

    markets: MarketBehaviour[];
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                 */
/* -------------------------------------------------------------------------- */

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

    const middle = Math.floor(
        sorted.length / 2,
    );

    if (sorted.length % 2 === 0) {
        return (
            sorted[middle - 1] +
            sorted[middle]
        ) / 2;
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
            (sum, value) => {
                const difference =
                    value - average;

                return (
                    sum +
                    difference *
                        difference
                );
            },
            0,
        ) / values.length;

    return Math.sqrt(variance);
}

function covariance(
    x: number[],
    y: number[],
): number {
    if (
        x.length !== y.length ||
        x.length < 2
    ) {
        return 0;
    }

    const xMean = mean(x);
    const yMean = mean(y);

    let total = 0;

    for (let i = 0; i < x.length; i++) {
        total +=
            (x[i] - xMean) *
            (y[i] - yMean);
    }

    return total / x.length;
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

    const xStd =
        standardDeviation(x);

    const yStd =
        standardDeviation(y);

    if (
        xStd === 0 ||
        yStd === 0
    ) {
        return 0;
    }

    return (
        covariance(x, y) /
        (xStd * yStd)
    );
}

function rank(
    values: number[],
): number[] {
    const indexed = values.map(
        (value, index) => ({
            value,
            index,
        }),
    );

    indexed.sort(
        (a, b) => a.value - b.value,
    );

    const ranks =
        new Array<number>(
            values.length,
        );

    let start = 0;

    while (
        start < indexed.length
    ) {
        let end = start + 1;

        while (
            end < indexed.length &&
            indexed[end].value ===
                indexed[start].value
        ) {
            end++;
        }

        const averageRank =
            (start + end - 1) / 2;

        for (
            let i = start;
            i < end;
            i++
        ) {
            ranks[
                indexed[i].index
            ] = averageRank;
        }

        start = end;
    }

    return ranks;
}

function spearman(
    x: number[],
    y: number[],
): number {
    return pearson(
        rank(x),
        rank(y),
    );
}

function returnPct(
    start: number,
    end: number,
): number {
    if (start === 0) {
        return 0;
    }

    return (
        (end / start - 1) *
        100
    );
}

function safeNumber(
    value: unknown,
): number {
    return typeof value === "number" &&
        Number.isFinite(value)
        ? value
        : 0;
}

/* -------------------------------------------------------------------------- */
/* Rolling calculations                                                       */
/* -------------------------------------------------------------------------- */

function rollingReturns(
    closes: number[],
    window: number,
): number[] {
    const results: number[] = [];

    for (
        let i = window;
        i < closes.length;
        i++
    ) {
        const start =
            closes[i - window];

        if (start === 0) {
            continue;
        }

        results.push(
            returnPct(
                start,
                closes[i],
            ),
        );
    }

    return results;
}

function rollingVolatility(
    returns: number[],
    window: number,
): number[] {
    const results: number[] = [];

    for (
        let i = window;
        i <= returns.length;
        i++
    ) {
        results.push(
            standardDeviation(
                returns.slice(
                    i - window,
                    i,
                ),
            ),
        );
    }

    return results;
}

function rollingRange(
    candles: HourlyCandle[],
    window: number,
): number[] {
    const ranges =
        candles.map(
            (candle) =>
                candle.open === 0
                    ? 0
                    : (
                          (candle.high -
                              candle.low) /
                          candle.open
                      ) * 100,
        );

    const results: number[] = [];

    for (
        let i = window;
        i <= ranges.length;
        i++
    ) {
        results.push(
            mean(
                ranges.slice(
                    i - window,
                    i,
                ),
            ),
        );
    }

    return results;
}

function rollingEfficiency(
    closes: number[],
    window: number,
): number[] {
    const results: number[] = [];

    for (
        let i = window;
        i < closes.length;
        i++
    ) {
        const start =
            closes[i - window];

        const end =
            closes[i];

        const netMove =
            Math.abs(
                end - start,
            );

        let path = 0;

        for (
            let j =
                i - window + 1;
            j <= i;
            j++
        ) {
            path += Math.abs(
                closes[j] -
                    closes[j - 1],
            );
        }

        results.push(
            path === 0
                ? 0
                : netMove / path,
        );
    }

    return results;
}

function rollingTrendSlope(
    closes: number[],
    window: number,
): number[] {
    const results: number[] = [];

    if (
        closes.length <
        window
    ) {
        return results;
    }

    const xMean =
        (window - 1) / 2;

    let denominator = 0;

    for (
        let x = 0;
        x < window;
        x++
    ) {
        const difference =
            x - xMean;

        denominator +=
            difference *
            difference;
    }

    for (
        let i = window;
        i <= closes.length;
        i++
    ) {
        const slice =
            closes.slice(
                i - window,
                i,
            );

        const yMean =
            mean(slice);

        let numerator = 0;

        for (
            let x = 0;
            x < window;
            x++
        ) {
            numerator +=
                (x - xMean) *
                (slice[x] -
                    yMean);
        }

        const slope =
            denominator === 0
                ? 0
                : numerator /
                  denominator;

        const base =
            slice[0];

        results.push(
            base === 0
                ? 0
                : (slope / base) *
                  100,
        );
    }

    return results;
}

/* -------------------------------------------------------------------------- */
/* Market analysis                                                            */
/* -------------------------------------------------------------------------- */

function analyseMarket(
    market: HourlyMarket,
    strategy: StrategyMarket,
): MarketBehaviour {
    const candles =
        market.candles
            .filter(
                (candle) =>
                    Number.isFinite(
                        candle.time,
                    ) &&
                    Number.isFinite(
                        candle.open,
                    ) &&
                    Number.isFinite(
                        candle.high,
                    ) &&
                    Number.isFinite(
                        candle.low,
                    ) &&
                    Number.isFinite(
                        candle.close,
                    ) &&
                    Number.isFinite(
                        candle.volume,
                    ),
            )
            .sort(
                (a, b) =>
                    a.time - b.time,
            );

    const closes =
        candles.map(
            (candle) =>
                candle.close,
        );

    const hourlyReturns: number[] =
        [];

    const hourlyRanges: number[] =
        [];

    for (const candle of candles) {
        if (candle.open === 0) {
            continue;
        }

        hourlyReturns.push(
            (
                (candle.close -
                    candle.open) /
                candle.open
            ) * 100,
        );

        hourlyRanges.push(
            (
                (candle.high -
                    candle.low) /
                candle.open
            ) * 100,
        );
    }

    const positiveHours =
        hourlyReturns.filter(
            (value) => value > 0,
        ).length;

    const negativeHours =
        hourlyReturns.filter(
            (value) => value < 0,
        ).length;

    let maxHourlyGainPct = 0;
    let maxHourlyLossPct = 0;

    for (
        const value of hourlyReturns
    ) {
        maxHourlyGainPct =
            Math.max(
                maxHourlyGainPct,
                value,
            );

        maxHourlyLossPct =
            Math.min(
                maxHourlyLossPct,
                value,
            );
    }

    let maxPositiveRunHours = 0;
    let maxNegativeRunHours = 0;

    let positiveRun = 0;
    let negativeRun = 0;

    for (
        const value of hourlyReturns
    ) {
        if (value > 0) {
            positiveRun++;
            negativeRun = 0;
        } else if (value < 0) {
            negativeRun++;
            positiveRun = 0;
        } else {
            positiveRun = 0;
            negativeRun = 0;
        }

        maxPositiveRunHours =
            Math.max(
                maxPositiveRunHours,
                positiveRun,
            );

        maxNegativeRunHours =
            Math.max(
                maxNegativeRunHours,
                negativeRun,
            );
    }

    let reversals = 0;

    for (
        let i = 1;
        i < hourlyReturns.length;
        i++
    ) {
        const previous =
            hourlyReturns[i - 1];

        const current =
            hourlyReturns[i];

        if (
            (previous > 0 &&
                current < 0) ||
            (previous < 0 &&
                current > 0)
        ) {
            reversals++;
        }
    }

    const reversalRatePct =
        hourlyReturns.length < 2
            ? 0
            : (
                  reversals /
                  (hourlyReturns.length -
                      1)
              ) * 100;

    const returnAutocorrelation1h =
        pearson(
            hourlyReturns.slice(
                0,
                -1,
            ),
            hourlyReturns.slice(
                1,
            ),
        );

    const volumes =
        candles.map(
            (candle) =>
                candle.volume,
        );

    /*
     * The supplied Binance hourly candle records contain base-asset
     * volume, not Binance quoteVolume. Therefore this is explicitly
     * labelled as a proxy:
     *
     * close × base volume
     */
    const quoteVolumeProxy =
        candles.map(
            (candle) =>
                candle.close *
                candle.volume,
        );

    const pairCount =
        Math.min(
            volumes.length,
            hourlyReturns.length,
        );

    const volumeValues =
        volumes.slice(
            0,
            pairCount,
        );

    const returnValues =
        hourlyReturns.slice(
            0,
            pairCount,
        );

    const rangeValues =
        hourlyRanges.slice(
            0,
            pairCount,
        );

    const rolling6h =
        rollingReturns(
            closes,
            6,
        );

    const rolling12h =
        rollingReturns(
            closes,
            12,
        );

    const rolling24h =
        rollingReturns(
            closes,
            24,
        );

    const rolling72h =
        rollingReturns(
            closes,
            72,
        );

    const rolling168h =
        rollingReturns(
            closes,
            168,
        );

    const closeReturns =
        closes.length < 2
            ? []
            : closes
                  .slice(1)
                  .map(
                      (
                          close,
                          index,
                      ) =>
                          returnPct(
                              closes[index],
                              close,
                          ),
                  );

    const volatility24h =
        rollingVolatility(
            closeReturns,
            24,
        );

    const volatility72h =
        rollingVolatility(
            closeReturns,
            72,
        );

    const volatility168h =
        rollingVolatility(
            closeReturns,
            168,
        );

    const range24h =
        rollingRange(
            candles,
            24,
        );

    const range72h =
        rollingRange(
            candles,
            72,
        );

    const range168h =
        rollingRange(
            candles,
            168,
        );

    const efficiency24h =
        rollingEfficiency(
            closes,
            24,
        );

    const efficiency72h =
        rollingEfficiency(
            closes,
            72,
        );

    const efficiency168h =
        rollingEfficiency(
            closes,
            168,
        );

    const slope24h =
        rollingTrendSlope(
            closes,
            24,
        );

    const slope72h =
        rollingTrendSlope(
            closes,
            72,
        );

    const slope168h =
        rollingTrendSlope(
            closes,
            168,
        );

    return {
        symbol: market.symbol,

        binanceArrayPosition:
            safeNumber(
                market.binanceArrayPosition,
            ),

        candleCount:
            candles.length,

        firstCandleTime:
            candles[0]?.time ??
            market.firstCandleTime,

        lastCandleTime:
            candles[
                candles.length - 1
            ]?.time ??
            market.lastCandleTime,

        strategyDatasetGroup:
            strategy.datasetGroup ??
            "",

        strategyNetProfit:
            safeNumber(
                strategy.netProfit,
            ),

        strategyReturnPct:
            safeNumber(
                strategy.returnPct,
            ),

        totalReturnPct:
            returnPct(
                closes[0] ?? 0,
                closes[
                    closes.length - 1
                ] ?? 0,
            ),

        hourlyReturnMeanPct:
            mean(hourlyReturns),

        hourlyReturnMedianPct:
            median(hourlyReturns),

        hourlyReturnStdPct:
            standardDeviation(
                hourlyReturns,
            ),

        positiveHourRatePct:
            hourlyReturns.length === 0
                ? 0
                : (
                      positiveHours /
                      hourlyReturns.length
                  ) * 100,

        negativeHourRatePct:
            hourlyReturns.length === 0
                ? 0
                : (
                      negativeHours /
                      hourlyReturns.length
                  ) * 100,

        meanHourlyRangePct:
            mean(hourlyRanges),

        medianHourlyRangePct:
            median(hourlyRanges),

        hourlyRangeStdPct:
            standardDeviation(
                hourlyRanges,
            ),

        maxHourlyGainPct,
        maxHourlyLossPct,

        maxPositiveRunHours,
        maxNegativeRunHours,

        reversalRatePct,
        returnAutocorrelation1h,

        meanVolume:
            mean(volumes),

        medianVolume:
            median(volumes),

        volumeStd:
            standardDeviation(
                volumes,
            ),

        meanQuoteVolumeProxy:
            mean(
                quoteVolumeProxy,
            ),

        medianQuoteVolumeProxy:
            median(
                quoteVolumeProxy,
            ),

        quoteVolumeProxyStd:
            standardDeviation(
                quoteVolumeProxy,
            ),

        volumeReturnCorrelation:
            pearson(
                volumeValues,
                returnValues,
            ),

        volumeRangeCorrelation:
            pearson(
                volumeValues,
                rangeValues,
            ),

        rolling6hReturnMeanPct:
            mean(rolling6h),

        rolling6hReturnStdPct:
            standardDeviation(
                rolling6h,
            ),

        rolling12hReturnMeanPct:
            mean(rolling12h),

        rolling12hReturnStdPct:
            standardDeviation(
                rolling12h,
            ),

        rolling24hReturnMeanPct:
            mean(rolling24h),

        rolling24hReturnStdPct:
            standardDeviation(
                rolling24h,
            ),

        rolling72hReturnMeanPct:
            mean(rolling72h),

        rolling72hReturnStdPct:
            standardDeviation(
                rolling72h,
            ),

        rolling168hReturnMeanPct:
            mean(rolling168h),

        rolling168hReturnStdPct:
            standardDeviation(
                rolling168h,
            ),

        rolling24hVolatilityPct:
            mean(
                volatility24h,
            ),

        rolling72hVolatilityPct:
            mean(
                volatility72h,
            ),

        rolling168hVolatilityPct:
            mean(
                volatility168h,
            ),

        rolling24hRangeMeanPct:
            mean(range24h),

        rolling72hRangeMeanPct:
            mean(range72h),

        rolling168hRangeMeanPct:
            mean(range168h),

        rolling24hEfficiencyMean:
            mean(
                efficiency24h,
            ),

        rolling72hEfficiencyMean:
            mean(
                efficiency72h,
            ),

        rolling168hEfficiencyMean:
            mean(
                efficiency168h,
            ),

        rolling24hTrendSlopeMeanPct:
            mean(slope24h),

        rolling72hTrendSlopeMeanPct:
            mean(slope72h),

        rolling168hTrendSlopeMeanPct:
            mean(slope168h),
    };
}

/* -------------------------------------------------------------------------- */
/* Strategy parsing                                                           */
/* -------------------------------------------------------------------------- */

function loadStrategyMarkets(
    root: StrategyRoot,
): Map<string, StrategyMarket> {
    const markets = [
        ...(root.sample?.markets ?? []),
        ...(root.outOfSample?.markets ?? []),
    ];

    const result =
        new Map<string, StrategyMarket>();

    for (
        const market of markets
    ) {
        if (market.symbol) {
            result.set(
                market.symbol,
                market,
            );
        }
    }

    return result;
}

/* -------------------------------------------------------------------------- */
/* Correlations                                                               */
/* -------------------------------------------------------------------------- */

function buildCorrelations(
    markets: MarketBehaviour[],
): CorrelationResult[] {
    const profit =
        markets.map(
            (market) =>
                market.strategyNetProfit,
        );

    const features: Array<
        [
            string,
            (
                market: MarketBehaviour,
            ) => number,
        ]
    > = [
        [
            "binanceArrayPosition",
            (m) =>
                m.binanceArrayPosition,
        ],
        [
            "totalReturnPct",
            (m) => m.totalReturnPct,
        ],
        [
            "hourlyReturnMeanPct",
            (m) =>
                m.hourlyReturnMeanPct,
        ],
        [
            "hourlyReturnMedianPct",
            (m) =>
                m.hourlyReturnMedianPct,
        ],
        [
            "hourlyReturnStdPct",
            (m) =>
                m.hourlyReturnStdPct,
        ],
        [
            "positiveHourRatePct",
            (m) =>
                m.positiveHourRatePct,
        ],
        [
            "negativeHourRatePct",
            (m) =>
                m.negativeHourRatePct,
        ],
        [
            "meanHourlyRangePct",
            (m) =>
                m.meanHourlyRangePct,
        ],
        [
            "medianHourlyRangePct",
            (m) =>
                m.medianHourlyRangePct,
        ],
        [
            "hourlyRangeStdPct",
            (m) =>
                m.hourlyRangeStdPct,
        ],
        [
            "maxHourlyGainPct",
            (m) =>
                m.maxHourlyGainPct,
        ],
        [
            "maxHourlyLossPct",
            (m) =>
                m.maxHourlyLossPct,
        ],
        [
            "maxPositiveRunHours",
            (m) =>
                m.maxPositiveRunHours,
        ],
        [
            "maxNegativeRunHours",
            (m) =>
                m.maxNegativeRunHours,
        ],
        [
            "reversalRatePct",
            (m) =>
                m.reversalRatePct,
        ],
        [
            "returnAutocorrelation1h",
            (m) =>
                m.returnAutocorrelation1h,
        ],
        [
            "meanVolume",
            (m) => m.meanVolume,
        ],
        [
            "medianVolume",
            (m) =>
                m.medianVolume,
        ],
        [
            "volumeStd",
            (m) => m.volumeStd,
        ],
        [
            "meanQuoteVolumeProxy",
            (m) =>
                m.meanQuoteVolumeProxy,
        ],
        [
            "medianQuoteVolumeProxy",
            (m) =>
                m.medianQuoteVolumeProxy,
        ],
        [
            "quoteVolumeProxyStd",
            (m) =>
                m.quoteVolumeProxyStd,
        ],
        [
            "volumeReturnCorrelation",
            (m) =>
                m.volumeReturnCorrelation,
        ],
        [
            "volumeRangeCorrelation",
            (m) =>
                m.volumeRangeCorrelation,
        ],
        [
            "rolling6hReturnMeanPct",
            (m) =>
                m.rolling6hReturnMeanPct,
        ],
        [
            "rolling6hReturnStdPct",
            (m) =>
                m.rolling6hReturnStdPct,
        ],
        [
            "rolling12hReturnMeanPct",
            (m) =>
                m.rolling12hReturnMeanPct,
        ],
        [
            "rolling12hReturnStdPct",
            (m) =>
                m.rolling12hReturnStdPct,
        ],
        [
            "rolling24hReturnMeanPct",
            (m) =>
                m.rolling24hReturnMeanPct,
        ],
        [
            "rolling24hReturnStdPct",
            (m) =>
                m.rolling24hReturnStdPct,
        ],
        [
            "rolling72hReturnMeanPct",
            (m) =>
                m.rolling72hReturnMeanPct,
        ],
        [
            "rolling72hReturnStdPct",
            (m) =>
                m.rolling72hReturnStdPct,
        ],
        [
            "rolling168hReturnMeanPct",
            (m) =>
                m.rolling168hReturnMeanPct,
        ],
        [
            "rolling168hReturnStdPct",
            (m) =>
                m.rolling168hReturnStdPct,
        ],
        [
            "rolling24hVolatilityPct",
            (m) =>
                m.rolling24hVolatilityPct,
        ],
        [
            "rolling72hVolatilityPct",
            (m) =>
                m.rolling72hVolatilityPct,
        ],
        [
            "rolling168hVolatilityPct",
            (m) =>
                m.rolling168hVolatilityPct,
        ],
        [
            "rolling24hRangeMeanPct",
            (m) =>
                m.rolling24hRangeMeanPct,
        ],
        [
            "rolling72hRangeMeanPct",
            (m) =>
                m.rolling72hRangeMeanPct,
        ],
        [
            "rolling168hRangeMeanPct",
            (m) =>
                m.rolling168hRangeMeanPct,
        ],
        [
            "rolling24hEfficiencyMean",
            (m) =>
                m.rolling24hEfficiencyMean,
        ],
        [
            "rolling72hEfficiencyMean",
            (m) =>
                m.rolling72hEfficiencyMean,
        ],
        [
            "rolling168hEfficiencyMean",
            (m) =>
                m.rolling168hEfficiencyMean,
        ],
        [
            "rolling24hTrendSlopeMeanPct",
            (m) =>
                m.rolling24hTrendSlopeMeanPct,
        ],
        [
            "rolling72hTrendSlopeMeanPct",
            (m) =>
                m.rolling72hTrendSlopeMeanPct,
        ],
        [
            "rolling168hTrendSlopeMeanPct",
            (m) =>
                m.rolling168hTrendSlopeMeanPct,
        ],
    ];

    return features
        .map(
            ([feature, getter]) => {
                const values =
                    markets.map(
                        getter,
                    );

                return {
                    feature,
                    pearson:
                        pearson(
                            values,
                            profit,
                        ),
                    spearman:
                        spearman(
                            values,
                            profit,
                        ),
                    sampleCount:
                        markets.length,
                };
            },
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
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

function createCsv(
    markets: MarketBehaviour[],
): string {
    if (markets.length === 0) {
        return "";
    }

    const columns =
        Object.keys(
            markets[0],
        ) as Array<
            keyof MarketBehaviour
        >;

    function escape(
        value: unknown,
    ): string {
        const text =
            value === null ||
            value === undefined
                ? ""
                : String(value);

        return /[,"\n]/.test(
            text,
        )
            ? `"${text.replace(
                  /"/g,
                  '""',
              )}"`
            : text;
    }

    return [
        columns.join(","),
        ...markets.map(
            (market) =>
                columns
                    .map(
                        (column) =>
                            escape(
                                market[
                                    column
                                ],
                            ),
                    )
                    .join(","),
        ),
    ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
    const startedAt =
        Date.now();

    console.log(
        "=".repeat(60),
    );

    console.log(
        "August 2026 hourly market behaviour runner",
    );

    console.log(
        "=".repeat(60),
    );

    console.log();

    console.log(
        `Hourly data:  ${HOURLY_FILE}`,
    );

    console.log(
        `Strategy data: ${STRATEGY_FILE}`,
    );

    console.log();

    const hourlyPath =
        join(
            DATA_DIR,
            HOURLY_FILE,
        );

    const strategyPath =
        join(
            OUTPUT_DIR,
            STRATEGY_FILE,
        );

    console.log(
        `Reading ${HOURLY_FILE}...`,
    );

    const hourlyText =
        await readFile(
            hourlyPath,
            "utf8",
        );

    console.log(
        `Reading ${STRATEGY_FILE}...`,
    );

    const strategyText =
        await readFile(
            strategyPath,
            "utf8",
        );

    const hourlyData =
        JSON.parse(
            hourlyText,
        ) as HourlyData;

    const strategyData =
        JSON.parse(
            strategyText,
        ) as StrategyRoot;

    if (
        hourlyData.interval !==
        "1h"
    ) {
        throw new Error(
            `Expected hourly data, got interval "${hourlyData.interval}".`,
        );
    }

    if (
        !Array.isArray(
            hourlyData.markets,
        )
    ) {
        throw new Error(
            "Hourly data is missing markets[].",
        );
    }

    if (
        hourlyData.markets.length ===
        0
    ) {
        throw new Error(
            "Hourly data contains zero markets.",
        );
    }

    const strategyMarkets =
        loadStrategyMarkets(
            strategyData,
        );

    console.log();

    console.log(
        `Strategy market results: ${strategyMarkets.size}`,
    );

    console.log(
        `Hourly markets: ${hourlyData.markets.length}`,
    );

    let totalCandles = 0;
    let marketsWithCandles = 0;
    let marketsWithoutCandles = 0;
    let partialMarkets = 0;
    let fullCoverageMarkets = 0;

    for (
        const market of
            hourlyData.markets
    ) {
        const count =
            market.candles.length;

        totalCandles += count;

        if (count === 0) {
            marketsWithoutCandles++;
        } else {
            marketsWithCandles++;
        }

        if (
            count > 0 &&
            count <
                hourlyData.expectedCandleCount
        ) {
            partialMarkets++;
        }

        if (
            count ===
            hourlyData.expectedCandleCount
        ) {
            fullCoverageMarkets++;
        }
    }

    console.log(
        `Hourly candles: ${totalCandles.toLocaleString()}`,
    );

    console.log(
        `Markets with candles: ${marketsWithCandles}`,
    );

    console.log(
        `Markets without candles: ${marketsWithoutCandles}`,
    );

    console.log(
        `Partial markets: ${partialMarkets}`,
    );

    console.log(
        `Full-coverage markets: ${fullCoverageMarkets}`,
    );

    if (
        totalCandles === 0
    ) {
        throw new Error(
            "Zero hourly candles found.",
        );
    }

    console.log();
    console.log(
        "Calculating market behaviour...",
    );
    console.log();

    const results: MarketBehaviour[] =
        [];

    let unmatchedHourlyMarkets =
        0;

    for (
        let i = 0;
        i <
        hourlyData.markets.length;
        i++
    ) {
        const market =
            hourlyData.markets[i];

        if (
            market.candles.length ===
            0
        ) {
            continue;
        }

        const strategy =
            strategyMarkets.get(
                market.symbol,
            );

        if (!strategy) {
            unmatchedHourlyMarkets++;
            continue;
        }

        results.push(
            analyseMarket(
                market,
                strategy,
            ),
        );

        const processed =
            i + 1;

        if (
            processed % 25 ===
                0 ||
            processed ===
                hourlyData.markets.length
        ) {
            console.log(
                `  ${processed}/${hourlyData.markets.length} markets`,
            );
        }
    }

    const positive =
        results.filter(
            (market) =>
                market.strategyNetProfit >
                0,
        );

    const flat =
        results.filter(
            (market) =>
                market.strategyNetProfit ===
                0,
        );

    const negative =
        results.filter(
            (market) =>
                market.strategyNetProfit <
                0,
        );

    const positiveNetProfit =
        positive.reduce(
            (sum, market) =>
                sum +
                market.strategyNetProfit,
            0,
        );

    const negativeNetProfit =
        negative.reduce(
            (sum, market) =>
                sum +
                market.strategyNetProfit,
            0,
        );

    const correlations =
        buildCorrelations(
            results,
        );

    const output: Output = {
        generatedAt:
            new Date().toISOString(),

        experiment:
            "august_2026_hourly_market_behaviour",

        source: {
            hourlyFile:
                HOURLY_FILE,

            strategyFile:
                STRATEGY_FILE,

            interval:
                hourlyData.interval,

            period: {
                start:
                    hourlyData.startTimeIso,

                endExclusive:
                    hourlyData.endTimeExclusiveIso,
            },

            expectedCandleCount:
                hourlyData.expectedCandleCount,
        },

        summary: {
            hourlyMarkets:
                hourlyData.markets.length,

            marketsWithCandles,

            marketsWithoutCandles,

            partialMarkets,

            fullCoverageMarkets,

            matchedMarkets:
                results.length,

            unmatchedHourlyMarkets,

            positiveStrategyMarkets:
                positive.length,

            flatStrategyMarkets:
                flat.length,

            negativeStrategyMarkets:
                negative.length,

            positiveStrategyNetProfit:
                positiveNetProfit,

            negativeStrategyNetProfit:
                negativeNetProfit,
        },

        correlations,

        markets: results.sort(
            (a, b) =>
                b.strategyNetProfit -
                a.strategyNetProfit,
        ),
    };

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

    const jsonFilename =
        `august-market-behaviour-${timestamp}.json`;

    const csvFilename =
        `august-market-behaviour-${timestamp}.csv`;

    const jsonPath =
        join(
            OUTPUT_DIR,
            jsonFilename,
        );

    const csvPath =
        join(
            OUTPUT_DIR,
            csvFilename,
        );

    await writeFile(
        jsonPath,
        JSON.stringify(
            output,
            null,
            2,
        ),
        "utf8",
    );

    await writeFile(
        csvPath,
        createCsv(
            output.markets,
        ),
        "utf8",
    );

    console.log();
    console.log(
        "=".repeat(60),
    );
    console.log(
        "Results",
    );
    console.log(
        "=".repeat(60),
    );
    console.log();

    console.log(
        `Markets analysed: ${results.length}`,
    );

    console.log(
        `No strategy result: ${unmatchedHourlyMarkets}`,
    );

    console.log(
        `Positive strategy markets: ${positive.length}`,
    );

    console.log(
        `Flat strategy markets: ${flat.length}`,
    );

    console.log(
        `Negative strategy markets: ${negative.length}`,
    );

    console.log();

    console.log(
        `Positive strategy net profit: ${positiveNetProfit.toFixed(4)}`,
    );

    console.log(
        `Negative strategy net profit: ${negativeNetProfit.toFixed(4)}`,
    );

    console.log();
    console.log(
        "Top positive strategy markets:",
    );

    for (
        const market of
            positive.slice(0, 10)
    ) {
        console.log(
            `  ${market.symbol.padEnd(16)} ` +
            `${market.strategyNetProfit >= 0 ? "+" : ""}` +
            `${market.strategyNetProfit.toFixed(4)} ` +
            `August return=${market.totalReturnPct.toFixed(2)}%`,
        );
    }

    console.log();
    console.log(
        "Top negative strategy markets:",
    );

    for (
        const market of negative
            .slice()
            .sort(
                (a, b) =>
                    a.strategyNetProfit -
                    b.strategyNetProfit,
            )
            .slice(0, 10)
    ) {
        console.log(
            `  ${market.symbol.padEnd(16)} ` +
            `${market.strategyNetProfit.toFixed(4)} ` +
            `August return=${market.totalReturnPct.toFixed(2)}%`,
        );
    }

    console.log();
    console.log(
        "Strongest correlations with strategy net profit:",
    );

    for (
        const result of
            correlations.slice(
                0,
                15,
            )
    ) {
        console.log(
            `  ${result.feature.padEnd(38)} ` +
            `Spearman=${result.spearman.toFixed(4)} ` +
            `Pearson=${result.pearson.toFixed(4)}`,
        );
    }

    console.log();
    console.log(
        `JSON output: ${jsonPath}`,
    );

    console.log(
        `CSV output:  ${csvPath}`,
    );

    const elapsedSeconds =
        (Date.now() -
            startedAt) /
        1000;

    console.log(
        `Completed in ${elapsedSeconds.toFixed(1)} seconds.`,
    );
}

main().catch(
    (error: unknown) => {
        console.error();
        console.error(
            "Runner failed.",
        );

        if (
            error instanceof Error
        ) {
            console.error(
                error.message,
            );
        } else {
            console.error(
                error,
            );
        }

        process.exit(1);
    },
);