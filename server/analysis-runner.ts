import fs from "fs";
import path from "path";

interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketData {
  symbol: string;
  candles: Candle[];
}

interface FeatureResult {
  market: string;
  time: number;

  // Direction
  return5: number;
  return10: number;
  return20: number;
  return50: number;
  return100: number;

  // Trend slope, normalised by price
  slope20: number;
  slope50: number;
  slope100: number;

  // Persistence
  positive20: number;
  positive50: number;
  positive100: number;

  // Smoothness
  efficiency20: number;
  efficiency50: number;
  efficiency100: number;

  // Recent drawdown from the highest close
  drawdown20: number;
  drawdown50: number;
  drawdown100: number;

  // Volatility
  volatility20: number;
  volatility50: number;
  volatility100: number;

  // Acceleration
  acceleration: number;

  // Future outcomes
  future5: number;
  future10: number;
  future20: number;
  future50: number;

  // Maximum adverse/favourable excursion
  mae20: number;
  mfe20: number;

  mae50: number;
  mfe50: number;
}

interface FeatureSummary {
  feature: string;
  horizon: number;
  bucket: number;
  observations: number;
  averageGrossReturn: number;
  averageNetReturn: number;
  winRate: number;
  averageMAE: number;
  averageMFE: number;
}

const TOTAL_COST = 0.002;

const LOOKBACKS = [5, 10, 20, 50, 100];
const FUTURE_HORIZONS = [5, 10, 20, 50];

const MIN_LOOKBACK = 100;
const MAX_FUTURE = 50;

const DATA_DIRECTORY = path.join(
  process.cwd(),
  "server",
  "research-output"
);

function findLatestDataFile(): string {
  const files = fs
    .readdirSync(DATA_DIRECTORY)
    .filter(
      (file) =>
        file.startsWith("ema-data-") &&
        file.endsWith(".json")
    )
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No ema-data-*.json files found in ${DATA_DIRECTORY}`
    );
  }

  return path.join(
    DATA_DIRECTORY,
    files[files.length - 1]
  );
}

function percentage(value: number): number {
  return value * 100;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

/**
 * Return from price at `start` to price at `end`.
 */
function priceReturn(
  candles: Candle[],
  start: number,
  end: number
): number {
  const startPrice = candles[start].close;
  const endPrice = candles[end].close;

  if (startPrice === 0) {
    return 0;
  }

  return endPrice / startPrice - 1;
}

/**
 * Fraction of one-minute price changes which were positive.
 */
function positiveFraction(
  candles: Candle[],
  index: number,
  lookback: number
): number {
  let positive = 0;
  let observations = 0;

  const start = index - lookback + 1;

  for (
    let i = Math.max(1, start);
    i <= index;
    i++
  ) {
    const previous = candles[i - 1].close;
    const current = candles[i].close;

    if (current > previous) {
      positive++;
    }

    observations++;
  }

  if (observations === 0) {
    return 0;
  }

  return positive / observations;
}

/**
 * Efficiency ratio:
 *
 * net movement / total absolute movement
 *
 * A smooth upward trend approaches +1.
 * A smooth downward trend approaches -1.
 * Choppy movement approaches 0.
 */
function efficiencyRatio(
  candles: Candle[],
  index: number,
  lookback: number
): number {
  const start = index - lookback;

  if (start < 0) {
    return 0;
  }

  const netMovement =
    candles[index].close -
    candles[start].close;

  let totalMovement = 0;

  for (
    let i = start + 1;
    i <= index;
    i++
  ) {
    totalMovement += Math.abs(
      candles[i].close -
        candles[i - 1].close
    );
  }

  if (totalMovement === 0) {
    return 0;
  }

  return netMovement / totalMovement;
}

/**
 * Maximum drawdown from the highest close
 * during the lookback period.
 */
function maximumDrawdown(
  candles: Candle[],
  index: number,
  lookback: number
): number {
  const start = Math.max(
    0,
    index - lookback
  );

  let highest =
    candles[start].close;

  let maximumDrawdown = 0;

  for (
    let i = start;
    i <= index;
    i++
  ) {
    highest = Math.max(
      highest,
      candles[i].close
    );

    const drawdown =
      candles[i].close / highest - 1;

    maximumDrawdown = Math.min(
      maximumDrawdown,
      drawdown
    );
  }

  return maximumDrawdown;
}

/**
 * Standard deviation of one-minute returns.
 */
function volatility(
  candles: Candle[],
  index: number,
  lookback: number
): number {
  const start = index - lookback + 1;

  if (start < 1) {
    return 0;
  }

  const returns: number[] = [];

  for (
    let i = start;
    i <= index;
    i++
  ) {
    const previous =
      candles[i - 1].close;

    const current =
      candles[i].close;

    if (previous === 0) {
      continue;
    }

    returns.push(
      current / previous - 1
    );
  }

  if (returns.length === 0) {
    return 0;
  }

  const average = mean(returns);

  const variance = mean(
    returns.map(
      (value) =>
        (value - average) ** 2
    )
  );

  return Math.sqrt(variance);
}

/**
 * Linear regression slope of price against time,
 * normalised by the current price.
 *
 * This makes slopes comparable between markets
 * with different absolute prices.
 */
function regressionSlope(
  candles: Candle[],
  index: number,
  lookback: number
): number {
  const start =
    index - lookback + 1;

  if (start < 0) {
    return 0;
  }

  const n = lookback;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (
    let i = 0;
    i < n;
    i++
  ) {
    const x = i;
    const y =
      candles[start + i].close;

    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator =
    n * sumXX -
    sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  const slope =
    (n * sumXY -
      sumX * sumY) /
    denominator;

  const currentPrice =
    candles[index].close;

  if (currentPrice === 0) {
    return 0;
  }

  return slope / currentPrice;
}

/**
 * Maximum favourable and adverse excursion
 * after entry.
 *
 * Highs/lows are used rather than closes because
 * the question is whether there was an opportunity
 * to exit profitably, not merely whether the final
 * closing price was higher.
 */
function excursion(
  candles: Candle[],
  index: number,
  horizon: number
): {
  mae: number;
  mfe: number;
} {
  const entry =
    candles[index].close;

  let lowest = entry;
  let highest = entry;

  const end = Math.min(
    candles.length - 1,
    index + horizon
  );

  for (
    let i = index + 1;
    i <= end;
    i++
  ) {
    lowest = Math.min(
      lowest,
      candles[i].low
    );

    highest = Math.max(
      highest,
      candles[i].high
    );
  }

  return {
    mae:
      entry === 0
        ? 0
        : lowest / entry - 1,

    mfe:
      entry === 0
        ? 0
        : highest / entry - 1,
  };
}

/**
 * Calculate all features available at a particular
 * point in time.
 *
 * IMPORTANT:
 * Every feature uses candles <= index.
 * No future candle is used here.
 */
function calculateFeatures(
  candles: Candle[],
  index: number
): Omit<
  FeatureResult,
  | "market"
  | "time"
  | "future5"
  | "future10"
  | "future20"
  | "future50"
  | "mae20"
  | "mfe20"
  | "mae50"
  | "mfe50"
> {
  const return5 =
    priceReturn(
      candles,
      index - 5,
      index
    );

  const return10 =
    priceReturn(
      candles,
      index - 10,
      index
    );

  const return20 =
    priceReturn(
      candles,
      index - 20,
      index
    );

  const return50 =
    priceReturn(
      candles,
      index - 50,
      index
    );

  const return100 =
    priceReturn(
      candles,
      index - 100,
      index
    );

  const slope20 =
    regressionSlope(
      candles,
      index,
      20
    );

  const slope50 =
    regressionSlope(
      candles,
      index,
      50
    );

  const slope100 =
    regressionSlope(
      candles,
      index,
      100
    );

  const positive20 =
    positiveFraction(
      candles,
      index,
      20
    );

  const positive50 =
    positiveFraction(
      candles,
      index,
      50
    );

  const positive100 =
    positiveFraction(
      candles,
      index,
      100
    );

  const efficiency20 =
    efficiencyRatio(
      candles,
      index,
      20
    );

  const efficiency50 =
    efficiencyRatio(
      candles,
      index,
      50
    );

  const efficiency100 =
    efficiencyRatio(
      candles,
      index,
      100
    );

  const drawdown20 =
    maximumDrawdown(
      candles,
      index,
      20
    );

  const drawdown50 =
    maximumDrawdown(
      candles,
      index,
      50
    );

  const drawdown100 =
    maximumDrawdown(
      candles,
      index,
      100
    );

  const volatility20 =
    volatility(
      candles,
      index,
      20
    );

  const volatility50 =
    volatility(
      candles,
      index,
      50
    );

  const volatility100 =
    volatility(
      candles,
      index,
      100
    );

  /**
   * Positive acceleration means the short-term
   * trend is stronger than the medium-term trend.
   */
  const acceleration =
    slope20 - slope50;

  return {
    return5,
    return10,
    return20,
    return50,
    return100,

    slope20,
    slope50,
    slope100,

    positive20,
    positive50,
    positive100,

    efficiency20,
    efficiency50,
    efficiency100,

    drawdown20,
    drawdown50,
    drawdown100,

    volatility20,
    volatility50,
    volatility100,

    acceleration,
  };
}

/**
 * Actual future return from the entry price.
 */
function futureReturn(
  candles: Candle[],
  index: number,
  horizon: number
): number {
  const futureIndex =
    index + horizon;

  if (
    futureIndex >=
    candles.length
  ) {
    return 0;
  }

  return priceReturn(
    candles,
    index,
    futureIndex
  );
}

type NumericFeature =
  | "return5"
  | "return10"
  | "return20"
  | "return50"
  | "return100"
  | "slope20"
  | "slope50"
  | "slope100"
  | "positive20"
  | "positive50"
  | "positive100"
  | "efficiency20"
  | "efficiency50"
  | "efficiency100"
  | "drawdown20"
  | "drawdown50"
  | "drawdown100"
  | "volatility20"
  | "volatility50"
  | "volatility100"
  | "acceleration";

const FEATURES: NumericFeature[] = [
  "return5",
  "return10",
  "return20",
  "return50",
  "return100",

  "slope20",
  "slope50",
  "slope100",

  "positive20",
  "positive50",
  "positive100",

  "efficiency20",
  "efficiency50",
  "efficiency100",

  "drawdown20",
  "drawdown50",
  "drawdown100",

  "volatility20",
  "volatility50",
  "volatility100",

  "acceleration",
];

function quantile(
  sorted: number[],
  probability: number
): number {
  if (sorted.length === 0) {
    return 0;
  }

  const position =
    (sorted.length - 1) *
    probability;

  const lower =
    Math.floor(position);

  const upper =
    Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight =
    position - lower;

  return (
    sorted[lower] *
      (1 - weight) +
    sorted[upper] * weight
  );
}

/**
 * Put observations into ten buckets based on
 * the distribution of the feature.
 *
 * Bucket 1 = lowest 10%
 * Bucket 10 = highest 10%
 */
function calculateFeatureSummaries(
  observations: FeatureResult[]
): FeatureSummary[] {
  const summaries: FeatureSummary[] = [];

  for (const feature of FEATURES) {
    console.log(
      `Summarising ${feature}...`
    );

    // Sort indices rather than copying the entire observation
    // objects. This substantially reduces memory overhead.
    const sortedIndices = Array.from(
      { length: observations.length },
      (_, index) => index
    ).sort(
      (a, b) =>
        observations[a][feature] -
        observations[b][feature]
    );

    const bucketStats = Array.from(
      { length: 10 },
      () =>
        new Map<
          number,
          {
            count: number;
            grossReturnSum: number;
            netReturnSum: number;
            wins: number;
            maeSum: number;
            mfeSum: number;
          }
        >()
    );

    for (
      let sortedPosition = 0;
      sortedPosition <
      sortedIndices.length;
      sortedPosition++
    ) {
      const observation =
        observations[
          sortedIndices[
            sortedPosition
          ]
        ];

      const bucket = Math.min(
        9,
        Math.floor(
          (sortedPosition * 10) /
            sortedIndices.length
        )
      );

      for (const horizon of FUTURE_HORIZONS) {
        const futureReturn =
          observation[
            `future${horizon}` as
              | "future5"
              | "future10"
              | "future20"
              | "future50"
          ];

        const netReturn =
          futureReturn -
          TOTAL_COST;

        const excursionData =
          horizon <= 20
            ? {
                mae: observation.mae20,
                mfe: observation.mfe20,
              }
            : {
                mae: observation.mae50,
                mfe: observation.mfe50,
              };

        const existing =
          bucketStats[bucket].get(
            horizon
          );

        if (existing) {
          existing.count++;
          existing.grossReturnSum +=
            futureReturn;
          existing.netReturnSum +=
            netReturn;

          if (netReturn > 0) {
            existing.wins++;
          }

          existing.maeSum +=
            excursionData.mae;

          existing.mfeSum +=
            excursionData.mfe;
        } else {
          bucketStats[bucket].set(
            horizon,
            {
              count: 1,
              grossReturnSum:
                futureReturn,
              netReturnSum:
                netReturn,
              wins:
                netReturn > 0
                  ? 1
                  : 0,
              maeSum:
                excursionData.mae,
              mfeSum:
                excursionData.mfe,
            }
          );
        }
      }
    }

    for (
      let bucket = 0;
      bucket < 10;
      bucket++
    ) {
      for (const horizon of FUTURE_HORIZONS) {
        const stats =
          bucketStats[bucket].get(
            horizon
          );

        if (!stats) {
          continue;
        }

        summaries.push({
          feature,

          // Convert internal 0–9 bucket to
          // the externally reported 1–10 bucket.
          bucket: bucket + 1,

          horizon,

          observations:
            stats.count,

          averageGrossReturn:
            stats.grossReturnSum /
            stats.count,

          averageNetReturn:
            stats.netReturnSum /
            stats.count,

          winRate:
            stats.wins /
            stats.count,

          averageMAE:
            stats.maeSum /
            stats.count,

          averageMFE:
            stats.mfeSum /
            stats.count,
        });
      }
    }
  }

  return summaries;
}

function formatPercent(
  value: number
): string {
  return `${percentage(value).toFixed(4)}%`;
}

function printTopFeatureResults(
  summaries: FeatureSummary[]
): void {
  console.log(
    "\n=== BEST FEATURE BUCKETS ===\n"
  );

  for (const horizon of FUTURE_HORIZONS) {
    console.log(
      `\n--- ${horizon} minute horizon ---`
    );

    const best = summaries
      .filter(
        (summary) =>
          summary.horizon ===
            horizon &&
          summary.observations >= 1000
      )
      .sort(
        (a, b) =>
          b.averageNetReturn -
          a.averageNetReturn
      )
      .slice(0, 20);

    for (const result of best) {
      console.log(
        [
          result.feature.padEnd(
            18
          ),

          `bucket=${String(
            result.bucket
          ).padStart(2)}`,

          `n=${String(
            result.observations
          ).padStart(7)}`,

          `gross=${formatPercent(
            result.averageGrossReturn
          ).padStart(10)}`,

          `net=${formatPercent(
            result.averageNetReturn
          ).padStart(10)}`,

          `win=${formatPercent(
            result.winRate
          ).padStart(8)}`,

          `MAE=${formatPercent(
            result.averageMAE
          ).padStart(10)}`,

          `MFE=${formatPercent(
            result.averageMFE
          ).padStart(10)}`,
        ].join(" | ")
      );
    }
  }
}

/**
 * Print examples of market states resembling
 * the user's visual description:
 *
 * - price already rising
 * - rising over multiple timescales
 * - many positive minutes
 * - orderly movement
 * - relatively shallow drawdown
 *
 * This is deliberately only a diagnostic filter.
 * It is NOT used to determine the statistical
 * feature results above.
 */
function printHighQualityMarkets(
  observations: FeatureResult[]
): void {
  console.log(
    "\n=== EXAMPLE HIGH-QUALITY UPWARD STATES ===\n"
  );

  const candidates =
    observations
      .filter(
        (observation) =>
          observation.return20 > 0 &&
          observation.return50 > 0 &&
          observation.return100 > 0 &&
          observation.positive50 >=
            0.55 &&
          observation.efficiency50 >=
            0.25 &&
          observation.drawdown50 >=
            -0.03
      )
      .sort(
        (a, b) =>
          b.efficiency50 -
          a.efficiency50
      )
      .slice(0, 20);

  for (const candidate of candidates) {
    console.log(
      [
        candidate.market,

        new Date(
          candidate.time
        ).toISOString(),

        `r20=${formatPercent(
          candidate.return20
        )}`,

        `r50=${formatPercent(
          candidate.return50
        )}`,

        `r100=${formatPercent(
          candidate.return100
        )}`,

        `positive50=${formatPercent(
          candidate.positive50
        )}`,

        `eff50=${candidate.efficiency50.toFixed(
          3
        )}`,

        `dd50=${formatPercent(
          candidate.drawdown50
        )}`,

        `future20=${formatPercent(
          candidate.future20
        )}`,

        `future50=${formatPercent(
          candidate.future50
        )}`,

        `MAE20=${formatPercent(
          candidate.mae20
        )}`,

        `MFE20=${formatPercent(
          candidate.mfe20
        )}`,
      ].join(" | ")
    );
  }
}

function main(): void {
  const inputFile =
    findLatestDataFile();

  console.log(
    `Loading ${inputFile}...`
  );

  const raw =
    fs.readFileSync(
      inputFile,
      "utf8"
    );

  const dataset =
    JSON.parse(raw) as {
      markets: MarketData[];
    };

  console.log(
    `Loaded ${dataset.markets.length} markets`
  );

  const observations: FeatureResult[] =
    [];

  let totalObservationCount = 0;

  /**
   * Process one market at a time.
   *
   * We don't retain intermediate feature
   * arrays for individual markets.
   */
  for (
    let marketIndex = 0;
    marketIndex <
    dataset.markets.length;
    marketIndex++
  ) {
    const market =
      dataset.markets[
        marketIndex
      ];

    const candles =
      market.candles;

    console.log(
      `Processing ${market.symbol} (${marketIndex + 1}/${dataset.markets.length})`
    );

    const firstIndex =
      MIN_LOOKBACK;

    const lastIndex =
      candles.length -
      MAX_FUTURE -
      1;

    if (
      lastIndex <=
      firstIndex
    ) {
      continue;
    }

    for (
      let index =
        firstIndex;
      index <= lastIndex;
      index++
    ) {
      const features =
        calculateFeatures(
          candles,
          index
        );

      const excursion20 =
        excursion(
          candles,
          index,
          20
        );

      const excursion50 =
        excursion(
          candles,
          index,
          50
        );

      observations.push({
        market:
          market.symbol,

        time:
          candles[index]
            .closeTime,

        ...features,

        future5:
          futureReturn(
            candles,
            index,
            5
          ),

        future10:
          futureReturn(
            candles,
            index,
            10
          ),

        future20:
          futureReturn(
            candles,
            index,
            20
          ),

        future50:
          futureReturn(
            candles,
            index,
            50
          ),

        mae20:
          excursion20.mae,

        mfe20:
          excursion20.mfe,

        mae50:
          excursion50.mae,

        mfe50:
          excursion50.mfe,
      });

      totalObservationCount++;
    }
  }

  console.log(
    `\nDataset built: ${totalObservationCount.toLocaleString()} observations`
  );

  console.log(
    "Calculating feature/bucket statistics..."
  );

  const summaries =
    calculateFeatureSummaries(
      observations
    );

  printTopFeatureResults(
    summaries
  );

  printHighQualityMarkets(
    observations
  );

  /**
   * IMPORTANT:
   *
   * Do NOT put `observations` in this object.
   *
   * With millions of observations, JSON.stringify()
   * would exceed Node's maximum string length.
   *
   * The observations remain in memory only until the
   * process exits.
   */
  const output = {
    generatedAt:
      new Date().toISOString(),

    source: {
      file:
        path.basename(
          inputFile
        ),

      markets:
        dataset.markets.length,

      interval: "1m",

      lookbacks:
        LOOKBACKS,

      futureHorizons:
        FUTURE_HORIZONS,
    },

    assumptions: {
      totalCost:
        TOTAL_COST,

      totalCostPercent:
        percentage(
          TOTAL_COST
        ),
    },

    observations: {
      count:
        totalObservationCount,
    },

    features:
      FEATURES,

    summaries,
  };

  const outputFile =
    path.join(
      DATA_DIRECTORY,
      `trend-analysis-${Date.now()}.json`
    );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(output)
  );

  console.log(
    `\nAnalysis saved to ${outputFile}`
  );
}

main();