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

interface RawMarket {
  symbol: string;
  candles: Candle[];
}

interface RawDataset {
  markets: RawMarket[];
}

interface FeatureValues {
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
  exitReason:
    | "target"
    | "stop"
    | "timeout";
  holdingMinutes: number;
}

interface ExitParameters {
  target: number;
  stop: number;
  maxHoldMinutes: number;
}

interface ExitSummary {
  parameters: ExitParameters;
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  averageGrossReturn: number;
  averageNetReturn: number;
  medianNetReturn: number;
  totalNetReturn: number;
  compoundedReturn: number;
  maximumDrawdown: number;
  averageHoldingMinutes: number;
  targetRate: number;
  stopRate: number;
  timeoutRate: number;
}

interface OosResult {
  parameters: ExitParameters;
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  averageGrossReturn: number;
  averageNetReturn: number;
  medianNetReturn: number;
  totalNetReturn: number;
  compoundedReturn: number;
  maximumDrawdown: number;
  averageHoldingMinutes: number;
  targetRate: number;
  stopRate: number;
  timeoutRate: number;
}

interface Output {
  generatedAt: string;
  sourceFile: string;

  signal: {
    conditions: Array<{
      feature: string;
      operator: string;
      percentile: number;
      threshold: number;
    }>;
  };

  discovery: {
    start: string | null;
    end: string | null;
    observations: number;
    parameterTests: number;
    rankedResults: ExitSummary[];
    selectedParameters: ExitParameters | null;
    selectedDiscoveryResult: ExitSummary | null;
  };

  outOfSample: {
    start: string | null;
    end: string | null;
    observations: number;
    result: OosResult | null;
  };

  assumptions: {
    totalCost: number;
    cooldownMinutes: number;
    ambiguousCandle: string;
    entryPrice: string;
    timeoutExit: string;
  };
}

const TOTAL_COST = 0.002;
const TRAIN_RATIO = 0.7;
const COOLDOWN_MINUTES = 60;

const MIN_LOOKBACK = 50;

const TARGETS = [
  0.002,
  0.003,
  0.005,
  0.0075,
  0.01,
];

const STOPS = [
  0.002,
  0.003,
  0.005,
  0.0075,
  0.01,
];

const MAX_HOLDS = [
  10,
  20,
  30,
  50,
  75,
  120,
];

const SIGNAL = {
  slope20: -0.00014247403014451264,
  acceleration: 0.0001391412049997598,
};

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0,
    ) / values.length
  );
}

function percentile(
  values: number[],
  percentileValue: number,
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const index =
    (percentileValue / 100) *
    (sorted.length - 1);

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
  return percentile(values, 50);
}

function calculateSlope(
  prices: number[],
): number {
  if (prices.length < 2) {
    return 0;
  }

  const n = prices.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i += 1) {
    const price = prices[i];

    sumX += i;
    sumY += price;
    sumXY += i * price;
    sumXX += i * i;
  }

  const denominator =
    n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  const slope =
    (n * sumXY - sumX * sumY) /
    denominator;

  const averagePrice =
    sumY / n;

  if (averagePrice === 0) {
    return 0;
  }

  return slope / averagePrice;
}

function calculateFeatures(
  market: RawMarket,
  index: number,
): FeatureValues | null {
  if (index < MIN_LOOKBACK) {
    return null;
  }

  const current =
    market.candles[index];

  if (!current) {
    return null;
  }

  const currentPrice =
    current.close;

  if (
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return null;
  }

  const prices20: number[] = [];
  const prices50: number[] = [];

  for (
    let i = index - 20;
    i <= index;
    i += 1
  ) {
    prices20.push(
      market.candles[i].close,
    );
  }

  for (
    let i = index - 50;
    i <= index;
    i += 1
  ) {
    prices50.push(
      market.candles[i].close,
    );
  }

  const slope20 =
    calculateSlope(prices20);

  const slope50 =
    calculateSlope(prices50);

  return {
    slope20,
    slope50,
    acceleration:
      slope20 - slope50,
  };
}

function matchesSignal(
  features: FeatureValues,
): boolean {
  return (
    features.slope20 <=
      SIGNAL.slope20 &&
    features.acceleration >=
      SIGNAL.acceleration
  );
}

function findSplitTimestamp(
  dataset: RawDataset,
): number {
  const timestamps: number[] = [];

  for (const market of dataset.markets) {
    for (const candle of market.candles) {
      timestamps.push(candle.openTime);
    }
  }

  timestamps.sort(
    (a, b) => a - b,
  );

  const uniqueTimestamps =
    Array.from(
      new Set(timestamps),
    );

  const splitIndex = Math.floor(
    uniqueTimestamps.length *
      TRAIN_RATIO,
  );

  return uniqueTimestamps[
    splitIndex
  ];
}

/**
 * Determines the exit for one signal occurrence.
 *
 * Entry is the close of the signal candle.
 *
 * For each subsequent candle:
 * - target hit only -> target
 * - stop hit only -> stop
 * - both hit -> STOP, conservatively
 * - neither -> continue
 *
 * If neither target nor stop is hit before maxHold,
 * the position exits at the close of the final candle.
 */
function simulateTrade(
  market: RawMarket,
  entryIndex: number,
  parameters: ExitParameters,
): Trade | null {
  const entry =
    market.candles[entryIndex];

  if (!entry) {
    return null;
  }

  const entryPrice =
    entry.close;

  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0
  ) {
    return null;
  }

  const targetPrice =
    entryPrice *
    (1 + parameters.target);

  const stopPrice =
    entryPrice *
    (1 - parameters.stop);

  const endIndex = Math.min(
    entryIndex +
      parameters.maxHoldMinutes,
    market.candles.length - 1,
  );

  if (endIndex <= entryIndex) {
    return null;
  }

  for (
    let index = entryIndex + 1;
    index <= endIndex;
    index += 1
  ) {
    const candle =
      market.candles[index];

    const targetHit =
      candle.high >= targetPrice;

    const stopHit =
      candle.low <= stopPrice;

    /*
     * Conservative treatment of a candle where
     * both levels are touched:
     *
     * assume the stop happened first.
     */
    if (targetHit && stopHit) {
      const exitPrice = stopPrice;
      const grossReturn =
        exitPrice / entryPrice - 1;

      return {
        symbol: market.symbol,
        entryIndex,
        entryTime: entry.openTime,
        entryPrice,
        exitIndex: index,
        exitTime: candle.openTime,
        exitPrice,
        grossReturn,
        netReturn:
          grossReturn - TOTAL_COST,
        exitReason: "stop",
        holdingMinutes:
          index - entryIndex,
      };
    }

    if (stopHit) {
      const exitPrice = stopPrice;
      const grossReturn =
        exitPrice / entryPrice - 1;

      return {
        symbol: market.symbol,
        entryIndex,
        entryTime: entry.openTime,
        entryPrice,
        exitIndex: index,
        exitTime: candle.openTime,
        exitPrice,
        grossReturn,
        netReturn:
          grossReturn - TOTAL_COST,
        exitReason: "stop",
        holdingMinutes:
          index - entryIndex,
      };
    }

    if (targetHit) {
      const exitPrice =
        targetPrice;

      const grossReturn =
        exitPrice / entryPrice - 1;

      return {
        symbol: market.symbol,
        entryIndex,
        entryTime: entry.openTime,
        entryPrice,
        exitIndex: index,
        exitTime: candle.openTime,
        exitPrice,
        grossReturn,
        netReturn:
          grossReturn - TOTAL_COST,
        exitReason: "target",
        holdingMinutes:
          index - entryIndex,
      };
    }
  }

  const exit =
    market.candles[endIndex];

  const exitPrice =
    exit.close;

  const grossReturn =
    exitPrice / entryPrice - 1;

  return {
    symbol: market.symbol,
    entryIndex,
    entryTime: entry.openTime,
    entryPrice,
    exitIndex: endIndex,
    exitTime: exit.openTime,
    exitPrice,
    grossReturn,
    netReturn:
      grossReturn - TOTAL_COST,
    exitReason: "timeout",
    holdingMinutes:
      endIndex - entryIndex,
  };
}

function calculateMaximumDrawdown(
  returns: number[],
): number {
  if (returns.length === 0) {
    return 0;
  }

  let equity = 1;
  let peak = 1;
  let maximumDrawdown = 0;

  for (const returnValue of returns) {
    equity *=
      1 + returnValue;

    peak = Math.max(
      peak,
      equity,
    );

    const drawdown =
      equity / peak - 1;

    maximumDrawdown =
      Math.min(
        maximumDrawdown,
        drawdown,
      );
  }

  return maximumDrawdown;
}

function calculateCompoundedReturn(
  returns: number[],
): number {
  let equity = 1;

  for (const returnValue of returns) {
    equity *=
      1 + returnValue;
  }

  return equity - 1;
}

function summariseTrades(
  parameters: ExitParameters,
  trades: Trade[],
): ExitSummary {
  const netReturns =
    trades.map(
      (trade) => trade.netReturn,
    );

  const wins =
    trades.filter(
      (trade) =>
        trade.netReturn > 0,
    ).length;

  const losses =
    trades.filter(
      (trade) =>
        trade.netReturn <= 0,
    ).length;

  const targets =
    trades.filter(
      (trade) =>
        trade.exitReason ===
        "target",
    ).length;

  const stops =
    trades.filter(
      (trade) =>
        trade.exitReason ===
        "stop",
    ).length;

  const timeouts =
    trades.filter(
      (trade) =>
        trade.exitReason ===
        "timeout",
    ).length;

  return {
    parameters,

    trades: trades.length,

    wins,
    losses,
    timeouts,

    winRate:
      trades.length === 0
        ? 0
        : wins / trades.length,

    averageGrossReturn:
      mean(
        trades.map(
          (trade) =>
            trade.grossReturn,
        ),
      ),

    averageNetReturn:
      mean(netReturns),

    medianNetReturn:
      median(netReturns),

    totalNetReturn:
      netReturns.reduce(
        (sum, value) =>
          sum + value,
        0,
      ),

    compoundedReturn:
      calculateCompoundedReturn(
        netReturns,
      ),

    maximumDrawdown:
      calculateMaximumDrawdown(
        netReturns,
      ),

    averageHoldingMinutes:
      mean(
        trades.map(
          (trade) =>
            trade.holdingMinutes,
        ),
      ),

    targetRate:
      trades.length === 0
        ? 0
        : targets / trades.length,

    stopRate:
      trades.length === 0
        ? 0
        : stops / trades.length,

    timeoutRate:
      trades.length === 0
        ? 0
        : timeouts / trades.length,
  };
}

/**
 * Runs the actual sequential trading simulation.
 *
 * This is deliberately different from the forward-return
 * analysis. Once a trade is entered, the strategy cannot
 * enter another trade in the same market until the exit
 * plus the cooldown period.
 */
function simulatePeriod(
  dataset: RawDataset,
  parameters: ExitParameters,
  startTimestamp: number,
  endTimestamp: number,
): {
  trades: Trade[];
  observations: number;
} {
  const trades: Trade[] = [];

  let observations = 0;

  for (const market of dataset.markets) {
    let nextAllowedEntryTime =
      startTimestamp;

    const lastEntryIndex =
      market.candles.length -
      parameters.maxHoldMinutes;

    for (
      let index = MIN_LOOKBACK;
      index < lastEntryIndex;
      index += 1
    ) {
      const candle =
        market.candles[index];

      if (
        candle.openTime <
        startTimestamp
      ) {
        continue;
      }

      if (
        candle.openTime >=
        endTimestamp
      ) {
        break;
      }

      if (
        candle.openTime <
        nextAllowedEntryTime
      ) {
        continue;
      }

      const features =
        calculateFeatures(
          market,
          index,
        );

      if (
        !features ||
        !matchesSignal(features)
      ) {
        continue;
      }

      observations += 1;

      const trade =
        simulateTrade(
          market,
          index,
          parameters,
        );

      if (!trade) {
        continue;
      }

      trades.push(trade);

      /*
       * The cooldown starts after the trade exits,
       * not after the entry.
       */
      nextAllowedEntryTime =
        trade.exitTime +
        COOLDOWN_MINUTES *
          60_000;
    }
  }

  /*
   * The markets were processed independently above.
   * Sort the resulting trades chronologically so that
   * equity statistics are meaningful across markets.
   */
  trades.sort(
    (a, b) =>
      a.exitTime -
      b.exitTime,
  );

  return {
    trades,
    observations,
  };
}

function createParameterGrid():
  ExitParameters[] {
  const parameters: ExitParameters[] =
    [];

  for (const target of TARGETS) {
    for (const stop of STOPS) {
      for (const maxHoldMinutes of MAX_HOLDS) {
        parameters.push({
          target,
          stop,
          maxHoldMinutes,
        });
      }
    }
  }

  return parameters;
}

function parameterDescription(
  parameters: ExitParameters,
): string {
  return [
    `target=${(
      parameters.target * 100
    ).toFixed(2)}%`,
    `stop=${(
      parameters.stop * 100
    ).toFixed(2)}%`,
    `maxHold=${parameters.maxHoldMinutes}m`,
  ].join(", ");
}

function findBestDiscoveryResult(
  results: ExitSummary[],
): ExitSummary | null {
  if (results.length === 0) {
    return null;
  }

  /*
   * Primary criterion:
   * average net return per actual sequential trade.
   *
   * This prevents a parameter set producing many
   * mediocre trades from automatically winning simply
   * because it has a larger aggregate return.
   *
   * Ties are broken by compounded return, then
   * maximum drawdown.
   */
  return [...results].sort(
    (a, b) => {
      if (
        b.averageNetReturn !==
        a.averageNetReturn
      ) {
        return (
          b.averageNetReturn -
          a.averageNetReturn
        );
      }

      if (
        b.compoundedReturn !==
        a.compoundedReturn
      ) {
        return (
          b.compoundedReturn -
          a.compoundedReturn
        );
      }

      return (
        b.maximumDrawdown -
        a.maximumDrawdown
      );
    },
  )[0];
}

function isoOrNull(
  timestamp: number | null,
): string | null {
  return timestamp === null
    ? null
    : new Date(timestamp)
        .toISOString();
}

function main(): void {
  const inputPath =
    process.argv[2];

  if (!inputPath) {
    throw new Error(
      "Usage: npx tsx server/exit-analysis-runner.ts <dataset.json>",
    );
  }

  const resolvedPath =
    path.resolve(inputPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Dataset not found: ${resolvedPath}`,
    );
  }

  console.log(
    `Loading dataset: ${resolvedPath}`,
  );

  const dataset =
    JSON.parse(
      fs.readFileSync(
        resolvedPath,
        "utf8",
      ),
    ) as RawDataset;

  if (
    !dataset.markets ||
    dataset.markets.length === 0
  ) {
    throw new Error(
      "Dataset contains no markets.",
    );
  }

  const splitTimestamp =
    findSplitTimestamp(dataset);

  const firstTimestamp =
    Math.min(
      ...dataset.markets.map(
        (market) =>
          market.candles[0]
            ?.openTime ??
          Infinity,
      ),
    );

  const lastTimestamp =
    Math.max(
      ...dataset.markets.map(
        (market) =>
          market.candles[
            market.candles.length - 1
          ]?.openTime ??
          -Infinity,
      ),
    );

  console.log("");
  console.log(
    `Markets: ${dataset.markets.length}`,
  );

  console.log(
    `Discovery: ${isoOrNull(
      firstTimestamp,
    )} -> ${isoOrNull(
      splitTimestamp,
    )}`,
  );

  console.log(
    `OOS: ${isoOrNull(
      splitTimestamp,
    )} -> ${isoOrNull(
      lastTimestamp,
    )}`,
  );

  console.log("");
  console.log(
    "Frozen signal:",
  );

  console.log(
    `  slope20 <= ${SIGNAL.slope20}`,
  );

  console.log(
    `  acceleration >= ${SIGNAL.acceleration}`,
  );

  const parameterGrid =
    createParameterGrid();

  console.log("");
  console.log(
    `Testing ${parameterGrid.length} exit parameter combinations...`,
  );

  const discoveryResults:
    ExitSummary[] = [];

  let processed = 0;

  for (const parameters of parameterGrid) {
    const simulation =
      simulatePeriod(
        dataset,
        parameters,
        firstTimestamp,
        splitTimestamp,
      );

    /*
     * Ignore parameter sets with too few actual
     * sequential trades to be meaningful.
     */
    if (
      simulation.trades.length >=
      50
    ) {
      discoveryResults.push(
        summariseTrades(
          parameters,
          simulation.trades,
        ),
      );
    }

    processed += 1;

    if (
      processed % 10 === 0 ||
      processed ===
        parameterGrid.length
    ) {
      console.log(
        `Progress: ${processed}/${parameterGrid.length}`,
      );
    }
  }

  const rankedResults =
    [...discoveryResults].sort(
      (a, b) => {
        if (
          b.averageNetReturn !==
          a.averageNetReturn
        ) {
          return (
            b.averageNetReturn -
            a.averageNetReturn
          );
        }

        return (
          b.compoundedReturn -
          a.compoundedReturn
        );
      },
    );

  const selected =
    findBestDiscoveryResult(
      discoveryResults,
    );

  if (!selected) {
    throw new Error(
      "No exit parameter set produced at least 50 discovery trades.",
    );
  }

  console.log("");
  console.log(
    "Selected discovery exit:",
  );

  console.log(
    `  ${parameterDescription(
      selected.parameters,
    )}`,
  );

  console.log(
    `  trades: ${selected.trades}`,
  );

  console.log(
    `  average net: ${(
      selected.averageNetReturn *
      100
    ).toFixed(4)}%`,
  );

  console.log(
    `  compounded: ${(
      selected.compoundedReturn *
      100
    ).toFixed(2)}%`,
  );

  console.log(
    `  max drawdown: ${(
      selected.maximumDrawdown *
      100
    ).toFixed(2)}%`,
  );

  /*
   * Freeze the selected parameters.
   *
   * Absolutely no optimisation happens here.
   */
  console.log("");
  console.log(
    "Running frozen exit strategy on OOS period...",
  );

  const oosSimulation =
    simulatePeriod(
      dataset,
      selected.parameters,
      splitTimestamp,
      lastTimestamp + 1,
    );

  const oosSummary =
    summariseTrades(
      selected.parameters,
      oosSimulation.trades,
    );

  console.log("");
  console.log(
    "OOS result:",
  );

  console.log(
    `  ${parameterDescription(
      selected.parameters,
    )}`,
  );

  console.log(
    `  observations: ${
      oosSimulation.observations
    }`,
  );

  console.log(
    `  trades: ${oosSummary.trades}`,
  );

  console.log(
    `  average net: ${(
      oosSummary.averageNetReturn *
      100
    ).toFixed(4)}%`,
  );

  console.log(
    `  compounded: ${(
      oosSummary.compoundedReturn *
      100
    ).toFixed(2)}%`,
  );

  console.log(
    `  win rate: ${(
      oosSummary.winRate * 100
    ).toFixed(2)}%`,
  );

  console.log(
    `  max drawdown: ${(
      oosSummary.maximumDrawdown *
      100
    ).toFixed(2)}%`,
  );

  const output: Output = {
    generatedAt:
      new Date().toISOString(),

    sourceFile:
      path.basename(resolvedPath),

    signal: {
      conditions: [
        {
          feature: "slope20",
          operator: "<=",
          percentile: 20,
          threshold:
            SIGNAL.slope20,
        },
        {
          feature:
            "acceleration",
          operator: ">=",
          percentile: 80,
          threshold:
            SIGNAL.acceleration,
        },
      ],
    },

    discovery: {
      start: isoOrNull(
        firstTimestamp,
      ),

      end: isoOrNull(
        splitTimestamp,
      ),

      observations:
        discoveryResults.reduce(
          (sum, result) =>
            sum + result.trades,
          0,
        ),

      parameterTests:
        parameterGrid.length,

      rankedResults:
        rankedResults.slice(0, 25),

      selectedParameters:
        selected.parameters,

      selectedDiscoveryResult:
        selected,
    },

    outOfSample: {
      start: isoOrNull(
        splitTimestamp,
      ),

      end: isoOrNull(
        lastTimestamp,
      ),

      observations:
        oosSimulation.observations,

      result: {
        parameters:
          oosSummary.parameters,

        trades:
          oosSummary.trades,

        wins:
          oosSummary.wins,

        losses:
          oosSummary.losses,

        timeouts:
          oosSummary.timeouts,

        winRate:
          oosSummary.winRate,

        averageGrossReturn:
          oosSummary.averageGrossReturn,

        averageNetReturn:
          oosSummary.averageNetReturn,

        medianNetReturn:
          oosSummary.medianNetReturn,

        totalNetReturn:
          oosSummary.totalNetReturn,

        compoundedReturn:
          oosSummary.compoundedReturn,

        maximumDrawdown:
          oosSummary.maximumDrawdown,

        averageHoldingMinutes:
          oosSummary.averageHoldingMinutes,

        targetRate:
          oosSummary.targetRate,

        stopRate:
          oosSummary.stopRate,

        timeoutRate:
          oosSummary.timeoutRate,
      },
    },

    assumptions: {
      totalCost: TOTAL_COST,

      cooldownMinutes:
        COOLDOWN_MINUTES,

      ambiguousCandle:
        "If target and stop are both touched in the same candle, stop is assumed to occur first.",

      entryPrice:
        "Close of the signal candle.",

      timeoutExit:
        "Close of the candle at maxHoldMinutes.",
    },
  };

  const outputDirectory =
    path.join(
      path.dirname(resolvedPath),
    );

  fs.mkdirSync(
    outputDirectory,
    {
      recursive: true,
    },
  );

  const outputPath =
    path.join(
      outputDirectory,
      `exit-analysis-${Date.now()}.json`,
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  console.log("");
  console.log(
    `Results written to: ${outputPath}`,
  );
}

main();
