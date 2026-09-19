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

type ExitReason =
  | "target"
  | "stop"
  | "max_hold";

interface Signal {
  marketIndex: number;
  candleIndex: number;
  time: number;
  price: number;
}

interface Position {
  id: number;
  marketIndex: number;
  symbol: string;

  entryTime: number;
  entryCandleIndex: number;
  entryPrice: number;

  notional: number;
  quantity: number;
  entryFee: number;
  totalEntryCost: number;

  targetPrice: number;
  stopPrice: number;
  maximumHoldTime: number;
}

interface CompletedTrade {
  entryTime: number;
  exitTime: number;

  symbol: string;

  entryPrice: number;
  exitPrice: number;

  notional: number;

  entryFee: number;
  exitFee: number;

  netPnl: number;
  returnPct: number;

  exitReason: ExitReason;

  holdMinutes: number;
}

interface RunResult {
  startingCapital: number;
  targetPct: number;

  finalEquity: number;
  netProfit: number;
  totalReturn: number;

  signals: number;
  entries: number;
  completedTrades: number;

  rejectedAtCapacity: number;
  rejectedInsufficientCash: number;

  winningTrades: number;
  losingTrades: number;
  winRate: number;

  targetExits: number;
  stopExits: number;
  maxHoldExits: number;

  fees: number;

  grossProfit: number;
  grossLoss: number;
  profitFactor: number;

  averageReturnPct: number;
  medianReturnPct: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  maxOpenPositions: number;

  peakEquity: number;
  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

  minimumCash: number;

  averagePositionSize: number;
  minimumPositionSize: number;
  maximumPositionSize: number;

  finalCash: number;
  finalMarketValue: number;
}

const DATASET_PATH = path.join(
  process.cwd(),
  "research",
  "data",
  "ema-data-1789061547934.json"
);

const OUTPUT_DIR = path.join(
  process.cwd(),
  "research",
  "output"
);

const FEE_RATE = 0.001;

const EXECUTION_COST = 0;

const MIN_POSITION_VALUE = 10;

const MAX_POSITION_EQUITY_PCT = 0.05;

const MAX_OPEN_POSITIONS = 43;

const STOP_PCT = 0.10;

const MAX_HOLD_MS =
  48 * 60 * 60 * 1000;

const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const STARTING_CAPITALS = [
  100,
  200,
  300,
  400,
  500,
];

const TARGET_PCTS = [
  0.01,
  0.02,
  0.03,
  0.04,
  0.05,
  0.06,
  0.07,
  0.08,
  0.09,
  0.10,
];

const MS_PER_MINUTE = 60_000;

const EPSILON = 1e-12;

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

function formatDuration(
  milliseconds: number
): string {
  const seconds =
    milliseconds / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = seconds / 60;

  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }

  return `${(minutes / 60).toFixed(2)}h`;
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

  const index =
    (sorted.length - 1) * p;

  const lower =
    Math.floor(index);

  const upper =
    Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight =
    index - lower;

  return (
    sorted[lower] *
      (1 - weight) +
    sorted[upper] *
      weight
  );
}

function calculateFee(
  value: number
): number {
  return (
    value *
    (FEE_RATE + EXECUTION_COST)
  );
}

/* -------------------------------------------------------------------------- */
/* Signal calculation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * O(n) rolling linear-regression slope.
 *
 * This is deliberately the same calculation used by the
 * previous working single-target runner.
 */
function buildRegressionSlopes(
  closes: number[],
  windowSize: number
): Float64Array {
  const n = closes.length;

  const slopes =
    new Float64Array(n);

  if (n < windowSize) {
    return slopes;
  }

  const prefixY =
    new Float64Array(n + 1);

  const prefixIndexY =
    new Float64Array(n + 1);

  for (
    let i = 0;
    i < n;
    i++
  ) {
    const close =
      closes[i];

    prefixY[i + 1] =
      prefixY[i] + close;

    prefixIndexY[i + 1] =
      prefixIndexY[i] +
      i * close;
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

  for (
    let end = windowSize - 1;
    end < n;
    end++
  ) {
    const start =
      end - windowSize + 1;

    const sumY =
      prefixY[end + 1] -
      prefixY[start];

    const globalWeightedSum =
      prefixIndexY[end + 1] -
      prefixIndexY[start];

    const sumXY =
      globalWeightedSum -
      start * sumY;

    slopes[end] =
      (windowSize * sumXY -
        sumX * sumY) /
      denominator;
  }

  return slopes;
}

/**
 * IMPORTANT:
 *
 * This is the exact signal definition from the previous
 * working runner.
 *
 * Do not replace this with a different interpretation of
 * slope or acceleration.
 */
function buildSignalIndices(
  candles: Candle[]
): number[] {
  if (candles.length < 50) {
    return [];
  }

  const closes =
    new Float64Array(
      candles.length
    );

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {
    closes[i] =
      candles[i].close;
  }

  const slope20 =
    buildRegressionSlopes(
      Array.from(closes),
      20
    );

  const slope50 =
    buildRegressionSlopes(
      Array.from(closes),
      50
    );

  const signalIndices: number[] =
    [];

  for (
    let i = 49;
    i < candles.length;
    i++
  ) {
    const acceleration =
      slope20[i] -
      slope50[i];

    if (
      slope20[i] <=
        SLOPE_THRESHOLD &&
      acceleration >=
        ACCELERATION_THRESHOLD
    ) {
      signalIndices.push(i);
    }
  }

  return signalIndices;
}

/* -------------------------------------------------------------------------- */
/* Global signal list                                                         */
/* -------------------------------------------------------------------------- */

function buildSignals(
  markets: MarketData[]
): Signal[] {
  const signals: Signal[] =
    [];

  for (
    let marketIndex = 0;
    marketIndex < markets.length;
    marketIndex++
  ) {
    const market =
      markets[marketIndex];

    const signalIndices =
      buildSignalIndices(
        market.candles
      );

    for (
      const candleIndex of
        signalIndices
    ) {
      const candle =
        market.candles[
          candleIndex
        ];

      signals.push({
        marketIndex,
        candleIndex,
        time:
          candle.openTime,
        price:
          candle.close,
      });
    }

    if (
      (marketIndex + 1) %
        10 ===
        0 ||
      marketIndex ===
        markets.length - 1
    ) {
      console.log(
        `  ${marketIndex + 1}/${markets.length} markets`
      );
    }
  }

  signals.sort(
    (a, b) => {
      if (a.time !== b.time) {
        return a.time - b.time;
      }

      if (
        a.marketIndex !==
        b.marketIndex
      ) {
        return (
          a.marketIndex -
          b.marketIndex
        );
      }

      return (
        a.candleIndex -
        b.candleIndex
      );
    }
  );

  return signals;
}

/* -------------------------------------------------------------------------- */
/* Position exit calculation                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Finds the first exit for a position.
 *
 * Priority on each candle:
 *
 * 1. stop
 * 2. target
 * 3. max hold
 *
 * This preserves the previous runner's conservative
 * same-candle assumption.
 */
function findExit(
  market: MarketData,
  position: Position
): {
  exitTime: number;
  exitPrice: number;
  exitReason: ExitReason;
} {
  const candles =
    market.candles;

  for (
    let i =
      position.entryCandleIndex +
      1;
    i < candles.length;
    i++
  ) {
    const candle =
      candles[i];

    if (
      candle.low <=
      position.stopPrice
    ) {
      return {
        exitTime:
          candle.openTime,
        exitPrice:
          position.stopPrice,
        exitReason: "stop",
      };
    }

    if (
      candle.high >=
      position.targetPrice
    ) {
      return {
        exitTime:
          candle.openTime,
        exitPrice:
          position.targetPrice,
        exitReason: "target",
      };
    }

    if (
      candle.openTime >=
      position.maximumHoldTime
    ) {
      return {
        exitTime:
          candle.openTime,
        exitPrice:
          candle.close,
        exitReason:
          "max_hold",
      };
    }
  }

  const finalCandle =
    candles[
      candles.length - 1
    ];

  return {
    exitTime:
      finalCandle.openTime,
    exitPrice:
      finalCandle.close,
    exitReason:
      "max_hold",
  };
}

/* -------------------------------------------------------------------------- */
/* Portfolio simulation                                                       */
/* -------------------------------------------------------------------------- */

interface ExitEvent {
  time: number;
  position: Position;
  exitPrice: number;
  exitReason: ExitReason;
}

interface SimulationState {
  cash: number;

  positions: Position[];

  completedTrades:
    CompletedTrade[];

  totalFees: number;

  rejectedAtCapacity: number;

  rejectedInsufficientCash: number;

  maxOpenPositions: number;

  peakEquity: number;

  maxDrawdownAbsolute: number;

  maxDrawdownPct: number;

  minimumCash: number;

  positionSizes: number[];
}

function getPositionMarketValue(
  position: Position,
  price: number
): number {
  return (
    position.quantity *
    price
  );
}

function getMarketPrice(
  market: MarketData,
  candleIndex: number
): number {
  return market.candles[
    candleIndex
  ].close;
}

function getEquity(
  markets: MarketData[],
  positions: Position[],
  cash: number,
  currentTime: number
): number {
  let marketValue = 0;

  for (
    const position of positions
  ) {
    /*
     * Find the most recent candle at or before
     * the current event time.
     *
     * Positions are only held for 48h and the
     * dataset is one-minute data, so walking
     * backwards from the position's exit is cheap.
     */
    const candles =
      markets[
        position.marketIndex
      ].candles;

    let low = 0;
    let high =
      candles.length - 1;

    while (low <= high) {
      const mid =
        (low + high) >> 1;

      if (
        candles[mid].openTime <=
        currentTime
      ) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const index =
      Math.max(0, high);

    marketValue +=
      getPositionMarketValue(
        position,
        candles[index].close
      );
  }

  return (
    cash + marketValue
  );
}

function updateDrawdown(
  state: SimulationState,
  equity: number
): void {
  if (
    equity >
    state.peakEquity
  ) {
    state.peakEquity =
      equity;
  }

  const drawdown =
    state.peakEquity -
    equity;

  if (
    drawdown >
    state.maxDrawdownAbsolute
  ) {
    state.maxDrawdownAbsolute =
      drawdown;
  }

  if (
    state.peakEquity >
    EPSILON
  ) {
    const drawdownPct =
      drawdown /
      state.peakEquity;

    if (
      drawdownPct >
      state.maxDrawdownPct
    ) {
      state.maxDrawdownPct =
        drawdownPct;
    }
  }
}

function closePosition(
  state: SimulationState,
  position: Position,
  exitPrice: number,
  exitTime: number,
  exitReason: ExitReason
): void {
  const exitValue =
    position.quantity *
    exitPrice;

  const exitFee =
    calculateFee(exitValue);

  const cashReceived =
    exitValue -
    exitFee;

  state.cash +=
    cashReceived;

  state.totalFees +=
    exitFee;

  const netPnl =
    exitValue -
    exitFee -
    position.notional -
    position.entryFee;

  const returnPct =
    netPnl /
    position.notional;

  state.completedTrades.push({
    entryTime:
      position.entryTime,

    exitTime,

    symbol:
      position.symbol,

    entryPrice:
      position.entryPrice,

    exitPrice,

    notional:
      position.notional,

    entryFee:
      position.entryFee,

    exitFee,

    netPnl,

    returnPct,

    exitReason,

    holdMinutes:
      (exitTime -
        position.entryTime) /
      MS_PER_MINUTE,
  });
}

function simulateRun(
  markets: MarketData[],
  signals: Signal[],
  targetPct: number,
  startingCapital: number
): RunResult {
  const state:
    SimulationState = {
    cash:
      startingCapital,

    positions: [],

    completedTrades: [],

    totalFees: 0,

    rejectedAtCapacity: 0,

    rejectedInsufficientCash: 0,

    maxOpenPositions: 0,

    peakEquity:
      startingCapital,

    maxDrawdownAbsolute: 0,

    maxDrawdownPct: 0,

    minimumCash:
      startingCapital,

    positionSizes: [],
  };

  /*
   * Exit events are generated lazily.
   *
   * We keep them in a simple array because every
   * position is inserted chronologically as entries
   * are processed. The next exit is found by scanning
   * active positions at each signal.
   *
   * With the 43-position limit this remains small.
   */
  let signalIndex = 0;

  const exitEvents: ExitEvent[] =
    [];

  let nextPositionId = 1;

  /*
   * Process every signal chronologically.
   *
   * Before accepting a new entry, close every position
   * whose exit has occurred by this signal timestamp.
   */
  while (
    signalIndex <
    signals.length
  ) {
    const signal =
      signals[signalIndex];

    /*
     * Process all exits occurring before or at this
     * signal timestamp.
     */
    const dueExits:
      ExitEvent[] = [];

    for (
      let i =
        exitEvents.length - 1;
      i >= 0;
      i--
    ) {
      const exit =
        exitEvents[i];

      if (
        exit.time <=
        signal.time
      ) {
        dueExits.push(exit);

        exitEvents.splice(i, 1);
      }
    }

    dueExits.sort(
      (a, b) =>
        a.time - b.time
    );

    for (
      const exit of dueExits
    ) {
      const positionIndex =
        state.positions.indexOf(
          exit.position
        );

      if (
        positionIndex === -1
      ) {
        continue;
      }

      closePosition(
        state,
        exit.position,
        exit.exitPrice,
        exit.time,
        exit.exitReason
      );

      state.positions.splice(
        positionIndex,
        1
      );
    }

    /*
     * Mark the portfolio to market at this timestamp
     * before making the new investment decision.
     */
    const equity =
      getEquity(
        markets,
        state.positions,
        state.cash,
        signal.time
      );

    updateDrawdown(
      state,
      equity
    );

    state.minimumCash =
      Math.min(
        state.minimumCash,
        state.cash
      );

    /*
     * Enforce the 43-position limit.
     */
    if (
      state.positions.length >=
      MAX_OPEN_POSITIONS
    ) {
      state.rejectedAtCapacity++;

      signalIndex++;
      continue;
    }

    /*
     * Position size is based on total portfolio equity,
     * not available cash.
     *
     * The $10 minimum overrides 5% when 5% is below
     * $10. Therefore:
     *
     * $100 -> $10
     * $200 -> $10
     * $300 -> $15
     * $400 -> $20
     * $500 -> $25
     */
    const positionValue =
      Math.max(
        MIN_POSITION_VALUE,
        equity *
          MAX_POSITION_EQUITY_PCT
      );

    const entryFee =
      calculateFee(
        positionValue
      );

    const totalEntryCost =
      positionValue +
      entryFee;

    /*
     * Do not borrow money.
     */
    if (
      totalEntryCost >
      state.cash +
        EPSILON
    ) {
      state.rejectedInsufficientCash++;

      signalIndex++;
      continue;
    }

    const market =
      markets[
        signal.marketIndex
      ];

    const entryPrice =
      signal.price;

    const quantity =
      positionValue /
      entryPrice;

    const position:
      Position = {
      id:
        nextPositionId++,

      marketIndex:
        signal.marketIndex,

      symbol:
        market.symbol,

      entryTime:
        signal.time,

      entryCandleIndex:
        signal.candleIndex,

      entryPrice,

      notional:
        positionValue,

      quantity,

      entryFee,

      totalEntryCost,

      targetPrice:
        entryPrice *
        (1 + targetPct),

      stopPrice:
        entryPrice *
        (1 - STOP_PCT),

      maximumHoldTime:
        signal.time +
        MAX_HOLD_MS,
    };

    state.cash -=
      totalEntryCost;

    state.totalFees +=
      entryFee;

    state.positions.push(
      position
    );

    state.positionSizes.push(
      positionValue
    );

    state.maxOpenPositions =
      Math.max(
        state.maxOpenPositions,
        state.positions.length
      );

    /*
     * Determine the position's eventual exit.
     */
    const exit =
      findExit(
        market,
        position
      );

    exitEvents.push({
      time:
        exit.exitTime,

      position,

      exitPrice:
        exit.exitPrice,

      exitReason:
        exit.exitReason,
    });

    signalIndex++;
  }

  /*
   * Close all remaining positions at their scheduled
   * exit times, in chronological order.
   */
  exitEvents.sort(
    (a, b) =>
      a.time - b.time
  );

  for (
    const exit of exitEvents
  ) {
    const positionIndex =
      state.positions.indexOf(
        exit.position
      );

    if (
      positionIndex === -1
    ) {
      continue;
    }

    closePosition(
      state,
      exit.position,
      exit.exitPrice,
      exit.time,
      exit.exitReason
    );

    state.positions.splice(
      positionIndex,
      1
    );

    /*
     * Update realised-equity drawdown after the exit.
     */
    updateDrawdown(
      state,
      state.cash
    );

    state.minimumCash =
      Math.min(
        state.minimumCash,
        state.cash
      );
  }

  /*
   * The dataset is complete enough for all scheduled
   * exits under the 48-hour rule, but if anything somehow
   * remains open, mark it at the final candle.
   */
  if (
    state.positions.length >
    0
  ) {
    for (
      const position of [
        ...state.positions,
      ]
    ) {
      const market =
        markets[
          position.marketIndex
        ];

      const finalCandle =
        market.candles[
          market.candles.length - 1
        ];

      closePosition(
        state,
        position,
        finalCandle.close,
        finalCandle.openTime,
        "max_hold"
      );
    }

    state.positions.length = 0;
  }

  const finalCash =
    state.cash;

  const finalMarketValue = 0;

  const finalEquity =
    finalCash +
    finalMarketValue;

  const trades =
    state.completedTrades;

  const winningTrades =
    trades.filter(
      trade =>
        trade.netPnl > 0
    );

  const losingTrades =
    trades.filter(
      trade =>
        trade.netPnl < 0
    );

  const grossProfit =
    winningTrades.reduce(
      (sum, trade) =>
        sum + trade.netPnl,
      0
    );

  const grossLoss =
    losingTrades.reduce(
      (sum, trade) =>
        sum +
        Math.abs(
          trade.netPnl
        ),
      0
    );

  const returns =
    trades.map(
      trade =>
        trade.returnPct
    );

  const holdTimes =
    trades.map(
      trade =>
        trade.holdMinutes
    );

  const targetExits =
    trades.filter(
      trade =>
        trade.exitReason ===
        "target"
    ).length;

  const stopExits =
    trades.filter(
      trade =>
        trade.exitReason ===
        "stop"
    ).length;

  const maxHoldExits =
    trades.filter(
      trade =>
        trade.exitReason ===
        "max_hold"
    ).length;

  const averagePositionSize =
    state.positionSizes.length >
    0
      ? state.positionSizes.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        state.positionSizes.length
      : 0;

  const minimumPositionSize =
    state.positionSizes.length >
    0
      ? Math.min(
          ...state.positionSizes
        )
      : 0;

  const maximumPositionSize =
    state.positionSizes.length >
    0
      ? Math.max(
          ...state.positionSizes
        )
      : 0;

  const netProfit =
    finalEquity -
    startingCapital;

  return {
    startingCapital,

    targetPct,

    finalEquity,

    netProfit,

    totalReturn:
      startingCapital > 0
        ? netProfit /
          startingCapital
        : 0,

    signals:
      signals.length,

    entries:
      trades.length,

    completedTrades:
      trades.length,

    rejectedAtCapacity:
      state.rejectedAtCapacity,

    rejectedInsufficientCash:
      state.rejectedInsufficientCash,

    winningTrades:
      winningTrades.length,

    losingTrades:
      losingTrades.length,

    winRate:
      trades.length > 0
        ? winningTrades.length /
          trades.length
        : 0,

    targetExits,

    stopExits,

    maxHoldExits,

    fees:
      state.totalFees,

    grossProfit,

    grossLoss,

    profitFactor:
      grossLoss > EPSILON
        ? grossProfit /
          grossLoss
        : Infinity,

    averageReturnPct:
      returns.length > 0
        ? returns.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          returns.length
        : 0,

    medianReturnPct:
      percentile(
        returns,
        0.5
      ),

    averageHoldMinutes:
      holdTimes.length > 0
        ? holdTimes.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          holdTimes.length
        : 0,

    medianHoldMinutes:
      percentile(
        holdTimes,
        0.5
      ),

    maxOpenPositions:
      state.maxOpenPositions,

    peakEquity:
      state.peakEquity,

    maxDrawdownAbsolute:
      state.maxDrawdownAbsolute,

    maxDrawdownPct:
      state.maxDrawdownPct,

    minimumCash:
      state.minimumCash,

    averagePositionSize,

    minimumPositionSize,

    maximumPositionSize,

    finalCash,

    finalMarketValue,
  };
}

/* -------------------------------------------------------------------------- */
/* Output helpers                                                             */
/* -------------------------------------------------------------------------- */

function printResult(
  result: RunResult
): void {
  console.log(
    `  Final: $${result.finalEquity.toFixed(2)} ` +
      `(${(
        result.totalReturn * 100
      ).toFixed(2)}%)`
  );

  console.log(
    `  Trades: ${result.completedTrades.toLocaleString()} | ` +
      `Win: ${(
        result.winRate * 100
      ).toFixed(2)}% | ` +
      `Max DD: ${(
        result.maxDrawdownPct *
        100
      ).toFixed(2)}% | ` +
      `Max positions: ${result.maxOpenPositions}`
  );

  console.log(
    `  Target: ${result.targetExits.toLocaleString()} | ` +
      `Stop: ${result.stopExits.toLocaleString()} | ` +
      `48h: ${result.maxHoldExits.toLocaleString()}`
  );

  console.log(
    `  Rejected: ${result.rejectedAtCapacity.toLocaleString()} capacity, ` +
      `${result.rejectedInsufficientCash.toLocaleString()} cash`
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function main(): void {
  const startedAt =
    Date.now();

  console.log("");

  console.log(
    "========================================================================"
  );

  console.log(
    "Single-target portfolio backtest"
  );

  console.log(
    "========================================================================"
  );

  console.log("");

  console.log(
    `Data:                       ${DATASET_PATH}`
  );

  console.log(
    `Starting capitals:         ${STARTING_CAPITALS.join(
      ", "
    )}`
  );

  console.log(
    `Targets:                   ${TARGET_PCTS.map(
      value =>
        `${(
          value * 100
        ).toFixed(0)}%`
    ).join(", ")}`
  );

  console.log(
    `Maximum positions:         ${MAX_OPEN_POSITIONS}`
  );

  console.log(
    `Maximum position:          ${(
      MAX_POSITION_EQUITY_PCT *
      100
    ).toFixed(0)}% of equity`
  );

  console.log(
    `Minimum position:          $${MIN_POSITION_VALUE}`
  );

  console.log(
    `Fee per transaction:       ${(
      FEE_RATE * 100
    ).toFixed(1)}%`
  );

  console.log(
    `Stop loss:                 ${(
      STOP_PCT * 100
    ).toFixed(0)}%`
  );

  console.log(
    `Maximum hold:              48 hours`
  );

  console.log(
    `Slope threshold:           ${SLOPE_THRESHOLD}`
  );

  console.log(
    `Acceleration threshold:    ${ACCELERATION_THRESHOLD}`
  );

  console.log("");

  /* ---------------------------------------------------------------------- */
  /* Load data                                                               */
  /* ---------------------------------------------------------------------- */

  console.log(
    "Loading market data..."
  );

  const dataset =
    JSON.parse(
      fs.readFileSync(
        DATASET_PATH,
        "utf8"
      )
    ) as Dataset;

  const marketCount =
    dataset.markets.length;

  let totalCandles = 0;

  for (
    const market of dataset.markets
  ) {
    totalCandles +=
      market.candles.length;
  }

  console.log(
    `Markets loaded:            ${marketCount}`
  );

  console.log(
    `Total candles:             ${totalCandles.toLocaleString()}`
  );

  console.log(
    `Total backtests:           ${
      STARTING_CAPITALS.length *
      TARGET_PCTS.length
    }`
  );

  console.log("");

  /* ---------------------------------------------------------------------- */
  /* Signals                                                                 */
  /* ---------------------------------------------------------------------- */

  console.log(
    "Preparing signals using the existing signal calculation..."
  );

  const signalStartedAt =
    Date.now();

  const signals =
    buildSignals(
      dataset.markets
    );

  console.log("");

  console.log(
    `Total signals:             ${signals.length.toLocaleString()}`
  );

  console.log(
    `Signal preparation:       ${formatDuration(
      Date.now() -
        signalStartedAt
    )}`
  );

  console.log("");

  if (
    signals.length === 0
  ) {
    throw new Error(
      "Zero signals were generated. The signal calculation is not producing the expected historical signals."
    );
  }

  /*
   * The previous runner produced 49,769 signals.
   *
   * This is an important sanity check. If the signal
   * count changes substantially, stop rather than
   * generating misleading portfolio results.
   */
  const EXPECTED_SIGNAL_COUNT =
    49_769;

  if (
    signals.length !==
    EXPECTED_SIGNAL_COUNT
  ) {
    throw new Error(
      `Signal-count validation failed: expected ${EXPECTED_SIGNAL_COUNT.toLocaleString()} signals but generated ${signals.length.toLocaleString()}. Refusing to run the portfolio experiment.`
    );
  }

  console.log(
    "Signal-count validation:   PASSED"
  );

  console.log("");

  /* ---------------------------------------------------------------------- */
  /* Run experiments                                                         */
  /* ---------------------------------------------------------------------- */

  const results:
    RunResult[] = [];

  const totalRuns =
    STARTING_CAPITALS.length *
    TARGET_PCTS.length;

  let runNumber = 0;

  for (
    const targetPct of TARGET_PCTS
  ) {
    console.log("");

    console.log(
      `================================================================`
    );

    console.log(
      `Target ${(targetPct * 100).toFixed(
        0
      )}%`
    );

    console.log(
      `================================================================`
    );

    for (
      const startingCapital of
        STARTING_CAPITALS
    ) {
      runNumber++;

      const runStartedAt =
        Date.now();

      console.log("");

      console.log(
        `Starting run ${runNumber}/${totalRuns}: ` +
          `$${startingCapital} with ` +
          `${(
            targetPct * 100
          ).toFixed(0)}% target`
      );

      const result =
        simulateRun(
          dataset.markets,
          signals,
          targetPct,
          startingCapital
        );

      results.push(result);

      printResult(result);

      console.log(
        `  Runtime: ${formatDuration(
          Date.now() -
            runStartedAt
        )}`
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Final results                                                           */
  /* ---------------------------------------------------------------------- */

  console.log("");

  console.log(
    "=============================================================================================================="
  );

  console.log(
    "FINAL RESULTS"
  );

  console.log(
    "=============================================================================================================="
  );

  console.log("");

  console.log(
    "      Target     Capital       Final      Profit      Return      Max DD      Trades        Win%        PF        Fees     MaxPos"
  );

  console.log(
    "--------------------------------------------------------------------------------------------------------------"
  );

  for (
    const targetPct of TARGET_PCTS
  ) {
    for (
      const startingCapital of
        STARTING_CAPITALS
    ) {
      const result =
        results.find(
          item =>
            Math.abs(
              item.targetPct -
                targetPct
            ) <
              EPSILON &&
            item.startingCapital ===
              startingCapital
        );

      if (!result) {
        continue;
      }

      console.log(
        `${(
          targetPct * 100
        )
          .toFixed(0)
          .padStart(11)}%` +
          `${(
            `$${startingCapital}`
          ).padStart(13)}` +
          `${(
            `$${result.finalEquity.toFixed(
              2
            )}`
          ).padStart(13)}` +
          `${(
            `$${result.netProfit.toFixed(
              2
            )}`
          ).padStart(13)}` +
          `${(
            `${
              (
                result.totalReturn *
                100
              ).toFixed(2)
            }%`
          ).padStart(12)}` +
          `${(
            `${
              (
                result.maxDrawdownPct *
                100
              ).toFixed(2)
            }%`
          ).padStart(12)}` +
          `${result.completedTrades
            .toLocaleString()
            .padStart(13)}` +
          `${(
            `${
              (
                result.winRate *
                100
              ).toFixed(1)
            }%`
          ).padStart(13)}` +
          `${(
            Number.isFinite(
              result.profitFactor
            )
              ? result.profitFactor.toFixed(
                  2
                )
              : "∞"
          ).padStart(11)}` +
          `${(
            `$${result.fees.toFixed(
              2
            )}`
          ).padStart(12)}` +
          `${result.maxOpenPositions
            .toString()
            .padStart(10)}`
      );
    }

    console.log("");
  }

  /* ---------------------------------------------------------------------- */
  /* Final equity grid                                                       */
  /* ---------------------------------------------------------------------- */

  console.log(
    "=========================================================================================="
  );

  console.log(
    "FINAL EQUITY BY EXIT TARGET"
  );

  console.log(
    "=========================================================================================="
  );

  console.log("");

  console.log(
    "        Target" +
      STARTING_CAPITALS.map(
        capital =>
          `$${capital}`.padStart(14)
      ).join("")
  );

  console.log(
    "------------------------------------------------------------------------------------------"
  );

  for (
    const targetPct of TARGET_PCTS
  ) {
    let line =
      `${(
        targetPct * 100
      )
        .toFixed(0)
        .padStart(13)}%`;

    for (
      const startingCapital of
        STARTING_CAPITALS
    ) {
      const result =
        results.find(
          item =>
            Math.abs(
              item.targetPct -
                targetPct
            ) <
              EPSILON &&
            item.startingCapital ===
              startingCapital
        );

      line +=
        result
          ? `$${result.finalEquity
              .toFixed(2)
              .padStart(13)}`
          : "           N/A";
    }

    console.log(line);
  }

  /* ---------------------------------------------------------------------- */
  /* Return grid                                                             */
  /* ---------------------------------------------------------------------- */

  console.log("");

  console.log(
    "=========================================================================================="
  );

  console.log(
    "TOTAL RETURN BY EXIT TARGET"
  );

  console.log(
    "=========================================================================================="
  );

  console.log("");

  console.log(
    "        Target" +
      STARTING_CAPITALS.map(
        capital =>
          `$${capital}`.padStart(14)
      ).join("")
  );

  console.log(
    "------------------------------------------------------------------------------------------"
  );

  for (
    const targetPct of TARGET_PCTS
  ) {
    let line =
      `${(
        targetPct * 100
      )
        .toFixed(0)
        .padStart(13)}%`;

    for (
      const startingCapital of
        STARTING_CAPITALS
    ) {
      const result =
        results.find(
          item =>
            Math.abs(
              item.targetPct -
                targetPct
            ) <
              EPSILON &&
            item.startingCapital ===
              startingCapital
        );

      line +=
        result
          ? `${(
              result.totalReturn *
              100
            )
              .toFixed(2)
              .padStart(13)}%`
          : "           N/A";
    }

    console.log(line);
  }

  /* ---------------------------------------------------------------------- */
  /* Output JSON                                                             */
  /* ---------------------------------------------------------------------- */

  const output = {
    generatedAt:
      new Date().toISOString(),

    dataset: {
      path:
        DATASET_PATH,

      markets:
        marketCount,

      candles:
        totalCandles,

      signals:
        signals.length,
    },

    methodology: {
      signalCalculation: {
        slopeWindow1:
          20,

        slopeWindow2:
          50,

        acceleration:
          "slope20 - slope50",

        slopeThreshold:
          SLOPE_THRESHOLD,

        accelerationThreshold:
          ACCELERATION_THRESHOLD,

        condition:
          "slope20 <= threshold AND acceleration >= threshold",
      },

      entryExecution:
        "signal candle close",

      exitModel:
        "single full-position target",

      targetPercentages:
        TARGET_PCTS,

      stop:
        STOP_PCT,

      maximumHoldHours:
        48,

      sameCandlePriority:
        "stop before target",

      maximumOpenPositions:
        MAX_OPEN_POSITIONS,

      minimumPositionValue:
        MIN_POSITION_VALUE,

      maximumPositionEquityPct:
        MAX_POSITION_EQUITY_PCT,

      positionSizing:
        "max($10, 5% of total mark-to-market portfolio equity)",

      startingCapitals:
        STARTING_CAPITALS,

      overlappingPositions:
        true,

      feeRate:
        FEE_RATE,

      executionCost:
        EXECUTION_COST,

      feeDefinition:
        "0.1% of actual monetary value of each buy and sell",

      portfolioAccounting:
        "cash plus mark-to-market value of open positions",

      capitalConstraint:
        "no borrowing; entry rejected if purchase plus fee exceeds available cash",

      capacityConstraint:
        `maximum ${MAX_OPEN_POSITIONS} simultaneous open positions`,

      signalValidation:
        "exact historical signal count must equal 49,769",
    },

    results,
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  const outputPath =
    path.join(
      OUTPUT_DIR,
      `single-target-portfolio-backtest-${Date.now()}.json`
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
    "========================================================================"
  );

  console.log(
    "COMPLETE"
  );

  console.log(
    "========================================================================"
  );

  console.log("");

  console.log(
    `Output: ${outputPath}`
  );

  console.log(
    `Runtime: ${formatDuration(
      Date.now() -
        startedAt
    )}`
  );

  console.log("");
}

main();