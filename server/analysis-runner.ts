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

interface RawDataset {
  generatedAt: string;
  interval: string;
  lookbackDays: number;
  markets: MarketData[];
}

interface PathOutcome {
  target: number;
  stop: number;

  targetBeforeStop: boolean;
  stopBeforeTarget: boolean;
  neither: boolean;

  timeToTarget: number | null;
  timeToStop: number | null;

  mae: number;
  mfe: number;
}

interface FeatureResult {
  symbol: string;
  timestamp: number;

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

  outcomes: PathOutcome[];
}

interface BucketSummary {
  feature: string;
  bucket: number;
  count: number;

  target: number;
  stop: number;

  targetBeforeStopRate: number;
  stopBeforeTargetRate: number;
  neitherRate: number;

  averageTimeToTarget: number | null;

  averageMae: number;
  averageMfe: number;
}

const TOTAL_COST = 0.002;

const LOOKBACKS = [20, 50];

const TARGETS = [0.002, 0.003, 0.005];
const STOPS = [-0.002, -0.003];

const MIN_LOOKBACK = 50;
const MAX_FORWARD_MINUTES = 120;

const OUTPUT_DIR = path.join(
  process.cwd(),
  "server",
  "research-output"
);

function findLatestDataFile(): string {
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter(
      (file) =>
        file.startsWith("ema-data-") &&
        file.endsWith(".json")
    )
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No ema-data-*.json files found in ${OUTPUT_DIR}`
    );
  }

  return path.join(
    OUTPUT_DIR,
    files[files.length - 1]
  );
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function percentage(value: number): number {
  return value * 100;
}

function priceReturn(
  candles: Candle[],
  startIndex: number,
  lookback: number
): number {
  const start = candles[startIndex - lookback]?.close;
  const end = candles[startIndex]?.close;

  if (
    start === undefined ||
    end === undefined ||
    start === 0
  ) {
    return 0;
  }

  return (end - start) / start;
}

function regressionSlope(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex = endIndex - lookback + 1;

  if (startIndex < 0) {
    return 0;
  }

  const values = candles
    .slice(startIndex, endIndex + 1)
    .map((candle) => candle.close);

  if (values.length < 2) {
    return 0;
  }

  const meanX = (values.length - 1) / 2;
  const meanY = mean(values);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < values.length; i += 1) {
    const x = i - meanX;
    const y = values[i] - meanY;

    numerator += x * y;
    denominator += x * x;
  }

  if (denominator === 0 || meanY === 0) {
    return 0;
  }

  // Normalise the slope so it is approximately a
  // fractional price change per candle.
  return (numerator / denominator) / meanY;
}

function maximumDrawdown(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex = endIndex - lookback + 1;

  if (startIndex < 0) {
    return 0;
  }

  let highest = candles[startIndex].close;
  let maximum = 0;

  for (
    let index = startIndex;
    index <= endIndex;
    index += 1
  ) {
    const close = candles[index].close;

    if (close > highest) {
      highest = close;
    }

    if (highest > 0) {
      const drawdown = (close - highest) / highest;

      if (drawdown < maximum) {
        maximum = drawdown;
      }
    }
  }

  return maximum;
}

function volatility(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex = endIndex - lookback;

  if (startIndex < 0) {
    return 0;
  }

  const returns: number[] = [];

  for (
    let index = startIndex + 1;
    index <= endIndex;
    index += 1
  ) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;

    if (previous > 0) {
      returns.push((current - previous) / previous);
    }
  }

  if (returns.length === 0) {
    return 0;
  }

  const average = mean(returns);

  const variance = mean(
    returns.map(
      (value) => (value - average) ** 2
    )
  );

  return Math.sqrt(variance);
}

function efficiencyRatio(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex = endIndex - lookback;

  if (startIndex < 0) {
    return 0;
  }

  const start = candles[startIndex].close;
  const end = candles[endIndex].close;

  let totalMovement = 0;

  for (
    let index = startIndex + 1;
    index <= endIndex;
    index += 1
  ) {
    totalMovement += Math.abs(
      candles[index].close -
        candles[index - 1].close
    );
  }

  if (totalMovement === 0) {
    return 0;
  }

  return Math.abs(end - start) / totalMovement;
}

function calculateFeatures(
  candles: Candle[],
  index: number
): Omit<FeatureResult, "symbol" | "timestamp" | "outcomes"> {
  const return20 = priceReturn(
    candles,
    index,
    20
  );

  const return50 = priceReturn(
    candles,
    index,
    50
  );

  const slope20 = regressionSlope(
    candles,
    index,
    20
  );

  const slope50 = regressionSlope(
    candles,
    index,
    50
  );

  const drawdown20 = maximumDrawdown(
    candles,
    index,
    20
  );

  const drawdown50 = maximumDrawdown(
    candles,
    index,
    50
  );

  const volatility20 = volatility(
    candles,
    index,
    20
  );

  const volatility50 = volatility(
    candles,
    index,
    50
  );

  const efficiency20 = efficiencyRatio(
    candles,
    index,
    20
  );

  const efficiency50 = efficiencyRatio(
    candles,
    index,
    50
  );

  const acceleration = slope20 - slope50;

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
    acceleration,
  };
}

function calculatePathOutcome(
  candles: Candle[],
  entryIndex: number,
  target: number,
  stop: number
): PathOutcome {
  const entryPrice =
    candles[entryIndex].close;

  let mae = 0;
  let mfe = 0;

  let timeToTarget: number | null = null;
  let timeToStop: number | null = null;

  const lastIndex = Math.min(
    candles.length - 1,
    entryIndex + MAX_FORWARD_MINUTES
  );

  for (
    let index = entryIndex + 1;
    index <= lastIndex;
    index += 1
  ) {
    const candle = candles[index];

    const highReturn =
      (candle.high - entryPrice) /
      entryPrice;

    const lowReturn =
      (candle.low - entryPrice) /
      entryPrice;

    if (highReturn > mfe) {
      mfe = highReturn;
    }

    if (lowReturn < mae) {
      mae = lowReturn;
    }

    /*
     * We use the candle's high/low to determine whether
     * a level was reached. If both target and stop occur
     * inside the same candle, OHLC data cannot tell us
     * which happened first.
     *
     * We therefore classify that case as neither rather
     * than inventing an intrabar ordering.
     */
    const hitTarget = highReturn >= target;
    const hitStop = lowReturn <= stop;

    if (hitTarget && hitStop) {
      break;
    }

    if (hitTarget) {
      timeToTarget =
        index - entryIndex;
      break;
    }

    if (hitStop) {
      timeToStop =
        index - entryIndex;
      break;
    }
  }

  const targetBeforeStop =
    timeToTarget !== null &&
    (
      timeToStop === null ||
      timeToTarget < timeToStop
    );

  const stopBeforeTarget =
    timeToStop !== null &&
    (
      timeToTarget === null ||
      timeToStop < timeToTarget
    );

  const neither =
    !targetBeforeStop &&
    !stopBeforeTarget;

  return {
    target,
    stop,
    targetBeforeStop,
    stopBeforeTarget,
    neither,
    timeToTarget,
    timeToStop,
    mae,
    mfe,
  };
}

function calculateOutcomes(
  candles: Candle[],
  index: number
): PathOutcome[] {
  const outcomes: PathOutcome[] = [];

  for (const target of TARGETS) {
    for (const stop of STOPS) {
      outcomes.push(
        calculatePathOutcome(
          candles,
          index,
          target,
          stop
        )
      );
    }
  }

  return outcomes;
}

function buildObservations(
  dataset: RawDataset
): FeatureResult[] {
  const observations: FeatureResult[] = [];

  let processed = 0;

  for (const market of dataset.markets) {
    const candles = market.candles;

    const firstIndex = MIN_LOOKBACK;
    const lastIndex =
      candles.length - MAX_FORWARD_MINUTES - 1;

    for (
      let index = firstIndex;
      index <= lastIndex;
      index += 1
    ) {
      const features = calculateFeatures(
        candles,
        index
      );

      const outcomes = calculateOutcomes(
        candles,
        index
      );

      observations.push({
        symbol: market.symbol,
        timestamp: candles[index].closeTime,
        ...features,
        outcomes,
      });

      processed += 1;

      if (processed % 100000 === 0) {
        console.log(
          `Processed ${processed.toLocaleString()} observations`
        );
      }
    }
  }

  return observations;
}

function getFeatureValue(
  observation: FeatureResult,
  feature: keyof Omit<
    FeatureResult,
    "symbol" | "timestamp" | "outcomes"
  >
): number {
  return observation[feature];
}

function getOutcome(
  observation: FeatureResult,
  target: number,
  stop: number
): PathOutcome {
  const outcome = observation.outcomes.find(
    (item) =>
      item.target === target &&
      item.stop === stop
  );

  if (!outcome) {
    throw new Error(
      `Missing outcome for target ${target}, stop ${stop}`
    );
  }

  return outcome;
}

function calculateFeatureSummaries(
  observations: FeatureResult[]
): BucketSummary[] {
  const features: Array<
    keyof Omit<
      FeatureResult,
      "symbol" | "timestamp" | "outcomes"
    >
  > = [
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

  const summaries: BucketSummary[] = [];

  for (const feature of features) {
    console.log(
      `Summarising ${String(feature)}...`
    );

    const sortedIndices = observations
      .map((_, index) => index)
      .sort(
        (a, b) =>
          getFeatureValue(
            observations[a],
            feature
          ) -
          getFeatureValue(
            observations[b],
            feature
          )
      );

    for (const target of TARGETS) {
      for (const stop of STOPS) {
        const buckets = Array.from(
          { length: 10 },
          () => ({
            count: 0,
            targetBeforeStop: 0,
            stopBeforeTarget: 0,
            neither: 0,
            targetTimes: [] as number[],
            maes: [] as number[],
            mfes: [] as number[],
          })
        );

        for (
          let sortedPosition = 0;
          sortedPosition < sortedIndices.length;
          sortedPosition += 1
        ) {
          const observation =
            observations[
              sortedIndices[sortedPosition]
            ];

          const bucket = Math.min(
            9,
            Math.floor(
              (sortedPosition * 10) /
                sortedIndices.length
            )
          );

          const outcome = getOutcome(
            observation,
            target,
            stop
          );

          const bucketData = buckets[bucket];

          bucketData.count += 1;

          if (outcome.targetBeforeStop) {
            bucketData.targetBeforeStop += 1;
          }

          if (outcome.stopBeforeTarget) {
            bucketData.stopBeforeTarget += 1;
          }

          if (outcome.neither) {
            bucketData.neither += 1;
          }

          if (
            outcome.timeToTarget !== null
          ) {
            bucketData.targetTimes.push(
              outcome.timeToTarget
            );
          }

          bucketData.maes.push(
            outcome.mae
          );

          bucketData.mfes.push(
            outcome.mfe
          );
        }

        for (
          let bucket = 0;
          bucket < 10;
          bucket += 1
        ) {
          const data = buckets[bucket];

          summaries.push({
            feature: String(feature),
            bucket: bucket + 1,
            count: data.count,

            target,
            stop,

            targetBeforeStopRate:
              data.count === 0
                ? 0
                : data.targetBeforeStop /
                  data.count,

            stopBeforeTargetRate:
              data.count === 0
                ? 0
                : data.stopBeforeTarget /
                  data.count,

            neitherRate:
              data.count === 0
                ? 0
                : data.neither /
                  data.count,

            averageTimeToTarget:
              data.targetTimes.length === 0
                ? null
                : mean(
                    data.targetTimes
                  ),

            averageMae:
              mean(data.maes),

            averageMfe:
              mean(data.mfes),
          });
        }
      }
    }
  }

  return summaries;
}

function formatPercent(
  value: number
): string {
  return `${percentage(value).toFixed(3)}%`;
}

function printResults(
  summaries: BucketSummary[]
): void {
  console.log("\n================================");
  console.log("PATH-TO-TARGET RESULTS");
  console.log("================================\n");

  for (const target of TARGETS) {
    for (const stop of STOPS) {
      console.log(
        `\nTarget ${formatPercent(
          target
        )} before stop ${formatPercent(stop)}`
      );
      console.log(
        "--------------------------------"
      );

      const relevant = summaries
        .filter(
          (summary) =>
            summary.target === target &&
            summary.stop === stop
        );

      const features = [
        ...new Set(
          relevant.map(
            (summary) =>
              summary.feature
          )
        ),
      ];

      const rankings = features
        .map((feature) => {
          const rows = relevant.filter(
            (row) =>
              row.feature === feature
          );

          const best = [...rows].sort(
            (a, b) =>
              b.targetBeforeStopRate -
              a.targetBeforeStopRate
          )[0];

          const worst = [...rows].sort(
            (a, b) =>
              a.targetBeforeStopRate -
              b.targetBeforeStopRate
          )[0];

          return {
            feature,
            bestBucket: best.bucket,
            bestRate:
              best.targetBeforeStopRate,
            worstBucket: worst.bucket,
            worstRate:
              worst.targetBeforeStopRate,
            spread:
              best.targetBeforeStopRate -
              worst.targetBeforeStopRate,
          };
        })
        .sort(
          (a, b) =>
            b.spread - a.spread
        );

      for (const ranking of rankings) {
        console.log(
          `${ranking.feature.padEnd(16)} ` +
            `best B${ranking.bestBucket}: ` +
            `${formatPercent(
              ranking.bestRate
            )} | ` +
            `worst B${ranking.worstBucket}: ` +
            `${formatPercent(
              ranking.worstRate
            )} | ` +
            `spread ${formatPercent(
              ranking.spread
            )}`
        );
      }
    }
  }
}

function printBestBuckets(
  summaries: BucketSummary[]
): void {
  console.log(
    "\n================================"
  );
  console.log("BEST FEATURE BUCKETS");
  console.log(
    "================================\n"
  );

  for (const target of TARGETS) {
    for (const stop of STOPS) {
      console.log(
        `\nTarget ${formatPercent(
          target
        )} before stop ${formatPercent(stop)}`
      );

      const rows = summaries
        .filter(
          (summary) =>
            summary.target === target &&
            summary.stop === stop
        )
        .sort(
          (a, b) =>
            b.targetBeforeStopRate -
            a.targetBeforeStopRate
        );

      const seenFeatures =
        new Set<string>();

      let printed = 0;

      for (const row of rows) {
        if (
          seenFeatures.has(row.feature)
        ) {
          continue;
        }

        seenFeatures.add(row.feature);

        console.log(
          `${row.feature.padEnd(16)} ` +
            `bucket ${row.bucket}: ` +
            `target-first ` +
            `${formatPercent(
              row.targetBeforeStopRate
            )}, ` +
            `stop-first ` +
            `${formatPercent(
              row.stopBeforeTargetRate
            )}, ` +
            `neither ` +
            `${formatPercent(
              row.neitherRate
            )}, ` +
            `avg target time ` +
            `${
              row.averageTimeToTarget ===
              null
                ? "n/a"
                : `${row.averageTimeToTarget.toFixed(
                    1
                  )}m`
            }`
        );

        printed += 1;

        if (printed >= 5) {
          break;
        }
      }
    }
  }
}

function main(): void {
  console.log(
    "Loading raw historical dataset..."
  );

  const inputFile =
    findLatestDataFile();

  console.log(
    `Input: ${inputFile}`
  );

  const dataset =
    JSON.parse(
      fs.readFileSync(
        inputFile,
        "utf8"
      )
    ) as RawDataset;

  console.log(
    `Markets: ${dataset.markets.length}`
  );

  console.log(
    `Interval: ${dataset.interval}`
  );

  console.log(
    `Lookback: ${dataset.lookbackDays} days`
  );

  console.log(
    `Assumed round-trip cost: ${formatPercent(
      TOTAL_COST
    )}`
  );

  console.log(
    "\nBuilding path observations..."
  );

  const observations =
    buildObservations(dataset);

  console.log(
    `\nDataset built: ${observations.length.toLocaleString()} observations`
  );

  console.log(
    "\nCalculating feature summaries..."
  );

  const summaries =
    calculateFeatureSummaries(
      observations
    );

  printResults(summaries);

  printBestBuckets(summaries);

  const output = {
    generatedAt:
      new Date().toISOString(),

    sourceFile:
      path.basename(inputFile),

    markets:
      dataset.markets.length,

    interval:
      dataset.interval,

    lookbackDays:
      dataset.lookbackDays,

    observations:
      observations.length,

    assumptions: {
      totalCost: TOTAL_COST,
      totalCostPercent:
        percentage(TOTAL_COST),
      maxForwardMinutes:
        MAX_FORWARD_MINUTES,
      targets: TARGETS,
      stops: STOPS,
    },

    features: [
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
    ],

    summaries,
  };

  const outputFile = path.join(
    OUTPUT_DIR,
    `path-analysis-${Date.now()}.json`
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    `\nSaved analysis to: ${outputFile}`
  );
}

main();