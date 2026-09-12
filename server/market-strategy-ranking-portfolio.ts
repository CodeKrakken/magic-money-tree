import fs from "fs";
import path from "path";

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [key: string]: unknown;
}

interface MarketData {
  symbol: string;
  candles: Candle[];
  [key: string]: unknown;
}

interface Dataset {
  markets: MarketData[];
  [key: string]: unknown;
}

interface BinanceSymbol {
  symbol: string;
  status?: string;
  baseAsset?: string;
  baseAssetPrecision?: number;
  quoteAsset?: string;
  quotePrecision?: number;
  quoteAssetPrecision?: number;
  baseCommissionPrecision?: number;
  quoteCommissionPrecision?: number;
  orderTypes?: string[];
  icebergAllowed?: boolean;
  ocoAllowed?: boolean;
  otoAllowed?: boolean;
  quoteOrderQtyMarketAllowed?: boolean;
  isSpotTradingAllowed?: boolean;
  isMarginTradingAllowed?: boolean;
  filters?: unknown[];
  permissions?: string[];
  permissionSets?: unknown[];
  defaultSelfTradePreventionMode?: string;
  allowedSelfTradePreventionModes?: string[];
  [key: string]: unknown;
}

interface BinanceExchangeInfo {
  symbols: BinanceSymbol[];
  [key: string]: unknown;
}

type DatasetGroup = "Sample" | "OutOfSample";

interface Target {
  name: string;
  returnPct: number;
  fraction: number;
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

interface PositionSimulation {
  marketIndex: number;
  symbol: string;
  datasetGroup: DatasetGroup;

  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  entryValue: number;
  entryFee: number;

  exitTime: number | null;
  exitPrice: number | null;

  realisedNet: number;
  remainingQuantity: number;
  completed: boolean;

  exits: ExitRecord[];

  slope20: number;
  slope50: number;
  acceleration: number;
}

interface AcceptedPosition extends PositionSimulation {
  positionId: number;
}

interface MarketStats {
  symbol: string;
  datasetGroup: DatasetGroup;
  marketIndex: number;

  binanceArrayPosition: number | null;
  binance: BinanceSymbol | null;

  signals: number;
  accepted: number;
  rejectedByCapacity: number;

  buys: number;
  sells: number;

  winningPositions: number;
  losingPositions: number;
  flatPositions: number;
  winRate: number;

  grossProfit: number;
  fees: number;
  netProfit: number;
  returnPct: number;

  totalBuyNotional: number;
  totalSellNotional: number;

  target1PctCount: number;
  target2PctCount: number;
  target4PctCount: number;
  stopCount: number;
  maxHoldCount: number;
  endOfDataCount: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;
  averageProfitPerAcceptedPosition: number;

  firstTarget1AvgMinutes: number;
  firstTarget2AvgMinutes: number;
  firstTarget4AvgMinutes: number;

  averageSlope20: number;
  averageAcceleration: number;

  [key: string]: unknown;
}

interface GroupStats {
  datasetGroup: DatasetGroup;
  markets: number;

  totalSignals: number;
  acceptedSignals: number;
  rejectedByCapacity: number;

  buys: number;
  sells: number;

  completedPositions: number;
  winningPositions: number;
  losingPositions: number;
  flatPositions: number;
  winRate: number;

  grossProfit: number;
  fees: number;
  netProfit: number;
  returnPct: number;

  totalBuyNotional: number;
  totalSellNotional: number;

  target1PctCount: number;
  target2PctCount: number;
  target4PctCount: number;
  stopCount: number;
  maxHoldCount: number;
  endOfDataCount: number;

  peakOpenPositions: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  averageProfitPerAcceptedPosition: number;
}

interface DatasetRun {
  datasetGroup: DatasetGroup;
  datasetPath: string;
  marketCount: number;
  groupStats: GroupStats;
  markets: MarketStats[];
}

interface HeapNode {
  positionId: number;
  exitTime: number;
}

const OUTPUT_DIR = path.join(
  process.cwd(),
  "server",
  "research-output"
);

const MAX_MARKETS_PER_GROUP = 60;
const MAX_CONCURRENT_POSITIONS = 43;

const POSITION_NOTIONAL = 10;
const FEE_RATE = 0.001;

const STOP_RETURN = -0.10;

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

const MAX_HOLD_MINUTES = 48 * 60;

const SLOPE_THRESHOLD = -0.0001425851160546487;
const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const EPSILON = 1e-12;
const MS_PER_MINUTE = 60_000;

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

function median(values: number[]): number {
  return percentile(values, 0.5);
}

/* -------------------------------------------------------------------------- */
/* Min heap                                                                   */
/* -------------------------------------------------------------------------- */

class ExitHeap {
  private readonly heap: HeapNode[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(node: HeapNode): void {
    this.heap.push(node);

    let index =
      this.heap.length - 1;

    while (index > 0) {
      const parent =
        (index - 1) >> 1;

      if (
        this.compare(
          this.heap[parent],
          this.heap[index]
        ) <= 0
      ) {
        break;
      }

      [
        this.heap[parent],
        this.heap[index],
      ] = [
        this.heap[index],
        this.heap[parent],
      ];

      index = parent;
    }
  }

  peek(): HeapNode | undefined {
    return this.heap[0];
  }

  pop(): HeapNode | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }

    const result = this.heap[0];

    const last = this.heap.pop();

    if (
      this.heap.length > 0 &&
      last !== undefined
    ) {
      this.heap[0] = last;

      let index = 0;

      while (true) {
        const left =
          index * 2 + 1;

        const right =
          left + 1;

        let smallest = index;

        if (
          left < this.heap.length &&
          this.compare(
            this.heap[left],
            this.heap[smallest]
          ) < 0
        ) {
          smallest = left;
        }

        if (
          right < this.heap.length &&
          this.compare(
            this.heap[right],
            this.heap[smallest]
          ) < 0
        ) {
          smallest = right;
        }

        if (smallest === index) {
          break;
        }

        [
          this.heap[index],
          this.heap[smallest],
        ] = [
          this.heap[smallest],
          this.heap[index],
        ];

        index = smallest;
      }
    }

    return result;
  }

  private compare(
    a: HeapNode,
    b: HeapNode
  ): number {
    if (a.exitTime !== b.exitTime) {
      return a.exitTime - b.exitTime;
    }

    return a.positionId - b.positionId;
  }
}

/* -------------------------------------------------------------------------- */
/* Signal calculation                                                         */
/* -------------------------------------------------------------------------- */

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

  for (let i = 0; i < n; i++) {
    const close = closes[i];

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

interface Signal {
  index: number;
  slope20: number;
  slope50: number;
  acceleration: number;
}

function buildSignals(
  candles: Candle[]
): Signal[] {
  if (candles.length < 50) {
    return [];
  }

  const closes = candles.map(
    (candle) => candle.close
  );

  const slope20 =
    buildRegressionSlopes(
      closes,
      20
    );

  const slope50 =
    buildRegressionSlopes(
      closes,
      50
    );

  const signals: Signal[] = [];

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
      signals.push({
        index: i,
        slope20: slope20[i],
        slope50: slope50[i],
        acceleration,
      });
    }
  }

  return signals;
}

/* -------------------------------------------------------------------------- */
/* Range index                                                                */
/* -------------------------------------------------------------------------- */

class CandleRangeIndex {
  private readonly size: number;
  private readonly maxHigh: Float64Array;
  private readonly minLow: Float64Array;

  constructor(
    candles: Candle[]
  ) {
    let size = 1;

    while (size < candles.length) {
      size <<= 1;
    }

    this.size = size;

    this.maxHigh =
      new Float64Array(
        size * 2
      );

    this.minLow =
      new Float64Array(
        size * 2
      );

    this.maxHigh.fill(
      Number.NEGATIVE_INFINITY
    );

    this.minLow.fill(
      Number.POSITIVE_INFINITY
    );

    for (
      let i = 0;
      i < candles.length;
      i++
    ) {
      const node = size + i;

      this.maxHigh[node] =
        candles[i].high;

      this.minLow[node] =
        candles[i].low;
    }

    for (
      let node = size - 1;
      node > 0;
      node--
    ) {
      this.maxHigh[node] =
        Math.max(
          this.maxHigh[node * 2],
          this.maxHigh[
            node * 2 + 1
          ]
        );

      this.minLow[node] =
        Math.min(
          this.minLow[node * 2],
          this.minLow[
            node * 2 + 1
          ]
        );
    }
  }

  firstHighAtLeast(
    fromIndex: number,
    toIndex: number,
    threshold: number
  ): number {
    return this.findFirst(
      fromIndex,
      toIndex,
      threshold,
      this.maxHigh,
      (value, target) =>
        value >= target
    );
  }

  firstLowAtMost(
    fromIndex: number,
    toIndex: number,
    threshold: number
  ): number {
    return this.findFirst(
      fromIndex,
      toIndex,
      threshold,
      this.minLow,
      (value, target) =>
        value <= target
    );
  }

  private findFirst(
    fromIndex: number,
    toIndex: number,
    threshold: number,
    tree: Float64Array,
    matches: (
      value: number,
      target: number
    ) => boolean
  ): number {
    if (
      fromIndex > toIndex ||
      fromIndex >= this.size
    ) {
      return -1;
    }

    return this.findFirstNode(
      1,
      0,
      this.size - 1,
      fromIndex,
      toIndex,
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
    toIndex: number,
    threshold: number,
    tree: Float64Array,
    matches: (
      value: number,
      target: number
    ) => boolean
  ): number {
    if (
      right < fromIndex ||
      left > toIndex ||
      !matches(
        tree[node],
        threshold
      )
    ) {
      return -1;
    }

    if (left === right) {
      return left;
    }

    const middle =
      (left + right) >> 1;

    const leftResult =
      this.findFirstNode(
        node * 2,
        left,
        middle,
        fromIndex,
        toIndex,
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
      toIndex,
      threshold,
      tree,
      matches
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Position simulation                                                        */
/* -------------------------------------------------------------------------- */

function calculateEntryFee(
  notional: number
): number {
  return notional * FEE_RATE;
}

function calculateExitFee(
  value: number
): number {
  return value * FEE_RATE;
}

function simulatePosition(
  market: MarketData,
  marketIndex: number,
  datasetGroup: DatasetGroup,
  signal: Signal,
  rangeIndex: CandleRangeIndex
): PositionSimulation {
  const candles = market.candles;

  const entryIndex =
    signal.index;

  const entryCandle =
    candles[entryIndex];

  const entryPrice =
    entryCandle.close;

  const quantity =
    POSITION_NOTIONAL /
    entryPrice;

  const entryValue =
    quantity * entryPrice;

  const entryFee =
    calculateEntryFee(
      entryValue
    );

  const maxHoldEndTime =
    entryCandle.openTime +
    MAX_HOLD_MINUTES *
      MS_PER_MINUTE;

  let endIndex =
    candles.length - 1;

  for (
    let i = entryIndex + 1;
    i < candles.length;
    i++
  ) {
    if (
      candles[i].openTime >
      maxHoldEndTime
    ) {
      endIndex = i - 1;
      break;
    }
  }

  if (endIndex <= entryIndex) {
    endIndex = Math.min(
      entryIndex + 1,
      candles.length - 1
    );
  }

  const stopPrice =
    entryPrice *
    (1 + STOP_RETURN);

  const targetHits = TARGETS.map(
    (target) => ({
      target,
      price:
        entryPrice *
        (1 + target.returnPct),
      index:
        rangeIndex.firstHighAtLeast(
          entryIndex + 1,
          endIndex,
          entryPrice *
            (1 + target.returnPct)
        ),
    })
  );

  const stopIndex =
    rangeIndex.firstLowAtMost(
      entryIndex + 1,
      endIndex,
      stopPrice
    );

  const events: Array<{
    index: number;
    type: "stop" | "target";
    target?: Target;
    price: number;
  }> = [];

  if (stopIndex !== -1) {
    events.push({
      index: stopIndex,
      type: "stop",
      price: stopPrice,
    });
  }

  for (const hit of targetHits) {
    if (hit.index !== -1) {
      events.push({
        index: hit.index,
        type: "target",
        target: hit.target,
        price: hit.price,
      });
    }
  }

  events.sort((a, b) => {
    if (a.index !== b.index) {
      return a.index - b.index;
    }

    if (
      a.type === "stop" &&
      b.type !== "stop"
    ) {
      return -1;
    }

    if (
      b.type === "stop" &&
      a.type !== "stop"
    ) {
      return 1;
    }

    return (
      (a.target?.returnPct ?? 0) -
      (b.target?.returnPct ?? 0)
    );
  });

  let remainingQuantity =
    quantity;

  let realisedNet =
    -entryFee;

  const exits: ExitRecord[] = [];

  for (const event of events) {
    if (
      remainingQuantity <=
      EPSILON
    ) {
      break;
    }

    if (event.type === "stop") {
      const quantitySold =
        remainingQuantity;

      const saleValue =
        quantitySold *
        event.price;

      const exitFee =
        calculateExitFee(
          saleValue
        );

      const netSaleProceeds =
        saleValue - exitFee;

      const pnl =
        netSaleProceeds -
        quantitySold *
          entryPrice;

      realisedNet += pnl;

      exits.push({
        exitTime:
          candles[event.index]
            .openTime,
        exitPrice:
          event.price,
        quantitySold,
        grossSaleValue:
          saleValue,
        exitFee,
        netSaleProceeds,
        target: "stop",
      });

      remainingQuantity = 0;

      break;
    }

    const target =
      event.target;

    if (!target) {
      continue;
    }

    const quantitySold =
      Math.min(
        quantity *
          target.fraction,
        remainingQuantity
      );

    if (
      quantitySold <=
      EPSILON
    ) {
      continue;
    }

    const saleValue =
      quantitySold *
      event.price;

    const exitFee =
      calculateExitFee(
        saleValue
      );

    const netSaleProceeds =
      saleValue - exitFee;

    const pnl =
      netSaleProceeds -
      quantitySold *
        entryPrice;

    realisedNet += pnl;

    remainingQuantity -=
      quantitySold;

    exits.push({
      exitTime:
        candles[event.index]
          .openTime,
      exitPrice:
        event.price,
      quantitySold,
      grossSaleValue:
        saleValue,
      exitFee,
      netSaleProceeds,
      target:
        target.name,
    });
  }

  let exitTime: number | null =
    null;

  let exitPrice: number | null =
    null;

  let completed =
    remainingQuantity <=
    EPSILON;

  if (completed) {
    const finalExit =
      exits[exits.length - 1];

    if (finalExit) {
      exitTime =
        finalExit.exitTime;
      exitPrice =
        finalExit.exitPrice;
    }
  } else {
    /*
     * Any remaining quantity is closed at the 48-hour boundary, or at the
     * final available candle if the dataset ends first.
     */
    const liquidationCandle =
      candles[endIndex];

    const liquidationPrice =
      liquidationCandle.close;

    const saleValue =
      remainingQuantity *
      liquidationPrice;

    const exitFee =
      calculateExitFee(
        saleValue
      );

    const netSaleProceeds =
      saleValue - exitFee;

    const pnl =
      netSaleProceeds -
      remainingQuantity *
        entryPrice;

    realisedNet += pnl;

    exits.push({
      exitTime:
        liquidationCandle.openTime,
      exitPrice:
        liquidationPrice,
      quantitySold:
        remainingQuantity,
      grossSaleValue:
        saleValue,
      exitFee,
      netSaleProceeds,
      target:
        liquidationCandle.openTime -
          entryCandle.openTime >=
        MAX_HOLD_MINUTES *
          MS_PER_MINUTE
          ? "max_hold"
          : "end_of_data",
    });

    remainingQuantity = 0;
    completed = true;

    exitTime =
      liquidationCandle.openTime;

    exitPrice =
      liquidationPrice;
  }

  return {
    marketIndex,
    symbol: market.symbol,
    datasetGroup,

    entryIndex,
    entryTime:
      entryCandle.openTime,
    entryPrice,
    entryValue,
    entryFee,

    exitTime,
    exitPrice,

    realisedNet,
    remainingQuantity,
    completed,

    exits,

    slope20:
      signal.slope20,
    slope50:
      signal.slope50,
    acceleration:
      signal.acceleration,
  };
}

/* -------------------------------------------------------------------------- */
/* Market statistics                                                          */
/* -------------------------------------------------------------------------- */

function createMarketStats(
  market: MarketData,
  marketIndex: number,
  datasetGroup: DatasetGroup,
  binance: BinanceSymbol | null,
  binanceArrayPosition:
    | number
    | null
): MarketStats {
  return {
    symbol: market.symbol,
    datasetGroup,
    marketIndex,

    binanceArrayPosition,
    binance,

    signals: 0,
    accepted: 0,
    rejectedByCapacity: 0,

    buys: 0,
    sells: 0,

    winningPositions: 0,
    losingPositions: 0,
    flatPositions: 0,
    winRate: 0,

    grossProfit: 0,
    fees: 0,
    netProfit: 0,
    returnPct: 0,

    totalBuyNotional: 0,
    totalSellNotional: 0,

    target1PctCount: 0,
    target2PctCount: 0,
    target4PctCount: 0,
    stopCount: 0,
    maxHoldCount: 0,
    endOfDataCount: 0,

    averageHoldMinutes: 0,
    medianHoldMinutes: 0,
    averageProfitPerAcceptedPosition: 0,

    firstTarget1AvgMinutes: 0,
    firstTarget2AvgMinutes: 0,
    firstTarget4AvgMinutes: 0,

    averageSlope20: 0,
    averageAcceleration: 0,
  };
}

function applyPositionToMarketStats(
  stats: MarketStats,
  position: PositionSimulation
): void {
  stats.accepted++;
  stats.buys++;

  stats.totalBuyNotional +=
    position.entryValue;

  stats.fees +=
    position.entryFee;

  let grossProfit = 0;
  let sellNotional = 0;

  const targetTimes: Record<
    string,
    number[]
  > = {
    target_1pct: [],
    target_2pct: [],
    target_4pct: [],
  };

  for (const exit of position.exits) {
    stats.sells++;

    stats.totalSellNotional +=
      exit.grossSaleValue;

    sellNotional +=
      exit.grossSaleValue;

    stats.fees +=
      exit.exitFee;

    grossProfit +=
      exit.grossSaleValue -
      exit.quantitySold *
        position.entryPrice;

    if (
      exit.target ===
      "target_1pct"
    ) {
      stats.target1PctCount++;

      targetTimes.target_1pct.push(
        (exit.exitTime -
          position.entryTime) /
          MS_PER_MINUTE
      );
    } else if (
      exit.target ===
      "target_2pct"
    ) {
      stats.target2PctCount++;

      targetTimes.target_2pct.push(
        (exit.exitTime -
          position.entryTime) /
          MS_PER_MINUTE
      );
    } else if (
      exit.target ===
      "target_4pct"
    ) {
      stats.target4PctCount++;

      targetTimes.target_4pct.push(
        (exit.exitTime -
          position.entryTime) /
          MS_PER_MINUTE
      );
    } else if (
      exit.target === "stop"
    ) {
      stats.stopCount++;
    } else if (
      exit.target === "max_hold"
    ) {
      stats.maxHoldCount++;
    } else if (
      exit.target === "end_of_data"
    ) {
      stats.endOfDataCount++;
    }
  }

  stats.grossProfit +=
    grossProfit;

  stats.netProfit +=
    position.realisedNet;

  const returnPct =
    position.entryValue > 0
      ? position.realisedNet /
        position.entryValue
      : 0;

  if (returnPct > EPSILON) {
    stats.winningPositions++;
  } else if (
    returnPct < -EPSILON
  ) {
    stats.losingPositions++;
  } else {
    stats.flatPositions++;
  }

  if (
    position.exitTime !==
    null
  ) {
    const holdMinutes =
      (position.exitTime -
        position.entryTime) /
      MS_PER_MINUTE;

    /*
     * Store the aggregate temporarily as a private property.
     */
    const existing =
      (stats.__holdTimes as
        | number[]
        | undefined) ?? [];

    existing.push(holdMinutes);

    stats.__holdTimes =
      existing;
  }

  const slopes =
    (stats.__slopes as
      | number[]
      | undefined) ?? [];

  const accelerations =
    (stats.__accelerations as
      | number[]
      | undefined) ?? [];

  slopes.push(
    position.slope20
  );

  accelerations.push(
    position.acceleration
  );

  stats.__slopes =
    slopes;

  stats.__accelerations =
    accelerations;

  stats.__sellNotional =
    sellNotional;

  for (const [
    key,
    values,
  ] of Object.entries(
    targetTimes
  )) {
    const storageKey =
      `__${key}Times`;

    const existing =
      (stats[storageKey] as
        | number[]
        | undefined) ?? [];

    existing.push(
      ...values
    );

    stats[storageKey] =
      existing;
  }
}

function finaliseMarketStats(
  stats: MarketStats
): MarketStats {
  const holdTimes =
    (stats.__holdTimes as
      | number[]
      | undefined) ?? [];

  const slopes =
    (stats.__slopes as
      | number[]
      | undefined) ?? [];

  const accelerations =
    (stats.__accelerations as
      | number[]
      | undefined) ?? [];

  const target1Times =
    (stats.__target_1pctTimes as
      | number[]
      | undefined) ?? [];

  const target2Times =
    (stats.__target_2pctTimes as
      | number[]
      | undefined) ?? [];

  const target4Times =
    (stats.__target_4pctTimes as
      | number[]
      | undefined) ?? [];

  const wins =
    stats.winningPositions;

  stats.winRate =
    stats.accepted > 0
      ? wins / stats.accepted
      : 0;

  stats.returnPct =
    stats.totalBuyNotional > 0
      ? stats.netProfit /
        stats.totalBuyNotional
    : 0;

  stats.averageHoldMinutes =
    holdTimes.length > 0
      ? holdTimes.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        holdTimes.length
      : 0;

  stats.medianHoldMinutes =
    median(holdTimes);

  stats.averageProfitPerAcceptedPosition =
    stats.accepted > 0
      ? stats.netProfit /
        stats.accepted
      : 0;

  stats.averageSlope20 =
    slopes.length > 0
      ? slopes.reduce(
          (sum, value) =>
            sum + value,
          0
        ) / slopes.length
      : 0;

  stats.averageAcceleration =
    accelerations.length > 0
      ? accelerations.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        accelerations.length
      : 0;

  stats.firstTarget1AvgMinutes =
    target1Times.length > 0
      ? target1Times.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        target1Times.length
      : 0;

  stats.firstTarget2AvgMinutes =
    target2Times.length > 0
      ? target2Times.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        target2Times.length
      : 0;

  stats.firstTarget4AvgMinutes =
    target4Times.length > 0
      ? target4Times.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        target4Times.length
      : 0;

  /*
   * These were only internal calculation fields.
   */
  delete stats.__holdTimes;
  delete stats.__slopes;
  delete stats.__accelerations;
  delete stats.__target_1pctTimes;
  delete stats.__target_2pctTimes;
  delete stats.__target_4pctTimes;
  delete stats.__sellNotional;

  return stats;
}

/* -------------------------------------------------------------------------- */
/* Independent 60-market portfolio                                            */
/* -------------------------------------------------------------------------- */

function runDatasetGroup(
  dataset: Dataset,
  datasetGroup: DatasetGroup,
  datasetPath: string,
  binanceBySymbol: Map<
    string,
    {
      symbol: BinanceSymbol;
      arrayPosition: number;
    }
  >
): DatasetRun {
  if (
    dataset.markets.length !==
    MAX_MARKETS_PER_GROUP
  ) {
    throw new Error(
      `${datasetGroup} dataset must contain exactly ` +
        `${MAX_MARKETS_PER_GROUP} markets; ` +
        `found ${dataset.markets.length}`
    );
  }

  const marketStats =
    dataset.markets.map(
      (market, index) => {
        const binance =
          binanceBySymbol.get(
            market.symbol
          );

        return createMarketStats(
          market,
          index,
          datasetGroup,
          binance?.symbol ?? null,
          binance?.arrayPosition ??
            null
        );
      }
    );

  const preparedMarkets =
    dataset.markets.map(
      (market) => ({
        market,
        signals:
          buildSignals(
            market.candles
          ),
        rangeIndex:
          new CandleRangeIndex(
            market.candles
          ),
      })
    );

  /*
   * Every signal across this 60-market universe is placed into one chronological
   * stream. This is the important distinction from running each market separately.
   *
   * The stream is ONLY for this dataset group.
   */
  interface SignalEvent {
    marketIndex: number;
    signal: Signal;
    time: number;
  }

  const signalEvents: SignalEvent[] =
    [];

  for (
    let marketIndex = 0;
    marketIndex <
    preparedMarkets.length;
    marketIndex++
  ) {
    const prepared =
      preparedMarkets[
        marketIndex
      ];

    for (const signal of prepared.signals) {
      signalEvents.push({
        marketIndex,
        signal,
        time:
          prepared.market
            .candles[
            signal.index
          ].openTime,
      });
    }
  }

  signalEvents.sort(
    (a, b) => {
      if (a.time !== b.time) {
        return a.time - b.time;
      }

      /*
       * Deterministic capacity priority:
       * 1. Higher acceleration.
       * 2. More negative slope20.
       * 3. Lower Binance array position.
       * 4. Symbol.
       */
      if (
        a.signal.acceleration !==
        b.signal.acceleration
      ) {
        return (
          b.signal.acceleration -
          a.signal.acceleration
        );
      }

      if (
        a.signal.slope20 !==
        b.signal.slope20
      ) {
        return (
          a.signal.slope20 -
          b.signal.slope20
        );
      }

      const aBinance =
        marketStats[
          a.marketIndex
        ].binanceArrayPosition ??
        Number.MAX_SAFE_INTEGER;

      const bBinance =
        marketStats[
          b.marketIndex
        ].binanceArrayPosition ??
        Number.MAX_SAFE_INTEGER;

      if (
        aBinance !== bBinance
      ) {
        return (
          aBinance - bBinance
        );
      }

      return marketStats[
        a.marketIndex
      ].symbol.localeCompare(
        marketStats[
          b.marketIndex
        ].symbol
      );
    }
  );

  const exitHeap =
    new ExitHeap();

  let nextPositionId = 1;

  let activePositions = 0;
  let peakOpenPositions = 0;

  let totalSignals = 0;
  let acceptedSignals = 0;
  let rejectedByCapacity = 0;

  let buys = 0;
  let sells = 0;

  let completedPositions = 0;
  let winningPositions = 0;
  let losingPositions = 0;
  let flatPositions = 0;

  let grossProfit = 0;
  let fees = 0;
  let netProfit = 0;

  let totalBuyNotional = 0;
  let totalSellNotional = 0;

  let target1PctCount = 0;
  let target2PctCount = 0;
  let target4PctCount = 0;
  let stopCount = 0;
  let maxHoldCount = 0;
  let endOfDataCount = 0;

  const holdTimes: number[] = [];

  /*
   * The heap contains every accepted position ordered by its ACTUAL final
   * exit time. This fixes the previous exit-pointer bug.
   *
   * A position can enter earlier than another position but exit later. The
   * heap therefore cannot be replaced by an array pointer over entry order.
   */
  for (const event of signalEvents) {
    totalSignals++;

    const timestamp =
      event.time;

    /*
     * Free every position whose complete lifecycle has finished before
     * considering this signal for capacity.
     */
    while (true) {
      const next =
        exitHeap.peek();

      if (
        !next ||
        next.exitTime >
          timestamp
      ) {
        break;
      }

      exitHeap.pop();

      activePositions--;

      if (activePositions < 0) {
        throw new Error(
          "Portfolio position count became negative"
        );
      }
    }

    const market =
      preparedMarkets[
        event.marketIndex
      ];

    const stats =
      marketStats[
        event.marketIndex
      ];

    if (
      activePositions >=
      MAX_CONCURRENT_POSITIONS
    ) {
      rejectedByCapacity++;
      stats.rejectedByCapacity++;
      stats.signals++;
      continue;
    }

    /*
     * This signal is admitted.
     */
    const position =
      simulatePosition(
        market.market,
        event.marketIndex,
        datasetGroup,
        event.signal,
        market.rangeIndex
      );

    const acceptedPosition:
      AcceptedPosition = {
        ...position,
        positionId:
          nextPositionId++,
      };

    stats.signals++;

    applyPositionToMarketStats(
      stats,
      acceptedPosition
    );

    acceptedSignals++;
    activePositions++;
    peakOpenPositions =
      Math.max(
        peakOpenPositions,
        activePositions
      );

    buys++;

    totalBuyNotional +=
      position.entryValue;

    netProfit +=
      position.realisedNet;

    fees +=
      position.entryFee;

    for (const exit of position.exits) {
      sells++;

      totalSellNotional +=
        exit.grossSaleValue;

      fees +=
        exit.exitFee;

      if (
        exit.target ===
        "target_1pct"
      ) {
        target1PctCount++;
      } else if (
        exit.target ===
        "target_2pct"
      ) {
        target2PctCount++;
      } else if (
        exit.target ===
        "target_4pct"
      ) {
        target4PctCount++;
      } else if (
        exit.target ===
        "stop"
      ) {
        stopCount++;
      } else if (
        exit.target ===
        "max_hold"
      ) {
        maxHoldCount++;
      } else if (
        exit.target ===
        "end_of_data"
      ) {
        endOfDataCount++;
      }
    }

    if (
      position.exitTime ===
      null
    ) {
      throw new Error(
        `Accepted position ${position.symbol} ` +
          `has no exit time`
      );
    }

    exitHeap.push({
      positionId:
        acceptedPosition.positionId,
      exitTime:
        position.exitTime,
    });

    completedPositions++;

    const returnPct =
      position.entryValue > 0
        ? position.realisedNet /
          position.entryValue
        : 0;

    if (returnPct > EPSILON) {
      winningPositions++;
    } else if (
      returnPct < -EPSILON
    ) {
      losingPositions++;
    } else {
      flatPositions++;
    }

    holdTimes.push(
      (position.exitTime -
        position.entryTime) /
        MS_PER_MINUTE
    );
  }

  /*
   * Finalise all remaining positions. They remain open only because the
   * simulation reached its end before their exit time.
   */
  while (exitHeap.size > 0) {
    exitHeap.pop();
    activePositions--;
  }

  if (activePositions !== 0) {
    throw new Error(
      `Portfolio ${datasetGroup} finished with ` +
        `${activePositions} active positions`
    );
  }

  const finalMarkets =
    marketStats.map(
      finaliseMarketStats
    );

  finalMarkets.sort(
    (a, b) => {
      if (
        b.netProfit !==
        a.netProfit
      ) {
        return (
          b.netProfit -
          a.netProfit
        );
      }

      return a.symbol.localeCompare(
        b.symbol
      );
    }
  );

  const groupStats: GroupStats = {
    datasetGroup,
    markets:
      dataset.markets.length,

    totalSignals,
    acceptedSignals,
    rejectedByCapacity,

    buys,
    sells,

    completedPositions,
    winningPositions,
    losingPositions,
    flatPositions,

    winRate:
      acceptedSignals > 0
        ? winningPositions /
          acceptedSignals
        : 0,

    grossProfit,
    fees,
    netProfit,

    returnPct:
      totalBuyNotional > 0
        ? netProfit /
          totalBuyNotional
        : 0,

    totalBuyNotional,
    totalSellNotional,

    target1PctCount,
    target2PctCount,
    target4PctCount,
    stopCount,
    maxHoldCount,
    endOfDataCount,

    peakOpenPositions,

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
      median(holdTimes),

    averageProfitPerAcceptedPosition:
      acceptedSignals > 0
        ? netProfit /
          acceptedSignals
        : 0,
  };

  return {
    datasetGroup,
    datasetPath,
    marketCount:
      dataset.markets.length,
    groupStats,
    markets: finalMarkets,
  };
}

/* -------------------------------------------------------------------------- */
/* Binance metadata                                                           */
/* -------------------------------------------------------------------------- */

async function fetchBinanceExchangeInfo(): Promise<{
  info: BinanceExchangeInfo;
  bySymbol: Map<
    string,
    {
      symbol: BinanceSymbol;
      arrayPosition: number;
    }
  >;
}> {
  const url =
    "https://api.binance.com/api/v3/exchangeInfo";

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Binance exchangeInfo failed: ` +
        `${response.status} ${response.statusText}`
    );
  }

  const info =
    (await response.json()) as BinanceExchangeInfo;

  const bySymbol =
    new Map<
      string,
      {
        symbol: BinanceSymbol;
        arrayPosition: number;
      }
    >();

  info.symbols.forEach(
    (symbol, index) => {
      bySymbol.set(
        symbol.symbol,
        {
          symbol,
          arrayPosition:
            index,
        }
      );
    }
  );

  return {
    info,
    bySymbol,
  };
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                 */
/* -------------------------------------------------------------------------- */

interface MarketComparison {
  symbol: string;

  sample: MarketStats | null;
  outOfSample: MarketStats | null;

  sampleNetProfit: number;
  outOfSampleNetProfit: number;

  netProfitDifference: number;

  sampleReturnPct: number;
  outOfSampleReturnPct: number;

  returnDifference: number;

  sampleAccepted: number;
  outOfSampleAccepted: number;

  sampleWinRate: number;
  outOfSampleWinRate: number;

  sampleRejectedByCapacity: number;
  outOfSampleRejectedByCapacity: number;

  sampleBinanceArrayPosition:
    | number
    | null;

  outOfSampleBinanceArrayPosition:
    | number
    | null;
}

function buildComparison(
  sample: DatasetRun,
  outOfSample: DatasetRun
): MarketComparison[] {
  const bySymbol =
    new Map<
      string,
      {
        sample: MarketStats | null;
        outOfSample:
          | MarketStats
          | null;
      }
    >();

  for (const market of sample.markets) {
    bySymbol.set(
      market.symbol,
      {
        sample: market,
        outOfSample: null,
      }
    );
  }

  for (const market of outOfSample.markets) {
    const existing =
      bySymbol.get(
        market.symbol
      );

    if (existing) {
      existing.outOfSample =
        market;
    } else {
      bySymbol.set(
        market.symbol,
        {
          sample: null,
          outOfSample: market,
        }
      );
    }
  }

  const comparison: MarketComparison[] =
    [];

  for (const [
    symbol,
    value,
  ] of bySymbol) {
    const sampleStats =
      value.sample;

    const oosStats =
      value.outOfSample;

    const sampleNet =
      sampleStats?.netProfit ?? 0;

    const oosNet =
      oosStats?.netProfit ?? 0;

    const sampleReturn =
      sampleStats?.returnPct ?? 0;

    const oosReturn =
      oosStats?.returnPct ?? 0;

    comparison.push({
      symbol,

      sample: sampleStats,
      outOfSample: oosStats,

      sampleNetProfit:
        sampleNet,

      outOfSampleNetProfit:
        oosNet,

      netProfitDifference:
        oosNet - sampleNet,

      sampleReturnPct:
        sampleReturn,

      outOfSampleReturnPct:
        oosReturn,

      returnDifference:
        oosReturn -
        sampleReturn,

      sampleAccepted:
        sampleStats?.accepted ??
        0,

      outOfSampleAccepted:
        oosStats?.accepted ??
        0,

      sampleWinRate:
        sampleStats?.winRate ?? 0,

      outOfSampleWinRate:
        oosStats?.winRate ?? 0,

      sampleRejectedByCapacity:
        sampleStats?.rejectedByCapacity ??
        0,

      outOfSampleRejectedByCapacity:
        oosStats?.rejectedByCapacity ??
        0,

      sampleBinanceArrayPosition:
        sampleStats?.binanceArrayPosition ??
        null,

      outOfSampleBinanceArrayPosition:
        oosStats?.binanceArrayPosition ??
        null,
    });
  }

  comparison.sort(
    (a, b) => {
      const combinedDifference =
        b.sampleNetProfit +
        b.outOfSampleNetProfit -
        (a.sampleNetProfit +
          a.outOfSampleNetProfit);

      if (
        combinedDifference !==
        0
      ) {
        return combinedDifference;
      }

      return a.symbol.localeCompare(
        b.symbol
      );
    }
  );

  return comparison;
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

function csvEscape(
  value: unknown
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return (
      '"' +
      text.replaceAll(
        '"',
        '""'
      ) +
      '"'
    );
  }

  return text;
}

function flattenMarket(
  market: MarketStats
): Record<string, unknown> {
  const result: Record<
    string,
    unknown
  > = {
    Name: market.symbol,
    Dataset: market.datasetGroup,
    MarketIndex:
      market.marketIndex,
    BinanceArrayPosition:
      market.binanceArrayPosition,

    Signals: market.signals,
    Accepted: market.accepted,
    RejectedByCapacity:
      market.rejectedByCapacity,

    Buys: market.buys,
    Sells: market.sells,

    WinningPositions:
      market.winningPositions,
    LosingPositions:
      market.losingPositions,
    FlatPositions:
      market.flatPositions,
    WinRate: market.winRate,

    GrossProfit:
      market.grossProfit,
    Fees: market.fees,
    NetProfit:
      market.netProfit,
    ReturnPct:
      market.returnPct,

    TotalBuyNotional:
      market.totalBuyNotional,
    TotalSellNotional:
      market.totalSellNotional,

    Target1PctCount:
      market.target1PctCount,
    Target2PctCount:
      market.target2PctCount,
    Target4PctCount:
      market.target4PctCount,

    StopCount:
      market.stopCount,
    MaxHoldCount:
      market.maxHoldCount,
    EndOfDataCount:
      market.endOfDataCount,

    AverageHoldMinutes:
      market.averageHoldMinutes,
    MedianHoldMinutes:
      market.medianHoldMinutes,

    AverageProfitPerAcceptedPosition:
      market.averageProfitPerAcceptedPosition,

    FirstTarget1AvgMinutes:
      market.firstTarget1AvgMinutes,
    FirstTarget2AvgMinutes:
      market.firstTarget2AvgMinutes,
    FirstTarget4AvgMinutes:
      market.firstTarget4AvgMinutes,

    AverageSlope20:
      market.averageSlope20,
    AverageAcceleration:
      market.averageAcceleration,
  };

  if (market.binance) {
    for (const [
      key,
      value,
    ] of Object.entries(
      market.binance
    )) {
      result[
        `Binance_${key}`
      ] = value;
    }
  }

  return result;
}

function writeCsv(
  filePath: string,
  rows: Record<
    string,
    unknown
  >[]
): void {
  if (rows.length === 0) {
    fs.writeFileSync(
      filePath,
      ""
    );
    return;
  }

  const columns =
    Array.from(
      new Set(
        rows.flatMap(
          (row) =>
            Object.keys(row)
        )
      )
    );

  const lines = [
    columns.join(","),
  ];

  for (const row of rows) {
    lines.push(
      columns
        .map((column) =>
          csvEscape(
            row[column]
          )
        )
        .join(",")
    );
  }

  fs.writeFileSync(
    filePath,
    lines.join("\n")
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function loadDataset(
  filePath: string
): Dataset {
  const raw =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  const dataset =
    JSON.parse(raw) as Dataset;

  if (
    !dataset ||
    !Array.isArray(
      dataset.markets
    )
  ) {
    throw new Error(
      `Invalid dataset: ${filePath}`
    );
  }

  return dataset;
}

function resolveDatasetPath(
  value: string
): string {
  return path.isAbsolute(value)
    ? value
    : path.resolve(
        process.cwd(),
        value
      );
}

async function main(): Promise<void> {
  const [
    sampleArg,
    outOfSampleArg,
  ] = process.argv.slice(2);

  if (
    !sampleArg ||
    !outOfSampleArg
  ) {
    console.error(
      [
        "Usage:",
        "",
        "npx tsx server/market-strategy-ranking-portfolio.ts \\",
        "  <sample-dataset.json> \\",
        "  <out-of-sample-dataset.json>",
        "",
        "Example:",
        "",
        "npx tsx server/market-strategy-ranking-portfolio.ts \\",
        "  server/research-output/ema-data-1789061547934.json \\",
        "  server/research-output/ema-data-oos-60-1789165540440.json",
      ].join("\n")
    );

    process.exit(1);
  }

  const samplePath =
    resolveDatasetPath(
      sampleArg
    );

  const outOfSamplePath =
    resolveDatasetPath(
      outOfSampleArg
    );

  console.log(
    "============================================================"
  );
  console.log(
    "Independent 60-market portfolio comparison"
  );
  console.log(
    "============================================================"
  );

  console.log(
    `Sample:      ${samplePath}`
  );

  console.log(
    `OutOfSample: ${outOfSamplePath}`
  );

  console.log(
    `Position cap: ${MAX_CONCURRENT_POSITIONS} per 60-market portfolio`
  );

  console.log(
    `Position size: $${POSITION_NOTIONAL}`
  );

  console.log(
    `Fee: ${(FEE_RATE * 100).toFixed(2)}% per side`
  );

  console.log(
    `Stop: ${(STOP_RETURN * 100).toFixed(1)}%`
  );

  console.log(
    "Targets: +1%/50%, +2%/25%, +4%/25%"
  );

  console.log(
    `Maximum hold: ${MAX_HOLD_MINUTES} minutes`
  );

  console.log();

  const sampleDataset =
    loadDataset(
      samplePath
    );

  const outOfSampleDataset =
    loadDataset(
      outOfSamplePath
    );

  if (
    sampleDataset.markets.length !==
    MAX_MARKETS_PER_GROUP
  ) {
    throw new Error(
      `Sample dataset contains ` +
        `${sampleDataset.markets.length} markets; ` +
        `expected ${MAX_MARKETS_PER_GROUP}`
    );
  }

  if (
    outOfSampleDataset.markets
      .length !==
    MAX_MARKETS_PER_GROUP
  ) {
    throw new Error(
      `OutOfSample dataset contains ` +
        `${outOfSampleDataset.markets.length} markets; ` +
        `expected ${MAX_MARKETS_PER_GROUP}`
    );
  }

  console.log(
    "Fetching Binance exchangeInfo..."
  );

  const {
    info: exchangeInfo,
    bySymbol,
  } =
    await fetchBinanceExchangeInfo();

  const allSymbols =
    new Set(
      [
        ...sampleDataset.markets,
        ...outOfSampleDataset.markets,
      ].map(
        (market) =>
          market.symbol
      )
    );

  const missingSymbols =
    [...allSymbols].filter(
      (symbol) =>
        !bySymbol.has(symbol)
    );

  console.log(
    `Binance symbols: ${exchangeInfo.symbols.length}`
  );

  console.log(
    `Required symbols: ${allSymbols.size}`
  );

  console.log(
    `Missing symbols: ${missingSymbols.length}`
  );

  if (
    missingSymbols.length >
    0
  ) {
    console.warn(
      "Missing Binance symbols:"
    );

    console.warn(
      missingSymbols.join(", ")
    );
  }

  console.log();

  console.log(
    "Running Sample portfolio..."
  );

  const sampleRun =
    runDatasetGroup(
      sampleDataset,
      "Sample",
      samplePath,
      bySymbol
    );

  console.log(
    "Running OutOfSample portfolio..."
  );

  const outOfSampleRun =
    runDatasetGroup(
      outOfSampleDataset,
      "OutOfSample",
      outOfSamplePath,
      bySymbol
    );

  console.log();

  const comparison =
    buildComparison(
      sampleRun,
      outOfSampleRun
    );

  const generatedAt =
    new Date().toISOString();

  const output = {
    generatedAt,

    experiment:
      "independent_60_market_portfolio_comparison",

    sampleDataset:
      samplePath,

    outOfSampleDataset:
      outOfSamplePath,

    totalMarkets:
      MAX_MARKETS_PER_GROUP * 2,

    sampleMarkets:
      MAX_MARKETS_PER_GROUP,

    outOfSampleMarkets:
      MAX_MARKETS_PER_GROUP,

    portfoliosRunIndependently:
      true,

    maxConcurrentPositionsPerPortfolio:
      MAX_CONCURRENT_POSITIONS,

    positionNotional:
      POSITION_NOTIONAL,

    feeRate:
      FEE_RATE,

    stopReturn:
      STOP_RETURN,

    targets:
      TARGETS,

    maxHoldMinutes:
      MAX_HOLD_MINUTES,

    slopeThreshold:
      SLOPE_THRESHOLD,

    accelerationThreshold:
      ACCELERATION_THRESHOLD,

    entrySignal:
      "slope20 <= threshold AND slope20 - slope50 >= acceleration threshold",

    entryPrice:
      "signal candle close",

    exitPriority:
      "chronological target/stop; stop wins on same candle",

    capacityPriority:
      [
        "higher acceleration",
        "more negative slope20",
        "lower Binance array position",
        "symbol ascending",
      ],

    capacityModel:
      "43-position cap is enforced independently within each 60-market dataset",

    exitBook:
      "min-heap ordered by actual final position exitTime",

    binance: {
      endpoint:
        "https://api.binance.com/api/v3/exchangeInfo",

      symbolCount:
        exchangeInfo.symbols.length,

      missingSymbols,
    },

    sample:
      sampleRun,

    outOfSample:
      outOfSampleRun,

    marketComparison:
      comparison,
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  const timestamp =
    Date.now();

  const jsonPath =
    path.join(
      OUTPUT_DIR,
      `market-strategy-ranking-independent-${timestamp}.json`
    );

  const csvPath =
    path.join(
      OUTPUT_DIR,
      `market-strategy-ranking-independent-${timestamp}.csv`
    );

  const comparisonCsvPath =
    path.join(
      OUTPUT_DIR,
      `market-strategy-comparison-independent-${timestamp}.csv`
    );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  const marketRows = [
    ...sampleRun.markets.map(
      flattenMarket
    ),
    ...outOfSampleRun.markets.map(
      flattenMarket
    ),
  ];

  writeCsv(
    csvPath,
    marketRows
  );

  const comparisonRows =
    comparison.map(
      (row) => ({
        Name:
          row.symbol,

        SampleNetProfit:
          row.sampleNetProfit,

        OutOfSampleNetProfit:
          row.outOfSampleNetProfit,

        NetProfitDifference:
          row.netProfitDifference,

        SampleReturnPct:
          row.sampleReturnPct,

        OutOfSampleReturnPct:
          row.outOfSampleReturnPct,

        ReturnDifference:
          row.returnDifference,

        SampleAccepted:
          row.sampleAccepted,

        OutOfSampleAccepted:
          row.outOfSampleAccepted,

        SampleWinRate:
          row.sampleWinRate,

        OutOfSampleWinRate:
          row.outOfSampleWinRate,

        SampleRejectedByCapacity:
          row.sampleRejectedByCapacity,

        OutOfSampleRejectedByCapacity:
          row.outOfSampleRejectedByCapacity,

        SampleBinanceArrayPosition:
          row.sampleBinanceArrayPosition,

        OutOfSampleBinanceArrayPosition:
          row.outOfSampleBinanceArrayPosition,
      })
    );

  writeCsv(
    comparisonCsvPath,
    comparisonRows
  );

  console.log(
    "============================================================"
  );
  console.log(
    "RESULTS"
  );
  console.log(
    "============================================================"
  );

  for (const run of [
    sampleRun,
    outOfSampleRun,
  ]) {
    const stats =
      run.groupStats;

    console.log();
    console.log(
      `${run.datasetGroup}`
    );

    console.log(
      `  Signals:       ${stats.totalSignals}`
    );

    console.log(
      `  Accepted:      ${stats.acceptedSignals}`
    );

    console.log(
      `  Rejected:      ${stats.rejectedByCapacity}`
    );

    console.log(
      `  Buys:          ${stats.buys}`
    );

    console.log(
      `  Sells:         ${stats.sells}`
    );

    console.log(
      `  Wins:          ${stats.winningPositions}`
    );

    console.log(
      `  Losses:        ${stats.losingPositions}`
    );

    console.log(
      `  Win rate:      ${(stats.winRate * 100).toFixed(2)}%`
    );

    console.log(
      `  Gross profit:  $${stats.grossProfit.toFixed(6)}`
    );

    console.log(
      `  Fees:          $${stats.fees.toFixed(6)}`
    );

    console.log(
      `  Net profit:    $${stats.netProfit.toFixed(6)}`
    );

    console.log(
      `  Return:        ${(stats.returnPct * 100).toFixed(4)}%`
    );

    console.log(
      `  Peak positions:${stats.peakOpenPositions}`
    );

    console.log(
      `  +1% exits:     ${stats.target1PctCount}`
    );

    console.log(
      `  +2% exits:     ${stats.target2PctCount}`
    );

    console.log(
      `  +4% exits:     ${stats.target4PctCount}`
    );

    console.log(
      `  Stops:         ${stats.stopCount}`
    );

    console.log(
      `  Max holds:     ${stats.maxHoldCount}`
    );

    console.log(
      `  End of data:   ${stats.endOfDataCount}`
    );
  }

  console.log();
  console.log(
    "Top 10 markets by combined independent net profit:"
  );

  comparison
    .slice(0, 10)
    .forEach(
      (row, index) => {
        console.log(
          `${String(index + 1).padStart(2, " ")} ` +
            `${row.symbol.padEnd(14, " ")}` +
            `Sample $${row.sampleNetProfit
              .toFixed(4)
              .padStart(9, " ")}` +
            ` | OOS $${row.outOfSampleNetProfit
              .toFixed(4)
              .padStart(9, " ")}` +
            ` | Δ $${row.netProfitDifference
              .toFixed(4)
              .padStart(9, " ")}`
        );
      }
    );

  console.log();
  console.log(
    `JSON:       ${jsonPath}`
  );

  console.log(
    `Market CSV: ${csvPath}`
  );

  console.log(
    `Compare CSV: ${comparisonCsvPath}`
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      error instanceof Error
        ? error.stack ??
            error.message
        : error
    );

    process.exit(1);
  }
);