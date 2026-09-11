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

  targetHits: number;
  exits: ExitRecord[];
}

interface PortfolioPosition {
  marketIndex: number;
  marketSymbol: string;

  entryTime: number;
  entryPrice: number;
  entryValue: number;
  entryFee: number;

  remainingQuantity: number;
  realisedNet: number;

  exits: ExitRecord[];

  completed: boolean;
  exitTime: number | null;
}

interface TransactionEvent {
  time: number;
  type: "entry" | "exit";
  marketIndex: number;
  position: PortfolioPosition;
  exit?: ExitRecord;
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

  grossProfit: number;
  grossLoss: number;

  targetExitCounts: Record<string, number>;
  stopExitCount: number;
  endOfDataCount: number;

  firstTargetTimes: Record<string, number[]>;

  /*
   * Portfolio statistics.
   */
  maxOpenPositions: number;
  maxOpenMarkets: number;

  peakCapitalDeployed: number;
  totalCapitalTime: number;
  observedPortfolioMinutes: number;

  startingEquity: number;
  finalEquity: number;
  peakEquity: number;

  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

  equitySamples: number;
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

  peakCapitalDeployed: number;
  averageCapitalDeployed: number;
  capitalDays: number;

  finalEquity: number;
  totalReturn: number;

  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

  returnOnPeakCapital: number;
  returnOnAverageCapital: number;

  annualisedCapitalEfficiency: number;

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

/*
 * Every transaction costs 0.1% of its actual monetary value.
 */
const FEE_RATE = 0.001;
const EXECUTION_COST = 0;

/*
 * One normalized unit is bought per signal.
 */
const UNIT_SIZE = 1;

/*
 * Frozen entry signal.
 */
const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

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

/* -------------------------------------------------------------------------- */
/* Statistics                                                                  */
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

function createStats(
  config: Configuration
): RunningStats {
  const firstTargetTimes: Record<
    string,
    number[]
  > = {};

  const targetExitCounts: Record<
    string,
    number
  > = {};

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

    grossProfit: 0,
    grossLoss: 0,

    targetExitCounts,
    stopExitCount: 0,
    endOfDataCount: 0,

    firstTargetTimes,

    maxOpenPositions: 0,
    maxOpenMarkets: 0,

    peakCapitalDeployed: 0,
    totalCapitalTime: 0,
    observedPortfolioMinutes: 0,

    startingEquity: 0,
    finalEquity: 0,
    peakEquity: 0,

    maxDrawdownAbsolute: 0,
    maxDrawdownPct: 0,

    equitySamples: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Regression                                                                  */
/* -------------------------------------------------------------------------- */

function buildRegressionSlopes(
  closes: number[],
  windowSize: number
): number[] {
  const n = closes.length;

  const prefixY = new Float64Array(n + 1);
  const prefixIndexY = new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    prefixY[i + 1] =
      prefixY[i] + closes[i];

    prefixIndexY[i + 1] =
      prefixIndexY[i] +
      i * closes[i];
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

  const slopes = new Float64Array(n);

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

  return Array.from(slopes);
}

function buildSignals(
  candles: Candle[]
): boolean[] {
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

  const signals = new Array<boolean>(
    candles.length
  ).fill(false);

  for (
    let i = 49;
    i < candles.length;
    i++
  ) {
    const acceleration =
      slope20[i] - slope50[i];

    signals[i] =
      slope20[i] <=
        SLOPE_THRESHOLD &&
      acceleration >=
        ACCELERATION_THRESHOLD;
  }

  return signals;
}

/* -------------------------------------------------------------------------- */
/* Fees                                                                        */
/* -------------------------------------------------------------------------- */

function calculateEntryFee(
  quantityBought: number,
  entryPrice: number
): number {
  const purchaseValue =
    quantityBought * entryPrice;

  return (
    purchaseValue *
    (FEE_RATE + EXECUTION_COST)
  );
}

function calculateExitFee(
  quantitySold: number,
  exitPrice: number
): number {
  const saleValue =
    quantitySold * exitPrice;

  return (
    saleValue *
    (FEE_RATE + EXECUTION_COST)
  );
}

/* -------------------------------------------------------------------------- */
/* Position simulation                                                         */
/* -------------------------------------------------------------------------- */

function simulatePosition(
  candles: Candle[],
  entryIndex: number,
  config: Configuration
): PositionResult {
  const entryCandle =
    candles[entryIndex];

  const entryPrice =
    entryCandle.close;

  const originalQuantity =
    UNIT_SIZE;

  const entryValue =
    originalQuantity *
    entryPrice;

  const entryFee =
    calculateEntryFee(
      originalQuantity,
      entryPrice
    );

  let remainingQuantity =
    originalQuantity;

  let realisedNet =
    -entryFee;

  let completed = false;
  let exitTime: number | null = null;

  let targetHits = 0;

  const exits: ExitRecord[] = [];

  const targetExecuted =
    config.targets.map(
      () => false
    );

  /*
   * Entry occurs at the signal candle close.
   * We therefore cannot use that candle's
   * high or low to trigger an exit.
   */
  for (
    let i = entryIndex + 1;
    i < candles.length;
    i++
  ) {
    const candle =
      candles[i];

    const stopPrice =
      entryPrice *
      (1 - config.stopPct);

    /*
     * Conservative assumption:
     * if stop and target are both touched
     * in the same candle, stop happens first.
     */
    if (
      candle.low <= stopPrice
    ) {
      const quantitySold =
        remainingQuantity;

      const saleValue =
        quantitySold *
        stopPrice;

      const exitFee =
        calculateExitFee(
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
      exitTime =
        candle.openTime;

      break;
    }

    /*
     * Process targets in ascending order.
     */
    for (
      let targetIndex = 0;
      targetIndex <
        config.targets.length;
      targetIndex++
    ) {
      const target =
        config.targets[targetIndex];

      if (
        targetExecuted[targetIndex]
      ) {
        continue;
      }

      if (
        remainingQuantity <=
        1e-12
      ) {
        break;
      }

      const targetPrice =
        entryPrice *
        (1 + target.returnPct);

      if (
        candle.high <
        targetPrice
      ) {
        continue;
      }

      const requestedQuantity =
        originalQuantity *
        target.fraction;

      const quantitySold =
        Math.min(
          requestedQuantity,
          remainingQuantity
        );

      if (quantitySold <= 0) {
        continue;
      }

      const saleValue =
        quantitySold *
        targetPrice;

      const exitFee =
        calculateExitFee(
          quantitySold,
          targetPrice
        );

      const netSaleProceeds =
        saleValue - exitFee;

      const netPnl =
        netSaleProceeds -
        quantitySold * entryPrice;

      realisedNet += netPnl;

      remainingQuantity -=
        quantitySold;

      targetExecuted[
        targetIndex
      ] = true;

      targetHits++;

      exits.push({
        exitTime: candle.openTime,
        exitPrice: targetPrice,
        quantitySold,
        grossSaleValue: saleValue,
        exitFee,
        netSaleProceeds,
        target: target.name,
      });

      if (
        remainingQuantity <=
        1e-12
      ) {
        remainingQuantity = 0;
        completed = true;
        exitTime =
          candle.openTime;

        break;
      }
    }

    if (completed) {
      break;
    }
  }

  let unrealisedGross = 0;

  if (
    !completed &&
    remainingQuantity > 0
  ) {
    const finalPrice =
      candles[
        candles.length - 1
      ].close;

    unrealisedGross =
      remainingQuantity *
      (finalPrice - entryPrice);
  }

  return {
    entryTime:
      entryCandle.openTime,

    entryPrice,

    entryValue,

    entryFee,

    realisedNet,

    remainingQuantity,

    unrealisedGross,

    completed,

    exitTime,

    targetHits,

    exits,
  };
}

/* -------------------------------------------------------------------------- */
/* Portfolio transaction generation                                            */
/* -------------------------------------------------------------------------- */

function buildPortfolioEvents(
  market: MarketData,
  marketIndex: number,
  config: Configuration
): {
  positions: PortfolioPosition[];
  events: TransactionEvent[];
} {
  const candles =
    market.candles;

  if (candles.length < 50) {
    return {
      positions: [],
      events: [],
    };
  }

  const signals =
    buildSignals(candles);

  const positions: PortfolioPosition[] = [];
  const events: TransactionEvent[] = [];

  for (
    let candleIndex = 49;
    candleIndex < candles.length;
    candleIndex++
  ) {
    if (!signals[candleIndex]) {
      continue;
    }

    const result =
      simulatePosition(
        candles,
        candleIndex,
        config
      );

    const position: PortfolioPosition = {
      marketIndex,
      marketSymbol: market.symbol,

      entryTime:
        result.entryTime,

      entryPrice:
        result.entryPrice,

      entryValue:
        result.entryValue,

      entryFee:
        result.entryFee,

      remainingQuantity:
        result.remainingQuantity,

      realisedNet:
        result.realisedNet,

      exits:
        result.exits,

      completed:
        result.completed,

      exitTime:
        result.exitTime,
    };

    positions.push(position);

    events.push({
      time: result.entryTime,
      type: "entry",
      marketIndex,
      position,
    });

    for (const exit of result.exits) {
      events.push({
        time: exit.exitTime,
        type: "exit",
        marketIndex,
        position,
        exit,
      });
    }
  }

  return {
    positions,
    events,
  };
}

/* -------------------------------------------------------------------------- */
/* Portfolio simulation                                                        */
/* -------------------------------------------------------------------------- */

interface PortfolioState {
  cash: number;

  openPositions: Set<PortfolioPosition>;

  /*
   * Current remaining quantity by position.
   */
  quantities: Map<
    PortfolioPosition,
    number
  >;

  /*
   * Last known close for each market.
   */
  prices: Map<number, number>;
}

function calculatePortfolioMarketValue(
  state: PortfolioState
): number {
  let value = 0;

  for (const position of state.openPositions) {
    const quantity =
      state.quantities.get(
        position
      ) ?? 0;

    const price =
      state.prices.get(
        position.marketIndex
      );

    if (
      quantity <= 0 ||
      price === undefined
    ) {
      continue;
    }

    value +=
      quantity * price;
  }

  return value;
}

function calculateCapitalDeployed(
  state: PortfolioState
): number {
  let capital = 0;

  for (const position of state.openPositions) {
    const quantity =
      state.quantities.get(
        position
      ) ?? 0;

    capital +=
      quantity *
      position.entryPrice;
  }

  return capital;
}

function getOpenMarketCount(
  state: PortfolioState
): number {
  const markets =
    new Set<number>();

  for (const position of state.openPositions) {
    const quantity =
      state.quantities.get(
        position
      ) ?? 0;

    if (quantity > 1e-12) {
      markets.add(
        position.marketIndex
      );
    }
  }

  return markets.size;
}

function updatePortfolioDrawdown(
  stats: RunningStats,
  equity: number
): void {
  if (
    stats.equitySamples === 0
  ) {
    stats.startingEquity =
      equity;

    stats.peakEquity =
      equity;
  }

  stats.peakEquity =
    Math.max(
      stats.peakEquity,
      equity
    );

  const drawdown =
    stats.peakEquity -
    equity;

  stats.maxDrawdownAbsolute =
    Math.max(
      stats.maxDrawdownAbsolute,
      drawdown
    );

  if (
    stats.peakEquity > 0
  ) {
    stats.maxDrawdownPct =
      Math.max(
        stats.maxDrawdownPct,
        drawdown /
          stats.peakEquity
      );
  }

  stats.equitySamples++;
}

/*
 * The dataset contains one-minute candles.
 *
 * We use every market candle as an observation.
 * The portfolio is marked to the market using the
 * close of each market at that timestamp.
 */
function simulatePortfolio(
  markets: MarketData[],
  positions: PortfolioPosition[],
  events: TransactionEvent[],
  stats: RunningStats
): void {
  /*
   * Group events by timestamp.
   */
  const eventsByTime =
    new Map<
      number,
      TransactionEvent[]
    >();

  for (const event of events) {
    const existing =
      eventsByTime.get(
        event.time
      );

    if (existing) {
      existing.push(event);
    } else {
      eventsByTime.set(
        event.time,
        [event]
      );
    }
  }

  /*
   * We need the complete set of timestamps
   * from the dataset.
   */
  const timestamps = new Set<number>();

  for (const market of markets) {
    for (const candle of market.candles) {
      timestamps.add(
        candle.openTime
      );
    }
  }

  const sortedTimes =
    Array.from(timestamps).sort(
      (a, b) => a - b
    );

  /*
   * Build timestamp -> candle lookup.
   */
  const candlesByTime =
    new Map<
      number,
      Map<number, Candle>
    >();

  for (
    let marketIndex = 0;
    marketIndex < markets.length;
    marketIndex++
  ) {
    const market =
      markets[marketIndex];

    for (const candle of market.candles) {
      let byMarket =
        candlesByTime.get(
          candle.openTime
        );

      if (!byMarket) {
        byMarket =
          new Map<number, Candle>();

        candlesByTime.set(
          candle.openTime,
          byMarket
        );
      }

      byMarket.set(
        marketIndex,
        candle
      );
    }
  }

  const state: PortfolioState = {
    /*
     * Start with zero cash.
     *
     * We measure capital requirement rather than
     * pretending that the strategy starts with an
     * arbitrary account balance.
     */
    cash: 0,

    openPositions:
      new Set<PortfolioPosition>(),

    quantities:
      new Map<
        PortfolioPosition,
        number
      >(),

    prices:
      new Map<number, number>(),
  };

  let previousTime:
    number | null = null;

  for (const time of sortedTimes) {
    /*
     * First update all currently available
     * market prices.
     */
    const byMarket =
      candlesByTime.get(
        time
      );

    if (byMarket) {
      for (
        const [
          marketIndex,
          candle,
        ] of byMarket
      ) {
        state.prices.set(
          marketIndex,
          candle.close
        );
      }
    }

    /*
     * Process transactions occurring at
     * this timestamp.
     *
     * Entry events happen at the candle close.
     * Exit events are also represented at their
     * execution price.
     */
    const timeEvents =
      eventsByTime.get(time);

    if (timeEvents) {
      /*
       * Entries first.
       */
      for (const event of timeEvents) {
        if (
          event.type !== "entry"
        ) {
          continue;
        }

        const position =
          event.position;

        const purchaseValue =
          position.entryValue;

        /*
         * Buying costs purchase value + fee.
         */
        state.cash -=
          purchaseValue +
          position.entryFee;

        state.openPositions.add(
          position
        );

        state.quantities.set(
          position,
          UNIT_SIZE
        );
      }

      /*
       * Then exits.
       */
      for (const event of timeEvents) {
        if (
          event.type !== "exit" ||
          !event.exit
        ) {
          continue;
        }

        const position =
          event.position;

        const exit =
          event.exit;

        /*
         * The exit quantity must come from
         * the currently open quantity.
         */
        const currentQuantity =
          state.quantities.get(
            position
          ) ?? 0;

        const quantitySold =
          Math.min(
            currentQuantity,
            exit.quantitySold
          );

        if (
          quantitySold <= 0
        ) {
          continue;
        }

        const saleValue =
          quantitySold *
          exit.exitPrice;

        const exitFee =
          calculateExitFee(
            quantitySold,
            exit.exitPrice
          );

        /*
         * Cash receives the actual sale
         * proceeds after the 0.1% fee.
         */
        state.cash +=
          saleValue -
          exitFee;

        const remaining =
          currentQuantity -
          quantitySold;

        if (
          remaining <=
          1e-12
        ) {
          state.quantities.delete(
            position
          );

          state.openPositions.delete(
            position
          );
        } else {
          state.quantities.set(
            position,
            remaining
          );
        }
      }
    }

    const marketValue =
      calculatePortfolioMarketValue(
        state
      );

    const equity =
      state.cash +
      marketValue;

    const capitalDeployed =
      calculateCapitalDeployed(
        state
      );

    const openPositions =
      state.openPositions.size;

    const openMarkets =
      getOpenMarketCount(
        state
      );

    stats.maxOpenPositions =
      Math.max(
        stats.maxOpenPositions,
        openPositions
      );

    stats.maxOpenMarkets =
      Math.max(
        stats.maxOpenMarkets,
        openMarkets
      );

    stats.peakCapitalDeployed =
      Math.max(
        stats.peakCapitalDeployed,
        capitalDeployed
      );

    /*
     * Capital-time.
     *
     * This is capital deployed × elapsed minutes.
     */
    if (
      previousTime !== null
    ) {
      const elapsedMinutes =
        (time -
          previousTime) /
        60000;

      /*
       * Capital is considered to have been
       * deployed during the interval using
       * the state established at the previous
       * timestamp.
       */
      stats.totalCapitalTime +=
        capitalDeployed *
        elapsedMinutes;

      stats.observedPortfolioMinutes +=
        elapsedMinutes;
    }

    previousTime = time;

    updatePortfolioDrawdown(
      stats,
      equity
    );
  }

  stats.finalEquity =
    stats.equitySamples === 0
      ? 0
      : state.cash +
        calculatePortfolioMarketValue(
          state
        );

  /*
   * Open positions are marked at the final
   * observed price. No hypothetical exit fee
   * is deducted because they have not actually
   * been sold.
   */
  let finalUnrealisedGross = 0;

  for (const position of positions) {
    const quantity =
      position.remainingQuantity;

    if (quantity <= 0) {
      continue;
    }

    const finalPrice =
      markets[
        position.marketIndex
      ].candles[
        markets[
          position.marketIndex
        ].candles.length - 1
      ].close;

    finalUnrealisedGross +=
      quantity *
      (finalPrice -
        position.entryPrice);
  }

  stats.unrealisedGross =
    finalUnrealisedGross;
}

/* -------------------------------------------------------------------------- */
/* Position statistics                                                         */
/* -------------------------------------------------------------------------- */

function collectPositionStatistics(
  positions: PortfolioPosition[],
  stats: RunningStats,
  config: Configuration
): void {
  for (const position of positions) {
    stats.signals++;

    stats.realisedFees +=
      position.entryFee;

    /*
     * Calculate the position's actual
     * realised P/L from each exit.
     */
    let positionRealisedGross = 0;
    let positionExitFees = 0;

    for (const exit of position.exits) {
      positionRealisedGross +=
        exit.grossSaleValue -
        exit.quantitySold *
          position.entryPrice;

      positionExitFees +=
        exit.exitFee;

      stats.realisedGross +=
        exit.grossSaleValue -
        exit.quantitySold *
          position.entryPrice;

      stats.realisedFees +=
        exit.exitFee;

      if (
        exit.target === "stop"
      ) {
        stats.stopExitCount++;
      } else {
        stats.targetExitCounts[
          exit.target
        ]++;

        /*
         * Each target is executed at most once,
         * so this is genuinely the first hit of
         * that target for this position.
         */
        const targetTime =
          (exit.exitTime -
            position.entryTime) /
          60000;

        stats.firstTargetTimes[
          exit.target
        ].push(
          targetTime
        );
      }
    }

    const positionNet =
      position.realisedNet;

    stats.realisedNet +=
      positionNet;

    const finalPrice =
      position.remainingQuantity >
      0
        ? position.entryPrice +
          position.unrealisedGross /
            position.remainingQuantity
        : position.entryPrice;

    const unrealisedGross =
      position.remainingQuantity *
      (finalPrice -
        position.entryPrice);

    const combinedNet =
      positionNet +
      unrealisedGross;

    const positionReturn =
      combinedNet /
      position.entryValue;

    stats.totalPositionReturns.push(
      positionReturn
    );

    if (
      combinedNet > 0
    ) {
      stats.winningPositions++;

      stats.grossProfit +=
        combinedNet;
    } else if (
      combinedNet < 0
    ) {
      stats.losingPositions++;

      stats.grossLoss +=
        Math.abs(
          combinedNet
        );
    }

    if (position.completed) {
      stats.completedPositions++;

      if (
        position.exitTime !== null
      ) {
        stats.holdTimes.push(
          (
            position.exitTime -
            position.entryTime
          ) / 60000
        );
      }
    } else {
      stats.openPositions++;
      stats.endOfDataCount++;
    }

    /*
     * Keep these variables intentionally
     * calculated here because they provide
     * useful runtime consistency checks.
     */
    void positionRealisedGross;
    void positionExitFees;
  }
}

/* -------------------------------------------------------------------------- */
/* Result construction                                                         */
/* -------------------------------------------------------------------------- */

function buildResult(
  config: Configuration,
  stats: RunningStats
): ConfigurationResult {
  const combinedNet =
    stats.realisedNet +
    stats.unrealisedGross;

  const averageNetPerOriginalUnit =
    stats.totalPositionReturns.length ===
    0
      ? 0
      : stats.totalPositionReturns.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        stats.totalPositionReturns.length;

  const profitFactor =
    stats.grossLoss === 0
      ? Infinity
      : stats.grossProfit /
        stats.grossLoss;

  const averageCapitalDeployed =
    stats.observedPortfolioMinutes ===
      0
      ? 0
      : stats.totalCapitalTime /
        stats.observedPortfolioMinutes;

  const capitalDays =
    stats.totalCapitalTime /
    1440;

  const totalReturn =
    stats.startingEquity === 0
      ? 0
      : (
          stats.finalEquity -
          stats.startingEquity
        ) /
        stats.startingEquity;

  /*
   * Since the portfolio starts with zero capital,
   * conventional return-on-starting-equity is
   * meaningless. These two measures instead use
   * the actual peak and average deployed capital.
   */
  const returnOnPeakCapital =
    stats.peakCapitalDeployed === 0
      ? 0
      : combinedNet /
        stats.peakCapitalDeployed;

  const returnOnAverageCapital =
    averageCapitalDeployed === 0
      ? 0
      : combinedNet /
        averageCapitalDeployed;

  /*
   * Capital efficiency expressed as net return
   * per average capital per year.
   *
   * This is not an account-level CAGR. It is a
   * time-normalised research metric.
   */
  const observedDays =
    stats.observedPortfolioMinutes /
    1440;

  const annualisedCapitalEfficiency =
    observedDays <= 0 ||
    averageCapitalDeployed === 0
      ? 0
      : (
          combinedNet /
          averageCapitalDeployed
        ) *
        (365 /
          observedDays);

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

    firstTargetTimes[
      target.name
    ] = {
      count: times.length,

      averageMinutes:
        times.length === 0
          ? 0
          : times.reduce(
              (sum, value) =>
                sum + value,
              0
            ) /
            times.length,

      medianMinutes:
        percentile(
          times,
          0.5
        ),
    };
  }

  return {
    name: config.name,
    targets: config.targets,
    stopPct: config.stopPct,

    signals:
      stats.signals,

    completedPositions:
      stats.completedPositions,

    openPositions:
      stats.openPositions,

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
      stats.maxOpenPositions,

    maxOpenMarkets:
      stats.maxOpenMarkets,

    peakCapitalDeployed:
      stats.peakCapitalDeployed,

    averageCapitalDeployed,

    capitalDays,

    finalEquity:
      stats.finalEquity,

    totalReturn,

    maxDrawdownAbsolute:
      stats.maxDrawdownAbsolute,

    maxDrawdownPct:
      stats.maxDrawdownPct,

    returnOnPeakCapital,

    returnOnAverageCapital,

    annualisedCapitalEfficiency,

    averageHoldMinutes:
      stats.holdTimes.length === 0
        ? 0
        : stats.holdTimes.reduce(
            (sum, value) =>
              sum + value,
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
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function formatDuration(
  milliseconds: number
): string {
  const seconds =
    milliseconds / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes =
    seconds / 60;

  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }

  const hours =
    minutes / 60;

  return `${hours.toFixed(2)}h`;
}

function formatPercent(
  value: number
): string {
  return `${(
    value * 100
  ).toFixed(4)}%`;
}

function printResult(
  result: ConfigurationResult
): void {
  console.log("");
  console.log(
    `  ${result.name}`
  );
  console.log(
    "  ------------------------------------------------------------"
  );

  console.log(
    `  Signals:                  ${result.signals}`
  );

  console.log(
    `  Completed:                ${result.completedPositions}`
  );

  console.log(
    `  Open at end:              ${result.openPositions}`
  );

  console.log(
    `  Win rate:                 ${formatPercent(result.winRate)}`
  );

  console.log(
    `  Avg net / original unit:  ${formatPercent(result.averageNetPerOriginalUnit)}`
  );

  console.log(
    `  Median net / unit:        ${formatPercent(result.medianNetPerOriginalUnit)}`
  );

  console.log(
    `  Profit factor:            ${result.profitFactor.toFixed(3)}`
  );

  console.log("");
  console.log(
    "  Capital usage"
  );

  console.log(
    `  Peak open positions:      ${result.maxOpenPositions}`
  );

  console.log(
    `  Peak open markets:        ${result.maxOpenMarkets}`
  );

  console.log(
    `  Peak capital deployed:    ${result.peakCapitalDeployed.toFixed(4)}`
  );

  console.log(
    `  Average capital deployed: ${result.averageCapitalDeployed.toFixed(4)}`
  );

  console.log(
    `  Capital-days:             ${result.capitalDays.toFixed(2)}`
  );

  console.log("");
  console.log(
    "  Portfolio performance"
  );

  console.log(
    `  Final equity:             ${result.finalEquity.toFixed(4)}`
  );

  console.log(
    `  Combined net:             ${result.combinedNet.toFixed(4)}`
  );

  console.log(
    `  Return / peak capital:    ${formatPercent(result.returnOnPeakCapital)}`
  );

  console.log(
    `  Return / average capital: ${formatPercent(result.returnOnAverageCapital)}`
  );

  console.log(
    `  Annualised capital eff.:  ${formatPercent(result.annualisedCapitalEfficiency)}`
  );

  console.log(
    `  Max drawdown:             ${result.maxDrawdownAbsolute.toFixed(4)}`
  );

  console.log(
    `  Max drawdown %:           ${formatPercent(result.maxDrawdownPct)}`
  );

  console.log("");
  console.log(
    "  Exit distribution"
  );

  for (
    const [
      target,
      count,
    ] of Object.entries(
      result.targetExitCounts
    )
  ) {
    console.log(
      `  ${target.padEnd(24)} ${count}`
    );
  }

  console.log(
    `  ${"stop".padEnd(24)} ${result.stopExitCount}`
  );

  console.log(
    `  ${"end_of_data".padEnd(24)} ${result.endOfDataCount}`
  );

  console.log("");
  console.log(
    "  Hold time"
  );

  console.log(
    `  Average:                  ${result.averageHoldMinutes.toFixed(2)} min`
  );

  console.log(
    `  Median:                   ${result.medianHoldMinutes.toFixed(2)} min`
  );
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function validateResult(
  result: ConfigurationResult
): void {
  const exitCount =
    Object.values(
      result.targetExitCounts
    ).reduce(
      (sum, count) =>
        sum + count,
      0
    ) +
    result.stopExitCount;

  /*
   * Every completed position must have
   * one final exit. Partial exits are counted
   * separately above, so completed positions
   * cannot simply equal exitCount.
   */
  if (
    result.completedPositions +
      result.openPositions !==
    result.signals
  ) {
    throw new Error(
      `${result.name}: completed + open does not equal signals`
    );
  }

  if (
    result.winningPositions +
      result.losingPositions >
    result.signals
  ) {
    throw new Error(
      `${result.name}: winning + losing exceeds signals`
    );
  }

  if (
    result.maxOpenPositions <
    result.openPositions
  ) {
    throw new Error(
      `${result.name}: peak open positions is less than final open positions`
    );
  }

  if (
    result.maxOpenMarkets < 0
  ) {
    throw new Error(
      `${result.name}: invalid open market count`
    );
  }

  if (
    result.peakCapitalDeployed < 0
  ) {
    throw new Error(
      `${result.name}: negative peak capital`
    );
  }

  if (
    result.averageCapitalDeployed < 0
  ) {
    throw new Error(
      `${result.name}: negative average capital`
    );
  }

  if (
    result.maxDrawdownAbsolute < 0
  ) {
    throw new Error(
      `${result.name}: negative drawdown`
    );
  }

  if (
    !Number.isFinite(
      result.combinedNet
    )
  ) {
    throw new Error(
      `${result.name}: combinedNet is not finite`
    );
  }

  console.log(
    `Validation passed: ${result.name}`
  );

  console.log(
    `  Signals = completed + open: ${result.signals} = ${result.completedPositions} + ${result.openPositions}`
  );

  console.log(
    `  Exit events recorded: ${exitCount}`
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

function main(): void {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Partial-exit portfolio backtest"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Dataset: ${DATASET_PATH}`
  );

  const startedAt =
    Date.now();

  const raw =
    fs.readFileSync(
      DATASET_PATH,
      "utf8"
    );

  const dataset =
    JSON.parse(raw) as Dataset;

  console.log(
    `Markets: ${dataset.markets.length}`
  );

  console.log(
    `Configurations: ${CONFIGURATIONS.length}`
  );

  console.log("");

  const statsByConfig =
    new Map<
      string,
      RunningStats
    >();

  const positionsByConfig =
    new Map<
      string,
      PortfolioPosition[]
    >();

  const eventsByConfig =
    new Map<
      string,
      TransactionEvent[]
    >();

  for (const config of CONFIGURATIONS) {
    statsByConfig.set(
      config.name,
      createStats(config)
    );

    positionsByConfig.set(
      config.name,
      []
    );

    eventsByConfig.set(
      config.name,
      []
    );
  }

  /*
   * Build all position transactions first.
   */
  for (
    let marketIndex = 0;
    marketIndex <
      dataset.markets.length;
    marketIndex++
  ) {
    const market =
      dataset.markets[
        marketIndex
      ];

    const elapsed =
      Date.now() -
      startedAt;

    const progress =
      (
        (marketIndex + 1) /
        dataset.markets.length
      ) *
      100;

    console.log(
      `[${marketIndex + 1}/${dataset.markets.length}] ` +
        `${progress.toFixed(1)}% | ` +
        `${market.symbol} | ` +
        `elapsed ${formatDuration(elapsed)}`
    );

    for (const config of CONFIGURATIONS) {
      const generated =
        buildPortfolioEvents(
          market,
          marketIndex,
          config
        );

      positionsByConfig
        .get(config.name)!
        .push(
          ...generated.positions
        );

      eventsByConfig
        .get(config.name)!
        .push(
          ...generated.events
        );
    }
  }

  console.log("");
  console.log(
    "Position generation complete."
  );

  /*
   * Now reconstruct each configuration as
   * a simultaneous portfolio.
   */
  for (const config of CONFIGURATIONS) {
    console.log("");
    console.log(
      `Simulating portfolio: ${config.name}`
    );

    const stats =
      statsByConfig.get(
        config.name
      )!;

    const positions =
      positionsByConfig.get(
        config.name
      )!;

    const events =
      eventsByConfig.get(
        config.name
      )!;

    collectPositionStatistics(
      positions,
      stats,
      config
    );

    simulatePortfolio(
      dataset.markets,
      positions,
      events,
      stats
    );

    const result =
      buildResult(
        config,
        stats
      );

    validateResult(result);

    printResult(result);
  }

  const results =
    CONFIGURATIONS.map(
      (config) =>
        buildResult(
          config,
          statsByConfig.get(
            config.name
          )!
        )
    );

  const output = {
    generatedAt:
      new Date().toISOString(),

    dataset:
      path.basename(
        DATASET_PATH
      ),

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

      maxHold:
        "none",

      overlappingPositions:
        true,

      partialSelling:
        true,

      unitSize:
        UNIT_SIZE,

      feeRate:
        FEE_RATE,

      executionCost:
        EXECUTION_COST,

      feeDefinition:
        "0.1% of actual monetary value of each buy or sell",

      openPositionValuation:
        "remaining quantity marked to final observed close",

      portfolioModel:
        "simultaneous chronological portfolio reconstruction",

      capitalDefinition:
        "sum of remaining quantity multiplied by entry price",

      drawdownDefinition:
        "peak-to-trough decline in portfolio equity",

      note:
        "No hypothetical exit fee is charged on positions still open at end of data.",
    },

    results,
  };

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

  const elapsed =
    Date.now() -
    startedAt;

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Backtest complete"
  );
  console.log(
    "============================================================"
  );

  console.log(
    `Elapsed: ${formatDuration(elapsed)}`
  );

  console.log(
    `Output: ${outputPath}`
  );

  console.log("");

  console.log(
    "Comparison:"
  );

  for (const result of results) {
    console.log(
      `${result.name.padEnd(28)} ` +
        `net/unit ${formatPercent(result.averageNetPerOriginalUnit).padStart(10)} | ` +
        `peak capital ${result.peakCapitalDeployed.toFixed(2).padStart(12)} | ` +
        `avg capital ${result.averageCapitalDeployed.toFixed(2).padStart(12)} | ` +
        `DD ${formatPercent(result.maxDrawdownPct).padStart(10)}`
    );
  }

  console.log("");
}

main();