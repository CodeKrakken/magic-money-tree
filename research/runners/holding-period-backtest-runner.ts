import fs from 'fs';
import path from 'path';

interface Candle {
  [key: string]: unknown;
}

interface Market {
  symbol: string;
  candles: Candle[];
}

interface Position {
  id: number;
  symbol: string;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  investedCapital: number;
}

interface Trade {
  symbol: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  investedCapital: number;
  exitValue: number;
  profit: number;
  returnPct: number;
  exitReason:
    | 'target'
    | 'stop'
    | 'maximum_hold';
  holdMilliseconds: number;
}

interface BacktestResult {
  startingCapital: number;
  finalEquity: number;
  returnPct: number;
  maxDrawdownPct: number;

  trades: number;
  winners: number;
  losers: number;
  winRatePct: number;

  targetExits: number;
  stopExits: number;
  maximumHoldExits: number;

  grossProfit: number;
  grossLoss: number;
  profitFactor: number;

  totalFees: number;

  averageHoldHours: number;
  medianHoldHours: number;

  maximumOpenPositions: number;
  averageOpenPositions: number;

  averageCapitalUtilisationPct: number;
}

interface DatasetResult {
  name: string;
  markets: number;
  signals: number;
  firstTime: number;
  lastTime: number;
  holdingPeriods: Record<string, BacktestResult>;
}

interface Output {
  metadata: {
    generatedAt: string;
    startingCapital: number;

    datasets: {
      name: string;
      markets: number;
      signals: number;
      firstTime: number;
      lastTime: number;
    }[];

    strategy: {
      targetPct: number;
      stopLossPct: number;
      entryFeePct: number;
      exitFeePct: number;
      minimumPosition: number;
      maximumPositionPct: number;
      maximumConcurrentPositions: number;
      executionCostPct: number;

      signal: {
        slopeWindowShort: number;
        slopeWindowLong: number;
        slopeThreshold: number;
        accelerationThreshold: number;
      };
    };

    holdingPeriodsHours: number[];
  };

  datasets: DatasetResult[];
}

const STARTING_CAPITAL = 100;

const MINIMUM_POSITION = 10;
const MAXIMUM_POSITION_PCT = 0.05;

const MAX_CONCURRENT_POSITIONS = 43;

const TARGET_RETURN = 0.08;
const STOP_LOSS_RETURN = -0.10;

const ENTRY_FEE = 0.001;
const EXIT_FEE = 0.001;

const EXECUTION_COST = 0;

const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const SHORT_SLOPE_WINDOW = 20;
const LONG_SLOPE_WINDOW = 50;

const HOLDING_PERIODS_HOURS = [
  1,
  2,
  4,
  6,
  12,
  24,
  36,
  48,
  72,
  96,
  120
];

const TRAINING_FILE = path.resolve(
  __dirname,
  '../data/ema-data-1789061547934.json'
);

const OOS_FILE = path.resolve(
  __dirname,
  '../data/ema-data-oos-60-1789165540440.json'
);

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * The research datasets have used different timestamp
 * field names over the course of the project.
 *
 * Support the known formats rather than assuming
 * `candle.time`.
 */
function getCandleTime(
  candle: Candle
): number {
  const candidates = [
    candle.time,
    candle.timestamp,
    candle.openTime,
    candle.open_time,
    candle.t
  ];

  for (const value of candidates) {
    if (typeof value === 'number' &&
        Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  throw new Error(
    `Could not determine candle timestamp. Candle keys: ${Object.keys(candle).join(', ')}`
  );
}

function getCandleOpen(
  candle: Candle
): number {
  const value =
    candle.open ??
    candle.o;

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(
      `Invalid candle open price: ${String(value)}`
    );
  }

  return number;
}

function getCandleHigh(
  candle: Candle
): number {
  const value =
    candle.high ??
    candle.h;

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(
      `Invalid candle high price: ${String(value)}`
    );
  }

  return number;
}

function getCandleLow(
  candle: Candle
): number {
  const value =
    candle.low ??
    candle.l;

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(
      `Invalid candle low price: ${String(value)}`
    );
  }

  return number;
}

function getCandleClose(
  candle: Candle
): number {
  const value =
    candle.close ??
    candle.c;

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(
      `Invalid candle close price: ${String(value)}`
    );
  }

  return number;
}

function median(
  values: number[]
): number {
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
      getCandleClose(
        candles[i]
      );
  }

  const slope20 =
    buildRegressionSlopes(
      Array.from(closes),
      SHORT_SLOPE_WINDOW
    );

  const slope50 =
    buildRegressionSlopes(
      Array.from(closes),
      LONG_SLOPE_WINDOW
    );

  const signalIndices: number[] = [];

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

function loadMarkets(
  filename: string
): Market[] {
  const raw = JSON.parse(
    fs.readFileSync(
      filename,
      'utf8'
    )
  );

  if (Array.isArray(raw)) {
    return raw as Market[];
  }

  if (
    raw &&
    Array.isArray(raw.markets)
  ) {
    return raw.markets as Market[];
  }

  throw new Error(
    `Could not find markets array in ${filename}`
  );
}

function getMarketTimes(
  markets: Market[]
): {
  firstTime: number;
  lastTime: number;
} {
  let firstTime =
    Number.POSITIVE_INFINITY;

  let lastTime =
    Number.NEGATIVE_INFINITY;

  for (const market of markets) {
    if (
      market.candles.length === 0
    ) {
      continue;
    }

    firstTime =
      Math.min(
        firstTime,
        getCandleTime(
          market.candles[0]
        )
      );

    lastTime =
      Math.max(
        lastTime,
        getCandleTime(
          market.candles[
            market.candles.length - 1
          ]
        )
      );
  }

  if (
    !Number.isFinite(firstTime) ||
    !Number.isFinite(lastTime)
  ) {
    throw new Error(
      'Could not determine dataset time range.'
    );
  }

  return {
    firstTime,
    lastTime
  };
}

function getEquity(
  cash: number,
  positions: Position[],
  marketsBySymbol: Map<
    string,
    Market
  >,
  candleIndices: Map<
    string,
    number
  >
): number {
  let equity = cash;

  for (const position of positions) {
    const market =
      marketsBySymbol.get(
        position.symbol
      );

    if (!market) {
      continue;
    }

    const index =
      candleIndices.get(
        position.symbol
      );

    if (
      index === undefined ||
      index < 0 ||
      index >=
        market.candles.length
    ) {
      continue;
    }

    const candle =
      market.candles[index];

    const close =
      getCandleClose(candle);

    equity +=
      position.quantity *
      close;
  }

  return equity;
}

function getOpenPositionValue(
  positions: Position[],
  marketsBySymbol: Map<
    string,
    Market
  >,
  candleIndices: Map<
    string,
    number
  >
): number {
  let value = 0;

  for (const position of positions) {
    const market =
      marketsBySymbol.get(
        position.symbol
      );

    if (!market) {
      continue;
    }

    const index =
      candleIndices.get(
        position.symbol
      );

    if (
      index === undefined ||
      index < 0 ||
      index >=
        market.candles.length
    ) {
      continue;
    }

    value +=
      position.quantity *
      getCandleClose(
        market.candles[index]
      );
  }

  return value;
}

function calculateProfitFactor(
  trades: Trade[]
): number {
  let grossProfit = 0;
  let grossLoss = 0;

  for (const trade of trades) {
    if (trade.profit > 0) {
      grossProfit +=
        trade.profit;
    } else {
      grossLoss +=
        Math.abs(
          trade.profit
        );
    }
  }

  if (grossLoss === 0) {
    return grossProfit > 0
      ? Number.POSITIVE_INFINITY
      : 0;
  }

  return (
    grossProfit / grossLoss
  );
}

function runBacktest(
  markets: Market[],
  maximumHoldHours: number
): BacktestResult {
  const marketsBySymbol =
    new Map<string, Market>();

  const signalsBySymbol =
    new Map<
      string,
      Set<number>
    >();

  const allTimes =
    new Set<number>();

  for (const market of markets) {
    marketsBySymbol.set(
      market.symbol,
      market
    );

    const signalIndices =
      buildSignalIndices(
        market.candles
      );

    signalsBySymbol.set(
      market.symbol,
      new Set(signalIndices)
    );

    for (
      const candle of market.candles
    ) {
      allTimes.add(
        getCandleTime(candle)
      );
    }
  }

  const times =
    Array.from(allTimes).sort(
      (a, b) => a - b
    );

  const candleIndices =
    new Map<
      string,
      number
    >();

  for (const market of markets) {
    candleIndices.set(
      market.symbol,
      -1
    );
  }

  let cash =
    STARTING_CAPITAL;

  const positions: Position[] = [];

  const trades: Trade[] = [];

  let nextPositionId = 1;

  let peakEquity =
    STARTING_CAPITAL;

  let maximumDrawdownPct = 0;

  let maximumOpenPositions = 0;

  let openPositionSamples = 0;
  let totalOpenPositions = 0;

  let capitalUtilisationSum = 0;
  let capitalUtilisationSamples = 0;

  const maximumHoldMilliseconds =
    maximumHoldHours *
    60 *
    60 *
    1000;

  for (
    const time of times
  ) {
    /*
     * Advance each market to the
     * candle at this timestamp.
     */
    for (const market of markets) {
      const currentIndex =
        candleIndices.get(
          market.symbol
        ) ?? -1;

      let nextIndex =
        currentIndex + 1;

      while (
        nextIndex <
          market.candles.length &&
        getCandleTime(
          market.candles[nextIndex]
        ) <= time
      ) {
        nextIndex++;
      }

      candleIndices.set(
        market.symbol,
        nextIndex - 1
      );
    }

    /*
     * Process exits before entries.
     *
     * Stop takes priority over target if
     * both are touched by the same candle.
     */
    for (
      let positionIndex =
        positions.length - 1;
      positionIndex >= 0;
      positionIndex--
    ) {
      const position =
        positions[positionIndex];

      const market =
        marketsBySymbol.get(
          position.symbol
        );

      if (!market) {
        continue;
      }

      const candleIndex =
        candleIndices.get(
          position.symbol
        );

      if (
        candleIndex === undefined ||
        candleIndex <
          position.entryIndex
      ) {
        continue;
      }

      const candle =
        market.candles[
          candleIndex
        ];

      const candleTime =
        getCandleTime(candle);

      const high =
        getCandleHigh(candle);

      const low =
        getCandleLow(candle);

      const close =
        getCandleClose(candle);

      const targetPrice =
        position.entryPrice *
        (1 + TARGET_RETURN);

      const stopPrice =
        position.entryPrice *
        (1 + STOP_LOSS_RETURN);

      const maximumHoldReached =
        candleTime -
          position.entryTime >=
        maximumHoldMilliseconds;

      let exitReason:
        | 'target'
        | 'stop'
        | 'maximum_hold'
        | null = null;

      let exitPrice = 0;

      if (
        low <= stopPrice
      ) {
        exitReason = 'stop';
        exitPrice = stopPrice;
      } else if (
        high >= targetPrice
      ) {
        exitReason = 'target';
        exitPrice = targetPrice;
      } else if (
        maximumHoldReached
      ) {
        exitReason =
          'maximum_hold';
        exitPrice = close;
      }

      if (!exitReason) {
        continue;
      }

      const grossExitValue =
        position.quantity *
        exitPrice;

      const exitFee =
        grossExitValue *
        EXIT_FEE;

      const executionCost =
        grossExitValue *
        EXECUTION_COST;

      const netExitValue =
        grossExitValue -
        exitFee -
        executionCost;

      cash += netExitValue;

      const entryFee =
        position.investedCapital *
        ENTRY_FEE;

      const profit =
        netExitValue -
        position.investedCapital -
        entryFee;

      trades.push({
        symbol:
          position.symbol,

        entryTime:
          position.entryTime,

        exitTime:
          candleTime,

        entryPrice:
          position.entryPrice,

        exitPrice,

        investedCapital:
          position.investedCapital,

        exitValue:
          netExitValue,

        profit,

        returnPct:
          profit /
          position.investedCapital,

        exitReason,

        holdMilliseconds:
          candleTime -
          position.entryTime
      });

      positions.splice(
        positionIndex,
        1
      );
    }

    /*
     * Process entries.
     */
    for (const market of markets) {
      const candleIndex =
        candleIndices.get(
          market.symbol
        );

      if (
        candleIndex === undefined ||
        candleIndex < 0
      ) {
        continue;
      }

      const signalIndices =
        signalsBySymbol.get(
          market.symbol
        );

      if (!signalIndices) {
        continue;
      }

      if (
        !signalIndices.has(
          candleIndex
        )
      ) {
        continue;
      }

      if (
        positions.length >=
        MAX_CONCURRENT_POSITIONS
      ) {
        continue;
      }

      const candle =
        market.candles[
          candleIndex
        ];

      const candleTime =
        getCandleTime(candle);

      const close =
        getCandleClose(candle);

      const equity =
        getEquity(
          cash,
          positions,
          marketsBySymbol,
          candleIndices
        );

      const desiredPositionSize =
        Math.max(
          MINIMUM_POSITION,
          equity *
            MAXIMUM_POSITION_PCT
        );

      const maximumAffordable =
        cash /
        (1 + ENTRY_FEE);

      const positionSize =
        Math.min(
          desiredPositionSize,
          maximumAffordable
        );

      if (
        positionSize <
        MINIMUM_POSITION
      ) {
        continue;
      }

      const entryFee =
        positionSize *
        ENTRY_FEE;

      const totalEntryCost =
        positionSize +
        entryFee;

      if (
        totalEntryCost >
        cash
      ) {
        continue;
      }

      const quantity =
        positionSize /
        (close *
          (1 + EXECUTION_COST));

      cash -=
        totalEntryCost;

      positions.push({
        id: nextPositionId++,
        symbol:
          market.symbol,
        entryIndex:
          candleIndex,
        entryTime:
          candleTime,
        entryPrice:
          close,
        quantity,
        investedCapital:
          positionSize
      });
    }

    /*
     * Mark-to-market statistics.
     */
    const equity =
      getEquity(
        cash,
        positions,
        marketsBySymbol,
        candleIndices
      );

    if (
      equity > peakEquity
    ) {
      peakEquity = equity;
    }

    if (
      peakEquity > 0
    ) {
      const drawdownPct =
        ((peakEquity -
          equity) /
          peakEquity) *
        100;

      maximumDrawdownPct =
        Math.max(
          maximumDrawdownPct,
          drawdownPct
        );
    }

    const openPositionValue =
      getOpenPositionValue(
        positions,
        marketsBySymbol,
        candleIndices
      );

    const utilisation =
      equity > 0
        ? openPositionValue /
          equity
        : 0;

    capitalUtilisationSum +=
      utilisation;

    capitalUtilisationSamples++;

    totalOpenPositions +=
      positions.length;

    openPositionSamples++;

    maximumOpenPositions =
      Math.max(
        maximumOpenPositions,
        positions.length
      );
  }

  /*
   * Liquidate positions remaining when
   * the dataset ends.
   */
  for (
    let positionIndex =
      positions.length - 1;
    positionIndex >= 0;
    positionIndex--
  ) {
    const position =
      positions[positionIndex];

    const market =
      marketsBySymbol.get(
        position.symbol
      );

    if (!market) {
      continue;
    }

    const finalCandle =
      market.candles[
        market.candles.length - 1
      ];

    const finalTime =
      getCandleTime(
        finalCandle
      );

    const finalClose =
      getCandleClose(
        finalCandle
      );

    const grossExitValue =
      position.quantity *
      finalClose;

    const exitFee =
      grossExitValue *
      EXIT_FEE;

    const executionCost =
      grossExitValue *
      EXECUTION_COST;

    const netExitValue =
      grossExitValue -
      exitFee -
      executionCost;

    cash += netExitValue;

    const entryFee =
      position.investedCapital *
      ENTRY_FEE;

    const profit =
      netExitValue -
      position.investedCapital -
      entryFee;

    trades.push({
      symbol:
        position.symbol,

      entryTime:
        position.entryTime,

      exitTime:
        finalTime,

      entryPrice:
        position.entryPrice,

      exitPrice:
        finalClose,

      investedCapital:
        position.investedCapital,

      exitValue:
        netExitValue,

      profit,

      returnPct:
        profit /
        position.investedCapital,

      exitReason:
        'maximum_hold',

      holdMilliseconds:
        finalTime -
        position.entryTime
    });

    positions.splice(
      positionIndex,
      1
    );
  }

  const finalEquity =
    cash;

  const returnPct =
    ((finalEquity -
      STARTING_CAPITAL) /
      STARTING_CAPITAL) *
    100;

  const winners =
    trades.filter(
      trade =>
        trade.profit > 0
    ).length;

  const losers =
    trades.filter(
      trade =>
        trade.profit <= 0
    ).length;

  const grossProfit =
    trades
      .filter(
        trade =>
          trade.profit > 0
      )
      .reduce(
        (sum, trade) =>
          sum + trade.profit,
        0
      );

  const grossLoss =
    trades
      .filter(
        trade =>
          trade.profit < 0
      )
      .reduce(
        (sum, trade) =>
          sum +
          Math.abs(
            trade.profit
          ),
        0
      );

  /*
   * Fees are deterministic from the
   * trade sizes and prices. Calculate
   * them directly from the trade data.
   */
  const totalFees =
    trades.reduce(
      (sum, trade) => {
        const entryFee =
          trade.investedCapital *
          ENTRY_FEE;

        /*
         * Recover the gross sale value
         * from the net exit value.
         */
        const grossExitValue =
          trade.exitValue /
          (1 - EXIT_FEE);

        const exitFee =
          grossExitValue *
          EXIT_FEE;

        return (
          sum +
          entryFee +
          exitFee
        );
      },
      0
    );

  const holdHours =
    trades.map(
      trade =>
        trade.holdMilliseconds /
        (60 * 60 * 1000)
    );

  const targetExits =
    trades.filter(
      trade =>
        trade.exitReason ===
        'target'
    ).length;

  const stopExits =
    trades.filter(
      trade =>
        trade.exitReason ===
        'stop'
    ).length;

  const maximumHoldExits =
    trades.filter(
      trade =>
        trade.exitReason ===
        'maximum_hold'
    ).length;

  return {
    startingCapital:
      STARTING_CAPITAL,

    finalEquity,

    returnPct,

    maxDrawdownPct:
      maximumDrawdownPct,

    trades:
      trades.length,

    winners,

    losers,

    winRatePct:
      trades.length > 0
        ? (winners /
            trades.length) *
          100
        : 0,

    targetExits,

    stopExits,

    maximumHoldExits,

    grossProfit,

    grossLoss,

    profitFactor:
      calculateProfitFactor(
        trades
      ),

    totalFees,

    averageHoldHours:
      holdHours.length > 0
        ? holdHours.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          holdHours.length
        : 0,

    medianHoldHours:
      median(holdHours),

    maximumOpenPositions,

    averageOpenPositions:
      openPositionSamples > 0
        ? totalOpenPositions /
          openPositionSamples
        : 0,

    averageCapitalUtilisationPct:
      capitalUtilisationSamples > 0
        ? (capitalUtilisationSum /
            capitalUtilisationSamples) *
          100
        : 0
  };
}

function runDataset(
  name: string,
  filename: string
): DatasetResult {
  log('');
  log(
    '============================================================'
  );
  log(`${name} dataset`);
  log(
    '============================================================'
  );

  log(`Loading: ${filename}`);

  const markets =
    loadMarkets(filename);

  const {
    firstTime,
    lastTime
  } =
    getMarketTimes(
      markets
    );

  let totalSignals = 0;

  for (
    const market of markets
  ) {
    totalSignals +=
      buildSignalIndices(
        market.candles
      ).length;
  }

  log(
    `Markets: ${markets.length}`
  );

  log(
    `Signals: ${totalSignals.toLocaleString()}`
  );

  log(
    `Period: ${new Date(
      firstTime
    ).toISOString()} -> ${new Date(
      lastTime
    ).toISOString()}`
  );

  const holdingPeriods:
    Record<
      string,
      BacktestResult
    > = {};

  for (
    let i = 0;
    i <
      HOLDING_PERIODS_HOURS.length;
    i++
  ) {
    const hours =
      HOLDING_PERIODS_HOURS[i];

    log(
      `\n[${i + 1}/${HOLDING_PERIODS_HOURS.length}] Testing ${hours}h maximum hold...`
    );

    const start =
      Date.now();

    const result =
      runBacktest(
        markets,
        hours
      );

    const elapsed =
      (Date.now() - start) /
      1000;

    holdingPeriods[
      `${hours}h`
    ] = result;

    log(
      `  Return: ${result.returnPct.toFixed(2)}%`
    );

    log(
      `  Max DD: ${result.maxDrawdownPct.toFixed(2)}%`
    );

    log(
      `  Trades: ${result.trades}`
    );

    log(
      `  Target / stop / hold: ${result.targetExits} / ${result.stopExits} / ${result.maximumHoldExits}`
    );

    log(
      `  Win rate: ${result.winRatePct.toFixed(2)}%`
    );

    log(
      `  PF: ${
        Number.isFinite(
          result.profitFactor
        )
          ? result.profitFactor.toFixed(3)
          : '∞'
      }`
    );

    log(
      `  Avg hold: ${result.averageHoldHours.toFixed(2)}h`
    );

    log(
      `  Max positions: ${result.maximumOpenPositions}`
    );

    log(
      `  Runtime: ${elapsed.toFixed(1)}s`
    );
  }

  return {
    name,
    markets:
      markets.length,
    signals:
      totalSignals,
    firstTime,
    lastTime,
    holdingPeriods
  };
}

function main(): void {
  log(
    '============================================================'
  );

  log(
    'Maximum holding-period backtest'
  );

  log(
    '8% single-target strategy'
  );

  log(
    '============================================================'
  );

  log('');

  log(
    `Starting capital: £${STARTING_CAPITAL}`
  );

  log(
    `Target: +${TARGET_RETURN * 100}%`
  );

  log(
    `Stop: ${STOP_LOSS_RETURN * 100}%`
  );

  log(
    `Position: max(£${MINIMUM_POSITION}, ${MAXIMUM_POSITION_PCT * 100}% equity)`
  );

  log(
    `Maximum positions: ${MAX_CONCURRENT_POSITIONS}`
  );

  log(
    `Fees: ${ENTRY_FEE * 100}% entry + ${EXIT_FEE * 100}% exit`
  );

  log(
    `Holding periods: ${HOLDING_PERIODS_HOURS.join(', ')} hours`
  );

  const training =
    runDataset(
      'Training',
      TRAINING_FILE
    );

  const oos =
    runDataset(
      'OOS',
      OOS_FILE
    );

  const output: Output = {
    metadata: {
      generatedAt:
        new Date().toISOString(),

      startingCapital:
        STARTING_CAPITAL,

      datasets: [
        {
          name:
            training.name,

          markets:
            training.markets,

          signals:
            training.signals,

          firstTime:
            training.firstTime,

          lastTime:
            training.lastTime
        },

        {
          name:
            oos.name,

          markets:
            oos.markets,

          signals:
            oos.signals,

          firstTime:
            oos.firstTime,

          lastTime:
            oos.lastTime
        }
      ],

      strategy: {
        targetPct:
          TARGET_RETURN,

        stopLossPct:
          STOP_LOSS_RETURN,

        entryFeePct:
          ENTRY_FEE,

        exitFeePct:
          EXIT_FEE,

        minimumPosition:
          MINIMUM_POSITION,

        maximumPositionPct:
          MAXIMUM_POSITION_PCT,

        maximumConcurrentPositions:
          MAX_CONCURRENT_POSITIONS,

        executionCostPct:
          EXECUTION_COST,

        signal: {
          slopeWindowShort:
            SHORT_SLOPE_WINDOW,

          slopeWindowLong:
            LONG_SLOPE_WINDOW,

          slopeThreshold:
            SLOPE_THRESHOLD,

          accelerationThreshold:
            ACCELERATION_THRESHOLD
        }
      },

      holdingPeriodsHours:
        HOLDING_PERIODS_HOURS
    },

    datasets: [
      training,
      oos
    ]
  };

  const outputDirectory =
    path.resolve(
      __dirname,
      '../output'
    );

  fs.mkdirSync(
    outputDirectory,
    {
      recursive: true
    }
  );

  const outputFilename =
    path.join(
      outputDirectory,
      `holding-period-backtest-${Date.now()}.json`
    );

  fs.writeFileSync(
    outputFilename,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  log('');

  log(
    '============================================================'
  );

  log('Complete');

  log(
    `Output: ${outputFilename}`
  );

  log(
    '============================================================'
  );

  log('');

  log('Summary:');

  for (
    const dataset of
      output.datasets
  ) {
    log('');
    log(dataset.name);

    for (
      const hours of
        HOLDING_PERIODS_HOURS
    ) {
      const result =
        dataset.holdingPeriods[
          `${hours}h`
        ];

      log(
        `  ${String(hours).padStart(3)}h: ` +
        `${result.returnPct >= 0 ? '+' : ''}${result.returnPct.toFixed(2)}% return, ` +
        `${result.maxDrawdownPct.toFixed(2)}% DD, ` +
        `${result.trades} trades, ` +
        `PF ${
          Number.isFinite(
            result.profitFactor
          )
            ? result.profitFactor.toFixed(3)
            : '∞'
        }`
      );
    }
  }
}

main();