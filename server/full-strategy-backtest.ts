import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

interface Trade {
  symbol: string;
  entryIndex: number;
  entryTimestamp: number;
  entryPrice: number;
  exitIndex: number;
  exitTimestamp: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  holdMinutes: number;
  exitReason: "take_profit" | "stop_loss" | "timeout";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SOURCE_FILE =
  "ema-data-1789061547934.json";

const SOURCE_PATH =
  process.argv[2] ??
  path.join(
    __dirname,
    "research-output",
    DEFAULT_SOURCE_FILE
  );

const OUTPUT_DIR = path.join(
  __dirname,
  "research-output"
);

// Frozen strategy parameters from the previous backtest.
const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const TAKE_PROFIT = 0.01;
const STOP_LOSS = 0.01;
const MAX_HOLD_MINUTES = 50;

const FEE_RATE = 0.002;
const EXECUTION_COST = 0;
const TOTAL_COST =
  FEE_RATE + EXECUTION_COST;

const PROGRESS_INTERVAL = 100_000;

function netReturn(
  grossReturn: number
): number {
  return grossReturn - TOTAL_COST;
}

function average(
  values: number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
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

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) *
      (index - lower)
  );
}

function median(
  values: number[]
): number {
  return percentile(values, 0.5);
}

function calculateDrawdown(
  returns: number[]
): number {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (const value of returns) {
    equity *= 1 + value;

    if (equity > peak) {
      peak = equity;
    }

    const drawdown =
      peak === 0
        ? 0
        : (peak - equity) / peak;

    maxDrawdown = Math.max(
      maxDrawdown,
      drawdown
    );
  }

  return maxDrawdown;
}

function calculateStatistics(
  trades: Trade[]
) {
  const returns = trades.map(
    (trade) => trade.netReturn
  );

  const winningTrades =
    trades.filter(
      (trade) =>
        trade.netReturn > 0
    );

  const losingTrades =
    trades.filter(
      (trade) =>
        trade.netReturn <= 0
    );

  const grossProfit =
    winningTrades.reduce(
      (sum, trade) =>
        sum + trade.netReturn,
      0
    );

  const grossLoss = Math.abs(
    losingTrades.reduce(
      (sum, trade) =>
        sum + trade.netReturn,
      0
    )
  );

  let compoundedReturn = 1;

  for (const value of returns) {
    compoundedReturn *=
      1 + value;
  }

  compoundedReturn -= 1;

  return {
    trades: trades.length,

    winningTrades:
      winningTrades.length,

    losingTrades:
      losingTrades.length,

    winRate:
      trades.length === 0
        ? 0
        : winningTrades.length /
          trades.length,

    averageNetReturn:
      average(returns),

    medianNetReturn:
      median(returns),

    totalNetReturn:
      returns.reduce(
        (sum, value) =>
          sum + value,
        0
      ),

    compoundedReturn,

    profitFactor:
      grossLoss === 0
        ? null
        : grossProfit / grossLoss,

    maxDrawdown:
      calculateDrawdown(returns),

    averageHoldMinutes:
      average(
        trades.map(
          (trade) =>
            trade.holdMinutes
        )
      ),

    exits: {
      takeProfit:
        trades.filter(
          (trade) =>
            trade.exitReason ===
            "take_profit"
        ).length,

      stopLoss:
        trades.filter(
          (trade) =>
            trade.exitReason ===
            "stop_loss"
        ).length,

      timeout:
        trades.filter(
          (trade) =>
            trade.exitReason ===
            "timeout"
        ).length,
    },
  };
}

function calculateSlope(
  values: number[]
): number {
  if (values.length < 2) {
    return 0;
  }

  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = average(values);

  let numerator = 0;
  let denominator = 0;

  for (
    let i = 0;
    i < n;
    i += 1
  ) {
    const x = i - meanX;
    const y =
      values[i] - meanY;

    numerator += x * y;
    denominator += x * x;
  }

  return denominator === 0
    ? 0
    : numerator / denominator;
}

function calculateFeatures(
  candles: Candle[],
  index: number
) {
  if (index < 50) {
    return null;
  }

  const closes = candles
    .slice(0, index + 1)
    .map(
      (candle) => candle.close
    );

  const closes20 =
    closes.slice(-20);

  const closes50 =
    closes.slice(-50);

  const slope20 =
    calculateSlope(closes20);

  const slope50 =
    calculateSlope(closes50);

  const acceleration =
    slope20 - slope50;

  return {
    slope20,
    acceleration,
  };
}

function createTrade(
  market: MarketData,
  entryIndex: number
): Trade {
  const candles =
    market.candles;

  const entry =
    candles[entryIndex];

  const entryPrice =
    entry.close;

  const takeProfitPrice =
    entryPrice *
    (1 + TAKE_PROFIT);

  const stopLossPrice =
    entryPrice *
    (1 - STOP_LOSS);

  const finalIndex =
    Math.min(
      entryIndex +
        MAX_HOLD_MINUTES,
      candles.length - 1
    );

  for (
    let index =
      entryIndex + 1;
    index <= finalIndex;
    index += 1
  ) {
    const candle =
      candles[index];

    const hitTakeProfit =
      candle.high >=
      takeProfitPrice;

    const hitStopLoss =
      candle.low <=
      stopLossPrice;

    if (
      hitTakeProfit ||
      hitStopLoss
    ) {
      /*
       * If both levels occur within
       * the same candle, candle data
       * cannot tell us which happened
       * first.
       *
       * Use the conservative assumption
       * that the stop loss happened first.
       */
      const exitReason =
        hitStopLoss
          ? "stop_loss"
          : "take_profit";

      const exitPrice =
        exitReason ===
        "stop_loss"
          ? stopLossPrice
          : takeProfitPrice;

      const grossReturn =
        exitPrice /
          entryPrice -
        1;

      return {
        symbol:
          market.symbol,

        entryIndex,

        entryTimestamp:
          entry.openTime,

        entryPrice,

        exitIndex:
          index,

        exitTimestamp:
          candle.openTime,

        exitPrice,

        grossReturn,

        netReturn:
          netReturn(
            grossReturn
          ),

        holdMinutes:
          index - entryIndex,

        exitReason,
      };
    }
  }

  const exit =
    candles[finalIndex];

  const grossReturn =
    exit.close /
      entryPrice -
    1;

  return {
    symbol:
      market.symbol,

    entryIndex,

    entryTimestamp:
      entry.openTime,

    entryPrice,

    exitIndex:
      finalIndex,

    exitTimestamp:
      exit.openTime,

    exitPrice:
      exit.close,

    grossReturn,

    netReturn:
      netReturn(
        grossReturn
      ),

    holdMinutes:
      finalIndex -
      entryIndex,

    exitReason:
      "timeout",
  };
}

function groupByMonth(
  trades: Trade[]
) {
  const groups =
    new Map<
      string,
      Trade[]
    >();

  for (const trade of trades) {
    const month =
      new Date(
        trade.entryTimestamp
      )
        .toISOString()
        .slice(0, 7);

    const existing =
      groups.get(month) ??
      [];

    existing.push(trade);
    groups.set(
      month,
      existing
    );
  }

  return Object.fromEntries(
    [...groups.entries()].map(
      ([month, monthTrades]) => [
        month,
        calculateStatistics(
          monthTrades
        ),
      ]
    )
  );
}

function main() {
  console.log(
    `Loading dataset: ${SOURCE_PATH}`
  );

  if (
    !fs.existsSync(
      SOURCE_PATH
    )
  ) {
    throw new Error(
      `Dataset not found: ${SOURCE_PATH}`
    );
  }

  const dataset =
    JSON.parse(
      fs.readFileSync(
        SOURCE_PATH,
        "utf8"
      )
    ) as Dataset;

  console.log(
    `Loaded ${dataset.markets.length} markets`
  );

  const trades: Trade[] =
    [];

  let observationsExamined =
    0;

  let signals = 0;

  for (const market of dataset.markets) {
    console.log(
      `Processing ${market.symbol} ` +
      `(${market.candles.length} candles)...`
    );

    /*
     * Leave enough candles after
     * an entry for the maximum
     * holding period.
     */
    const lastEntryIndex =
      market.candles.length -
      MAX_HOLD_MINUTES -
      1;

    for (
      let index = 50;
      index <= lastEntryIndex;
      index += 1
    ) {
      const features =
        calculateFeatures(
          market.candles,
          index
        );

      if (!features) {
        continue;
      }

      observationsExamined +=
        1;

      const entrySignal =
        features.slope20 <=
          SLOPE_THRESHOLD &&
        features.acceleration >=
          ACCELERATION_THRESHOLD;

      if (entrySignal) {
        signals += 1;

        const trade =
          createTrade(
            market,
            index
          );

        trades.push(trade);
      }

      if (
        observationsExamined %
          PROGRESS_INTERVAL ===
        0
      ) {
        console.log(
          `Progress: ` +
          `${observationsExamined.toLocaleString()} observations, ` +
          `${signals.toLocaleString()} signals, ` +
          `${trades.length.toLocaleString()} trades`
        );
      }
    }
  }

  const overall =
    calculateStatistics(
      trades
    );

  const byMarket =
    Object.fromEntries(
      dataset.markets.map(
        (market) => {
          const marketTrades =
            trades.filter(
              (trade) =>
                trade.symbol ===
                market.symbol
            );

          return [
            market.symbol,
            calculateStatistics(
              marketTrades
            ),
          ];
        }
      )
    );

  const output = {
    generatedAt: new Date().toISOString(),

    source: {
      file: SOURCE_PATH,
      markets: dataset.markets.length,
      observationsExamined,
      signals,
    },

    strategy: {
      type: "fixed whole-dataset backtest",

      entry: {
        rule:
          "slope20 <= fixed threshold AND " +
          "acceleration >= fixed threshold",

        slope20Threshold:
          SLOPE_THRESHOLD,

        accelerationThreshold:
          ACCELERATION_THRESHOLD,
      },

      exit: {
        takeProfit: TAKE_PROFIT,
        stopLoss: STOP_LOSS,
        maxHoldMinutes: MAX_HOLD_MINUTES,
      },

      thresholdsWereNotRecalculated: true,
      parametersWereNotOptimised: true,
    },

    assumptions: {
      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,
      totalRoundTripCost: TOTAL_COST,
    },

    overall,
    byMarket,
    byMonth: groupByMonth(trades),
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true }
  );

  const outputFile =
    path.join(
      OUTPUT_DIR,
      `full-strategy-backtest-${Date.now()}.json`
    );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    "\nBacktest complete."
  );

  console.log(
    `Observations: ` +
    observationsExamined.toLocaleString()
  );

  console.log(
    `Signals: ` +
    signals.toLocaleString()
  );

  console.log(
    `Trades: ` +
    overall.trades.toLocaleString()
  );

  console.log(
    `Win rate: ` +
    `${(
      overall.winRate * 100
    ).toFixed(2)}%`
  );

  console.log(
    `Average net return: ` +
    `${(
      overall.averageNetReturn *
      100
    ).toFixed(4)}%`
  );

  console.log(
    `Median net return: ` +
    `${(
      overall.medianNetReturn *
      100
    ).toFixed(4)}%`
  );

  console.log(
    `Compounded return: ` +
    `${(
      overall.compoundedReturn *
      100
    ).toFixed(2)}%`
  );

  console.log(
    `Max drawdown: ` +
    `${(
      overall.maxDrawdown *
      100
    ).toFixed(2)}%`
  );

  console.log(
    `Output: ${outputFile}`
  );
}

main();