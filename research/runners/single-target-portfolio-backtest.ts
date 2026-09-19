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

interface Configuration {
  name: string;
  targetPct: number;
  stopPct: number;
}

interface PositionResult {
  entryTime: number;
  entryPrice: number;
  entryValue: number;
  entryFee: number;

  exitTime: number;
  exitPrice: number;
  exitReason: "target" | "stop" | "max_hold";

  exitValue: number;
  exitFee: number;

  netPnl: number;
  returnPct: number;
}

interface PortfolioEvent {
  time: number;
  type: "entry" | "exit";
  cashDelta: number;
  capitalDelta: number;
  positionDelta: number;
  marketDelta: number;
}

interface MarketStream {
  symbol: string;
  candles: Candle[];
  events: PortfolioEvent[];
}

interface ConfigurationResult {
  name: string;
  targetPct: number;
  stopPct: number;

  signals: number;
  completedPositions: number;

  winningPositions: number;
  losingPositions: number;
  winRate: number;

  realisedGross: number;
  fees: number;
  netProfit: number;

  averageReturnPct: number;
  medianReturnPct: number;

  profitFactor: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  targetExits: number;
  stopExits: number;
  maxHoldExits: number;

  peakCapitalDeployed: number;
  averageCapitalDeployed: number;
  minimumStartingCash: number;

  maxOpenPositions: number;
  maxOpenMarkets: number;

  finalEquity: number;
  totalReturn: number;

  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

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
  "server",
  "research-output"
);

const FEE_RATE = 0.001;
const EXECUTION_COST = 0;
const UNIT_SIZE = 1;

const STOP_PCT = 0.10;

const MAX_HOLD_MS =
  48 * 60 * 60 * 1000;

const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const TARGET_PCTS = [
  0.005,
  0.01,
  0.015,
  0.02,
  0.025,
  0.03,
  0.04,
];

const EPSILON = 1e-12;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY =
  24 * 60 * 60 * 1000;

const CONFIGURATIONS: Configuration[] =
  TARGET_PCTS.map((targetPct) => ({
    name:
      `single_${(targetPct * 100).toFixed(1).replace(".0", "")}pct`,
    targetPct,
    stopPct: STOP_PCT,
  }));

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

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
 */
function buildRegressionSlopes(
  closes: number[],
  windowSize: number
): Float64Array {
  const n = closes.length;
  const slopes = new Float64Array(n);

  if (n < windowSize) {
    return slopes;
  }

  const prefixY =
    new Float64Array(n + 1);

  const prefixIndexY =
    new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    const close = closes[i];

    prefixY[i + 1] =
      prefixY[i] + close;

    prefixIndexY[i + 1] =
      prefixIndexY[i] +
      i * close;
  }

  const sumX =
    (windowSize * (windowSize - 1)) /
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
 * Signals are identical for every exit configuration,
 * so calculate them once.
 */
function buildSignalIndices(
  candles: Candle[]
): number[] {
  if (candles.length < 50) {
    return [];
  }

  const closes = new Float64Array(
    candles.length
  );

  for (let i = 0; i < candles.length; i++) {
    closes[i] = candles[i].close;
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

  const signalIndices: number[] = [];

  for (
    let i = 49;
    i < candles.length;
    i++
  ) {
    const acceleration =
      slope20[i] - slope50[i];

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
/* Exit engine                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Single-target position simulation.
 *
 * The position exits at the FIRST of:
 *
 * 1. stop loss
 * 2. profit target
 * 3. 48-hour maximum hold
 *
 * If stop and target are both reached on the same candle,
 * stop wins because intrabar ordering is unknowable.
 */
function simulatePosition(
  candles: Candle[],
  entryIndex: number,
  config: Configuration
): PositionResult {
  const entryCandle =
    candles[entryIndex];

  const entryPrice =
    entryCandle.close;

  const entryValue =
    UNIT_SIZE * entryPrice;

  const entryFee =
    calculateFee(entryValue);

  const targetPrice =
    entryPrice *
    (1 + config.targetPct);

  const stopPrice =
    entryPrice *
    (1 - config.stopPct);

  const maximumHoldTime =
    entryCandle.openTime +
    MAX_HOLD_MS;

  for (
    let i = entryIndex + 1;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];

    /*
     * Stop gets priority when both stop and target
     * are reachable on the same candle.
     */
    if (
      candle.low <= stopPrice
    ) {
      const exitValue =
        UNIT_SIZE * stopPrice;

      const exitFee =
        calculateFee(exitValue);

      const netPnl =
        exitValue -
        exitFee -
        entryValue -
        entryFee;

      return {
        entryTime:
          entryCandle.openTime,
        entryPrice,
        entryValue,
        entryFee,

        exitTime: candle.openTime,
        exitPrice: stopPrice,
        exitReason: "stop",

        exitValue,
        exitFee,

        netPnl,
        returnPct:
          netPnl / entryValue,
      };
    }

    if (
      candle.high >= targetPrice
    ) {
      const exitValue =
        UNIT_SIZE * targetPrice;

      const exitFee =
        calculateFee(exitValue);

      const netPnl =
        exitValue -
        exitFee -
        entryValue -
        entryFee;

      return {
        entryTime:
          entryCandle.openTime,
        entryPrice,
        entryValue,
        entryFee,

        exitTime: candle.openTime,
        exitPrice: targetPrice,
        exitReason: "target",

        exitValue,
        exitFee,

        netPnl,
        returnPct:
          netPnl / entryValue,
      };
    }

    /*
     * Maximum holding period.
     *
     * We use the candle close as the executable price for
     * the max-hold exit.
     */
    if (
      candle.openTime >=
      maximumHoldTime
    ) {
      const exitValue =
        UNIT_SIZE * candle.close;

      const exitFee =
        calculateFee(exitValue);

      const netPnl =
        exitValue -
        exitFee -
        entryValue -
        entryFee;

      return {
        entryTime:
          entryCandle.openTime,
        entryPrice,
        entryValue,
        entryFee,

        exitTime: candle.openTime,
        exitPrice: candle.close,
        exitReason: "max_hold",

        exitValue,
        exitFee,

        netPnl,
        returnPct:
          netPnl / entryValue,
      };
    }
  }

  /*
   * If the dataset ends before the 48-hour limit,
   * close at the final observed candle.
   */
  const finalCandle =
    candles[candles.length - 1];

  const exitValue =
    UNIT_SIZE *
    finalCandle.close;

  const exitFee =
    calculateFee(exitValue);

  const netPnl =
    exitValue -
    exitFee -
    entryValue -
    entryFee;

  return {
    entryTime:
      entryCandle.openTime,
    entryPrice,
    entryValue,
    entryFee,

    exitTime:
      finalCandle.openTime,
    exitPrice:
      finalCandle.close,
    exitReason: "max_hold",

    exitValue,
    exitFee,

    netPnl,
    returnPct:
      netPnl / entryValue,
  };
}

/* -------------------------------------------------------------------------- */
/* Portfolio events                                                           */
/* -------------------------------------------------------------------------- */

function compareEvents(
  a: PortfolioEvent,
  b: PortfolioEvent
): number {
  if (a.time !== b.time) {
    return a.time - b.time;
  }

  /*
   * Sales before purchases at the same timestamp.
   */
  if (a.type === b.type) {
    return 0;
  }

  return a.type === "exit"
    ? -1
    : 1;
}

function buildMarketStream(
  market: MarketData,
  signalIndices: number[],
  config: Configuration
): MarketStream {
  const events: PortfolioEvent[] =
    [];

  for (const entryIndex of signalIndices) {
    const position =
      simulatePosition(
        market.candles,
        entryIndex,
        config
      );

    events.push({
      time:
        position.entryTime,
      type: "entry",

      cashDelta:
        -(
          position.entryValue +
          position.entryFee
        ),

      capitalDelta:
        position.entryValue,

      positionDelta: 1,
      marketDelta: 1,
    });

    events.push({
      time:
        position.exitTime,
      type: "exit",

      cashDelta:
        position.exitValue -
        position.exitFee,

      capitalDelta:
        -position.entryValue,

      positionDelta: -1,
      marketDelta: -1,
    });
  }

  events.sort(compareEvents);

  return {
    symbol: market.symbol,
    candles: market.candles,
    events,
  };
}

/* -------------------------------------------------------------------------- */
/* Event heap                                                                 */
/* -------------------------------------------------------------------------- */

interface HeapItem {
  streamIndex: number;
  eventIndex: number;
}

function heapLess(
  streams: MarketStream[],
  a: HeapItem,
  b: HeapItem
): boolean {
  const eventA =
    streams[a.streamIndex]
      .events[a.eventIndex];

  const eventB =
    streams[b.streamIndex]
      .events[b.eventIndex];

  return (
    compareEvents(eventA, eventB) <
    0
  );
}

function heapPush(
  heap: HeapItem[],
  streams: MarketStream[],
  item: HeapItem
): void {
  let index = heap.length;

  heap.push(item);

  while (index > 0) {
    const parent =
      (index - 1) >> 1;

    if (
      !heapLess(
        streams,
        item,
        heap[parent]
      )
    ) {
      break;
    }

    heap[index] =
      heap[parent];

    index = parent;
  }

  heap[index] = item;
}

function heapPop(
  heap: HeapItem[],
  streams: MarketStream[]
): HeapItem | undefined {
  if (heap.length === 0) {
    return undefined;
  }

  const root = heap[0];
  const last = heap.pop()!;

  if (heap.length === 0) {
    return root;
  }

  let index = 0;

  while (true) {
    const left =
      index * 2 + 1;

    if (
      left >= heap.length
    ) {
      break;
    }

    const right =
      left + 1;

    let child = left;

    if (
      right < heap.length &&
      heapLess(
        streams,
        heap[right],
        heap[left]
      )
    ) {
      child = right;
    }

    if (
      !heapLess(
        streams,
        heap[child],
        last
      )
    ) {
      break;
    }

    heap[index] =
      heap[child];

    index = child;
  }

  heap[index] = last;

  return root;
}

/* -------------------------------------------------------------------------- */
/* Portfolio simulation                                                       */
/* -------------------------------------------------------------------------- */

interface PortfolioSweep {
  minimumStartingCash: number;
  peakCapitalDeployed: number;
  averageCapitalDeployed: number;

  maxOpenPositions: number;
  maxOpenMarkets: number;

  finalCash: number;
  finalMarketValue: number;
  finalEquity: number;

  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;
}

function simulatePortfolio(
  streams: MarketStream[],
  startTime: number,
  endTime: number,
  startingCash: number
): PortfolioSweep {
  const heap: HeapItem[] = [];

  for (
    let streamIndex = 0;
    streamIndex < streams.length;
    streamIndex++
  ) {
    if (
      streams[streamIndex]
        .events.length > 0
    ) {
      heapPush(
        heap,
        streams,
        {
          streamIndex,
          eventIndex: 0,
        }
      );
    }
  }

  let cash = startingCash;

  let capitalDeployed = 0;
  let peakCapitalDeployed = 0;

  let openPositions = 0;
  let openMarkets = 0;

  let maxOpenPositions = 0;
  let maxOpenMarkets = 0;

  let capitalDays = 0;
  let previousTime = startTime;

  /*
   * Because every position has a unique market stream,
   * quantities can be reconstructed while walking events.
   */
  const quantities =
    new Float64Array(
      streams.length
    );

  let minimumCash =
    startingCash;

  while (heap.length > 0) {
    const first =
      heapPop(heap, streams)!;

    const event =
      streams[first.streamIndex]
        .events[first.eventIndex];

    const time = event.time;

    if (time > previousTime) {
      capitalDays +=
        (capitalDeployed *
          (time - previousTime)) /
        MS_PER_DAY;

      previousTime = time;
    }

    cash += event.cashDelta;

    capitalDeployed +=
      event.capitalDelta;

    openPositions +=
      event.positionDelta;

    openMarkets +=
      event.marketDelta;

    quantities[
      first.streamIndex
    ] += event.positionDelta;

    minimumCash = Math.min(
      minimumCash,
      cash
    );

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
        openMarkets
      );

    const nextEventIndex =
      first.eventIndex + 1;

    if (
      nextEventIndex <
      streams[first.streamIndex]
        .events.length
    ) {
      heapPush(
        heap,
        streams,
        {
          streamIndex:
            first.streamIndex,
          eventIndex:
            nextEventIndex,
        }
      );
    }
  }

  if (endTime > previousTime) {
    capitalDays +=
      (capitalDeployed *
        (endTime - previousTime)) /
      MS_PER_DAY;
  }

  const totalDays =
    (endTime - startTime) /
    MS_PER_DAY;

  const averageCapitalDeployed =
    totalDays > 0
      ? capitalDays / totalDays
      : 0;

  /*
   * All positions are closed by the simulation,
   * so final market value is zero.
   *
   * Keep this explicit rather than hiding the accounting.
   */
  const finalCash = cash;
  const finalMarketValue = 0;
  const finalEquity =
    finalCash + finalMarketValue;

  /*
   * Reconstruct equity chronologically.
   *
   * For this single-target test, every position is
   * closed at its exit event, so equity changes only
   * through cash movements. We calculate drawdown
   * from the event stream.
   */
  const equityHeap: HeapItem[] =
    [];

  for (
    let streamIndex = 0;
    streamIndex < streams.length;
    streamIndex++
  ) {
    if (
      streams[streamIndex]
        .events.length > 0
    ) {
      heapPush(
        equityHeap,
        streams,
        {
          streamIndex,
          eventIndex: 0,
        }
      );
    }
  }

  let equity =
    startingCash;

  let peakEquity =
    startingCash;

  let maxDrawdownAbsolute = 0;
  let maxDrawdownPct = 0;

  while (
    equityHeap.length > 0
  ) {
    const item =
      heapPop(
        equityHeap,
        streams
      )!;

    const event =
      streams[item.streamIndex]
        .events[item.eventIndex];

    equity +=
      event.cashDelta;

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

    const drawdown =
      peakEquity - equity;

    maxDrawdownAbsolute =
      Math.max(
        maxDrawdownAbsolute,
        drawdown
      );

    if (peakEquity > 0) {
      maxDrawdownPct =
        Math.max(
          maxDrawdownPct,
          drawdown / peakEquity
        );
    }

    const nextEventIndex =
      item.eventIndex + 1;

    if (
      nextEventIndex <
      streams[item.streamIndex]
        .events.length
    ) {
      heapPush(
        equityHeap,
        streams,
        {
          streamIndex:
            item.streamIndex,
          eventIndex:
            nextEventIndex,
        }
      );
    }
  }

  return {
    minimumStartingCash:
      startingCash,

    peakCapitalDeployed,

    averageCapitalDeployed,

    maxOpenPositions,
    maxOpenMarkets,

    finalCash,
    finalMarketValue,
    finalEquity,

    maxDrawdownAbsolute,
    maxDrawdownPct,
  };
}

/* -------------------------------------------------------------------------- */
/* Position statistics                                                        */
/* -------------------------------------------------------------------------- */

function collectPositionResults(
  markets: MarketData[],
  signalIndices: number[][],
  config: Configuration
) {
  const returns: number[] = [];
  const holdTimes: number[] = [];

  let signals = 0;

  let winningPositions = 0;
  let losingPositions = 0;

  let realisedGross = 0;
  let fees = 0;

  let targetExits = 0;
  let stopExits = 0;
  let maxHoldExits = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  for (
    let marketIndex = 0;
    marketIndex < markets.length;
    marketIndex++
  ) {
    const market =
      markets[marketIndex];

    for (
      const entryIndex of
        signalIndices[marketIndex]
    ) {
      const position =
        simulatePosition(
          market.candles,
          entryIndex,
          config
        );

      signals++;

      returns.push(
        position.returnPct
      );

      holdTimes.push(
        (
          position.exitTime -
          position.entryTime
        ) / MS_PER_MINUTE
      );

      realisedGross +=
        position.exitValue -
        position.entryValue;

      fees +=
        position.entryFee +
        position.exitFee;

      if (
        position.netPnl > 0
      ) {
        winningPositions++;
        grossProfit +=
          position.netPnl;
      } else if (
        position.netPnl < 0
      ) {
        losingPositions++;
        grossLoss +=
          Math.abs(
            position.netPnl
          );
      }

      if (
        position.exitReason ===
        "target"
      ) {
        targetExits++;
      } else if (
        position.exitReason ===
        "stop"
      ) {
        stopExits++;
      } else {
        maxHoldExits++;
      }
    }
  }

  const netProfit =
    returns.reduce(
      (sum, returnPct, index) =>
        sum +
        returnPct *
          simulateEntryValue(
            markets,
            signalIndices,
            config,
            index
          ),
      0
    );

  /*
   * The expression above is not used for the final
   * dollar result because position entry values differ.
   * Calculate net profit directly below instead.
   */
  let directNetProfit = 0;

  for (
    let marketIndex = 0;
    marketIndex < markets.length;
    marketIndex++
  ) {
    const market =
      markets[marketIndex];

    for (
      const entryIndex of
        signalIndices[marketIndex]
    ) {
      directNetProfit +=
        simulatePosition(
          market.candles,
          entryIndex,
          config
        ).netPnl;
    }
  }

  return {
    signals,

    completedPositions:
      signals,

    winningPositions,
    losingPositions,

    winRate:
      signals > 0
        ? winningPositions /
          signals
        : 0,

    realisedGross,

    fees,

    netProfit:
      directNetProfit,

    averageReturnPct:
      returns.length > 0
        ? returns.reduce(
            (sum, value) =>
              sum + value,
            0
          ) / returns.length
        : 0,

    medianReturnPct:
      percentile(
        returns,
        0.5
      ),

    profitFactor:
      grossLoss > 0
        ? grossProfit /
          grossLoss
        : Infinity,

    averageHoldMinutes:
      holdTimes.length > 0
        ? holdTimes.reduce(
            (sum, value) =>
              sum + value,
            0
          ) / holdTimes.length
        : 0,

    medianHoldMinutes:
      percentile(
        holdTimes,
        0.5
      ),

    targetExits,
    stopExits,
    maxHoldExits,
  };
}

/*
 * Kept only to make the intermediate return calculation
 * explicit. The final net result uses directNetProfit.
 */
function simulateEntryValue(
  markets: MarketData[],
  signalIndices: number[][],
  config: Configuration,
  index: number
): number {
  let count = 0;

  for (
    let marketIndex = 0;
    marketIndex < markets.length;
    marketIndex++
  ) {
    for (
      const entryIndex of
        signalIndices[marketIndex]
    ) {
      if (count === index) {
        return (
          markets[marketIndex]
            .candles[entryIndex]
            .close
        );
      }

      count++;
    }
  }

  return 0;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function main(): void {
  const startedAt =
    Date.now();

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Single-target portfolio backtest"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Dataset: ${DATASET_PATH}`
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
    `Markets: ${marketCount}`
  );

  console.log(
    `Candles: ${totalCandles.toLocaleString()}`
  );

  console.log(
    `Fee: ${(FEE_RATE * 100).toFixed(3)}% per side`
  );

  console.log(
    `Stop: ${(STOP_PCT * 100).toFixed(1)}%`
  );

  console.log(
    "Maximum hold: 48 hours"
  );

  console.log("");

  /*
   * Prepare signals once.
   */
  console.log(
    "Preparing signals..."
  );

  const signalIndices: number[][] =
    [];

  let totalSignals = 0;

  for (
    let marketIndex = 0;
    marketIndex < marketCount;
    marketIndex++
  ) {
    const signals =
      buildSignalIndices(
        dataset.markets[
          marketIndex
        ].candles
      );

    signalIndices.push(
      signals
    );

    totalSignals +=
      signals.length;

    if (
      (marketIndex + 1) % 10 === 0 ||
      marketIndex ===
        marketCount - 1
    ) {
      console.log(
        `  ${marketIndex + 1}/${marketCount} markets`
      );
    }
  }

  console.log(
    `Total signals: ${totalSignals.toLocaleString()}`
  );

  console.log("");

  const results:
    ConfigurationResult[] = [];

  /*
   * Dataset time range.
   */
  let startTime =
    Number.POSITIVE_INFINITY;

  let endTime =
    Number.NEGATIVE_INFINITY;

  for (
    const market of dataset.markets
  ) {
    if (
      market.candles.length === 0
    ) {
      continue;
    }

    startTime =
      Math.min(
        startTime,
        market.candles[0]
          .openTime
      );

    endTime =
      Math.max(
        endTime,
        market.candles[
          market.candles.length - 1
        ].openTime
      );
  }

  /*
   * Run every target.
   */
  for (
    let configIndex = 0;
    configIndex <
    CONFIGURATIONS.length;
    configIndex++
  ) {
    const config =
      CONFIGURATIONS[
        configIndex
      ];

    const configStartedAt =
      Date.now();

    console.log("");
    console.log(
      `[${configIndex + 1}/${CONFIGURATIONS.length}] ${config.name}`
    );

    /*
     * Generate portfolio event streams.
     */
    const streams:
      MarketStream[] = [];

    for (
      let marketIndex = 0;
      marketIndex < marketCount;
      marketIndex++
    ) {
      streams.push(
        buildMarketStream(
          dataset.markets[
            marketIndex
          ],
          signalIndices[
            marketIndex
          ],
          config
        )
      );
    }

    /*
     * First determine how much starting cash is
     * required to execute the complete historical
     * sequence.
     */
    const eventHeap:
      HeapItem[] = [];

    for (
      let streamIndex = 0;
      streamIndex < streams.length;
      streamIndex++
    ) {
      if (
        streams[streamIndex]
          .events.length > 0
      ) {
        heapPush(
          eventHeap,
          streams,
          {
            streamIndex,
            eventIndex: 0,
          }
        );
      }
    }

    let cashFlow = 0;

    let minimumStartingCash =
      0;

    while (
      eventHeap.length > 0
    ) {
      const item =
        heapPop(
          eventHeap,
          streams
        )!;

      const event =
        streams[item.streamIndex]
          .events[item.eventIndex];

      cashFlow +=
        event.cashDelta;

      minimumStartingCash =
        Math.max(
          minimumStartingCash,
          -cashFlow
        );

      const nextEventIndex =
        item.eventIndex + 1;

      if (
        nextEventIndex <
        streams[item.streamIndex]
          .events.length
      ) {
        heapPush(
          eventHeap,
          streams,
          {
            streamIndex:
              item.streamIndex,
            eventIndex:
              nextEventIndex,
          }
        );
      }
    }

    /*
     * Now reconstruct the portfolio using exactly
     * that minimum starting cash.
     */
    const portfolio =
      simulatePortfolio(
        streams,
        startTime,
        endTime,
        minimumStartingCash
      );

    /*
     * Position-level statistics.
     */
    const positionStats =
      collectPositionResults(
        dataset.markets,
        signalIndices,
        config
      );

    const totalReturn =
      minimumStartingCash > 0
        ? positionStats.netProfit /
          minimumStartingCash
        : 0;

    const result:
      ConfigurationResult = {
      name: config.name,

      targetPct:
        config.targetPct,

      stopPct:
        config.stopPct,

      signals:
        positionStats.signals,

      completedPositions:
        positionStats.completedPositions,

      winningPositions:
        positionStats.winningPositions,

      losingPositions:
        positionStats.losingPositions,

      winRate:
        positionStats.winRate,

      realisedGross:
        positionStats.realisedGross,

      fees:
        positionStats.fees,

      netProfit:
        positionStats.netProfit,

      averageReturnPct:
        positionStats.averageReturnPct,

      medianReturnPct:
        positionStats.medianReturnPct,

      profitFactor:
        positionStats.profitFactor,

      averageHoldMinutes:
        positionStats.averageHoldMinutes,

      medianHoldMinutes:
        positionStats.medianHoldMinutes,

      targetExits:
        positionStats.targetExits,

      stopExits:
        positionStats.stopExits,

      maxHoldExits:
        positionStats.maxHoldExits,

      peakCapitalDeployed:
        portfolio.peakCapitalDeployed,

      averageCapitalDeployed:
        portfolio.averageCapitalDeployed,

      minimumStartingCash,

      maxOpenPositions:
        portfolio.maxOpenPositions,

      maxOpenMarkets:
        portfolio.maxOpenMarkets,

      finalEquity:
        portfolio.finalEquity,

      totalReturn,

      maxDrawdownAbsolute:
        portfolio.maxDrawdownAbsolute,

      maxDrawdownPct:
        portfolio.maxDrawdownPct,

      finalCash:
        portfolio.finalCash,

      finalMarketValue:
        portfolio.finalMarketValue,
    };

    results.push(result);

    console.log(
      `  target: ${(config.targetPct * 100).toFixed(1)}%`
    );

    console.log(
      `  signals: ${result.signals.toLocaleString()}`
    );

    console.log(
      `  win rate: ${(result.winRate * 100).toFixed(2)}%`
    );

    console.log(
      `  target exits: ${result.targetExits.toLocaleString()}`
    );

    console.log(
      `  stop exits: ${result.stopExits.toLocaleString()}`
    );

    console.log(
      `  48h exits: ${result.maxHoldExits.toLocaleString()}`
    );

    console.log(
      `  minimum starting cash: $${result.minimumStartingCash.toFixed(2)}`
    );

    console.log(
      `  final equity: $${result.finalEquity.toFixed(2)}`
    );

    console.log(
      `  net return: ${(result.totalReturn * 100).toFixed(4)}%`
    );

    console.log(
      `  max drawdown: ${(result.maxDrawdownPct * 100).toFixed(4)}%`
    );

    console.log(
      `  profit factor: ${
        Number.isFinite(
          result.profitFactor
        )
          ? result.profitFactor.toFixed(3)
          : "Infinity"
      }`
    );

    console.log(
      `  runtime: ${formatDuration(
        Date.now() -
          configStartedAt
      )}`
    );
  }

  /*
   * Sort only for presentation.
   *
   * We are NOT using this ordering as a recommendation;
   * it is simply useful for examining the experimental
   * results.
   */
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
        totalSignals,

      startTime,
      endTime,

      durationDays:
        (endTime - startTime) /
        MS_PER_DAY,
    },

    methodology: {
      entrySignal: {
        slope20Lte:
          SLOPE_THRESHOLD,

        accelerationGte:
          ACCELERATION_THRESHOLD,
      },

      entryExecution:
        "signal candle close",

      exitConfigurations:
        "single full-position profit target",

      targetPercentages:
        TARGET_PCTS,

      stop:
        `${STOP_PCT * 100}%`,

      maximumHold:
        "48 hours",

      maximumHoldExecution:
        "close of first candle at or after 48 hours",

      sameCandlePriority:
        "stop before target",

      overlappingPositions:
        true,

      positionSize:
        UNIT_SIZE,

      feeRate:
        FEE_RATE,

      executionCost:
        EXECUTION_COST,

      feeDefinition:
        "0.1% of actual monetary value of each buy and sell",

      portfolioModel:
        "chronological simultaneous portfolio reconstruction",

      equityDefinition:
        "cash plus mark-to-market value of open positions",

      note:
        "Each configuration is an independent experiment using identical entry signals and market data.",
    },

    runtime: {
      milliseconds:
        Date.now() -
        startedAt,

      formatted:
        formatDuration(
          Date.now() -
            startedAt
        ),
    },

    configurations:
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
    "============================================================"
  );
  console.log(
    "Completed"
  );
  console.log(
    "============================================================"
  );

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
