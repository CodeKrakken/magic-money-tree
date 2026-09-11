import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SOURCE_FILE = "ema-data-1789061547934.json";

const SOURCE_PATH =
  process.argv[2] ??
  path.join(__dirname, "research-output", DEFAULT_SOURCE_FILE);

// Frozen entry signal from the previous research.
const SLOPE20_THRESHOLD = -0.0001425851160546487;
const ACCELERATION_THRESHOLD = 0.00013986740450809692;

// Exit parameters to test.
const PROFIT_TARGET = 0.002;

const STOP_LOSSES = [
  0.0025,
  0.005,
  0.0075,
  0.01,
  0.015,
  0.02,
  0.03,
];

// Trading costs.
const FEE_RATE = 0.002;
const EXECUTION_COST = 0;
const TOTAL_COST = FEE_RATE + EXECUTION_COST;

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

interface Features {
  slope20: number;
  slope50: number;
  acceleration: number;
}

interface Trade {
  symbol: string;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  holdMinutes: number;
  exitReason: "profit" | "stop" | "end_of_data";
}

interface Summary {
  trades: number;
  winning: number;
  losing: number;
  endOfData: number;
  winRate: number;
  averageNetReturn: number;
  medianNetReturn: number;
  totalNetReturn: number;
  compoundedReturn: number;
  profitFactor: number;
  maxDrawdown: number;
  averageHoldMinutes: number;
  medianHoldMinutes: number;
  exits: {
    profit: number;
    stop: number;
    endOfData: number;
  };
}

interface StopResult {
  stopLoss: number;
  stopLossPercent: number;
  summary: Summary;
}

interface MarketResult {
  symbol: string;
  signals: number;
  results: StopResult[];
}

interface Output {
  generatedAt: string;
  sourceFile: string;
  markets: number;
  observationsExamined: number;

  entryRule: {
    slope20LessThanOrEqual: number;
    accelerationGreaterThanOrEqual: number;
  };

  exitRule: {
    profitTarget: number;
    profitTargetPercent: number;
    stopLosses: number[];
    maxHoldMinutes: null;
  };

  costs: {
    feeRate: number;
    executionCost: number;
    totalCost: number;
  };

  overall: StopResult[];

  byMarket: MarketResult[];
}

function calculateSlope(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const n = values.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = values[i];

    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  return (n * sumXY - sumX * sumY) / denominator;
}

function calculateFeatures(candles: Candle[], index: number): Features | null {
  if (index < 50) {
    return null;
  }

  const closes20 = candles
    .slice(index - 19, index + 1)
    .map((candle) => candle.close);

  const closes50 = candles
    .slice(index - 49, index + 1)
    .map((candle) => candle.close);

  const slope20 = calculateSlope(closes20);
  const slope50 = calculateSlope(closes50);

  return {
    slope20,
    slope50,
    acceleration: slope20 - slope50,
  };
}

function isSignal(features: Features): boolean {
  return (
    features.slope20 <= SLOPE20_THRESHOLD &&
    features.acceleration >= ACCELERATION_THRESHOLD
  );
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function calculateMaxDrawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (const returnValue of returns) {
    equity *= 1 + returnValue;

    if (equity > peak) {
      peak = equity;
    }

    if (peak > 0) {
      const drawdown = (peak - equity) / peak;

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  return maxDrawdown;
}

function createTrade(
  symbol: string,
  candles: Candle[],
  entryIndex: number,
  stopLoss: number,
): Trade {
  const entry = candles[entryIndex];
  const entryPrice = entry.close;

  const profitPrice = entryPrice * (1 + PROFIT_TARGET);
  const stopPrice = entryPrice * (1 - stopLoss);

  for (let index = entryIndex + 1; index < candles.length; index += 1) {
    const candle = candles[index];

    const hitProfit = candle.high >= profitPrice;
    const hitStop = candle.low <= stopPrice;

    /*
     * If both are touched on the same candle, assume the stop happened
     * first. We do not know the intrabar order, so this is conservative.
     */
    if (hitStop) {
      const grossReturn = -stopLoss;
      const netReturn = grossReturn - TOTAL_COST;

      return {
        symbol,
        entryIndex,
        entryTime: entry.openTime,
        entryPrice,
        exitIndex: index,
        exitTime: candle.openTime,
        exitPrice: stopPrice,
        grossReturn,
        netReturn,
        holdMinutes: index - entryIndex,
        exitReason: "stop",
      };
    }

    if (hitProfit) {
      const grossReturn = PROFIT_TARGET;
      const netReturn = grossReturn - TOTAL_COST;

      return {
        symbol,
        entryIndex,
        entryTime: entry.openTime,
        entryPrice,
        exitIndex: index,
        exitTime: candle.openTime,
        exitPrice: profitPrice,
        grossReturn,
        netReturn,
        holdMinutes: index - entryIndex,
        exitReason: "profit",
      };
    }
  }

  // Neither boundary was reached before the end of the available data.
  const finalCandle = candles[candles.length - 1];

  const grossReturn = finalCandle.close / entryPrice - 1;
  const netReturn = grossReturn - TOTAL_COST;

  return {
    symbol,
    entryIndex,
    entryTime: entry.openTime,
    entryPrice,
    exitIndex: candles.length - 1,
    exitTime: finalCandle.openTime,
    exitPrice: finalCandle.close,
    grossReturn,
    netReturn,
    holdMinutes: candles.length - 1 - entryIndex,
    exitReason: "end_of_data",
  };
}

function summariseTrades(trades: Trade[]): Summary {
  if (trades.length === 0) {
    return {
      trades: 0,
      winning: 0,
      losing: 0,
      endOfData: 0,
      winRate: 0,
      averageNetReturn: 0,
      medianNetReturn: 0,
      totalNetReturn: 0,
      compoundedReturn: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      averageHoldMinutes: 0,
      medianHoldMinutes: 0,
      exits: {
        profit: 0,
        stop: 0,
        endOfData: 0,
      },
    };
  }

  const netReturns = trades.map((trade) => trade.netReturn);
  const holdTimes = trades.map((trade) => trade.holdMinutes);

  const winning = trades.filter((trade) => trade.netReturn > 0);
  const losing = trades.filter((trade) => trade.netReturn < 0);
  const endOfData = trades.filter(
    (trade) => trade.exitReason === "end_of_data",
  );

  const grossProfit = winning.reduce(
    (sum, trade) => sum + trade.netReturn,
    0,
  );

  const grossLoss = losing.reduce(
    (sum, trade) => sum + Math.abs(trade.netReturn),
    0,
  );

  let compoundedEquity = 1;

  for (const netReturn of netReturns) {
    compoundedEquity *= 1 + netReturn;
  }

  return {
    trades: trades.length,
    winning: winning.length,
    losing: losing.length,
    endOfData: endOfData.length,
    winRate: winning.length / trades.length,
    averageNetReturn:
      netReturns.reduce((sum, value) => sum + value, 0) / trades.length,
    medianNetReturn: median(netReturns),
    totalNetReturn: netReturns.reduce((sum, value) => sum + value, 0),
    compoundedReturn: compoundedEquity - 1,
    profitFactor: grossLoss === 0 ? Infinity : grossProfit / grossLoss,
    maxDrawdown: calculateMaxDrawdown(netReturns),
    averageHoldMinutes:
      holdTimes.reduce((sum, value) => sum + value, 0) / trades.length,
    medianHoldMinutes: median(holdTimes),
    exits: {
      profit: trades.filter((trade) => trade.exitReason === "profit").length,
      stop: trades.filter((trade) => trade.exitReason === "stop").length,
      endOfData: endOfData.length,
    },
  };
}

function runForStopLoss(
  marketTrades: Trade[],
  stopLoss: number,
): StopResult {
  const trades = marketTrades.filter(() => true);

  return {
    stopLoss,
    stopLossPercent: stopLoss * 100,
    summary: summariseTrades(trades),
  };
}

function loadDataset(): Dataset {
  console.log(`Loading dataset: ${SOURCE_PATH}`);

  const raw = fs.readFileSync(SOURCE_PATH, "utf8");
  const dataset = JSON.parse(raw) as Dataset;

  if (!dataset.markets || !Array.isArray(dataset.markets)) {
    throw new Error("Dataset does not contain a markets array.");
  }

  return dataset;
}

function main(): void {
  const dataset = loadDataset();

  const overallTrades = new Map<number, Trade[]>();
  const byMarket: MarketResult[] = [];

  for (const stopLoss of STOP_LOSSES) {
    overallTrades.set(stopLoss, []);
  }

  let observationsExamined = 0;

  for (const market of dataset.markets) {
    const marketTrades = new Map<number, Trade[]>();

    for (const stopLoss of STOP_LOSSES) {
      marketTrades.set(stopLoss, []);
    }

    let signals = 0;

    /*
     * We cannot enter on the final candle because there is no future
     * candle with which to determine whether the target or stop occurred.
     */
    for (let index = 50; index < market.candles.length - 1; index += 1) {
      observationsExamined += 1;

      const features = calculateFeatures(market.candles, index);

      if (!features || !isSignal(features)) {
        continue;
      }

      signals += 1;

      for (const stopLoss of STOP_LOSSES) {
        const trade = createTrade(
          market.symbol,
          market.candles,
          index,
          stopLoss,
        );

        marketTrades.get(stopLoss)!.push(trade);
        overallTrades.get(stopLoss)!.push(trade);
      }
    }

    const results: StopResult[] = STOP_LOSSES.map((stopLoss) =>
      runForStopLoss(marketTrades.get(stopLoss)!, stopLoss),
    );

    byMarket.push({
      symbol: market.symbol,
      signals,
      results,
    });

    console.log(
      `${market.symbol}: ${signals.toLocaleString()} signals`,
    );
  }

  const overall: StopResult[] = STOP_LOSSES.map((stopLoss) =>
    runForStopLoss(overallTrades.get(stopLoss)!, stopLoss),
  );

  const output: Output = {
    generatedAt: new Date().toISOString(),
    sourceFile: SOURCE_PATH,
    markets: dataset.markets.length,
    observationsExamined,

    entryRule: {
      slope20LessThanOrEqual: SLOPE20_THRESHOLD,
      accelerationGreaterThanOrEqual: ACCELERATION_THRESHOLD,
    },

    exitRule: {
      profitTarget: PROFIT_TARGET,
      profitTargetPercent: PROFIT_TARGET * 100,
      stopLosses: STOP_LOSSES,
      maxHoldMinutes: null,
    },

    costs: {
      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,
      totalCost: TOTAL_COST,
    },

    overall,
    byMarket,
  };

  const outputPath = path.join(
    __dirname,
    "research-output",
    `stop-target-backtest-${Date.now()}.json`,
  );

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log("\n=== STOP/TARGET BACKTEST ===");
  console.log(`Profit target: +${PROFIT_TARGET * 100}%`);
  console.log(`Round-trip cost: ${TOTAL_COST * 100}%`);
  console.log("Maximum holding time: NONE");
  console.log("");

  for (const result of overall) {
    const summary = result.summary;

    console.log(
      [
        `SL -${result.stopLossPercent.toFixed(2)}%`,
        `trades=${summary.trades}`,
        `win=${(summary.winRate * 100).toFixed(2)}%`,
        `avg=${(summary.averageNetReturn * 100).toFixed(4)}%`,
        `median=${(summary.medianNetReturn * 100).toFixed(4)}%`,
        `PF=${summary.profitFactor.toFixed(3)}`,
        `compound=${(summary.compoundedReturn * 100).toFixed(2)}%`,
        `DD=${(summary.maxDrawdown * 100).toFixed(2)}%`,
        `hold=${summary.medianHoldMinutes.toFixed(1)}m`,
        `profit=${summary.exits.profit}`,
        `stop=${summary.exits.stop}`,
        `end=${summary.exits.endOfData}`,
      ].join(" | "),
    );
  }

  console.log(`\nOutput written to: ${outputPath}`);
}

main();
