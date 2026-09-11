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
  priceReturn: number;
  sellFraction: number;
}

interface Configuration {
  name: string;
  targets: Target[];
  stopLoss: number;
}

interface PositionLot {
  id: number;
  symbol: string;
  entryTime: number;
  entryPrice: number;

  /*
   * Fraction of the original unit still held.
   */
  remainingFraction: number;

  /*
   * Entry fee is paid once when the lot is opened.
   */
  entryFee: number;

  /*
   * Net realised P&L from partial exits so far.
   */
  realisedNetReturn: number;

  targetHits: boolean[];
}

interface Result {
  name: string;

  signals: number;
  fullyClosedLots: number;
  openLotsAtEnd: number;

  totalUnitsEntered: number;
  totalUnitsExited: number;
  totalUnitsRemaining: number;

  realisedNetReturn: number;
  unrealisedNetReturn: number;
  combinedNetReturn: number;

  averageNetReturnPerOriginalUnit: number;
  medianNetReturnPerOriginalUnit: number;

  winningLots: number;
  losingLots: number;
  winRate: number;

  profitFactor: number;

  maximumOpenLots: number;
  maximumOpenMarkets: number;
  maximumDrawdown: number;

  averageFirstTargetMinutes: number;
  medianFirstTargetMinutes: number;

  exits: {
    target1: number;
    target2: number;
    target3: number;
    stop: number;
    endOfData: number;
  };
}

const DATASET_PATH = path.resolve(
  __dirname,
  "research-output/ema-data-1789061547934.json",
);

const OUTPUT_DIR = path.resolve(
  __dirname,
  "research-output",
);

const FEE_RATE = 0.002;
const EXECUTION_COST = 0;

const ENTRY_SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ENTRY_ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const UNIT_SIZE = 1;

const CONFIGURATIONS: Configuration[] = [
  {
    name: "baseline_1pct_10pct",

    targets: [
      {
        priceReturn: 0.01,
        sellFraction: 1,
      },
    ],

    stopLoss: 0.10,
  },

  {
    name: "partial_0.5_1_2",

    targets: [
      {
        priceReturn: 0.005,
        sellFraction: 0.50,
      },
      {
        priceReturn: 0.01,
        sellFraction: 0.25,
      },
      {
        priceReturn: 0.02,
        sellFraction: 0.25,
      },
    ],

    stopLoss: 0.10,
  },

  {
    name: "delayed_partial_1_2_4",

    targets: [
      {
        priceReturn: 0.01,
        sellFraction: 0.50,
      },
      {
        priceReturn: 0.02,
        sellFraction: 0.25,
      },
      {
        priceReturn: 0.04,
        sellFraction: 0.25,
      },
    ],

    stopLoss: 0.10,
  },
];

function linearRegressionSlope(
  values: number[],
): number {
  const n = values.length;

  if (n < 2) {
    return 0;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];

    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator =
    n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  return (
    (n * sumXY - sumX * sumY) /
    denominator
  );
}

function calculateEntrySignal(
  candles: Candle[],
  index: number,
): boolean {
  if (index < 50) {
    return false;
  }

  const closes20 = candles
    .slice(index - 19, index + 1)
    .map((candle) => candle.close);

  const closes50 = candles
    .slice(index - 49, index + 1)
    .map((candle) => candle.close);

  const slope20 =
    linearRegressionSlope(closes20);

  const slope50 =
    linearRegressionSlope(closes50);

  const acceleration =
    slope20 - slope50;

  return (
    slope20 <= ENTRY_SLOPE_THRESHOLD &&
    acceleration >= ENTRY_ACCELERATION_THRESHOLD
  );
}

function percentile(
  values: number[],
  p: number,
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
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

function runConfiguration(
  configuration: Configuration,
  markets: MarketData[],
): Result {
  const lots: PositionLot[] = [];

  const firstTargetDurations: number[] = [];

  let nextLotId = 1;
  let signals = 0;

  let totalUnitsEntered = 0;
  let totalUnitsExited = 0;

  let realisedNetReturn = 0;

  let maximumOpenLots = 0;
  let maximumOpenMarkets = 0;

  /*
   * Portfolio equity is measured in normalised units.
   *
   * This is not a percentage account return.
   */
  let peakEquity = 0;
  let maximumDrawdown = 0;

  /*
   * Exit counters.
   */
  let target1Exits = 0;
  let target2Exits = 0;
  let target3Exits = 0;
  let stopExits = 0;

  /*
   * Flatten all candles into one chronological event stream.
   */
  const events: Array<{
    market: MarketData;
    index: number;
    candle: Candle;
  }> = [];

  for (const market of markets) {
    for (
      let index = 0;
      index < market.candles.length;
      index++
    ) {
      events.push({
        market,
        index,
        candle: market.candles[index],
      });
    }
  }

  events.sort(
    (a, b) =>
      a.candle.openTime -
      b.candle.openTime,
  );

  for (const event of events) {
    const {
      market,
      index,
      candle,
    } = event;

    /*
     * Process existing positions for this market.
     */
    for (const lot of lots) {
      if (
        lot.symbol !== market.symbol ||
        lot.remainingFraction <= 0
      ) {
        continue;
      }

      /*
       * Stop takes precedence over targets if both are
       * touched within the same candle.
       */
      const stopPrice =
        lot.entryPrice *
        (1 - configuration.stopLoss);

      if (candle.low <= stopPrice) {
        const fraction =
          lot.remainingFraction;

        const grossReturn =
          (stopPrice - lot.entryPrice) /
          lot.entryPrice;

        const grossPnl =
          grossReturn * fraction;

        const exitFee =
          (FEE_RATE + EXECUTION_COST) *
          fraction;

        const netPnl =
          grossPnl - exitFee;

        lot.realisedNetReturn +=
          netPnl;

        realisedNetReturn +=
          netPnl;

        totalUnitsExited +=
          fraction;

        lot.remainingFraction = 0;

        stopExits++;

        continue;
      }

      /*
       * Process targets in ascending order.
       *
       * A target is only allowed to execute once.
       */
      for (
        let targetIndex = 0;
        targetIndex <
        configuration.targets.length;
        targetIndex++
      ) {
        if (
          lot.remainingFraction <= 0 ||
          lot.targetHits[targetIndex]
        ) {
          continue;
        }

        const target =
          configuration.targets[targetIndex];

        const targetPrice =
          lot.entryPrice *
          (1 + target.priceReturn);

        if (
          candle.high < targetPrice
        ) {
          continue;
        }

        const fractionToSell =
          Math.min(
            lot.remainingFraction,
            target.sellFraction,
          );

        if (fractionToSell <= 0) {
          continue;
        }

        const grossReturn =
          (targetPrice - lot.entryPrice) /
          lot.entryPrice;

        const grossPnl =
          grossReturn * fractionToSell;

        const exitFee =
          (FEE_RATE + EXECUTION_COST) *
          fractionToSell;

        const netPnl =
          grossPnl - exitFee;

        lot.realisedNetReturn +=
          netPnl;

        realisedNetReturn +=
          netPnl;

        totalUnitsExited +=
          fractionToSell;

        lot.remainingFraction -=
          fractionToSell;

        lot.targetHits[targetIndex] =
          true;

        /*
         * Record time to first target.
         */
        if (targetIndex === 0) {
          firstTargetDurations.push(
            (candle.openTime -
              lot.entryTime) /
              60000,
          );
        }

        if (targetIndex === 0) {
          target1Exits++;
        } else if (targetIndex === 1) {
          target2Exits++;
        } else if (targetIndex === 2) {
          target3Exits++;
        }
      }
    }

    /*
     * Generate a new entry after processing the existing
     * position at this candle.
     *
     * This means the signal cannot immediately benefit from
     * the current candle's high or low.
     */
    if (
      calculateEntrySignal(
        market.candles,
        index,
      )
    ) {
      const entryFee =
        (FEE_RATE + EXECUTION_COST) *
        UNIT_SIZE;

      const lot: PositionLot = {
        id: nextLotId++,
        symbol: market.symbol,
        entryTime: candle.openTime,
        entryPrice: candle.close,
        remainingFraction: UNIT_SIZE,
        entryFee,
        realisedNetReturn:
          -entryFee,
        targetHits:
          configuration.targets.map(
            () => false,
          ),
      };

      lots.push(lot);

      realisedNetReturn -=
        entryFee;

      signals++;

      totalUnitsEntered +=
        UNIT_SIZE;
    }

    /*
     * Calculate current open exposure.
     */
    const openLots = lots.filter(
      (lot) =>
        lot.remainingFraction > 0,
    );

    const openMarkets = new Set(
      openLots.map(
        (lot) => lot.symbol,
      ),
    );

    maximumOpenLots = Math.max(
      maximumOpenLots,
      openLots.length,
    );

    maximumOpenMarkets = Math.max(
      maximumOpenMarkets,
      openMarkets.size,
    );

    /*
     * Mark all open positions to the current
     * candle for their respective market.
     *
     * We only need the current candle price for
     * positions in the current market because
     * positions in other markets have not changed.
     */
    let unrealisedNetReturn = 0;

    for (const lot of openLots) {
      const currentPrice =
        lot.symbol === market.symbol
          ? candle.close
          : undefined;

      if (currentPrice === undefined) {
        continue;
      }

      const grossReturn =
        (currentPrice -
          lot.entryPrice) /
        lot.entryPrice;

      const exitCost =
        (FEE_RATE + EXECUTION_COST) *
        lot.remainingFraction;

      unrealisedNetReturn +=
        grossReturn *
          lot.remainingFraction -
        exitCost;
    }

    /*
     * The above mark-to-market is only for the current
     * market, so for drawdown we calculate the complete
     * portfolio state separately below.
     *
     * Build latest prices for every market.
     */
    const latestPrices =
      new Map<string, number>();

    for (const currentEvent of events) {
      if (
        currentEvent.candle.openTime >
        candle.openTime
      ) {
        break;
      }

      latestPrices.set(
        currentEvent.market.symbol,
        currentEvent.candle.close,
      );
    }

    let portfolioUnrealised = 0;

    for (const lot of openLots) {
      const currentPrice =
        latestPrices.get(lot.symbol);

      if (currentPrice === undefined) {
        continue;
      }

      const grossReturn =
        (currentPrice -
          lot.entryPrice) /
        lot.entryPrice;

      const exitCost =
        (FEE_RATE + EXECUTION_COST) *
        lot.remainingFraction;

      portfolioUnrealised +=
        grossReturn *
          lot.remainingFraction -
        exitCost;
    }

    const equity =
      realisedNetReturn +
      portfolioUnrealised;

    peakEquity = Math.max(
      peakEquity,
      equity,
    );

    maximumDrawdown = Math.max(
      maximumDrawdown,
      peakEquity - equity,
    );
  }

  /*
   * Final prices.
   */
  const finalPrices =
    new Map<string, number>();

  for (const market of markets) {
    const finalCandle =
      market.candles[
        market.candles.length - 1
      ];

    if (finalCandle) {
      finalPrices.set(
        market.symbol,
        finalCandle.close,
      );
    }
  }

  let unrealisedNetReturn = 0;
  let openLotsAtEnd = 0;
  let totalUnitsRemaining = 0;

  const lotReturns: number[] = [];

  for (const lot of lots) {
    let totalLotNetReturn =
      lot.realisedNetReturn;

    if (lot.remainingFraction > 0) {
      openLotsAtEnd++;

      totalUnitsRemaining +=
        lot.remainingFraction;

      const finalPrice =
        finalPrices.get(
          lot.symbol,
        );

      if (finalPrice !== undefined) {
        const grossReturn =
          (finalPrice -
            lot.entryPrice) /
          lot.entryPrice;

        const exitCost =
          (FEE_RATE + EXECUTION_COST) *
          lot.remainingFraction;

        const remainingNetReturn =
          grossReturn *
            lot.remainingFraction -
          exitCost;

        unrealisedNetReturn +=
          remainingNetReturn;

        totalLotNetReturn +=
          remainingNetReturn;
      }
    }

    lotReturns.push(
      totalLotNetReturn,
    );
  }

  const fullyClosedLots =
    lots.filter(
      (lot) =>
        lot.remainingFraction <= 0,
    ).length;

  const winningLots =
    lotReturns.filter(
      (value) => value > 0,
    ).length;

  const losingLots =
    lotReturns.filter(
      (value) => value < 0,
    ).length;

  const grossProfits =
    lotReturns
      .filter(
        (value) => value > 0,
      )
      .reduce(
        (sum, value) =>
          sum + value,
        0,
      );

  const grossLosses =
    lotReturns
      .filter(
        (value) => value < 0,
      )
      .reduce(
        (sum, value) =>
          sum + Math.abs(value),
        0,
      );

  const profitFactor =
    grossLosses === 0
      ? Infinity
      : grossProfits /
        grossLosses;

  const combinedNetReturn =
    realisedNetReturn +
    unrealisedNetReturn;

  const averageNetReturnPerOriginalUnit =
    lotReturns.length === 0
      ? 0
      : lotReturns.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) / lotReturns.length;

  const medianNetReturnPerOriginalUnit =
    percentile(
      lotReturns,
      0.5,
    );

  const averageFirstTargetMinutes =
    firstTargetDurations.length === 0
      ? 0
      : firstTargetDurations.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        firstTargetDurations.length;

  const medianFirstTargetMinutes =
    percentile(
      firstTargetDurations,
      0.5,
    );

  return {
    name: configuration.name,

    signals,

    fullyClosedLots,

    openLotsAtEnd,

    totalUnitsEntered,

    totalUnitsExited,

    totalUnitsRemaining,

    realisedNetReturn,

    unrealisedNetReturn,

    combinedNetReturn,

    averageNetReturnPerOriginalUnit,

    medianNetReturnPerOriginalUnit,

    winningLots,

    losingLots,

    winRate:
      lotReturns.length === 0
        ? 0
        : winningLots /
          lotReturns.length,

    profitFactor,

    maximumOpenLots,

    maximumOpenMarkets,

    maximumDrawdown,

    averageFirstTargetMinutes,

    medianFirstTargetMinutes,

    exits: {
      target1: target1Exits,
      target2: target2Exits,
      target3: target3Exits,
      stop: stopExits,
      endOfData: openLotsAtEnd,
    },
  };
}

function main(): void {
  console.log(
    "Loading dataset...",
  );

  const dataset =
    JSON.parse(
      fs.readFileSync(
        DATASET_PATH,
        "utf8",
      ),
    ) as Dataset;

  const observations =
    dataset.markets.reduce(
      (sum, market) =>
        sum + market.candles.length,
      0,
    );

  console.log(
    `Markets: ${dataset.markets.length}`,
  );

  console.log(
    `Observations: ${observations.toLocaleString()}`,
  );

  console.log("");

  const results: Result[] = [];

  for (const configuration of CONFIGURATIONS) {
    console.log(
      `Running ${configuration.name}...`,
    );

    const result =
      runConfiguration(
        configuration,
        dataset.markets,
      );

    results.push(result);

    console.log(
      `  combined net: ${result.combinedNetReturn.toFixed(4)}`,
    );

    console.log(
      `  average/unit: ${(
        result.averageNetReturnPerOriginalUnit *
        100
      ).toFixed(4)}%`,
    );

    console.log(
      `  profit factor: ${
        Number.isFinite(
          result.profitFactor,
        )
          ? result.profitFactor.toFixed(3)
          : "Infinity"
      }`,
    );

    console.log(
      `  max open lots: ${result.maximumOpenLots}`,
    );

    console.log("");
  }

  const output = {
    generatedAt:
      new Date().toISOString(),

    sourceFile:
      "server/research-output/ema-data-1789061547934.json",

    markets:
      dataset.markets.length,

    observations,

    entryRule: {
      slope20LessThanOrEqual:
        ENTRY_SLOPE_THRESHOLD,

      accelerationGreaterThanOrEqual:
        ENTRY_ACCELERATION_THRESHOLD,
    },

    costs: {
      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,

      perTransaction:
        FEE_RATE +
        EXECUTION_COST,

      roundTripForFullUnit:
        (FEE_RATE +
          EXECUTION_COST) *
        2,
    },

    positionModel: {
      unitSize: UNIT_SIZE,
      overlappingPositions: true,
      additionalUnitOnEverySignal: true,
      independentLots: true,
      maxHoldMinutes: null,
    },

    configurations:
      CONFIGURATIONS,

    results,
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    },
  );

  const outputPath =
    path.join(
      OUTPUT_DIR,
      `partial-exit-backtest-${Date.now()}.json`,
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  console.log(
    "========================================",
  );

  console.log(
    "FINAL RESULTS",
  );

  console.log(
    "========================================",
  );

  for (const result of results) {
    console.log("");
    console.log(
      result.name,
    );

    console.log(
      `  Signals: ${result.signals.toLocaleString()}`,
    );

    console.log(
      `  Closed lots: ${result.fullyClosedLots.toLocaleString()}`,
    );

    console.log(
      `  Open lots at end: ${result.openLotsAtEnd.toLocaleString()}`,
    );

    console.log(
      `  Realised net: ${result.realisedNetReturn.toFixed(4)}`,
    );

    console.log(
      `  Unrealised net: ${result.unrealisedNetReturn.toFixed(4)}`,
    );

    console.log(
      `  Combined net: ${result.combinedNetReturn.toFixed(4)}`,
    );

    console.log(
      `  Average/original unit: ${(
        result.averageNetReturnPerOriginalUnit *
        100
      ).toFixed(4)}%`,
    );

    console.log(
      `  Median/original unit: ${(
        result.medianNetReturnPerOriginalUnit *
        100
      ).toFixed(4)}%`,
    );

    console.log(
      `  Win rate: ${(
        result.winRate *
        100
      ).toFixed(2)}%`,
    );

    console.log(
      `  Profit factor: ${
        Number.isFinite(
          result.profitFactor,
        )
          ? result.profitFactor.toFixed(3)
          : "Infinity"
      }`,
    );

    console.log(
      `  Max open lots: ${result.maximumOpenLots.toLocaleString()}`,
    );

    console.log(
      `  Max open markets: ${result.maximumOpenMarkets}`,
    );

    console.log(
      `  Max drawdown: ${result.maximumDrawdown.toFixed(4)}`,
    );

    console.log(
      `  First target average: ${result.averageFirstTargetMinutes.toFixed(1)}m`,
    );

    console.log(
      `  First target median: ${result.medianFirstTargetMinutes.toFixed(1)}m`,
    );

    console.log(
      `  Exits: T1=${result.exits.target1}, ` +
        `T2=${result.exits.target2}, ` +
        `T3=${result.exits.target3}, ` +
        `stop=${result.exits.stop}, ` +
        `end=${result.exits.endOfData}`,
    );
  }

  console.log("");

  console.log(
    `Output written to: ${outputPath}`,
  );
}

main();