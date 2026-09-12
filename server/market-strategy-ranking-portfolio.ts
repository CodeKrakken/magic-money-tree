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
  [key: string]: unknown;
}

interface Dataset {
  markets: MarketData[];
  [key: string]: unknown;
}

type DatasetKind = "Sample" | "OutOfSample";

interface PreparedMarket {
  symbol: string;
  candles: Candle[];
  signalIndices: number[];
  slope20: Float64Array;
  slope50: Float64Array;
  acceleration: Float64Array;
  dataset: DatasetKind;
  sourceFile: string;
  originalMarketIndex: number;
  binance: Record<string, unknown> | null;
  binanceArrayPosition: number | null;
}

interface SignalCandidate {
  market: PreparedMarket;
  candleIndex: number;
  time: number;
  slope20: number;
  acceleration: number;
}

interface Target {
  name: string;
  returnPct: number;
  fraction: number;
}

interface ExitEvent {
  index: number;
  type: "target" | "stop" | "max_hold";
  targetName?: string;
}

interface PositionSimulation {
  market: PreparedMarket;
  signalIndex: number;
  entryTime: number;
  entryPrice: number;

  entryNotional: number;
  entryFee: number;

  exitTime: number;
  exitIndex: number;

  grossProceeds: number;
  exitFees: number;
  netProceeds: number;

  netProfit: number;
  returnPct: number;

  holdMinutes: number;

  exitReason: "target_complete" | "stop" | "max_hold" | "end_of_data";

  targetHits: string[];
  sellTransactions: number;
}

interface MarketStats {
  symbol: string;
  dataset: DatasetKind;
  sourceFile: string;
  originalMarketIndex: number;
  binanceArrayPosition: number | null;

  signalCount: number;
  acceptedSignals: number;
  rejectedByCapacity: number;

  buys: number;
  sells: number;
  completedPositions: number;

  winningPositions: number;
  losingPositions: number;
  winRate: number;

  grossProfit: number;
  totalFees: number;
  netProfit: number;
  returnPct: number;

  averageNetProfit: number;
  medianNetProfit: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;
  maxHoldMinutes: number;

  target1PctCount: number;
  target2PctCount: number;
  target4PctCount: number;
  stopCount: number;
  maxHoldCount: number;
  endOfDataCount: number;

  sellTransactions: number;

  totalBuyNotional: number;
  totalSellNotional: number;

  binance: Record<string, unknown> | null;
}

interface ActivePosition {
  id: number;
  simulation: PositionSimulation;
}

interface GlobalStats {
  totalSignals: number;
  acceptedSignals: number;
  rejectedByCapacity: number;

  buys: number;
  sells: number;

  completedPositions: number;
  winningPositions: number;
  losingPositions: number;

  grossProfit: number;
  fees: number;
  netProfit: number;

  totalBuyNotional: number;
  totalSellNotional: number;

  target1PctCount: number;
  target2PctCount: number;
  target4PctCount: number;
  stopCount: number;
  maxHoldCount: number;
  endOfDataCount: number;

  peakOpenPositions: number;
}

const FEE_RATE = 0.001;
const POSITION_NOTIONAL = 10;
const MAX_CONCURRENT_POSITIONS = 43;
const MAX_HOLD_MINUTES = 48 * 60;

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

const SLOPE_THRESHOLD = -0.0001425851160546487;
const ACCELERATION_THRESHOLD = 0.00013986740450809692;

const MS_PER_MINUTE = 60_000;
const EPSILON = 1e-12;

const OUTPUT_DIR = path.join(
  process.cwd(),
  "server",
  "research-output"
);

function usage(): never {
  console.error(
    [
      "",
      "Usage:",
      "  npx tsx server/market-strategy-ranking-portfolio.ts <sample-file> <out-of-sample-file>",
      "",
      "Example:",
      "  npx tsx server/market-strategy-ranking-portfolio.ts \\",
      "    server/research-output/sample-60.json \\",
      "    server/research-output/out-of-sample-60.json",
      "",
    ].join("\n")
  );

  process.exit(1);
}

function resolveDatasetPath(input: string): string {
  const resolved = path.isAbsolute(input)
    ? input
    : path.resolve(process.cwd(), input);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Dataset file does not exist: ${resolved}`);
  }

  return resolved;
}

function loadDataset(filePath: string): Dataset {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Dataset;

  if (!parsed || !Array.isArray(parsed.markets)) {
    throw new Error(
      `Dataset ${filePath} does not contain a markets array`
    );
  }

  return parsed;
}

function validateMarket(
  market: MarketData,
  datasetName: DatasetKind,
  index: number
): void {
  if (!market || typeof market.symbol !== "string") {
    throw new Error(
      `${datasetName} market ${index} has no valid symbol`
    );
  }

  if (!Array.isArray(market.candles)) {
    throw new Error(
      `${datasetName} market ${market.symbol} has no candles array`
    );
  }

  if (market.candles.length === 0) {
    throw new Error(
      `${datasetName} market ${market.symbol} contains no candles`
    );
  }
}

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

  return (
    sorted[lower] * (1 - weight) +
    sorted[upper] * weight
  );
}

/**
 * O(n) rolling linear-regression slope using prefix sums.
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

    prefixY[i + 1] =
      prefixY[i] + close;

    prefixIndexY[i + 1] =
      prefixIndexY[i] + i * close;
  }

  const sumX =
    (windowSize * (windowSize - 1)) / 2;

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

function buildPreparedMarket(
  market: MarketData,
  dataset: DatasetKind,
  sourceFile: string,
  originalMarketIndex: number,
  binance: Record<string, unknown> | null,
  binanceArrayPosition: number | null
): PreparedMarket {
  const candles = market.candles;

  const closes = new Array<number>(
    candles.length
  );

  for (let i = 0; i < candles.length; i++) {
    closes[i] = candles[i].close;
  }

  const slope20 =
    buildRegressionSlopes(closes, 20);

  const slope50 =
    buildRegressionSlopes(closes, 50);

  const acceleration =
    new Float64Array(candles.length);

  const signalIndices: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    acceleration[i] =
      slope20[i] -
      slope50[i];

    if (
      i >= 49 &&
      slope20[i] <= SLOPE_THRESHOLD &&
      acceleration[i] >=
        ACCELERATION_THRESHOLD
    ) {
      signalIndices.push(i);
    }
  }

  return {
    symbol: market.symbol,
    candles,
    signalIndices,
    slope20,
    slope50,
    acceleration,
    dataset,
    sourceFile,
    originalMarketIndex,
    binance,
    binanceArrayPosition,
  };
}

/**
 * Segment tree used to find the first candle in a range where:
 *
 *   high >= target
 *
 * or
 *
 *   low <= stop
 *
 * The tree lets us avoid scanning every candle after every signal.
 */
class CandleRangeIndex {
  private readonly size: number;
  private readonly maxHigh: Float64Array;
  private readonly minLow: Float64Array;

  constructor(candles: Candle[]) {
    let size = 1;

    while (size < candles.length) {
      size *= 2;
    }

    this.size = size;

    this.maxHigh =
      new Float64Array(size * 2);

    this.minLow =
      new Float64Array(size * 2);

    this.maxHigh.fill(-Infinity);
    this.minLow.fill(Infinity);

    for (let i = 0; i < candles.length; i++) {
      this.maxHigh[size + i] =
        candles[i].high;

      this.minLow[size + i] =
        candles[i].low;
    }

    for (let i = size - 1; i > 0; i--) {
      this.maxHigh[i] =
        Math.max(
          this.maxHigh[i * 2],
          this.maxHigh[i * 2 + 1]
        );

      this.minLow[i] =
        Math.min(
          this.minLow[i * 2],
          this.minLow[i * 2 + 1]
        );
    }
  }

  findFirstHighAtLeast(
    from: number,
    to: number,
    target: number
  ): number {
    if (from > to) {
      return -1;
    }

    return this.findFirstHigh(
      1,
      0,
      this.size - 1,
      from,
      to,
      target
    );
  }

  findFirstLowAtMost(
    from: number,
    to: number,
    target: number
  ): number {
    if (from > to) {
      return -1;
    }

    return this.findFirstLow(
      1,
      0,
      this.size - 1,
      from,
      to,
      target
    );
  }

  private findFirstHigh(
    node: number,
    left: number,
    right: number,
    queryLeft: number,
    queryRight: number,
    target: number
  ): number {
    if (
      right < queryLeft ||
      left > queryRight ||
      this.maxHigh[node] < target
    ) {
      return -1;
    }

    if (left === right) {
      return left;
    }

    const middle =
      Math.floor((left + right) / 2);

    const leftResult =
      this.findFirstHigh(
        node * 2,
        left,
        middle,
        queryLeft,
        queryRight,
        target
      );

    if (leftResult !== -1) {
      return leftResult;
    }

    return this.findFirstHigh(
      node * 2 + 1,
      middle + 1,
      right,
      queryLeft,
      queryRight,
      target
    );
  }

  private findFirstLow(
    node: number,
    left: number,
    right: number,
    queryLeft: number,
    queryRight: number,
    target: number
  ): number {
    if (
      right < queryLeft ||
      left > queryRight ||
      this.minLow[node] > target
    ) {
      return -1;
    }

    if (left === right) {
      return left;
    }

    const middle =
      Math.floor((left + right) / 2);

    const leftResult =
      this.findFirstLow(
        node * 2,
        left,
        middle,
        queryLeft,
        queryRight,
        target
      );

    if (leftResult !== -1) {
      return leftResult;
    }

    return this.findFirstLow(
      node * 2 + 1,
      middle + 1,
      right,
      queryLeft,
      queryRight,
      target
    );
  }
}

function binarySearchFirstAtOrAfter(
  candles: Candle[],
  timestamp: number
): number {
  let low = 0;
  let high = candles.length - 1;
  let answer = candles.length;

  while (low <= high) {
    const middle =
      Math.floor((low + high) / 2);

    if (
      candles[middle].openTime >=
      timestamp
    ) {
      answer = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return answer;
}

function calculateMaxHoldIndex(
  candles: Candle[],
  signalIndex: number
): number {
  const targetTime =
    candles[signalIndex].openTime +
    MAX_HOLD_MINUTES *
      MS_PER_MINUTE;

  const index =
    binarySearchFirstAtOrAfter(
      candles,
      targetTime
    );

  if (
    index < candles.length &&
    candles[index].openTime === targetTime
  ) {
    return index;
  }

  return Math.min(
    candles.length - 1,
    index - 1
  );
}

/**
 * Simulate one accepted position.
 *
 * Entry is at the signal candle close.
 *
 * Exit priority:
 *   1. Targets and stop are evaluated chronologically.
 *   2. Stop wins if it occurs on the same candle as a target.
 *   3. Once stop occurs, no later targets are processed.
 *   4. If all target fractions are sold, the position is complete.
 *   5. Otherwise the remaining position is closed at 48h.
 */
function simulatePosition(
  market: PreparedMarket,
  signalIndex: number,
  rangeIndex: CandleRangeIndex
): PositionSimulation {
  const entryCandle =
    market.candles[signalIndex];

  const entryTime =
    entryCandle.openTime;

  const entryPrice =
    entryCandle.close;

  const entryNotional =
    POSITION_NOTIONAL;

  const entryFee =
    entryNotional * FEE_RATE;

  const quantity =
    entryNotional / entryPrice;

  const maxHoldIndex =
    calculateMaxHoldIndex(
      market.candles,
      signalIndex
    );

  const firstSearchIndex =
    signalIndex + 1;

  const lastSearchIndex =
    Math.max(
      firstSearchIndex,
      maxHoldIndex
    );

  const targetEvents: ExitEvent[] =
    [];

  for (const target of TARGETS) {
    const targetPrice =
      entryPrice *
      (1 + target.returnPct);

    const index =
      rangeIndex.findFirstHighAtLeast(
        firstSearchIndex,
        lastSearchIndex,
        targetPrice
      );

    if (index !== -1) {
      targetEvents.push({
        index,
        type: "target",
        targetName: target.name,
      });
    }
  }

  const stopPrice =
    entryPrice *
    (1 + STOP_RETURN);

  const stopIndex =
    rangeIndex.findFirstLowAtMost(
      firstSearchIndex,
      lastSearchIndex,
      stopPrice
    );

  const events: ExitEvent[] =
    [...targetEvents];

  if (stopIndex !== -1) {
    events.push({
      index: stopIndex,
      type: "stop",
    });
  }

  events.sort((a, b) => {
    if (a.index !== b.index) {
      return a.index - b.index;
    }

    /*
     * Stop has priority over a target
     * on the same candle.
     */
    if (a.type === b.type) {
      return 0;
    }

    return a.type === "stop" ? -1 : 1;
  });

  let remainingFraction = 1;
  let grossProceeds = 0;
  let exitFees = 0;
  let finalExitIndex = -1;
  let exitReason:
    | "target_complete"
    | "stop"
    | "max_hold"
    | "end_of_data" =
    "end_of_data";

  const targetHits: string[] = [];
  let sellTransactions = 0;

  for (const event of events) {
    if (remainingFraction <= EPSILON) {
      break;
    }

    if (
      event.type === "stop"
    ) {
      const candle =
        market.candles[event.index];

      const quantitySold =
        quantity *
        remainingFraction;

      const gross =
        quantitySold *
        candle.low;

      const fee =
        gross * FEE_RATE;

      grossProceeds += gross;
      exitFees += fee;

      remainingFraction = 0;
      finalExitIndex = event.index;
      exitReason = "stop";
      sellTransactions++;

      break;
    }

    const target =
      TARGETS.find(
        item =>
          item.name ===
          event.targetName
      );

    if (!target) {
      continue;
    }

    /*
     * A target after an already-triggered
     * stop is never processed because the
     * stop loop exits the simulation.
     */
    const candle =
      market.candles[event.index];

    const fractionSold =
      Math.min(
        target.fraction,
        remainingFraction
      );

    const quantitySold =
      quantity *
      fractionSold;

    const targetPrice =
      entryPrice *
      (1 + target.returnPct);

    const gross =
      quantitySold *
      targetPrice;

    const fee =
      gross * FEE_RATE;

    grossProceeds += gross;
    exitFees += fee;

    remainingFraction -=
      fractionSold;

    targetHits.push(
      target.name
    );

    finalExitIndex =
      event.index;

    sellTransactions++;

    if (
      remainingFraction <=
      EPSILON
    ) {
      exitReason =
        "target_complete";
      break;
    }
  }

  /*
   * If the stop did not close the position
   * and target exits did not sell everything,
   * close the remaining quantity at the
   * 48-hour candle close.
   */
  if (
    remainingFraction >
      EPSILON
  ) {
    const forcedIndex =
      Math.min(
        maxHoldIndex,
        market.candles.length - 1
      );

    const forcedCandle =
      market.candles[forcedIndex];

    const quantitySold =
      quantity *
      remainingFraction;

    const gross =
      quantitySold *
      forcedCandle.close;

    const fee =
      gross * FEE_RATE;

    grossProceeds += gross;
    exitFees += fee;

    remainingFraction = 0;
    finalExitIndex =
      forcedIndex;

    if (
      forcedIndex ===
      market.candles.length - 1 &&
      forcedCandle.openTime <
        entryTime +
          MAX_HOLD_MINUTES *
            MS_PER_MINUTE
    ) {
      exitReason =
        "end_of_data";
    } else {
      exitReason =
        "max_hold";
    }

    sellTransactions++;
  }

  const netProceeds =
    grossProceeds -
    exitFees;

  const netProfit =
    netProceeds -
    entryNotional -
    entryFee;

  const returnPct =
    netProfit /
    entryNotional;

  const exitTime =
    market.candles[finalExitIndex]
      .openTime;

  const holdMinutes =
    Math.max(
      0,
      (exitTime - entryTime) /
        MS_PER_MINUTE
    );

  return {
    market,
    signalIndex,
    entryTime,
    entryPrice,

    entryNotional,
    entryFee,

    exitTime,
    exitIndex: finalExitIndex,

    grossProceeds,
    exitFees,
    netProceeds,

    netProfit,
    returnPct,

    holdMinutes,

    exitReason,

    targetHits,
    sellTransactions,
  };
}

function createEmptyMarketStats(
  market: PreparedMarket
): MarketStats {
  return {
    symbol: market.symbol,
    dataset: market.dataset,
    sourceFile: market.sourceFile,
    originalMarketIndex:
      market.originalMarketIndex,
    binanceArrayPosition:
      market.binanceArrayPosition,

    signalCount:
      market.signalIndices.length,
    acceptedSignals: 0,
    rejectedByCapacity: 0,

    buys: 0,
    sells: 0,
    completedPositions: 0,

    winningPositions: 0,
    losingPositions: 0,
    winRate: 0,

    grossProfit: 0,
    totalFees: 0,
    netProfit: 0,
    returnPct: 0,

    averageNetProfit: 0,
    medianNetProfit: 0,

    averageHoldMinutes: 0,
    medianHoldMinutes: 0,
    maxHoldMinutes: 0,

    target1PctCount: 0,
    target2PctCount: 0,
    target4PctCount: 0,
    stopCount: 0,
    maxHoldCount: 0,
    endOfDataCount: 0,

    sellTransactions: 0,

    totalBuyNotional: 0,
    totalSellNotional: 0,

    binance: market.binance,
  };
}

function addPositionToMarketStats(
  stats: MarketStats,
  position: PositionSimulation
): void {
  stats.acceptedSignals++;
  stats.buys++;
  stats.sells +=
    position.sellTransactions;

  stats.completedPositions++;

  if (position.netProfit > 0) {
    stats.winningPositions++;
  } else if (
    position.netProfit < 0
  ) {
    stats.losingPositions++;
  }

  stats.grossProfit +=
    position.grossProceeds -
    position.entryNotional;

  stats.totalFees +=
    position.entryFee +
    position.exitFees;

  stats.netProfit +=
    position.netProfit;

  stats.totalBuyNotional +=
    position.entryNotional;

  stats.totalSellNotional +=
    position.grossProceeds;

  if (
    position.targetHits.includes(
      "target_1pct"
    )
  ) {
    stats.target1PctCount++;
  }

  if (
    position.targetHits.includes(
      "target_2pct"
    )
  ) {
    stats.target2PctCount++;
  }

  if (
    position.targetHits.includes(
      "target_4pct"
    )
  ) {
    stats.target4PctCount++;
  }

  if (
    position.exitReason ===
    "stop"
  ) {
    stats.stopCount++;
  }

  if (
    position.exitReason ===
    "max_hold"
  ) {
    stats.maxHoldCount++;
  }

  if (
    position.exitReason ===
    "end_of_data"
  ) {
    stats.endOfDataCount++;
  }
}

function finaliseMarketStats(
  stats: MarketStats,
  positions: PositionSimulation[]
): void {
  const profits =
    positions.map(
      position => position.netProfit
    );

  const holds =
    positions.map(
      position => position.holdMinutes
    );

  if (stats.completedPositions > 0) {
    stats.winRate =
      stats.winningPositions /
      stats.completedPositions;

    stats.averageNetProfit =
      stats.netProfit /
      stats.completedPositions;

    stats.averageHoldMinutes =
      holds.reduce(
        (sum, value) => sum + value,
        0
      ) /
      holds.length;

    stats.medianNetProfit =
      percentile(profits, 0.5);

    stats.medianHoldMinutes =
      percentile(holds, 0.5);

    stats.maxHoldMinutes =
      Math.max(...holds);

    stats.returnPct =
      stats.netProfit /
      stats.totalBuyNotional;
  }
}

function flattenObject(
  value: unknown,
  prefix = "",
  output: Record<string, unknown> = {}
): Record<string, unknown> {
  if (
    value === null ||
    value === undefined
  ) {
    if (prefix) {
      output[prefix] = value;
    }

    return output;
  }

  if (
    typeof value !== "object"
  ) {
    if (prefix) {
      output[prefix] = value;
    }

    return output;
  }

  if (Array.isArray(value)) {
    output[prefix] =
      JSON.stringify(value);
    return output;
  }

  for (
    const [key, child] of Object.entries(
      value as Record<string, unknown>
    )
  ) {
    const nextPrefix =
      prefix
        ? `${prefix}.${key}`
        : key;

    flattenObject(
      child,
      nextPrefix,
      output
    );
  }

  return output;
}

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
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(
      /"/g,
      '""'
    )}"`;
  }

  return text;
}

function buildCsv(
  stats: MarketStats[]
): string {
  const rows =
    stats.map(stat => {
      const flatBinance =
        flattenObject(
          stat.binance ?? {},
          "binance"
        );

      return {
        symbol: stat.symbol,
        dataset: stat.dataset,
        sourceFile: stat.sourceFile,
        originalMarketIndex:
          stat.originalMarketIndex,
        binanceArrayPosition:
          stat.binanceArrayPosition,

        signalCount:
          stat.signalCount,
        acceptedSignals:
          stat.acceptedSignals,
        rejectedByCapacity:
          stat.rejectedByCapacity,

        buys: stat.buys,
        sells: stat.sells,
        completedPositions:
          stat.completedPositions,

        winningPositions:
          stat.winningPositions,
        losingPositions:
          stat.losingPositions,
        winRate: stat.winRate,

        grossProfit:
          stat.grossProfit,
        totalFees:
          stat.totalFees,
        netProfit:
          stat.netProfit,
        returnPct:
          stat.returnPct,

        averageNetProfit:
          stat.averageNetProfit,
        medianNetProfit:
          stat.medianNetProfit,

        averageHoldMinutes:
          stat.averageHoldMinutes,
        medianHoldMinutes:
          stat.medianHoldMinutes,
        maxHoldMinutes:
          stat.maxHoldMinutes,

        target1PctCount:
          stat.target1PctCount,
        target2PctCount:
          stat.target2PctCount,
        target4PctCount:
          stat.target4PctCount,
        stopCount:
          stat.stopCount,
        maxHoldCount:
          stat.maxHoldCount,
        endOfDataCount:
          stat.endOfDataCount,

        sellTransactions:
          stat.sellTransactions,

        totalBuyNotional:
          stat.totalBuyNotional,
        totalSellNotional:
          stat.totalSellNotional,

        ...flatBinance,
      };
    });

  const columnSet =
    new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }

  const columns =
    Array.from(columnSet);

  const lines: string[] = [];

  lines.push(
    columns
      .map(csvEscape)
      .join(",")
  );

  for (const row of rows) {
    lines.push(
      columns
        .map(column =>
          csvEscape(
            row[column as keyof typeof row]
          )
        )
        .join(",")
    );
  }

  return lines.join("\n");
}

async function fetchBinanceExchangeInfo(): Promise<{
  symbols: Array<Record<string, unknown>>;
  source: string;
}> {
  const urls = [
    "https://api.binance.com/api/v3/exchangeInfo",
    "https://data-api.binance.vision/api/v3/exchangeInfo",
  ];

  let lastError: unknown = null;

  for (const url of urls) {
    try {
      console.log(
        `Fetching Binance exchangeInfo: ${url}`
      );

      const response =
        await fetch(url);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`
        );
      }

      const data =
        (await response.json()) as {
          symbols?: Array<
            Record<string, unknown>
          >;
        };

      if (
        !data.symbols ||
        !Array.isArray(data.symbols)
      ) {
        throw new Error(
          "Binance response contains no symbols array"
        );
      }

      return {
        symbols: data.symbols,
        source: url,
      };
    } catch (error) {
      lastError = error;
      console.warn(
        `Binance request failed: ${String(
          error
        )}`
      );
    }
  }

  throw new Error(
    `Unable to fetch Binance exchangeInfo: ${String(
      lastError
    )}`
  );
}

function buildBinanceLookup(
  exchangeInfo: Array<
    Record<string, unknown>
  >
): Map<
  string,
  {
    symbol: Record<string, unknown>;
    position: number;
  }
> {
  const lookup =
    new Map<
      string,
      {
        symbol: Record<string, unknown>;
        position: number;
      }
    >();

  for (
    let i = 0;
    i < exchangeInfo.length;
    i++
  ) {
    const symbol =
      exchangeInfo[i];

    const name =
      typeof symbol.symbol ===
      "string"
        ? symbol.symbol
        : null;

    if (name) {
      lookup.set(name, {
        symbol,
        position: i,
      });
    }
  }

  return lookup;
}

function createGlobalStats(): GlobalStats {
  return {
    totalSignals: 0,
    acceptedSignals: 0,
    rejectedByCapacity: 0,

    buys: 0,
    sells: 0,

    completedPositions: 0,
    winningPositions: 0,
    losingPositions: 0,

    grossProfit: 0,
    fees: 0,
    netProfit: 0,

    totalBuyNotional: 0,
    totalSellNotional: 0,

    target1PctCount: 0,
    target2PctCount: 0,
    target4PctCount: 0,
    stopCount: 0,
    maxHoldCount: 0,
    endOfDataCount: 0,

    peakOpenPositions: 0,
  };
}

function updateGlobalStats(
  stats: GlobalStats,
  position: PositionSimulation
): void {
  stats.acceptedSignals++;
  stats.buys++;
  stats.sells +=
    position.sellTransactions;

  stats.completedPositions++;

  if (position.netProfit > 0) {
    stats.winningPositions++;
  } else if (
    position.netProfit < 0
  ) {
    stats.losingPositions++;
  }

  stats.grossProfit +=
    position.grossProceeds -
    position.entryNotional;

  stats.fees +=
    position.entryFee +
    position.exitFees;

  stats.netProfit +=
    position.netProfit;

  stats.totalBuyNotional +=
    position.entryNotional;

  stats.totalSellNotional +=
    position.grossProceeds;

  if (
    position.targetHits.includes(
      "target_1pct"
    )
  ) {
    stats.target1PctCount++;
  }

  if (
    position.targetHits.includes(
      "target_2pct"
    )
  ) {
    stats.target2PctCount++;
  }

  if (
    position.targetHits.includes(
      "target_4pct"
    )
  ) {
    stats.target4PctCount++;
  }

  if (
    position.exitReason ===
    "stop"
  ) {
    stats.stopCount++;
  }

  if (
    position.exitReason ===
    "max_hold"
  ) {
    stats.maxHoldCount++;
  }

  if (
    position.exitReason ===
    "end_of_data"
  ) {
    stats.endOfDataCount++;
  }
}

/**
 * Main global portfolio simulation.
 *
 * Signals from all 120 markets are merged by
 * timestamp. Exits are processed before entries.
 *
 * When more than 43 signals compete at exactly
 * the same timestamp, priority is:
 *
 *   1. higher acceleration
 *   2. more negative slope20
 *   3. lower Binance array position
 *   4. deterministic symbol tie-break
 */
function runPortfolio(
  markets: PreparedMarket[]
): {
  marketStats: MarketStats[];
  globalStats: GlobalStats;
} {
  const statsBySymbol =
    new Map<string, MarketStats>();

  const positionsBySymbol =
    new Map<
      string,
      PositionSimulation[]
    >();

  for (const market of markets) {
    statsBySymbol.set(
      market.symbol,
      createEmptyMarketStats(
        market
      )
    );

    positionsBySymbol.set(
      market.symbol,
      []
    );
  }

  const rangeIndexes =
    new Map<
      string,
      CandleRangeIndex
    >();

  for (const market of markets) {
    rangeIndexes.set(
      market.symbol,
      new CandleRangeIndex(
        market.candles
      )
    );
  }

  const candidates: SignalCandidate[] =
    [];

  for (const market of markets) {
    for (
      const candleIndex of
        market.signalIndices
    ) {
      candidates.push({
        market,
        candleIndex,
        time:
          market.candles[
            candleIndex
          ].openTime,
        slope20:
          market.slope20[
            candleIndex
          ],
        acceleration:
          market.acceleration[
            candleIndex
          ],
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }

    if (
      a.acceleration !==
      b.acceleration
    ) {
      return (
        b.acceleration -
        a.acceleration
      );
    }

    if (
      a.slope20 !==
      b.slope20
    ) {
      return (
        a.slope20 -
        b.slope20
      );
    }

    const aPosition =
      a.market
        .binanceArrayPosition ??
      Number.MAX_SAFE_INTEGER;

    const bPosition =
      b.market
        .binanceArrayPosition ??
      Number.MAX_SAFE_INTEGER;

    if (
      aPosition !==
      bPosition
    ) {
      return (
        aPosition -
        bPosition
      );
    }

    return a.market.symbol.localeCompare(
      b.market.symbol
    );
  });

  const globalStats =
    createGlobalStats();

  const activePositions =
    new Map<
      number,
      ActivePosition
    >();

  /*
   * Every accepted position has an exit
   * timestamp. We maintain an array of
   * accepted positions and remove positions
   * whose exit time has passed.
   *
   * Since candidates are chronological,
   * active exits can be processed with a
   * pointer into a separately sorted list.
   */
  const acceptedPositions:
    Array<{
      id: number;
      simulation: PositionSimulation;
    }> = [];

  let exitPointer = 0;
  let nextPositionId = 1;

  /*
   * Candidates at the same timestamp must
   * compete for capacity as one group.
   */
  let candidateIndex = 0;

  while (
    candidateIndex <
    candidates.length
  ) {
    const timestamp =
      candidates[
        candidateIndex
      ].time;

    /*
     * Remove all positions that have already
     * exited by this timestamp.
     *
     * Exit-before-entry semantics are deliberate.
     */
    while (
      exitPointer <
      acceptedPositions.length &&
      acceptedPositions[
        exitPointer
      ].simulation.exitTime <=
        timestamp
    ) {
      const position =
        acceptedPositions[
          exitPointer
        ];

      activePositions.delete(
        position.id
      );

      exitPointer++;
    }

    const groupStart =
      candidateIndex;

    while (
      candidateIndex <
        candidates.length &&
      candidates[
        candidateIndex
      ].time === timestamp
    ) {
      candidateIndex++;
    }

    const group =
      candidates.slice(
        groupStart,
        candidateIndex
      );

    globalStats.totalSignals +=
      group.length;

    /*
     * Re-sort the same-timestamp group by
     * admission priority. This is the actual
     * capacity decision.
     */
    group.sort((a, b) => {
      if (
        a.acceleration !==
        b.acceleration
      ) {
        return (
          b.acceleration -
          a.acceleration
        );
      }

      if (
        a.slope20 !==
        b.slope20
      ) {
        return (
          a.slope20 -
          b.slope20
        );
      }

      const aPosition =
        a.market
          .binanceArrayPosition ??
        Number.MAX_SAFE_INTEGER;

      const bPosition =
        b.market
          .binanceArrayPosition ??
        Number.MAX_SAFE_INTEGER;

      if (
        aPosition !==
        bPosition
      ) {
        return (
          aPosition -
          bPosition
        );
      }

      return a.market.symbol.localeCompare(
        b.market.symbol
      );
    });

    for (const candidate of group) {
      const marketStats =
        statsBySymbol.get(
          candidate.market.symbol
        )!;

      /*
       * The 43-position limit is global across
       * Sample + OutOfSample + all markets.
       */
      if (
        activePositions.size >=
        MAX_CONCURRENT_POSITIONS
      ) {
        marketStats.rejectedByCapacity++;
        globalStats.rejectedByCapacity++;
        continue;
      }

      const rangeIndex =
        rangeIndexes.get(
          candidate.market.symbol
        )!;

      const simulation =
        simulatePosition(
          candidate.market,
          candidate.candleIndex,
          rangeIndex
        );

      const id =
        nextPositionId++;

      const active = {
        id,
        simulation,
      };

      activePositions.set(
        id,
        active
      );

      acceptedPositions.push(
        active
      );

      addPositionToMarketStats(
        marketStats,
        simulation
      );

      updateGlobalStats(
        globalStats,
        simulation
      );

      globalStats.peakOpenPositions =
        Math.max(
          globalStats.peakOpenPositions,
          activePositions.size
        );

      const positions =
        positionsBySymbol.get(
          candidate.market.symbol
        )!;

      positions.push(
        simulation
      );
    }
  }

  /*
   * All positions have already been simulated,
   * so finalise per-market statistics.
   */
  for (const market of markets) {
    const stats =
      statsBySymbol.get(
        market.symbol
      )!;

    const positions =
      positionsBySymbol.get(
        market.symbol
      )!;

    finaliseMarketStats(
      stats,
      positions
    );
  }

  const marketStats =
    Array.from(
      statsBySymbol.values()
    );

  /*
   * Net profitability is the requested primary
   * ranking criterion.
   */
  marketStats.sort((a, b) => {
    if (
      Math.abs(
        b.netProfit -
          a.netProfit
      ) > EPSILON
    ) {
      return (
        b.netProfit -
        a.netProfit
      );
    }

    return (
      b.returnPct -
      a.returnPct
    );
  });

  return {
    marketStats,
    globalStats,
  };
}

function round(
  value: number,
  decimals = 8
): number {
  const multiplier =
    10 ** decimals;

  return (
    Math.round(
      value * multiplier
    ) / multiplier
  );
}

function serialiseMarketStats(
  stats: MarketStats[]
): Record<string, unknown>[] {
  return stats.map(
    stat => ({
      ...stat,

      grossProfit:
        round(
          stat.grossProfit
        ),
      totalFees:
        round(
          stat.totalFees
        ),
      netProfit:
        round(
          stat.netProfit
        ),
      returnPct:
        round(
          stat.returnPct,
          6
        ),

      averageNetProfit:
        round(
          stat.averageNetProfit
        ),
      medianNetProfit:
        round(
          stat.medianNetProfit
        ),

      averageHoldMinutes:
        round(
          stat.averageHoldMinutes,
          3
        ),
      medianHoldMinutes:
        round(
          stat.medianHoldMinutes,
          3
        ),
      maxHoldMinutes:
        round(
          stat.maxHoldMinutes,
          3
        ),

      totalBuyNotional:
        round(
          stat.totalBuyNotional
        ),
      totalSellNotional:
        round(
          stat.totalSellNotional
        ),
    })
  );
}

async function main(): Promise<void> {
  console.log(
    "============================================================"
  );
  console.log(
    "Market strategy ranking — global 43-position portfolio"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  const args =
    process.argv.slice(2);

  if (args.length !== 2) {
    usage();
  }

  const samplePath =
    resolveDatasetPath(
      args[0]
    );

  const outOfSamplePath =
    resolveDatasetPath(
      args[1]
    );

  console.log(
    `Sample dataset:      ${samplePath}`
  );

  console.log(
    `Out-of-sample data:  ${outOfSamplePath}`
  );

  console.log("");

  const sampleDataset =
    loadDataset(samplePath);

  const outOfSampleDataset =
    loadDataset(
      outOfSamplePath
    );

  if (
    sampleDataset.markets.length !==
    60
  ) {
    throw new Error(
      `Expected exactly 60 Sample markets, found ${sampleDataset.markets.length}`
    );
  }

  if (
    outOfSampleDataset.markets.length !==
    60
  ) {
    throw new Error(
      `Expected exactly 60 OutOfSample markets, found ${outOfSampleDataset.markets.length}`
    );
  }

  for (
    let i = 0;
    i < sampleDataset.markets.length;
    i++
  ) {
    validateMarket(
      sampleDataset.markets[i],
      "Sample",
      i
    );
  }

  for (
    let i = 0;
    i <
      outOfSampleDataset.markets.length;
    i++
  ) {
    validateMarket(
      outOfSampleDataset.markets[i],
      "OutOfSample",
      i
    );
  }

  const allMarkets =
    [
      ...sampleDataset.markets.map(
        (market, index) => ({
          market,
          dataset:
            "Sample" as const,
          sourceFile:
            samplePath,
          originalMarketIndex:
            index,
        })
      ),

      ...outOfSampleDataset.markets.map(
        (market, index) => ({
          market,
          dataset:
            "OutOfSample" as const,
          sourceFile:
            outOfSamplePath,
          originalMarketIndex:
            index,
        })
      ),
    ];

  /*
   * Avoid accidentally allowing the same symbol
   * to appear twice. The portfolio treats symbols
   * as unique instruments.
   */
  const seenSymbols =
    new Set<string>();

  for (const item of allMarkets) {
    if (
      seenSymbols.has(
        item.market.symbol
      )
    ) {
      throw new Error(
        `Duplicate market symbol across datasets: ${item.market.symbol}`
      );
    }

    seenSymbols.add(
      item.market.symbol
    );
  }

  console.log(
    `Validated ${allMarkets.length} markets`
  );

  console.log(
    `  Sample:      ${sampleDataset.markets.length}`
  );

  console.log(
    `  OutOfSample: ${outOfSampleDataset.markets.length}`
  );

  console.log("");

  const exchangeInfo =
    await fetchBinanceExchangeInfo();

  const binanceLookup =
    buildBinanceLookup(
      exchangeInfo.symbols
    );

  console.log(
    `Binance symbols received: ${exchangeInfo.symbols.length}`
  );

  console.log(
    `Binance source: ${exchangeInfo.source}`
  );

  console.log("");

  const preparedMarkets:
    PreparedMarket[] = [];

  let missingBinanceSymbols =
    0;

  for (
    let i = 0;
    i < allMarkets.length;
    i++
  ) {
    const item =
      allMarkets[i];

    const lookup =
      binanceLookup.get(
        item.market.symbol
      );

    if (!lookup) {
      missingBinanceSymbols++;
    }

    const prepared =
      buildPreparedMarket(
        item.market,
        item.dataset,
        item.sourceFile,
        item.originalMarketIndex,
        lookup?.symbol ?? null,
        lookup?.position ?? null
      );

    preparedMarkets.push(
      prepared
    );

    if (
      (i + 1) % 10 === 0 ||
      i ===
        allMarkets.length - 1
    ) {
      console.log(
        `Prepared ${i + 1}/${allMarkets.length} markets`
      );
    }
  }

  console.log("");

  if (
    missingBinanceSymbols > 0
  ) {
    console.warn(
      `Warning: ${missingBinanceSymbols} dataset markets were not present in Binance exchangeInfo`
    );
  }

  const totalSignals =
    preparedMarkets.reduce(
      (sum, market) =>
        sum +
        market.signalIndices.length,
      0
    );

  console.log(
    `Total signals before portfolio capacity: ${totalSignals}`
  );

  console.log(
    `Maximum concurrent positions: ${MAX_CONCURRENT_POSITIONS}`
  );

  console.log(
    `Position size: $${POSITION_NOTIONAL.toFixed(
      2
    )}`
  );

  console.log(
    `Fee rate: ${(FEE_RATE * 100).toFixed(
      3
    )}% per side`
  );

  console.log(
    `Stop: ${(STOP_RETURN * 100).toFixed(
      1
    )}%`
  );

  console.log(
    "Targets: +1% (50%), +2% (25%), +4% (25%)"
  );

  console.log(
    `Maximum hold: ${MAX_HOLD_MINUTES / 60} hours`
  );

  console.log("");

  console.log(
    "Running global portfolio simulation..."
  );

  const result =
    runPortfolio(
      preparedMarkets
    );

  console.log(
    "Portfolio simulation complete."
  );

  console.log("");

  const timestamp =
    Date.now();

  const jsonPath =
    path.join(
      OUTPUT_DIR,
      `market-strategy-ranking-portfolio-${timestamp}.json`
    );

  const csvPath =
    path.join(
      OUTPUT_DIR,
      `market-strategy-ranking-portfolio-${timestamp}.csv`
    );

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  const serialisedStats =
    serialiseMarketStats(
      result.marketStats
    );

  const global =
    result.globalStats;

  const output = {
    generatedAt:
      new Date(timestamp).toISOString(),

    configuration: {
      sampleDataset:
        samplePath,
      outOfSampleDataset:
        outOfSamplePath,

      totalMarkets:
        preparedMarkets.length,
      sampleMarkets:
        sampleDataset.markets.length,
      outOfSampleMarkets:
        outOfSampleDataset.markets.length,

      maximumConcurrentPositions:
        MAX_CONCURRENT_POSITIONS,

      positionNotional:
        POSITION_NOTIONAL,

      feeRate:
        FEE_RATE,

      stopReturn:
        STOP_RETURN,

      targets:
        TARGETS,

      maximumHoldMinutes:
        MAX_HOLD_MINUTES,

      slopeThreshold:
        SLOPE_THRESHOLD,

      accelerationThreshold:
        ACCELERATION_THRESHOLD,

      entryPrice:
        "signal candle close",

      exitPriority:
        "chronological target/stop events; stop wins on same candle",

      capacityPriority: [
        "higher acceleration",
        "more negative slope20",
        "lower Binance array position",
        "symbol ascending",
      ],
    },

    binance: {
      exchangeInfoSource:
        exchangeInfo.source,
      symbolCount:
        exchangeInfo.symbols.length,
      missingSymbols:
        missingBinanceSymbols,
    },

    global: {
      totalSignals:
        global.totalSignals,

      acceptedSignals:
        global.acceptedSignals,

      rejectedByCapacity:
        global.rejectedByCapacity,

      buys:
        global.buys,

      sells:
        global.sells,

      completedPositions:
        global.completedPositions,

      winningPositions:
        global.winningPositions,

      losingPositions:
        global.losingPositions,

      winRate:
        global.completedPositions > 0
          ? global.winningPositions /
            global.completedPositions
          : 0,

      grossProfit:
        round(
          global.grossProfit
        ),

      fees:
        round(
          global.fees
        ),

      netProfit:
        round(
          global.netProfit
        ),

      returnPct:
        global.totalBuyNotional > 0
          ? round(
              global.netProfit /
                global.totalBuyNotional,
              6
            )
          : 0,

      totalBuyNotional:
        round(
          global.totalBuyNotional
        ),

      totalSellNotional:
        round(
          global.totalSellNotional
        ),

      target1PctCount:
        global.target1PctCount,

      target2PctCount:
        global.target2PctCount,

      target4PctCount:
        global.target4PctCount,

      stopCount:
        global.stopCount,

      maxHoldCount:
        global.maxHoldCount,

      endOfDataCount:
        global.endOfDataCount,

      peakOpenPositions:
        global.peakOpenPositions,
    },

    ranking: serialisedStats,
  };

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  fs.writeFileSync(
    csvPath,
    buildCsv(
      result.marketStats
    )
  );

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "RESULT"
  );
  console.log(
    "============================================================"
  );

  console.log(
    `Signals:          ${global.totalSignals}`
  );

  console.log(
    `Accepted:         ${global.acceptedSignals}`
  );

  console.log(
    `Rejected capacity:${global.rejectedByCapacity}`
  );

  console.log(
    `Buys:             ${global.buys}`
  );

  console.log(
    `Sells:            ${global.sells}`
  );

  console.log(
    `Peak positions:   ${global.peakOpenPositions}`
  );

  console.log(
    `Gross profit:     $${round(
      global.grossProfit,
      4
    ).toFixed(4)}`
  );

  console.log(
    `Fees:             $${round(
      global.fees,
      4
    ).toFixed(4)}`
  );

  console.log(
    `Net profit:       $${round(
      global.netProfit,
      4
    ).toFixed(4)}`
  );

  console.log(
    `Return on buys:   ${(
      global.totalBuyNotional > 0
        ? (global.netProfit /
            global.totalBuyNotional) *
          100
        : 0
    ).toFixed(4)}%`
  );

  console.log("");

  console.log(
    "Top 10 markets by net profitability:"
  );

  console.log("");

  console.log(
    [
      "Rank".padStart(4),
      "Symbol".padEnd(14),
      "Set".padEnd(13),
      "Binance".padStart(8),
      "Accepted".padStart(9),
      "Rejected".padStart(9),
      "Wins".padStart(6),
      "Losses".padStart(7),
      "Net".padStart(12),
      "Return".padStart(10),
    ].join(" ")
  );

  for (
    let i = 0;
    i <
      Math.min(
        10,
        result.marketStats.length
      );
    i++
  ) {
    const stat =
      result.marketStats[i];

    console.log(
      [
        String(i + 1).padStart(4),
        stat.symbol.padEnd(14),
        stat.dataset.padEnd(13),
        String(
          stat.binanceArrayPosition ??
            "-"
        ).padStart(8),
        String(
          stat.acceptedSignals
        ).padStart(9),
        String(
          stat.rejectedByCapacity
        ).padStart(9),
        String(
          stat.winningPositions
        ).padStart(6),
        String(
          stat.losingPositions
        ).padStart(7),
        `$${stat.netProfit.toFixed(
          4
        )}`.padStart(12),
        `${(
          stat.returnPct * 100
        ).toFixed(2)}%`.padStart(10),
      ].join(" ")
    );
  }

  console.log("");

  console.log(
    `JSON: ${jsonPath}`
  );

  console.log(
    `CSV:  ${csvPath}`
  );

  console.log("");
}

main().catch(error => {
  console.error("");
  console.error(
    "Fatal error:"
  );
  console.error(error);
  process.exit(1);
});