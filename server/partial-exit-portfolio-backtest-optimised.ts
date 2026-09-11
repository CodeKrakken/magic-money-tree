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
  cashDelta: number;
  quantityDelta: number;
  capitalDelta: number;
  positionDelta: number;
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

interface PreparedMarket {
  symbol: string;
  candles: Candle[];
  signalIndices: number[];
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

const EPSILON = 1e-12;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
 * O(n) rolling linear-regression slopes using prefix sums.
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

  const prefixY = new Float64Array(n + 1);
  const prefixIndexY = new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    const close = closes[i];
    prefixY[i + 1] = prefixY[i] + close;
    prefixIndexY[i + 1] =
      prefixIndexY[i] + i * close;
  }

  const sumX = (windowSize * (windowSize - 1)) / 2;
  const sumXX =
    ((windowSize - 1) *
      windowSize *
      (2 * windowSize - 1)) /
    6;

  const denominator =
    windowSize * sumXX - sumX * sumX;

  for (let end = windowSize - 1; end < n; end++) {
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

  return slopes;
}

/**
 * Signals are configuration-independent, so they are calculated once and
 * reused by every exit configuration.
 */
function buildSignalIndices(
  candles: Candle[]
): number[] {
  if (candles.length < 50) {
    return [];
  }

  const closes = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    closes[i] = candles[i].close;
  }

  const slope20 = buildRegressionSlopes(
    Array.from(closes),
    20
  );
  const slope50 = buildRegressionSlopes(
    Array.from(closes),
    50
  );

  const signalIndices: number[] = [];

  for (let i = 49; i < candles.length; i++) {
    const acceleration =
      slope20[i] - slope50[i];

    if (
      slope20[i] <= SLOPE_THRESHOLD &&
      acceleration >= ACCELERATION_THRESHOLD
    ) {
      signalIndices.push(i);
    }
  }

  return signalIndices;
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

/* -------------------------------------------------------------------------- */
/* Range-search exit engine                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Segment tree supporting range maximum/minimum queries and first-crossing
 * searches. This replaces the previous "scan every future candle for every
 * signal" loop.
 *
 * A position therefore needs O(log n) work per stop/target rather than
 * potentially O(n) work.
 */
class CandleRangeIndex {
  private readonly size: number;
  private readonly maxHigh: Float64Array;
  private readonly minLow: Float64Array;

  constructor(candles: Candle[]) {
    let size = 1;
    while (size < candles.length) {
      size <<= 1;
    }

    this.size = size;
    this.maxHigh = new Float64Array(size * 2);
    this.minLow = new Float64Array(size * 2);

    this.maxHigh.fill(
      Number.NEGATIVE_INFINITY
    );
    this.minLow.fill(
      Number.POSITIVE_INFINITY
    );

    for (let i = 0; i < candles.length; i++) {
      const node = size + i;
      this.maxHigh[node] = candles[i].high;
      this.minLow[node] = candles[i].low;
    }

    for (let node = size - 1; node > 0; node--) {
      this.maxHigh[node] = Math.max(
        this.maxHigh[node * 2],
        this.maxHigh[node * 2 + 1]
      );
      this.minLow[node] = Math.min(
        this.minLow[node * 2],
        this.minLow[node * 2 + 1]
      );
    }
  }

  /**
   * Returns the first candle index >= fromIndex whose high reaches threshold.
   */
  firstHighAtLeast(
    fromIndex: number,
    threshold: number
  ): number {
    return this.findFirst(
      fromIndex,
      threshold,
      this.maxHigh,
      (value, target) => value >= target
    );
  }

  /**
   * Returns the first candle index >= fromIndex whose low reaches threshold.
   */
  firstLowAtMost(
    fromIndex: number,
    threshold: number
  ): number {
    return this.findFirst(
      fromIndex,
      threshold,
      this.minLow,
      (value, target) => value <= target
    );
  }

  private findFirst(
    fromIndex: number,
    threshold: number,
    tree: Float64Array,
    matches: (value: number, target: number) => boolean
  ): number {
    if (fromIndex >= this.size) {
      return -1;
    }

    return this.findFirstNode(
      1,
      0,
      this.size - 1,
      fromIndex,
      threshold,
      tree,
      matches
    );
  }

  private findFirstNode(
    node: number,
    left: number,
    right: number,
    fromIndex: number,
    threshold: number,
    tree: Float64Array,
    matches: (value: number, target: number) => boolean
  ): number {
    if (
      right < fromIndex ||
      !matches(tree[node], threshold)
    ) {
      return -1;
    }

    if (left === right) {
      return left;
    }

    const middle = (left + right) >> 1;

    const leftResult = this.findFirstNode(
      node * 2,
      left,
      middle,
      fromIndex,
      threshold,
      tree,
      matches
    );

    if (leftResult !== -1) {
      return leftResult;
    }

    return this.findFirstNode(
      node * 2 + 1,
      middle + 1,
      right,
      fromIndex,
      threshold,
      tree,
      matches
    );
  }
}

function simulatePosition(
  candles: Candle[],
  rangeIndex: CandleRangeIndex,
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

  /*
   * Find the stop and every target directly. The first event in time wins.
   * If several targets occur on the same candle, they are all processed in
   * target order, matching the original simulation.
   */
  const stopPrice =
    entryPrice * (1 - config.stopPct);

  const stopIndex = rangeIndex.firstLowAtMost(
    entryIndex + 1,
    stopPrice
  );

  const targetHits = config.targets.map(
    (target) => ({
      target,
      price:
        entryPrice * (1 + target.returnPct),
      index: -1,
    })
  );

  for (const hit of targetHits) {
    hit.index =
      rangeIndex.firstHighAtLeast(
        entryIndex + 1,
        hit.price
      );
  }

  let firstExitIndex = Number.POSITIVE_INFINITY;

  if (stopIndex !== -1) {
    firstExitIndex = stopIndex;
  }

  for (const hit of targetHits) {
    if (
      hit.index !== -1 &&
      hit.index < firstExitIndex
    ) {
      firstExitIndex = hit.index;
    }
  }

  if (firstExitIndex === Number.POSITIVE_INFINITY) {
    const finalPrice =
      candles[candles.length - 1].close;

    return {
      entryTime: entryCandle.openTime,
      entryPrice,
      entryValue,
      entryFee,
      realisedNet,
      remainingQuantity,
      unrealisedGross:
        remainingQuantity *
        (finalPrice - entryPrice),
      completed: false,
      exitTime: null,
      exits,
    };
  }

  /*
   * Stop has priority whenever it occurs on the same candle as a target.
   */
  if (
    stopIndex !== -1 &&
    stopIndex === firstExitIndex
  ) {
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
      exitTime: candles[stopIndex].openTime,
      exitPrice: stopPrice,
      quantitySold,
      grossSaleValue: saleValue,
      exitFee,
      netSaleProceeds,
      target: "stop",
    });

    remainingQuantity = 0;
    completed = true;
    exitTime = candles[stopIndex].openTime;

    return {
      entryTime: entryCandle.openTime,
      entryPrice,
      entryValue,
      entryFee,
      realisedNet,
      remainingQuantity,
      unrealisedGross: 0,
      completed,
      exitTime,
      exits,
    };
  }

  /*
   * The first event is a target. Process every target that has already been
   * reached by that candle, then continue chronologically through later
   * target hits. Because target prices are ordered by configuration, target
   * ordering is deterministic even when several levels are reached together.
   */
  for (const hit of targetHits) {
    if (
      hit.index === -1 ||
      remainingQuantity <= EPSILON
    ) {
      continue;
    }

    const quantitySold = Math.min(
      UNIT_SIZE * hit.target.fraction,
      remainingQuantity
    );

    if (quantitySold <= 0) {
      continue;
    }

    const saleValue =
      quantitySold * hit.price;
    const exitFee = calculateExitFee(
      quantitySold,
      hit.price
    );
    const netSaleProceeds =
      saleValue - exitFee;

    const netPnl =
      netSaleProceeds -
      quantitySold * entryPrice;

    realisedNet += netPnl;
    remainingQuantity -= quantitySold;

    exits.push({
      exitTime: candles[hit.index].openTime,
      exitPrice: hit.price,
      quantitySold,
      grossSaleValue: saleValue,
      exitFee,
      netSaleProceeds,
      target: hit.target.name,
    });

    if (remainingQuantity <= EPSILON) {
      remainingQuantity = 0;
      completed = true;
      exitTime =
        candles[hit.index].openTime;
      break;
    }
  }

  /*
   * The original simulator would keep scanning after the first target until
   * either all targets were hit or the dataset ended. The direct range
   * searches above provide exactly the same target-hit information without
   * scanning the intervening candles.
   */
  const finalPrice =
    candles[candles.length - 1].close;

  const unrealisedGross =
    !completed
      ? remainingQuantity *
        (finalPrice - entryPrice)
      : 0;

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

/* -------------------------------------------------------------------------- */
/* Market processing                                                          */
/* -------------------------------------------------------------------------- */

function addEvent(
  stream: MarketPortfolioStream,
  event: PortfolioEvent
): void {
  stream.events.push(event);
}

function processMarket(
  market: PreparedMarket,
  config: Configuration,
  stats: RunningStats,
  stream: MarketPortfolioStream,
  rangeIndex: CandleRangeIndex
): void {
  const candles = market.candles;

  if (candles.length < 50) {
    return;
  }

  for (const candleIndex of market.signalIndices) {
    const position = simulatePosition(
      candles,
      rangeIndex,
      candleIndex,
      config
    );

    stats.signals++;

    stats.realisedFees +=
      position.entryFee;
    stats.realisedNet +=
      position.realisedNet;

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

    for (let exitIndex = 0; exitIndex < position.exits.length; exitIndex++) {
      const exit = position.exits[exitIndex];

      stats.realisedGross +=
        exit.grossSaleValue -
        exit.quantitySold *
          position.entryPrice;

      stats.realisedFees +=
        exit.exitFee;

      if (exit.target === "stop") {
        stats.stopExitCount++;
      } else {
        stats.targetExitCounts[
          exit.target
        ]++;

        const targetTime =
          (exit.exitTime -
            position.entryTime) /
          MS_PER_MINUTE;

        stats.firstTargetTimes[
          exit.target
        ].push(targetTime);
      }

      const isFinalExit =
        position.completed &&
        exitIndex ===
          position.exits.length - 1;

      addEvent(stream, {
        time: exit.exitTime,
        type: "exit",
        cashDelta: exit.netSaleProceeds,
        quantityDelta: -exit.quantitySold,
        capitalDelta:
          -exit.quantitySold *
          position.entryPrice,
        positionDelta:
          isFinalExit ? -1 : 0,
        marketDelta:
          isFinalExit ? -1 : 0,
      });
    }

    stats.unrealisedGross +=
      position.unrealisedGross;

    const combinedPositionNet =
      position.realisedNet +
      position.unrealisedGross;

    const positionReturn =
      position.entryValue > 0
        ? combinedPositionNet /
          position.entryValue
        : 0;

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
          MS_PER_MINUTE
        );
      }

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

  /*
   * Events generated by a single market are already chronological except for
   * overlapping positions entered/exited on the same timestamp. Stable sort
   * is used only for this small per-market event list.
   */
  stream.events.sort(comparePortfolioEvents);
}

/* -------------------------------------------------------------------------- */
/* Portfolio event sweep                                                      */
/* -------------------------------------------------------------------------- */

interface EventHeapItem {
  streamIndex: number;
  eventIndex: number;
}

function comparePortfolioEvents(
  a: PortfolioEvent,
  b: PortfolioEvent
): number {
  if (a.time !== b.time) {
    return a.time - b.time;
  }

  if (a.type === b.type) {
    return 0;
  }

  return a.type === "exit" ? -1 : 1;
}

function eventHeapLess(
  streams: MarketPortfolioStream[],
  a: EventHeapItem,
  b: EventHeapItem
): boolean {
  const eventA =
    streams[a.streamIndex].events[
      a.eventIndex
    ];
  const eventB =
    streams[b.streamIndex].events[
      b.eventIndex
    ];

  return (
    comparePortfolioEvents(eventA, eventB) < 0
  );
}

function eventHeapPush(
  heap: EventHeapItem[],
  streams: MarketPortfolioStream[],
  item: EventHeapItem
): void {
  let index = heap.length;
  heap.push(item);

  while (index > 0) {
    const parent = (index - 1) >> 1;

    if (
      !eventHeapLess(
        streams,
        item,
        heap[parent]
      )
    ) {
      break;
    }

    heap[index] = heap[parent];
    index = parent;
  }

  heap[index] = item;
}

function eventHeapPop(
  heap: EventHeapItem[],
  streams: MarketPortfolioStream[]
): EventHeapItem | undefined {
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
      eventHeapLess(
        streams,
        heap[right],
        heap[left]
      )
    ) {
      child = right;
    }

    if (
      !eventHeapLess(
        streams,
        heap[child],
        last
      )
    ) {
      break;
    }

    heap[index] = heap[child];
    index = child;
  }

  heap[index] = last;
  return root;
}

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
  /*
   * Each market's event list is sorted already. A k-way heap merge avoids
   * allocating and globally sorting every transaction event.
   */
  const heap: EventHeapItem[] = [];

  for (
    let streamIndex = 0;
    streamIndex < streams.length;
    streamIndex++
  ) {
    if (streams[streamIndex].events.length > 0) {
      eventHeapPush(
        heap,
        streams,
        {
          streamIndex,
          eventIndex: 0,
        }
      );
    }
  }

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

  while (heap.length > 0) {
    const first =
      eventHeapPop(heap, streams)!;

    const event =
      streams[first.streamIndex].events[
        first.eventIndex
      ];

    const time = event.time;

    if (time > previousTime) {
      capitalDays +=
        (capitalDeployed *
          (time - previousTime)) /
        MS_PER_DAY;

      previousTime = time;
    }

    /*
     * Process every event at this timestamp before advancing the heap.
     * Exits naturally precede entries through the comparator.
     */
    let current: EventHeapItem | undefined =
      first;

    while (current) {
      const currentEvent =
        streams[
          current.streamIndex
        ].events[current.eventIndex];

      if (currentEvent.time !== time) {
        eventHeapPush(
          heap,
          streams,
          current
        );
        break;
      }

      cashFlow += currentEvent.cashDelta;
      capitalDeployed +=
        currentEvent.capitalDelta;
      openPositions +=
        currentEvent.positionDelta;
      openMarkets +=
        currentEvent.marketDelta;

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

      minimumStartingCash = Math.max(
        minimumStartingCash,
        -cashFlow
      );

      const nextEventIndex =
        current.eventIndex + 1;

      if (
        nextEventIndex <
        streams[current.streamIndex].events
          .length
      ) {
        eventHeapPush(
          heap,
          streams,
          {
            streamIndex:
              current.streamIndex,
            eventIndex: nextEventIndex,
          }
        );
      }

      current =
        heap.length > 0
          ? eventHeapPop(heap, streams)
          : undefined;

      if (
        current &&
        streams[
          current.streamIndex
        ].events[current.eventIndex].time !==
          time
      ) {
        eventHeapPush(
          heap,
          streams,
          current
        );
        current = undefined;
      }
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
/* Chronological equity sweep                                                 */
/* -------------------------------------------------------------------------- */

interface CandleHeapItem {
  marketIndex: number;
  candleIndex: number;
}

function candleTime(
  streams: MarketPortfolioStream[],
  item: CandleHeapItem
): number {
  return streams[item.marketIndex].candles[
    item.candleIndex
  ].openTime;
}

function candleHeapLess(
  streams: MarketPortfolioStream[],
  a: CandleHeapItem,
  b: CandleHeapItem
): boolean {
  return (
    candleTime(streams, a) <
    candleTime(streams, b)
  );
}

function candleHeapPush(
  heap: CandleHeapItem[],
  streams: MarketPortfolioStream[],
  item: CandleHeapItem
): void {
  let index = heap.length;
  heap.push(item);

  while (index > 0) {
    const parent = (index - 1) >> 1;

    if (
      !candleHeapLess(
        streams,
        item,
        heap[parent]
      )
    ) {
      break;
    }

    heap[index] = heap[parent];
    index = parent;
  }

  heap[index] = item;
}

function candleHeapPop(
  heap: CandleHeapItem[],
  streams: MarketPortfolioStream[]
): CandleHeapItem | undefined {
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
      candleHeapLess(
        streams,
        heap[right],
        heap[left]
      )
    ) {
      child = right;
    }

    if (
      !candleHeapLess(
        streams,
        heap[child],
        last
      )
    ) {
      break;
    }

    heap[index] = heap[child];
    index = child;
  }

  heap[index] = last;
  return root;
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
  const heap: CandleHeapItem[] = [];

  const eventPointers = new Int32Array(
    streams.length
  );
  const quantities = new Float64Array(
    streams.length
  );
  const currentMarketValues =
    new Float64Array(streams.length);

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
      candleHeapPush(
        heap,
        streams,
        {
          marketIndex,
          candleIndex: 0,
        }
      );
    }
  }

  while (heap.length > 0) {
    const first =
      candleHeapPop(heap, streams)!;

    const time = candleTime(
      streams,
      first
    );

    /*
     * There are normally one candle per market at a timestamp. Reuse a
     * temporary array only when timestamps collide, rather than allocating a
     * global timestamp map.
     */
    const sameTime: CandleHeapItem[] = [
      first,
    ];

    while (heap.length > 0) {
      const next = heap[0];

      if (
        candleTime(streams, next) !== time
      ) {
        break;
      }

      sameTime.push(
        candleHeapPop(heap, streams)!
      );
    }

    for (const item of sameTime) {
      const stream =
        streams[item.marketIndex];

      let pointer =
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

        pointer++;
      }

      eventPointers[item.marketIndex] =
        pointer;
    }

    for (const item of sameTime) {
      const stream =
        streams[item.marketIndex];
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
        candleHeapPush(
          heap,
          streams,
          {
            marketIndex:
              item.marketIndex,
            candleIndex:
              nextCandleIndex,
          }
        );
      }
    }

    const equity =
      cash + totalMarketValue;

    if (equity > peakEquity) {
      peakEquity = equity;
    }

    const drawdown =
      peakEquity - equity;

    if (drawdown > maxDrawdownAbsolute) {
      maxDrawdownAbsolute = drawdown;
    }

    if (peakEquity > 0) {
      const drawdownPct =
        drawdown / peakEquity;

      if (
        drawdownPct > maxDrawdownPct
      ) {
        maxDrawdownPct = drawdownPct;
      }
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
      stats.firstTargetTimes[
        target.name
      ];

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

    realisedGross:
      stats.realisedGross,
    realisedFees:
      stats.realisedFees,
    realisedNet:
      stats.realisedNet,

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
          ) / stats.holdTimes.length,

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
/* Dataset preparation                                                        */
/* -------------------------------------------------------------------------- */

function prepareMarkets(
  markets: MarketData[]
): PreparedMarket[] {
  return markets.map((market) => ({
    symbol: market.symbol,
    candles: market.candles,
    signalIndices:
      buildSignalIndices(market.candles),
  }));
}

function getDatasetTimeRange(
  markets: PreparedMarket[]
): {
  startTime: number;
  endTime: number;
} {
  let startTime =
    Number.POSITIVE_INFINITY;
  let endTime =
    Number.NEGATIVE_INFINITY;

  for (const market of markets) {
    if (market.candles.length === 0) {
      continue;
    }

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

  return {
    startTime,
    endTime,
  };
}

function createStreams(
  markets: PreparedMarket[]
): MarketPortfolioStream[] {
  return markets.map((market) => ({
    symbol: market.symbol,
    candles: market.candles,
    events: [],
  }));
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
    "Optimised partial-exit portfolio backtest"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Loading dataset: ${DATASET_PATH}`
  );

  const dataset = JSON.parse(
    fs.readFileSync(
      DATASET_PATH,
      "utf8"
    )
  ) as Dataset;

  const marketCount =
    dataset.markets.length;

  let totalCandles = 0;
  for (const market of dataset.markets) {
    totalCandles +=
      market.candles.length;
  }

  const globalStart = Date.now();

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

  console.log(
    "Preparing signals and range indexes..."
  );

  const markets =
    prepareMarkets(dataset.markets);

  const rangeIndexes =
    markets.map(
      (market) =>
        new CandleRangeIndex(
          market.candles
        )
    );

  const { startTime, endTime } =
    getDatasetTimeRange(markets);

  let totalSignals = 0;
  for (const market of markets) {
    totalSignals +=
      market.signalIndices.length;
  }

  console.log(
    `Signals: ${totalSignals.toLocaleString()}`
  );
  console.log(
    "Signal calculation: one pass shared by all configurations"
  );
  console.log(
    "Exit lookup: segment-tree first-crossing search"
  );
  console.log(
    "Portfolio events: k-way merge of per-market event streams"
  );
  console.log("");

  const results: ConfigurationResult[] =
    [];

  for (
    let configIndex = 0;
    configIndex <
    CONFIGURATIONS.length;
    configIndex++
  ) {
    const config =
      CONFIGURATIONS[configIndex];

    console.log(
      `\n[${configIndex + 1}/${CONFIGURATIONS.length}] ${config.name}`
    );

    const configStart = Date.now();
    const stats = createStats(config);
    const streams =
      createStreams(markets);

    for (
      let marketIndex = 0;
      marketIndex < markets.length;
      marketIndex++
    ) {
      processMarket(
        markets[marketIndex],
        config,
        stats,
        streams[marketIndex],
        rangeIndexes[marketIndex]
      );

      if (
        (marketIndex + 1) % 10 === 0 ||
        marketIndex ===
          markets.length - 1
      ) {
        console.log(
          `  processed ${marketIndex + 1}/${marketCount} markets`
        );
      }
    }

    /*
     * Pass 1:
     * transaction-only sweep. This determines the minimum starting cash and
     * capital utilisation without constructing a global timestamp map.
     */
    const eventSweep =
      sweepPortfolioEvents(
        streams,
        startTime,
        endTime
      );

    /*
     * Pass 2:
     * chronological mark-to-market. The heap contains one candle per market,
     * so the portfolio layer never scans all open positions for every candle.
     */
    const equitySweep =
      calculateEquityCurve(
        streams,
        eventSweep.minimumStartingCash
      );

    const combinedNet =
      stats.realisedNet +
      stats.unrealisedGross;

    const expectedFinalEquity =
      eventSweep.minimumStartingCash +
      combinedNet;

    const accountingDifference =
      equitySweep.finalEquity -
      expectedFinalEquity;

    if (
      Math.abs(accountingDifference) >
      Math.max(
        0.01,
        Math.abs(expectedFinalEquity) *
          1e-10
      )
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
      (365.25 * MS_PER_DAY);

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
        Number.isFinite(
          result.profitFactor
        )
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
      signals: totalSignals,
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

      optimisation:
        "signals calculated once per market; exits found by segment-tree first-crossing searches; portfolio events merged from sorted per-market streams; chronological mark-to-market uses a market-level heap",

      portfolioAlgorithm:
        "transaction event k-way merge plus market-level chronological mark-to-market heap",

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

  const outputPath = path.join(
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
