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

interface Target {
  name: string;
  returnPct: number;
  fraction: number;
}

interface Configuration {
  name: string;
  targets: Target[];
  stopPct: number;
}

interface ExitRecord {
  exitTime: number;
  exitPrice: number;
  quantitySold: number;
  grossSaleValue: number;
  exitFee: number;
  netSaleProceeds: number;
  target: string;
}

interface PositionResult {
  entryTime: number;
  entryPrice: number;
  entryValue: number;
  entryFee: number;
  realisedNet: number;
  remainingQuantity: number;
  unrealisedGross: number;
  completed: boolean;
  exitTime: number | null;
  exits: ExitRecord[];
}

interface RunningStats {
  signals: number;
  completedPositions: number;
  openPositions: number;
  winningPositions: number;
  losingPositions: number;

  realisedGross: number;
  realisedFees: number;
  realisedNet: number;
  unrealisedGross: number;

  totalPositionReturns: number[];
  holdTimes: number[];

  closedProfit: number;
  closedLoss: number;

  targetExitCounts: Record<string, number>;
  stopExitCount: number;
  endOfDataCount: number;

  firstTargetTimes: Record<string, number[]>;
}

type PortfolioEventType = "entry" | "exit";

interface PortfolioEvent {
  time: number;
  type: PortfolioEventType;

  // Positive for a cash inflow, negative for an outflow.
  cashDelta: number;

  // Change in the quantity of the asset held in this market.
  quantityDelta: number;

  // Change in capital deployed, defined exactly as:
  // remaining quantity × original entry price.
  capitalDelta: number;

  // Number of position lots opened/closed.
  positionDelta: number;

  // Change in the number of markets containing at least one
  // open position. This is applied only when the market changes
  // between zero and non-zero quantity.
  marketDelta: number;
}

interface MarketPortfolioStream {
  symbol: string;
  candles: Candle[];
  events: PortfolioEvent[];
}

interface PortfolioMetrics {
  peakCapitalDeployed: number;
  averageCapitalDeployed: number;
  capitalDays: number;

  minimumStartingCash: number;

  maxOpenPositions: number;
  maxOpenMarkets: number;

  finalEquity: number;
  totalReturn: number;

  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

  returnOnPeakCapital: number;
  returnOnAverageCapital: number;
  annualisedCapitalEfficiency: number;
  timeWeightedReturn: number;

  finalCash: number;
  finalMarketValue: number;
}

interface ConfigurationResult {
  name: string;
  targets: Target[];
  stopPct: number;

  signals: number;
  completedPositions: number;
  openPositions: number;

  winningPositions: number;
  losingPositions: number;
  winRate: number;

  realisedGross: number;
  realisedFees: number;
  realisedNet: number;

  unrealisedGross: number;
  unrealisedFees: number;
  combinedNet: number;

  averageNetPerOriginalUnit: number;
  medianNetPerOriginalUnit: number;

  // Closed-position profit factor. End-of-data positions are excluded.
  profitFactor: number;

  maxOpenPositions: number;
  maxOpenMarkets: number;
  maxDrawdown: number;

  peakCapitalDeployed: number;
  averageCapitalDeployed: number;
  capitalDays: number;
  minimumStartingCash: number;

  finalEquity: number;
  totalReturn: number;
  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

  returnOnPeakCapital: number;
  returnOnAverageCapital: number;
  annualisedCapitalEfficiency: number;
  timeWeightedReturn: number;

  finalCash: number;
  finalMarketValue: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  targetExitCounts: Record<string, number>;
  stopExitCount: number;
  endOfDataCount: number;

  firstTargetTimes: Record<
    string,
    {
      count: number;
      averageMinutes: number;
      medianMinutes: number;
    }
  >;
}

const DATASET_PATH = path.join(
  process.cwd(),
  "server",
  "research-output",
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

const SLOPE_THRESHOLD = -0.0001425851160546487;
const ACCELERATION_THRESHOLD = 0.00013986740450809692;

const CONFIGURATIONS: Configuration[] = [
  {
    name: "baseline_1pct_10pct",
    targets: [
      {
        name: "target_1pct",
        returnPct: 0.01,
        fraction: 1,
      },
    ],
    stopPct: 0.10,
  },
  {
    name: "partial_0.5_1_2",
    targets: [
      {
        name: "target_0.5pct",
        returnPct: 0.005,
        fraction: 0.50,
      },
      {
        name: "target_1pct",
        returnPct: 0.01,
        fraction: 0.25,
      },
      {
        name: "target_2pct",
        returnPct: 0.02,
        fraction: 0.25,
      },
    ],
    stopPct: 0.10,
  },
  {
    name: "delayed_partial_1_2_4",
    targets: [
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
    ],
    stopPct: 0.10,
  },
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function createStats(config: Configuration): RunningStats {
  const firstTargetTimes: Record<string, number[]> = {};
  const targetExitCounts: Record<string, number> = {};

  for (const target of config.targets) {
    firstTargetTimes[target.name] = [];
    targetExitCounts[target.name] = 0;
  }

  return {
    signals: 0,
    completedPositions: 0,
    openPositions: 0,
    winningPositions: 0,
    losingPositions: 0,

    realisedGross: 0,
    realisedFees: 0,
    realisedNet: 0,
    unrealisedGross: 0,

    totalPositionReturns: [],
    holdTimes: [],

    closedProfit: 0,
    closedLoss: 0,

    targetExitCounts,
    stopExitCount: 0,
    endOfDataCount: 0,

    firstTargetTimes,
  };
}

/**
 * O(1)-per-candle rolling regression using prefix sums.
 */
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
    ((windowSize - 1) *
      windowSize *
      (2 * windowSize - 1)) /
    6;

  const denominator =
    windowSize * sumXX - sumX * sumX;

  const slopes = new Float64Array(n);

  for (
    let end = windowSize - 1;
    end < n;
    end++
  ) {
    const start = end - windowSize + 1;

    const sumY =
      prefixY[end + 1] - prefixY[start];

    const globalWeightedSum =
      prefixIndexY[end + 1] -
      prefixIndexY[start];

    const sumXY =
      globalWeightedSum - start * sumY;

    slopes[end] =
      (windowSize * sumXY - sumX * sumY) /
      denominator;
  }

  return Array.from(slopes);
}

function buildSignals(candles: Candle[]): boolean[] {
  const closes = candles.map(
    (candle) => candle.close
  );

  const slope20 = buildRegressionSlopes(
    closes,
    20
  );

  const slope50 = buildRegressionSlopes(
    closes,
    50
  );

  const signals = new Array<boolean>(
    candles.length
  ).fill(false);

  for (let i = 49; i < candles.length; i++) {
    const acceleration =
      slope20[i] - slope50[i];

    signals[i] =
      slope20[i] <= SLOPE_THRESHOLD &&
      acceleration >= ACCELERATION_THRESHOLD;
  }

  return signals;
}

function calculateEntryFee(
  quantityBought: number,
  entryPrice: number
): number {
  return (
    quantityBought *
    entryPrice *
    (FEE_RATE + EXECUTION_COST)
  );
}

function calculateExitFee(
  quantitySold: number,
  exitPrice: number
): number {
  return (
    quantitySold *
    exitPrice *
    (FEE_RATE + EXECUTION_COST)
  );
}

/**
 * Simulates one signal exactly as in the existing partial-exit
 * backtest. No max hold is imposed.
 */
function simulatePosition(
  candles: Candle[],
  entryIndex: number,
  config: Configuration
): PositionResult {
  const entryCandle = candles[entryIndex];
  const entryPrice = entryCandle.close;
  const originalQuantity = UNIT_SIZE;
  const entryValue =
    originalQuantity * entryPrice;

  const entryFee = calculateEntryFee(
    originalQuantity,
    entryPrice
  );

  let remainingQuantity = originalQuantity;
  let realisedNet = -entryFee;
  let completed = false;
  let exitTime: number | null = null;

  const exits: ExitRecord[] = [];
  const targetExecuted = config.targets.map(
    () => false
  );

  for (
    let i = entryIndex + 1;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];
    const stopPrice =
      entryPrice * (1 - config.stopPct);

    // Stop takes priority when stop and target are both
    // touched during the same candle.
    if (candle.low <= stopPrice) {
      const quantitySold = remainingQuantity;
      const saleValue =
        quantitySold * stopPrice;
      const exitFee = calculateExitFee(
        quantitySold,
        stopPrice
      );
      const netSaleProceeds =
        saleValue - exitFee;

      const netPnl =
        netSaleProceeds -
        quantitySold * entryPrice;

      realisedNet += netPnl;

      exits.push({
        exitTime: candle.openTime,
        exitPrice: stopPrice,
        quantitySold,
        grossSaleValue: saleValue,
        exitFee,
        netSaleProceeds,
        target: "stop",
      });

      remainingQuantity = 0;
      completed = true;
      exitTime = candle.openTime;
      break;
    }

    for (
      let targetIndex = 0;
      targetIndex < config.targets.length;
      targetIndex++
    ) {
      const target = config.targets[targetIndex];

      if (targetExecuted[targetIndex]) {
        continue;
      }

      if (remainingQuantity <= 1e-12) {
        break;
      }

      const targetPrice =
        entryPrice * (1 + target.returnPct);

      if (candle.high < targetPrice) {
        continue;
      }

      const requestedQuantity =
        originalQuantity * target.fraction;

      const quantitySold = Math.min(
        requestedQuantity,
        remainingQuantity
      );

      if (quantitySold <= 0) {
        continue;
      }

      const saleValue =
        quantitySold * targetPrice;

      const exitFee = calculateExitFee(
        quantitySold,
        targetPrice
      );

      const netSaleProceeds =
        saleValue - exitFee;

      const netPnl =
        netSaleProceeds -
        quantitySold * entryPrice;

      realisedNet += netPnl;
      remainingQuantity -= quantitySold;
      targetExecuted[targetIndex] = true;

      exits.push({
        exitTime: candle.openTime,
        exitPrice: targetPrice,
        quantitySold,
        grossSaleValue: saleValue,
        exitFee,
        netSaleProceeds,
        target: target.name,
      });

      if (remainingQuantity <= 1e-12) {
        remainingQuantity = 0;
        completed = true;
        exitTime = candle.openTime;
        break;
      }
    }

    if (completed) {
      break;
    }
  }

  let unrealisedGross = 0;

  if (!completed && remainingQuantity > 0) {
    const finalPrice =
      candles[candles.length - 1].close;

    unrealisedGross =
      remainingQuantity *
      (finalPrice - entryPrice);
  }

  return {
    entryTime: entryCandle.openTime,
    entryPrice,
    entryValue,
    entryFee,
    realisedNet,
    remainingQuantity,
    unrealisedGross,
    completed,
    exitTime,
    exits,
  };
}

/**
 * Adds a transaction event to a market stream.
 *
 * Exit events have priority 0 and entries priority 1 at the same
 * timestamp. The portfolio therefore sees intrabar exits before
 * a new position entered at that candle's close.
 */
function addEvent(
  stream: MarketPortfolioStream,
  event: PortfolioEvent
): void {
  stream.events.push(event);
}

/**
 * Simulates one market and simultaneously produces:
 *
 * 1. Existing per-position research statistics.
 * 2. Chronological transaction events for the portfolio layer.
 *
 * We do not build a global candle/timestamp map.
 */
function processMarket(
  market: MarketData,
  config: Configuration,
  stats: RunningStats,
  stream: MarketPortfolioStream
): void {
  const candles = market.candles;

  if (candles.length < 50) {
    return;
  }

  const signals = buildSignals(candles);

  for (
    let candleIndex = 49;
    candleIndex < candles.length;
    candleIndex++
  ) {
    if (!signals[candleIndex]) {
      continue;
    }

    const position = simulatePosition(
      candles,
      candleIndex,
      config
    );

    stats.signals++;

    stats.realisedFees += position.entryFee;
    stats.realisedNet += position.realisedNet;

    // Entry cash flow.
    addEvent(stream, {
      time: position.entryTime,
      type: "entry",
      cashDelta:
        -(position.entryValue +
          position.entryFee),
      quantityDelta: UNIT_SIZE,
      capitalDelta: position.entryValue,
      positionDelta: 1,
      marketDelta: 1,
    });

    for (const exit of position.exits) {
      stats.realisedGross +=
        exit.grossSaleValue -
        exit.quantitySold * position.entryPrice;

      stats.realisedFees += exit.exitFee;

      if (exit.target === "stop") {
        stats.stopExitCount++;
      } else {
        stats.targetExitCounts[exit.target]++;

        const targetTime =
          (exit.exitTime -
            position.entryTime) /
          60000;

        stats.firstTargetTimes[
          exit.target
        ].push(targetTime);
      }

      const isFinalExit =
        position.completed &&
        position.exits[
          position.exits.length - 1
        ] === exit;

      addEvent(stream, {
        time: exit.exitTime,
        type: "exit",
        cashDelta: exit.netSaleProceeds,
        quantityDelta: -exit.quantitySold,
        capitalDelta:
          -exit.quantitySold *
          position.entryPrice,
        positionDelta: isFinalExit ? -1 : 0,
        marketDelta: isFinalExit ? -1 : 0,
      });
    }

    stats.unrealisedGross +=
      position.unrealisedGross;

    const combinedPositionNet =
      position.realisedNet +
      position.unrealisedGross;

    const positionReturn =
      combinedPositionNet /
      position.entryValue;

    stats.totalPositionReturns.push(
      positionReturn
    );

    if (combinedPositionNet > 0) {
      stats.winningPositions++;
    } else if (combinedPositionNet < 0) {
      stats.losingPositions++;
    }

    if (position.completed) {
      stats.completedPositions++;

      if (position.exitTime !== null) {
        stats.holdTimes.push(
          (position.exitTime -
            position.entryTime) /
            60000
        );
      }

      // Profit factor is deliberately based only on
      // completed positions. End-of-data positions are
      // excluded because their exit is hypothetical.
      if (position.realisedNet > 0) {
        stats.closedProfit +=
          position.realisedNet;
      } else if (position.realisedNet < 0) {
        stats.closedLoss +=
          Math.abs(position.realisedNet);
      }
    } else {
      stats.openPositions++;
      stats.endOfDataCount++;
    }
  }

  stream.events.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }

    // Exits happen before entries at the same candle time.
    if (a.type === b.type) {
      return 0;
    }

    return a.type === "exit" ? -1 : 1;
  });
}

/* -------------------------------------------------------------------------- */
/* Portfolio event sweep                                                     */
/* -------------------------------------------------------------------------- */

interface EventSweep {
  peakCapitalDeployed: number;
  capitalDays: number;
  averageCapitalDeployed: number;
  minimumStartingCash: number;
  maxOpenPositions: number;
  maxOpenMarkets: number;
  finalCashFlow: number;
}

function sweepPortfolioEvents(
  streams: MarketPortfolioStream[],
  startTime: number,
  endTime: number
): EventSweep {
  const allEvents: PortfolioEvent[] = [];

  for (const stream of streams) {
    allEvents.push(...stream.events);
  }

  allEvents.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }

    if (a.type === b.type) {
      return 0;
    }

    return a.type === "exit" ? -1 : 1;
  });

  let capitalDeployed = 0;
  let peakCapitalDeployed = 0;

  let cashFlow = 0;
  let minimumStartingCash = 0;

  let openPositions = 0;
  let openMarkets = 0;
  let maxOpenPositions = 0;
  let maxOpenMarkets = 0;

  let capitalDays = 0;
  let previousTime = startTime;

  let index = 0;

  while (index < allEvents.length) {
    const time = allEvents[index].time;

    if (time > previousTime) {
      capitalDays +=
        (capitalDeployed *
          (time - previousTime)) /
        (24 * 60 * 60 * 1000);

      previousTime = time;
    }

    while (
      index < allEvents.length &&
      allEvents[index].time === time
    ) {
      const event = allEvents[index];

      cashFlow += event.cashDelta;

      capitalDeployed += event.capitalDelta;
      openPositions += event.positionDelta;
      openMarkets += event.marketDelta;

      if (capitalDeployed < -1e-8) {
        throw new Error(
          `Negative capital deployed at ${time}: ${capitalDeployed}`
        );
      }

      peakCapitalDeployed = Math.max(
        peakCapitalDeployed,
        capitalDeployed
      );

      maxOpenPositions = Math.max(
        maxOpenPositions,
        openPositions
      );

      maxOpenMarkets = Math.max(
        maxOpenMarkets,
        openMarkets
      );

      // cashFlow starts at zero. If it reaches -X, at least
      // X of starting cash is required to avoid borrowing.
      minimumStartingCash = Math.max(
        minimumStartingCash,
        -cashFlow
      );

      index++;
    }
  }

  if (endTime > previousTime) {
    capitalDays +=
      (capitalDeployed *
        (endTime - previousTime)) /
      (24 * 60 * 60 * 1000);
  }

  const totalDays =
    (endTime - startTime) /
    (24 * 60 * 60 * 1000);

  const averageCapitalDeployed =
    totalDays > 0
      ? capitalDays / totalDays
      : 0;

  return {
    peakCapitalDeployed,
    capitalDays,
    averageCapitalDeployed,
    minimumStartingCash,
    maxOpenPositions,
    maxOpenMarkets,
    finalCashFlow: cashFlow,
  };
}

/* -------------------------------------------------------------------------- */
/* Efficient chronological equity sweep                                      */
/* -------------------------------------------------------------------------- */

interface HeapItem {
  marketIndex: number;
  candleIndex: number;
}

function heapPush(
  heap: HeapItem[],
  item: HeapItem
): void {
  heap.push(item);

  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor(
      (index - 1) / 2
    );

    if (
      heap[parent].candleIndex <=
      item.candleIndex
    ) {
      break;
    }

    heap[index] = heap[parent];
    index = parent;
  }

  heap[index] = item;
}

function heapPop(
  heap: HeapItem[]
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
    const left = index * 2 + 1;

    if (left >= heap.length) {
      break;
    }

    const right = left + 1;

    let child = left;

    if (
      right < heap.length &&
      heap[right].candleIndex <
        heap[left].candleIndex
    ) {
      child = right;
    }

    if (
      heap[child].candleIndex >=
      last.candleIndex
    ) {
      break;
    }

    heap[index] = heap[child];
    index = child;
  }

  heap[index] = last;

  return root;
}

/**
 * The heap uses candle timestamps indirectly because all candles
 * in a market are chronological. We still compare actual timestamps
 * below when selecting the next market.
 */
function candleTime(
  streams: MarketPortfolioStream[],
  item: HeapItem
): number {
  return streams[item.marketIndex].candles[
    item.candleIndex
  ].openTime;
}

interface EquitySweep {
  finalEquity: number;
  finalCash: number;
  finalMarketValue: number;

  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

  peakEquity: number;
  equityAtStart: number;
}

function calculateEquityCurve(
  streams: MarketPortfolioStream[],
  startingCash: number
): EquitySweep {
  const heap: HeapItem[] = [];

  const eventPointers = new Array<number>(
    streams.length
  ).fill(0);

  const quantities = new Array<number>(
    streams.length
  ).fill(0);

  const currentMarketValues =
    new Array<number>(
      streams.length
    ).fill(0);

  let cash = startingCash;
  let totalMarketValue = 0;

  let peakEquity = startingCash;
  let maxDrawdownAbsolute = 0;
  let maxDrawdownPct = 0;

  for (
    let marketIndex = 0;
    marketIndex < streams.length;
    marketIndex++
  ) {
    if (
      streams[marketIndex].candles.length > 0
    ) {
      heapPush(heap, {
        marketIndex,
        candleIndex: 0,
      });
    }
  }

  while (heap.length > 0) {
    const first = heapPop(heap)!;
    const time = candleTime(streams, first);

    const sameTime: HeapItem[] = [first];

    while (heap.length > 0) {
      const next = heap[0];

      if (
        candleTime(streams, next) !== time
      ) {
        break;
      }

      sameTime.push(heapPop(heap)!);
    }

    /*
     * Apply every transaction occurring at this timestamp
     * before marking the affected markets to their candle close.
     */
    for (const item of sameTime) {
      const stream = streams[item.marketIndex];
      const pointer =
        eventPointers[item.marketIndex];

      while (
        pointer < stream.events.length &&
        stream.events[pointer].time === time
      ) {
        const event =
          stream.events[pointer];

        cash += event.cashDelta;
        quantities[item.marketIndex] +=
          event.quantityDelta;

        if (
          quantities[item.marketIndex] <
          -1e-10
        ) {
          throw new Error(
            `Negative quantity for ${stream.symbol} at ${time}`
          );
        }

        eventPointers[item.marketIndex] =
          pointer + 1;
      }
    }

    /*
     * Now update each market's mark-to-market value.
     * Only the market whose candle changed is recalculated.
     */
    for (const item of sameTime) {
      const stream = streams[item.marketIndex];
      const candle =
        stream.candles[item.candleIndex];

      const previousValue =
        currentMarketValues[
          item.marketIndex
        ];

      const newValue =
        quantities[item.marketIndex] *
        candle.close;

      currentMarketValues[
        item.marketIndex
      ] = newValue;

      totalMarketValue +=
        newValue - previousValue;

      const nextCandleIndex =
        item.candleIndex + 1;

      if (
        nextCandleIndex <
        stream.candles.length
      ) {
        heapPush(heap, {
          marketIndex:
            item.marketIndex,
          candleIndex:
            nextCandleIndex,
        });
      }
    }

    const equity =
      cash + totalMarketValue;

    if (equity > peakEquity) {
      peakEquity = equity;
    }

    const drawdown =
      peakEquity - equity;

    maxDrawdownAbsolute = Math.max(
      maxDrawdownAbsolute,
      drawdown
    );

    if (peakEquity > 0) {
      maxDrawdownPct = Math.max(
        maxDrawdownPct,
        drawdown / peakEquity
      );
    }
  }

  return {
    finalEquity:
      cash + totalMarketValue,
    finalCash: cash,
    finalMarketValue: totalMarketValue,

    maxDrawdownAbsolute,
    maxDrawdownPct,

    peakEquity,
    equityAtStart: startingCash,
  };
}

/* -------------------------------------------------------------------------- */
/* Result construction                                                        */
/* -------------------------------------------------------------------------- */

function buildResult(
  config: Configuration,
  stats: RunningStats,
  portfolio: PortfolioMetrics
): ConfigurationResult {
  const combinedNet =
    stats.realisedNet +
    stats.unrealisedGross;

  const averageNetPerOriginalUnit =
    stats.totalPositionReturns.length === 0
      ? 0
      : stats.totalPositionReturns.reduce(
          (sum, value) => sum + value,
          0
        ) /
        stats.totalPositionReturns.length;

  const profitFactor =
    stats.closedLoss === 0
      ? Infinity
      : stats.closedProfit /
        stats.closedLoss;

  const firstTargetTimes: Record<
    string,
    {
      count: number;
      averageMinutes: number;
      medianMinutes: number;
    }
  > = {};

  for (const target of config.targets) {
    const times =
      stats.firstTargetTimes[target.name];

    firstTargetTimes[target.name] = {
      count: times.length,
      averageMinutes:
        times.length === 0
          ? 0
          : times.reduce(
              (sum, value) => sum + value,
              0
            ) / times.length,
      medianMinutes: percentile(
        times,
        0.5
      ),
    };
  }

  return {
    name: config.name,
    targets: config.targets,
    stopPct: config.stopPct,

    signals: stats.signals,
    completedPositions:
      stats.completedPositions,
    openPositions: stats.openPositions,

    winningPositions:
      stats.winningPositions,
    losingPositions:
      stats.losingPositions,

    winRate:
      stats.signals === 0
        ? 0
        : stats.winningPositions /
          stats.signals,

    realisedGross: stats.realisedGross,
    realisedFees: stats.realisedFees,
    realisedNet: stats.realisedNet,

    unrealisedGross:
      stats.unrealisedGross,
    unrealisedFees: 0,
    combinedNet,

    averageNetPerOriginalUnit,
    medianNetPerOriginalUnit:
      percentile(
        stats.totalPositionReturns,
        0.5
      ),

    profitFactor,

    maxOpenPositions:
      portfolio.maxOpenPositions,
    maxOpenMarkets:
      portfolio.maxOpenMarkets,

    maxDrawdown:
      portfolio.maxDrawdownPct,

    peakCapitalDeployed:
      portfolio.peakCapitalDeployed,
    averageCapitalDeployed:
      portfolio.averageCapitalDeployed,
    capitalDays:
      portfolio.capitalDays,
    minimumStartingCash:
      portfolio.minimumStartingCash,

    finalEquity:
      portfolio.finalEquity,

    totalReturn:
      portfolio.totalReturn,

    maxDrawdownAbsolute:
      portfolio.maxDrawdownAbsolute,

    maxDrawdownPct:
      portfolio.maxDrawdownPct,

    returnOnPeakCapital:
      portfolio.returnOnPeakCapital,

    returnOnAverageCapital:
      portfolio.returnOnAverageCapital,

    annualisedCapitalEfficiency:
      portfolio.annualisedCapitalEfficiency,

    timeWeightedReturn:
      portfolio.timeWeightedReturn,

    finalCash:
      portfolio.finalCash,
    finalMarketValue:
      portfolio.finalMarketValue,

    averageHoldMinutes:
      stats.holdTimes.length === 0
        ? 0
        : stats.holdTimes.reduce(
            (sum, value) => sum + value,
            0
          ) /
          stats.holdTimes.length,

    medianHoldMinutes:
      percentile(
        stats.holdTimes,
        0.5
      ),

    targetExitCounts:
      stats.targetExitCounts,

    stopExitCount:
      stats.stopExitCount,

    endOfDataCount:
      stats.endOfDataCount,

    firstTargetTimes,
  };
}

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

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function main(): void {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Corrected partial-exit portfolio backtest"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Loading dataset: ${DATASET_PATH}`
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

  const totalCandles =
    dataset.markets.reduce(
      (sum, market) =>
        sum + market.candles.length,
      0
    );

  const startTime = Math.min(
    ...dataset.markets.map(
      (market) =>
        market.candles[0]?.openTime ??
        Number.POSITIVE_INFINITY
    )
  );

  const endTime = Math.max(
    ...dataset.markets.map(
      (market) =>
        market.candles[
          market.candles.length - 1
        ]?.openTime ??
        Number.NEGATIVE_INFINITY
    )
  );

  console.log(
    `Markets: ${marketCount}`
  );
  console.log(
    `Candles: ${totalCandles.toLocaleString()}`
  );
  console.log(
    `Transaction fee: ${(FEE_RATE * 100).toFixed(3)}% per transaction`
  );
  console.log(
    "Portfolio accounting: cash + mark-to-market open assets"
  );
  console.log("");

  const globalStart = Date.now();

  const results: ConfigurationResult[] =
    [];

  for (
    let configIndex = 0;
    configIndex < CONFIGURATIONS.length;
    configIndex++
  ) {
    const config =
      CONFIGURATIONS[configIndex];

    console.log(
      `\n[${configIndex + 1}/${CONFIGURATIONS.length}] ${config.name}`
    );

    const stats = createStats(config);

    const streams: MarketPortfolioStream[] =
      dataset.markets.map((market) => ({
        symbol: market.symbol,
        candles: market.candles,
        events: [],
      }));

    const configStart = Date.now();

    for (
      let marketIndex = 0;
      marketIndex < dataset.markets.length;
      marketIndex++
    ) {
      processMarket(
        dataset.markets[marketIndex],
        config,
        stats,
        streams[marketIndex]
      );

      if (
        (marketIndex + 1) % 10 === 0 ||
        marketIndex ===
          dataset.markets.length - 1
      ) {
        console.log(
          `  processed ${marketIndex + 1}/${marketCount} markets`
        );
      }
    }

    /*
     * Pass 1:
     * Transaction-only sweep.
     *
     * This gives peak capital deployed and the minimum
     * cash balance required to execute the historical
     * transaction sequence without borrowing.
     */
    const eventSweep =
      sweepPortfolioEvents(
        streams,
        startTime,
        endTime
      );

    /*
     * Pass 2:
     * Efficient mark-to-market sweep.
     *
     * There are only 60 market streams in the heap.
     * We never scan all open positions for every candle.
     */
    const equitySweep =
      calculateEquityCurve(
        streams,
        eventSweep.minimumStartingCash
      );

    const combinedNet =
      stats.realisedNet +
      stats.unrealisedGross;

    /*
     * Accounting invariant:
     *
     * final equity must equal starting cash + combined net.
     */
    const expectedFinalEquity =
      eventSweep.minimumStartingCash +
      combinedNet;

    const accountingDifference =
      equitySweep.finalEquity -
      expectedFinalEquity;

    if (
      Math.abs(accountingDifference) >
      Math.max(0.01, Math.abs(expectedFinalEquity) * 1e-10)
    ) {
      throw new Error(
        [
          `Portfolio accounting invariant failed for ${config.name}.`,
          `Final equity: ${equitySweep.finalEquity}`,
          `Expected: ${expectedFinalEquity}`,
          `Difference: ${accountingDifference}`,
        ].join(" ")
      );
    }

    const totalReturn =
      eventSweep.minimumStartingCash > 0
        ? combinedNet /
          eventSweep.minimumStartingCash
        : 0;

    const returnOnPeakCapital =
      eventSweep.peakCapitalDeployed > 0
        ? combinedNet /
          eventSweep.peakCapitalDeployed
        : 0;

    const returnOnAverageCapital =
      eventSweep.averageCapitalDeployed > 0
        ? combinedNet /
          eventSweep.averageCapitalDeployed
        : 0;

    const totalYears =
      (endTime - startTime) /
      (365.25 * 24 * 60 * 60 * 1000);

    const annualisedCapitalEfficiency =
      totalYears > 0 &&
      eventSweep.averageCapitalDeployed > 0
        ? Math.pow(
            1 +
              combinedNet /
                eventSweep.averageCapitalDeployed,
            1 / totalYears
          ) - 1
        : 0;

    /*
     * There are no external cash flows after the initial
     * starting balance. Therefore time-weighted return is
     * simply final equity / initial equity - 1.
     */
    const timeWeightedReturn =
      eventSweep.minimumStartingCash > 0
        ? equitySweep.finalEquity /
            eventSweep.minimumStartingCash -
          1
        : 0;

    const portfolio: PortfolioMetrics = {
      peakCapitalDeployed:
        eventSweep.peakCapitalDeployed,

      averageCapitalDeployed:
        eventSweep.averageCapitalDeployed,

      capitalDays:
        eventSweep.capitalDays,

      minimumStartingCash:
        eventSweep.minimumStartingCash,

      maxOpenPositions:
        eventSweep.maxOpenPositions,

      maxOpenMarkets:
        eventSweep.maxOpenMarkets,

      finalEquity:
        equitySweep.finalEquity,

      totalReturn,

      maxDrawdownAbsolute:
        equitySweep.maxDrawdownAbsolute,

      maxDrawdownPct:
        equitySweep.maxDrawdownPct,

      returnOnPeakCapital,

      returnOnAverageCapital,

      annualisedCapitalEfficiency,

      timeWeightedReturn,

      finalCash:
        equitySweep.finalCash,

      finalMarketValue:
        equitySweep.finalMarketValue,
    };

    const result = buildResult(
      config,
      stats,
      portfolio
    );

    results.push(result);

    console.log(
      `  runtime: ${formatDuration(
        Date.now() - configStart
      )}`
    );
    console.log(
      `  signals: ${result.signals.toLocaleString()}`
    );
    console.log(
      `  peak capital: ${result.peakCapitalDeployed.toFixed(2)}`
    );
    console.log(
      `  minimum starting cash: ${result.minimumStartingCash.toFixed(2)}`
    );
    console.log(
      `  final equity: ${result.finalEquity.toFixed(2)}`
    );
    console.log(
      `  total return: ${(result.totalReturn * 100).toFixed(4)}%`
    );
    console.log(
      `  max drawdown: ${(result.maxDrawdownPct * 100).toFixed(4)}%`
    );
    console.log(
      `  profit factor: ${
        Number.isFinite(result.profitFactor)
          ? result.profitFactor.toFixed(3)
          : "Infinity"
      }`
    );
  }

  const totalElapsed =
    Date.now() - globalStart;

  const output = {
    generatedAt:
      new Date().toISOString(),

    dataset: {
      path: DATASET_PATH,
      markets: marketCount,
      candles: totalCandles,
      startTime,
      endTime,
      durationDays:
        (endTime - startTime) /
        (24 * 60 * 60 * 1000),
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

      exitExecution:
        "target/stop price when candle high/low reaches level",

      sameCandlePriority:
        "stop before targets",

      maxHold: "none",
      overlappingPositions: true,
      partialSelling: true,
      unitSize: UNIT_SIZE,

      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,

      feeDefinition:
        "0.1% of actual monetary value of each buy or sell. Partial sale fees use actual sale value.",

      capitalDefinition:
        "sum of remaining quantity multiplied by each position's original entry price",

      minimumStartingCashDefinition:
        "minimum initial cash required so the historical cash balance never becomes negative after buys, fees and sale proceeds",

      equityDefinition:
        "cash balance plus mark-to-market value of all remaining open quantities",

      drawdownDefinition:
        "peak-to-trough decline in portfolio equity",

      profitFactorDefinition:
        "gross positive net P&L divided by gross negative net P&L for completed positions only; end-of-data positions are excluded",

      timeWeightedReturnDefinition:
        "final equity divided by initial starting cash minus one; there are no external cash flows after inception",

      openPositionValuation:
        "remaining quantity marked to the last observed close",

      openPositionExitFee:
        "no hypothetical exit fee is charged at end of data",

      portfolioAlgorithm:
        "transaction event sweep plus a 60-stream chronological mark-to-market heap; no global timestamp-to-candle map and no scan of all open positions at every candle",

      accountingInvariant:
        "final equity = minimum starting cash + realised net P&L + unrealised gross P&L",
    },

    transactionCosts: {
      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,
    },

    runtime: {
      milliseconds: totalElapsed,
      formatted:
        formatDuration(totalElapsed),
    },

    configurations: results,
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true }
  );

  const outputPath =
    path.join(
      OUTPUT_DIR,
      `partial-exit-portfolio-backtest-${Date.now()}.json`
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
    `Completed ${marketCount} markets`
  );
  console.log(
    `Total runtime: ${formatDuration(
      totalElapsed
    )}`
  );
  console.log(
    `Results written to: ${outputPath}`
  );
  console.log(
    "============================================================"
  );
}

main();
