import fs from "fs";
import path from "path";

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawMarket {
  symbol: string;
  candles: Candle[];
}

interface RawDataset {
  markets: RawMarket[];
}

type Feature =
  | "return20"
  | "return50"
  | "slope20"
  | "slope50"
  | "drawdown20"
  | "drawdown50"
  | "volatility20"
  | "volatility50"
  | "efficiency20"
  | "efficiency50"
  | "acceleration";

interface Condition {
  feature: Feature;
  operator: "<=" | ">=";
  percentile: number;
  threshold: number;
}

interface HorizonResult {
  averageReturn: number;
  medianReturn: number;
  positiveRate: number;
  profitableRate: number;
  averageMfe: number;
  averageMae: number;
  medianMfe: number;
  medianMae: number;
}

interface CombinationResult {
  conditions: Condition[];
  observations: number;
  horizons: Record<string, HorizonResult>;
}

interface TradingResult {
  conditions: Condition[];
  opportunities: number;
  trades: number;
  totalNetReturn: number;
  averageNetReturn: number;
  medianNetReturn: number;
  winRate: number;
  profitableRate: number;
  maximumDrawdown: number;
}

interface FeatureValues {
  return20: number;
  return50: number;
  slope20: number;
  slope50: number;
  drawdown20: number;
  drawdown50: number;
  volatility20: number;
  volatility50: number;
  efficiency20: number;
  efficiency50: number;
  acceleration: number;
}

interface MarketFeatures {
  symbol: string;
  startIndex: number;
  count: number;
  values: Float32Array[];
}

const TOTAL_COST = 0.002;

const TRAIN_RATIO = 0.7;

const MIN_LOOKBACK = 50;
const MAX_FORWARD_MINUTES = 120;

const PERCENTILES = [20, 30, 40, 60, 70, 80];

const MIN_COMBINATION_OBSERVATIONS = 500;

const MAX_CONDITIONS = 2;

const TRADE_COOLDOWN_MINUTES = 60;

const HORIZONS = [5, 10, 20, 50, 120] as const;

const FEATURES: Feature[] = [
  "return20",
  "return50",
  "slope20",
  "slope50",
  "drawdown20",
  "drawdown50",
  "volatility20",
  "volatility50",
  "efficiency20",
  "efficiency50",
  "acceleration",
];

const FEATURE_INDEX = new Map<Feature, number>(
  FEATURES.map((feature, index) => [feature, index]),
);

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / values.length;
}

function percentile(
  values: number[],
  percentileValue: number,
): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate percentile of empty array");
  }

  const sorted = [...values].sort((a, b) => a - b);

  const index =
    (percentileValue / 100) * (sorted.length - 1);

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;

  return (
    sorted[lower] * (1 - weight) +
    sorted[upper] * weight
  );
}

function median(values: number[]): number {
  return percentile(values, 50);
}

function calculateSlope(prices: number[]): number {
  if (prices.length < 2) {
    return 0;
  }

  const n = prices.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i += 1) {
    const price = prices[i];

    sumX += i;
    sumY += price;
    sumXY += i * price;
    sumXX += i * i;
  }

  const denominator =
    n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  const slope =
    (n * sumXY - sumX * sumY) /
    denominator;

  const averagePrice = sumY / n;

  if (averagePrice === 0) {
    return 0;
  }

  return slope / averagePrice;
}

function calculateVolatility(
  prices: number[],
): number {
  if (prices.length < 2) {
    return 0;
  }

  let sumReturns = 0;
  let returnCount = 0;

  for (let i = 1; i < prices.length; i += 1) {
    const value =
      prices[i] / prices[i - 1] - 1;

    sumReturns += value;
    returnCount += 1;
  }

  const average =
    sumReturns / returnCount;

  let squaredDifference = 0;

  for (let i = 1; i < prices.length; i += 1) {
    const value =
      prices[i] / prices[i - 1] - 1;

    squaredDifference +=
      (value - average) ** 2;
  }

  return Math.sqrt(
    squaredDifference / returnCount,
  );
}

function calculateEfficiency(
  prices: number[],
): number {
  if (prices.length < 2) {
    return 0;
  }

  const netMove = Math.abs(
    prices[prices.length - 1] -
      prices[0],
  );

  let pathLength = 0;

  for (let i = 1; i < prices.length; i += 1) {
    pathLength += Math.abs(
      prices[i] - prices[i - 1],
    );
  }

  if (pathLength === 0) {
    return 0;
  }

  return netMove / pathLength;
}

function calculateDrawdown(
  prices: number[],
): number {
  if (prices.length === 0) {
    return 0;
  }

  let peak = prices[0];
  let maximumDrawdown = 0;

  for (const price of prices) {
    if (price > peak) {
      peak = price;
    }

    const drawdown =
      price / peak - 1;

    if (drawdown < maximumDrawdown) {
      maximumDrawdown = drawdown;
    }
  }

  return maximumDrawdown;
}

function calculateFeatures(
  market: RawMarket,
  index: number,
): FeatureValues | null {
  if (index < MIN_LOOKBACK) {
    return null;
  }

  const currentCandle =
    market.candles[index];

  if (!currentCandle) {
    return null;
  }

  const currentPrice =
    currentCandle.close;

  if (
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return null;
  }

  const prices20: number[] = [];
  const prices50: number[] = [];

  for (
    let i = index - 20;
    i <= index;
    i += 1
  ) {
    prices20.push(
      market.candles[i].close,
    );
  }

  for (
    let i = index - 50;
    i <= index;
    i += 1
  ) {
    prices50.push(
      market.candles[i].close,
    );
  }

  const return20 =
    currentPrice /
      market.candles[index - 20].close -
    1;

  const return50 =
    currentPrice /
      market.candles[index - 50].close -
    1;

  const slope20 =
    calculateSlope(prices20);

  const slope50 =
    calculateSlope(prices50);

  const drawdown20 =
    calculateDrawdown(prices20);

  const drawdown50 =
    calculateDrawdown(prices50);

  const volatility20 =
    calculateVolatility(prices20);

  const volatility50 =
    calculateVolatility(prices50);

  const efficiency20 =
    calculateEfficiency(prices20);

  const efficiency50 =
    calculateEfficiency(prices50);

  return {
    return20,
    return50,
    slope20,
    slope50,
    drawdown20,
    drawdown50,
    volatility20,
    volatility50,
    efficiency20,
    efficiency50,
    acceleration:
      slope20 - slope50,
  };
}

function getFeatureValue(
  values: FeatureValues,
  feature: Feature,
): number {
  return values[feature];
}

function calculateForwardResult(
  market: RawMarket,
  index: number,
  horizon: number,
): {
  returnValue: number;
  mfe: number;
  mae: number;
} | null {
  const entry =
    market.candles[index];

  const end =
    market.candles[index + horizon];

  if (!entry || !end) {
    return null;
  }

  const entryPrice = entry.close;

  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0
  ) {
    return null;
  }

  let maximumHigh = entryPrice;
  let minimumLow = entryPrice;

  for (
    let i = index + 1;
    i <= index + horizon;
    i += 1
  ) {
    const candle =
      market.candles[i];

    maximumHigh = Math.max(
      maximumHigh,
      candle.high,
    );

    minimumLow = Math.min(
      minimumLow,
      candle.low,
    );
  }

  return {
    returnValue:
      end.close / entryPrice - 1,

    mfe:
      maximumHigh / entryPrice - 1,

    mae:
      minimumLow / entryPrice - 1,
  };
}

/**
 * Builds compact feature arrays for the discovery period.
 *
 * Each market gets one Float32Array per feature.
 * This avoids millions of JavaScript Observation objects.
 */
function buildDiscoveryFeatures(
  dataset: RawDataset,
  splitTimestamp: number,
): MarketFeatures[] {
  const result: MarketFeatures[] = [];

  for (const market of dataset.markets) {
    const startIndex =
      MIN_LOOKBACK;

    const endIndex =
      market.candles.length -
      MAX_FORWARD_MINUTES;

    const count =
      Math.max(
        0,
        Math.min(
          endIndex,
          market.candles.length,
        ) -
          startIndex,
      );

    const arrays =
      FEATURES.map(
        () => new Float32Array(count),
      );

    let written = 0;

    for (
      let index = startIndex;
      index < endIndex;
      index += 1
    ) {
      const timestamp =
        market.candles[index].openTime;

      if (timestamp >= splitTimestamp) {
        break;
      }

      const features =
        calculateFeatures(
          market,
          index,
        );

      if (!features) {
        continue;
      }

      for (
        let featureIndex = 0;
        featureIndex < FEATURES.length;
        featureIndex += 1
      ) {
        arrays[featureIndex][written] =
          getFeatureValue(
            features,
            FEATURES[featureIndex],
          );
      }

      written += 1;
    }

    if (written > 0) {
      result.push({
        symbol: market.symbol,
        startIndex,
        count: written,
        values: arrays.map(
          (array) =>
            array.slice(0, written),
        ),
      });
    }
  }

  return result;
}

function collectDiscoveryFeatureValues(
  marketFeatures: MarketFeatures[],
): number[][] {
  const values =
    FEATURES.map(() => [] as number[]);

  for (const market of marketFeatures) {
    for (
      let index = 0;
      index < market.count;
      index += 1
    ) {
      for (
        let featureIndex = 0;
        featureIndex < FEATURES.length;
        featureIndex += 1
      ) {
        values[featureIndex].push(
          market.values[featureIndex][index],
        );
      }
    }
  }

  return values;
}

function createConditions(
  featureValues: number[][],
): Condition[] {
  const conditions: Condition[] = [];

  for (
    let featureIndex = 0;
    featureIndex < FEATURES.length;
    featureIndex += 1
  ) {
    const feature =
      FEATURES[featureIndex];

    const values =
      featureValues[featureIndex];

    for (const percentileValue of PERCENTILES) {
      const threshold =
        percentile(
          values,
          percentileValue,
        );

      conditions.push({
        feature,
        operator: "<=",
        percentile: percentileValue,
        threshold,
      });

      conditions.push({
        feature,
        operator: ">=",
        percentile: percentileValue,
        threshold,
      });
    }
  }

  return conditions;
}

function conditionMatches(
  values: FeatureValues,
  condition: Condition,
): boolean {
  const value =
    getFeatureValue(
      values,
      condition.feature,
    );

  if (condition.operator === "<=") {
    return value <= condition.threshold;
  }

  return value >= condition.threshold;
}

function conditionsMatch(
  values: FeatureValues,
  conditions: Condition[],
): boolean {
  return conditions.every(
    (condition) =>
      conditionMatches(
        values,
        condition,
      ),
  );
}

function generateCombinations(
  conditions: Condition[],
): Condition[][] {
  const combinations: Condition[][] = [];

  for (const condition of conditions) {
    combinations.push([condition]);
  }

  if (MAX_CONDITIONS < 2) {
    return combinations;
  }

  for (
    let i = 0;
    i < conditions.length;
    i += 1
  ) {
    for (
      let j = i + 1;
      j < conditions.length;
      j += 1
    ) {
      const first = conditions[i];
      const second = conditions[j];

      if (
        first.feature ===
        second.feature
      ) {
        continue;
      }

      combinations.push([
        first,
        second,
      ]);
    }
  }

  return combinations;
}

function calculateHorizonResult(
  returns: number[],
  mfes: number[],
  maes: number[],
): HorizonResult {
  return {
    averageReturn:
      mean(returns),

    medianReturn:
      median(returns),

    positiveRate:
      returns.filter(
        (value) => value > 0,
      ).length /
      returns.length,

    profitableRate:
      returns.filter(
        (value) =>
          value > TOTAL_COST,
      ).length /
      returns.length,

    averageMfe:
      mean(mfes),

    averageMae:
      mean(maes),

    medianMfe:
      median(mfes),

    medianMae:
      median(maes),
  };
}

/**
 * Evaluates one candidate by scanning the compact
 * discovery feature arrays and the original candles.
 *
 * No forward-result Map is created.
 */
function evaluateDiscoveryCombination(
  dataset: RawDataset,
  marketFeatures: MarketFeatures[],
  conditions: Condition[],
): CombinationResult | null {
  const markets = new Map(
    dataset.markets.map(
      (market) => [
        market.symbol,
        market,
      ],
    ),
  );

  const horizonReturns =
    new Map<number, number[]>();

  const horizonMfes =
    new Map<number, number[]>();

  const horizonMaes =
    new Map<number, number[]>();

  for (const horizon of HORIZONS) {
    horizonReturns.set(
      horizon,
      [],
    );

    horizonMfes.set(
      horizon,
      [],
    );

    horizonMaes.set(
      horizon,
      [],
    );
  }

  let matched = 0;

  for (const featureMarket of marketFeatures) {
    const market =
      markets.get(featureMarket.symbol);

    if (!market) {
      continue;
    }

    for (
      let offset = 0;
      offset < featureMarket.count;
      offset += 1
    ) {
      let matches = true;

      for (const condition of conditions) {
        const featureIndex =
          FEATURE_INDEX.get(
            condition.feature,
          );

        if (
          featureIndex === undefined
        ) {
          matches = false;
          break;
        }

        const value =
          featureMarket.values[
            featureIndex
          ][offset];

        if (
          condition.operator === "<=" &&
          value > condition.threshold
        ) {
          matches = false;
          break;
        }

        if (
          condition.operator === ">=" &&
          value < condition.threshold
        ) {
          matches = false;
          break;
        }
      }

      if (!matches) {
        continue;
      }

      const candleIndex =
        featureMarket.startIndex +
        offset;

      matched += 1;

      for (const horizon of HORIZONS) {
        const forward =
          calculateForwardResult(
            market,
            candleIndex,
            horizon,
          );

        if (!forward) {
          matched -= 1;
          break;
        }

        horizonReturns
          .get(horizon)!
          .push(
            forward.returnValue,
          );

        horizonMfes
          .get(horizon)!
          .push(
            forward.mfe,
          );

        horizonMaes
          .get(horizon)!
          .push(
            forward.mae,
          );
      }
    }
  }

  if (
    matched <
    MIN_COMBINATION_OBSERVATIONS
  ) {
    return null;
  }

  const horizons:
    Record<string, HorizonResult> = {};

  for (const horizon of HORIZONS) {
    horizons[String(horizon)] =
      calculateHorizonResult(
        horizonReturns.get(horizon)!,
        horizonMfes.get(horizon)!,
        horizonMaes.get(horizon)!,
      );
  }

  return {
    conditions,
    observations: matched,
    horizons,
  };
}

function conditionDescription(
  condition: Condition,
): string {
  return `${condition.feature} ${condition.operator} P${condition.percentile}`;
}

function combinationDescription(
  conditions: Condition[],
): string {
  return conditions
    .map(conditionDescription)
    .join(" AND ");
}

function discoverBestSignals(
  dataset: RawDataset,
  marketFeatures: MarketFeatures[],
  combinations: Condition[][],
): CombinationResult[] {
  const results: CombinationResult[] = [];

  let processed = 0;

  for (const combination of combinations) {
    const result =
      evaluateDiscoveryCombination(
        dataset,
        marketFeatures,
        combination,
      );

    if (result) {
      results.push(result);
    }

    processed += 1;

    if (processed % 500 === 0) {
      console.log(
        `Discovery progress: ${processed}/${combinations.length}`,
      );
    }
  }

  return results.sort(
    (a, b) =>
      b.horizons["20"].averageReturn -
      a.horizons["20"].averageReturn,
  );
}

function selectSignals(
  results: CombinationResult[],
): CombinationResult[] {
  return results.slice(0, 10);
}

/**
 * Test frozen conditions against the unseen period.
 *
 * Features are calculated only when needed, so the complete
 * test-period observation set is never held in memory.
 */
function evaluateOutOfSample(
  dataset: RawDataset,
  conditions: Condition[],
  splitTimestamp: number,
): CombinationResult | null {
  const horizonReturns =
    new Map<number, number[]>();

  const horizonMfes =
    new Map<number, number[]>();

  const horizonMaes =
    new Map<number, number[]>();

  for (const horizon of HORIZONS) {
    horizonReturns.set(
      horizon,
      [],
    );

    horizonMfes.set(
      horizon,
      [],
    );

    horizonMaes.set(
      horizon,
      [],
    );
  }

  let matched = 0;

  for (const market of dataset.markets) {
    const firstIndex =
      MIN_LOOKBACK;

    const lastIndex =
      market.candles.length -
      MAX_FORWARD_MINUTES;

    for (
      let index = firstIndex;
      index < lastIndex;
      index += 1
    ) {
      if (
        market.candles[index]
          .openTime < splitTimestamp
      ) {
        continue;
      }

      const features =
        calculateFeatures(
          market,
          index,
        );

      if (
        !features ||
        !conditionsMatch(
          features,
          conditions,
        )
      ) {
        continue;
      }

      let valid = true;

      for (const horizon of HORIZONS) {
        const forward =
          calculateForwardResult(
            market,
            index,
            horizon,
          );

        if (!forward) {
          valid = false;
          break;
        }

        horizonReturns
          .get(horizon)!
          .push(
            forward.returnValue,
          );

        horizonMfes
          .get(horizon)!
          .push(forward.mfe);

        horizonMaes
          .get(horizon)!
          .push(forward.mae);
      }

      if (valid) {
        matched += 1;
      }
    }
  }

  if (
    matched <
    MIN_COMBINATION_OBSERVATIONS
  ) {
    return null;
  }

  const horizons:
    Record<string, HorizonResult> = {};

  for (const horizon of HORIZONS) {
    horizons[String(horizon)] =
      calculateHorizonResult(
        horizonReturns.get(horizon)!,
        horizonMfes.get(horizon)!,
        horizonMaes.get(horizon)!,
      );
  }

  return {
    conditions,
    observations: matched,
    horizons,
  };
}

function evaluateTradingStyle(
  dataset: RawDataset,
  conditions: Condition[],
  splitTimestamp: number,
  horizon: number,
): TradingResult {
  const opportunities: Array<{
    symbol: string;
    index: number;
    timestamp: number;
    netReturn: number;
  }> = [];

  for (const market of dataset.markets) {
    const lastIndex =
      market.candles.length -
      MAX_FORWARD_MINUTES;

    for (
      let index = MIN_LOOKBACK;
      index < lastIndex;
      index += 1
    ) {
      const timestamp =
        market.candles[index].openTime;

      if (timestamp < splitTimestamp) {
        continue;
      }

      const features =
        calculateFeatures(
          market,
          index,
        );

      if (
        !features ||
        !conditionsMatch(
          features,
          conditions,
        )
      ) {
        continue;
      }

      const forward =
        calculateForwardResult(
          market,
          index,
          horizon,
        );

      if (!forward) {
        continue;
      }

      opportunities.push({
        symbol: market.symbol,
        index,
        timestamp,
        netReturn:
          forward.returnValue -
          TOTAL_COST,
      });
    }
  }

  opportunities.sort(
    (a, b) =>
      a.timestamp - b.timestamp,
  );

  const lastTradeBySymbol =
    new Map<string, number>();

  const returns: number[] = [];

  for (const opportunity of opportunities) {
    const lastTrade =
      lastTradeBySymbol.get(
        opportunity.symbol,
      );

    if (
      lastTrade !== undefined &&
      opportunity.timestamp -
        lastTrade <
        TRADE_COOLDOWN_MINUTES *
          60_000
    ) {
      continue;
    }

    returns.push(
      opportunity.netReturn,
    );

    lastTradeBySymbol.set(
      opportunity.symbol,
      opportunity.timestamp,
    );
  }

  let equity = 1;
  let peak = 1;
  let maximumDrawdown = 0;

  for (const tradeReturn of returns) {
    equity *= 1 + tradeReturn;

    peak = Math.max(
      peak,
      equity,
    );

    const drawdown =
      equity / peak - 1;

    maximumDrawdown =
      Math.min(
        maximumDrawdown,
        drawdown,
      );
  }

  return {
    conditions,

    opportunities:
      opportunities.length,

    trades:
      returns.length,

    totalNetReturn:
      equity - 1,

    averageNetReturn:
      mean(returns),

    medianNetReturn:
      returns.length > 0
        ? median(returns)
        : 0,

    winRate:
      returns.length > 0
        ? returns.filter(
            (value) => value > 0,
          ).length /
          returns.length
        : 0,

    profitableRate:
      returns.length > 0
        ? returns.filter(
            (value) =>
              value > 0,
          ).length /
          returns.length
        : 0,

    maximumDrawdown,
  };
}

function printSignal(
  result: CombinationResult,
  prefix: string,
): void {
  console.log(
    `\n${prefix}: ${combinationDescription(
      result.conditions,
    )}`,
  );

  console.log(
    `Observations: ${result.observations}`,
  );

  for (const horizon of HORIZONS) {
    const data =
      result.horizons[
        String(horizon)
      ];

    console.log(
      [
        `${horizon}m`,
        `avg=${formatPercent(
          data.averageReturn,
        )}`,
        `median=${formatPercent(
          data.medianReturn,
        )}`,
        `positive=${formatPercent(
          data.positiveRate,
        )}`,
        `>cost=${formatPercent(
          data.profitableRate,
        )}`,
        `MFE=${formatPercent(
          data.averageMfe,
        )}`,
        `MAE=${formatPercent(
          data.averageMae,
        )}`,
      ].join(" | "),
    );
  }
}

function printTradingResult(
  result: TradingResult,
  prefix: string,
): void {
  console.log(
    `\n${prefix}: ${combinationDescription(
      result.conditions,
    )}`,
  );

  console.log(
    [
      `opportunities=${result.opportunities}`,
      `trades=${result.trades}`,
      `totalNet=${formatPercent(
        result.totalNetReturn,
      )}`,
      `averageNet=${formatPercent(
        result.averageNetReturn,
      )}`,
      `medianNet=${formatPercent(
        result.medianNetReturn,
      )}`,
      `winRate=${formatPercent(
        result.winRate,
      )}`,
      `maxDrawdown=${formatPercent(
        result.maximumDrawdown,
      )}`,
    ].join(" | "),
  );
}

function formatPercent(
  value: number,
): string {
  return `${(
    value * 100
  ).toFixed(3)}%`;
}

function determineSplitTimestamp(
  dataset: RawDataset,
): number {
  const firstMarket =
    dataset.markets[0];

  if (!firstMarket) {
    throw new Error(
      "Dataset contains no markets",
    );
  }

  const firstIndex =
    MIN_LOOKBACK;

  const lastIndex =
    firstMarket.candles.length -
    MAX_FORWARD_MINUTES -
    1;

  if (lastIndex <= firstIndex) {
    throw new Error(
      "Dataset does not contain enough candles",
    );
  }

  const usableCount =
    lastIndex - firstIndex;

  const splitIndex =
    firstIndex +
    Math.floor(
      usableCount * TRAIN_RATIO,
    );

  return firstMarket.candles[
    splitIndex
  ].openTime;
}

function resolveSourcePath(): string {
  const argumentPath =
    process.argv[2];

  if (argumentPath) {
    if (
      !fs.existsSync(argumentPath)
    ) {
      throw new Error(
        `Input file does not exist: ${argumentPath}`,
      );
    }

    return path.resolve(
      argumentPath,
    );
  }

  const outputDirectory =
    path.join(
      process.cwd(),
      "server",
      "research-output",
    );

  const files = fs
    .readdirSync(outputDirectory)
    .filter(
      (file) =>
        file.startsWith(
          "ema-data-",
        ) &&
        file.endsWith(".json"),
    )
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No ema-data JSON files found in ${outputDirectory}`,
    );
  }

  return path.join(
    outputDirectory,
    files[files.length - 1],
  );
}

function main(): void {
  const sourcePath =
    resolveSourcePath();

  const sourceFile =
    path.basename(sourcePath);

  console.log(
    `Loading ${sourceFile}`,
  );

  const dataset =
    JSON.parse(
      fs.readFileSync(
        sourcePath,
        "utf8",
      ),
    ) as RawDataset;

  console.log(
    `Markets in dataset: ${dataset.markets.length}`,
  );

  const splitTimestamp =
    determineSplitTimestamp(
      dataset,
    );

  console.log(
    `Split: ${new Date(
      splitTimestamp,
    ).toISOString()}`,
  );

  console.log(
    "\nBuilding compact discovery feature arrays...",
  );

  const discoveryFeatures =
    buildDiscoveryFeatures(
      dataset,
      splitTimestamp,
    );

  const discoveryObservationCount =
    discoveryFeatures.reduce(
      (total, market) =>
        total + market.count,
      0,
    );

  console.log(
    `Discovery observations: ${discoveryObservationCount}`,
  );

  console.log(
    "Calculating discovery percentiles...",
  );

  const featureValues =
    collectDiscoveryFeatureValues(
      discoveryFeatures,
    );

  const conditions =
    createConditions(
      featureValues,
    );

  /*
   * Release the large temporary percentile
   * value arrays before candidate evaluation.
   */
  for (
    let i = 0;
    i < featureValues.length;
    i += 1
  ) {
    featureValues[i].length = 0;
  }

  console.log(
    `Discovery conditions: ${conditions.length}`,
  );

  const combinations =
    generateCombinations(
      conditions,
    );

  console.log(
    `Discovery combinations: ${combinations.length}`,
  );

  console.log(
    "\n================ DISCOVERY ================",
  );

  const discoveryResults =
    discoverBestSignals(
      dataset,
      discoveryFeatures,
      combinations,
    );

  console.log(
    `\nQualifying discovery signals: ${discoveryResults.length}`,
  );

  const selectedSignals =
    selectSignals(
      discoveryResults,
    );

  console.log(
    "\n================ SELECTED DISCOVERY SIGNALS ================",
  );

  selectedSignals.forEach(
    (signal, index) => {
      printSignal(
        signal,
        `Signal ${index + 1}`,
      );
    },
  );

  /*
   * The discovery feature arrays are no longer
   * needed. Allow them to be garbage-collected
   * before the out-of-sample pass.
   */
  discoveryFeatures.length = 0;

  console.log(
    "\n================ OUT-OF-SAMPLE RESULTS ================",
  );

  const testResults:
    CombinationResult[] = [];

  selectedSignals.forEach(
    (signal, index) => {
      const result =
        evaluateOutOfSample(
          dataset,
          signal.conditions,
          splitTimestamp,
        );

      if (!result) {
        console.log(
          `Signal ${index + 1}: fewer than ${MIN_COMBINATION_OBSERVATIONS} test observations`,
        );
        return;
      }

      testResults.push(result);

      printSignal(
        result,
        `Signal ${index + 1}`,
      );
    },
  );

  console.log(
    "\n================ TRADING-STYLE TEST ================",
  );

  const tradingResults =
    testResults.map(
      (result) =>
        evaluateTradingStyle(
          dataset,
          result.conditions,
          splitTimestamp,
          20,
        ),
    );

  tradingResults.forEach(
    (result, index) => {
      printTradingResult(
        result,
        `Signal ${index + 1}`,
      );
    },
  );

  const timestamps =
    dataset.markets
      .flatMap(
        (market) =>
          market.candles.length > 0
            ? [
                market.candles[
                  MIN_LOOKBACK
                ].openTime,
                market.candles[
                  market.candles.length -
                    MAX_FORWARD_MINUTES -
                    1
                ].openTime,
              ]
            : [],
      )
      .sort(
        (a, b) => a - b,
      );

  const timestamp =
    Date.now();

  const output = {
    generatedAt:
      new Date(
        timestamp,
      ).toISOString(),

    sourceFile,

    markets:
      dataset.markets.length,

    discoveryObservations:
      discoveryObservationCount,

    testObservations:
      testResults.reduce(
        (total, result) =>
          total +
          result.observations,
        0,
      ),

    discoveryStart:
      timestamps.length > 0
        ? new Date(
            timestamps[0],
          ).toISOString()
        : null,

    discoveryEnd:
      new Date(
        splitTimestamp,
      ).toISOString(),

    testStart:
      new Date(
        splitTimestamp,
      ).toISOString(),

    testEnd:
      timestamps.length > 0
        ? new Date(
            timestamps[
              timestamps.length - 1
            ],
          ).toISOString()
        : null,

    trainRatio:
      TRAIN_RATIO,

    totalCost:
      TOTAL_COST,

    minCombinationObservations:
      MIN_COMBINATION_OBSERVATIONS,

    maxConditions:
      MAX_CONDITIONS,

    tradeCooldownMinutes:
      TRADE_COOLDOWN_MINUTES,

    horizons:
      HORIZONS,

    selectedSignals:
      selectedSignals.map(
        (signal) => ({
          conditions:
            signal.conditions,

          discovery:
            signal,
        }),
      ),

    outOfSample:
      testResults,

    tradingStyle:
      tradingResults,
  };

  const outputDirectory =
    path.join(
      process.cwd(),
      "server",
      "research-output",
    );

  const outputPath =
    path.join(
      outputDirectory,
      `out-of-sample-analysis-${timestamp}.json`,
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  console.log(
    `\nWritten: ${outputPath}`,
  );
}

main();
