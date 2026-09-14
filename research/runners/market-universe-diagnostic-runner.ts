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

interface Signal {
  index: number;
  time: number;
  score: number;
}

interface Exit {
  time: number;
  price: number;
  quantity: number;
  fee: number;
  netProceeds: number;
  target: string;
}

interface Position {
  symbol: string;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  entryValue: number;
  entryFee: number;
  exits: Exit[];
  finalExitTime: number;
  realisedNet: number;
  remainingQuantity: number;
  unrealisedGross: number;
  score: number;
}

interface MarketStats {
  symbol: string;

  candidateSignals: number;
  acceptedSignals: number;

  completedPositions: number;
  openPositions: number;

  winningPositions: number;
  losingPositions: number;
  winRate: number;

  realisedGross: number;
  realisedFees: number;
  realisedNet: number;
  unrealisedGross: number;
  combinedNet: number;

  profitFactor: number;

  averageNetPerTrade: number;
  medianNetPerTrade: number;

  averageSignalScore: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  target1Hits: number;
  target2Hits: number;
  target4Hits: number;
  stopExits: number;
  timeLimitExits: number;
}

interface UniverseSummary {
  name: string;
  markets: number;

  candidateSignals: number;
  acceptedSignals: number;

  completedPositions: number;
  openPositions: number;

  winningPositions: number;
  losingPositions: number;
  winRate: number;

  realisedGross: number;
  realisedFees: number;
  realisedNet: number;
  unrealisedGross: number;
  combinedNet: number;

  profitFactor: number;

  averageNetPerTrade: number;
  medianNetPerTrade: number;

  averageSignalScore: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  target1Hits: number;
  target2Hits: number;
  target4Hits: number;
  stopExits: number;
  timeLimitExits: number;
}

interface MarketAnalysis {
  candidates: Position[];
  accepted: Set<Position>;
  stats: MarketStats;
}

const ORIGINAL_DATASET_PATH = path.join(
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

const FEE_RATE = 0.001;
const EXECUTION_COST = 0;

const POSITION_NOTIONAL = 10;

const MAX_CONCURRENT_POSITIONS = 43;

const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692 * 1.30;

const TARGETS: Target[] = [
  {
    name: "target_1pct",
    returnPct: 0.01,
    fraction: 0.5,
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

const STOP_PCT = 0.10;
const MAX_HOLD_MINUTES = 48 * 60;

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

/**
 * Exact rolling regression implementation
 * used by position-cap-variant-research-runner.ts.
 */
function buildRegressionSlopes(
  closes: number[],
  windowSize: number
): number[] {
  const n = closes.length;

  const prefixY =
    new Float64Array(n + 1);

  const prefixIndexY =
    new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    prefixY[i + 1] =
      prefixY[i] + closes[i];

    prefixIndexY[i + 1] =
      prefixIndexY[i] +
      i * closes[i];
  }

  const sumX =
    (windowSize * (windowSize - 1)) /
    2;

  const sumXX =
    ((windowSize - 1) *
      windowSize *
      (2 * windowSize - 1)) /
    6;

  const denominator =
    windowSize * sumXX -
    sumX * sumX;

  const slopes =
    new Float64Array(n);

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

    const weightedSum =
      prefixIndexY[end + 1] -
      prefixIndexY[start];

    const sumXY =
      weightedSum -
      start * sumY;

    slopes[end] =
      (
        windowSize * sumXY -
        sumX * sumY
      ) /
      denominator;
  }

  return Array.from(slopes);
}

/**
 * Exact signal construction from the
 * position-capacity research runner.
 */
function buildSignals(
  candles: Candle[]
): Signal[] {
  const closes =
    candles.map(
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

  const signals: Signal[] = [];

  for (
    let i = 49;
    i < candles.length;
    i++
  ) {
    const acceleration =
      slope20[i] - slope50[i];

    if (
      slope20[i] <=
        SLOPE_THRESHOLD &&
      acceleration >=
        ACCELERATION_THRESHOLD
    ) {
      const slopeStrength =
        Math.abs(
          slope20[i] /
            SLOPE_THRESHOLD
        );

      const accelerationStrength =
        acceleration /
        ACCELERATION_THRESHOLD;

      const score =
        slopeStrength +
        accelerationStrength;

      signals.push({
        index: i,
        time: candles[i].openTime,
        score,
      });
    }
  }

  return signals;
}

function calculateFee(
  value: number
): number {
  return (
    value *
    (FEE_RATE + EXECUTION_COST)
  );
}

/**
 * Exact position simulation from the
 * position-capacity research runner.
 */
function simulatePosition(
  symbol: string,
  candles: Candle[],
  signal: Signal
): Position {
  const entryCandle =
    candles[signal.index];

  const entryPrice =
    entryCandle.close;

  const quantity =
    POSITION_NOTIONAL /
    entryPrice;

  const entryValue =
    quantity * entryPrice;

  const entryFee =
    calculateFee(entryValue);

  let remainingQuantity =
    quantity;

  let realisedNet =
    -entryFee;

  const exits: Exit[] = [];

  let finalExitTime =
    candles[
      candles.length - 1
    ].openTime;

  const targetExecuted =
    TARGETS.map(() => false);

  const deadline =
    entryCandle.openTime +
    MAX_HOLD_MINUTES *
      60_000;

  for (
    let i = signal.index + 1;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];

    const stopPrice =
      entryPrice *
      (1 - STOP_PCT);

    /*
     * Stop takes precedence if both
     * stop and target occur in the same
     * candle.
     */
    if (
      candle.low <= stopPrice
    ) {
      const quantitySold =
        remainingQuantity;

      const saleValue =
        quantitySold * stopPrice;

      const exitFee =
        calculateFee(saleValue);

      const netSaleProceeds =
        saleValue - exitFee;

      realisedNet +=
        netSaleProceeds -
        quantitySold *
          entryPrice;

      exits.push({
        time: candle.openTime,
        price: stopPrice,
        quantity: quantitySold,
        fee: exitFee,
        netProceeds:
          netSaleProceeds,
        target: "stop",
      });

      remainingQuantity = 0;
      finalExitTime =
        candle.openTime;

      break;
    }

    for (
      let targetIndex = 0;
      targetIndex < TARGETS.length;
      targetIndex++
    ) {
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

      const target =
        TARGETS[targetIndex];

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
        quantity *
        target.fraction;

      const quantitySold =
        Math.min(
          requestedQuantity,
          remainingQuantity
        );

      if (
        quantitySold <= 0
      ) {
        continue;
      }

      const saleValue =
        quantitySold *
        targetPrice;

      const exitFee =
        calculateFee(saleValue);

      const netSaleProceeds =
        saleValue - exitFee;

      realisedNet +=
        netSaleProceeds -
        quantitySold *
          entryPrice;

      remainingQuantity -=
        quantitySold;

      targetExecuted[
        targetIndex
      ] = true;

      exits.push({
        time: candle.openTime,
        price: targetPrice,
        quantity: quantitySold,
        fee: exitFee,
        netProceeds:
          netSaleProceeds,
        target: target.name,
      });

      if (
        remainingQuantity <=
        1e-12
      ) {
        remainingQuantity = 0;
        finalExitTime =
          candle.openTime;

        break;
      }
    }

    if (
      remainingQuantity <=
      1e-12
    ) {
      break;
    }

    if (
      candle.openTime >=
      deadline
    ) {
      const quantitySold =
        remainingQuantity;

      if (quantitySold > 0) {
        const saleValue =
          quantitySold *
          candle.close;

        const exitFee =
          calculateFee(saleValue);

        const netSaleProceeds =
          saleValue - exitFee;

        realisedNet +=
          netSaleProceeds -
          quantitySold *
            entryPrice;

        exits.push({
          time: candle.openTime,
          price: candle.close,
          quantity: quantitySold,
          fee: exitFee,
          netProceeds:
            netSaleProceeds,
          target: "time_limit",
        });

        remainingQuantity = 0;
        finalExitTime =
          candle.openTime;
      }

      break;
    }
  }

  let unrealisedGross = 0;

  if (
    remainingQuantity > 0
  ) {
    const finalPrice =
      candles[
        candles.length - 1
      ].close;

    unrealisedGross =
      remainingQuantity *
      (
        finalPrice -
        entryPrice
      );
  }

  return {
    symbol,
    entryTime:
      entryCandle.openTime,
    entryPrice,
    quantity,
    entryValue,
    entryFee,
    exits,
    finalExitTime,
    realisedNet,
    remainingQuantity,
    unrealisedGross,
    score: signal.score,
  };
}

/**
 * Exact capacity selection used by the
 * original research runner.
 */
function selectPositions(
  candidates: Position[],
  maxConcurrentPositions: number
): Set<Position> {
  const sorted =
    [...candidates].sort(
      (a, b) => {
        if (
          a.entryTime !==
          b.entryTime
        ) {
          return (
            a.entryTime -
            b.entryTime
          );
        }

        return (
          b.score -
          a.score
        );
      }
    );

  const active: Position[] = [];
  const accepted =
    new Set<Position>();

  let index = 0;

  while (
    index < sorted.length
  ) {
    const entryTime =
      sorted[index].entryTime;

    for (
      let i = active.length - 1;
      i >= 0;
      i--
    ) {
      if (
        active[i].finalExitTime <=
        entryTime
      ) {
        active.splice(i, 1);
      }
    }

    const batch: Position[] =
      [];

    while (
      index < sorted.length &&
      sorted[index].entryTime ===
        entryTime
    ) {
      batch.push(
        sorted[index]
      );

      index++;
    }

    batch.sort(
      (a, b) =>
        b.score - a.score
    );

    const capacity =
      Math.max(
        0,
        maxConcurrentPositions -
          active.length
      );

    for (
      let i = 0;
      i <
      Math.min(
        capacity,
        batch.length
      );
      i++
    ) {
      accepted.add(
        batch[i]
      );

      active.push(
        batch[i]
      );
    }
  }

  return accepted;
}

function calculateMarketStats(
  symbol: string,
  candidates: Position[],
  accepted: Set<Position>
): MarketStats {
  const marketAccepted =
    candidates.filter(
      (position) =>
        accepted.has(position)
    );

  const completed =
    marketAccepted.filter(
      (position) =>
        position.remainingQuantity <=
        1e-12
    );

  const open =
    marketAccepted.length -
    completed.length;

  const winning =
    completed.filter(
      (position) =>
        position.realisedNet > 0
    );

  const losing =
    completed.filter(
      (position) =>
        position.realisedNet <= 0
    );

  const realisedGross =
    completed.reduce(
      (sum, position) =>
        sum +
        position.realisedNet +
        position.entryFee +
        position.exits.reduce(
          (
            feeSum,
            exit
          ) =>
            feeSum + exit.fee,
          0
        ),
      0
    );

  const realisedFees =
    completed.reduce(
      (sum, position) =>
        sum +
        position.entryFee +
        position.exits.reduce(
          (
            feeSum,
            exit
          ) =>
            feeSum + exit.fee,
          0
        ),
      0
    );

  const realisedNet =
    completed.reduce(
      (sum, position) =>
        sum +
        position.realisedNet,
      0
    );

  const unrealisedGross =
    marketAccepted.reduce(
      (sum, position) =>
        sum +
        position.unrealisedGross,
      0
    );

  const combinedNet =
    realisedNet +
    unrealisedGross;

  const grossProfit =
    completed.reduce(
      (sum, position) =>
        sum +
        Math.max(
          0,
          position.realisedNet
        ),
      0
    );

  const grossLoss =
    completed.reduce(
      (sum, position) =>
        sum +
        Math.max(
          0,
          -position.realisedNet
        ),
      0
    );

  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : grossProfit > 0
        ? Number.POSITIVE_INFINITY
        : 0;

  const netValues =
    completed.map(
      (position) =>
        position.realisedNet
    );

  const holdMinutes =
    completed.map(
      (position) =>
        (
          position.finalExitTime -
          position.entryTime
        ) /
        60_000
    );

  const scores =
    marketAccepted.map(
      (position) =>
        position.score
    );

  const target1Hits =
    marketAccepted.filter(
      (position) =>
        position.exits.some(
          (exit) =>
            exit.target ===
            "target_1pct"
        )
    ).length;

  const target2Hits =
    marketAccepted.filter(
      (position) =>
        position.exits.some(
          (exit) =>
            exit.target ===
            "target_2pct"
        )
    ).length;

  const target4Hits =
    marketAccepted.filter(
      (position) =>
        position.exits.some(
          (exit) =>
            exit.target ===
            "target_4pct"
        )
    ).length;

  const stopExits =
    marketAccepted.filter(
      (position) =>
        position.exits.some(
          (exit) =>
            exit.target ===
            "stop"
        )
    ).length;

  const timeLimitExits =
    marketAccepted.filter(
      (position) =>
        position.exits.some(
          (exit) =>
            exit.target ===
            "time_limit"
        )
    ).length;

  return {
    symbol,

    candidateSignals:
      candidates.length,

    acceptedSignals:
      marketAccepted.length,

    completedPositions:
      completed.length,

    openPositions:
      open,

    winningPositions:
      winning.length,

    losingPositions:
      losing.length,

    winRate:
      completed.length > 0
        ? winning.length /
          completed.length
        : 0,

    realisedGross,

    realisedFees,

    realisedNet,

    unrealisedGross,

    combinedNet,

    profitFactor,

    averageNetPerTrade:
      completed.length > 0
        ? realisedNet /
          completed.length
        : 0,

    medianNetPerTrade:
      percentile(
        netValues,
        0.5
      ),

    averageSignalScore:
      scores.length > 0
        ? scores.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          scores.length
        : 0,

    averageHoldMinutes:
      holdMinutes.length > 0
        ? holdMinutes.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          holdMinutes.length
        : 0,

    medianHoldMinutes:
      percentile(
        holdMinutes,
        0.5
      ),

    target1Hits,
    target2Hits,
    target4Hits,
    stopExits,
    timeLimitExits,
  };
}

function summariseUniverse(
  name: string,
  analyses: MarketAnalysis[]
): UniverseSummary {
  const stats =
    analyses.map(
      (analysis) =>
        analysis.stats
    );

  const sum = (
    selector: (
      stat: MarketStats
    ) => number
  ): number =>
    stats.reduce(
      (total, stat) =>
        total + selector(stat),
      0
    );

  const completedPositions =
    sum(
      (stat) =>
        stat.completedPositions
    );

  const winningPositions =
    sum(
      (stat) =>
        stat.winningPositions
    );

  const realisedGross =
    sum(
      (stat) =>
        stat.realisedGross
    );

  const realisedFees =
    sum(
      (stat) =>
        stat.realisedFees
    );

  const realisedNet =
    sum(
      (stat) =>
        stat.realisedNet
    );

  const unrealisedGross =
    sum(
      (stat) =>
        stat.unrealisedGross
    );

  const combinedNet =
    sum(
      (stat) =>
        stat.combinedNet
    );

  const grossProfit =
    stats.reduce(
      (total, stat) =>
        total +
        Math.max(
          0,
          stat.realisedNet
        ),
      0
    );

  const grossLoss =
    stats.reduce(
      (total, stat) =>
        total +
        Math.max(
          0,
          -stat.realisedNet
        ),
      0
    );

  const allNetValues =
    analyses.flatMap(
      (analysis) =>
        [...analysis.accepted]
          .filter(
            (position) =>
              position.remainingQuantity <=
              1e-12
          )
          .map(
            (position) =>
              position.realisedNet
          )
    );

  const allHoldMinutes =
    analyses.flatMap(
      (analysis) =>
        [...analysis.accepted]
          .filter(
            (position) =>
              position.remainingQuantity <=
              1e-12
          )
          .map(
            (position) =>
              (
                position.finalExitTime -
                position.entryTime
              ) /
              60_000
          )
    );

  const acceptedSignals =
    sum(
      (stat) =>
        stat.acceptedSignals
    );

  const averageSignalScore =
    acceptedSignals > 0
      ? sum(
          (stat) =>
            stat.averageSignalScore *
            stat.acceptedSignals
        ) /
        acceptedSignals
      : 0;

  const averageHoldMinutes =
    completedPositions > 0
      ? sum(
          (stat) =>
            stat.averageHoldMinutes *
            stat.completedPositions
        ) /
        completedPositions
      : 0;

  return {
    name,
    markets: stats.length,

    candidateSignals:
      sum(
        (stat) =>
          stat.candidateSignals
      ),

    acceptedSignals,

    completedPositions,

    openPositions:
      sum(
        (stat) =>
          stat.openPositions
      ),

    winningPositions,

    losingPositions:
      sum(
        (stat) =>
          stat.losingPositions
      ),

    winRate:
      completedPositions > 0
        ? winningPositions /
          completedPositions
        : 0,

    realisedGross,
    realisedFees,
    realisedNet,
    unrealisedGross,
    combinedNet,

    profitFactor:
      grossLoss > 0
        ? grossProfit /
          grossLoss
        : grossProfit > 0
          ? Number.POSITIVE_INFINITY
          : 0,

    averageNetPerTrade:
      completedPositions > 0
        ? realisedNet /
          completedPositions
        : 0,

    medianNetPerTrade:
      percentile(
        allNetValues,
        0.5
      ),

    averageSignalScore,

    averageHoldMinutes,

    medianHoldMinutes:
      percentile(
        allHoldMinutes,
        0.5
      ),

    target1Hits:
      sum(
        (stat) =>
          stat.target1Hits
      ),

    target2Hits:
      sum(
        (stat) =>
          stat.target2Hits
      ),

    target4Hits:
      sum(
        (stat) =>
          stat.target4Hits
      ),

    stopExits:
      sum(
        (stat) =>
          stat.stopExits
      ),

    timeLimitExits:
      sum(
        (stat) =>
          stat.timeLimitExits
      ),
  };
}

function findLatestOosDataset(): string {
  const files =
    fs.readdirSync(
      OUTPUT_DIR
    );

  const matches =
    files
      .filter(
        (file) =>
          /^ema-data-oos-60-\d+\.json$/.test(
            file
          )
      )
      .sort();

  if (matches.length === 0) {
    throw new Error(
      "No ema-data-oos-60-*.json file found."
    );
  }

  return path.join(
    OUTPUT_DIR,
    matches[matches.length - 1]
  );
}

function loadDataset(
  filePath: string
): Dataset {
  console.log(
    `Loading ${path.basename(filePath)}`
  );

  const raw =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  const dataset =
    JSON.parse(raw) as Dataset;

  if (
    !dataset.markets ||
    !Array.isArray(
      dataset.markets
    )
  ) {
    throw new Error(
      `Invalid dataset: ${filePath}`
    );
  }

  return dataset;
}

function analyseDataset(
  dataset: Dataset
): MarketAnalysis[] {
  const analyses: MarketAnalysis[] =
    [];

  const allCandidates: Position[] =
    [];

  const candidatesBySymbol =
    new Map<
      string,
      Position[]
    >();

  for (const market of dataset.markets) {
    console.log(
      `Building signals: ${market.symbol}`
    );

    const signals =
      buildSignals(
        market.candles
      );

    const positions =
      signals.map(
        (signal) =>
          simulatePosition(
            market.symbol,
            market.candles,
            signal
          )
      );

    candidatesBySymbol.set(
      market.symbol,
      positions
    );

    allCandidates.push(
      ...positions
    );
  }

  console.log(
    `Candidate positions: ${allCandidates.length.toLocaleString()}`
  );

  const accepted =
    selectPositions(
      allCandidates,
      MAX_CONCURRENT_POSITIONS
    );

  console.log(
    `Accepted at ${MAX_CONCURRENT_POSITIONS}-position capacity: ${accepted.size.toLocaleString()}`
  );

  for (const market of dataset.markets) {
    const candidates =
      candidatesBySymbol.get(
        market.symbol
      ) ?? [];

    const stats =
      calculateMarketStats(
        market.symbol,
        candidates,
        accepted
      );

    analyses.push({
      candidates,
      accepted,
      stats,
    });
  }

  return analyses;
}

function printUniverseSummary(
  summary: UniverseSummary
): void {
  console.log(
    "\n============================================================"
  );

  console.log(
    summary.name
  );

  console.log(
    "============================================================"
  );

  console.log(
    JSON.stringify(
      {
        markets:
          summary.markets,

        candidateSignals:
          summary.candidateSignals,

        acceptedSignals:
          summary.acceptedSignals,

        completedPositions:
          summary.completedPositions,

        openPositions:
          summary.openPositions,

        winRate:
          summary.winRate,

        realisedNet:
          summary.realisedNet,

        unrealisedGross:
          summary.unrealisedGross,

        combinedNet:
          summary.combinedNet,

        profitFactor:
          summary.profitFactor,

        averageNetPerTrade:
          summary.averageNetPerTrade,

        medianNetPerTrade:
          summary.medianNetPerTrade,

        averageSignalScore:
          summary.averageSignalScore,

        averageHoldMinutes:
          summary.averageHoldMinutes,

        medianHoldMinutes:
          summary.medianHoldMinutes,

        target1Hits:
          summary.target1Hits,

        target2Hits:
          summary.target2Hits,

        target4Hits:
          summary.target4Hits,

        stopExits:
          summary.stopExits,

        timeLimitExits:
          summary.timeLimitExits,
      },
      null,
      2
    )
  );
}

function main(): void {
  console.log(
    "============================================================"
  );

  console.log(
    "Market Universe Diagnostic"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `Capacity: ${MAX_CONCURRENT_POSITIONS}`
  );

  console.log(
    `Slope threshold: ${SLOPE_THRESHOLD}`
  );

  console.log(
    `Acceleration threshold: ${ACCELERATION_THRESHOLD}`
  );

  console.log(
    `Position notional: $${POSITION_NOTIONAL}`
  );

  console.log(
    `Fee rate: ${FEE_RATE}`
  );

  console.log(
    `Stop: ${STOP_PCT * 100}%`
  );

  console.log(
    `Maximum hold: ${MAX_HOLD_MINUTES} minutes`
  );

  const oosPath =
    findLatestOosDataset();

  console.log(
    `\nOriginal dataset: ${path.basename(ORIGINAL_DATASET_PATH)}`
  );

  console.log(
    `OOS dataset: ${path.basename(oosPath)}`
  );

  const original =
    loadDataset(
      ORIGINAL_DATASET_PATH
    );

  const oos =
    loadDataset(
      oosPath
    );

  console.log(
    `\nOriginal markets: ${original.markets.length}`
  );

  console.log(
    `OOS markets: ${oos.markets.length}`
  );

  const originalAnalyses =
    analyseDataset(
      original
    );

  const oosAnalyses =
    analyseDataset(
      oos
    );

  const originalSummary =
    summariseUniverse(
      "Original 60-market universe",
      originalAnalyses
    );

  const oosSummary =
    summariseUniverse(
      "Out-of-sample 60-market universe",
      oosAnalyses
    );

  printUniverseSummary(
    originalSummary
  );

  printUniverseSummary(
    oosSummary
  );

  const allMarketStats = [
    ...originalAnalyses.map(
      (analysis) => ({
        universe: "original",
        ...analysis.stats,
      })
    ),

    ...oosAnalyses.map(
      (analysis) => ({
        universe: "oos",
        ...analysis.stats,
      })
    ),
  ];

  const originalMarkets =
    originalAnalyses
      .map(
        (analysis) =>
          analysis.stats
      )
      .sort(
        (a, b) =>
          b.combinedNet -
          a.combinedNet
      );

  const oosMarkets =
    oosAnalyses
      .map(
        (analysis) =>
          analysis.stats
      )
      .sort(
        (a, b) =>
          b.combinedNet -
          a.combinedNet
      );

  const output = {
    generatedAt:
      new Date().toISOString(),

    methodology: {
      capacity:
        MAX_CONCURRENT_POSITIONS,

      slopeThreshold:
        SLOPE_THRESHOLD,

      accelerationThreshold:
        ACCELERATION_THRESHOLD,

      accelerationMultiplier:
        1.30,

      positionNotional:
        POSITION_NOTIONAL,

      feeRate:
        FEE_RATE,

      executionCost:
        EXECUTION_COST,

      targets:
        TARGETS,

      stopPct:
        STOP_PCT,

      maxHoldMinutes:
        MAX_HOLD_MINUTES,

      note:
        "Market-level diagnostic using the exact signal and position simulation logic from position-cap-variant-research-runner.ts. No parameters are optimised by this runner.",
    },

    datasets: {
      original:
        path.basename(
          ORIGINAL_DATASET_PATH
        ),

      oos:
        path.basename(
          oosPath
        ),
    },

    summaries: {
      original:
        originalSummary,

      oos:
        oosSummary,
    },

    originalMarkets,

    oosMarkets,

    allMarketStats,
  };

  const outputPath =
    path.join(
      OUTPUT_DIR,
      `market-universe-diagnostic-${Date.now()}.json`
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
    "\n============================================================"
  );

  console.log(
    "Top original markets"
  );

  console.log(
    "============================================================"
  );

  for (
    const market of
      originalMarkets.slice(
        0,
        15
      )
  ) {
    console.log(
      `${market.symbol.padEnd(16)} ` +
      `net=${market.combinedNet.toFixed(4).padStart(9)} ` +
      `win=${(market.winRate * 100).toFixed(1).padStart(6)}% ` +
      `PF=${market.profitFactor.toFixed(3).padStart(7)} ` +
      `accepted=${market.acceptedSignals}`
    );
  }

  console.log(
    "\n============================================================"
  );

  console.log(
    "Top OOS markets"
  );

  console.log(
    "============================================================"
  );

  for (
    const market of
      oosMarkets.slice(
        0,
        15
      )
  ) {
    console.log(
      `${market.symbol.padEnd(16)} ` +
      `net=${market.combinedNet.toFixed(4).padStart(9)} ` +
      `win=${(market.winRate * 100).toFixed(1).padStart(6)}% ` +
      `PF=${market.profitFactor.toFixed(3).padStart(7)} ` +
      `accepted=${market.acceptedSignals}`
    );
  }

  console.log(
    "\n============================================================"
  );

  console.log(
    `Output: ${outputPath}`
  );

  console.log(
    "============================================================"
  );
}

main();
