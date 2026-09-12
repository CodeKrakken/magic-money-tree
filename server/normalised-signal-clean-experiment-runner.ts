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

interface MarketData {
  symbol: string;
  candles: Candle[];
}

interface Dataset {
  markets: MarketData[];
}

type Strategy = "raw" | "normalised_slope" | "normalised_slope_acceleration";

interface Signal {
  symbol: string;
  index: number;
  time: number;
  entryPrice: number;
  slope20: number;
  slope50: number;
  acceleration: number;
  normalisedSlope20: number;
  normalisedSlope50: number;
  normalisedAcceleration: number;
  score: number;
}

interface Target {
  name: string;
  returnPct: number;
  fraction: number;
}

interface Exit {
  time: number;
  price: number;
  quantity: number;
  fee: number;
  netProceeds: number;
  target: string;
}

interface Position {
  symbol: string;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  entryValue: number;
  entryFee: number;
  exits: Exit[];
  finalExitTime: number;
  realisedNet: number;
  remainingQuantity: number;
  unrealisedGross: number;
  score: number;
}

interface BacktestResult {
  universe: string;
  strategy: Strategy;
  candidateSignals: number;
  acceptedSignals: number;
  completedPositions: number;
  openPositions: number;
  winningPositions: number;
  losingPositions: number;
  winRate: number;
  realisedGross: number;
  realisedFees: number;
  realisedNet: number;
  unrealisedGross: number;
  combinedNet: number;
  profitFactor: number;
  minimumStartingCash: number;
  peakCapitalDeployed: number;
  averageCapitalDeployed: number;
  finalEquity: number;
  totalReturn: number;
  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;
  returnOnPeakCapital: number;
  returnOnAverageCapital: number;
  annualisedCapitalEfficiency: number;
  averageHoldMinutes: number;
  medianHoldMinutes: number;
  maxOpenPositions: number;
  maxOpenMarkets: number;
}

interface ForwardStats {
  observations: number;
  meanReturnPct: number;
  medianReturnPct: number;
  positiveReturnRate: number;
  meanMfePct: number;
  medianMfePct: number;
  meanMaePct: number;
  medianMaePct: number;
  target1Rate: number;
  target2Rate: number;
  target4Rate: number;
  stopRate: number;
}

interface SignalDiagnostic {
  candidateSignals: number;
  forward: Record<string, ForwardStats>;
  meanSlope20: number;
  meanNormalisedSlope20: number;
  meanAcceleration: number;
  meanNormalisedAcceleration: number;
  scoreVs20mReturn: number;
  scoreVs50mReturn: number;
  normalisedSlopeVs20mReturn: number;
  normalisedAccelerationVs20mReturn: number;
}

interface ThresholdCalibration {
  rawSlopeThreshold: number;
  rawAccelerationThreshold: number;
  normalisedSlopeThreshold: number;
  normalisedAccelerationThreshold: number;
  slopePercentile: number;
  accelerationPercentile: number;
  trainingCandidateSignals: number;
}

interface PeriodResult {
  startTime: number;
  endTime: number;
  strategies: Record<Strategy, {
    diagnostic: SignalDiagnostic;
    backtest: BacktestResult;
  }>;
}

interface DatasetExperiment {
  dataset: string;
  markets: number;
  periods: {
    training: PeriodResult;
    validation: PeriodResult;
    test: PeriodResult;
  };
  calibration: ThresholdCalibration;
}

interface ExperimentOutput {
  generatedAt: string;
  methodology: {
    purpose: string;
    positionNotional: number;
    minimumTransactionNotional: number;
    capacity: number;
    feeRate: number;
    executionCost: number;
    rawSlopeThreshold: number;
    rawAccelerationThreshold: number;
    targets: Target[];
    stopPct: number;
    maxHoldMinutes: number;
    normalisation: string;
    splitMethod: string;
    splitLeakageProtection: string;
    forwardHorizonsMinutes: number[];
    strategies: Strategy[];
  };
  datasets: {
    original: DatasetExperiment;
    oos: DatasetExperiment;
  };
}

interface MarketIndicators {
  slope20: number[];
  slope50: number[];
  acceleration: number[];
  normalisedSlope20: number[];
  normalisedSlope50: number[];
  normalisedAcceleration: number[];
}

interface ForwardLookup {
  indices: Map<number, number>;
  maxHigh: number[];
  minLow: number[];
}

const OUTPUT_DIR = path.join(process.cwd(), "server", "research-output");

const ORIGINAL_DATASET_PATH = path.join(
  OUTPUT_DIR,
  "ema-data-1789061547934.json"
);

const OOS_DATASET_GLOB_PREFIX = "ema-data-oos-60-";

const POSITION_NOTIONAL = 10;
const MINIMUM_TRANSACTION_NOTIONAL = 10;
const POSITION_CAPACITY = 43;

const FEE_RATE = 0.001;
const EXECUTION_COST = 0;

const RAW_SLOPE_THRESHOLD = -0.0001425851160546487;
const RAW_ACCELERATION_THRESHOLD =
  0.00013986740450809692 * 1.30;

const TARGETS: Target[] = [
  { name: "target_1pct", returnPct: 0.01, fraction: 0.50 },
  { name: "target_2pct", returnPct: 0.02, fraction: 0.25 },
  { name: "target_4pct", returnPct: 0.04, fraction: 0.25 },
];

const STOP_PCT = 0.10;
const MAX_HOLD_MINUTES = 48 * 60;

const FORWARD_HORIZONS = [5, 10, 20, 50, 120, 360, 720, 1440, 2880];

const SHORT_WINDOW = 20;
const LONG_WINDOW = 50;

const TRAIN_FRACTION = 0.60;
const VALIDATION_FRACTION = 0.20;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function calculateFee(value: number): number {
  return value * (FEE_RATE + EXECUTION_COST);
}

function correlation(xs: number[], ys: number[]): number {
  const length = Math.min(xs.length, ys.length);
  if (length < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < length; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }

  const meanX = sumX / length;
  const meanY = sumY / length;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (let i = 0; i < length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }

  const denominator = Math.sqrt(denominatorX * denominatorY);
  return denominator === 0 ? 0 : numerator / denominator;
}

function buildRegressionSlopes(
  closes: number[],
  windowSize: number
): number[] {
  const n = closes.length;
  const prefixY = new Float64Array(n + 1);
  const prefixIndexY = new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    prefixY[i + 1] = prefixY[i] + closes[i];
    prefixIndexY[i + 1] =
      prefixIndexY[i] + i * closes[i];
  }

  const sumX = (windowSize * (windowSize - 1)) / 2;
  const sumXX =
    ((windowSize - 1) * windowSize * (2 * windowSize - 1)) / 6;
  const denominator = windowSize * sumXX - sumX * sumX;
  const slopes = new Float64Array(n);

  for (let end = windowSize - 1; end < n; end++) {
    const start = end - windowSize + 1;
    const sumY = prefixY[end + 1] - prefixY[start];
    const weightedSum =
      prefixIndexY[end + 1] - prefixIndexY[start];
    const sumXY = weightedSum - start * sumY;

    slopes[end] =
      (windowSize * sumXY - sumX * sumY) / denominator;
  }

  return Array.from(slopes);
}

function buildIndicators(candles: Candle[]): MarketIndicators {
  const closes = candles.map(candle => candle.close);
  const slope20 = buildRegressionSlopes(closes, SHORT_WINDOW);
  const slope50 = buildRegressionSlopes(closes, LONG_WINDOW);

  const acceleration = new Float64Array(candles.length);
  const normalisedSlope20 = new Float64Array(candles.length);
  const normalisedSlope50 = new Float64Array(candles.length);
  const normalisedAcceleration = new Float64Array(candles.length);

  for (let i = LONG_WINDOW - 1; i < candles.length; i++) {
    const price = candles[i].close;
    if (price <= 0) continue;

    const accel = slope20[i] - slope50[i];
    acceleration[i] = accel;
    normalisedSlope20[i] = slope20[i] / price;
    normalisedSlope50[i] = slope50[i] / price;
    normalisedAcceleration[i] = accel / price;
  }

  return {
    slope20,
    slope50,
    acceleration: Array.from(acceleration),
    normalisedSlope20: Array.from(normalisedSlope20),
    normalisedSlope50: Array.from(normalisedSlope50),
    normalisedAcceleration: Array.from(normalisedAcceleration),
  };
}

function buildCandidateSignals(
  market: MarketData,
  indicators: MarketIndicators,
  strategy: Strategy,
  slopeThreshold: number,
  accelerationThreshold: number,
  startTime: number,
  endTime: number
): Signal[] {
  const signals: Signal[] = [];
  const { candles } = market;

  for (let i = LONG_WINDOW - 1; i < candles.length; i++) {
    const time = candles[i].openTime;
    if (time < startTime || time >= endTime) continue;

    const price = candles[i].close;
    if (price <= 0) continue;

    const slope20 = indicators.slope20[i];
    const slope50 = indicators.slope50[i];
    const acceleration = indicators.acceleration[i];
    const normalisedSlope20 = indicators.normalisedSlope20[i];
    const normalisedSlope50 = indicators.normalisedSlope50[i];
    const normalisedAcceleration =
      indicators.normalisedAcceleration[i];

    const selectedSlope =
      strategy === "raw"
        ? slope20
        : normalisedSlope20;

    const selectedAcceleration =
      strategy === "raw"
        ? acceleration
        : normalisedAcceleration;

    if (selectedSlope > slopeThreshold) {
      continue;
    }

    if (
      strategy !== "normalised_slope" &&
      selectedAcceleration < accelerationThreshold
    ) {
      continue;
    }

    let score: number;

    if (strategy === "normalised_slope") {
      score = Math.abs(selectedSlope / slopeThreshold);
    } else {
      const slopeStrength =
        Math.abs(selectedSlope / slopeThreshold);
      const accelerationStrength =
        selectedAcceleration / accelerationThreshold;
      score = slopeStrength + accelerationStrength;
    }

    signals.push({
      symbol: market.symbol,
      index: i,
      time,
      entryPrice: price,
      slope20,
      slope50,
      acceleration,
      normalisedSlope20,
      normalisedSlope50,
      normalisedAcceleration,
      score,
    });
  }

  return signals;
}

function findIndexAtOrAfter(
  candles: Candle[],
  targetTime: number,
  startIndex: number
): number {
  let low = Math.max(0, startIndex);
  let high = candles.length - 1;

  if (low > high || candles[high].openTime < targetTime) {
    return -1;
  }

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].openTime >= targetTime) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return candles[low].openTime >= targetTime ? low : -1;
}

interface ForwardObservation {
  returnPct: number;
  mfePct: number;
  maePct: number;
  target1: boolean;
  target2: boolean;
  target4: boolean;
  stop: boolean;
}

interface HorizonLookup {
  closeIndex: Int32Array;
  maxHigh: Float64Array;
  minLow: Float64Array;
}

type ForwardLookup = Map<number, HorizonLookup>;

function findIndexAtOrBefore(
  candles: Candle[],
  targetTime: number
): number {
  let low = 0;
  let high = candles.length - 1;

  if (
    high < 0 ||
    candles[0].openTime > targetTime
  ) {
    return -1;
  }

  while (low < high) {
    const middle =
      Math.ceil((low + high) / 2);

    if (
      candles[middle].openTime <= targetTime
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return candles[low].openTime <= targetTime
    ? low
    : -1;
}

function buildForwardLookup(
  candles: Candle[],
  periodEndTime: number
): ForwardLookup {
  const lookup: ForwardLookup = new Map();

  for (const horizon of FORWARD_HORIZONS) {
    const n = candles.length;
    const closeIndex = new Int32Array(n);
    const maxHigh = new Float64Array(n);
    const minLow = new Float64Array(n);

    closeIndex.fill(-1);
    maxHigh.fill(NaN);
    minLow.fill(NaN);

    /*
     * For each starting candle, find the first candle at or after
     * startTime + horizon. Because both i and j only move forward,
     * this is O(n), not O(n log n).
     */
    let right = 0;
    const maxDeque = new Int32Array(n);
    const minDeque = new Int32Array(n);
    let maxHead = 0;
    let maxTail = 0;
    let minHead = 0;
    let minTail = 0;

    for (let i = 0; i < n; i++) {
      const targetTime =
        candles[i].openTime +
        horizon * 60_000;

      while (
        right < n &&
        candles[right].openTime < targetTime
      ) {
        while (
          maxTail > maxHead &&
          candles[
            maxDeque[maxTail - 1]
          ].high <= candles[right].high
        ) {
          maxTail--;
        }
        maxDeque[maxTail++] = right;

        while (
          minTail > minHead &&
          candles[
            minDeque[minTail - 1]
          ].low >= candles[right].low
        ) {
          minTail--;
        }
        minDeque[minTail++] = right;

        right++;
      }

      if (
        right >= n ||
        right <= i ||
        candles[right].openTime >= periodEndTime
      ) {
        continue;
      }

      /*
       * Include the horizon candle itself in MFE/MAE, while keeping
       * the first candle at/after the requested horizon as the close.
       * Each candle is inserted into the deques only once.
       */
      while (
        maxTail > maxHead &&
        candles[
          maxDeque[maxTail - 1]
        ].high <= candles[right].high
      ) {
        maxTail--;
      }
      maxDeque[maxTail++] = right;

      while (
        minTail > minHead &&
        candles[
          minDeque[minTail - 1]
        ].low >= candles[right].low
      ) {
        minTail--;
      }
      minDeque[minTail++] = right;

      closeIndex[i] = right;
      right++;

      if (
        maxHead < maxTail &&
        maxDeque[maxHead] > i
      ) {
        maxHigh[i] =
          candles[maxDeque[maxHead]].high;
      }

      if (
        minHead < minTail &&
        minDeque[minHead] > i
      ) {
        minLow[i] =
          candles[minDeque[minHead]].low;
      }

    }

    lookup.set(horizon, {
      closeIndex,
      maxHigh,
      minLow,
    });
  }

  return lookup;
}

function analyseSignalForwardPath(
  market: MarketData,
  signal: Signal,
  periodEndTime: number,
  lookup: ForwardLookup
): Map<number, ForwardObservation> {
  const result = new Map<number, ForwardObservation>();

  for (const horizon of FORWARD_HORIZONS) {
    const horizonLookup = lookup.get(horizon)!;
    const closeIndex =
      horizonLookup.closeIndex[signal.index];

    if (closeIndex < 0) continue;

    const closeCandle =
      market.candles[closeIndex];

    if (closeCandle.openTime >= periodEndTime) {
      continue;
    }

    const maxHigh =
      horizonLookup.maxHigh[signal.index];
    const minLow =
      horizonLookup.minLow[signal.index];

    if (
      !Number.isFinite(maxHigh) ||
      !Number.isFinite(minLow)
    ) {
      continue;
    }

    const entryPrice = signal.entryPrice;

    result.set(horizon, {
      returnPct:
        (closeCandle.close / entryPrice - 1) * 100,
      mfePct:
        (maxHigh / entryPrice - 1) * 100,
      maePct:
        (minLow / entryPrice - 1) * 100,
      target1:
        maxHigh >= entryPrice * 1.01,
      target2:
        maxHigh >= entryPrice * 1.02,
      target4:
        maxHigh >= entryPrice * 1.04,
      stop:
        minLow <= entryPrice * 0.90,
    });
  }

  return result;
}

function buildDiagnostic(
  markets: MarketData[],
  strategy: Strategy,
  slopeThreshold: number,
  accelerationThreshold: number,
  startTime: number,
  endTime: number
): SignalDiagnostic {
  const returnsByHorizon = new Map<number, number[]>();
  const mfeByHorizon = new Map<number, number[]>();
  const maeByHorizon = new Map<number, number[]>();
  const target1ByHorizon = new Map<number, number>();
  const target2ByHorizon = new Map<number, number>();
  const target4ByHorizon = new Map<number, number>();
  const stopByHorizon = new Map<number, number>();
  const observationsByHorizon = new Map<number, number>();

  for (const horizon of FORWARD_HORIZONS) {
    returnsByHorizon.set(horizon, []);
    mfeByHorizon.set(horizon, []);
    maeByHorizon.set(horizon, []);
    target1ByHorizon.set(horizon, 0);
    target2ByHorizon.set(horizon, 0);
    target4ByHorizon.set(horizon, 0);
    stopByHorizon.set(horizon, 0);
    observationsByHorizon.set(horizon, 0);
  }

  const slopes: number[] = [];
  const normalisedSlopes: number[] = [];
  const accelerations: number[] = [];
  const normalisedAccelerations: number[] = [];
  const scores20: number[] = [];
  const returns20: number[] = [];
  const normalisedSlopes20: number[] = [];
  const normalisedAccelerations20: number[] = [];
  const scores50: number[] = [];
  const returns50: number[] = [];

  let candidateSignals = 0;

  for (const market of markets) {
    const indicators = buildIndicators(market.candles);
    const lookup = buildForwardLookup(
      market.candles,
      endTime
    );
    const signals = buildCandidateSignals(
      market,
      indicators,
      strategy,
      slopeThreshold,
      accelerationThreshold,
      startTime,
      endTime
    );

    candidateSignals += signals.length;

    for (const signal of signals) {
      slopes.push(signal.slope20);
      normalisedSlopes.push(signal.normalisedSlope20);
      accelerations.push(signal.acceleration);
      normalisedAccelerations.push(
        signal.normalisedAcceleration
      );

      const forward = analyseSignalForwardPath(
        market,
        signal,
        endTime,
        lookup
      );

      for (const [horizon, observation] of forward) {
        returnsByHorizon.get(horizon)!.push(
          observation.returnPct
        );
        mfeByHorizon.get(horizon)!.push(
          observation.mfePct
        );
        maeByHorizon.get(horizon)!.push(
          observation.maePct
        );
        observationsByHorizon.set(
          horizon,
          observationsByHorizon.get(horizon)! + 1
        );

        if (observation.target1) {
          target1ByHorizon.set(
            horizon,
            target1ByHorizon.get(horizon)! + 1
          );
        }
        if (observation.target2) {
          target2ByHorizon.set(
            horizon,
            target2ByHorizon.get(horizon)! + 1
          );
        }
        if (observation.target4) {
          target4ByHorizon.set(
            horizon,
            target4ByHorizon.get(horizon)! + 1
          );
        }
        if (observation.stop) {
          stopByHorizon.set(
            horizon,
            stopByHorizon.get(horizon)! + 1
          );
        }

        if (horizon === 20) {
          scores20.push(signal.score);
          returns20.push(observation.returnPct);
          normalisedSlopes20.push(
            signal.normalisedSlope20
          );
          normalisedAccelerations20.push(
            signal.normalisedAcceleration
          );
        }
        if (horizon === 50) {
          scores50.push(signal.score);
          returns50.push(observation.returnPct);
        }
      }
    }
  }

  const forward: Record<string, ForwardStats> = {};

  for (const horizon of FORWARD_HORIZONS) {
    const returns = returnsByHorizon.get(horizon)!;
    const mfes = mfeByHorizon.get(horizon)!;
    const maes = maeByHorizon.get(horizon)!;
    const observations = observationsByHorizon.get(horizon)!;

    forward[String(horizon)] = {
      observations,
      meanReturnPct: mean(returns),
      medianReturnPct: median(returns),
      positiveReturnRate: rate(
        returns.filter(value => value > 0).length,
        returns.length
      ),
      meanMfePct: mean(mfes),
      medianMfePct: median(mfes),
      meanMaePct: mean(maes),
      medianMaePct: median(maes),
      target1Rate: rate(
        target1ByHorizon.get(horizon)!,
        observations
      ),
      target2Rate: rate(
        target2ByHorizon.get(horizon)!,
        observations
      ),
      target4Rate: rate(
        target4ByHorizon.get(horizon)!,
        observations
      ),
      stopRate: rate(
        stopByHorizon.get(horizon)!,
        observations
      ),
    };
  }

  return {
    candidateSignals,
    forward,
    meanSlope20: mean(slopes),
    meanNormalisedSlope20: mean(normalisedSlopes),
    meanAcceleration: mean(accelerations),
    meanNormalisedAcceleration: mean(
      normalisedAccelerations
    ),
    scoreVs20mReturn: correlation(
      scores20,
      returns20
    ),
    scoreVs50mReturn: correlation(
      scores50,
      returns50
    ),
    normalisedSlopeVs20mReturn: correlation(
      normalisedSlopes20,
      returns20
    ),
    normalisedAccelerationVs20mReturn: correlation(
      normalisedAccelerations20,
      returns20
    ),
  };
}

function simulatePosition(
  candles: Candle[],
  signal: Signal,
  periodEndTime: number
): Position {
  const entryCandle = candles[signal.index];
  const entryPrice = entryCandle.close;
  const quantity = POSITION_NOTIONAL / entryPrice;
  const entryValue = quantity * entryPrice;
  const entryFee = calculateFee(entryValue);

  let remainingQuantity = quantity;
  let realisedNet = -entryFee;
  const exits: Exit[] = [];

  const naturalDeadline =
    entryCandle.openTime +
    MAX_HOLD_MINUTES * 60_000;

  const stopPrice = entryPrice * (1 - STOP_PCT);
  const targetPrices = TARGETS.map(
    target => entryPrice * (1 + target.returnPct)
  );
  const targetExecuted = TARGETS.map(() => false);

  let finalExitTime = periodEndTime;

  for (
    let i = signal.index + 1;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];

    if (candle.openTime >= periodEndTime) break;

    if (
      candle.openTime >= naturalDeadline &&
      naturalDeadline < periodEndTime
    ) {
      const quantitySold = remainingQuantity;

      if (quantitySold > 0) {
        const saleValue =
          quantitySold * candle.close;
        const exitFee =
          calculateFee(saleValue);
        const netSaleProceeds =
          saleValue - exitFee;

        realisedNet +=
          netSaleProceeds -
          quantitySold * entryPrice;

        exits.push({
          time: candle.openTime,
          price: candle.close,
          quantity: quantitySold,
          fee: exitFee,
          netProceeds: netSaleProceeds,
          target: "time_limit",
        });

        remainingQuantity = 0;
        finalExitTime = candle.openTime;
      }
      break;
    }

    if (candle.low <= stopPrice) {
      const quantitySold = remainingQuantity;
      const saleValue = quantitySold * stopPrice;
      const exitFee = calculateFee(saleValue);
      const netSaleProceeds = saleValue - exitFee;

      realisedNet +=
        netSaleProceeds -
        quantitySold * entryPrice;

      exits.push({
        time: candle.openTime,
        price: stopPrice,
        quantity: quantitySold,
        fee: exitFee,
        netProceeds: netSaleProceeds,
        target: "stop",
      });

      remainingQuantity = 0;
      finalExitTime = candle.openTime;
      break;
    }

    for (let targetIndex = 0; targetIndex < TARGETS.length; targetIndex++) {
      if (targetExecuted[targetIndex]) continue;
      if (remainingQuantity <= 1e-12) break;

      const target = TARGETS[targetIndex];
      if (candle.high < targetPrices[targetIndex]) continue;

      const quantitySold = Math.min(
        quantity * target.fraction,
        remainingQuantity
      );

      if (quantitySold <= 0) continue;

      const saleValue =
        quantitySold * targetPrices[targetIndex];
      const exitFee = calculateFee(saleValue);
      const netSaleProceeds = saleValue - exitFee;

      realisedNet +=
        netSaleProceeds -
        quantitySold * entryPrice;

      remainingQuantity -= quantitySold;
      targetExecuted[targetIndex] = true;

      exits.push({
        time: candle.openTime,
        price: targetPrices[targetIndex],
        quantity: quantitySold,
        fee: exitFee,
        netProceeds: netSaleProceeds,
        target: target.name,
      });

      if (remainingQuantity <= 1e-12) {
        remainingQuantity = 0;
        finalExitTime = candle.openTime;
        break;
      }
    }

    if (remainingQuantity <= 1e-12) break;


  }

  let markPrice = entryPrice;

  for (let i = signal.index + 1; i < candles.length; i++) {
    if (candles[i].openTime >= periodEndTime) break;
    markPrice = candles[i].close;
  }

  if (remainingQuantity <= 1e-12) {
    finalExitTime = exits[exits.length - 1]?.time ?? finalExitTime;
  }

  const unrealisedGross =
    remainingQuantity *
    (markPrice - entryPrice);

  return {
    symbol: signal.symbol,
    entryTime: signal.time,
    entryPrice,
    quantity,
    entryValue,
    entryFee,
    exits,
    finalExitTime,
    realisedNet,
    remainingQuantity,
    unrealisedGross,
    score: signal.score,
  };
}

function selectPositions(
  candidates: Position[],
  capacity: number
): Position[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.entryTime !== b.entryTime) {
      return a.entryTime - b.entryTime;
    }
    return b.score - a.score;
  });

  const active: Position[] = [];
  const accepted: Position[] = [];

  for (const candidate of sorted) {
    let writeIndex = 0;

    for (let i = 0; i < active.length; i++) {
      if (active[i].finalExitTime > candidate.entryTime) {
        active[writeIndex++] = active[i];
      }
    }
    active.length = writeIndex;

    if (active.length >= capacity) continue;

    accepted.push(candidate);
    active.push(candidate);
  }

  return accepted;
}

function portfolioAccounting(
  positions: Position[],
  markets: MarketData[],
  startTime: number,
  endTime: number
): {
  minimumStartingCash: number;
  peakCapitalDeployed: number;
  averageCapitalDeployed: number;
  finalEquity: number;
  finalCash: number;
  finalMarketValue: number;
  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
  maxOpenMarkets: number;
} {
  interface CashEvent {
    time: number;
    cashDelta: number;
    capitalDelta: number;
    positionDelta: number;
    marketDelta: number;
  }

  const events: CashEvent[] = [];

  for (const position of positions) {
    events.push({
      time: position.entryTime,
      cashDelta:
        -position.entryValue -
        position.entryFee,
      capitalDelta: position.entryValue,
      positionDelta: 1,
      marketDelta: position.entryValue,
    });

    for (const exit of position.exits) {
      events.push({
        time: exit.time,
        cashDelta: exit.netProceeds,
        capitalDelta:
          -exit.quantity * position.entryPrice,
        positionDelta:
          exit ===
          position.exits[
            position.exits.length - 1
          ]
            ? -1
            : 0,
        marketDelta: -exit.netProceeds,
      });
    }

    if (position.remainingQuantity > 0) {
      const markTime = Math.min(
        position.finalExitTime,
        endTime
      );

      events.push({
        time: markTime,
        cashDelta: 0,
        capitalDelta:
          -position.remainingQuantity *
          position.entryPrice,
        positionDelta: -1,
        marketDelta:
          position.remainingQuantity *
          (position.entryPrice +
            position.unrealisedGross),
      });
    }
  }

  events.sort((a, b) => a.time - b.time);

  let cash = 0;
  let capital = 0;
  let openPositions = 0;
  let openMarkets = new Set<string>();
  let maxCashDeficit = 0;
  let peakCapital = 0;
  let maxOpenPositions = 0;
  let maxOpenMarkets = 0;

  const equityPoints: Array<{
    time: number;
    cash: number;
  }> = [];

  let previousTime = startTime;
  let capitalArea = 0;

  const grouped = new Map<number, CashEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.time)) grouped.set(event.time, []);
    grouped.get(event.time)!.push(event);
  }

  const times = [...grouped.keys()].sort((a, b) => a - b);

  for (const time of times) {
    const boundedTime = Math.max(
      startTime,
      Math.min(endTime, time)
    );

    capitalArea +=
      capital * Math.max(0, boundedTime - previousTime);
    previousTime = boundedTime;

    const timeEvents = grouped.get(time)!;

    for (const event of timeEvents) {
      cash += event.cashDelta;
      capital += event.capitalDelta;
      openPositions += event.positionDelta;

      if (cash < maxCashDeficit) {
        maxCashDeficit = cash;
      }

      if (capital > peakCapital) {
        peakCapital = capital;
      }

      if (openPositions > maxOpenPositions) {
        maxOpenPositions = openPositions;
      }

      // Reconstruct market count directly from positions below rather
      // than trying to infer symbols from aggregated events.
    }

    equityPoints.push({
      time,
      cash,
    });
  }

  capitalArea +=
    capital * Math.max(0, endTime - previousTime);

  const durationMs = Math.max(1, endTime - startTime);
  const averageCapital =
    capitalArea / durationMs;

  let maxOpenMarketCount = 0;
  const allTimes = new Set<number>([
    startTime,
    endTime,
  ]);

  for (const position of positions) {
    allTimes.add(position.entryTime);
    allTimes.add(
      Math.min(position.finalExitTime, endTime)
    );
  }

  const sortedTimes = [...allTimes].sort((a, b) => a - b);

  for (const time of sortedTimes) {
    openMarkets = new Set(
      positions
        .filter(
          position =>
            position.entryTime <= time &&
            position.finalExitTime > time
        )
        .map(position => position.symbol)
    );

    if (openMarkets.size > maxOpenMarketCount) {
      maxOpenMarketCount = openMarkets.size;
    }
  }

  const startingCash = Math.max(
    MINIMUM_TRANSACTION_NOTIONAL,
    -maxCashDeficit
  );

  const finalCash = cash;

  const finalMarketValue = positions.reduce(
    (total, position) =>
      total + position.remainingQuantity *
        (
          position.entryPrice +
          position.unrealisedGross /
            Math.max(
              position.remainingQuantity,
              1e-12
            )
        ),
    0
  );

  const finalEquity =
    startingCash +
    finalCash +
    finalMarketValue;

  let runningPeak = startingCash;
  let maxDrawdownAbsolute = 0;
  let maxDrawdownPct = 0;

  const marketBySymbol = new Map(
    markets.map(market => [
      market.symbol,
      market,
    ])
  );

  const drawdownTimes = [
    startTime,
    ...equityPoints.map(point => point.time),
    endTime,
  ].sort((a, b) => a - b);

  for (const time of drawdownTimes) {
    const cashAtTime =
      [...equityPoints]
        .reverse()
        .find(point => point.time <= time)
        ?.cash ?? 0;

    let marketValue = 0;

    for (const position of positions) {
      if (
        position.entryTime > time ||
        position.finalExitTime <= time ||
        position.remainingQuantity <= 0
      ) {
        continue;
      }

      const market =
        marketBySymbol.get(position.symbol);

      if (!market) continue;

      const candleIndex =
        findIndexAtOrBefore(
          market.candles,
          time
        );

      if (candleIndex < 0) continue;

      marketValue +=
        position.remainingQuantity *
        market.candles[candleIndex].close;
    }

    const equity =
      startingCash +
      cashAtTime +
      marketValue;

    if (equity > runningPeak) {
      runningPeak = equity;
    }

    const drawdown =
      runningPeak - equity;

    if (drawdown > maxDrawdownAbsolute) {
      maxDrawdownAbsolute = drawdown;
    }

    if (runningPeak > 0) {
      maxDrawdownPct = Math.max(
        maxDrawdownPct,
        drawdown / runningPeak
      );
    }
  }

  return {
    minimumStartingCash: startingCash,
    peakCapitalDeployed: peakCapital,
    averageCapitalDeployed: averageCapital,
    finalEquity,
    finalCash,
    finalMarketValue,
    maxDrawdownAbsolute,
    maxDrawdownPct,
    maxOpenPositions,
    maxOpenMarkets: maxOpenMarketCount,
  };
}

function runBacktest(
  markets: MarketData[],
  strategy: Strategy,
  slopeThreshold: number,
  accelerationThreshold: number,
  startTime: number,
  endTime: number
): BacktestResult {
  let candidateSignals = 0;
  const candidatePositions: Position[] = [];

  for (const market of markets) {
    const indicators = buildIndicators(market.candles);
    const lookup = buildForwardLookup(
      market.candles,
      endTime
    );
    const signals = buildCandidateSignals(
      market,
      indicators,
      strategy,
      slopeThreshold,
      accelerationThreshold,
      startTime,
      endTime
    );

    candidateSignals += signals.length;

    for (const signal of signals) {
      candidatePositions.push(
        simulatePosition(
          market.candles,
          signal,
          endTime
        )
      );
    }
  }

  const positions = selectPositions(
    candidatePositions,
    POSITION_CAPACITY
  );

  const completedPositions = positions.filter(
    position => position.remainingQuantity <= 1e-12
  );

  const openPositions = positions.filter(
    position => position.remainingQuantity > 1e-12
  );

  let winningPositions = 0;
  let losingPositions = 0;
  let realisedGross = 0;
  let realisedFees = 0;
  let realisedNet = 0;

  const holdMinutes: number[] = [];

  for (const position of positions) {
    const gross =
      position.exits.reduce(
        (total, exit) =>
          total +
          exit.quantity *
            (exit.price -
              position.entryPrice),
        0
      );

    const fees =
      position.entryFee +
      position.exits.reduce(
        (total, exit) => total + exit.fee,
        0
      );

    realisedGross += gross;
    realisedFees += fees;
    realisedNet += position.realisedNet;

    if (position.realisedNet > 0) {
      winningPositions++;
    } else if (position.realisedNet < 0) {
      losingPositions++;
    }

    holdMinutes.push(
      (position.finalExitTime -
        position.entryTime) /
        60_000
    );
  }

  const unrealisedGross = positions.reduce(
    (total, position) =>
      total + position.unrealisedGross,
    0
  );

  const combinedNet =
    realisedNet + unrealisedGross;

  const grossWins = positions.reduce(
    (total, position) =>
      total +
      Math.max(0, position.realisedNet),
    0
  );
  const grossLosses = positions.reduce(
    (total, position) =>
      total +
      Math.min(0, position.realisedNet),
    0
  );

  const accounting = portfolioAccounting(
    positions,
    markets,
    startTime,
    endTime
  );

  const minimumStartingCash =
    Math.max(
      MINIMUM_TRANSACTION_NOTIONAL,
      accounting.minimumStartingCash
    );

  const totalReturn =
    minimumStartingCash > 0
      ? combinedNet / minimumStartingCash
      : 0;

  const returnOnPeakCapital =
    accounting.peakCapitalDeployed > 0
      ? combinedNet /
        accounting.peakCapitalDeployed
      : 0;

  const returnOnAverageCapital =
    accounting.averageCapitalDeployed > 0
      ? combinedNet /
        accounting.averageCapitalDeployed
      : 0;

  const years =
    (endTime - startTime) /
    (365.25 * 24 * 60 * 60 * 1000);

  const annualisedCapitalEfficiency =
    years > 0
      ? Math.pow(
          Math.max(
            0,
            1 + returnOnAverageCapital
          ),
          1 / years
        ) - 1
      : 0;

  return {
    universe: "",
    strategy,
    candidateSignals,
    acceptedSignals: positions.length,
    completedPositions: completedPositions.length,
    openPositions: openPositions.length,
    winningPositions,
    losingPositions,
    winRate: rate(
      winningPositions,
      completedPositions.length
    ),
    realisedGross,
    realisedFees,
    realisedNet,
    unrealisedGross,
    combinedNet,
    profitFactor:
      grossLosses < 0
        ? grossWins / Math.abs(grossLosses)
        : grossWins > 0
          ? Infinity
          : 0,
    minimumStartingCash,
    peakCapitalDeployed:
      accounting.peakCapitalDeployed,
    averageCapitalDeployed:
      accounting.averageCapitalDeployed,
    finalEquity: accounting.finalEquity,
    totalReturn,
    maxDrawdownAbsolute:
      accounting.maxDrawdownAbsolute,
    maxDrawdownPct:
      accounting.maxDrawdownPct,
    returnOnPeakCapital,
    returnOnAverageCapital,
    annualisedCapitalEfficiency,
    averageHoldMinutes: mean(holdMinutes),
    medianHoldMinutes: median(holdMinutes),
    maxOpenPositions:
      accounting.maxOpenPositions,
    maxOpenMarkets:
      accounting.maxOpenMarkets,
  };
}

function loadDataset(filePath: string): Dataset {
  const parsed = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  ) as Dataset;

  if (
    !parsed ||
    !Array.isArray(parsed.markets)
  ) {
    throw new Error(
      `Invalid dataset: ${filePath}`
    );
  }

  return {
    markets: parsed.markets
      .filter(
        market =>
          Array.isArray(market.candles) &&
          market.candles.length >= LONG_WINDOW
      )
      .map(market => ({
        symbol: market.symbol,
        candles: market.candles,
      })),
  };
}

function findLatestOosDataset(): string {
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter(
      file =>
        file.startsWith(OOS_DATASET_GLOB_PREFIX) &&
        file.endsWith(".json")
    )
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No OOS dataset found with prefix ${OOS_DATASET_GLOB_PREFIX}`
    );
  }

  return path.join(
    OUTPUT_DIR,
    files[files.length - 1]
  );
}

function datasetTimeRange(
  dataset: Dataset
): { startTime: number; endTime: number } {
  let startTime = Infinity;
  let endTime = -Infinity;

  for (const market of dataset.markets) {
    if (market.candles.length === 0) continue;

    startTime = Math.min(
      startTime,
      market.candles[0].openTime
    );

    endTime = Math.max(
      endTime,
      market.candles[
        market.candles.length - 1
      ].openTime
    );
  }

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new Error("Dataset contains no usable candles");
  }

  return { startTime, endTime };
}

function splitPeriods(
  dataset: Dataset
): {
  training: [number, number];
  validation: [number, number];
  test: [number, number];
} {
  const { startTime, endTime } =
    datasetTimeRange(dataset);

  const duration = endTime - startTime;
  const trainEnd =
    startTime + duration * TRAIN_FRACTION;
  const validationEnd =
    startTime +
    duration *
      (TRAIN_FRACTION + VALIDATION_FRACTION);

  return {
    training: [
      startTime,
      trainEnd,
    ],
    validation: [
      trainEnd,
      validationEnd,
    ],
    test: [
      validationEnd,
      endTime + 60_000,
    ],
  };
}

function collectTrainingCalibration(
  markets: MarketData[],
  startTime: number,
  endTime: number
): ThresholdCalibration {
  const rawSlopeValues: number[] = [];
  const rawAccelerationValues: number[] = [];
  const normalisedSlopeValues: number[] = [];
  const normalisedAccelerationValues: number[] = [];

  let trainingCandidateSignals = 0;

  for (const market of markets) {
    const indicators = buildIndicators(market.candles);

    for (
      let i = LONG_WINDOW - 1;
      i < market.candles.length;
      i++
    ) {
      const time =
        market.candles[i].openTime;

      if (time < startTime || time >= endTime) {
        continue;
      }

      const price =
        market.candles[i].close;

      if (price <= 0) continue;

      const slope20 =
        indicators.slope20[i];
      const slope50 =
        indicators.slope50[i];
      const acceleration =
        indicators.acceleration[i];

      const normalisedSlope =
        indicators.normalisedSlope20[i];
      const normalisedAcceleration =
        indicators.normalisedAcceleration[i];

      rawSlopeValues.push(slope20);
      rawAccelerationValues.push(acceleration);
      normalisedSlopeValues.push(normalisedSlope);
      normalisedAccelerationValues.push(
        normalisedAcceleration
      );

      trainingCandidateSignals++;
    }
  }

  /*
   * The raw thresholds define the percentile positions we want to
   * preserve. The normalised thresholds are then derived only from
   * training observations.
   */
  const slopePercentile = rate(
    rawSlopeValues.filter(
      value => value <= RAW_SLOPE_THRESHOLD
    ).length,
    rawSlopeValues.length
  );

  const accelerationPercentile = rate(
    rawAccelerationValues.filter(
      value =>
        value <= RAW_ACCELERATION_THRESHOLD
    ).length,
    rawAccelerationValues.length
  );

  const normalisedSlopeThreshold =
    percentile(
      normalisedSlopeValues,
      slopePercentile
    );

  const normalisedAccelerationThreshold =
    percentile(
      normalisedAccelerationValues,
      accelerationPercentile
    );

  return {
    rawSlopeThreshold:
      RAW_SLOPE_THRESHOLD,
    rawAccelerationThreshold:
      RAW_ACCELERATION_THRESHOLD,
    normalisedSlopeThreshold,
    normalisedAccelerationThreshold,
    slopePercentile,
    accelerationPercentile,
    trainingCandidateSignals,
  };
}

function makePeriodResult(
  markets: MarketData[],
  startTime: number,
  endTime: number,
  calibration: ThresholdCalibration
): PeriodResult {
  const strategyConfigs: Array<[
    Strategy,
    number,
    number
  ]> = [
    [
      "raw",
      calibration.rawSlopeThreshold,
      calibration.rawAccelerationThreshold,
    ],
    [
      "normalised_slope",
      calibration.normalisedSlopeThreshold,
      Infinity,
    ],
    [
      "normalised_slope_acceleration",
      calibration.normalisedSlopeThreshold,
      calibration.normalisedAccelerationThreshold,
    ],
  ];

  const strategies = {} as PeriodResult["strategies"];

  for (const [
    strategy,
    slopeThreshold,
    accelerationThreshold,
  ] of strategyConfigs) {
    console.log(
      `    ${strategy}: diagnostic`
    );

    const diagnostic =
      buildDiagnostic(
        markets,
        strategy,
        slopeThreshold,
        accelerationThreshold,
        startTime,
        endTime
      );

    console.log(
      `    ${strategy}: backtest`
    );

    const backtest =
      runBacktest(
        markets,
        strategy,
        slopeThreshold,
        accelerationThreshold,
        startTime,
        endTime
      );

    strategies[strategy] = {
      diagnostic,
      backtest,
    };
  }

  return {
    startTime,
    endTime,
    strategies,
  };
}

function main(): void {
  console.log("=".repeat(72));
  console.log(
    "Leakage-free normalised signal experiment"
  );
  console.log("=".repeat(72));

  const originalPath =
    ORIGINAL_DATASET_PATH;
  const oosPath =
    findLatestOosDataset();

  const datasets = [
    {
      name: "original",
      path: originalPath,
    },
    {
      name: "oos",
      path: oosPath,
    },
  ] as const;

  const output = {
    generatedAt:
      new Date().toISOString(),
    methodology: {
      purpose:
        "Compare raw, normalised-slope, and normalised-slope-plus-acceleration entry signals without allowing portfolio positions or forward diagnostics to cross chronological split boundaries.",
      positionNotional: POSITION_NOTIONAL,
      minimumTransactionNotional:
        MINIMUM_TRANSACTION_NOTIONAL,
      capacity: POSITION_CAPACITY,
      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,
      rawSlopeThreshold:
        RAW_SLOPE_THRESHOLD,
      rawAccelerationThreshold:
        RAW_ACCELERATION_THRESHOLD,
      targets: TARGETS,
      stopPct: STOP_PCT,
      maxHoldMinutes:
        MAX_HOLD_MINUTES,
      normalisation:
        "Regression slope divided by the candle close price, producing fractional price movement per minute.",
      splitMethod:
        "Chronological 60% training, 20% validation, 20% test.",
      splitLeakageProtection:
        "Signals may use historical candles before the period start for indicator lookback, but simulations and forward diagnostics are hard-clipped at the period end. Positions open at the boundary are marked to the final in-period close and cannot consume later candles.",
      forwardHorizonsMinutes:
        FORWARD_HORIZONS,
      strategies: [
        "raw",
        "normalised_slope",
        "normalised_slope_acceleration",
      ],
    },
    datasets: {} as ExperimentOutput["datasets"],
  } satisfies ExperimentOutput;

  for (const datasetConfig of datasets) {
    console.log(
      `\nLoading ${datasetConfig.name}: ${datasetConfig.path}`
    );

    const dataset =
      loadDataset(datasetConfig.path);

    const periods =
      splitPeriods(dataset);

    console.log(
      `  Markets: ${dataset.markets.length}`
    );

    console.log(
      `  Training: ${new Date(
        periods.training[0]
      ).toISOString()} -> ${new Date(
        periods.training[1]
      ).toISOString()}`
    );

    console.log(
      "  Calibrating normalised thresholds from training only..."
    );

    const calibration =
      collectTrainingCalibration(
        dataset.markets,
        periods.training[0],
        periods.training[1]
      );

    console.log(
      `  Normalised slope threshold: ${calibration.normalisedSlopeThreshold}`
    );
    console.log(
      `  Normalised acceleration threshold: ${calibration.normalisedAccelerationThreshold}`
    );

    const training =
      makePeriodResult(
        dataset.markets,
        periods.training[0],
        periods.training[1],
        calibration
      );

    console.log("  Validation...");
    const validation =
      makePeriodResult(
        dataset.markets,
        periods.validation[0],
        periods.validation[1],
        calibration
      );

    console.log("  Test...");
    const test =
      makePeriodResult(
        dataset.markets,
        periods.test[0],
        periods.test[1],
        calibration
      );

    output.datasets[
      datasetConfig.name
    ] = {
      dataset: path.basename(
        datasetConfig.path
      ),
      markets:
        dataset.markets.length,
      periods: {
        training,
        validation,
        test,
      },
      calibration,
    };
  }

  const outputPath = path.join(
    OUTPUT_DIR,
    `normalised-signal-clean-experiment-${Date.now()}.json`
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(output, null, 2)
  );

  console.log("\n" + "=".repeat(72));
  console.log("Experiment complete");
  console.log(`Output: ${outputPath}`);
  console.log("=".repeat(72));
}

main();
