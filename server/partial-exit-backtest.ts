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

  maxOpenPositions: number;
  maxOpenMarkets: number;

  targetExitCounts: Record<string, number>;
  stopExitCount: number;
  endOfDataCount: number;

  firstTargetTimes: Record<string, number[]>;
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

/**
 * Transaction costs.
 *
 * Every transaction costs 0.1% of the actual monetary
 * value of that transaction.
 */
const FEE_RATE = 0.001;
const EXECUTION_COST = 0;

/**
 * One normalized unit of the asset is purchased
 * for every signal.
 *
 * The unit is NOT £1/$1.
 * Its value is:
 *
 *   quantity × market price
 */
const UNIT_SIZE = 1;

/**
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

    maxOpenPositions: 0,
    maxOpenMarkets: 0,

    targetExitCounts,
    stopExitCount: 0,
    endOfDataCount: 0,

    firstTargetTimes,
  };
}

/* -------------------------------------------------------------------------- */
/* Regression                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Calculates rolling regression slopes in O(1) per candle.
 *
 * Rather than calculating 20 or 50 regression points for every
 * candle, prefix sums allow both slopes to be calculated directly.
 */
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

    /**
     * Global-index weighted sum:
     *
     * Σ(globalIndex × price)
     *
     * Convert it to local x coordinates:
     *
     * localX = globalIndex - start
     */
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

/**
 * Builds the frozen signal once for a market.
 */
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

  for (let i = 49; i < candles.length; i++) {
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
    originalQuantity * entryPrice;

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

  /**
   * Track which targets have already been executed.
   *
   * This matters because a candle can jump through several
   * target levels.
   */
  const targetExecuted =
    config.targets.map(
      () => false
    );

  /**
   * Entry occurs at the close of the signal candle.
   *
   * Therefore begin checking exits from the next candle.
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

    /**
     * Stop gets priority over targets when both occur
     * during the same candle because OHLC data cannot tell
     * us which happened first.
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

      const grossPnl =
        saleValue -
        quantitySold * entryPrice;

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

    /**
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

      const grossPnl =
        saleValue -
        quantitySold * entryPrice;

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
      candles[candles.length - 1]
        .close;

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
/* Market simulation                                                           */
/* -------------------------------------------------------------------------- */

function processMarket(
  market: MarketData,
  configurations: Configuration[],
  statsByConfig: Map<
    string,
    RunningStats
  >
): void {
  const candles =
    market.candles;

  if (candles.length < 50) {
    return;
  }

  const signals =
    buildSignals(candles);

  for (
    let candleIndex = 49;
    candleIndex <
      candles.length;
    candleIndex++
  ) {
    if (!signals[candleIndex]) {
      continue;
    }

    for (
      const config of configurations
    ) {
      const stats =
        statsByConfig.get(
          config.name
        );

      if (!stats) {
        throw new Error(
          `Missing stats for ${config.name}`
        );
      }

      const position =
        simulatePosition(
          candles,
          candleIndex,
          config
        );

      stats.signals++;

      stats.realisedFees +=
        position.entryFee;

      stats.realisedNet +=
        position.realisedNet;

      /**
       * Calculate gross realised P/L and exit fees
       * from the individual exits.
       */
      for (
        const exit of position.exits
      ) {
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

          /**
           * First hit of this particular target.
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

      if (
        combinedPositionNet > 0
      ) {
        stats.winningPositions++;
        stats.grossProfit +=
          combinedPositionNet;
      } else if (
        combinedPositionNet < 0
      ) {
        stats.losingPositions++;
        stats.grossLoss +=
          Math.abs(
            combinedPositionNet
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
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Final statistics                                                            */
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

  const firstTargetTimes: Record<
    string,
    {
      count: number;
      averageMinutes: number;
      medianMinutes: number;
    }
  > = {};

  for (
    const target of config.targets
  ) {
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
            ) / times.length,

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

    signals: stats.signals,

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

    /**
     * These are market-level position counts.
     *
     * Since markets are processed independently,
     * the runner does not attempt to reconstruct a
     * simultaneous global portfolio.
     */
    maxOpenPositions:
      stats.maxOpenPositions,

    maxOpenMarkets:
      stats.maxOpenMarkets,

    maxDrawdown: 0,

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
/* Main                                                                        */
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

function main(): void {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Optimised partial-exit backtest"
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
        sum +
        market.candles.length,
      0
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
    "Entry signal:"
  );

  console.log(
    `  slope20 <= ${SLOPE_THRESHOLD}`
  );

  console.log(
    `  acceleration >= ${ACCELERATION_THRESHOLD}`
  );

  console.log("");

  const statsByConfig =
    new Map<
      string,
      RunningStats
    >();

  for (
    const config of CONFIGURATIONS
  ) {
    statsByConfig.set(
      config.name,
      createStats(config)
    );
  }

  const startTime =
    Date.now();

  let processedCandles = 0;

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

    const marketStart =
      Date.now();

    processMarket(
      market,
      CONFIGURATIONS,
      statsByConfig
    );

    processedCandles +=
      market.candles.length;

    const elapsed =
      Date.now() - startTime;

    const marketsCompleted =
      marketIndex + 1;

    const averagePerMarket =
      elapsed /
      marketsCompleted;

    const remainingMarkets =
      marketCount -
      marketsCompleted;

    const estimatedRemaining =
      averagePerMarket *
      remainingMarkets;

    const percent =
      (marketsCompleted /
        marketCount) *
      100;

    const marketTime =
      Date.now() -
      marketStart;

    console.log(
      [
        `[${marketsCompleted}/${marketCount}]`,
        `${percent.toFixed(1)}%`,
        market.symbol,
        `${market.candles.length.toLocaleString()} candles`,
        `market: ${formatDuration(marketTime)}`,
        `elapsed: ${formatDuration(elapsed)}`,
        `ETA: ${formatDuration(estimatedRemaining)}`,
      ].join(" | ")
    );
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

  const totalElapsed =
    Date.now() -
    startTime;

  console.log("");

  console.log(
    "============================================================"
  );

  console.log(
    `Completed ${marketCount}/${marketCount} markets`
  );

  console.log(
    `Processed ${processedCandles.toLocaleString()} candles`
  );

  console.log(
    `Total runtime: ${formatDuration(totalElapsed)}`
  );

  console.log(
    "============================================================"
  );

  console.log("");

  for (
    const result of results
  ) {
    console.log(
      result.name
    );

    console.log(
      `  Signals: ${result.signals.toLocaleString()}`
    );

    console.log(
      `  Win rate: ${(result.winRate * 100).toFixed(2)}%`
    );

    console.log(
      `  Average net: ${(result.averageNetPerOriginalUnit * 100).toFixed(4)}%`
    );

    console.log(
      `  Median net: ${(result.medianNetPerOriginalUnit * 100).toFixed(4)}%`
    );

    console.log(
      `  Profit factor: ${
        Number.isFinite(
          result.profitFactor
        )
          ? result.profitFactor.toFixed(3)
          : "Infinity"
      }`
    );

    console.log(
      `  Realised fees: ${result.realisedFees.toFixed(6)}`
    );

    console.log(
      `  Combined net: ${result.combinedNet.toFixed(6)}`
    );

    console.log("");
  }

  const output = {
    generatedAt:
      new Date().toISOString(),

    dataset: {
      path: DATASET_PATH,
      markets: marketCount,
      candles: totalCandles,
    },

    signal: {
      slope20: {
        operator: "<=",
        threshold:
          SLOPE_THRESHOLD,
      },

      acceleration: {
        operator: ">=",
        threshold:
          ACCELERATION_THRESHOLD,
      },
    },

    transactionCosts: {
      feeRate: FEE_RATE,
      executionCost:
        EXECUTION_COST,

      description:
        "Each buy and sell pays 0.1% of the actual monetary value of that transaction. Partial sale fees are calculated from the current sale value and have no relationship to the original purchase price.",
    },

    unitModel: {
      unitSize: UNIT_SIZE,

      description:
        "Each signal purchases one normalized unit of the asset. The monetary value of the purchase is entryPrice × quantity.",
    },

    runtime: {
      milliseconds:
        totalElapsed,

      formatted:
        formatDuration(
          totalElapsed
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
      `partial-exit-backtest-${Date.now()}.json`
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    `Results written to: ${outputPath}`
  );
}

main();