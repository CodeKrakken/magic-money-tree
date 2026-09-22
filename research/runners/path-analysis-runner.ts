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

interface FeatureValues {
  slope20: number;
  slope50: number;
  acceleration: number;
}

interface SignalObservation {
  symbol: string;
  index: number;
  timestamp: number;
  entryPrice: number;
}

interface HorizonMetrics {
  observations: number;
  averageReturn: number;
  medianReturn: number;
  positiveRate: number;
  returnAboveCost: Record<string, number>;
  averageMfe: number;
  medianMfe: number;
  averageMae: number;
  medianMae: number;
}

interface ThresholdTiming {
  threshold: number;
  reached: number;
  reachedRate: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
}

interface RecoveryBranch {
  threshold: number;
  withinMinutes: number;
  observations: number;
  averageReturnAfter20m: number;
  medianReturnAfter20m: number;
  averageReturnAfter50m: number;
  medianReturnAfter50m: number;
  averageMfeAfterConfirmation: number;
  averageMaeAfterConfirmation: number;
}

interface FailureBranch {
  threshold: number;
  withinMinutes: number;
  observations: number;
  averageReturnAfter20m: number;
  medianReturnAfter20m: number;
  averageReturnAfter50m: number;
  medianReturnAfter50m: number;
}

interface CostSensitivity {
  cost: number;
  observations: number;
  averageNetReturn: number;
  medianNetReturn: number;
  profitableRate: number;
  totalSimpleReturn: number;
}

interface PeriodAnalysis {
  start: string | null;
  end: string | null;
  observations: number;
  horizons: Record<string, HorizonMetrics>;
  upsideThresholds: ThresholdTiming[];
  downsideThresholds: ThresholdTiming[];
  recoveryBranches: RecoveryBranch[];
  failureBranches: FailureBranch[];
  costSensitivity: CostSensitivity[];
}

interface Output {
  generatedAt: string;
  sourceFile: string;

  signal: {
    conditions: Array<{
      feature: string;
      operator: string;
      percentile: number;
      threshold: number;
    }>;
  };

  horizons: number[];

  upsideThresholds: number[];
  downsideThresholds: number[];

  recoveryWindows: number[];

  costs: number[];

  discovery: PeriodAnalysis;
  outOfSample: PeriodAnalysis;
}

const TRAIN_RATIO = 0.7;

const MIN_LOOKBACK = 50;

const HORIZONS = [
  5,
  10,
  20,
  30,
  50,
  75,
  120,
];

const UPSIDE_THRESHOLDS = [
  0.001,
  0.002,
  0.003,
  0.005,
  0.0075,
  0.01,
];

const DOWNSIDE_THRESHOLDS = [
  0.001,
  0.002,
  0.003,
  0.005,
];

const RECOVERY_WINDOWS = [
  5,
  10,
  20,
];

const COSTS = [
  0,
  0.0005,
  0.001,
  0.0015,
  0.002,
  0.0025,
  0.003,
];

const SIGNAL = {
  slope20: -0.00014247403014451264,
  acceleration: 0.0001391412049997598,
};

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

function percentile(
  values: number[],
  percentileValue: number,
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const index =
    (percentileValue / 100) *
    (sorted.length - 1);

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

function calculateSlope(
  prices: number[],
): number {
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

  const averagePrice =
    sumY / n;

  if (averagePrice === 0) {
    return 0;
  }

  return slope / averagePrice;
}

function calculateFeatures(
  market: RawMarket,
  index: number,
): FeatureValues | null {
  if (index < MIN_LOOKBACK) {
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

  const slope20 =
    calculateSlope(prices20);

  const slope50 =
    calculateSlope(prices50);

  return {
    slope20,
    slope50,
    acceleration:
      slope20 - slope50,
  };
}

function matchesSignal(
  features: FeatureValues,
): boolean {
  return (
    features.slope20 <=
      SIGNAL.slope20 &&
    features.acceleration >=
      SIGNAL.acceleration
  );
}

function findSplitTimestamp(
  dataset: RawDataset,
): number {
  const timestamps: number[] = [];

  for (const market of dataset.markets) {
    for (const candle of market.candles) {
      timestamps.push(candle.openTime);
    }
  }

  timestamps.sort(
    (a, b) => a - b,
  );

  const unique =
    Array.from(
      new Set(timestamps),
    );

  const splitIndex = Math.floor(
    unique.length * TRAIN_RATIO,
  );

  return unique[splitIndex];
}

function isoOrNull(
  timestamp: number | null,
): string | null {
  if (timestamp === null) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function getForwardReturn(
  market: RawMarket,
  index: number,
  minutes: number,
): number | null {
  const futureIndex =
    index + minutes;

  if (
    futureIndex >=
    market.candles.length
  ) {
    return null;
  }

  const entry =
    market.candles[index].close;

  const future =
    market.candles[futureIndex].close;

  if (
    entry <= 0 ||
    !Number.isFinite(entry) ||
    !Number.isFinite(future)
  ) {
    return null;
  }

  return future / entry - 1;
}

function getPathMetrics(
  market: RawMarket,
  index: number,
  minutes: number,
): {
  returnValue: number;
  mfe: number;
  mae: number;
} | null {
  const endIndex = Math.min(
    index + minutes,
    market.candles.length - 1,
  );

  if (endIndex <= index) {
    return null;
  }

  const entryPrice =
    market.candles[index].close;

  let maximumHigh =
    entryPrice;

  let minimumLow =
    entryPrice;

  for (
    let i = index + 1;
    i <= endIndex;
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

  const finalPrice =
    market.candles[endIndex].close;

  return {
    returnValue:
      finalPrice / entryPrice - 1,

    mfe:
      maximumHigh / entryPrice - 1,

    mae:
      minimumLow / entryPrice - 1,
  };
}

function findThresholdTime(
  market: RawMarket,
  index: number,
  threshold: number,
  direction: "up" | "down",
  maxMinutes: number,
): number | null {
  const entryPrice =
    market.candles[index].close;

  const targetPrice =
    direction === "up"
      ? entryPrice * (1 + threshold)
      : entryPrice * (1 - threshold);

  const endIndex = Math.min(
    index + maxMinutes,
    market.candles.length - 1,
  );

  for (
    let i = index + 1;
    i <= endIndex;
    i += 1
  ) {
    const candle =
      market.candles[i];

    const reached =
      direction === "up"
        ? candle.high >= targetPrice
        : candle.low <= targetPrice;

    if (reached) {
      return i - index;
    }
  }

  return null;
}

function collectSignals(
  market: RawMarket,
  startTimestamp: number,
  endTimestamp: number,
): SignalObservation[] {
  const signals: SignalObservation[] = [];

  /*
   * We need enough future data for the 120-minute
   * path analysis.
   */
  const lastUsableIndex =
    market.candles.length -
    Math.max(...HORIZONS);

  for (
    let index = MIN_LOOKBACK;
    index <= lastUsableIndex;
    index += 1
  ) {
    const candle =
      market.candles[index];

    if (
      candle.openTime <
      startTimestamp
    ) {
      continue;
    }

    if (
      candle.openTime >=
      endTimestamp
    ) {
      break;
    }

    const features =
      calculateFeatures(
        market,
        index,
      );

    if (
      !features ||
      !matchesSignal(features)
    ) {
      continue;
    }

    signals.push({
      symbol: market.symbol,
      index,
      timestamp: candle.openTime,
      entryPrice: candle.close,
    });
  }

  return signals;
}

function analyseHorizons(
  signals: Array<{
    market: RawMarket;
    signal: SignalObservation;
  }>,
): Record<string, HorizonMetrics> {
  const output:
    Record<string, HorizonMetrics> =
    {};

  for (const horizon of HORIZONS) {
    const returns: number[] = [];
    const mfes: number[] = [];
    const maes: number[] = [];

    for (const item of signals) {
      const metrics =
        getPathMetrics(
          item.market,
          item.signal.index,
          horizon,
        );

      if (!metrics) {
        continue;
      }

      returns.push(
        metrics.returnValue,
      );

      mfes.push(metrics.mfe);
      maes.push(metrics.mae);
    }

    const returnAboveCost:
      Record<string, number> =
      {};

    for (const cost of COSTS) {
      returnAboveCost[
        cost.toString()
      ] =
        returns.length === 0
          ? 0
          : returns.filter(
              (value) =>
                value > cost,
            ).length /
            returns.length;
    }

    output[
      horizon.toString()
    ] = {
      observations:
        returns.length,

      averageReturn:
        mean(returns),

      medianReturn:
        median(returns),

      positiveRate:
        returns.length === 0
          ? 0
          : returns.filter(
              (value) =>
                value > 0,
            ).length /
            returns.length,

      returnAboveCost,

      averageMfe:
        mean(mfes),

      medianMfe:
        median(mfes),

      averageMae:
        mean(maes),

      medianMae:
        median(maes),
    };
  }

  return output;
}

function analyseThresholds(
  signals: Array<{
    market: RawMarket;
    signal: SignalObservation;
  }>,
  thresholds: number[],
  direction: "up" | "down",
): ThresholdTiming[] {
  const maxMinutes =
    Math.max(...HORIZONS);

  return thresholds.map(
    (threshold) => {
      const times: number[] = [];

      for (const item of signals) {
        const time =
          findThresholdTime(
            item.market,
            item.signal.index,
            threshold,
            direction,
            maxMinutes,
          );

        if (time !== null) {
          times.push(time);
        }
      }

      return {
        threshold,
        reached: times.length,

        reachedRate:
          signals.length === 0
            ? 0
            : times.length /
              signals.length,

        averageMinutes:
          times.length === 0
            ? null
            : mean(times),

        medianMinutes:
          times.length === 0
            ? null
            : median(times),
      };
    },
  );
}

function analyseRecoveryBranches(
  signals: Array<{
    market: RawMarket;
    signal: SignalObservation;
  }>,
): RecoveryBranch[] {
  const branches: RecoveryBranch[] =
    [];

  for (const threshold of UPSIDE_THRESHOLDS) {
    for (const withinMinutes of RECOVERY_WINDOWS) {
      const returns20: number[] = [];
      const returns50: number[] = [];
      const mfes: number[] = [];
      const maes: number[] = [];

      for (const item of signals) {
        const confirmationTime =
          findThresholdTime(
            item.market,
            item.signal.index,
            threshold,
            "up",
            withinMinutes,
          );

        if (confirmationTime === null) {
          continue;
        }

        const confirmationIndex =
          item.signal.index +
          confirmationTime;

        const metrics20 =
          getPathMetrics(
            item.market,
            confirmationIndex,
            20,
          );

        const metrics50 =
          getPathMetrics(
            item.market,
            confirmationIndex,
            50,
          );

        if (!metrics20) {
          continue;
        }

        returns20.push(
          metrics20.returnValue,
        );

        if (metrics50) {
          returns50.push(
            metrics50.returnValue,
          );

          mfes.push(
            metrics50.mfe,
          );

          maes.push(
            metrics50.mae,
          );
        }
      }

      branches.push({
        threshold,
        withinMinutes,

        observations:
          returns20.length,

        averageReturnAfter20m:
          mean(returns20),

        medianReturnAfter20m:
          median(returns20),

        averageReturnAfter50m:
          mean(returns50),

        medianReturnAfter50m:
          median(returns50),

        averageMfeAfterConfirmation:
          mean(mfes),

        averageMaeAfterConfirmation:
          mean(maes),
      });
    }
  }

  return branches;
}

function analyseFailureBranches(
  signals: Array<{
    market: RawMarket;
    signal: SignalObservation;
  }>,
): FailureBranch[] {
  const branches: FailureBranch[] =
    [];

  for (const threshold of UPSIDE_THRESHOLDS) {
    for (const withinMinutes of RECOVERY_WINDOWS) {
      const returns20: number[] = [];
      const returns50: number[] = [];

      for (const item of signals) {
        const confirmationTime =
          findThresholdTime(
            item.market,
            item.signal.index,
            threshold,
            "up",
            withinMinutes,
          );

        /*
         * No recovery within the window.
         */
        if (confirmationTime !== null) {
          continue;
        }

        const metrics20 =
          getPathMetrics(
            item.market,
            item.signal.index,
            20,
          );

        const metrics50 =
          getPathMetrics(
            item.market,
            item.signal.index,
            50,
          );

        if (metrics20) {
          returns20.push(
            metrics20.returnValue,
          );
        }

        if (metrics50) {
          returns50.push(
            metrics50.returnValue,
          );
        }
      }

      branches.push({
        threshold,
        withinMinutes,

        observations:
          returns20.length,

        averageReturnAfter20m:
          mean(returns20),

        medianReturnAfter20m:
          median(returns20),

        averageReturnAfter50m:
          mean(returns50),

        medianReturnAfter50m:
          median(returns50),
      });
    }
  }

  return branches;
}

function analyseCostSensitivity(
  signals: Array<{
    market: RawMarket;
    signal: SignalObservation;
  }>,
): CostSensitivity[] {
  /*
   * Use the 20-minute and 50-minute horizons because
   * those are the horizons most relevant to the previous
   * exit research.
   */
  const returns: number[] = [];

  for (const item of signals) {
    const result =
      getForwardReturn(
        item.market,
        item.signal.index,
        20,
      );

    if (result !== null) {
      returns.push(result);
    }
  }

  return COSTS.map(
    (cost) => {
      const netReturns =
        returns.map(
          (value) =>
            value - cost,
        );

      return {
        cost,
        observations:
          netReturns.length,

        averageNetReturn:
          mean(netReturns),

        medianNetReturn:
          median(netReturns),

        profitableRate:
          netReturns.length === 0
            ? 0
            : netReturns.filter(
                (value) =>
                  value > 0,
              ).length /
              netReturns.length,

        totalSimpleReturn:
          netReturns.reduce(
            (sum, value) =>
              sum + value,
            0,
          ),
      };
    },
  );
}

function analysePeriod(
  dataset: RawDataset,
  startTimestamp: number,
  endTimestamp: number,
): PeriodAnalysis {
  const signals: Array<{
    market: RawMarket;
    signal: SignalObservation;
  }> = [];

  for (const market of dataset.markets) {
    const marketSignals =
      collectSignals(
        market,
        startTimestamp,
        endTimestamp,
      );

    for (const signal of marketSignals) {
      signals.push({
        market,
        signal,
      });
    }
  }

  signals.sort(
    (a, b) =>
      a.signal.timestamp -
      b.signal.timestamp,
  );

  console.log(
    `  Signals: ${signals.length}`,
  );

  return {
    start: isoOrNull(
      startTimestamp,
    ),

    end: isoOrNull(
      endTimestamp,
    ),

    observations:
      signals.length,

    horizons:
      analyseHorizons(signals),

    upsideThresholds:
      analyseThresholds(
        signals,
        UPSIDE_THRESHOLDS,
        "up",
      ),

    downsideThresholds:
      analyseThresholds(
        signals,
        DOWNSIDE_THRESHOLDS,
        "down",
      ),

    recoveryBranches:
      analyseRecoveryBranches(
        signals,
      ),

    failureBranches:
      analyseFailureBranches(
        signals,
      ),

    costSensitivity:
      analyseCostSensitivity(
        signals,
      ),
  };
}

function main(): void {
  const inputPath =
    process.argv[2];

  if (!inputPath) {
    throw new Error(
      "Usage: npx tsx server/path-analysis-runner.ts <dataset.json>",
    );
  }

  const resolvedPath =
    path.resolve(inputPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Dataset not found: ${resolvedPath}`,
    );
  }

  console.log(
    `Loading dataset: ${resolvedPath}`,
  );

  const dataset =
    JSON.parse(
      fs.readFileSync(
        resolvedPath,
        "utf8",
      ),
    ) as RawDataset;

  if (
    !dataset.markets ||
    dataset.markets.length === 0
  ) {
    throw new Error(
      "Dataset contains no markets.",
    );
  }

  const splitTimestamp =
    findSplitTimestamp(dataset);

  const firstTimestamp =
    Math.min(
      ...dataset.markets.map(
        (market) =>
          market.candles[0]
            ?.openTime ??
          Infinity,
      ),
    );

  const lastTimestamp =
    Math.max(
      ...dataset.markets.map(
        (market) =>
          market.candles[
            market.candles.length - 1
          ]?.openTime ??
          -Infinity,
      ),
    );

  console.log("");
  console.log(
    `Markets: ${dataset.markets.length}`,
  );

  console.log(
    `Discovery: ${isoOrNull(
      firstTimestamp,
    )} -> ${isoOrNull(
      splitTimestamp,
    )}`,
  );

  console.log(
    `OOS: ${isoOrNull(
      splitTimestamp,
    )} -> ${isoOrNull(
      lastTimestamp,
    )}`,
  );

  console.log("");
  console.log(
    "Frozen signal:",
  );

  console.log(
    `  slope20 <= ${SIGNAL.slope20}`,
  );

  console.log(
    `  acceleration >= ${SIGNAL.acceleration}`,
  );

  console.log("");
  console.log(
    "Analysing discovery period...",
  );

  const discovery =
    analysePeriod(
      dataset,
      firstTimestamp,
      splitTimestamp,
    );

  console.log("");
  console.log(
    "Analysing OOS period...",
  );

  const outOfSample =
    analysePeriod(
      dataset,
      splitTimestamp,
      lastTimestamp + 1,
    );

  const output: Output = {
    generatedAt:
      new Date().toISOString(),

    sourceFile:
      path.basename(resolvedPath),

    signal: {
      conditions: [
        {
          feature: "slope20",
          operator: "<=",
          percentile: 20,
          threshold:
            SIGNAL.slope20,
        },
        {
          feature:
            "acceleration",
          operator: ">=",
          percentile: 80,
          threshold:
            SIGNAL.acceleration,
        },
      ],
    },

    horizons: HORIZONS,

    upsideThresholds:
      UPSIDE_THRESHOLDS,

    downsideThresholds:
      DOWNSIDE_THRESHOLDS,

    recoveryWindows:
      RECOVERY_WINDOWS,

    costs: COSTS,

    discovery,
    outOfSample,
  };

  const outputPath =
    path.join(
      path.dirname(resolvedPath),
      `path-analysis-${Date.now()}.json`,
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  console.log("");
  console.log(
    `Results written to: ${outputPath}`,
  );
}

main();
