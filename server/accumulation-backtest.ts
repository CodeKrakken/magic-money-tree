import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SOURCE_FILE = "ema-data-1789061547934.json";

const SOURCE_PATH =
  process.argv[2] ??
  path.join(__dirname, "research-output", DEFAULT_SOURCE_FILE);

// Frozen entry signal.
const SLOPE20_THRESHOLD = -0.0001425851160546487;
const ACCELERATION_THRESHOLD = 0.00013986740450809692;

// Test the most interesting exit structures found by the grid.
const EXIT_CONFIGS = [
  { profitTarget: 0.005, stopLoss: 0.05 },
  { profitTarget: 0.005, stopLoss: 0.075 },
  { profitTarget: 0.005, stopLoss: 0.10 },

  { profitTarget: 0.0075, stopLoss: 0.05 },
  { profitTarget: 0.0075, stopLoss: 0.075 },
  { profitTarget: 0.0075, stopLoss: 0.10 },

  { profitTarget: 0.01, stopLoss: 0.05 },
  { profitTarget: 0.01, stopLoss: 0.075 },
  { profitTarget: 0.01, stopLoss: 0.10 },
];

// Every qualifying signal purchases one normalised unit.
const UNIT_SIZE = 1;

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

interface Lot {
  id: number;
  symbol: string;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  quantity: number;
}

type ExitReason = "profit" | "stop" | "end_of_data";

interface ClosedLot {
  id: number;
  symbol: string;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  quantity: number;
  grossReturn: number;
  netReturn: number;
  holdMinutes: number;
  exitReason: ExitReason;
}

interface EquityPoint {
  time: number;
  realised: number;
  unrealised: number;
  total: number;
  openLots: number;
  marketsWithPositions: number;
}

interface Summary {
  signals: number;
  closedLots: number;
  winningLots: number;
  losingLots: number;
  openLotsAtEnd: number;

  winRate: number;
  averageNetReturn: number;
  medianNetReturn: number;
  totalNetReturn: number;
  profitFactor: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  maximumOpenLots: number;
  maximumOpenMarkets: number;
  maximumDrawdown: number;

  exits: {
    profit: number;
    stop: number;
    endOfData: number;
  };
}

interface ConfigResult {
  profitTarget: number;
  profitTargetPercent: number;
  stopLoss: number;
  stopLossPercent: number;
  summary: Summary;
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

  positionModel: {
    unitSize: number;
    overlappingPositions: true;
    additionalUnitOnEverySignal: true;
    partialSelling: false;
    maxHoldMinutes: null;
  };

  costs: {
    feeRate: number;
    executionCost: number;
    totalCost: number;
  };

  results: ConfigResult[];
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

function calculateFeatures(
  candles: Candle[],
  index: number,
): Features | null {
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

function calculateDrawdown(points: EquityPoint[]): number {
  if (points.length === 0) {
    return 0;
  }

  let peak = points[0].total;
  let maximumDrawdown = 0;

  for (const point of points) {
    if (point.total > peak) {
      peak = point.total;
    }

    if (peak > 0) {
      const drawdown = (peak - point.total) / peak;

      if (drawdown > maximumDrawdown) {
        maximumDrawdown = drawdown;
      }
    }
  }

  return maximumDrawdown;
}

function createClosedLot(
  lot: Lot,
  candle: Candle,
  exitIndex: number,
  exitPrice: number,
  reason: ExitReason,
  totalCost: number,
): ClosedLot {
  const grossReturn =
    exitPrice / lot.entryPrice - 1;

  const netReturn =
    grossReturn - totalCost;

  return {
    id: lot.id,
    symbol: lot.symbol,
    entryIndex: lot.entryIndex,
    entryTime: lot.entryTime,
    entryPrice: lot.entryPrice,
    exitIndex,
    exitTime: candle.openTime,
    exitPrice,
    quantity: lot.quantity,
    grossReturn,
    netReturn,
    holdMinutes: exitIndex - lot.entryIndex,
    exitReason: reason,
  };
}

function summarise(
  closedLots: ClosedLot[],
  openLotsAtEnd: Lot[],
  equity: EquityPoint[],
): Summary {
  const netReturns = closedLots.map(
    (lot) => lot.netReturn,
  );

  const winning = closedLots.filter(
    (lot) => lot.netReturn > 0,
  );

  const losing = closedLots.filter(
    (lot) => lot.netReturn < 0,
  );

  const grossProfit = winning.reduce(
    (sum, lot) => sum + lot.netReturn,
    0,
  );

  const grossLoss = losing.reduce(
    (sum, lot) => sum + Math.abs(lot.netReturn),
    0,
  );

  const holdTimes = closedLots.map(
    (lot) => lot.holdMinutes,
  );

  return {
    signals:
      closedLots.length + openLotsAtEnd.length,

    closedLots: closedLots.length,

    winningLots: winning.length,

    losingLots: losing.length,

    openLotsAtEnd: openLotsAtEnd.length,

    winRate:
      closedLots.length === 0
        ? 0
        : winning.length / closedLots.length,

    averageNetReturn:
      netReturns.length === 0
        ? 0
        : netReturns.reduce(
            (sum, value) => sum + value,
            0,
          ) / netReturns.length,

    medianNetReturn: median(netReturns),

    totalNetReturn:
      netReturns.reduce(
        (sum, value) => sum + value,
        0,
      ),

    profitFactor:
      grossLoss === 0
        ? Infinity
        : grossProfit / grossLoss,

    averageHoldMinutes:
      holdTimes.length === 0
        ? 0
        : holdTimes.reduce(
            (sum, value) => sum + value,
            0,
          ) / holdTimes.length,

    medianHoldMinutes: median(holdTimes),

    maximumOpenLots:
      equity.length === 0
        ? 0
        : Math.max(
            ...equity.map(
              (point) => point.openLots,
            ),
          ),

    maximumOpenMarkets:
      equity.length === 0
        ? 0
        : Math.max(
            ...equity.map(
              (point) => point.marketsWithPositions,
            ),
          ),

    maximumDrawdown:
      calculateDrawdown(equity),

    exits: {
      profit: closedLots.filter(
        (lot) => lot.exitReason === "profit",
      ).length,

      stop: closedLots.filter(
        (lot) => lot.exitReason === "stop",
      ).length,

      endOfData: closedLots.filter(
        (lot) => lot.exitReason === "end_of_data",
      ).length,
    },
  };
}

function runConfiguration(
  dataset: Dataset,
  profitTarget: number,
  stopLoss: number,
): {
  summary: Summary;
  observationsExamined: number;
} {
  /*
   * Lots are kept independently.
   *
   * A new signal does not replace an existing position.
   * It adds another unit to the market.
   */
  const openLotsBySymbol = new Map<string, Lot[]>();

  const closedLots: ClosedLot[] = [];

  const equity: EquityPoint[] = [];

  let nextLotId = 1;
  let observationsExamined = 0;

  /*
   * Process all markets chronologically.
   *
   * Because every market has minute candles, we merge their
   * timelines rather than processing one market completely
   * before moving to the next.
   */
  const marketIndices = new Map<string, number>();

  for (const market of dataset.markets) {
    marketIndices.set(market.symbol, 50);
    openLotsBySymbol.set(market.symbol, []);
  }

  while (true) {
    let nextTime = Infinity;

    for (const market of dataset.markets) {
      const index =
        marketIndices.get(market.symbol)!;

      if (index < market.candles.length) {
        nextTime = Math.min(
          nextTime,
          market.candles[index].openTime,
        );
      }
    }

    if (nextTime === Infinity) {
      break;
    }

    /*
     * Process every market having a candle at this timestamp.
     */
    for (const market of dataset.markets) {
      let index =
        marketIndices.get(market.symbol)!;

      if (
        index >= market.candles.length ||
        market.candles[index].openTime !== nextTime
      ) {
        continue;
      }

      const candle = market.candles[index];

      observationsExamined += 1;

      const openLots =
        openLotsBySymbol.get(market.symbol)!;

      /*
       * First evaluate existing positions.
       */
      const remainingLots: Lot[] = [];

      for (const lot of openLots) {
        const profitPrice =
          lot.entryPrice *
          (1 + profitTarget);

        const stopPrice =
          lot.entryPrice *
          (1 - stopLoss);

        const hitProfit =
          candle.high >= profitPrice;

        const hitStop =
          candle.low <= stopPrice;

        /*
         * Conservative same-candle assumption:
         * stop happens before target.
         */
        if (hitStop) {
          closedLots.push(
            createClosedLot(
              lot,
              candle,
              index,
              stopPrice,
              "stop",
              TOTAL_COST,
            ),
          );

          continue;
        }

        if (hitProfit) {
          closedLots.push(
            createClosedLot(
              lot,
              candle,
              index,
              profitPrice,
              "profit",
              TOTAL_COST,
            ),
          );

          continue;
        }

        remainingLots.push(lot);
      }

      openLotsBySymbol.set(
        market.symbol,
        remainingLots,
      );

      /*
       * Now evaluate a new entry.
       *
       * This means a signal can open a new position even when
       * other positions in the same market are already open.
       */
      if (index < market.candles.length - 1) {
        const features = calculateFeatures(
          market.candles,
          index,
        );

        if (features && isSignal(features)) {
          remainingLots.push({
            id: nextLotId,
            symbol: market.symbol,
            entryIndex: index,
            entryTime: candle.openTime,
            entryPrice: candle.close,
            quantity: UNIT_SIZE,
          });

          nextLotId += 1;
        }
      }

      marketIndices.set(
        market.symbol,
        index + 1,
      );
    }

    /*
     * Calculate mark-to-market equity.
     *
     * Each unit has a notional value of 1 at entry.
     * We therefore measure returns rather than pretending
     * to know the user's actual account size.
     */
    let unrealised = 0;
    let openLots = 0;
    let marketsWithPositions = 0;

    for (const market of dataset.markets) {
      const lots =
        openLotsBySymbol.get(market.symbol)!;

      if (lots.length === 0) {
        continue;
      }

      marketsWithPositions += 1;
      openLots += lots.length;

      const index =
        Math.min(
          marketIndices.get(market.symbol)! - 1,
          market.candles.length - 1,
        );

      const price =
        market.candles[index].close;

      for (const lot of lots) {
        unrealised +=
          (price / lot.entryPrice - 1) *
          lot.quantity;
      }
    }

    const realised = closedLots.reduce(
      (sum, lot) => sum + lot.netReturn,
      0,
    );

    equity.push({
      time: nextTime,
      realised,
      unrealised,
      total: realised + unrealised,
      openLots,
      marketsWithPositions,
    });
  }

  /*
   * Close anything still open at the end of the dataset.
   * These are recorded separately as end_of_data rather than
   * pretending that an arbitrary target or stop was reached.
   */
  const openLotsAtEnd: Lot[] = [];

  for (const market of dataset.markets) {
    const lots =
      openLotsBySymbol.get(market.symbol)!;

    if (lots.length === 0) {
      continue;
    }

    const finalIndex =
      market.candles.length - 1;

    const finalCandle =
      market.candles[finalIndex];

    for (const lot of lots) {
      closedLots.push(
        createClosedLot(
          lot,
          finalCandle,
          finalIndex,
          finalCandle.close,
          "end_of_data",
          TOTAL_COST,
        ),
      );

      openLotsAtEnd.push(lot);
    }
  }

  return {
    summary: summarise(
      closedLots,
      openLotsAtEnd,
      equity,
    ),
    observationsExamined,
  };
}

function loadDataset(): Dataset {
  console.log(`Loading dataset: ${SOURCE_PATH}`);

  const raw = fs.readFileSync(
    SOURCE_PATH,
    "utf8",
  );

  const dataset =
    JSON.parse(raw) as Dataset;

  if (
    !dataset.markets ||
    !Array.isArray(dataset.markets)
  ) {
    throw new Error(
      "Dataset does not contain a markets array.",
    );
  }

  return dataset;
}

function main(): void {
  const dataset = loadDataset();

  const results: ConfigResult[] = [];

  let observationsExamined = 0;

  for (const config of EXIT_CONFIGS) {
    console.log(
      `\nTesting TP +${config.profitTarget * 100}% / ` +
      `SL -${config.stopLoss * 100}%`,
    );

    const result = runConfiguration(
      dataset,
      config.profitTarget,
      config.stopLoss,
    );

    observationsExamined =
      Math.max(
        observationsExamined,
        result.observationsExamined,
      );

    results.push({
      profitTarget: config.profitTarget,
      profitTargetPercent:
        config.profitTarget * 100,

      stopLoss: config.stopLoss,
      stopLossPercent:
        config.stopLoss * 100,

      summary: result.summary,
    });

    const summary = result.summary;

    console.log(
      [
        `trades=${summary.closedLots}`,
        `win=${(
          summary.winRate * 100
        ).toFixed(2)}%`,
        `avg=${(
          summary.averageNetReturn * 100
        ).toFixed(4)}%`,
        `PF=${summary.profitFactor.toFixed(3)}`,
        `total=${(
          summary.totalNetReturn * 100
        ).toFixed(2)}%`,
        `DD=${(
          summary.maximumDrawdown * 100
        ).toFixed(2)}%`,
        `medianHold=${summary.medianHoldMinutes.toFixed(
          1,
        )}m`,
        `maxLots=${summary.maximumOpenLots}`,
        `maxMarkets=${summary.maximumOpenMarkets}`,
      ].join(" | "),
    );
  }

  const output: Output = {
    generatedAt: new Date().toISOString(),
    sourceFile: SOURCE_PATH,
    markets: dataset.markets.length,
    observationsExamined,

    entryRule: {
      slope20LessThanOrEqual:
        SLOPE20_THRESHOLD,

      accelerationGreaterThanOrEqual:
        ACCELERATION_THRESHOLD,
    },

    positionModel: {
      unitSize: UNIT_SIZE,
      overlappingPositions: true,
      additionalUnitOnEverySignal: true,
      partialSelling: false,
      maxHoldMinutes: null,
    },

    costs: {
      feeRate: FEE_RATE,
      executionCost: EXECUTION_COST,
      totalCost: TOTAL_COST,
    },

    results,
  };

  const outputPath = path.join(
    __dirname,
    "research-output",
    `accumulation-backtest-${Date.now()}.json`,
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(output, null, 2),
  );

  console.log(
    `\nOutput written to: ${outputPath}`,
  );
}

main();
