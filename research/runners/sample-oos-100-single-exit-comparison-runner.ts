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

type StrategyName =
  | 'staggered'
  | 'single_5pct'
  | 'single_6pct'
  | 'single_7pct'
  | 'single_8pct'
  | 'single_9pct'
  | 'single_10pct';

type ExitReason =
  | 'target'
  | 'stop'
  | 'max_hold'
  | 'end_of_data';

interface TargetStage {
  returnPct: number;
  fraction: number;
}

interface ExitEvent {
  candleIndex: number;
  time: number;
  price: number;
  reason: ExitReason;
  fraction: number;
}

interface Position {
  id: number;
  marketIndex: number;
  symbol: string;

  entryTime: number;
  entryPrice: number;

  originalNotional: number;
  remainingNotional: number;

  entryFee: number;

  stopPrice: number;

  targetStages: TargetStage[];
  nextTargetIndex: number;

  exitEvents: ExitEvent[];

  nextExitEventIndex: number;

  realisedPnl: number;
  totalExitFees: number;

  finalExitTime: number;
  finalExitReason: ExitReason;
}

interface CompletedPosition {
  position: Position;
  pnl: number;
  returnPct: number;
  exitTime: number;
  exitReason: ExitReason;
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
  strategy: StrategyName;
  strategyDescription: string;

  startingCapital: number;

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

const OUTPUT_DIR = path.join(
  ROOT,
  'research/output'
);

const STARTING_CAPITAL = 100;

const SINGLE_TARGETS = [
  0.05,
  0.06,
  0.07,
  0.08,
  0.09,
  0.10
];

const STRATEGIES: Array<{
  name: StrategyName;
  description: string;
  targets: TargetStage[];
}> = [
  {
    name: 'staggered',
    description:
      '50% at +1%, 25% at +2%, 25% at +4%',
    targets: [
      {
        returnPct: 0.01,
        fraction: 0.50
      },
      {
        returnPct: 0.02,
        fraction: 0.25
      },
      {
        returnPct: 0.04,
        fraction: 0.25
      }
    ]
  },
  ...SINGLE_TARGETS.map(
    targetPct => {
      const percentage =
        Math.round(targetPct * 100);

      return {
        name:
          `single_${percentage}pct` as StrategyName,
        description:
          `100% at +${percentage}%`,
        targets: [
          {
            returnPct: targetPct,
            fraction: 1
          }
        ]
      };
    }
  )
];

const FEE_RATE = 0.001;
const STOP_PCT = 0.10;
const MAX_HOLD_MS =
  48 * 60 * 60 * 1000;

const MIN_POSITION_NOTIONAL = 10;
const MAX_POSITION_PCT = 0.05;
const MAX_CONCURRENT_POSITIONS = 43;

const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

/*
 * Exact signal-generation implementation from
 * the original working research runner.
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
      candles[i].close;
  }

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

function loadDataset(
  configuration: Configuration
): Dataset {
  console.log(
    `\nLoading ${configuration.name} dataset...`
  );

  console.log(
    `  ${configuration.path}`
  );

  const raw =
    fs.readFileSync(
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
      'Invalid dataset: markets array not found'
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

  const signalCountByMarket:
    number[] =
      new Array(
        dataset.markets.length
      ).fill(0);

  console.log(
    `  Preparing signals for ${dataset.markets.length} markets...`
  );

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

    const indices =
      buildSignalIndices(
        market.candles
      );

    signalCountByMarket[
      marketIndex
    ] = indices.length;

    for (
      const candleIndex of indices
    ) {
      const candle =
        market.candles[
          candleIndex
        ];

      signals.push({
        marketIndex,
        candleIndex,
        time:
          candle.openTime,
        price:
          candle.close
      });
    }

    const interval =
      Math.max(
        1,
        Math.floor(
          dataset.markets.length /
            10
        )
      );

    if (
      (marketIndex + 1) %
        interval ===
      0
    ) {
      console.log(
        `  ${marketIndex + 1}/${dataset.markets.length} markets`
      );
    }
  }

  signals.sort(
    (a, b) =>
      a.time - b.time
  );

  return {
    signals,
    signalCountByMarket
  };
}

function binarySearchCandleIndex(
  candles: Candle[],
  time: number
): number {
  let low = 0;
  let high =
    candles.length - 1;

  while (low <= high) {
    const middle =
      Math.floor(
        (low + high) / 2
      );

    if (
      candles[middle]
        .openTime <= time
    ) {
      low =
        middle + 1;
    } else {
      high =
        middle - 1;
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
  if (
    position.remainingNotional <=
    0
  ) {
    return 0;
  }

  const candleIndex =
    binarySearchCandleIndex(
      market.candles,
      time
    );

  const candle =
    market.candles[candleIndex];

  return (
    position.remainingNotional *
    (candle.close /
      position.entryPrice)
  );
}

function getEquityAtTime(
  cash: number,
  openPositions: Position[],
  dataset: Dataset,
  time: number
): number {
  let equity = cash;

  for (
    const position of
      openPositions
  ) {
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

  for (
    const position of
      openPositions
  ) {
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

function calculateMedian(
  values: number[]
): number {
  if (
    values.length === 0
  ) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 0
  ) {
    return (
      (sorted[middle - 1] +
        sorted[middle]) /
      2
    );
  }

  return sorted[middle];
}

/*
 * Find the actual exit events for one position.
 *
 * For a single target there is one target event.
 *
 * For the staggered strategy there can be
 * three target events:
 *
 *   50% at +1%
 *   25% at +2%
 *   25% at +4%
 *
 * A stop exits whatever remains.
 *
 * If a candle touches both the stop and a target,
 * the stop takes priority, matching the original
 * runner's conservative ordering.
 */
function buildExitEvents(
  market: MarketData,
  entryCandleIndex: number,
  entryPrice: number,
  targets: TargetStage[]
): ExitEvent[] {
  const stopPrice =
    entryPrice *
    (1 - STOP_PCT);

  const entryTime =
    market.candles[
      entryCandleIndex
    ].openTime;

  const maximumHoldTime =
    entryTime +
    MAX_HOLD_MS;

  const sortedTargets =
    [...targets].sort(
      (a, b) =>
        a.returnPct -
        b.returnPct
    );

  const events: ExitEvent[] = [];

  let nextTargetIndex = 0;

  for (
    let i =
      entryCandleIndex + 1;
    i < market.candles.length;
    i++
  ) {
    const candle =
      market.candles[i];

    /*
     * Stop has priority over every target
     * on the same candle.
     */
    if (
      candle.low <=
      stopPrice
    ) {
      events.push({
        candleIndex: i,
        time:
          candle.openTime,
        price: stopPrice,
        reason: 'stop',
        fraction:
          remainingTargetFraction(
            sortedTargets,
            nextTargetIndex
          )
      });

      return events;
    }

    /*
     * One candle can touch multiple
     * staggered target levels.
     */
    while (
      nextTargetIndex <
        sortedTargets.length &&
      candle.high >=
        entryPrice *
          (1 +
            sortedTargets[
              nextTargetIndex
            ].returnPct)
    ) {
      const target =
        sortedTargets[
          nextTargetIndex
        ];

      events.push({
        candleIndex: i,
        time:
          candle.openTime,
        price:
          entryPrice *
          (1 +
            target.returnPct),
        reason: 'target',
        fraction:
          target.fraction
      });

      nextTargetIndex++;
    }

    if (
      nextTargetIndex >=
      sortedTargets.length
    ) {
      return events;
    }

    if (
      candle.openTime >=
      maximumHoldTime
    ) {
      events.push({
        candleIndex: i,
        time:
          candle.openTime,
        price:
          candle.close,
        reason: 'max_hold',
        fraction:
          remainingTargetFraction(
            sortedTargets,
            nextTargetIndex
          )
      });

      return events;
    }
  }

  const finalIndex =
    market.candles.length - 1;

  const finalCandle =
    market.candles[
      finalIndex
    ];

  events.push({
    candleIndex:
      finalIndex,
    time:
      finalCandle.closeTime,
    price:
      finalCandle.close,
    reason:
      'end_of_data',
    fraction:
      remainingTargetFraction(
        sortedTargets,
        nextTargetIndex
      )
  });

  return events;
}

function remainingTargetFraction(
  targets: TargetStage[],
  nextTargetIndex: number
): number {
  let fraction = 0;

  for (
    let i =
      nextTargetIndex;
    i < targets.length;
    i++
  ) {
    fraction +=
      targets[i].fraction;
  }

  return fraction;
}

function createPosition(
  dataset: Dataset,
  signal: Signal,
  notional: number,
  targets: TargetStage[],
  id: number
): Position {
  const market =
    dataset.markets[
      signal.marketIndex
    ];

  const entryFee =
    notional * FEE_RATE;

  const exitEvents =
    buildExitEvents(
      market,
      signal.candleIndex,
      signal.price,
      targets
    );

  const stopPrice =
    signal.price *
    (1 - STOP_PCT);

  const finalEvent =
    exitEvents[
      exitEvents.length - 1
    ];

  return {
    id,

    marketIndex:
      signal.marketIndex,

    symbol:
      market.symbol,

    entryTime:
      signal.time,

    entryPrice:
      signal.price,

    originalNotional:
      notional,

    remainingNotional:
      notional,

    entryFee,

    stopPrice,

    targetStages:
      [...targets],

    nextTargetIndex: 0,

    exitEvents,

    nextExitEventIndex: 0,

    realisedPnl:
      -entryFee,

    totalExitFees: 0,

    finalExitTime:
      finalEvent.time,

    finalExitReason:
      finalEvent.reason
  };
}

function executeExitEvent(
  position: Position,
  event: ExitEvent
): number {
  if (
    position.remainingNotional <=
    0
  ) {
    return 0;
  }

  /*
   * The event fraction refers to the
   * original position.
   *
   * For example:
   *
   *   original £10
   *   50% target -> £5
   *   25% target -> £2.50
   *   25% target -> £2.50
   */
  const grossNotional =
    Math.min(
      position.remainingNotional,
      position.originalNotional *
        event.fraction
    );

  if (
    grossNotional <= 0
  ) {
    return 0;
  }

  const grossSaleValue =
    grossNotional *
    (event.price /
      position.entryPrice);

  const exitFee =
    grossSaleValue *
    FEE_RATE;

  const pnl =
    grossSaleValue -
    exitFee -
    grossNotional;

  position.remainingNotional -=
    grossNotional;

  position.realisedPnl +=
    pnl;

  position.totalExitFees +=
    exitFee;

  return (
    grossSaleValue -
    exitFee
  );
}

function simulateRun(
  dataset: Dataset,
  signals: Signal[],
  datasetName: string,
  strategy: {
    name: StrategyName;
    description: string;
    targets: TargetStage[];
  }
): BacktestResult {
  let cash =
    STARTING_CAPITAL;

  let nextPositionId = 1;

  const openPositions:
    Position[] = [];

  const completedPositions:
    CompletedPosition[] = [];

  let maximumConcurrentPositions =
    0;

  let skippedSignals = 0;

  let peakEquity =
    STARTING_CAPITAL;

  let maximumDrawdown = 0;
  let maximumDrawdownPct = 0;

  let totalOpenPositionCount = 0;
  let totalCapitalUtilisation = 0;
  let maximumCapitalUtilisation = 0;
  let equityPointCount = 0;

  let previousUtilisation = 0;
  let previousEquityTime = 0;

  let utilisationArea = 0;
  let observedDuration = 0;

  const timelineTimes =
    buildTimelineTimes(
      dataset
    );

  let signalPointer = 0;

  for (
    let timelineIndex = 0;
    timelineIndex <
      timelineTimes.length;
    timelineIndex++
  ) {
    const time =
      timelineTimes[
        timelineIndex
      ];

    /*
     * First process every exit event that
     * occurs at this timestamp.
     */
    for (
      let i =
        openPositions.length - 1;
      i >= 0;
      i--
    ) {
      const position =
        openPositions[i];

      while (
        position.nextExitEventIndex <
          position.exitEvents.length &&
        position.exitEvents[
          position.nextExitEventIndex
        ].time <= time
      ) {
        const event =
          position.exitEvents[
            position.nextExitEventIndex
          ];

        const saleValue =
          executeExitEvent(
            position,
            event
          );

        cash += saleValue;

        position.nextExitEventIndex++;

        /*
         * If this event was a target, move
         * to the next target stage.
         */
        if (
          event.reason ===
          'target'
        ) {
          position.nextTargetIndex++;
        }

        /*
         * Stop, max-hold and end-of-data
         * events close everything remaining.
         */
        if (
          event.reason !==
            'target' ||
          position.remainingNotional <=
            0.0000000001
        ) {
          if (
            position.remainingNotional >
            0.0000000001
          ) {
            /*
             * Numerical protection. Normally
             * stop/max-hold/end-of-data
             * already consumes all remaining
             * notional.
             */
            const remaining =
              position.remainingNotional;

            const grossSaleValue =
              remaining *
              (event.price /
                position.entryPrice);

            const exitFee =
              grossSaleValue *
              FEE_RATE;

            cash +=
              grossSaleValue -
              exitFee;

            position.realisedPnl +=
              grossSaleValue -
              exitFee -
              remaining;

            position.totalExitFees +=
              exitFee;

            position.remainingNotional =
              0;
          }

          break;
        }
      }

      if (
        position.remainingNotional <=
        0.0000000001
      ) {
        completedPositions.push({
          position,
          pnl:
            position.realisedPnl,
          returnPct:
            position.realisedPnl /
            position.originalNotional,
          exitTime:
            position.finalExitTime,
          exitReason:
            position.finalExitReason
        });

        openPositions.splice(
          i,
          1
        );
      }
    }

    /*
     * Process signals at this exact timestamp.
     *
     * Exits were processed first, so released
     * capital is available for new entries.
     */
    while (
      signalPointer <
        signals.length &&
      signals[signalPointer]
        .time <= time
    ) {
      const signal =
        signals[
          signalPointer
        ];

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
          equity *
            MAX_POSITION_PCT
        );

      const maximumAffordableNotional =
        cash /
        (1 + FEE_RATE);

      const notional =
        Math.min(
          desiredNotional,
          maximumAffordableNotional
        );

      if (
        notional <
        MIN_POSITION_NOTIONAL
      ) {
        skippedSignals++;
        continue;
      }

      const position =
        createPosition(
          dataset,
          signal,
          notional,
          strategy.targets,
          nextPositionId++
        );

      cash -=
        notional +
        position.entryFee;

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
      equity > 0
        ? invested / equity
        : 0;

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

    const drawdown =
      peakEquity -
      equity;

    const drawdownPct =
      peakEquity > 0
        ? drawdown /
          peakEquity
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

    /*
     * Correct time-weighted utilisation:
     *
     * utilisation from the previous
     * timestamp applies to the interval
     * leading up to this timestamp.
     */
    if (
      previousEquityTime > 0
    ) {
      const deltaTime =
        time -
        previousEquityTime;

      if (
        deltaTime >= 0
      ) {
        utilisationArea +=
          previousUtilisation *
          deltaTime;

        observedDuration +=
          deltaTime;
      }
    }

    previousUtilisation =
      utilisation;

    previousEquityTime =
      time;
  }

  /*
   * Any remaining positions are settled
   * at their already determined final event.
   *
   * This is mainly relevant at the end of
   * the dataset.
   */
  for (
    const position of [
      ...openPositions
    ]
  ) {
    while (
      position.nextExitEventIndex <
      position.exitEvents.length
    ) {
      const event =
        position.exitEvents[
          position.nextExitEventIndex
        ];

      const saleValue =
        executeExitEvent(
          position,
          event
        );

      cash += saleValue;

      position.nextExitEventIndex++;

      if (
        event.reason ===
        'target'
      ) {
        position.nextTargetIndex++;
      }

      if (
        position.remainingNotional <=
        0.0000000001
      ) {
        break;
      }
    }

    if (
      position.remainingNotional >
      0.0000000001
    ) {
      throw new Error(
        `Position ${position.id} was not fully closed`
      );
    }

    completedPositions.push({
      position,
      pnl:
        position.realisedPnl,
      returnPct:
        position.realisedPnl /
        position.originalNotional,
      exitTime:
        position.finalExitTime,
      exitReason:
        position.finalExitReason
    });
  }

  const finalEquity =
    cash;

  const winningTrades =
    completedPositions.filter(
      trade =>
        trade.pnl > 0
    );

  const losingTrades =
    completedPositions.filter(
      trade =>
        trade.pnl < 0
    );

  const grossProfit =
    winningTrades.reduce(
      (sum, trade) =>
        sum + trade.pnl,
      0
    );

  const grossLoss =
    Math.abs(
      losingTrades.reduce(
        (sum, trade) =>
          sum + trade.pnl,
        0
      )
    );

  const netPnl =
    completedPositions.reduce(
      (sum, trade) =>
        sum + trade.pnl,
      0
    );

  const totalFees =
    completedPositions.reduce(
      (sum, trade) =>
        sum +
        trade.position.entryFee +
        trade.position.totalExitFees,
      0
    );

  const tradeReturns =
    completedPositions.map(
      trade =>
        trade.returnPct
    );

  const holdHours =
    completedPositions.map(
      trade =>
        (trade.exitTime -
          trade.position.entryTime) /
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

  const simpleAverageUtilisation =
    equityPointCount > 0
      ? (
          totalCapitalUtilisation /
          equityPointCount
        ) * 100
      : 0;

  const timeWeightedUtilisation =
    observedDuration > 0
      ? (
          utilisationArea /
          observedDuration
        ) * 100
      : 0;

  const averageUtilisationPct =
    timeWeightedUtilisation > 0
      ? timeWeightedUtilisation
      : simpleAverageUtilisation;

  const averageOpenPositions =
    equityPointCount > 0
      ? totalOpenPositionCount /
        equityPointCount
      : 0;

  const targetExits =
    completedPositions.filter(
      trade =>
        trade.exitReason ===
        'target'
    ).length;

  const stopExits =
    completedPositions.filter(
      trade =>
        trade.exitReason ===
        'stop'
    ).length;

  const maxHoldExits =
    completedPositions.filter(
      trade =>
        trade.exitReason ===
        'max_hold'
    ).length;

  const endOfDataExits =
    completedPositions.filter(
      trade =>
        trade.exitReason ===
        'end_of_data'
    ).length;

  return {
    dataset:
      datasetName,

    strategy:
      strategy.name,

    strategyDescription:
      strategy.description,

    startingCapital:
      STARTING_CAPITAL,

    finalEquity,

    returnPct:
      (
        finalEquity /
          STARTING_CAPITAL -
        1
      ) * 100,

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
      completedPositions.length >
      0
        ? (
            winningTrades.length /
            completedPositions.length
          ) * 100
        : 0,

    grossProfit,
    grossLoss,
    netPnl,
    totalFees,

    profitFactor:
      grossLoss > 0
        ? grossProfit /
          grossLoss
        : Infinity,

    averageTradeReturnPct:
      tradeReturns.length > 0
        ? (
            tradeReturns.reduce(
              (sum, value) =>
                sum + value,
              0
            ) /
            tradeReturns.length
          ) * 100
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
      maximumCapitalUtilisation *
      100,

    totalPositionHours,

    averagePositionHours,

    signals:
      signals.length,

    skippedSignals
  };
}

function buildTimelineTimes(
  dataset: Dataset
): number[] {
  const times =
    new Set<number>();

  for (
    const market of
      dataset.markets
  ) {
    for (
      const candle of
        market.candles
    ) {
      times.add(
        candle.openTime
      );
    }
  }

  return Array.from(
    times
  ).sort(
    (a, b) => a - b
  );
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
        'This means the signal-generation logic or dataset has changed.'
      ].join(' ')
    );
  }

  console.log(
    `  Signal validation passed: ${actual.toLocaleString()} signals`
  );
}

function printResult(
  result: BacktestResult
): void {
  console.log(
    [
      result.dataset.padEnd(8),
      result.strategy.padEnd(13),
      `£${result.finalEquity.toFixed(2)}`.padStart(12),
      `return ${
        result.returnPct >= 0
          ? '+'
          : ''
      }${result.returnPct.toFixed(2)}%`,
      `DD ${result.maximumDrawdownPct.toFixed(2)}%`,
      `trades ${result.totalTrades}`,
      `PF ${
        Number.isFinite(
          result.profitFactor
        )
          ? result.profitFactor.toFixed(3)
          : '∞'
      }`
    ].join(' | ')
  );
}

function printComparison(
  results: BacktestResult[],
  datasetName: string
): void {
  const datasetResults =
    results.filter(
      result =>
        result.dataset ===
        datasetName
    );

  console.log(
    `\n${datasetName.toUpperCase()} — £100 strategy comparison`
  );

  console.log(
    'Strategy      | Final    | Return  | DD     | Trades | Win%   | PF     | Target | Stop | 48h | Avg util'
  );

  console.log(
    '--------------|----------|---------|--------|--------|--------|--------|--------|------|-----|---------'
  );

  for (
    const strategy of
      STRATEGIES
  ) {
    const result =
      datasetResults.find(
        item =>
          item.strategy ===
          strategy.name
      );

    if (!result) {
      continue;
    }

    console.log(
      [
        strategy.name.padEnd(13),
        `| £${result.finalEquity.toFixed(2).padStart(7)}`,
        `| ${
          result.returnPct >= 0
            ? '+'
            : ''
        }${result.returnPct.toFixed(2).padStart(6)}%`,
        `| ${result.maximumDrawdownPct.toFixed(2).padStart(6)}%`,
        `| ${String(result.totalTrades).padStart(6)}`,
        `| ${result.winRatePct.toFixed(2).padStart(6)}%`,
        `| ${Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(3).padStart(6) : '∞'.padStart(6)}`,
        `| ${String(result.targetExits).padStart(6)}`,
        `| ${String(result.stopExits).padStart(4)}`,
        `| ${String(result.maxHoldExits).padStart(3)}`,
        `| ${result.averageCapitalUtilisationPct.toFixed(1).padStart(7)}%`
      ].join(' ')
    );
  }
}

function printExitBreakdown(
  results: BacktestResult[],
  datasetName: string
): void {
  console.log(
    `\n${datasetName.toUpperCase()} — exit breakdown`
  );

  console.log(
    'Strategy      | Target | Stop | 48h | End | Avg hold | Avg trade'
  );

  console.log(
    '--------------|--------|------|-----|-----|----------|----------'
  );

  for (
    const strategy of
      STRATEGIES
  ) {
    const result =
      results.find(
        item =>
          item.dataset ===
            datasetName &&
          item.strategy ===
            strategy.name
      );

    if (!result) {
      continue;
    }

    console.log(
      [
        strategy.name.padEnd(13),
        `| ${String(result.targetExits).padStart(6)}`,
        `| ${String(result.stopExits).padStart(4)}`,
        `| ${String(result.maxHoldExits).padStart(3)}`,
        `| ${String(result.endOfDataExits).padStart(3)}`,
        `| ${result.medianHoldHours.toFixed(1).padStart(8)}h`,
        `| ${result.averageTradeReturnPct.toFixed(3).padStart(8)}%`
      ].join(' ')
    );
  }
}

function createOutputPath(): string {
  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );

  return path.join(
    OUTPUT_DIR,
    `staggered-vs-single-100-${Date.now()}.json`
  );
}

async function main(): Promise<void> {
  console.log(
    '============================================================'
  );

  console.log(
    '£100 staggered vs single-target portfolio backtest'
  );

  console.log(
    '============================================================'
  );

  console.log(
    '\nConfiguration:'
  );

  console.log(
    '  Starting capital:     £100'
  );

  console.log(
    '  Strategies:           staggered + 5%, 6%, 7%, 8%, 9%, 10%'
  );

  console.log(
    '  Minimum position:     £10'
  );

  console.log(
    '  Maximum position:     5% of equity'
  );

  console.log(
    '  Maximum positions:    43'
  );

  console.log(
    '  Stop loss:            10%'
  );

  console.log(
    '  Maximum hold:         48 hours'
  );

  console.log(
    '  Fee:                  0.10% per side'
  );

  console.log(
    '\nStaggered exit:'
  );

  console.log(
    '  50% at +1%'
  );

  console.log(
    '  25% at +2%'
  );

  console.log(
    '  25% at +4%'
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

  const allResults:
    BacktestResult[] = [];

  const datasetSummaries:
    Array<{
      name: string;
      markets: number;
      signals: number;
      firstTime: number;
      lastTime: number;
    }> = [];

  for (
    const configuration of
      DATASETS
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
      '\n  Running simulations...'
    );

    for (
      const strategy of
        STRATEGIES
    ) {
      console.log(
        `\n  ${strategy.name}: ${strategy.description}`
      );

      const result =
        simulateRun(
          dataset,
          signals,
          configuration.name,
          strategy
        );

      allResults.push(
        result
      );

      printResult(
        result
      );
    }

    const marketsWithSignals =
      signalCountByMarket.filter(
        count =>
          count > 0
      ).length;

    console.log(
      `\n  Markets containing signals: ${marketsWithSignals}/${dataset.markets.length}`
    );
  }

  printComparison(
    allResults,
    'training'
  );

  printComparison(
    allResults,
    'oos'
  );

  printExitBreakdown(
    allResults,
    'training'
  );

  printExitBreakdown(
    allResults,
    'oos'
  );

  const staggeredTraining =
    allResults.find(
      result =>
        result.dataset ===
          'training' &&
        result.strategy ===
          'staggered'
    );

  const staggeredOos =
    allResults.find(
      result =>
        result.dataset ===
          'oos' &&
        result.strategy ===
          'staggered'
    );

  const singleResults =
    allResults.filter(
      result =>
        result.strategy !==
        'staggered'
    );

  const output = {
    metadata: {
      generatedAt:
        new Date().toISOString(),

      startingCapital:
        STARTING_CAPITAL,

      datasets:
        datasetSummaries,

      strategies:
        STRATEGIES.map(
          strategy => ({
            name:
              strategy.name,
            description:
              strategy.description,
            targets:
              strategy.targets
          })
        ),

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

        staggeredExit:
          '50% at +1%, 25% at +2%, 25% at +4%',

        singleExit:
          '100% at the configured single target',

        stop:
          '10% below entry',

        maximumHold:
          '48 hours',

        fees:
          '0.1% on entry and 0.1% on each sale',

        sizing:
          'max(£10, 5% of current mark-to-market equity), capped by available cash',

        overlap:
          'Allowed',

        positionCap:
          '43 simultaneous positions',

        drawdown:
          'Mark-to-market equity sampled at every dataset candle',

        capitalUtilisation:
          'Time-weighted mark-to-market value of open positions divided by portfolio equity',

        staggeredAccounting:
          'Each partial sale releases only the sold fraction of the original position; remaining capital stays invested',

        sameCandleRule:
          'Stop takes priority if a candle touches both stop and target'
      }
    },

    comparison: {
      staggered: {
        training:
          staggeredTraining ?? null,
        oos:
          staggeredOos ?? null
      },

      singleTargets:
        singleResults
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
    `Expected: ${DATASETS.length * STRATEGIES.length}`
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
