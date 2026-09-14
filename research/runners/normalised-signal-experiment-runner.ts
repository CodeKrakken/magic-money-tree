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

interface Event {
  time: number;
  type: "entry" | "exit";
  position: Position;
  cashDelta: number;
  capitalDelta: number;
  positionDelta: number;
}

interface PortfolioResult {
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
}

interface BacktestResult {
  universe: string;
  strategy: "raw" | "normalised";

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

interface PeriodResult {
  startTime: number;
  endTime: number;

  raw: {
    diagnostic: SignalDiagnostic;
    backtest: BacktestResult;
  };

  normalised: {
    diagnostic: SignalDiagnostic;
    backtest: BacktestResult;
  };
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

    forwardHorizonsMinutes: number[];
  };

  datasets: {
    original: DatasetExperiment;
    oos: DatasetExperiment;
  };
}

const OUTPUT_DIR = path.join(
  process.cwd(),
  "server",
  "research-output"
);

const ORIGINAL_DATASET_PATH = path.join(
  OUTPUT_DIR,
  "ema-data-1789061547934.json"
);

const POSITION_NOTIONAL = 10;
const POSITION_CAPACITY = 43;

const FEE_RATE = 0.001;
const EXECUTION_COST = 0;

const RAW_SLOPE_THRESHOLD =
  -0.0001425851160546487;

const RAW_ACCELERATION_THRESHOLD =
  0.00013986740450809692 * 1.30;

const TARGETS: Target[] = [
  {
    name: "target_1pct",
    returnPct: 0.01,
    fraction: 0.50,
  },
  {
    name: "target_2pct",
    returnPct: 0.02,
    fraction: 0.25,
  },
  {
    name: "target_4pct",
    returnPct: 0.04,
    fraction: 0.25,
  },
];

const STOP_PCT = 0.10;
const MAX_HOLD_MINUTES = 48 * 60;

const FORWARD_HORIZONS = [
  5,
  10,
  20,
  50,
  120,
  360,
  720,
  1440,
  2880,
];

const SHORT_WINDOW = 20;
const LONG_WINDOW = 50;

/*
 * We deliberately use chronological splits.
 *
 * 60% train
 * 20% validation
 * 20% test
 *
 * Threshold calibration is performed ONLY on training data.
 */
const TRAIN_FRACTION = 0.60;
const VALIDATION_FRACTION = 0.20;

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

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
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

function percentile(
  values: number[],
  p: number
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const position =
    (sorted.length - 1) * p;

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
    sorted[lower] * (1 - weight) +
    sorted[upper] * weight
  );
}

function rate(
  numerator: number,
  denominator: number
): number {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function calculateFee(
  value: number
): number {
  return (
    value *
    (FEE_RATE + EXECUTION_COST)
  );
}

/**
 * Pearson correlation.
 */
function correlation(
  xs: number[],
  ys: number[]
): number {
  const length =
    Math.min(xs.length, ys.length);

  if (length < 2) {
    return 0;
  }

  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < length; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }

  const meanX =
    sumX / length;

  const meanY =
    sumY / length;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (let i = 0; i < length; i++) {
    const dx =
      xs[i] - meanX;

    const dy =
      ys[i] - meanY;

    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }

  const denominator =
    Math.sqrt(
      denominatorX *
      denominatorY
    );

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * O(1) rolling regression slope using
 * prefix sums.
 */
function buildRegressionSlopes(
  closes: number[],
  windowSize: number
): number[] {
  const n = closes.length;

  const prefixY =
    new Float64Array(n + 1);

  const prefixIndexY =
    new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    prefixY[i + 1] =
      prefixY[i] + closes[i];

    prefixIndexY[i + 1] =
      prefixIndexY[i] +
      i * closes[i];
  }

  const sumX =
    (windowSize *
      (windowSize - 1)) /
    2;

  const sumXX =
    ((windowSize - 1) *
      windowSize *
      (2 * windowSize - 1)) /
    6;

  const denominator =
    windowSize * sumXX -
    sumX * sumX;

  const slopes =
    new Float64Array(n);

  for (
    let end = windowSize - 1;
    end < n;
    end++
  ) {
    const start =
      end -
      windowSize +
      1;

    const sumY =
      prefixY[end + 1] -
      prefixY[start];

    const weightedSum =
      prefixIndexY[end + 1] -
      prefixIndexY[start];

    const sumXY =
      weightedSum -
      start * sumY;

    slopes[end] =
      (
        windowSize * sumXY -
        sumX * sumY
      ) /
      denominator;
  }

  return Array.from(slopes);
}

interface MarketIndicators {
  slope20: number[];
  slope50: number[];
  acceleration: number[];
  normalisedSlope20: number[];
  normalisedSlope50: number[];
  normalisedAcceleration: number[];
}

/**
 * Calculate all signal inputs once per market.
 *
 * This is important for runtime: the raw and
 * normalised experiments use exactly the same
 * indicator arrays.
 */
function buildIndicators(
  candles: Candle[]
): MarketIndicators {
  const closes =
    candles.map(
      candle => candle.close
    );

  const slope20 =
    buildRegressionSlopes(
      closes,
      SHORT_WINDOW
    );

  const slope50 =
    buildRegressionSlopes(
      closes,
      LONG_WINDOW
    );

  const acceleration =
    new Float64Array(
      candles.length
    );

  const normalisedSlope20 =
    new Float64Array(
      candles.length
    );

  const normalisedSlope50 =
    new Float64Array(
      candles.length
    );

  const normalisedAcceleration =
    new Float64Array(
      candles.length
    );

  for (
    let i = LONG_WINDOW - 1;
    i < candles.length;
    i++
  ) {
    const price =
      candles[i].close;

    if (price <= 0) {
      continue;
    }

    const accel =
      slope20[i] -
      slope50[i];

    acceleration[i] = accel;

    normalisedSlope20[i] =
      slope20[i] / price;

    normalisedSlope50[i] =
      slope50[i] / price;

    normalisedAcceleration[i] =
      accel / price;
  }

  return {
    slope20,
    slope50,
    acceleration:
      Array.from(acceleration),
    normalisedSlope20:
      Array.from(normalisedSlope20),
    normalisedSlope50:
      Array.from(normalisedSlope50),
    normalisedAcceleration:
      Array.from(
        normalisedAcceleration
      ),
  };
}

/**
 * A signal is deliberately represented with
 * both raw and normalised values.
 *
 * The experiment decides which pair of
 * thresholds to apply.
 */
function buildCandidateSignals(
  market: MarketData,
  indicators: MarketIndicators,
  strategy: "raw" | "normalised",
  slopeThreshold: number,
  accelerationThreshold: number,
  startTime: number,
  endTime: number
): Signal[] {
  const signals: Signal[] = [];

  const {
    candles,
  } = market;

  const {
    slope20,
    slope50,
    acceleration,
    normalisedSlope20,
    normalisedSlope50,
    normalisedAcceleration,
  } = indicators;

  for (
    let i = LONG_WINDOW - 1;
    i < candles.length;
    i++
  ) {
    const time =
      candles[i].openTime;

    if (
      time < startTime ||
      time >= endTime
    ) {
      continue;
    }

    const price =
      candles[i].close;

    if (price <= 0) {
      continue;
    }

    const slope20 =
      indicators.slope20[i];

    const acceleration =
      indicators.acceleration[i];

    const normalisedSlope20 =
      indicators.normalisedSlope20[i];

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

    if (
      selectedSlope >
      slopeThreshold ||
      selectedAcceleration <
      accelerationThreshold
    ) {
      continue;
    }

    /*
     * Score is only used to resolve simultaneous
     * signals under the position-capacity rule.
     *
     * It is deliberately calculated using the
     * selected representation.
     */
    const slopeStrength =
      Math.abs(
        selectedSlope /
        slopeThreshold
      );

    const accelerationStrength =
      selectedAcceleration /
      accelerationThreshold;

    const score =
      slopeStrength +
      accelerationStrength;

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

/**
 * Simulate the existing strategy execution
 * exactly:
 *
 * - entry at signal candle close
 * - stop before targets on same candle
 * - 50% at +1%
 * - 25% at +2%
 * - 25% at +4%
 * - 10% stop
 * - 48h time limit
 */
function simulatePosition(
  candles: Candle[],
  signal: Signal
): Position {
  const entryCandle =
    candles[signal.index];

  const entryPrice =
    entryCandle.close;

  const quantity =
    POSITION_NOTIONAL /
    entryPrice;

  const entryValue =
    quantity * entryPrice;

  const entryFee =
    calculateFee(entryValue);

  let remainingQuantity =
    quantity;

  let realisedNet =
    -entryFee;

  const exits: Exit[] = [];

  let finalExitTime =
    candles[
      candles.length - 1
    ].openTime;

  const targetExecuted =
    TARGETS.map(() => false);

  const deadline =
    entryCandle.openTime +
    MAX_HOLD_MINUTES *
    60_000;

  const stopPrice =
    entryPrice *
    (1 - STOP_PCT);

  const targetPrices =
    TARGETS.map(
      target =>
        entryPrice *
        (1 + target.returnPct)
    );

  for (
    let i = signal.index + 1;
    i < candles.length;
    i++
  ) {
    const candle =
      candles[i];

    /*
     * Stop has priority when both stop and
     * target are possible inside one candle.
     */
    if (
      candle.low <= stopPrice
    ) {
      const quantitySold =
        remainingQuantity;

      const saleValue =
        quantitySold *
        stopPrice;

      const exitFee =
        calculateFee(saleValue);

      const netSaleProceeds =
        saleValue -
        exitFee;

      realisedNet +=
        netSaleProceeds -
        quantitySold *
        entryPrice;

      exits.push({
        time: candle.openTime,
        price: stopPrice,
        quantity: quantitySold,
        fee: exitFee,
        netProceeds:
          netSaleProceeds,
        target: "stop",
      });

      remainingQuantity = 0;
      finalExitTime =
        candle.openTime;

      break;
    }

    for (
      let targetIndex = 0;
      targetIndex < TARGETS.length;
      targetIndex++
    ) {
      if (
        targetExecuted[
          targetIndex
        ]
      ) {
        continue;
      }

      if (
        remainingQuantity <=
        1e-12
      ) {
        break;
      }

      const target =
        TARGETS[targetIndex];

      if (
        candle.high <
        targetPrices[targetIndex]
      ) {
        continue;
      }

      const requestedQuantity =
        quantity *
        target.fraction;

      const quantitySold =
        Math.min(
          requestedQuantity,
          remainingQuantity
        );

      if (quantitySold <= 0) {
        continue;
      }

      const saleValue =
        quantitySold *
        targetPrices[targetIndex];

      const exitFee =
        calculateFee(saleValue);

      const netSaleProceeds =
        saleValue -
        exitFee;

      realisedNet +=
        netSaleProceeds -
        quantitySold *
        entryPrice;

      remainingQuantity -=
        quantitySold;

      targetExecuted[
        targetIndex
      ] = true;

      exits.push({
        time: candle.openTime,
        price:
          targetPrices[targetIndex],
        quantity: quantitySold,
        fee: exitFee,
        netProceeds:
          netSaleProceeds,
        target: target.name,
      });

      if (
        remainingQuantity <=
        1e-12
      ) {
        remainingQuantity = 0;
        finalExitTime =
          candle.openTime;

        break;
      }
    }

    if (
      remainingQuantity <=
      1e-12
    ) {
      break;
    }

    if (
      candle.openTime >=
      deadline
    ) {
      const quantitySold =
        remainingQuantity;

      if (quantitySold > 0) {
        const saleValue =
          quantitySold *
          candle.close;

        const exitFee =
          calculateFee(saleValue);

        const netSaleProceeds =
          saleValue -
          exitFee;

        realisedNet +=
          netSaleProceeds -
          quantitySold *
          entryPrice;

        exits.push({
          time: candle.openTime,
          price: candle.close,
          quantity: quantitySold,
          fee: exitFee,
          netProceeds:
            netSaleProceeds,
          target: "time_limit",
        });

        remainingQuantity = 0;
        finalExitTime =
          candle.openTime;
      }

      break;
    }
  }

  let unrealisedGross = 0;

  if (
    remainingQuantity > 0
  ) {
    const finalPrice =
      candles[
        candles.length - 1
      ].close;

    unrealisedGross =
      remainingQuantity *
      (
        finalPrice -
        entryPrice
      );
  }

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

/**
 * Capacity selection.
 *
 * Signals are sorted chronologically and then
 * by signal strength within each timestamp.
 */
function selectPositions(
  candidates: Position[],
  capacity: number
): Position[] {
  const sorted =
    [...candidates].sort(
      (a, b) => {
        if (
          a.entryTime !==
          b.entryTime
        ) {
          return (
            a.entryTime -
            b.entryTime
          );
        }

        return (
          b.score -
          a.score
        );
      }
    );

  const active: Position[] = [];
  const accepted: Position[] = [];

  let index = 0;

  while (
    index < sorted.length
  ) {
    const entryTime =
      sorted[index].entryTime;

    for (
      let i = active.length - 1;
      i >= 0;
      i--
    ) {
      if (
        active[i]
          .finalExitTime <=
        entryTime
      ) {
        active.splice(i, 1);
      }
    }

    const batch: Position[] = [];

    while (
      index < sorted.length &&
      sorted[index].entryTime ===
        entryTime
    ) {
      batch.push(
        sorted[index]
      );

      index++;
    }

    batch.sort(
      (a, b) =>
        b.score -
        a.score
    );

    const available =
      Math.max(
        0,
        capacity -
        active.length
      );

    const count =
      Math.min(
        available,
        batch.length
      );

    for (
      let i = 0;
      i < count;
      i++
    ) {
      accepted.push(
        batch[i]
      );

      active.push(
        batch[i]
      );
    }
  }

  return accepted;
}

function buildPositionEvents(
  position: Position
): Event[] {
  const events: Event[] = [];

  events.push({
    time:
      position.entryTime,
    type: "entry",
    position,
    cashDelta:
      -(
        position.entryValue +
        position.entryFee
      ),
    capitalDelta:
      position.entryValue,
    positionDelta: 1,
  });

  for (
    let i = 0;
    i < position.exits.length;
    i++
  ) {
    const exit =
      position.exits[i];

    const finalExit =
      i ===
      position.exits.length - 1;

    events.push({
      time: exit.time,
      type: "exit",
      position,
      cashDelta:
        exit.netProceeds,
      capitalDelta:
        -(
          exit.quantity *
          position.entryPrice
        ),
      positionDelta:
        finalExit ? -1 : 0,
    });
  }

  return events;
}

function runPortfolio(
  positions: Position[],
  startTime: number,
  endTime: number
): PortfolioResult {
  const events: Event[] = [];

  for (const position of positions) {
    events.push(
      ...buildPositionEvents(
        position
      )
    );
  }

  events.sort(
    (a, b) => {
      if (
        a.time !== b.time
      ) {
        return (
          a.time -
          b.time
        );
      }

      if (
        a.type === b.type
      ) {
        return 0;
      }

      return a.type === "exit"
        ? -1
        : 1;
    }
  );

  let cashFlow = 0;
  let capitalDeployed = 0;

  let peakCapitalDeployed = 0;
  let minimumStartingCash = 0;

  let openPositions = 0;
  let maxOpenPositions = 0;

  let capitalDays = 0;
  let previousTime = startTime;

  const marketPositions =
    new Map<string, number>();

  let maxOpenMarkets = 0;

  let index = 0;

  while (
    index < events.length
  ) {
    const time =
      events[index].time;

    if (
      time > previousTime
    ) {
      capitalDays +=
        (
          capitalDeployed *
          (
            time -
            previousTime
          )
        ) /
        86_400_000;

      previousTime = time;
    }

    while (
      index < events.length &&
      events[index].time ===
        time
    ) {
      const event =
        events[index];

      cashFlow +=
        event.cashDelta;

      capitalDeployed +=
        event.capitalDelta;

      openPositions +=
        event.positionDelta;

      const symbol =
        event.position.symbol;

      const current =
        marketPositions.get(
          symbol
        ) ?? 0;

      if (
        event.type === "entry"
      ) {
        marketPositions.set(
          symbol,
          current + 1
        );
      } else if (
        event.positionDelta ===
          -1 &&
        current <= 1
      ) {
        marketPositions.delete(
          symbol
        );
      }

      peakCapitalDeployed =
        Math.max(
          peakCapitalDeployed,
          capitalDeployed
        );

      maxOpenPositions =
        Math.max(
          maxOpenPositions,
          openPositions
        );

      maxOpenMarkets =
        Math.max(
          maxOpenMarkets,
          marketPositions.size
        );

      minimumStartingCash =
        Math.max(
          minimumStartingCash,
          -cashFlow
        );

      index++;
    }
  }

  if (
    endTime > previousTime
  ) {
    capitalDays +=
      (
        capitalDeployed *
        (
          endTime -
          previousTime
        )
      ) /
      86_400_000;
  }

  const totalDays =
    (
      endTime -
      startTime
    ) /
    86_400_000;

  const averageCapitalDeployed =
    totalDays > 0
      ? capitalDays /
        totalDays
      : 0;

  let finalMarketValue = 0;

  for (const position of positions) {
    if (
      position.remainingQuantity >
      0
    ) {
      finalMarketValue +=
        position.remainingQuantity *
        (
          position.entryPrice +
          position.unrealisedGross /
            position.remainingQuantity
        );
    }
  }

  const finalCash =
    minimumStartingCash +
    cashFlow;

  const finalEquity =
    finalCash +
    finalMarketValue;

  let runningCash =
    minimumStartingCash;

  let peakEquity =
    minimumStartingCash;

  let maxDrawdownAbsolute = 0;
  let maxDrawdownPct = 0;

  let runningCapital = 0;

  const activePositions =
    new Set<Position>();

  for (const event of events) {
    runningCash +=
      event.cashDelta;

    runningCapital +=
      event.capitalDelta;

    if (
      event.type === "entry"
    ) {
      activePositions.add(
        event.position
      );
    } else if (
      event.positionDelta ===
      -1
    ) {
      activePositions.delete(
        event.position
      );
    }

    let markedValue = 0;

    for (const position of activePositions) {
      markedValue +=
        position.entryValue;
    }

    const equity =
      runningCash +
      markedValue;

    if (
      equity > peakEquity
    ) {
      peakEquity = equity;
    }

    const drawdown =
      peakEquity -
      equity;

    maxDrawdownAbsolute =
      Math.max(
        maxDrawdownAbsolute,
        drawdown
      );

    if (
      peakEquity > 0
    ) {
      maxDrawdownPct =
        Math.max(
          maxDrawdownPct,
          drawdown /
            peakEquity
        );
    }
  }

  return {
    minimumStartingCash,
    peakCapitalDeployed,
    averageCapitalDeployed,
    finalEquity,
    finalCash,
    finalMarketValue,
    maxDrawdownAbsolute,
    maxDrawdownPct,
    maxOpenPositions,
    maxOpenMarkets,
  };
}

function runBacktest(
  positions: Position[],
  universe: string,
  strategy: "raw" | "normalised",
  startTime: number,
  endTime: number
): BacktestResult {
  const accepted =
    selectPositions(
      positions,
      POSITION_CAPACITY
    );

  let realisedGross = 0;
  let realisedFees = 0;
  let realisedNet = 0;
  let unrealisedGross = 0;

  let completedPositions = 0;
  let openPositions = 0;

  let winningPositions = 0;
  let losingPositions = 0;

  let closedProfit = 0;
  let closedLoss = 0;

  const holdTimes: number[] = [];

  for (const position of accepted) {
    realisedNet +=
      position.realisedNet;

    realisedFees +=
      position.entryFee;

    for (const exit of position.exits) {
      realisedFees +=
        exit.fee;

      realisedGross +=
        exit.quantity *
        (
          exit.price -
          position.entryPrice
        );
    }

    unrealisedGross +=
      position.unrealisedGross;

    const net =
      position.realisedNet +
      position.unrealisedGross;

    if (net > 0) {
      winningPositions++;
    } else if (net < 0) {
      losingPositions++;
    }

    if (
      position.remainingQuantity >
      0
    ) {
      openPositions++;
    } else {
      completedPositions++;

      const holdMinutes =
        (
          position.finalExitTime -
          position.entryTime
        ) /
        60_000;

      holdTimes.push(
        holdMinutes
      );

      if (
        position.realisedNet > 0
      ) {
        closedProfit +=
          position.realisedNet;
      } else if (
        position.realisedNet < 0
      ) {
        closedLoss +=
          Math.abs(
            position.realisedNet
          );
      }
    }
  }

  const combinedNet =
    realisedNet +
    unrealisedGross;

  const portfolio =
    runPortfolio(
      accepted,
      startTime,
      endTime
    );

  const totalReturn =
    portfolio.minimumStartingCash >
    0
      ? combinedNet /
        portfolio.minimumStartingCash
      : 0;

  const returnOnPeakCapital =
    portfolio.peakCapitalDeployed >
    0
      ? combinedNet /
        portfolio.peakCapitalDeployed
      : 0;

  const returnOnAverageCapital =
    portfolio.averageCapitalDeployed >
    0
      ? combinedNet /
        portfolio.averageCapitalDeployed
      : 0;

  const totalYears =
    (
      endTime -
      startTime
    ) /
    (
      365.25 *
      86_400_000
    );

  const annualisedCapitalEfficiency =
    totalYears > 0 &&
    portfolio.averageCapitalDeployed >
      0
      ? Math.pow(
          1 +
          combinedNet /
            portfolio.averageCapitalDeployed,
          1 / totalYears
        ) - 1
      : 0;

  return {
    universe,
    strategy,

    candidateSignals:
      positions.length,

    acceptedSignals:
      accepted.length,

    completedPositions,
    openPositions,

    winningPositions,
    losingPositions,

    winRate:
      rate(
        winningPositions,
        accepted.length
      ),

    realisedGross,
    realisedFees,
    realisedNet,
    unrealisedGross,
    combinedNet,

    profitFactor:
      closedLoss > 0
        ? closedProfit /
          closedLoss
        : Infinity,

    minimumStartingCash:
      portfolio.minimumStartingCash,

    peakCapitalDeployed:
      portfolio.peakCapitalDeployed,

    averageCapitalDeployed:
      portfolio.averageCapitalDeployed,

    finalEquity:
      portfolio.finalEquity,

    totalReturn,

    maxDrawdownAbsolute:
      portfolio.maxDrawdownAbsolute,

    maxDrawdownPct:
      portfolio.maxDrawdownPct,

    returnOnPeakCapital,

    returnOnAverageCapital,

    annualisedCapitalEfficiency,

    averageHoldMinutes:
      holdTimes.length > 0
        ? mean(holdTimes)
        : 0,

    medianHoldMinutes:
      median(holdTimes),

    maxOpenPositions:
      portfolio.maxOpenPositions,

    maxOpenMarkets:
      portfolio.maxOpenMarkets,
  };
}

interface ForwardObservation {
  returnPct: number;
  mfePct: number;
  maePct: number;

  hit1: boolean;
  hit2: boolean;
  hit4: boolean;
  stop: boolean;
}

/**
 * Analyse the complete path from the signal
 * candle through each forward horizon.
 *
 * Unlike the previous market-quality runner,
 * MFE/MAE here are genuinely path-based.
 */
function analyseSignalForwardPath(
  signal: Signal,
  candles: Candle[]
): Map<number, ForwardObservation> {
  const result =
    new Map<number, ForwardObservation>();

  let horizonIndex = 0;

  let maxHighReturn = 0;
  let minLowReturn = 0;

  for (
    let i = signal.index + 1;
    i < candles.length;
    i++
  ) {
    const candle =
      candles[i];

    const elapsedMinutes =
      (
        candle.openTime -
        signal.time
      ) /
      60_000;

    while (
      horizonIndex <
        FORWARD_HORIZONS.length &&
      elapsedMinutes >=
        FORWARD_HORIZONS[
          horizonIndex
        ]
    ) {
      const horizon =
        FORWARD_HORIZONS[
          horizonIndex
        ];

      const targetTime =
        signal.time +
        horizon *
        60_000;

      /*
       * The close used for the horizon is
       * the first candle at or after the
       * requested horizon.
       */
      let closeIndex = i;

      while (
        closeIndex + 1 <
          candles.length &&
        candles[
          closeIndex + 1
        ].openTime <=
          targetTime
      ) {
        closeIndex++;
      }

      const horizonCandle =
        candles[closeIndex];

      const closeReturn =
        horizonCandle.close /
          signal.entryPrice -
        1;

      const horizonHigh =
        horizonCandle.high /
          signal.entryPrice -
        1;

      const horizonLow =
        horizonCandle.low /
          signal.entryPrice -
        1;

      const pathMfe =
        maxHighReturn;

      const pathMae =
        minLowReturn;

      result.set(
        horizon,
        {
          returnPct:
            closeReturn,

          mfePct:
            Math.max(
              0,
              pathMfe
            ),

          maePct:
            Math.min(
              0,
              pathMae
            ),

          hit1:
            pathMfe >=
            TARGETS[0].returnPct,

          hit2:
            pathMfe >=
            TARGETS[1].returnPct,

          hit4:
            pathMfe >=
            TARGETS[2].returnPct,

          stop:
            pathMae <=
            -STOP_PCT,
        }
      );

      /*
       * horizonCandle is deliberately read
       * even though its high/low may extend
       * beyond the exact horizon. The dataset
       * is one-minute candles, so the candle
       * containing the horizon is the closest
       * available OHLC observation.
       */
      void horizonHigh;
      void horizonLow;

      horizonIndex++;
    }

    const highReturn =
      candle.high /
        signal.entryPrice -
      1;

    const lowReturn =
      candle.low /
        signal.entryPrice -
      1;

    maxHighReturn =
      Math.max(
        maxHighReturn,
        highReturn
      );

    minLowReturn =
      Math.min(
        minLowReturn,
        lowReturn
      );

    if (
      horizonIndex >=
      FORWARD_HORIZONS.length
    ) {
      break;
    }
  }

  /*
   * If a horizon falls beyond the available
   * dataset, it simply remains absent.
   */
  return result;
}

function buildDiagnostic(
  signals: Signal[],
  candlesBySymbol: Map<
    string,
    Candle[]
  >
): SignalDiagnostic {
  const returnByHorizon =
    new Map<
      number,
      number[]
    >();

  const mfeByHorizon =
    new Map<
      number,
      number[]
    >();

  const maeByHorizon =
    new Map<
      number,
      number[]
    >();

  const hit1ByHorizon =
    new Map<
      number,
      number
    >();

  const hit2ByHorizon =
    new Map<
      number,
      number
    >();

  const hit4ByHorizon =
    new Map<
      number,
      number
    >();

  const stopByHorizon =
    new Map<
      number,
      number
    >();

  const slope20Values: number[] = [];
  const normalisedSlope20Values: number[] = [];

  const accelerationValues: number[] = [];
  const normalisedAccelerationValues: number[] = [];

  const score20Returns: number[] = [];
  const score50Returns: number[] = [];

  const normalisedSlope20Returns: number[] = [];
  const normalisedAccelerationReturns: number[] = [];

  for (const horizon of FORWARD_HORIZONS) {
    returnByHorizon.set(
      horizon,
      []
    );

    mfeByHorizon.set(
      horizon,
      []
    );

    maeByHorizon.set(
      horizon,
      []
    );

    hit1ByHorizon.set(
      horizon,
      0
    );

    hit2ByHorizon.set(
      horizon,
      0
    );

    hit4ByHorizon.set(
      horizon,
      0
    );

    stopByHorizon.set(
      horizon,
      0
    );
  }

  for (const signal of signals) {
    slope20Values.push(
      signal.slope20
    );

    normalisedSlope20Values.push(
      signal.normalisedSlope20
    );

    accelerationValues.push(
      signal.acceleration
    );

    normalisedAccelerationValues.push(
      signal.normalisedAcceleration
    );

    const candles =
      candlesBySymbol.get(
        signal.symbol
      );

    if (!candles) {
      continue;
    }

    const forward =
      analyseSignalForwardPath(
        signal,
        candles
      );

    for (const horizon of FORWARD_HORIZONS) {
      const observation =
        forward.get(horizon);

      if (!observation) {
        continue;
      }

      returnByHorizon
        .get(horizon)!
        .push(
          observation.returnPct
        );

      mfeByHorizon
        .get(horizon)!
        .push(
          observation.mfePct
        );

      maeByHorizon
        .get(horizon)!
        .push(
          observation.maePct
        );

      if (observation.hit1) {
        hit1ByHorizon.set(
          horizon,
          hit1ByHorizon.get(
            horizon
          )! + 1
        );
      }

      if (observation.hit2) {
        hit2ByHorizon.set(
          horizon,
          hit2ByHorizon.get(
            horizon
          )! + 1
        );
      }

      if (observation.hit4) {
        hit4ByHorizon.set(
          horizon,
          hit4ByHorizon.get(
            horizon
          )! + 1
        );
      }

      if (observation.stop) {
        stopByHorizon.set(
          horizon,
          stopByHorizon.get(
            horizon
          )! + 1
        );
      }

      if (horizon === 20) {
        score20Returns.push(
          observation.returnPct
        );

        normalisedSlope20Returns.push(
          signal.normalisedSlope20
        );

        normalisedAccelerationReturns.push(
          signal.normalisedAcceleration
        );
      }

      if (horizon === 50) {
        score50Returns.push(
          observation.returnPct
        );
      }
    }
  }

  const forward:
    Record<
      string,
      ForwardStats
    > = {};

  for (const horizon of FORWARD_HORIZONS) {
    const returns =
      returnByHorizon.get(
        horizon
      )!;

    const mfes =
      mfeByHorizon.get(
        horizon
      )!;

    const maes =
      maeByHorizon.get(
        horizon
      )!;

    const observations =
      returns.length;

    forward[
      String(horizon)
    ] = {
      observations,

      meanReturnPct:
        mean(returns),

      medianReturnPct:
        median(returns),

      positiveReturnRate:
        rate(
          returns.filter(
            value => value > 0
          ).length,
          observations
        ),

      meanMfePct:
        mean(mfes),

      medianMfePct:
        median(mfes),

      meanMaePct:
        mean(maes),

      medianMaePct:
        median(maes),

      target1Rate:
        rate(
          hit1ByHorizon.get(
            horizon
          )!,
          observations
        ),

      target2Rate:
        rate(
          hit2ByHorizon.get(
            horizon
          )!,
          observations
        ),

      target4Rate:
        rate(
          hit4ByHorizon.get(
            horizon
          )!,
          observations
        ),

      stopRate:
        rate(
          stopByHorizon.get(
            horizon
          )!,
          observations
        ),
    };
  }

  /*
   * score20Returns contains 20m returns,
   * while score50Returns contains 50m returns.
   *
   * We therefore construct the matching score
   * arrays independently below.
   */
  const score20Values: number[] = [];
  const score50Values: number[] = [];
  const normalisedSlope20ValuesForCorrelation: number[] = [];
  const normalisedAccelerationValuesForCorrelation: number[] = [];

  for (const signal of signals) {
    const candles =
      candlesBySymbol.get(
        signal.symbol
      );

    if (!candles) {
      continue;
    }

    const forward =
      analyseSignalForwardPath(
        signal,
        candles
      );

    const return20 =
      forward.get(20);

    const return50 =
      forward.get(50);

    if (return20) {
      score20Values.push(
        signal.score
      );

      normalisedSlope20ValuesForCorrelation.push(
        signal.normalisedSlope20
      );

      normalisedAccelerationValuesForCorrelation.push(
        signal.normalisedAcceleration
      );
    }

    if (return50) {
      score50Values.push(
        signal.score
      );
    }
  }

  return {
    candidateSignals:
      signals.length,

    forward,

    meanSlope20:
      mean(slope20Values),

    meanNormalisedSlope20:
      mean(
        normalisedSlope20Values
      ),

    meanAcceleration:
      mean(accelerationValues),

    meanNormalisedAcceleration:
      mean(
        normalisedAccelerationValues
      ),

    scoreVs20mReturn:
      correlation(
        score20Values,
        score20Returns
      ),

    scoreVs50mReturn:
      correlation(
        score50Values,
        score50Returns
      ),

    normalisedSlopeVs20mReturn:
      correlation(
        normalisedSlope20ValuesForCorrelation,
        score20Returns
      ),

    normalisedAccelerationVs20mReturn:
      correlation(
        normalisedAccelerationValuesForCorrelation,
        score20Returns
      ),
  };
}

interface Split {
  startTime: number;
  endTime: number;
}

function getDatasetBounds(
  dataset: Dataset
): {
  startTime: number;
  endTime: number;
} {
  let startTime =
    Number.POSITIVE_INFINITY;

  let endTime =
    Number.NEGATIVE_INFINITY;

  for (const market of dataset.markets) {
    const first =
      market.candles[0];

    const last =
      market.candles[
        market.candles.length - 1
      ];

    if (first) {
      startTime =
        Math.min(
          startTime,
          first.openTime
        );
    }

    if (last) {
      endTime =
        Math.max(
          endTime,
          last.openTime
        );
    }
  }

  return {
    startTime,
    endTime,
  };
}

function createSplits(
  dataset: Dataset
): {
  training: Split;
  validation: Split;
  test: Split;
} {
  const {
    startTime,
    endTime,
  } = getDatasetBounds(
    dataset
  );

  const duration =
    endTime -
    startTime;

  const trainingEnd =
    startTime +
    duration *
    TRAIN_FRACTION;

  const validationEnd =
    startTime +
    duration *
    (
      TRAIN_FRACTION +
      VALIDATION_FRACTION
    );

  return {
    training: {
      startTime,
      endTime: trainingEnd,
    },

    validation: {
      startTime: trainingEnd,
      endTime: validationEnd,
    },

    test: {
      startTime: validationEnd,
      endTime: endTime + 1,
    },
  };
}

/**
 * Build raw and normalised observations
 * used for threshold calibration.
 *
 * Only training data reaches this function.
 */
function collectTrainingValues(
  dataset: Dataset,
  split: Split
): {
  rawSlope: number[];
  normalisedSlope: number[];

  rawAcceleration: number[];
  normalisedAcceleration: number[];
} {
  const rawSlope: number[] = [];
  const normalisedSlope: number[] = [];

  const rawAcceleration: number[] = [];
  const normalisedAcceleration: number[] = [];

  for (const market of dataset.markets) {
    if (
      market.candles.length <
      LONG_WINDOW
    ) {
      continue;
    }

    const indicators =
      buildIndicators(
        market.candles
      );

    for (
      let i = LONG_WINDOW - 1;
      i < market.candles.length;
      i++
    ) {
      const time =
        market.candles[i].openTime;

      if (
        time < split.startTime ||
        time >= split.endTime
      ) {
        continue;
      }

      const price =
        market.candles[i].close;

      if (price <= 0) {
        continue;
      }

      rawSlope.push(
        indicators.slope20[i]
      );

      normalisedSlope.push(
        indicators.normalisedSlope20[i]
      );

      rawAcceleration.push(
        indicators.acceleration[i]
      );

      normalisedAcceleration.push(
        indicators.normalisedAcceleration[i]
      );
    }
  }

  return {
    rawSlope,
    normalisedSlope,
    rawAcceleration,
    normalisedAcceleration,
  };
}

/**
 * Rank-equivalent threshold calibration.
 *
 * The raw thresholds define particular
 * positions in the training distributions.
 *
 * We locate those same percentile positions
 * in the normalised distributions.
 *
 * This gives the normalised strategy comparable
 * selectivity without optimising against
 * validation/test performance.
 */
function calibrateNormalisedThresholds(
  dataset: Dataset,
  trainingSplit: Split
): ThresholdCalibration {
  const values =
    collectTrainingValues(
      dataset,
      trainingSplit
    );

  const rawSlopePercentile =
    rate(
      values.rawSlope.filter(
        value =>
          value <=
          RAW_SLOPE_THRESHOLD
      ).length,
      values.rawSlope.length
    );

  const rawAccelerationPercentile =
    rate(
      values.rawAcceleration.filter(
        value =>
          value >=
          RAW_ACCELERATION_THRESHOLD
      ).length,
      values.rawAcceleration.length
    );

  /*
   * Slope condition is lower-is-more-extreme,
   * so use the same lower-tail probability.
   */
  const normalisedSlopeThreshold =
    percentile(
      values.normalisedSlope,
      rawSlopePercentile
    );

  /*
   * Acceleration condition is
   * higher-is-more-extreme.
   *
   * Convert upper-tail probability to the
   * corresponding ordinary percentile.
   */
  const normalisedAccelerationThreshold =
    percentile(
      values.normalisedAcceleration,
      1 -
      rawAccelerationPercentile
    );

  return {
    rawSlopeThreshold:
      RAW_SLOPE_THRESHOLD,

    rawAccelerationThreshold:
      RAW_ACCELERATION_THRESHOLD,

    normalisedSlopeThreshold,
    normalisedAccelerationThreshold,

    slopePercentile:
      rawSlopePercentile,

    accelerationPercentile:
      rawAccelerationPercentile,

    trainingCandidateSignals:
      values.rawSlope.length,
  };
}

interface PreparedMarket {
  market: MarketData;
  indicators: MarketIndicators;
}

function prepareMarkets(
  dataset: Dataset
): PreparedMarket[] {
  const prepared: PreparedMarket[] = [];

  for (const market of dataset.markets) {
    if (
      market.candles.length <
      LONG_WINDOW
    ) {
      continue;
    }

    prepared.push({
      market,
      indicators:
        buildIndicators(
          market.candles
        ),
    });
  }

  return prepared;
}

function buildPositions(
  preparedMarkets: PreparedMarket[],
  strategy: "raw" | "normalised",
  slopeThreshold: number,
  accelerationThreshold: number,
  split: Split
): {
  positions: Position[];
  signals: Signal[];
} {
  const positions: Position[] = [];
  const signals: Signal[] = [];

  for (const prepared of preparedMarkets) {
    const market =
      prepared.market;

    const marketSignals =
      buildCandidateSignals(
        market,
        prepared.indicators,
        strategy,
        slopeThreshold,
        accelerationThreshold,
        split.startTime,
        split.endTime
      );

    for (const signal of marketSignals) {
      signals.push(signal);

      positions.push(
        simulatePosition(
          market.candles,
          signal
        )
      );
    }
  }

  return {
    positions,
    signals,
  };
}

function runPeriod(
  preparedMarkets: PreparedMarket[],
  universe: string,
  split: Split,
  rawSlopeThreshold: number,
  rawAccelerationThreshold: number,
  normalisedSlopeThreshold: number,
  normalisedAccelerationThreshold: number
): PeriodResult {
  console.log(
    `  Period ${new Date(split.startTime).toISOString()} -> ${new Date(split.endTime).toISOString()}`
  );

  const raw =
    buildPositions(
      preparedMarkets,
      "raw",
      rawSlopeThreshold,
      rawAccelerationThreshold,
      split
    );

  const normalised =
    buildPositions(
      preparedMarkets,
      "normalised",
      normalisedSlopeThreshold,
      normalisedAccelerationThreshold,
      split
    );

  /*
   * Diagnostic needs candle lookup by symbol.
   */
  const candlesBySymbol =
    new Map<
      string,
      Candle[]
    >();

  for (const prepared of preparedMarkets) {
    candlesBySymbol.set(
      prepared.market.symbol,
      prepared.market.candles
    );
  }

  const rawDiagnostic =
    buildDiagnostic(
      raw.signals,
      candlesBySymbol
    );

  const normalisedDiagnostic =
    buildDiagnostic(
      normalised.signals,
      candlesBySymbol
    );

  const rawBacktest =
    runBacktest(
      raw.positions,
      universe,
      "raw",
      split.startTime,
      split.endTime
    );

  const normalisedBacktest =
    runBacktest(
      normalised.positions,
      universe,
      "normalised",
      split.startTime,
      split.endTime
    );

  return {
    startTime:
      split.startTime,

    endTime:
      split.endTime,

    raw: {
      diagnostic:
        rawDiagnostic,

      backtest:
        rawBacktest,
    },

    normalised: {
      diagnostic:
        normalisedDiagnostic,

      backtest:
        normalisedBacktest,
    },
  };
}

function findNewestOosDataset(): string {
  const files =
    fs.readdirSync(
      OUTPUT_DIR
    );

  const candidates =
    files
      .filter(
        file =>
          /^ema-data-oos-60-\d+\.json$/.test(
            file
          )
      )
      .sort();

  if (candidates.length === 0) {
    throw new Error(
      "No ema-data-oos-60-*.json dataset found in server/research-output"
    );
  }

  return path.join(
    OUTPUT_DIR,
    candidates[
      candidates.length - 1
    ]
  );
}

function loadDataset(
  datasetPath: string
): Dataset {
  const raw =
    fs.readFileSync(
      datasetPath,
      "utf8"
    );

  const parsed =
    JSON.parse(raw) as Dataset;

  if (
    !parsed.markets ||
    !Array.isArray(
      parsed.markets
    )
  ) {
    throw new Error(
      `Invalid dataset: ${datasetPath}`
    );
  }

  return parsed;
}

function printBacktest(
  result: BacktestResult
): void {
  console.log(
    `    candidates: ${result.candidateSignals.toLocaleString()}`
  );

  console.log(
    `    accepted:   ${result.acceptedSignals.toLocaleString()}`
  );

  console.log(
    `    completed:  ${result.completedPositions.toLocaleString()}`
  );

  console.log(
    `    win rate:   ${(result.winRate * 100).toFixed(2)}%`
  );

  console.log(
    `    net:        $${result.combinedNet.toFixed(2)}`
  );

  console.log(
    `    return:     ${(result.totalReturn * 100).toFixed(3)}%`
  );

  console.log(
    `    PF:         ${
      Number.isFinite(
        result.profitFactor
      )
        ? result.profitFactor.toFixed(3)
        : "Infinity"
    }`
  );

  console.log(
    `    drawdown:   ${(result.maxDrawdownPct * 100).toFixed(3)}%`
  );

  console.log(
    `    peak cap:   $${result.peakCapitalDeployed.toFixed(2)}`
  );
}

function printComparison(
  periodName: string,
  period: PeriodResult
): void {
  const raw =
    period.raw.backtest;

  const normalised =
    period.normalised.backtest;

  console.log("");
  console.log(
    `  ${periodName}`
  );
  console.log(
    "  ------------------------------------------------------------"
  );

  console.log(
    `  Raw        | candidates ${raw.candidateSignals.toLocaleString().padStart(7)} | accepted ${raw.acceptedSignals.toLocaleString().padStart(6)} | net $${raw.combinedNet.toFixed(2).padStart(8)} | return ${(raw.totalReturn * 100).toFixed(3).padStart(7)}% | PF ${Number.isFinite(raw.profitFactor) ? raw.profitFactor.toFixed(2) : "Inf"}`
  );

  console.log(
    `  Normalised | candidates ${normalised.candidateSignals.toLocaleString().padStart(7)} | accepted ${normalised.acceptedSignals.toLocaleString().padStart(6)} | net $${normalised.combinedNet.toFixed(2).padStart(8)} | return ${(normalised.totalReturn * 100).toFixed(3).padStart(7)}% | PF ${Number.isFinite(normalised.profitFactor) ? normalised.profitFactor.toFixed(2) : "Inf"}`
  );
}

function main(): void {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Raw vs normalised signal experiment"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Position size: $${POSITION_NOTIONAL}`
  );

  console.log(
    `Position capacity: ${POSITION_CAPACITY}`
  );

  console.log(
    `Raw slope threshold: ${RAW_SLOPE_THRESHOLD}`
  );

  console.log(
    `Raw acceleration threshold: ${RAW_ACCELERATION_THRESHOLD}`
  );

  console.log(
    `Fee rate: ${(FEE_RATE * 100).toFixed(3)}%`
  );

  console.log("");

  const original =
    loadDataset(
      ORIGINAL_DATASET_PATH
    );

  const oosPath =
    findNewestOosDataset();

  const oos =
    loadDataset(
      oosPath
    );

  console.log(
    `Original dataset: ${ORIGINAL_DATASET_PATH}`
  );

  console.log(
    `OOS dataset:      ${oosPath}`
  );

  console.log("");

  const datasets: Array<{
    name: "original" | "oos";
    dataset: Dataset;
  }> = [
    {
      name: "original",
      dataset: original,
    },
    {
      name: "oos",
      dataset: oos,
    },
  ];

  const output: ExperimentOutput = {
    generatedAt:
      new Date().toISOString(),

    methodology: {
      purpose:
        "Compare the existing raw-price signal with a price-normalised signal using training-only threshold calibration and fixed portfolio rules.",

      positionNotional:
        POSITION_NOTIONAL,

      minimumTransactionNotional:
        POSITION_NOTIONAL,

      capacity:
        POSITION_CAPACITY,

      feeRate:
        FEE_RATE,

      executionCost:
        EXECUTION_COST,

      rawSlopeThreshold:
        RAW_SLOPE_THRESHOLD,

      rawAccelerationThreshold:
        RAW_ACCELERATION_THRESHOLD,

      targets:
        TARGETS,

      stopPct:
        STOP_PCT,

      maxHoldMinutes:
        MAX_HOLD_MINUTES,

      normalisation:
        "normalisedSlope = regressionSlope / entryPrice; normalisedAcceleration = (slope20 - slope50) / entryPrice",

      splitMethod:
        "chronological 60% training / 20% validation / 20% test; normalised thresholds calibrated exclusively from training observations",

      forwardHorizonsMinutes:
        FORWARD_HORIZONS,
    },

    datasets: {
      original:
        undefined as never,

      oos:
        undefined as never,
    },
  };

  for (const {
    name,
    dataset,
  } of datasets) {
    console.log("");
    console.log(
      "============================================================"
    );
    console.log(
      `${name.toUpperCase()} DATASET`
    );
    console.log(
      "============================================================"
    );

    const splits =
      createSplits(
        dataset
      );

    console.log(
      `Markets: ${dataset.markets.length}`
    );

    console.log(
      `Start:   ${new Date(splits.training.startTime).toISOString()}`
    );

    console.log(
      `Train:   ${new Date(splits.training.endTime).toISOString()}`
    );

    console.log(
      `Valid:   ${new Date(splits.validation.endTime).toISOString()}`
    );

    console.log(
      `End:     ${new Date(splits.test.endTime).toISOString()}`
    );

    console.log("");
    console.log(
      "Preparing indicators..."
    );

    const preparationStart =
      Date.now();

    const preparedMarkets =
      prepareMarkets(
        dataset
      );

    console.log(
      `Prepared ${preparedMarkets.length} markets in ${((Date.now() - preparationStart) / 1000).toFixed(2)}s`
    );

    console.log("");
    console.log(
      "Calibrating normalised thresholds from training data only..."
    );

    const calibration =
      calibrateNormalisedThresholds(
        dataset,
        splits.training
      );

    console.log(
      `  Raw slope threshold:         ${calibration.rawSlopeThreshold}`
    );

    console.log(
      `  Normalised slope threshold:  ${calibration.normalisedSlopeThreshold}`
    );

    console.log(
      `  Raw acceleration threshold:  ${calibration.rawAccelerationThreshold}`
    );

    console.log(
      `  Normalised acceleration:     ${calibration.normalisedAccelerationThreshold}`
    );

    console.log(
      `  Raw slope lower-tail rate:   ${(calibration.slopePercentile * 100).toFixed(3)}%`
    );

    console.log(
      `  Raw acceleration upper-tail: ${(calibration.accelerationPercentile * 100).toFixed(3)}%`
    );

    console.log("");

    console.log(
      "Running training period..."
    );

    const training =
      runPeriod(
        preparedMarkets,
        name,
        splits.training,
        RAW_SLOPE_THRESHOLD,
        RAW_ACCELERATION_THRESHOLD,
        calibration.normalisedSlopeThreshold,
        calibration.normalisedAccelerationThreshold
      );

    printComparison(
      "TRAINING",
      training
    );

    console.log("");
    console.log(
      "Running validation period..."
    );

    const validation =
      runPeriod(
        preparedMarkets,
        name,
        splits.validation,
        RAW_SLOPE_THRESHOLD,
        RAW_ACCELERATION_THRESHOLD,
        calibration.normalisedSlopeThreshold,
        calibration.normalisedAccelerationThreshold
      );

    printComparison(
      "VALIDATION",
      validation
    );

    console.log("");
    console.log(
      "Running test period..."
    );

    const test =
      runPeriod(
        preparedMarkets,
        name,
        splits.test,
        RAW_SLOPE_THRESHOLD,
        RAW_ACCELERATION_THRESHOLD,
        calibration.normalisedSlopeThreshold,
        calibration.normalisedAccelerationThreshold
      );

    printComparison(
      "TEST",
      test
    );

    output.datasets[name] = {
      dataset:
        path.basename(
          name === "original"
            ? ORIGINAL_DATASET_PATH
            : oosPath
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

  const timestamp =
    Date.now();

  const outputPath =
    path.join(
      OUTPUT_DIR,
      `normalised-signal-experiment-${timestamp}.json`
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "FINAL TEST COMPARISON"
  );
  console.log(
    "============================================================"
  );

  for (const name of [
    "original",
    "oos",
  ] as const) {
    const test =
      output.datasets[
        name
      ].periods.test;

    printComparison(
      name.toUpperCase(),
      test
    );
  }

  console.log("");
  console.log(
    `Output: ${outputPath}`
  );
  console.log("");
}

main();
