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

interface Event {
  time: number;
  type: "entry" | "exit";
  position: Position;
  cashDelta: number;
  capitalDelta: number;
  positionDelta: number;
}

interface PortfolioResult {
  minimumStartingCash: number;
  peakCapitalDeployed: number;
  averageCapitalDeployed: number;
  finalEquity: number;
  finalCash: number;
  finalMarketValue: number;
  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
  maxOpenMarkets: number;
}

interface Result {
  maxConcurrentPositions: number;

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

  minimumStartingCash: number;
  peakCapitalDeployed: number;
  averageCapitalDeployed: number;

  finalEquity: number;
  totalReturn: number;

  maxDrawdownAbsolute: number;
  maxDrawdownPct: number;

  returnOnPeakCapital: number;
  returnOnAverageCapital: number;
  annualisedCapitalEfficiency: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  maxOpenPositions: number;
  maxOpenMarkets: number;
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

const FEE_RATE = 0.001;
const EXECUTION_COST = 0;

const POSITION_NOTIONAL = 10;

const MAX_CONCURRENT_POSITIONS = [
  25,
  50,
  75,
  100,
  125,
  150,
];

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
 * Calculate rolling linear-regression slopes
 * using prefix sums.
 *
 * This makes each slope calculation O(1)
 * rather than repeatedly scanning the window.
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
      (windowSize * sumXY -
        sumX * sumY) /
      denominator;
  }

  return Array.from(slopes);
}

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
     * Stop takes precedence if both a stop
     * and target could have been reached
     * within the same candle.
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
        quantity:
          quantitySold,
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

      if (quantitySold <= 0) {
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
        quantity:
          quantitySold,
        fee: exitFee,
        netProceeds:
          netSaleProceeds,
        target:
          target.name,
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
          quantity:
            quantitySold,
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
 * Select the strongest signals subject to
 * a maximum number of simultaneous positions.
 *
 * This is the only portfolio variable being
 * changed by this experiment.
 */
function selectPositions(
  candidates: Position[],
  maxConcurrentPositions: number
): Position[] {
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
  const accepted: Position[] = [];

  let index = 0;

  while (
    index < sorted.length
  ) {
    const entryTime =
      sorted[index].entryTime;

    /*
     * Positions that have fully exited
     * before this entry are available to
     * be replaced.
     */
    for (
      let i = active.length - 1;
      i >= 0;
      i--
    ) {
      if (
        active[i]
          .finalExitTime <=
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

    /*
     * Strongest signal first when several
     * markets generate an entry at exactly
     * the same time.
     */
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
      i < Math.min(
        capacity,
        batch.length
      );
      i++
    ) {
      accepted.push(
        batch[i]
      );

      active.push(
        batch[i]
      );
    }
  }

  return accepted;
}

function buildPositionEvents(
  position: Position
): Event[] {
  const events: Event[] = [];

  events.push({
    time:
      position.entryTime,
    type: "entry",
    position,
    cashDelta:
      -(
        position.entryValue +
        position.entryFee
      ),
    capitalDelta:
      position.entryValue,
    positionDelta: 1,
  });

  for (
    let i = 0;
    i < position.exits.length;
    i++
  ) {
    const exit =
      position.exits[i];

    const finalExit =
      i ===
      position.exits.length - 1;

    events.push({
      time: exit.time,
      type: "exit",
      position,
      cashDelta:
        exit.netProceeds,
      capitalDelta:
        -(
          exit.quantity *
          position.entryPrice
        ),
      positionDelta:
        finalExit ? -1 : 0,
    });
  }

  return events;
}

function runPortfolio(
  positions: Position[],
  startTime: number,
  endTime: number
): PortfolioResult {
  const events: Event[] = [];

  for (const position of positions) {
    events.push(
      ...buildPositionEvents(
        position
      )
    );
  }

  events.sort(
    (a, b) => {
      if (
        a.time !== b.time
      ) {
        return (
          a.time - b.time
        );
      }

      /*
       * Exits are processed before entries
       * at the same timestamp, freeing capacity.
       */
      if (
        a.type === b.type
      ) {
        return 0;
      }

      return a.type === "exit"
        ? -1
        : 1;
    }
  );

  let cashFlow = 0;
  let capitalDeployed = 0;

  let peakCapitalDeployed = 0;
  let minimumStartingCash = 0;

  let openPositions = 0;
  let maxOpenPositions = 0;

  let capitalDays = 0;
  let previousTime = startTime;

  const marketPositions =
    new Map<string, number>();

  let maxOpenMarkets = 0;

  let index = 0;

  while (
    index < events.length
  ) {
    const time =
      events[index].time;

    if (
      time >
      previousTime
    ) {
      capitalDays +=
        (
          capitalDeployed *
          (time -
            previousTime)
        ) /
        86_400_000;

      previousTime = time;
    }

    while (
      index < events.length &&
      events[index].time ===
        time
    ) {
      const event =
        events[index];

      cashFlow +=
        event.cashDelta;

      capitalDeployed +=
        event.capitalDelta;

      openPositions +=
        event.positionDelta;

      const symbol =
        event.position.symbol;

      const current =
        marketPositions.get(
          symbol
        ) ?? 0;

      if (
        event.type ===
        "entry"
      ) {
        marketPositions.set(
          symbol,
          current + 1
        );
      } else if (
        event.positionDelta ===
          -1 &&
        current <= 1
      ) {
        marketPositions.delete(
          symbol
        );
      }

      peakCapitalDeployed =
        Math.max(
          peakCapitalDeployed,
          capitalDeployed
        );

      maxOpenPositions =
        Math.max(
          maxOpenPositions,
          openPositions
        );

      maxOpenMarkets =
        Math.max(
          maxOpenMarkets,
          marketPositions.size
        );

      minimumStartingCash =
        Math.max(
          minimumStartingCash,
          -cashFlow
        );

      index++;
    }
  }

  if (
    endTime >
    previousTime
  ) {
    capitalDays +=
      (
        capitalDeployed *
        (endTime -
          previousTime)
      ) /
      86_400_000;
  }

  const totalDays =
    (endTime -
      startTime) /
    86_400_000;

  const averageCapitalDeployed =
    totalDays > 0
      ? capitalDays /
        totalDays
      : 0;

  let finalMarketValue = 0;

  for (
    const position of positions
  ) {
    if (
      position.remainingQuantity >
      0
    ) {
      finalMarketValue +=
        position.remainingQuantity *
        (
          position.entryPrice +
          position.unrealisedGross /
            position.remainingQuantity
        );
    }
  }

  const finalCash =
    minimumStartingCash +
    cashFlow;

  const finalEquity =
    finalCash +
    finalMarketValue;

  /*
   * Event-level equity curve.
   *
   * This is used consistently across all
   * capacity configurations, so it is suitable
   * for relative drawdown comparison.
   */
  let runningCash =
    minimumStartingCash;

  let peakEquity =
    minimumStartingCash;

  let maxDrawdownAbsolute = 0;
  let maxDrawdownPct = 0;

  let runningCapital = 0;

  const activePositions =
    new Set<Position>();

  for (
    const event of events
  ) {
    runningCash +=
      event.cashDelta;

    runningCapital +=
      event.capitalDelta;

    if (
      event.type ===
      "entry"
    ) {
      activePositions.add(
        event.position
      );
    } else if (
      event.positionDelta ===
      -1
    ) {
      activePositions.delete(
        event.position
      );
    }

    let markedValue = 0;

    for (
      const position of activePositions
    ) {
      markedValue +=
        position.entryValue;
    }

    const equity =
      runningCash +
      markedValue;

    if (
      equity >
      peakEquity
    ) {
      peakEquity = equity;
    }

    const drawdown =
      peakEquity - equity;

    maxDrawdownAbsolute =
      Math.max(
        maxDrawdownAbsolute,
        drawdown
      );

    if (
      peakEquity > 0
    ) {
      maxDrawdownPct =
        Math.max(
          maxDrawdownPct,
          drawdown /
            peakEquity
        );
    }
  }

  return {
    minimumStartingCash,
    peakCapitalDeployed,
    averageCapitalDeployed,
    finalEquity,
    finalCash,
    finalMarketValue,
    maxDrawdownAbsolute,
    maxDrawdownPct,
    maxOpenPositions,
    maxOpenMarkets,
  };
}

function runConfiguration(
  candidates: Position[],
  maxConcurrentPositions: number,
  startTime: number,
  endTime: number
): Result {
  const accepted =
    selectPositions(
      candidates,
      maxConcurrentPositions
    );

  let realisedGross = 0;
  let realisedFees = 0;
  let realisedNet = 0;
  let unrealisedGross = 0;

  let completedPositions = 0;
  let openPositions = 0;

  let winningPositions = 0;
  let losingPositions = 0;

  let closedProfit = 0;
  let closedLoss = 0;

  const holdTimes: number[] =
    [];

  for (
    const position of accepted
  ) {
    realisedNet +=
      position.realisedNet;

    realisedFees +=
      position.entryFee;

    for (
      const exit of position.exits
    ) {
      realisedFees +=
        exit.fee;

      realisedGross +=
        exit.quantity *
        (
          exit.price -
          position.entryPrice
        );
    }

    unrealisedGross +=
      position.unrealisedGross;

    const net =
      position.realisedNet +
      position.unrealisedGross;

    if (net > 0) {
      winningPositions++;
    } else if (net < 0) {
      losingPositions++;
    }

    if (
      position.remainingQuantity >
      0
    ) {
      openPositions++;
    } else {
      completedPositions++;

      const holdMinutes =
        (
          position.finalExitTime -
          position.entryTime
        ) /
        60_000;

      holdTimes.push(
        holdMinutes
      );

      if (
        position.realisedNet >
        0
      ) {
        closedProfit +=
          position.realisedNet;
      } else if (
        position.realisedNet <
        0
      ) {
        closedLoss +=
          Math.abs(
            position.realisedNet
          );
      }
    }
  }

  const combinedNet =
    realisedNet +
    unrealisedGross;

  const portfolio =
    runPortfolio(
      accepted,
      startTime,
      endTime
    );

  const totalReturn =
    portfolio.minimumStartingCash >
    0
      ? combinedNet /
        portfolio.minimumStartingCash
      : 0;

  const returnOnPeakCapital =
    portfolio.peakCapitalDeployed >
    0
      ? combinedNet /
        portfolio.peakCapitalDeployed
      : 0;

  const returnOnAverageCapital =
    portfolio.averageCapitalDeployed >
    0
      ? combinedNet /
        portfolio.averageCapitalDeployed
      : 0;

  const totalYears =
    (endTime -
      startTime) /
    (
      365.25 *
      86_400_000
    );

  const annualisedCapitalEfficiency =
    totalYears > 0 &&
    portfolio.averageCapitalDeployed >
      0
      ? Math.pow(
          1 +
            combinedNet /
              portfolio.averageCapitalDeployed,
          1 /
            totalYears
        ) - 1
      : 0;

  return {
    maxConcurrentPositions,

    candidateSignals:
      candidates.length,

    acceptedSignals:
      accepted.length,

    completedPositions,
    openPositions,

    winningPositions,
    losingPositions,

    winRate:
      accepted.length > 0
        ? winningPositions /
          accepted.length
        : 0,

    realisedGross,
    realisedFees,
    realisedNet,
    unrealisedGross,

    combinedNet,

    profitFactor:
      closedLoss > 0
        ? closedProfit /
          closedLoss
        : Infinity,

    minimumStartingCash:
      portfolio.minimumStartingCash,

    peakCapitalDeployed:
      portfolio.peakCapitalDeployed,

    averageCapitalDeployed:
      portfolio.averageCapitalDeployed,

    finalEquity:
      portfolio.finalEquity,

    totalReturn,

    maxDrawdownAbsolute:
      portfolio.maxDrawdownAbsolute,

    maxDrawdownPct:
      portfolio.maxDrawdownPct,

    returnOnPeakCapital,

    returnOnAverageCapital,

    annualisedCapitalEfficiency,

    averageHoldMinutes:
      holdTimes.length > 0
        ? holdTimes.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          holdTimes.length
        : 0,

    medianHoldMinutes:
      percentile(
        holdTimes,
        0.5
      ),

    maxOpenPositions:
      portfolio.maxOpenPositions,

    maxOpenMarkets:
      portfolio.maxOpenMarkets,
  };
}

function main(): void {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Portfolio capacity research"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Dataset: ${DATASET_PATH}`
  );

  console.log(
    `Position size: $${POSITION_NOTIONAL}`
  );

  console.log(
    `Slope threshold: ${SLOPE_THRESHOLD}`
  );

  console.log(
    `Acceleration threshold: ${ACCELERATION_THRESHOLD}`
  );

  console.log(
    `Acceleration multiplier: 1.30x`
  );

  console.log(
    `Capacities: ${MAX_CONCURRENT_POSITIONS.join(
      ", "
    )}`
  );

  console.log(
    `Fee rate: ${(FEE_RATE * 100).toFixed(3)}%`
  );

  console.log("");

  const dataset =
    JSON.parse(
      fs.readFileSync(
        DATASET_PATH,
        "utf8"
      )
    ) as Dataset;

  const startTime =
    Math.min(
      ...dataset.markets.map(
        (market) =>
          market.candles[0]
            ?.openTime ??
          Infinity
      )
    );

  const endTime =
    Math.max(
      ...dataset.markets.map(
        (market) =>
          market.candles[
            market.candles.length - 1
          ]?.openTime ??
          -Infinity
      )
    );

  console.log(
    `Markets: ${dataset.markets.length}`
  );

  console.log(
    `Start: ${new Date(
      startTime
    ).toISOString()}`
  );

  console.log(
    `End: ${new Date(
      endTime
    ).toISOString()}`
  );

  console.log("");

  /*
   * Build every candidate position exactly
   * once. The expensive signal and position
   * simulation work therefore isn't repeated
   * for every portfolio capacity.
   */
  const candidates: Position[] =
    [];

  const signalStart =
    Date.now();

  for (
    const market of dataset.markets
  ) {
    if (
      market.candles.length <
      50
    ) {
      continue;
    }

    const signals =
      buildSignals(
        market.candles
      );

    for (
      const signal of signals
    ) {
      candidates.push(
        simulatePosition(
          market.symbol,
          market.candles,
          signal
        )
      );
    }
  }

  console.log(
    `Candidate positions: ${candidates.length.toLocaleString()}`
  );

  console.log(
    `Signal/position preparation: ${(
      (Date.now() -
        signalStart) /
      1000
    ).toFixed(2)}s`
  );

  console.log("");

  const results: Result[] =
    [];

  const portfolioStart =
    Date.now();

  for (
    let i = 0;
    i <
    MAX_CONCURRENT_POSITIONS.length;
    i++
  ) {
    const capacity =
      MAX_CONCURRENT_POSITIONS[i];

    console.log(
      `[${i + 1}/${MAX_CONCURRENT_POSITIONS.length}] Testing ${capacity} concurrent positions`
    );

    const started =
      Date.now();

    const result =
      runConfiguration(
        candidates,
        capacity,
        startTime,
        endTime
      );

    results.push(result);

    console.log(
      `  accepted: ${result.acceptedSignals.toLocaleString()}`
    );

    console.log(
      `  starting cash: $${result.minimumStartingCash.toFixed(2)}`
    );

    console.log(
      `  peak capital: $${result.peakCapitalDeployed.toFixed(2)}`
    );

    console.log(
      `  average capital: $${result.averageCapitalDeployed.toFixed(2)}`
    );

    console.log(
      `  net profit: $${result.combinedNet.toFixed(2)}`
    );

    console.log(
      `  return: ${(result.totalReturn * 100).toFixed(3)}%`
    );

    console.log(
      `  profit factor: ${
        Number.isFinite(
          result.profitFactor
        )
          ? result.profitFactor.toFixed(3)
          : "Infinity"
      }`
    );

    console.log(
      `  drawdown: ${(result.maxDrawdownPct * 100).toFixed(3)}%`
    );

    console.log(
      `  runtime: ${(
        (Date.now() -
          started) /
        1000
      ).toFixed(2)}s`
    );

    console.log("");
  }

  /*
   * Rank by return on the capital actually
   * required to execute the portfolio.
   *
   * This is more useful here than ranking
   * simply by raw profit because the entire
   * purpose of the experiment is capital
   * efficiency.
   */
  const rankedByCapitalEfficiency =
    [...results].sort(
      (a, b) =>
        b.returnOnPeakCapital -
        a.returnOnPeakCapital
    );

  const rankedByReturn =
    [...results].sort(
      (a, b) =>
        b.totalReturn -
        a.totalReturn
    );

  const rankedByProfit =
    [...results].sort(
      (a, b) =>
        b.combinedNet -
        a.combinedNet
    );

  const output = {
    generatedAt:
      new Date().toISOString(),

    methodology: {
      purpose:
        "Determine the minimum useful concurrent-position capacity while keeping the entry signal fixed.",

      positionNotional:
        POSITION_NOTIONAL,

      minimumTransactionNotional:
        POSITION_NOTIONAL,

      capacities:
        MAX_CONCURRENT_POSITIONS,

      slopeThreshold:
        SLOPE_THRESHOLD,

      accelerationThreshold:
        ACCELERATION_THRESHOLD,

      accelerationMultiplier:
        1.30,

      targets: TARGETS,

      stopPct:
        STOP_PCT,

      maxHoldMinutes:
        MAX_HOLD_MINUTES,

      feeRate:
        FEE_RATE,

      executionCost:
        EXECUTION_COST,

      entryExecution:
        "signal candle close",

      targetExecution:
        "target price when candle high reaches target",

      stopExecution:
        "stop price when candle low reaches stop",

      sameCandlePriority:
        "stop before targets",

      simultaneousEntrySelection:
        "highest frozen signal score first",

      portfolioCapacity:
        "maximum number of simultaneously open positions",

      candidatePositions:
        "generated once and reused across all capacity tests",

      rankingPriority:
        "return on peak capital",
    },

    dataset: {
      path: DATASET_PATH,
      markets:
        dataset.markets.length,
      startTime,
      endTime,
      durationDays:
        (endTime -
          startTime) /
        86_400_000,
    },

    runtime: {
      totalMilliseconds:
        Date.now() -
        portfolioStart,
    },

    results,

    rankings: {
      byCapitalEfficiency:
        rankedByCapitalEfficiency.map(
          (result) => ({
            maxConcurrentPositions:
              result.maxConcurrentPositions,
            returnOnPeakCapital:
              result.returnOnPeakCapital,
            totalReturn:
              result.totalReturn,
            combinedNet:
              result.combinedNet,
            minimumStartingCash:
              result.minimumStartingCash,
          })
        ),

      byReturn:
        rankedByReturn.map(
          (result) => ({
            maxConcurrentPositions:
              result.maxConcurrentPositions,
            totalReturn:
              result.totalReturn,
            combinedNet:
              result.combinedNet,
            minimumStartingCash:
              result.minimumStartingCash,
          })
        ),

      byProfit:
        rankedByProfit.map(
          (result) => ({
            maxConcurrentPositions:
              result.maxConcurrentPositions,
            combinedNet:
              result.combinedNet,
            totalReturn:
              result.totalReturn,
            minimumStartingCash:
              result.minimumStartingCash,
          })
        ),
    },
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
      `position-capacity-${Date.now()}.json`
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
    "============================================================"
  );
  console.log(
    "SUMMARY"
  );
  console.log(
    "============================================================"
  );

  console.log(
    "Capacity | Start $ | Profit $ | Return % | Peak $ | PF | DD %"
  );

  console.log(
    "------------------------------------------------------------"
  );

  for (
    const result of results
  ) {
    console.log(
      [
        String(
          result.maxConcurrentPositions
        ).padStart(8),
        "|",
        result.minimumStartingCash
          .toFixed(0)
          .padStart(7),
        "|",
        result.combinedNet
          .toFixed(2)
          .padStart(8),
        "|",
        (
          result.totalReturn *
          100
        )
          .toFixed(2)
          .padStart(8),
        "|",
        result.peakCapitalDeployed
          .toFixed(0)
          .padStart(6),
        "|",
        (
          Number.isFinite(
            result.profitFactor
          )
            ? result.profitFactor.toFixed(
                2
              )
            : "Inf"
        ).padStart(4),
        "|",
        (
          result.maxDrawdownPct *
          100
        )
          .toFixed(2)
          .padStart(5),
      ].join(" ")
    );
  }

  console.log("");
  console.log(
    `Results written to: ${outputPath}`
  );
  console.log("");
}

main();