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

interface Signal {
  symbol: string;
  index: number;
  time: number;

  entryPrice: number;

  slope20: number;
  slope50: number;
  acceleration: number;
  score: number;

  normalisedSlope20: number;
  normalisedSlope50: number;
  normalisedAcceleration: number;

  volume: number;
  candleRangePct: number;
}

interface ForwardMetric {
  minutes: number;
  available: boolean;

  closeReturnPct: number;
  highReturnPct: number;
  lowReturnPct: number;

  mfePct: number;
  maePct: number;
}

interface SignalOutcome {
  signal: Signal;

  forward: ForwardMetric[];

  hit1Pct: boolean;
  hit2Pct: boolean;
  hit4Pct: boolean;
  hitStop: boolean;

  firstTargetMinutes: number | null;

  maxMfePct: number;
  maxMaePct: number;

  finalReturnPct: number;
  finalAvailable: boolean;
}

interface MarketSummary {
  symbol: string;

  candles: number;
  durationDays: number;

  candidateSignals: number;

  averageSignalScore: number;
  medianSignalScore: number;

  averageSlope20: number;
  medianSlope20: number;

  averageNormalisedSlope20: number;
  medianNormalisedSlope20: number;

  averageAcceleration: number;
  medianAcceleration: number;

  averageNormalisedAcceleration: number;
  medianNormalisedAcceleration: number;

  averageVolume: number;
  medianVolume: number;

  averageCandleRangePct: number;
  medianCandleRangePct: number;

  signalRatePerDay: number;

  forward: Record<
    string,
    {
      observations: number;
      meanReturnPct: number;
      medianReturnPct: number;

      meanMfePct: number;
      medianMfePct: number;

      meanMaePct: number;
      medianMaePct: number;

      positiveReturnRate: number;
      hit1PctRate: number;
      hit2PctRate: number;
      hit4PctRate: number;
      stop10PctRate: number;
    }
  >;

  outcome: {
    averageMaxMfePct: number;
    medianMaxMfePct: number;

    averageMaxMaePct: number;
    medianMaxMaePct: number;

    averageFinalReturnPct: number;
    medianFinalReturnPct: number;

    positiveFinalReturnRate: number;

    target1HitRate: number;
    target2HitRate: number;
    target4HitRate: number;
    stopHitRate: number;

    averageTimeToFirstTargetMinutes: number | null;
    medianTimeToFirstTargetMinutes: number | null;
  };
}

interface UniverseSummary {
  name: string;
  markets: number;
  candles: number;
  durationDays: number;

  candidateSignals: number;

  signalRatePerMarketPerDay: number;

  averageMarketScore: number;

  forward: Record<
    string,
    {
      observations: number;
      meanReturnPct: number;
      medianReturnPct: number;

      meanMfePct: number;
      medianMfePct: number;

      meanMaePct: number;
      medianMaePct: number;

      positiveReturnRate: number;
      hit1PctRate: number;
      hit2PctRate: number;
      hit4PctRate: number;
      stop10PctRate: number;
    }
  >;

  target1HitRate: number;
  target2HitRate: number;
  target4HitRate: number;
  stopHitRate: number;

  averageMaxMfePct: number;
  averageMaxMaePct: number;

  averageFinalReturnPct: number;
  positiveFinalReturnRate: number;
}

interface AnalysisOutput {
  generatedAt: string;

  methodology: {
    strategy: string;
    slopeWindowShort: number;
    slopeWindowLong: number;

    slopeThreshold: number;
    accelerationThreshold: number;

    positionCapacityUsed: number;

    forwardHorizonsMinutes: number[];

    stopPct: number;
    targetPcts: number[];

    normalisation: string;
  };

  universes: {
    original: {
      summary: UniverseSummary;
      markets: MarketSummary[];
    };

    oos: {
      summary: UniverseSummary;
      markets: MarketSummary[];
    };
  };

  rankings: {
    originalByMean20mReturn: string[];
    originalByMean50mReturn: string[];
    originalByMean1440mReturn: string[];

    oosByMean20mReturn: string[];
    oosByMean50mReturn: string[];
    oosByMean1440mReturn: string[];

    originalByTarget4Rate: string[];
    oosByTarget4Rate: string[];

    originalBySignalFrequency: string[];
    oosBySignalFrequency: string[];
  };

  crossUniverse: {
    commonMarkets: string[];
    originalOnlyMarkets: string[];
    oosOnlyMarkets: string[];
  };

  rawVsNormalised: {
    original: {
      candidateSignals: number;

      meanRawSlope20: number;
      meanNormalisedSlope20: number;

      meanRawAcceleration: number;
      meanNormalisedAcceleration: number;

      correlations: {
        scoreVs20mReturn: number;
        scoreVs50mReturn: number;
        normalisedSlopeVs20mReturn: number;
        normalisedAccelerationVs20mReturn: number;
        signalScoreVsMfe: number;
      };
    };

    oos: {
      candidateSignals: number;

      meanRawSlope20: number;
      meanNormalisedSlope20: number;

      meanRawAcceleration: number;
      meanNormalisedAcceleration: number;

      correlations: {
        scoreVs20mReturn: number;
        scoreVs50mReturn: number;
        normalisedSlopeVs20mReturn: number;
        normalisedAccelerationVs20mReturn: number;
        signalScoreVsMfe: number;
      };
    };
  };
}

const OUTPUT_DIR = path.join(
  process.cwd(),
  "server",
  "research-output"
);

const ORIGINAL_DATASET_PATH = path.join(
  OUTPUT_DIR,
  "ema-data-1789061547934.json"
);

const FEE_RATE = 0.001;
const EXECUTION_COST = 0;

const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692 * 1.30;

const STOP_PCT = 0.10;

const TARGET_PCTS = [
  0.01,
  0.02,
  0.04,
];

const FORWARD_HORIZONS = [
  5,
  10,
  20,
  50,
  120,
  360,
  720,
  1440,
  2880,
];

const SLOPE_WINDOW_SHORT = 20;
const SLOPE_WINDOW_LONG = 50;

const POSITION_CAPACITY = 43;

function median(values: number[]): number {
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

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function rate(
  numerator: number,
  denominator: number
): number {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function calculateFee(
  value: number
): number {
  return (
    value *
    (FEE_RATE + EXECUTION_COST)
  );
}

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

  const position =
    (sorted.length - 1) * p;

  const lower =
    Math.floor(position);

  const upper =
    Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight =
    position - lower;

  return (
    sorted[lower] * (1 - weight) +
    sorted[upper] * weight
  );
}

/**
 * Pearson correlation.
 */
function correlation(
  xs: number[],
  ys: number[]
): number {
  const length =
    Math.min(
      xs.length,
      ys.length
    );

  if (length < 2) {
    return 0;
  }

  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < length; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }

  const meanX =
    sumX / length;

  const meanY =
    sumY / length;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (let i = 0; i < length; i++) {
    const dx =
      xs[i] - meanX;

    const dy =
      ys[i] - meanY;

    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }

  const denominator =
    Math.sqrt(
      denominatorX *
        denominatorY
    );

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Rolling linear-regression slope.
 *
 * Uses prefix sums so every slope is
 * calculated in O(1).
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

  const slopes =
    new Float64Array(n);

  for (
    let end = windowSize - 1;
    end < n;
    end++
  ) {
    const start =
      end -
      windowSize +
      1;

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

function buildSignals(
  symbol: string,
  candles: Candle[]
): Signal[] {
  const closes =
    candles.map(
      candle => candle.close
    );

  const slope20 =
    buildRegressionSlopes(
      closes,
      SLOPE_WINDOW_SHORT
    );

  const slope50 =
    buildRegressionSlopes(
      closes,
      SLOPE_WINDOW_LONG
    );

  const signals: Signal[] = [];

  for (
    let i = SLOPE_WINDOW_LONG - 1;
    i < candles.length;
    i++
  ) {
    const price =
      candles[i].close;

    if (price <= 0) {
      continue;
    }

    const acceleration =
      slope20[i] -
      slope50[i];

    if (
      slope20[i] >
        SLOPE_THRESHOLD ||
      acceleration <
        ACCELERATION_THRESHOLD
    ) {
      continue;
    }

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

    const previousClose =
      i > 0
        ? candles[i - 1].close
        : price;

    const candleRangePct =
      previousClose > 0
        ? (
            candles[i].high -
            candles[i].low
          ) /
          previousClose
        : 0;

    signals.push({
      symbol,
      index: i,
      time: candles[i].openTime,
      entryPrice: price,

      slope20: slope20[i],
      slope50: slope50[i],
      acceleration,

      score,

      /*
       * These are diagnostic quantities.
       *
       * They are deliberately NOT used for
       * signal selection in this experiment.
       */
      normalisedSlope20:
        slope20[i] / price,

      normalisedSlope50:
        slope50[i] / price,

      normalisedAcceleration:
        acceleration / price,

      volume:
        candles[i].volume,

      candleRangePct,
    });
  }

  return signals;
}

function findCandleIndexAtOrAfter(
  candles: Candle[],
  startIndex: number,
  targetTime: number
): number {
  let low = startIndex;
  let high =
    candles.length - 1;

  let result =
    candles.length;

  while (low <= high) {
    const middle =
      (low + high) >> 1;

    if (
      candles[middle].openTime >=
      targetTime
    ) {
      result = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return result;
}

function analyseSignal(
  signal: Signal,
  candles: Candle[]
): SignalOutcome {
  const forward: ForwardMetric[] =
    [];

  let maxMfePct =
    Number.NEGATIVE_INFINITY;

  let maxMaePct =
    Number.POSITIVE_INFINITY;

  let hit1Pct = false;
  let hit2Pct = false;
  let hit4Pct = false;
  let hitStop = false;

  let firstTargetTime:
    number | null = null;

  for (
    const minutes of FORWARD_HORIZONS
  ) {
    const targetTime =
      signal.time +
      minutes * 60_000;

    const index =
      findCandleIndexAtOrAfter(
        candles,
        signal.index + 1,
        targetTime
      );

    if (
      index >= candles.length
    ) {
      forward.push({
        minutes,
        available: false,
        closeReturnPct: 0,
        highReturnPct: 0,
        lowReturnPct: 0,
        mfePct: 0,
        maePct: 0,
      });

      continue;
    }

    const candle =
      candles[index];

    const closeReturnPct =
      (
        candle.close /
          signal.entryPrice -
        1
      );

    const highReturnPct =
      (
        candle.high /
          signal.entryPrice -
        1
      );

    const lowReturnPct =
      (
        candle.low /
          signal.entryPrice -
        1
      );

    const mfePct =
      Math.max(
        0,
        highReturnPct
      );

    const maePct =
      Math.min(
        0,
        lowReturnPct
      );

    maxMfePct =
      Math.max(
        maxMfePct,
        highReturnPct
      );

    maxMaePct =
      Math.min(
        maxMaePct,
        lowReturnPct
      );

    forward.push({
      minutes,
      available: true,
      closeReturnPct,
      highReturnPct,
      lowReturnPct,
      mfePct,
      maePct,
    });

    if (
      highReturnPct >=
      TARGET_PCTS[0]
    ) {
      hit1Pct = true;

      if (
        firstTargetTime === null
      ) {
        firstTargetTime =
          minutes;
      }
    }

    if (
      highReturnPct >=
      TARGET_PCTS[1]
    ) {
      hit2Pct = true;

      if (
        firstTargetTime === null
      ) {
        firstTargetTime =
          minutes;
      }
    }

    if (
      highReturnPct >=
      TARGET_PCTS[2]
    ) {
      hit4Pct = true;

      if (
        firstTargetTime === null
      ) {
        firstTargetTime =
          minutes;
      }
    }

    if (
      lowReturnPct <=
      -STOP_PCT
    ) {
      hitStop = true;
    }
  }

  if (
    maxMfePct ===
    Number.NEGATIVE_INFINITY
  ) {
    maxMfePct = 0;
  }

  if (
    maxMaePct ===
    Number.POSITIVE_INFINITY
  ) {
    maxMaePct = 0;
  }

  const finalMetric =
    forward[
      forward.length - 1
    ];

  return {
    signal,
    forward,

    hit1Pct,
    hit2Pct,
    hit4Pct,
    hitStop,

    firstTargetMinutes:
      firstTargetTime,

    maxMfePct,
    maxMaePct,

    finalReturnPct:
      finalMetric?.closeReturnPct ??
      0,

    finalAvailable:
      finalMetric?.available ??
      false,
  };
}

function analyseMarket(
  market: MarketData
): MarketSummary {
  const candles =
    market.candles;

  const signals =
    buildSignals(
      market.symbol,
      candles
    );

  const outcomes =
    signals.map(signal =>
      analyseSignal(
        signal,
        candles
      )
    );

  const startTime =
    candles[0]?.openTime ?? 0;

  const endTime =
    candles[
      candles.length - 1
    ]?.openTime ?? startTime;

  const durationDays =
    Math.max(
      0,
      (endTime - startTime) /
        86_400_000
    );

  const signalScores =
    signals.map(
      signal => signal.score
    );

  const slope20 =
    signals.map(
      signal => signal.slope20
    );

  const normalisedSlope20 =
    signals.map(
      signal =>
        signal.normalisedSlope20
    );

  const acceleration =
    signals.map(
      signal =>
        signal.acceleration
    );

  const normalisedAcceleration =
    signals.map(
      signal =>
        signal.normalisedAcceleration
    );

  const volumes =
    signals.map(
      signal => signal.volume
    );

  const candleRanges =
    signals.map(
      signal =>
        signal.candleRangePct
    );

  const forward:
    MarketSummary["forward"] =
    {};

  for (
    const minutes of
    FORWARD_HORIZONS
  ) {
    const available =
      outcomes
        .map(outcome =>
          outcome.forward.find(
            metric =>
              metric.minutes ===
              minutes
          )
        )
        .filter(
          (
            metric
          ): metric is ForwardMetric =>
            Boolean(
              metric?.available
            )
        );

    const returns =
      available.map(
        metric =>
          metric.closeReturnPct
      );

    const mfes =
      available.map(
        metric => metric.mfePct
      );

    const maes =
      available.map(
        metric => metric.maePct
      );

    let hit1 = 0;
    let hit2 = 0;
    let hit4 = 0;
    let stop = 0;

    for (
      const metric of available
    ) {
      if (
        metric.highReturnPct >=
        TARGET_PCTS[0]
      ) {
        hit1++;
      }

      if (
        metric.highReturnPct >=
        TARGET_PCTS[1]
      ) {
        hit2++;
      }

      if (
        metric.highReturnPct >=
        TARGET_PCTS[2]
      ) {
        hit4++;
      }

      if (
        metric.lowReturnPct <=
        -STOP_PCT
      ) {
        stop++;
      }
    }

    forward[
      String(minutes)
    ] = {
      observations:
        available.length,

      meanReturnPct:
        mean(returns),

      medianReturnPct:
        median(returns),

      meanMfePct:
        mean(mfes),

      medianMfePct:
        median(mfes),

      meanMaePct:
        mean(maes),

      medianMaePct:
        median(maes),

      positiveReturnRate:
        rate(
          returns.filter(
            value => value > 0
          ).length,
          returns.length
        ),

      hit1PctRate:
        rate(
          hit1,
          available.length
        ),

      hit2PctRate:
        rate(
          hit2,
          available.length
        ),

      hit4PctRate:
        rate(
          hit4,
          available.length
        ),

      stop10PctRate:
        rate(
          stop,
          available.length
        ),
    };
  }

  const firstTargetTimes =
    outcomes
      .map(
        outcome =>
          outcome.firstTargetMinutes
      )
      .filter(
        (
          value
        ): value is number =>
          value !== null
      );

  const finalReturns =
    outcomes
      .filter(
        outcome =>
          outcome.finalAvailable
      )
      .map(
        outcome =>
          outcome.finalReturnPct
      );

  return {
    symbol: market.symbol,

    candles:
      candles.length,

    durationDays,

    candidateSignals:
      signals.length,

    averageSignalScore:
      mean(signalScores),

    medianSignalScore:
      median(signalScores),

    averageSlope20:
      mean(slope20),

    medianSlope20:
      median(slope20),

    averageNormalisedSlope20:
      mean(normalisedSlope20),

    medianNormalisedSlope20:
      median(normalisedSlope20),

    averageAcceleration:
      mean(acceleration),

    medianAcceleration:
      median(acceleration),

    averageNormalisedAcceleration:
      mean(
        normalisedAcceleration
      ),

    medianNormalisedAcceleration:
      median(
        normalisedAcceleration
      ),

    averageVolume:
      mean(volumes),

    medianVolume:
      median(volumes),

    averageCandleRangePct:
      mean(candleRanges),

    medianCandleRangePct:
      median(candleRanges),

    signalRatePerDay:
      rate(
        signals.length,
        durationDays
      ),

    forward,

    outcome: {
      averageMaxMfePct:
        mean(
          outcomes.map(
            outcome =>
              outcome.maxMfePct
          )
        ),

      medianMaxMfePct:
        median(
          outcomes.map(
            outcome =>
              outcome.maxMfePct
          )
        ),

      averageMaxMaePct:
        mean(
          outcomes.map(
            outcome =>
              outcome.maxMaePct
          )
        ),

      medianMaxMaePct:
        median(
          outcomes.map(
            outcome =>
              outcome.maxMaePct
          )
        ),

      averageFinalReturnPct:
        mean(finalReturns),

      medianFinalReturnPct:
        median(finalReturns),

      positiveFinalReturnRate:
        rate(
          finalReturns.filter(
            value => value > 0
          ).length,
          finalReturns.length
        ),

      target1HitRate:
        rate(
          outcomes.filter(
            outcome =>
              outcome.hit1Pct
          ).length,
          outcomes.length
        ),

      target2HitRate:
        rate(
          outcomes.filter(
            outcome =>
              outcome.hit2Pct
          ).length,
          outcomes.length
        ),

      target4HitRate:
        rate(
          outcomes.filter(
            outcome =>
              outcome.hit4Pct
          ).length,
          outcomes.length
        ),

      stopHitRate:
        rate(
          outcomes.filter(
            outcome =>
              outcome.hitStop
          ).length,
          outcomes.length
        ),

      averageTimeToFirstTargetMinutes:
        firstTargetTimes.length > 0
          ? mean(firstTargetTimes)
          : null,

      medianTimeToFirstTargetMinutes:
        firstTargetTimes.length > 0
          ? median(firstTargetTimes)
          : null,
    },
  };
}

function aggregateUniverse(
  name: string,
  markets: MarketSummary[]
): UniverseSummary {
  const allForward:
    Record<
      string,
      {
        returns: number[];
        mfes: number[];
        maes: number[];
        hit1: number;
        hit2: number;
        hit4: number;
        stop: number;
      }
    > = {};

  for (
    const minutes of
    FORWARD_HORIZONS
  ) {
    allForward[
      String(minutes)
    ] = {
      returns: [],
      mfes: [],
      maes: [],
      hit1: 0,
      hit2: 0,
      hit4: 0,
      stop: 0,
    };
  }

  let candles = 0;
  let durationDays = 0;
  let candidateSignals = 0;

  for (
    const market of markets
  ) {
    candles += market.candles;
    durationDays +=
      market.durationDays;

    candidateSignals +=
      market.candidateSignals;

    for (
      const minutes of
      FORWARD_HORIZONS
    ) {
      const stats =
        market.forward[
          String(minutes)
        ];

      if (!stats) {
        continue;
      }

      /*
       * Reconstruct aggregate quantities
       * from market means weighted by
       * observation count.
       *
       * This avoids storing every outcome
       * in the final JSON.
       */
      const bucket =
        allForward[
          String(minutes)
        ];

      bucket.returns.push(
        ...Array(
          stats.observations
        ).fill(
          stats.meanReturnPct
        )
      );

      bucket.mfes.push(
        ...Array(
          stats.observations
        ).fill(
          stats.meanMfePct
        )
      );

      bucket.maes.push(
        ...Array(
          stats.observations
        ).fill(
          stats.meanMaePct
        )
      );

      bucket.hit1 +=
        Math.round(
          stats.hit1PctRate *
            stats.observations
        );

      bucket.hit2 +=
        Math.round(
          stats.hit2PctRate *
            stats.observations
        );

      bucket.hit4 +=
        Math.round(
          stats.hit4PctRate *
            stats.observations
        );

      bucket.stop +=
        Math.round(
          stats.stop10PctRate *
            stats.observations
        );
    }
  }

  const forward:
    UniverseSummary["forward"] =
    {};

  for (
    const minutes of
    FORWARD_HORIZONS
  ) {
    const bucket =
      allForward[
        String(minutes)
      ];

    const positive =
      bucket.returns.filter(
        value => value > 0
      ).length;

    forward[
      String(minutes)
    ] = {
      observations:
        bucket.returns.length,

      meanReturnPct:
        mean(bucket.returns),

      medianReturnPct:
        median(bucket.returns),

      meanMfePct:
        mean(bucket.mfes),

      medianMfePct:
        median(bucket.mfes),

      meanMaePct:
        mean(bucket.maes),

      medianMaePct:
        median(bucket.maes),

      positiveReturnRate:
        rate(
          positive,
          bucket.returns.length
        ),

      hit1PctRate:
        rate(
          bucket.hit1,
          bucket.returns.length
        ),

      hit2PctRate:
        rate(
          bucket.hit2,
          bucket.returns.length
        ),

      hit4PctRate:
        rate(
          bucket.hit4,
          bucket.returns.length
        ),

      stop10PctRate:
        rate(
          bucket.stop,
          bucket.returns.length
        ),
    };
  }

  const allScores =
    markets.map(
      market =>
        market.averageSignalScore
    );

  const totalMarketDays =
    markets.reduce(
      (
        total,
        market
      ) =>
        total +
        market.durationDays,
      0
    );

  return {
    name,

    markets:
      markets.length,

    candles,

    durationDays,

    candidateSignals,

    signalRatePerMarketPerDay:
      rate(
        candidateSignals,
        totalMarketDays
      ),

    averageMarketScore:
      mean(allScores),

    forward,

    target1HitRate:
      mean(
        markets.map(
          market =>
            market.outcome
              .target1HitRate
        )
      ),

    target2HitRate:
      mean(
        markets.map(
          market =>
            market.outcome
              .target2HitRate
        )
      ),

    target4HitRate:
      mean(
        markets.map(
          market =>
            market.outcome
              .target4HitRate
        )
      ),

    stopHitRate:
      mean(
        markets.map(
          market =>
            market.outcome
              .stopHitRate
        )
      ),

    averageMaxMfePct:
      mean(
        markets.map(
          market =>
            market.outcome
              .averageMaxMfePct
        )
      ),

    averageMaxMaePct:
      mean(
        markets.map(
          market =>
            market.outcome
              .averageMaxMaePct
        )
      ),

    averageFinalReturnPct:
      mean(
        markets.map(
          market =>
            market.outcome
              .averageFinalReturnPct
        )
      ),

    positiveFinalReturnRate:
      mean(
        markets.map(
          market =>
            market.outcome
              .positiveFinalReturnRate
        )
      ),
  };
}

function buildMarketRankings(
  markets: MarketSummary[]
): {
  by20m: string[];
  by50m: string[];
  by1440m: string[];
  byTarget4: string[];
  byFrequency: string[];
} {
  const by20m =
    [...markets].sort(
      (a, b) =>
        (
          b.forward["20"]
            ?.meanReturnPct ?? 0
        ) -
        (
          a.forward["20"]
            ?.meanReturnPct ?? 0
        )
    );

  const by50m =
    [...markets].sort(
      (a, b) =>
        (
          b.forward["50"]
            ?.meanReturnPct ?? 0
        ) -
        (
          a.forward["50"]
            ?.meanReturnPct ?? 0
        )
    );

  const by1440m =
    [...markets].sort(
      (a, b) =>
        (
          b.forward["1440"]
            ?.meanReturnPct ?? 0
        ) -
        (
          a.forward["1440"]
            ?.meanReturnPct ?? 0
        )
    );

  const byTarget4 =
    [...markets].sort(
      (a, b) =>
        b.outcome
          .target4HitRate -
        a.outcome
          .target4HitRate
    );

  const byFrequency =
    [...markets].sort(
      (a, b) =>
        b.signalRatePerDay -
        a.signalRatePerDay
    );

  return {
    by20m:
      by20m.map(
        market => market.symbol
      ),

    by50m:
      by50m.map(
        market => market.symbol
      ),

    by1440m:
      by1440m.map(
        market => market.symbol
      ),

    byTarget4:
      byTarget4.map(
        market => market.symbol
      ),

    byFrequency:
      byFrequency.map(
        market => market.symbol
      ),
  };
}

function analyseRawVsNormalised(
  markets: MarketData[]
): AnalysisOutput["rawVsNormalised"]["original"] {
  const scoreValues: number[] = [];
  const return20Values: number[] = [];
  const return50Values: number[] = [];
  const normalisedSlopeValues: number[] = [];
  const normalisedAccelerationValues: number[] = [];
  const mfeValues: number[] = [];

  let candidateSignals = 0;

  let rawSlopeSum = 0;
  let normalisedSlopeSum = 0;
  let rawAccelerationSum = 0;
  let normalisedAccelerationSum = 0;

  for (
    const market of markets
  ) {
    const signals =
      buildSignals(
        market.symbol,
        market.candles
      );

    candidateSignals +=
      signals.length;

    for (
      const signal of signals
    ) {
      const outcome =
        analyseSignal(
          signal,
          market.candles
        );

      const return20 =
        outcome.forward.find(
          metric =>
            metric.minutes === 20 &&
            metric.available
        );

      const return50 =
        outcome.forward.find(
          metric =>
            metric.minutes === 50 &&
            metric.available
        );

      scoreValues.push(
        signal.score
      );

      normalisedSlopeValues.push(
        signal.normalisedSlope20
      );

      normalisedAccelerationValues.push(
        signal.normalisedAcceleration
      );

      rawSlopeSum +=
        signal.slope20;

      normalisedSlopeSum +=
        signal.normalisedSlope20;

      rawAccelerationSum +=
        signal.acceleration;

      normalisedAccelerationSum +=
        signal.normalisedAcceleration;

      if (return20) {
        return20Values.push(
          return20.closeReturnPct
        );
      } else {
        return20Values.push(0);
      }

      if (return50) {
        return50Values.push(
          return50.closeReturnPct
        );
      } else {
        return50Values.push(0);
      }

      mfeValues.push(
        outcome.maxMfePct
      );
    }
  }

  return {
    candidateSignals,

    meanRawSlope20:
      rate(
        rawSlopeSum,
        candidateSignals
      ),

    meanNormalisedSlope20:
      rate(
        normalisedSlopeSum,
        candidateSignals
      ),

    meanRawAcceleration:
      rate(
        rawAccelerationSum,
        candidateSignals
      ),

    meanNormalisedAcceleration:
      rate(
        normalisedAccelerationSum,
        candidateSignals
      ),

    correlations: {
      scoreVs20mReturn:
        correlation(
          scoreValues,
          return20Values
        ),

      scoreVs50mReturn:
        correlation(
          scoreValues,
          return50Values
        ),

      normalisedSlopeVs20mReturn:
        correlation(
          normalisedSlopeValues,
          return20Values
        ),

      normalisedAccelerationVs20mReturn:
        correlation(
          normalisedAccelerationValues,
          return20Values
        ),

      signalScoreVsMfe:
        correlation(
          scoreValues,
          mfeValues
        ),
    },
  };
}

function findLatestOosDataset(): string {
  const files =
    fs
      .readdirSync(OUTPUT_DIR)
      .filter(file =>
        /^ema-data-oos-60-\d+\.json$/.test(
          file
        )
      );

  if (files.length === 0) {
    throw new Error(
      "No ema-data-oos-60-*.json dataset found."
    );
  }

  files.sort();

  return path.join(
    OUTPUT_DIR,
    files[files.length - 1]
  );
}

function loadDataset(
  datasetPath: string
): Dataset {
  console.log(
    `Loading dataset: ${datasetPath}`
  );

  const raw =
    fs.readFileSync(
      datasetPath,
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
      `Invalid dataset: ${datasetPath}`
    );
  }

  return dataset;
}

function buildUniverseSummary(
  name: string,
  dataset: Dataset
): {
  summary: UniverseSummary;
  markets: MarketSummary[];
} {
  console.log(
    `\nAnalysing ${name}: ${dataset.markets.length} markets`
  );

  const markets: MarketSummary[] =
    [];

  let completed = 0;

  for (
    const market of dataset.markets
  ) {
    const summary =
      analyseMarket(market);

    markets.push(summary);

    completed++;

    if (
      completed % 10 === 0 ||
      completed ===
        dataset.markets.length
    ) {
      console.log(
        `  analysed ${completed}/${dataset.markets.length}`
      );
    }
  }

  return {
    summary:
      aggregateUniverse(
        name,
        markets
      ),

    markets,
  };
}

function calculateCrossUniverse(
  original: MarketSummary[],
  oos: MarketSummary[]
): AnalysisOutput["crossUniverse"] {
  const originalSymbols =
    new Set(
      original.map(
        market => market.symbol
      )
    );

  const oosSymbols =
    new Set(
      oos.map(
        market => market.symbol
      )
    );

  const commonMarkets =
    [...originalSymbols]
      .filter(symbol =>
        oosSymbols.has(symbol)
      )
      .sort();

  const originalOnlyMarkets =
    [...originalSymbols]
      .filter(
        symbol =>
          !oosSymbols.has(symbol)
      )
      .sort();

  const oosOnlyMarkets =
    [...oosSymbols]
      .filter(
        symbol =>
          !originalSymbols.has(symbol)
      )
      .sort();

  return {
    commonMarkets,
    originalOnlyMarkets,
    oosOnlyMarkets,
  };
}

function writeOutput(
  output: AnalysisOutput
): string {
  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true }
  );

  const timestamp =
    Date.now();

  const outputPath =
    path.join(
      OUTPUT_DIR,
      `market-quality-analysis-${timestamp}.json`
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  return outputPath;
}

function printSummary(
  name: string,
  summary: UniverseSummary,
  markets: MarketSummary[]
): void {
  console.log(
    `\n============================================================`
  );

  console.log(
    `${name.toUpperCase()} MARKET QUALITY`
  );

  console.log(
    `============================================================`
  );

  console.log(
    `Markets: ${summary.markets}`
  );

  console.log(
    `Candidate signals: ${summary.candidateSignals}`
  );

  console.log(
    `Signals / market / day: ${summary.signalRatePerMarketPerDay.toFixed(2)}`
  );

  for (
    const minutes of
    [20, 50, 1440]
  ) {
    const stats =
      summary.forward[
        String(minutes)
      ];

    console.log(
      `\n${minutes}-minute outcome`
    );

    console.log(
      `  observations: ${stats.observations}`
    );

    console.log(
      `  mean return: ${(stats.meanReturnPct * 100).toFixed(4)}%`
    );

    console.log(
      `  median return: ${(stats.medianReturnPct * 100).toFixed(4)}%`
    );

    console.log(
      `  mean MFE: ${(stats.meanMfePct * 100).toFixed(4)}%`
    );

    console.log(
      `  mean MAE: ${(stats.meanMaePct * 100).toFixed(4)}%`
    );

    console.log(
      `  positive return: ${(stats.positiveReturnRate * 100).toFixed(2)}%`
    );

    console.log(
      `  +1% hit: ${(stats.hit1PctRate * 100).toFixed(2)}%`
    );

    console.log(
      `  +2% hit: ${(stats.hit2PctRate * 100).toFixed(2)}%`
    );

    console.log(
      `  +4% hit: ${(stats.hit4PctRate * 100).toFixed(2)}%`
    );

    console.log(
      `  -10% stop: ${(stats.stop10PctRate * 100).toFixed(2)}%`
    );
  }

  console.log(
    `\nTop 10 markets by 50-minute return:`
  );

  const top =
    [...markets]
      .sort(
        (a, b) =>
          (
            b.forward["50"]
              ?.meanReturnPct ?? 0
          ) -
          (
            a.forward["50"]
              ?.meanReturnPct ?? 0
          )
      )
      .slice(0, 10);

  for (
    let i = 0;
    i < top.length;
    i++
  ) {
    const market =
      top[i];

    console.log(
      `${String(i + 1).padStart(2)}. ` +
      `${market.symbol.padEnd(12)} ` +
      `signals=${String(
        market.candidateSignals
      ).padStart(5)} ` +
      `20m=${(
        (
          market.forward["20"]
            ?.meanReturnPct ?? 0
        ) * 100
      ).toFixed(3)}% ` +
      `50m=${(
        (
          market.forward["50"]
            ?.meanReturnPct ?? 0
        ) * 100
      ).toFixed(3)}% ` +
      `1%=${(
        market.outcome
          .target1HitRate * 100
      ).toFixed(1)}%`
    );
  }

  console.log(
    `\nBottom 10 markets by 50-minute return:`
  );

  const bottom =
    [...markets]
      .sort(
        (a, b) =>
          (
            a.forward["50"]
              ?.meanReturnPct ?? 0
          ) -
          (
            b.forward["50"]
              ?.meanReturnPct ?? 0
          )
      )
      .slice(0, 10);

  for (
    let i = 0;
    i < bottom.length;
    i++
  ) {
    const market =
      bottom[i];

    console.log(
      `${String(i + 1).padStart(2)}. ` +
      `${market.symbol.padEnd(12)} ` +
      `signals=${String(
        market.candidateSignals
      ).padStart(5)} ` +
      `20m=${(
        (
          market.forward["20"]
            ?.meanReturnPct ?? 0
        ) * 100
      ).toFixed(3)}% ` +
      `50m=${(
        (
          market.forward["50"]
            ?.meanReturnPct ?? 0
        ) * 100
      ).toFixed(3)}% ` +
      `1%=${(
        market.outcome
          .target1HitRate * 100
      ).toFixed(1)}%`
    );
  }
}

function main(): void {
  console.log(
    "============================================================"
  );

  console.log(
    "MARKET QUALITY ANALYSIS"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `Slope threshold: ${SLOPE_THRESHOLD}`
  );

  console.log(
    `Acceleration threshold: ${ACCELERATION_THRESHOLD}`
  );

  console.log(
    `Position capacity reference: ${POSITION_CAPACITY}`
  );

  console.log(
    `Forward horizons: ${FORWARD_HORIZONS.join(", ")} minutes`
  );

  const oosDatasetPath =
    findLatestOosDataset();

  const originalDataset =
    loadDataset(
      ORIGINAL_DATASET_PATH
    );

  const oosDataset =
    loadDataset(
      oosDatasetPath
    );

  const original =
    buildUniverseSummary(
      "original",
      originalDataset
    );

  const oos =
    buildUniverseSummary(
      "oos",
      oosDataset
    );

  printSummary(
    "original",
    original.summary,
    original.markets
  );

  printSummary(
    "oos",
    oos.summary,
    oos.markets
  );

  console.log(
    "\nCalculating raw vs normalised relationships..."
  );

  const rawVsNormalisedOriginal =
    analyseRawVsNormalised(
      originalDataset.markets
    );

  const rawVsNormalisedOos =
    analyseRawVsNormalised(
      oosDataset.markets
    );

  const originalRankings =
    buildMarketRankings(
      original.markets
    );

  const oosRankings =
    buildMarketRankings(
      oos.markets
    );

  const output: AnalysisOutput = {
    generatedAt:
      new Date().toISOString(),

    methodology: {
      strategy:
        "Existing frozen slope20/slope50 acceleration signal; diagnostic analysis only",

      slopeWindowShort:
        SLOPE_WINDOW_SHORT,

      slopeWindowLong:
        SLOPE_WINDOW_LONG,

      slopeThreshold:
        SLOPE_THRESHOLD,

      accelerationThreshold:
        ACCELERATION_THRESHOLD,

      positionCapacityUsed:
        POSITION_CAPACITY,

      forwardHorizonsMinutes:
        FORWARD_HORIZONS,

      stopPct:
        STOP_PCT,

      targetPcts:
        TARGET_PCTS,

      normalisation:
        "Diagnostic price normalisation = regression slope divided by entry price. Normalised values are NOT used for signal selection.",
    },

    universes: {
      original,
      oos,
    },

    rankings: {
      originalByMean20mReturn:
        originalRankings.by20m,

      originalByMean50mReturn:
        originalRankings.by50m,

      originalByMean1440mReturn:
        originalRankings.by1440m,

      oosByMean20mReturn:
        oosRankings.by20m,

      oosByMean50mReturn:
        oosRankings.by50m,

      oosByMean1440mReturn:
        oosRankings.by1440m,

      originalByTarget4Rate:
        originalRankings.byTarget4,

      oosByTarget4Rate:
        oosRankings.byTarget4,

      originalBySignalFrequency:
        originalRankings.byFrequency,

      oosBySignalFrequency:
        oosRankings.byFrequency,
    },

    crossUniverse:
      calculateCrossUniverse(
        original.markets,
        oos.markets
      ),

    rawVsNormalised: {
      original:
        rawVsNormalisedOriginal,

      oos:
        rawVsNormalisedOos,
    },
  };

  const outputPath =
    writeOutput(output);

  console.log(
    "\n============================================================"
  );

  console.log(
    "ANALYSIS COMPLETE"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `Output: ${outputPath}`
  );

  console.log(
    "\nRaw vs normalised:"
  );

  console.log(
    `Original score -> 20m return correlation: ` +
    rawVsNormalisedOriginal.correlations.scoreVs20mReturn.toFixed(
      6
    )
  );

  console.log(
    `Original score -> 50m return correlation: ` +
    rawVsNormalisedOriginal.correlations.scoreVs50mReturn.toFixed(
      6
    )
  );

  console.log(
    `Original normalised slope -> 20m return: ` +
    rawVsNormalisedOriginal.correlations.normalisedSlopeVs20mReturn.toFixed(
      6
    )
  );

  console.log(
    `OOS score -> 20m return correlation: ` +
    rawVsNormalisedOos.correlations.scoreVs20mReturn.toFixed(
      6
    )
  );

  console.log(
    `OOS score -> 50m return correlation: ` +
    rawVsNormalisedOos.correlations.scoreVs50mReturn.toFixed(
      6
    )
  );

  console.log(
    `OOS normalised slope -> 20m return: ` +
    rawVsNormalisedOos.correlations.normalisedSlopeVs20mReturn.toFixed(
      6
    )
  );
}

main();
