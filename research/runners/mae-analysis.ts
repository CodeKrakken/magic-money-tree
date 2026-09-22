import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

interface Candle {
  openTime: number;
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

interface Dataset {
  markets: MarketData[];
}

interface SignalAnalysis {
  symbol: string;
  entryIndex: number;
  entryTimestamp: number;
  entryPrice: number;

  maximumAdverseExcursion: number;
  maximumFavourableExcursion: number;

  timeToMaximumAdverseMinutes: number;
  timeToMaximumFavourableMinutes: number;

  targetTimes: Record<string, number | null>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SOURCE_FILE = "ema-data-1789061547934.json";

const SOURCE_PATH =
  process.argv[2] ??
  path.join(
    __dirname,
    "research-output",
    DEFAULT_SOURCE_FILE,
  );

const OUTPUT_DIR = path.join(
  __dirname,
  "research-output",
);

// These are the frozen entry thresholds from the previous research.
const SLOPE_THRESHOLD = -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

// Profit levels we want to investigate.
const PROFIT_TARGETS = [
  0.002,  // 0.20%
  0.005,  // 0.50%
  0.0075, // 0.75%
  0.01,   // 1.00%
];

// Candidate stop levels.
const STOP_LEVELS = [
  0.0025, // 0.25%
  0.005,  // 0.50%
  0.0075, // 0.75%
  0.01,   // 1.00%
  0.015,  // 1.50%
  0.02,   // 2.00%
  0.03,   // 3.00%
];

const PROGRESS_INTERVAL = 100_000;

// -----------------------------------------------------------------------------
// Statistics
// -----------------------------------------------------------------------------

function average(values: number[]): number {
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
  p: number,
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const index =
    (sorted.length - 1) * p;

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) *
      (index - lower)
  );
}

function summarise(
  values: number[],
) {
  return {
    count: values.length,
    average: average(values),
    min: percentile(values, 0),
    p10: percentile(values, 0.10),
    p25: percentile(values, 0.25),
    median: percentile(values, 0.50),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.90),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: percentile(values, 1),
  };
}

// -----------------------------------------------------------------------------
// Feature calculation
// -----------------------------------------------------------------------------
//
// This is deliberately the same calculation used by the existing
// full-strategy-backtest.ts.
// -----------------------------------------------------------------------------

function calculateSlope(
  values: number[],
): number {
  if (values.length < 2) {
    return 0;
  }

  const n = values.length;

  const meanX = (n - 1) / 2;
  const meanY = average(values);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i += 1) {
    const x = i - meanX;
    const y = values[i] - meanY;

    numerator += x * y;
    denominator += x * x;
  }

  return denominator === 0
    ? 0
    : numerator / denominator;
}

function calculateFeatures(
  candles: Candle[],
  index: number,
) {
  if (index < 50) {
    return null;
  }

  const closes = candles
    .slice(0, index + 1)
    .map((candle) => candle.close);

  const closes20 = closes.slice(-20);
  const closes50 = closes.slice(-50);

  const slope20 =
    calculateSlope(closes20);

  const slope50 =
    calculateSlope(closes50);

  const acceleration =
    slope20 - slope50;

  return {
    slope20,
    acceleration,
  };
}

// -----------------------------------------------------------------------------
// Analyse one signal
// -----------------------------------------------------------------------------

function analyseSignal(
  market: MarketData,
  entryIndex: number,
): SignalAnalysis {
  const candles = market.candles;

  const entry = candles[entryIndex];
  const entryPrice = entry.close;

  let maximumAdverseExcursion = 0;
  let maximumFavourableExcursion = 0;

  let timeToMaximumAdverseMinutes = 0;
  let timeToMaximumFavourableMinutes = 0;

  const targetTimes: Record<
    string,
    number | null
  > = {};

  for (const target of PROFIT_TARGETS) {
    targetTimes[String(target)] = null;
  }

  for (
    let index = entryIndex + 1;
    index < candles.length;
    index += 1
  ) {
    const candle = candles[index];

    // -------------------------------------------------------------------------
    // Maximum adverse excursion
    // -------------------------------------------------------------------------

    const adverseExcursion =
      (entryPrice - candle.low) /
      entryPrice;

    if (
      adverseExcursion >
      maximumAdverseExcursion
    ) {
      maximumAdverseExcursion =
        adverseExcursion;

      timeToMaximumAdverseMinutes =
        index - entryIndex;
    }

    // -------------------------------------------------------------------------
    // Maximum favourable excursion
    // -------------------------------------------------------------------------

    const favourableExcursion =
      (candle.high - entryPrice) /
      entryPrice;

    if (
      favourableExcursion >
      maximumFavourableExcursion
    ) {
      maximumFavourableExcursion =
        favourableExcursion;

      timeToMaximumFavourableMinutes =
        index - entryIndex;
    }

    // -------------------------------------------------------------------------
    // Profit target reach times
    // -------------------------------------------------------------------------

    for (const target of PROFIT_TARGETS) {
      const key = String(target);

      if (
        targetTimes[key] === null &&
        favourableExcursion >= target
      ) {
        targetTimes[key] =
          index - entryIndex;
      }
    }
  }

  return {
    symbol: market.symbol,
    entryIndex,
    entryTimestamp: entry.openTime,
    entryPrice,

    maximumAdverseExcursion,
    maximumFavourableExcursion,

    timeToMaximumAdverseMinutes,
    timeToMaximumFavourableMinutes,

    targetTimes,
  };
}

// -----------------------------------------------------------------------------
// Main analysis
// -----------------------------------------------------------------------------

function main() {
  console.log(
    `Loading dataset: ${SOURCE_PATH}`,
  );

  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(
      `Dataset not found: ${SOURCE_PATH}`,
    );
  }

  const dataset =
    JSON.parse(
      fs.readFileSync(
        SOURCE_PATH,
        "utf8",
      ),
    ) as Dataset;

  console.log(
    `Loaded ${dataset.markets.length} markets`,
  );

  const analyses: SignalAnalysis[] = [];

  let observationsExamined = 0;
  let signals = 0;

  for (const market of dataset.markets) {
    console.log(
      `Processing ${market.symbol} ` +
        `(${market.candles.length} candles)...`,
    );

    for (
      let index = 50;
      index < market.candles.length;
      index += 1
    ) {
      observationsExamined += 1;

      const features =
        calculateFeatures(
          market.candles,
          index,
        );

      if (!features) {
        continue;
      }

      const entrySignal =
        features.slope20 <=
          SLOPE_THRESHOLD &&
        features.acceleration >=
          ACCELERATION_THRESHOLD;

      if (!entrySignal) {
        continue;
      }

      signals += 1;

      analyses.push(
        analyseSignal(
          market,
          index,
        ),
      );

      if (
        observationsExamined %
          PROGRESS_INTERVAL ===
        0
      ) {
        console.log(
          `Progress: ` +
            `${observationsExamined.toLocaleString()} observations, ` +
            `${signals.toLocaleString()} signals`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Overall MAE/MFE
  // ---------------------------------------------------------------------------

  const maeValues =
    analyses.map(
      (analysis) =>
        analysis.maximumAdverseExcursion,
    );

  const mfeValues =
    analyses.map(
      (analysis) =>
        analysis.maximumFavourableExcursion,
    );

  // ---------------------------------------------------------------------------
  // Profit target analysis
  // ---------------------------------------------------------------------------

  const profitTargetAnalysis =
    Object.fromEntries(
      PROFIT_TARGETS.map((target) => {
        const key = String(target);

        const reached =
          analyses.filter(
            (analysis) =>
              analysis.targetTimes[key] !==
              null,
          );

        const notReached =
          analyses.filter(
            (analysis) =>
              analysis.targetTimes[key] ===
              null,
          );

        const reachedMae =
          reached.map(
            (analysis) =>
              analysis.maximumAdverseExcursion,
          );

        const notReachedMae =
          notReached.map(
            (analysis) =>
              analysis.maximumAdverseExcursion,
          );

        const targetTimes =
          reached
            .map(
              (analysis) =>
                analysis.targetTimes[key],
            )
            .filter(
              (
                value,
              ): value is number =>
                value !== null,
            );

        return [
          `${target * 100}%`,
          {
            target,

            reached: reached.length,

            notReached:
              notReached.length,

            reachRate:
              analyses.length === 0
                ? 0
                : reached.length /
                  analyses.length,

            maeOfReachedTrades:
              summarise(reachedMae),

            maeOfTradesThatDidNotReachTarget:
              summarise(
                notReachedMae,
              ),

            timeToTargetMinutes:
              summarise(
                targetTimes,
              ),
          },
        ];
      }),
    );

  // ---------------------------------------------------------------------------
  // Candidate stop analysis
  //
  // This answers:
  //
  // "If I had used a stop of X%, how many signals would eventually have
  //  reached each profit target without ever going through that stop?"
  //
  // This is deliberately a path-independent MAE test first. Once we identify
  // promising stop levels, we can run the exact chronological stop/target
  // backtest.
  // ---------------------------------------------------------------------------

  const stopAnalysis =
    Object.fromEntries(
      STOP_LEVELS.map((stop) => {
        const survived =
          analyses.filter(
            (analysis) =>
              analysis.maximumAdverseExcursion <
              stop,
          );

        const stopped =
          analyses.filter(
            (analysis) =>
              analysis.maximumAdverseExcursion >=
              stop,
          );

        const targetResults =
          Object.fromEntries(
            PROFIT_TARGETS.map(
              (target) => {
                const key = String(target);

                const reached =
                  analyses.filter(
                    (analysis) =>
                      analysis.targetTimes[
                        key
                      ] !== null,
                  );

                const reachedWithoutStop =
                  reached.filter(
                    (analysis) =>
                      analysis.maximumAdverseExcursion <
                      stop,
                  );

                return [
                  `${target * 100}%`,
                  {
                    reachedTarget:
                      reached.length,

                    reachedTargetWithoutHittingStop:
                      reachedWithoutStop.length,

                    survivalRateAmongTargetWinners:
                      reached.length === 0
                        ? 0
                        : reachedWithoutStop.length /
                          reached.length,

                    targetWinnersKilledByStop:
                      reached.length -
                      reachedWithoutStop.length,
                  },
                ];
              },
            ),
          );

        return [
          `${stop * 100}%`,
          {
            stop,

            signals:
              analyses.length,

            stoppedSignals:
              stopped.length,

            survivedSignals:
              survived.length,

            stoppedRate:
              analyses.length === 0
                ? 0
                : stopped.length /
                  analyses.length,

            targetResults,
          },
        ];
      }),
    );

  // ---------------------------------------------------------------------------
  // By market
  // ---------------------------------------------------------------------------

  const byMarket =
    Object.fromEntries(
      dataset.markets.map(
        (market) => {
          const marketAnalyses =
            analyses.filter(
              (analysis) =>
                analysis.symbol ===
                market.symbol,
            );

          const marketMae =
            marketAnalyses.map(
              (analysis) =>
                analysis.maximumAdverseExcursion,
            );

          const marketMfe =
            marketAnalyses.map(
              (analysis) =>
                analysis.maximumFavourableExcursion,
            );

          return [
            market.symbol,
            {
              signals:
                marketAnalyses.length,

              mae:
                summarise(marketMae),

              mfe:
                summarise(marketMfe),

              profitTargetReachRates:
                Object.fromEntries(
                  PROFIT_TARGETS.map(
                    (target) => {
                      const key =
                        String(target);

                      const reached =
                        marketAnalyses.filter(
                          (analysis) =>
                            analysis.targetTimes[
                              key
                            ] !== null,
                        ).length;

                      return [
                        `${target * 100}%`,
                        marketAnalyses.length ===
                        0
                          ? 0
                          : reached /
                            marketAnalyses.length,
                      ];
                    },
                  ),
                ),
            },
          ];
        },
      ),
    );

  const output = {
    generatedAt:
      new Date().toISOString(),

    source: {
      file: SOURCE_PATH,
      markets:
        dataset.markets.length,
      observationsExamined,
      signals,
    },

    strategy: {
      entry: {
        rule:
          "slope20 <= fixed threshold AND acceleration >= fixed threshold",

        slope20Threshold:
          SLOPE_THRESHOLD,

        accelerationThreshold:
          ACCELERATION_THRESHOLD,
      },

      maximumHoldMinutes:
        null,

      thresholdsWereNotRecalculated:
        true,

      parametersWereNotOptimised:
        true,
    },

    analysis: {
      description:
        "Maximum adverse excursion and maximum favourable excursion for every frozen entry signal with no maximum holding period.",

      profitTargets:
        PROFIT_TARGETS,

      candidateStopLevels:
        STOP_LEVELS,
    },

    overall: {
      mae:
        summarise(maeValues),

      mfe:
        summarise(mfeValues),
    },

    profitTargetAnalysis,

    stopAnalysis,

    byMarket,
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true },
  );

  const outputFile =
    path.join(
      OUTPUT_DIR,
      `mae-analysis-${Date.now()}.json`,
    );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  console.log(
    "\nMAE analysis complete.",
  );

  console.log(
    `Observations: ${observationsExamined.toLocaleString()}`,
  );

  console.log(
    `Signals: ${signals.toLocaleString()}`,
  );

  console.log(
    "\nOverall MAE:",
  );

  console.log(
    JSON.stringify(
      summarise(maeValues),
      null,
      2,
    ),
  );

  console.log(
    "\nOverall MFE:",
  );

  console.log(
    JSON.stringify(
      summarise(mfeValues),
      null,
      2,
    ),
  );

  console.log(
    `\nOutput: ${outputFile}`,
  );
}

main();