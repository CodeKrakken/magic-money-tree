import fs from "fs";
import path from "path";

const OUTPUT_DIR = path.join(__dirname, "research-output");
const SOURCE_FILE = "ema-data-1789061547934.json";

const FEE_RATE = 0.002;
const EXECUTION_COST = 0;
const TOTAL_COST = FEE_RATE + EXECUTION_COST;

const TRAIN_RATIO = 0.6;
const VALIDATION_RATIO = 0.2;

const MIN_LOOKBACK = 50;
const MAX_FORWARD_MINUTES = 120;

// Entry signal discovered by the previous path analysis.
// These are NOT used directly as fixed thresholds.
// Percentiles are recalculated from TRAIN only.
const SLOPE_PERCENTILE = 0.20;
const ACCELERATION_PERCENTILE = 0.80;

// Exit search.
const TAKE_PROFITS = [
  0.002,
  0.003,
  0.005,
  0.0075,
  0.01,
];

const STOP_LOSSES = [
  0.002,
  0.003,
  0.005,
  0.0075,
  0.01,
];

const MAX_HOLDS = [
  10,
  20,
  30,
  50,
  75,
  120,
];

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

interface Observation {
  index: number;
  slope20: number;
  acceleration: number;
}

interface TradeResult {
  trades: number;
  wins: number;
  losses: number;
  totalReturn: number;
  averageReturn: number;
  winRate: number;
}

interface StrategyParameters {
  takeProfit: number;
  stopLoss: number;
  maxHold: number;
}

interface Evaluation {
  parameters: StrategyParameters;
  result: TradeResult;
}

function progress(message: string): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${elapsed}s] ${message}`);
}

const startTime = Date.now();

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate percentile of empty array");
  }

  const sorted = [...values].sort((a, b) => a - b);

  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = position - lower;

  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) * weight
  );
}

/**
 * Normalised linear-regression slope over the final `window` closes.
 *
 * This matches the slope methodology used by the previous research runner.
 */
function calculateSlope(
  candles: Candle[],
  endIndex: number,
  window: number,
): number {
  const start = endIndex - window + 1;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < window; i++) {
    const x = i;
    const y = candles[start + i].close;

    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator =
    window * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  const slope =
    (window * sumXY - sumX * sumY) /
    denominator;

  const averagePrice = sumY / window;

  if (averagePrice === 0) {
    return 0;
  }

  return slope / averagePrice;
}

/**
 * Build only the features needed by this experiment.
 *
 * Acceleration = short slope - long slope.
 */
function buildObservations(
  market: RawMarket,
  onProgress: (processed: number, total: number) => void,
): Observation[] {
  const candles = market.candles;

  const total =
    candles.length - MIN_LOOKBACK - MAX_FORWARD_MINUTES;

  if (total <= 0) {
    return [];
  }

  const observations = new Array<Observation>(total);

  let outputIndex = 0;

  for (
    let index = MIN_LOOKBACK;
    index < candles.length - MAX_FORWARD_MINUTES;
    index++
  ) {
    const slope20 = calculateSlope(candles, index, 20);
    const slope50 = calculateSlope(candles, index, 50);

    observations[outputIndex++] = {
      index,
      slope20,
      acceleration: slope20 - slope50,
    };

    if (
      outputIndex % 10000 === 0 ||
      outputIndex === total
    ) {
      onProgress(outputIndex, total);
    }
  }

  return observations;
}

function getThresholds(
  observations: Observation[],
): {
  slopeThreshold: number;
  accelerationThreshold: number;
} {
  const slopes = new Array<number>(observations.length);
  const accelerations = new Array<number>(observations.length);

  for (let i = 0; i < observations.length; i++) {
    slopes[i] = observations[i].slope20;
    accelerations[i] = observations[i].acceleration;
  }

  return {
    slopeThreshold: percentile(
      slopes,
      SLOPE_PERCENTILE,
    ),
    accelerationThreshold: percentile(
      accelerations,
      ACCELERATION_PERCENTILE,
    ),
  };
}

function isEntry(
  observation: Observation,
  thresholds: {
    slopeThreshold: number;
    accelerationThreshold: number;
  },
): boolean {
  return (
    observation.slope20 <= thresholds.slopeThreshold &&
    observation.acceleration >= thresholds.accelerationThreshold
  );
}

/**
 * Simulate one market without creating trade objects.
 *
 * Execution uses candle CLOSE only, consistent with the previous
 * backtesting methodology.
 */
function evaluateMarket(
  market: RawMarket,
  observations: Observation[],
  startObservation: number,
  endObservation: number,
  thresholds: {
    slopeThreshold: number;
    accelerationThreshold: number;
  },
  parameters: StrategyParameters,
): TradeResult {
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let totalReturn = 0;

  let nextAvailableIndex = -1;

  for (
    let observationPosition = startObservation;
    observationPosition < endObservation;
    observationPosition++
  ) {
    const observation = observations[observationPosition];

    if (observation.index < nextAvailableIndex) {
      continue;
    }

    if (!isEntry(observation, thresholds)) {
      continue;
    }

    const entryIndex = observation.index;
    const entryPrice = market.candles[entryIndex].close;

    let exitIndex =
      Math.min(
        entryIndex + parameters.maxHold,
        market.candles.length - 1,
      );

    let exitPrice = market.candles[exitIndex].close;

    let reason: "tp" | "sl" | "time" = "time";

    for (
      let offset = 1;
      offset <= parameters.maxHold;
      offset++
    ) {
      const currentIndex = entryIndex + offset;

      if (currentIndex >= market.candles.length) {
        break;
      }

      const currentPrice =
        market.candles[currentIndex].close;

      const grossReturn =
        (currentPrice - entryPrice) / entryPrice;

      if (grossReturn >= parameters.takeProfit) {
        exitIndex = currentIndex;
        exitPrice = currentPrice;
        reason = "tp";
        break;
      }

      if (grossReturn <= -parameters.stopLoss) {
        exitIndex = currentIndex;
        exitPrice = currentPrice;
        reason = "sl";
        break;
      }
    }

    const grossReturn =
      (exitPrice - entryPrice) / entryPrice;

    const netReturn =
      grossReturn - TOTAL_COST;

    trades++;
    totalReturn += netReturn;

    if (
      reason === "tp" ||
      netReturn > 0
    ) {
      wins++;
    } else {
      losses++;
    }

    nextAvailableIndex = exitIndex + 1;
  }

  return {
    trades,
    wins,
    losses,
    totalReturn,
    averageReturn:
      trades > 0 ? totalReturn / trades : 0,
    winRate:
      trades > 0 ? wins / trades : 0,
  };
}

function combineResults(
  target: TradeResult,
  source: TradeResult,
): void {
  target.trades += source.trades;
  target.wins += source.wins;
  target.losses += source.losses;
  target.totalReturn += source.totalReturn;
}

function finaliseResult(
  result: TradeResult,
): TradeResult {
  return {
    ...result,
    averageReturn:
      result.trades > 0
        ? result.totalReturn / result.trades
        : 0,
    winRate:
      result.trades > 0
        ? result.wins / result.trades
        : 0,
  };
}

function evaluateDataset(
  markets: RawMarket[],
  observationsByMarket: Observation[][],
  thresholds: {
    slopeThreshold: number;
    accelerationThreshold: number;
  },
  parameters: StrategyParameters,
  datasetStartRatio: number,
  datasetEndRatio: number,
): TradeResult {
  const combined: TradeResult = {
    trades: 0,
    wins: 0,
    losses: 0,
    totalReturn: 0,
    averageReturn: 0,
    winRate: 0,
  };

  for (let marketIndex = 0; marketIndex < markets.length; marketIndex++) {
    const observations = observationsByMarket[marketIndex];

    if (observations.length === 0) {
      continue;
    }

    const start =
      Math.floor(observations.length * datasetStartRatio);

    const end =
      Math.floor(observations.length * datasetEndRatio);

    const result = evaluateMarket(
      markets[marketIndex],
      observations,
      start,
      end,
      thresholds,
      parameters,
    );

    combineResults(combined, result);
  }

  return finaliseResult(combined);
}

function findBestValidationStrategy(
  markets: RawMarket[],
  observationsByMarket: Observation[][],
  thresholds: {
    slopeThreshold: number;
    accelerationThreshold: number;
  },
): Evaluation {
  const candidates =
    TAKE_PROFITS.length *
    STOP_LOSSES.length *
    MAX_HOLDS.length;

  let candidateNumber = 0;

  let best: Evaluation | null = null;

  for (const takeProfit of TAKE_PROFITS) {
    for (const stopLoss of STOP_LOSSES) {
      for (const maxHold of MAX_HOLDS) {
        candidateNumber++;

        const parameters = {
          takeProfit,
          stopLoss,
          maxHold,
        };

        const result = evaluateDataset(
          markets,
          observationsByMarket,
          thresholds,
          parameters,
          TRAIN_RATIO,
          TRAIN_RATIO + VALIDATION_RATIO,
        );

        if (
          best === null ||
          result.totalReturn > best.result.totalReturn
        ) {
          best = {
            parameters,
            result,
          };
        }

        if (
          candidateNumber % 10 === 0 ||
          candidateNumber === candidates
        ) {
          progress(
            `Validation ${candidateNumber}/${candidates} | ` +
            `best return ${(best?.result.totalReturn ?? 0) * 100}` +
            `%`,
          );
        }
      }
    }
  }

  if (best === null) {
    throw new Error("No validation strategy found");
  }

  return best;
}

async function main(): Promise<void> {
  const sourcePath = path.join(
    OUTPUT_DIR,
    SOURCE_FILE,
  );

  progress(`Loading existing dataset: ${SOURCE_FILE}`);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Dataset not found: ${sourcePath}`,
    );
  }

  const dataset =
    JSON.parse(
      fs.readFileSync(sourcePath, "utf8"),
    ) as RawDataset;

  progress(
    `Loaded ${dataset.markets.length} markets`,
  );

  let totalCandles = 0;

  for (const market of dataset.markets) {
    totalCandles += market.candles.length;
  }

  progress(
    `Total candles: ${totalCandles.toLocaleString()}`,
  );

  console.log("");
  progress(
    "Building observations from existing candles...",
  );

  const observationsByMarket: Observation[][] = [];

  let totalObservations = 0;

  for (
    let marketIndex = 0;
    marketIndex < dataset.markets.length;
    marketIndex++
  ) {
    const market = dataset.markets[marketIndex];

    progress(
      `Market ${marketIndex + 1}/${dataset.markets.length}: ` +
      `${market.symbol} (${market.candles.length.toLocaleString()} candles)`,
    );

    const observations =
      buildObservations(
        market,
        (processed, total) => {
          if (
            processed === total ||
            processed % 50000 === 0
          ) {
            progress(
              `  ${market.symbol}: ` +
              `${processed.toLocaleString()}/` +
              `${total.toLocaleString()} observations`,
            );
          }
        },
      );

    observationsByMarket.push(observations);

    totalObservations += observations.length;

    progress(
      `  ${market.symbol}: complete`,
    );
  }

  progress(
    `Observation building complete: ` +
    `${totalObservations.toLocaleString()} observations`,
  );

  console.log("");
  progress(
    "Calculating TRAIN-only entry thresholds...",
  );

  const trainingObservations: Observation[] = [];

  for (
    let marketIndex = 0;
    marketIndex < observationsByMarket.length;
    marketIndex++
  ) {
    const observations =
      observationsByMarket[marketIndex];

    const trainingEnd =
      Math.floor(
        observations.length * TRAIN_RATIO,
      );

    for (let i = 0; i < trainingEnd; i++) {
      trainingObservations.push(
        observations[i],
      );
    }
  }

  const thresholds =
    getThresholds(trainingObservations);

  progress(
    `TRAIN slope20 P20: ${thresholds.slopeThreshold}`,
  );

  progress(
    `TRAIN acceleration P80: ${thresholds.accelerationThreshold}`,
  );

  console.log("");
  progress(
    "Searching exit parameters on VALIDATION only...",
  );

  const best =
    findBestValidationStrategy(
      dataset.markets,
      observationsByMarket,
      thresholds,
    );

  progress(
    `Best validation strategy: ` +
    `TP=${best.parameters.takeProfit * 100}% ` +
    `SL=${best.parameters.stopLoss * 100}% ` +
    `hold=${best.parameters.maxHold}m`,
  );

  progress(
    `Validation trades: ${best.result.trades.toLocaleString()}`,
  );

  progress(
    `Validation return: ${(best.result.totalReturn * 100).toFixed(3)}%`,
  );

  progress(
    `Validation win rate: ${(best.result.winRate * 100).toFixed(2)}%`,
  );

  console.log("");
  progress(
    "Evaluating frozen strategy on TRAIN...",
  );

  const trainResult =
    evaluateDataset(
      dataset.markets,
      observationsByMarket,
      thresholds,
      best.parameters,
      0,
      TRAIN_RATIO,
    );

  progress(
    `TRAIN return: ${(trainResult.totalReturn * 100).toFixed(3)}% | ` +
    `trades: ${trainResult.trades.toLocaleString()} | ` +
    `win rate: ${(trainResult.winRate * 100).toFixed(2)}%`,
  );

  console.log("");
  progress(
    "Evaluating frozen strategy on VALIDATION...",
  );

  const validationResult =
    evaluateDataset(
      dataset.markets,
      observationsByMarket,
      thresholds,
      best.parameters,
      TRAIN_RATIO,
      TRAIN_RATIO + VALIDATION_RATIO,
    );

  progress(
    `VALIDATION return: ${(validationResult.totalReturn * 100).toFixed(3)}% | ` +
    `trades: ${validationResult.trades.toLocaleString()} | ` +
    `win rate: ${(validationResult.winRate * 100).toFixed(2)}%`,
  );

  console.log("");
  progress(
    "Evaluating frozen strategy on untouched TEST...",
  );

  const testResult =
    evaluateDataset(
      dataset.markets,
      observationsByMarket,
      thresholds,
      best.parameters,
      TRAIN_RATIO + VALIDATION_RATIO,
      1,
    );

  progress(
    `TEST return: ${(testResult.totalReturn * 100).toFixed(3)}% | ` +
    `trades: ${testResult.trades.toLocaleString()} | ` +
    `win rate: ${(testResult.winRate * 100).toFixed(2)}%`,
  );

  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: SOURCE_FILE,
    methodology: {
      trainRatio: TRAIN_RATIO,
      validationRatio: VALIDATION_RATIO,
      testRatio:
        1 - TRAIN_RATIO - VALIDATION_RATIO,
      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,
      totalCost: TOTAL_COST,
      execution: "candle-close",
      overlappingPositions: false,
    },
    dataset: {
      markets: dataset.markets.length,
      candles: totalCandles,
      observations: totalObservations,
    },
    entrySignal: {
      slopePercentile: SLOPE_PERCENTILE,
      accelerationPercentile:
        ACCELERATION_PERCENTILE,
      slopeThreshold:
        thresholds.slopeThreshold,
      accelerationThreshold:
        thresholds.accelerationThreshold,
    },
    selectedParameters:
      best.parameters,
    train: trainResult,
    validation: validationResult,
    test: testResult,
  };

  const outputPath = path.join(
    OUTPUT_DIR,
    `strategy-backtest-${Date.now()}.json`,
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(output, null, 2),
  );

  console.log("");
  progress(
    `RESULT SAVED: ${outputPath}`,
  );

  progress(
    `Total runtime: ` +
    `${((Date.now() - startTime) / 1000).toFixed(1)} seconds`,
  );
}

main().catch((error) => {
  console.error("");
  console.error("RESEARCH FAILED");
  console.error(error);
  process.exit(1);
});

