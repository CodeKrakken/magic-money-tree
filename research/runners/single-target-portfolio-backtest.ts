import fs from 'fs';
import path from 'path';

interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface MarketData {
  symbol: string;
  candles: Candle[];
}

interface Dataset {
  markets: MarketData[];
}

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
  entryPrice: number;
  notional: number;
  entryFee: number;
  targetPrice: number;
  stopPrice: number;
  exitTime: number;
  exitPrice: number;
  exitReason: 'target' | 'stop' | 'max_hold' | 'end_of_data';
  exitFee: number;
  pnl: number;
  returnPct: number;
}

interface EquityPoint {
  time: number;
  equity: number;
  cash: number;
  invested: number;
  openPositions: number;
}

interface BacktestResult {
  dataset: string;
  startingCapital: number;
  targetPct: number;
  finalEquity: number;
  returnPct: number;

  totalTrades: number;
  targetExits: number;
  stopExits: number;
  maxHoldExits: number;
  endOfDataExits: number;

  winningTrades: number;
  losingTrades: number;
  winRatePct: number;

  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  totalFees: number;
  profitFactor: number;

  averageTradeReturnPct: number;
  medianHoldHours: number;

  maximumConcurrentPositions: number;
  averageOpenPositions: number;

  peakEquity: number;
  maximumDrawdown: number;
  maximumDrawdownPct: number;

  averageCapitalUtilisationPct: number;
  maximumCapitalUtilisationPct: number;

  totalPositionHours: number;
  averagePositionHours: number;

  signals: number;
  skippedSignals: number;
}

interface Configuration {
  name: string;
  path: string;
  expectedSignals: number;
}

const ROOT = process.cwd();

const DATASETS: Configuration[] = [
  {
    name: 'training',
    path: path.join(
      ROOT,
      'research/data/ema-data-1789061547934.json'
    ),
    expectedSignals: 49769
  },
  {
    name: 'oos',
    path: path.join(
      ROOT,
      'research/data/ema-data-oos-60-1789165540440.json'
    ),
    expectedSignals: 65977
  }
];

const OUTPUT_DIR = path.join(ROOT, 'research/output');

const STARTING_CAPITALS = [100, 200, 300, 400, 500];

const TARGET_PCTS = [
  0.05,
  0.06,
  0.07,
  0.08,
  0.09,
  0.10
];

const FEE_RATE = 0.001;
const STOP_PCT = 0.10;
const MAX_HOLD_MS = 48 * 60 * 60 * 1000;

const MIN_POSITION_NOTIONAL = 10;
const MAX_POSITION_PCT = 0.05;
const MAX_CONCURRENT_POSITIONS = 43;

const SLOPE_THRESHOLD = -0.0001425851160546487;
const ACCELERATION_THRESHOLD = 0.00013986740450809692;

/*
 * Exact signal-generation implementation from the original
 * working research runner.
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

  const sumX =
    (windowSize * (windowSize - 1)) / 2;

  const sumXX =
    ((windowSize - 1) *
      windowSize *
      (2 * windowSize - 1)) /
    6;

  const denominator =
    windowSize * sumXX - sumX * sumX;

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

  const closes = new Float64Array(
    candles.length
  );

  for (let i = 0; i < candles.length; i++) {
    closes[i] = candles[i].close;
  }

  /*
   * Deliberately retain the same Array.from()
   * conversion as the original working runner.
   * This gives us an exact signal implementation,
   * rather than a "cleaned up" equivalent.
   */
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
      slope20[i] <= SLOPE_THRESHOLD &&
      acceleration >=
        ACCELERATION_THRESHOLD
    ) {
      signalIndices.push(i);
    }
  }

  return signalIndices;
}

function loadDataset(
  configuration: Configuration
): Dataset {
  console.log(
    `\nLoading ${configuration.name} dataset...`
  );
  console.log(`  ${configuration.path}`);

  const raw = fs.readFileSync(
    configuration.path,
    'utf8'
  );

  const dataset =
    JSON.parse(raw) as Dataset;

  if (
    !dataset.markets ||
    !Array.isArray(dataset.markets)
  ) {
    throw new Error(
      `Invalid dataset: markets array not found`
    );
  }

  return dataset;
}

function prepareSignals(
  dataset: Dataset
): {
  signals: Signal[];
  signalCountByMarket: number[];
} {
  const signals: Signal[] = [];

  const signalCountByMarket: number[] =
    new Array(dataset.markets.length).fill(0);

  console.log(
    `  Preparing signals for ${dataset.markets.length} markets...`
  );

  for (
    let marketIndex = 0;
    marketIndex < dataset.markets.length;
    marketIndex++
  ) {
    const market =
      dataset.markets[marketIndex];

    const indices =
      buildSignalIndices(
        market.candles
      );

    signalCountByMarket[marketIndex] =
      indices.length;

    for (const candleIndex of indices) {
      const candle =
        market.candles[candleIndex];

      signals.push({
        marketIndex,
        candleIndex,
        time: candle.openTime,
        price: candle.close
      });
    }

    if (
      (marketIndex + 1) %
        Math.max(
          1,
          Math.floor(
            dataset.markets.length / 10
          )
        ) === 0
    ) {
      console.log(
        `  ${marketIndex + 1}/${dataset.markets.length} markets`
      );
    }
  }

  signals.sort(
    (a, b) => a.time - b.time
  );

  return {
    signals,
    signalCountByMarket
  };
}

function findExit(
  market: MarketData,
  entryCandleIndex: number,
  entryPrice: number,
  targetPct: number
): {
  candleIndex: number;
  time: number;
  price: number;
  reason:
    | 'target'
    | 'stop'
    | 'max_hold'
    | 'end_of_data';
} {
  const candles = market.candles;

  const targetPrice =
    entryPrice * (1 + targetPct);

  const stopPrice =
    entryPrice * (1 - STOP_PCT);

  const entryTime =
    candles[entryCandleIndex].openTime;

  const maximumHoldTime =
    entryTime + MAX_HOLD_MS;

  for (
    let i = entryCandleIndex + 1;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];

    /*
     * Stop takes priority when both stop and target
     * are touched in the same candle. This preserves
     * the original runner's conservative ordering.
     */
    if (candle.low <= stopPrice) {
      return {
        candleIndex: i,
        time: candle.openTime,
        price: stopPrice,
        reason: 'stop'
      };
    }

    if (candle.high >= targetPrice) {
      return {
        candleIndex: i,
        time: candle.openTime,
        price: targetPrice,
        reason: 'target'
      };
    }

    if (candle.openTime >= maximumHoldTime) {
      return {
        candleIndex: i,
        time: candle.openTime,
        price: candle.close,
        reason: 'max_hold'
      };
    }
  }

  const finalIndex =
    candles.length - 1;

  const finalCandle =
    candles[finalIndex];

  return {
    candleIndex: finalIndex,
    time: finalCandle.closeTime,
    price: finalCandle.close,
    reason: 'end_of_data'
  };
}

function binarySearchCandleIndex(
  candles: Candle[],
  time: number
): number {
  let low = 0;
  let high = candles.length - 1;

  while (low <= high) {
    const middle =
      Math.floor((low + high) / 2);

    if (
      candles[middle].openTime <= time
    ) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (high < 0) {
    return 0;
  }

  return high;
}

function getPositionMarketValue(
  position: Position,
  market: MarketData,
  time: number
): number {
  const candleIndex =
    binarySearchCandleIndex(
      market.candles,
      time
    );

  const candle =
    market.candles[candleIndex];

  return (
    position.notional *
    (candle.close / position.entryPrice)
  );
}

function calculateMedian(
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

function simulateRun(
  dataset: Dataset,
  signals: Signal[],
  datasetName: string,
  startingCapital: number,
  targetPct: number
): BacktestResult {
  let cash = startingCapital;

  let nextPositionId = 1;

  const openPositions: Position[] =
    [];

  const completedPositions: Position[] =
    [];

  let maximumConcurrentPositions = 0;

  let skippedSignals = 0;

  let peakEquity = startingCapital;
  let maximumDrawdown = 0;
  let maximumDrawdownPct = 0;

  let equityPointCount = 0;
  let totalOpenPositionCount = 0;
  let totalCapitalUtilisation = 0;
  let maximumCapitalUtilisation = 0;

  let previousEquityTime =
    signals.length > 0
      ? signals[0].time
      : 0;

  /*
   * This records time-weighted portfolio utilisation.
   *
   * If 40% of the portfolio is invested for one hour,
   * that contributes 40 percentage-points of utilisation
   * for that hour.
   */
  let utilisationArea = 0;
  let observedDuration = 0;

  /*
   * Process every minute represented by the dataset,
   * not just signal times.
   *
   * This is important because drawdown must include
   * mark-to-market movements between entry/exit events.
   */
  const timelineTimes =
    buildTimelineTimes(dataset);

  let signalPointer = 0;

  for (
    let timelineIndex = 0;
    timelineIndex <
    timelineTimes.length;
    timelineIndex++
  ) {
    const time =
      timelineTimes[timelineIndex];

    /*
     * First settle any positions whose actual exit
     * has occurred by this timestamp.
     */
    for (
      let i = openPositions.length - 1;
      i >= 0;
      i--
    ) {
      const position =
        openPositions[i];

      if (position.exitTime <= time) {
        cash +=
          position.notional *
            (position.exitPrice /
              position.entryPrice) -
          position.exitFee;

        completedPositions.push(
          position
        );

        openPositions.splice(i, 1);
      }
    }

    /*
     * Process signals occurring at this timestamp.
     *
     * All exits have already been processed, so
     * capital released by an exit is available for
     * a new entry at the same timestamp.
     */
    while (
      signalPointer <
        signals.length &&
      signals[signalPointer].time <=
        time
    ) {
      const signal =
        signals[signalPointer];

      signalPointer++;

      if (
        signal.time !== time
      ) {
        continue;
      }

      if (
        openPositions.length >=
        MAX_CONCURRENT_POSITIONS
      ) {
        skippedSignals++;
        continue;
      }

      const equity =
        getEquityAtTime(
          cash,
          openPositions,
          dataset,
          time
        );

      const desiredNotional =
        Math.max(
          MIN_POSITION_NOTIONAL,
          equity * MAX_POSITION_PCT
        );

      /*
       * We cannot spend more cash than is available.
       * Entry fee is paid from cash, so the gross
       * position notional must satisfy:
       *
       * notional + notional * fee <= cash
       */
      const maximumAffordableNotional =
        cash / (1 + FEE_RATE);

      const notional = Math.min(
        desiredNotional,
        maximumAffordableNotional
      );

      if (
        notional < MIN_POSITION_NOTIONAL
      ) {
        skippedSignals++;
        continue;
      }

      const market =
        dataset.markets[
          signal.marketIndex
        ];

      const exit =
        findExit(
          market,
          signal.candleIndex,
          signal.price,
          targetPct
        );

      const entryFee =
        notional * FEE_RATE;

      cash -=
        notional + entryFee;

      const position: Position = {
        id: nextPositionId++,
        marketIndex:
          signal.marketIndex,
        symbol: market.symbol,
        entryTime: signal.time,
        entryPrice: signal.price,
        notional,
        entryFee,
        targetPrice:
          signal.price *
          (1 + targetPct),
        stopPrice:
          signal.price *
          (1 - STOP_PCT),
        exitTime: exit.time,
        exitPrice: exit.price,
        exitReason:
          exit.reason,
        exitFee: 0,
        pnl: 0,
        returnPct: 0
      };

      const grossExitValue =
        notional *
        (exit.price / signal.price);

      position.exitFee =
        grossExitValue * FEE_RATE;

      position.pnl =
        grossExitValue -
        position.exitFee -
        notional -
        position.entryFee;

      position.returnPct =
        position.pnl / notional;

      openPositions.push(
        position
      );

      maximumConcurrentPositions =
        Math.max(
          maximumConcurrentPositions,
          openPositions.length
        );
    }

    const equity =
      getEquityAtTime(
        cash,
        openPositions,
        dataset,
        time
      );

    const invested =
      getInvestedValueAtTime(
        openPositions,
        dataset,
        time
      );

    const utilisation =
      startingCapital > 0
        ? invested / equity
        : 0;

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

    const drawdown =
      peakEquity - equity;

    const drawdownPct =
      peakEquity > 0
        ? drawdown / peakEquity
        : 0;

    maximumDrawdown =
      Math.max(
        maximumDrawdown,
        drawdown
      );

    maximumDrawdownPct =
      Math.max(
        maximumDrawdownPct,
        drawdownPct
      );

    totalOpenPositionCount +=
      openPositions.length;

    totalCapitalUtilisation +=
      utilisation;

    maximumCapitalUtilisation =
      Math.max(
        maximumCapitalUtilisation,
        utilisation
      );

    equityPointCount++;

    if (previousEquityTime > 0) {
      const deltaTime =
        time - previousEquityTime;

      if (deltaTime >= 0) {
        utilisationArea +=
          previousUtilisation(
            openPositions,
            dataset,
            previousEquityTime,
            startingCapital
          ) *
          deltaTime;

        observedDuration +=
          deltaTime;
      }
    }

    previousEquityTime = time;
  }

  /*
   * Any remaining positions at the end of the
   * timeline are settled at their already determined
   * exit price.
   */
  for (const position of openPositions) {
    cash +=
      position.notional *
        (position.exitPrice /
          position.entryPrice) -
      position.exitFee;

    completedPositions.push(
      position
    );
  }

  const finalEquity = cash;

  const winningTrades =
    completedPositions.filter(
      position => position.pnl > 0
    );

  const losingTrades =
    completedPositions.filter(
      position => position.pnl < 0
    );

  const grossProfit =
    winningTrades.reduce(
      (sum, position) =>
        sum + position.pnl,
      0
    );

  const grossLoss =
    Math.abs(
      losingTrades.reduce(
        (sum, position) =>
          sum + position.pnl,
        0
      )
    );

  const netPnl =
    completedPositions.reduce(
      (sum, position) =>
        sum + position.pnl,
      0
    );

  const totalFees =
    completedPositions.reduce(
      (sum, position) =>
        sum +
        position.entryFee +
        position.exitFee,
      0
    );

  const tradeReturns =
    completedPositions.map(
      position =>
        position.returnPct
    );

  const holdHours =
    completedPositions.map(
      position =>
        (position.exitTime -
          position.entryTime) /
        (60 * 60 * 1000)
    );

  const totalPositionHours =
    holdHours.reduce(
      (sum, hours) =>
        sum + hours,
      0
    );

  const averagePositionHours =
    holdHours.length > 0
      ? totalPositionHours /
        holdHours.length
      : 0;

  const averageCapitalUtilisationPct =
    equityPointCount > 0
      ? (totalCapitalUtilisation /
          equityPointCount) *
        100
      : 0;

  const timeWeightedUtilisationPct =
    observedDuration > 0
      ? (utilisationArea /
          observedDuration) *
        100
      : 0;

  /*
   * Use time-weighted utilisation for the headline
   * capital-utilisation measure. The simple average is
   * also useful and can be added later if needed.
   */
  const averageUtilisationPct =
    timeWeightedUtilisationPct ||
    averageCapitalUtilisationPct;

  const averageOpenPositions =
    equityPointCount > 0
      ? totalOpenPositionCount /
        equityPointCount
      : 0;

  const targetExits =
    completedPositions.filter(
      position =>
        position.exitReason ===
        'target'
    ).length;

  const stopExits =
    completedPositions.filter(
      position =>
        position.exitReason ===
        'stop'
    ).length;

  const maxHoldExits =
    completedPositions.filter(
      position =>
        position.exitReason ===
        'max_hold'
    ).length;

  const endOfDataExits =
    completedPositions.filter(
      position =>
        position.exitReason ===
        'end_of_data'
    ).length;

  return {
    dataset: datasetName,
    startingCapital,
    targetPct,

    finalEquity,

    returnPct:
      (finalEquity /
        startingCapital -
        1) *
      100,

    totalTrades:
      completedPositions.length,

    targetExits,
    stopExits,
    maxHoldExits,
    endOfDataExits,

    winningTrades:
      winningTrades.length,

    losingTrades:
      losingTrades.length,

    winRatePct:
      completedPositions.length > 0
        ? (winningTrades.length /
            completedPositions.length) *
          100
        : 0,

    grossProfit,
    grossLoss,
    netPnl,
    totalFees,

    profitFactor:
      grossLoss > 0
        ? grossProfit / grossLoss
        : Infinity,

    averageTradeReturnPct:
      tradeReturns.length > 0
        ? (tradeReturns.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
            tradeReturns.length) *
          100
        : 0,

    medianHoldHours:
      calculateMedian(
        holdHours
      ),

    maximumConcurrentPositions,
    averageOpenPositions,

    peakEquity,
    maximumDrawdown,
    maximumDrawdownPct:
      maximumDrawdownPct * 100,

    averageCapitalUtilisationPct:
      averageUtilisationPct,

    maximumCapitalUtilisationPct:
      maximumCapitalUtilisation * 100,

    totalPositionHours,
    averagePositionHours,

    signals: signals.length,
    skippedSignals
  };
}

function getEquityAtTime(
  cash: number,
  openPositions: Position[],
  dataset: Dataset,
  time: number
): number {
  let equity = cash;

  for (const position of openPositions) {
    const market =
      dataset.markets[
        position.marketIndex
      ];

    equity +=
      getPositionMarketValue(
        position,
        market,
        time
      );
  }

  return equity;
}

function getInvestedValueAtTime(
  openPositions: Position[],
  dataset: Dataset,
  time: number
): number {
  let invested = 0;

  for (const position of openPositions) {
    const market =
      dataset.markets[
        position.marketIndex
      ];

    invested +=
      getPositionMarketValue(
        position,
        market,
        time
      );
  }

  return invested;
}

function previousUtilisation(
  openPositions: Position[],
  dataset: Dataset,
  time: number,
  startingCapital: number
): number {
  if (
    openPositions.length === 0
  ) {
    return 0;
  }

  const invested =
    getInvestedValueAtTime(
      openPositions,
      dataset,
      time
    );

  const equity =
    startingCapital > 0
      ? Math.max(
          0.000000001,
          invested
        )
      : 1;

  return invested / equity;
}

/*
 * Create a common minute-by-minute timeline across
 * every market.
 *
 * All markets in this research are 1-minute data,
 * so this gives us the required mark-to-market
 * equity curve rather than sampling only on signals.
 */
function buildTimelineTimes(
  dataset: Dataset
): number[] {
  const times = new Set<number>();

  for (const market of dataset.markets) {
    for (const candle of market.candles) {
      times.add(candle.openTime);
    }
  }

  return Array.from(times).sort(
    (a, b) => a - b
  );
}

function printResult(
  result: BacktestResult
): void {
  console.log(
    [
      `${result.dataset.padEnd(8)}`,
      `£${result.startingCapital}`,
      `${(result.targetPct * 100).toFixed(0)}%`,
      `final £${result.finalEquity.toFixed(2)}`,
      `return ${result.returnPct >= 0 ? '+' : ''}${result.returnPct.toFixed(2)}%`,
      `DD ${result.maximumDrawdownPct.toFixed(2)}%`,
      `trades ${result.totalTrades}`,
      `PF ${Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(3) : '∞'}`
    ].join(' | ')
  );
}

function printTargetSummary(
  results: BacktestResult[]
): void {
  console.log('\nTarget comparison');

  console.log(
    'Target | Training £500 | OOS £500 | Training DD | OOS DD | Training Util | OOS Util'
  );

  console.log(
    '-------|---------------|----------|-------------|---------|---------------|---------'
  );

  for (const targetPct of TARGET_PCTS) {
    const training =
      results.find(
        result =>
          result.dataset ===
            'training' &&
          result.startingCapital ===
            500 &&
          result.targetPct ===
            targetPct
      );

    const oos =
      results.find(
        result =>
          result.dataset === 'oos' &&
          result.startingCapital ===
            500 &&
          result.targetPct ===
            targetPct
      );

    if (!training || !oos) {
      continue;
    }

    console.log(
      [
        `${(targetPct * 100).toFixed(0)}%`.padStart(
          6
        ),
        `| £${training.finalEquity.toFixed(2)}`.padStart(
          14
        ),
        `| £${oos.finalEquity.toFixed(2)}`.padStart(
          10
        ),
        `| ${training.maximumDrawdownPct.toFixed(2)}%`.padStart(
          11
        ),
        `| ${oos.maximumDrawdownPct.toFixed(2)}%`.padStart(
          8
        ),
        `| ${training.averageCapitalUtilisationPct.toFixed(1)}%`.padStart(
          13
        ),
        `| ${oos.averageCapitalUtilisationPct.toFixed(1)}%`.padStart(
          8
        )
      ].join('')
    );
  }
}

function printCrossCapitalSummary(
  results: BacktestResult[],
  datasetName: string
): void {
  console.log(
    `\n${datasetName.toUpperCase()} — return by target and starting capital`
  );

  const header =
    [
      'Target',
      ...STARTING_CAPITALS.map(
        capital =>
          `£${capital}`
      )
    ].join(' | ');

  console.log(header);
  console.log(
    '-'.repeat(header.length)
  );

  for (const targetPct of TARGET_PCTS) {
    const values =
      STARTING_CAPITALS.map(
        startingCapital => {
          const result =
            results.find(
              item =>
                item.dataset ===
                  datasetName &&
                item.startingCapital ===
                  startingCapital &&
                item.targetPct ===
                  targetPct
            );

          return result
            ? `${result.returnPct >= 0 ? '+' : ''}${result.returnPct.toFixed(2)}%`
            : 'n/a';
        }
      );

    console.log(
      [
        `${(targetPct * 100).toFixed(0)}%`,
        ...values
      ].join(' | ')
    );
  }
}

function validateSignalCount(
  configuration: Configuration,
  actual: number
): void {
  if (
    actual !==
    configuration.expectedSignals
  ) {
    throw new Error(
      [
        `Signal count validation failed for ${configuration.name}.`,
        `Expected ${configuration.expectedSignals}, got ${actual}.`,
        `This means the signal-generation logic or dataset has changed.`
      ].join(' ')
    );
  }

  console.log(
    `  Signal validation passed: ${actual.toLocaleString()} signals`
  );
}

function createOutputPath(): string {
  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true }
  );

  const timestamp =
    Date.now();

  return path.join(
    OUTPUT_DIR,
    `single-target-validation-${timestamp}.json`
  );
}

async function main(): Promise<void> {
  console.log(
    '============================================================'
  );
  console.log(
    'Single-target portfolio validation'
  );
  console.log(
    '============================================================'
  );

  console.log(
    '\nConfiguration:'
  );

  console.log(
    `  Targets:              ${TARGET_PCTS.map(value => `${value * 100}%`).join(', ')}`
  );

  console.log(
    `  Starting capital:     ${STARTING_CAPITALS.map(value => `£${value}`).join(', ')}`
  );

  console.log(
    `  Minimum position:     £${MIN_POSITION_NOTIONAL}`
  );

  console.log(
    `  Maximum position:     ${(MAX_POSITION_PCT * 100).toFixed(1)}% of equity`
  );

  console.log(
    `  Maximum positions:    ${MAX_CONCURRENT_POSITIONS}`
  );

  console.log(
    `  Stop loss:            ${(STOP_PCT * 100).toFixed(0)}%`
  );

  console.log(
    `  Maximum hold:         48 hours`
  );

  console.log(
    `  Fee:                  ${(FEE_RATE * 100).toFixed(2)}% per side`
  );

  console.log(
    '\nSignal thresholds:'
  );

  console.log(
    `  Slope:                ${SLOPE_THRESHOLD}`
  );

  console.log(
    `  Acceleration:         ${ACCELERATION_THRESHOLD}`
  );

  const allResults: BacktestResult[] =
    [];

  const datasetSummaries: Array<{
    name: string;
    markets: number;
    signals: number;
    firstTime: number;
    lastTime: number;
  }> = [];

  for (
    const configuration of DATASETS
  ) {
    console.log(
      '\n============================================================'
    );

    console.log(
      `${configuration.name.toUpperCase()} DATASET`
    );

    console.log(
      '============================================================'
    );

    const dataset =
      loadDataset(
        configuration
      );

    const {
      signals,
      signalCountByMarket
    } =
      prepareSignals(
        dataset
      );

    console.log(
      `\n  Markets: ${dataset.markets.length}`
    );

    console.log(
      `  Signals: ${signals.length.toLocaleString()}`
    );

    validateSignalCount(
      configuration,
      signals.length
    );

    if (
      signals.length === 0
    ) {
      throw new Error(
        `No signals generated for ${configuration.name}`
      );
    }

    const firstTime =
      signals[0].time;

    const lastTime =
      signals[
        signals.length - 1
      ].time;

    console.log(
      `  First signal: ${new Date(firstTime).toISOString()}`
    );

    console.log(
      `  Last signal:  ${new Date(lastTime).toISOString()}`
    );

    datasetSummaries.push({
      name:
        configuration.name,
      markets:
        dataset.markets.length,
      signals:
        signals.length,
      firstTime,
      lastTime
    });

    console.log(
      '\n  Running portfolio simulations...'
    );

    for (
      const startingCapital of
        STARTING_CAPITALS
    ) {
      for (
        const targetPct of
          TARGET_PCTS
      ) {
        const result =
          simulateRun(
            dataset,
            signals,
            configuration.name,
            startingCapital,
            targetPct
          );

        allResults.push(
          result
        );

        printResult(
          result
        );
      }
    }

    /*
     * Keep this available as a sanity check that
     * signal distribution itself has not changed.
     */
    const marketsWithSignals =
      signalCountByMarket.filter(
        count => count > 0
      ).length;

    console.log(
      `\n  Markets containing signals: ${marketsWithSignals}/${dataset.markets.length}`
    );
  }

  printTargetSummary(
    allResults
  );

  printCrossCapitalSummary(
    allResults,
    'training'
  );

  printCrossCapitalSummary(
    allResults,
    'oos'
  );

  const output = {
    metadata: {
      generatedAt:
        new Date().toISOString(),

      datasets:
        datasetSummaries,

      startingCapitals:
        STARTING_CAPITALS,

      targets:
        TARGET_PCTS,

      feeRate:
        FEE_RATE,

      stopPct:
        STOP_PCT,

      maximumHoldHours:
        48,

      minimumPositionNotional:
        MIN_POSITION_NOTIONAL,

      maximumPositionPct:
        MAX_POSITION_PCT,

      maximumConcurrentPositions:
        MAX_CONCURRENT_POSITIONS,

      slopeThreshold:
        SLOPE_THRESHOLD,

      accelerationThreshold:
        ACCELERATION_THRESHOLD,

      methodology: {
        signalGeneration:
          'Exact preserved implementation from original working runner',

        entry:
          'Signal candle close',

        target:
          'Full position sold at target',

        stop:
          '10% below entry',

        maximumHold:
          '48 hours',

        fees:
          '0.1% on entry and 0.1% on exit',

        sizing:
          'max(£10, 5% of current mark-to-market equity), capped by available cash',

        overlap:
          'Allowed',

        positionCap:
          '43 simultaneous positions',

        drawdown:
          'Mark-to-market equity sampled at every dataset candle',

        capitalUtilisation:
          'Time-weighted mark-to-market value of open positions divided by portfolio equity'
      }
    },

    results:
      allResults
  };

  const outputPath =
    createOutputPath();

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    '\n============================================================'
  );

  console.log(
    'COMPLETE'
  );

  console.log(
    '============================================================'
  );

  console.log(
    `Output: ${outputPath}`
  );

  console.log(
    `Results: ${allResults.length}`
  );

  console.log(
    `Expected: ${DATASETS.length * STARTING_CAPITALS.length * TARGET_PCTS.length}`
  );
}

main().catch(
  error => {
    console.error(
      '\nFatal error:'
    );

    console.error(
      error
    );

    process.exit(1);
  }
);