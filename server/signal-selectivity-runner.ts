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

interface Configuration {
  name: string;
  slopeThreshold: number;
  accelerationThreshold: number;
}

interface Result {
  name: string;
  slopeThreshold: number;
  accelerationThreshold: number;

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
const MAX_CONCURRENT_POSITIONS = 100;

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

const BASE_SLOPE_THRESHOLD =
  -0.0001425851160546487;

const BASE_ACCELERATION_THRESHOLD =
  0.00013986740450809692;

/*
 * We deliberately test a relatively small neighbourhood around
 * the previously derived signal thresholds.
 *
 * Higher slopeThreshold magnitude means a stronger downward
 * slope is required.
 *
 * Higher accelerationThreshold means stronger acceleration
 * is required.
 */
const CONFIGURATIONS: Configuration[] = [
  {
    name: "baseline",
    slopeThreshold: BASE_SLOPE_THRESHOLD,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD,
  },

  {
    name: "slope_1.10x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD * 1.10,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD,
  },

  {
    name: "slope_1.20x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD * 1.20,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD,
  },

  {
    name: "slope_1.30x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD * 1.30,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD,
  },

  {
    name: "acceleration_1.10x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD * 1.10,
  },

  {
    name: "acceleration_1.20x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD * 1.20,
  },

  {
    name: "acceleration_1.30x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD * 1.30,
  },

  {
    name: "both_1.10x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD * 1.10,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD * 1.10,
  },

  {
    name: "both_1.20x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD * 1.20,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD * 1.20,
  },

  {
    name: "both_1.30x",
    slopeThreshold:
      BASE_SLOPE_THRESHOLD * 1.30,
    accelerationThreshold:
      BASE_ACCELERATION_THRESHOLD * 1.30,
  },
];

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
 * O(1) rolling regression slope after prefix sums
 * have been constructed.
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
  candles: Candle[],
  slopeThreshold: number,
  accelerationThreshold: number
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
        slopeThreshold &&
      acceleration >=
        accelerationThreshold
    ) {
      /*
       * Frozen signal strength.
       *
       * Stronger acceleration and stronger
       * downward slope both increase the score.
       */
      const slopeStrength =
        Math.abs(
          slope20[i] /
            slopeThreshold
        );

      const accelerationStrength =
        acceleration /
        accelerationThreshold;

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

function calculateEntryFee(
  value: number
): number {
  return (
    value *
    (FEE_RATE + EXECUTION_COST)
  );
}

function calculateExitFee(
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

  /*
   * Fixed $10 notional.
   *
   * This keeps the research independent of
   * the absolute price of each market.
   */
  const quantity =
    POSITION_NOTIONAL /
    entryPrice;

  const entryValue =
    quantity * entryPrice;

  const entryFee =
    calculateEntryFee(entryValue);

  let remainingQuantity =
    quantity;

  let realisedNet =
    -entryFee;

  const exits: Exit[] = [];

  let finalExitTime =
    candles[
      candles.length - 1
    ].openTime;

  let completed = false;

  const targetExecuted =
    TARGETS.map(() => false);

  const deadline =
    entryCandle.openTime +
    MAX_HOLD_MINUTES * 60_000;

  for (
    let i = signal.index + 1;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];

    /*
     * The position is closed at the first
     * candle at or after the 48-hour deadline.
     *
     * Stop/target takes priority on that candle.
     */
    const stopPrice =
      entryPrice *
      (1 - STOP_PCT);

    if (candle.low <= stopPrice) {
      const quantitySold =
        remainingQuantity;

      const saleValue =
        quantitySold * stopPrice;

      const exitFee =
        calculateExitFee(
          saleValue
        );

      const netSaleProceeds =
        saleValue - exitFee;

      realisedNet +=
        netSaleProceeds -
        quantitySold * entryPrice;

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
      completed = true;

      break;
    }

    for (
      let targetIndex = 0;
      targetIndex < TARGETS.length;
      targetIndex++
    ) {
      const target =
        TARGETS[targetIndex];

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
        calculateExitFee(
          saleValue
        );

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

        completed = true;

        break;
      }
    }

    if (completed) {
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
          calculateExitFee(
            saleValue
          );

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

        completed = true;
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
      (finalPrice -
        entryPrice);
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

function selectPositions(
  candidates: Position[],
  maxConcurrent: number
): Position[] {
  /*
   * Events are sorted chronologically.
   *
   * At each entry timestamp:
   *
   * 1. Completed positions are released.
   * 2. Simultaneous candidates are ranked
   *    by frozen signal strength.
   * 3. Only available capacity is accepted.
   */
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
     * Remove positions which have fully
     * exited before this entry.
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

    batch.sort(
      (a, b) =>
        b.score - a.score
    );

    const capacity =
      Math.max(
        0,
        maxConcurrent -
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
  let previousTime =
    startTime;

  let index = 0;

  /*
   * Used only for market concurrency.
   */
  const marketPositions =
    new Map<
      string,
      number
    >();

  let maxOpenMarkets = 0;

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
        (capitalDeployed *
          (time -
            previousTime)) /
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

      if (
        capitalDeployed <
        -1e-8
      ) {
        throw new Error(
          `Negative capital deployed at ${time}`
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
      (capitalDeployed *
        (endTime -
          previousTime)) /
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

  /*
   * At the end of the historical period,
   * remaining positions are marked to market.
   */
  let finalMarketValue = 0;

  for (const position of positions) {
    if (
      position.remainingQuantity >
      0
    ) {
      /*
       * The position's unrealised value
       * can be reconstructed from its
       * original entry value plus gross P&L.
       */
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
   * Reconstruct chronological equity
   * using cash flow and capital deployed.
   *
   * For drawdown we use the actual final
   * portfolio valuation at each event by
   * valuing remaining positions from their
   * latest historical close.
   *
   * A conservative event-level drawdown is
   * sufficient for comparing these signal
   * configurations.
   */
  let runningCash =
    minimumStartingCash;

  let runningCapital =
    0;

  let peakEquity =
    minimumStartingCash;

  let maxDrawdownAbsolute =
    0;

  let maxDrawdownPct = 0;

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
      /*
       * The exact candle-by-candle
       * mark-to-market is not required for
       * the signal-selection comparison.
       *
       * Use entry capital plus realised
       * partial-sale proceeds already in
       * cash for this event-level curve.
       */
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
  dataset: Dataset,
  config: Configuration,
  startTime: number,
  endTime: number
): Result {
  const candidates: Position[] = [];

  let candidateSignals = 0;

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
        market.candles,
        config.slopeThreshold,
        config.accelerationThreshold
      );

    candidateSignals +=
      signals.length;

    for (
      const signal of signals
    ) {
      const position =
        simulatePosition(
          market.symbol,
          market.candles,
          signal
        );

      candidates.push(
        position
      );

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
  }

  /*
   * Apply the portfolio concurrency
   * constraint after generating all signals.
   *
   * This is important: signal generation
   * itself remains independent of portfolio
   * capacity.
   */
  const accepted =
    selectPositions(
      candidates,
      MAX_CONCURRENT_POSITIONS
    );

  const portfolio =
    runPortfolio(
      accepted,
      startTime,
      endTime
    );

  const combinedNet =
    realisedNet +
    unrealisedGross;

  /*
   * The aggregate P&L above contains rejected
   * positions. Recalculate P&L from accepted
   * positions so the portfolio statistics
   * describe the actual strategy.
   */
  realisedGross = 0;
  realisedFees = 0;
  realisedNet = 0;
  unrealisedGross = 0;

  completedPositions = 0;
  openPositions = 0;

  winningPositions = 0;
  losingPositions = 0;

  closedProfit = 0;
  closedLoss = 0;

  holdTimes.length = 0;

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

  const actualCombinedNet =
    realisedNet +
    unrealisedGross;

  /*
   * The portfolio runner starts with the
   * minimum cash needed to execute the
   * accepted historical sequence.
   */
  const totalReturn =
    portfolio.minimumStartingCash >
    0
      ? actualCombinedNet /
        portfolio.minimumStartingCash
      : 0;

  const returnOnPeakCapital =
    portfolio.peakCapitalDeployed >
    0
      ? actualCombinedNet /
        portfolio.peakCapitalDeployed
      : 0;

  const returnOnAverageCapital =
    portfolio.averageCapitalDeployed >
    0
      ? actualCombinedNet /
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
            actualCombinedNet /
              portfolio.averageCapitalDeployed,
          1 /
            totalYears
        ) - 1
      : 0;

  return {
    name: config.name,

    slopeThreshold:
      config.slopeThreshold,

    accelerationThreshold:
      config.accelerationThreshold,

    candidateSignals,

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

    combinedNet:
      actualCombinedNet,

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
    "Signal selectivity portfolio research"
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
    `Maximum concurrent positions: ${MAX_CONCURRENT_POSITIONS}`
  );

  console.log(
    `Fee rate: ${(FEE_RATE * 100).toFixed(3)}%`
  );

  console.log(
    `Configurations: ${CONFIGURATIONS.length}`
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

  const results: Result[] =
    [];

  const globalStart =
    Date.now();

  for (
    let i = 0;
    i < CONFIGURATIONS.length;
    i++
  ) {
    const config =
      CONFIGURATIONS[i];

    console.log(
      `[${i + 1}/${CONFIGURATIONS.length}] ${config.name}`
    );

    const started =
      Date.now();

    const result =
      runConfiguration(
        dataset,
        config,
        startTime,
        endTime
      );

    results.push(result);

    console.log(
      `  candidates: ${result.candidateSignals.toLocaleString()}`
    );

    console.log(
      `  accepted: ${result.acceptedSignals.toLocaleString()}`
    );

    console.log(
      `  minimum cash: $${result.minimumStartingCash.toFixed(2)}`
    );

    console.log(
      `  peak capital: $${result.peakCapitalDeployed.toFixed(2)}`
    );

    console.log(
      `  final equity: $${result.finalEquity.toFixed(2)}`
    );

    console.log(
      `  return: ${(result.totalReturn * 100).toFixed(3)}%`
    );

    console.log(
      `  drawdown: ${(result.maxDrawdownPct * 100).toFixed(3)}%`
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
      `  runtime: ${(
        (Date.now() -
          started) /
        1000
      ).toFixed(2)}s`
    );
  }

  results.sort(
    (a, b) =>
      b.totalReturn -
      a.totalReturn
  );

  const output = {
    generatedAt:
      new Date().toISOString(),

    methodology: {
      purpose:
        "Determine whether stricter entry-signal thresholds can reduce required capital without materially reducing portfolio return.",

      positionNotional:
        POSITION_NOTIONAL,

      minimumTransactionNotional:
        POSITION_NOTIONAL,

      maxConcurrentPositions:
        MAX_CONCURRENT_POSITIONS,

      targets: TARGETS,

      stopPct:
        STOP_PCT,

      maxHoldMinutes:
        MAX_HOLD_MINUTES,

      feeRate:
        FEE_RATE,

      executionCost:
        EXECUTION_COST,

      baseSlopeThreshold:
        BASE_SLOPE_THRESHOLD,

      baseAccelerationThreshold:
        BASE_ACCELERATION_THRESHOLD,

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

      scoreDefinition:
        "absolute slope strength plus acceleration strength",

      portfolioCapacity:
        "positions are accepted chronologically subject to maximum concurrent positions",

      accounting:
        "minimum starting cash is the smallest cash balance required to execute the accepted historical transaction sequence without borrowing",
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
      milliseconds:
        Date.now() -
        globalStart,
    },

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
      `signal-selectivity-${Date.now()}.json`
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "RESULTS"
  );
  console.log(
    "============================================================"
  );

  for (
    const result of results
  ) {
    console.log(
      [
        result.name.padEnd(
          22
        ),
        `signals=${String(
          result.acceptedSignals
        ).padStart(5)}`,
        `cash=$${result.minimumStartingCash
          .toFixed(0)
          .padStart(5)}`,
        `return=${(
          result.totalReturn *
          100
        )
          .toFixed(2)
          .padStart(6)}%`,
        `PF=${
          Number.isFinite(
            result.profitFactor
          )
            ? result.profitFactor.toFixed(
                2
              )
            : "Inf"
        }`,
        `DD=${(
          result.maxDrawdownPct *
          100
        )
          .toFixed(2)
          .padStart(5)}%`,
      ].join(" | ")
    );
  }

  console.log("");
  console.log(
    `Results written to: ${outputPath}`
  );
  console.log("");
}

main();
