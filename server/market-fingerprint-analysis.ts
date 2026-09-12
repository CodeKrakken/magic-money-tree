import fs from 'node:fs';
import path from 'node:path';

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime?: number;
}

interface MarketDataset {
  symbol: string;
  candles: Candle[];
  [key: string]: unknown;
}

interface Dataset {
  markets: MarketDataset[];
  [key: string]: unknown;
}

interface Fingerprint {
  symbol: string;
  group: 'first60' | 'second60';

  observations: number;

  totalReturn: number;
  annualisedVolatility: number;

  // Quote-volume characteristics.
  meanQuoteVolume20: number;
  medianQuoteVolume20: number;
  meanQuoteVolume50: number;
  quoteVolumeConsistency20: number;
  quoteVolumeConsistency50: number;

  // Relative volume characteristics.
  meanRelativeVolume20: number;
  medianRelativeVolume20: number;
  volumeExpansionRate: number;

  // Volatility.
  volatility5: number;
  volatility15: number;
  volatility50: number;
  volatilityRatio5To50: number;
  volatilityRatio15To50: number;

  // Return distribution.
  meanReturn1: number;
  meanReturn5: number;
  meanReturn15: number;
  meanReturn50: number;

  returnStd1: number;
  returnSkew1: number;

  positiveReturnRate20: number;
  trendPersistence20: number;

  // Large moves.
  largeMoveRate01: number;
  largeMoveRate025: number;
  largeMoveRate05: number;

  // Serial dependence / mean reversion.
  autocorrelation1: number;
  autocorrelation5: number;
  autocorrelation15: number;
  autocorrelation50: number;

  meanReversion5: number;
  meanReversion15: number;
  meanReversion50: number;

  // Forward behaviour.
  forward5: number;
  forward10: number;
  forward20: number;
  forward50: number;

  // Feature -> future-return relationships.
  correlations: Record<string, number>;
}

interface Observation {
  quoteVolume20: number;
  quoteVolume50: number;
  relativeVolume20: number;
  volumeExpansion: number;

  volatility5: number;
  volatility15: number;
  volatility50: number;

  volatilityRatio5To50: number;
  volatilityRatio15To50: number;

  return1: number;
  return5: number;
  return15: number;
  return50: number;

  largeMove01: number;
  largeMove025: number;
  largeMove05: number;

  forward5: number;
  forward10: number;
  forward20: number;
  forward50: number;
}

interface GroupSummary {
  group: 'first60' | 'second60';
  markets: number;

  meanTotalReturn: number;
  medianTotalReturn;

  meanAnnualisedVolatility: number;

  meanQuoteVolume20: number;
  medianQuoteVolume20: number;

  meanRelativeVolume20: number;
  meanVolumeExpansionRate: number;

  meanVolatility5: number;
  meanVolatility15: number;
  meanVolatility50: number;

  meanVolatilityRatio5To50: number;
  meanVolatilityRatio15To50: number;

  meanReturn1: number;
  meanReturn5: number;
  meanReturn15: number;
  meanReturn50: number;

  meanReturnSkew1: number;

  meanPositiveReturnRate20: number;
  meanTrendPersistence20: number;

  meanLargeMoveRate01: number;
  meanLargeMoveRate025: number;
  meanLargeMoveRate05: number;

  meanAutocorrelation1: number;
  meanAutocorrelation5: number;
  meanAutocorrelation15: number;
  meanAutocorrelation50: number;

  meanReversion5: number;
  meanReversion15: number;
  meanReversion50: number;

  meanForward5: number;
  meanForward10: number;
  meanForward20: number;
  meanForward50: number;

  positiveMarkets: number;
  negativeMarkets: number;
}

interface Difference {
  metric: string;
  first60: number;
  second60: number;
  difference: number;
  relativeDifference: number;
}

const WARMUP = 50;

const FEATURE_NAMES = [
  'quoteVolume20',
  'quoteVolume50',
  'relativeVolume20',
  'volumeExpansion',
  'volatility5',
  'volatility15',
  'volatility50',
  'volatilityRatio5To50',
  'volatilityRatio15To50',
  'return1',
  'return5',
  'return15',
  'return50',
  'largeMove01',
  'largeMove025',
  'largeMove05',
];

const FORWARD_NAMES = [
  'forward5',
  'forward10',
  'forward20',
  'forward50',
];

function finiteValues(values: number[]): number[] {
  return values.filter(Number.isFinite);
}

function mean(values: number[]): number {
  const valid = finiteValues(values);

  if (valid.length === 0) {
    return 0;
  }

  return (
    valid.reduce((sum, value) => sum + value, 0) /
    valid.length
  );
}

function median(values: number[]): number {
  const valid = finiteValues(values).sort(
    (a, b) => a - b,
  );

  if (valid.length === 0) {
    return 0;
  }

  const middle = Math.floor(valid.length / 2);

  if (valid.length % 2 === 0) {
    return (
      (valid[middle - 1] + valid[middle]) / 2
    );
  }

  return valid[middle];
}

function standardDeviation(values: number[]): number {
  const valid = finiteValues(values);

  if (valid.length < 2) {
    return 0;
  }

  const average = mean(valid);

  return Math.sqrt(
    mean(
      valid.map(
        (value) => (value - average) ** 2,
      ),
    ),
  );
}

function skewness(values: number[]): number {
  const valid = finiteValues(values);

  if (valid.length < 3) {
    return 0;
  }

  const average = mean(valid);
  const sd = standardDeviation(valid);

  if (sd === 0) {
    return 0;
  }

  return (
    mean(
      valid.map(
        (value) =>
          ((value - average) / sd) ** 3,
      ),
    )
  );
}

function pearsonCorrelation(
  xValues: number[],
  yValues: number[],
): number {
  const pairs: Array<[number, number]> = [];

  for (
    let i = 0;
    i < Math.min(xValues.length, yValues.length);
    i += 1
  ) {
    if (
      Number.isFinite(xValues[i]) &&
      Number.isFinite(yValues[i])
    ) {
      pairs.push([xValues[i], yValues[i]]);
    }
  }

  if (pairs.length < 3) {
    return 0;
  }

  const x = pairs.map(([value]) => value);
  const y = pairs.map(([, value]) => value);

  const xMean = mean(x);
  const yMean = mean(y);

  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (let i = 0; i < pairs.length; i += 1) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;

    numerator += dx * dy;
    xVariance += dx ** 2;
    yVariance += dy ** 2;
  }

  const denominator = Math.sqrt(
    xVariance * yVariance,
  );

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function percentile(
  values: number[],
  percentileValue: number,
): number {
  const valid = finiteValues(values).sort(
    (a, b) => a - b,
  );

  if (valid.length === 0) {
    return 0;
  }

  const index =
    (valid.length - 1) * percentileValue;

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return valid[lower];
  }

  const weight = index - lower;

  return (
    valid[lower] * (1 - weight) +
    valid[upper] * weight
  );
}

function returnBetween(
  candles: Candle[],
  start: number,
  end: number,
): number {
  if (
    start < 0 ||
    end >= candles.length ||
    start >= end
  ) {
    return 0;
  }

  const startPrice = candles[start].close;
  const endPrice = candles[end].close;

  if (
    startPrice <= 0 ||
    !Number.isFinite(startPrice) ||
    !Number.isFinite(endPrice)
  ) {
    return 0;
  }

  return endPrice / startPrice - 1;
}

function oneMinuteReturns(
  candles: Candle[],
  start: number,
  end: number,
): number[] {
  const returns: number[] = [];

  const first = Math.max(1, start);

  for (let i = first; i <= end; i += 1) {
    const previous = candles[i - 1].close;
    const current = candles[i].close;

    if (
      previous > 0 &&
      Number.isFinite(previous) &&
      Number.isFinite(current)
    ) {
      returns.push(current / previous - 1);
    }
  }

  return returns;
}

function volatility(
  candles: Candle[],
  endIndex: number,
  window: number,
): number {
  const returns = oneMinuteReturns(
    candles,
    endIndex - window + 1,
    endIndex,
  );

  return standardDeviation(returns);
}

function quoteVolume(
  candle: Candle,
): number {
  if (
    !Number.isFinite(candle.close) ||
    !Number.isFinite(candle.volume)
  ) {
    return 0;
  }

  return Math.abs(candle.close * candle.volume);
}

function rollingQuoteVolumes(
  candles: Candle[],
  endIndex: number,
  window: number,
): number[] {
  const start = Math.max(
    0,
    endIndex - window + 1,
  );

  return candles
    .slice(start, endIndex + 1)
    .map(quoteVolume)
    .filter(Number.isFinite);
}

function relativeVolume(
  candles: Candle[],
  endIndex: number,
): number {
  const current = quoteVolume(
    candles[endIndex],
  );

  const previous = rollingQuoteVolumes(
    candles,
    endIndex - 1,
    50,
  );

  const baseline = median(previous);

  if (baseline <= 0) {
    return 0;
  }

  return current / baseline;
}

function volumeExpansion(
  candles: Candle[],
  endIndex: number,
): number {
  const recent = rollingQuoteVolumes(
    candles,
    endIndex,
    5,
  );

  const baseline = rollingQuoteVolumes(
    candles,
    endIndex - 5,
    50,
  );

  const recentMean = mean(recent);
  const baselineMedian = median(baseline);

  if (baselineMedian <= 0) {
    return 0;
  }

  return recentMean / baselineMedian;
}

function autocorrelation(
  values: number[],
  lag: number,
): number {
  if (values.length <= lag + 2) {
    return 0;
  }

  const x = values.slice(lag);
  const y = values.slice(
    0,
    values.length - lag,
  );

  return pearsonCorrelation(x, y);
}

function meanReversion(
  values: number[],
  lag: number,
): number {
  if (values.length <= lag + 2) {
    return 0;
  }

  const current = values.slice(lag);
  const previous = values.slice(
    0,
    values.length - lag,
  );

  return -pearsonCorrelation(
    previous,
    current,
  );
}

function trendPersistence(
  candles: Candle[],
  endIndex: number,
  window: number,
): number {
  const returns = oneMinuteReturns(
    candles,
    endIndex - window + 1,
    endIndex,
  );

  let previousDirection = 0;
  let comparisons = 0;
  let sameDirection = 0;

  for (const value of returns) {
    const direction =
      value > 0 ? 1 :
      value < 0 ? -1 :
      0;

    if (direction === 0) {
      continue;
    }

    if (previousDirection !== 0) {
      comparisons += 1;

      if (
        direction ===
        previousDirection
      ) {
        sameDirection += 1;
      }
    }

    previousDirection = direction;
  }

  if (comparisons === 0) {
    return 0;
  }

  return sameDirection / comparisons;
}

function largeMoveRate(
  candles: Candle[],
  endIndex: number,
  window: number,
  threshold: number,
): number {
  const returns = oneMinuteReturns(
    candles,
    endIndex - window + 1,
    endIndex,
  );

  if (returns.length === 0) {
    return 0;
  }

  return (
    returns.filter(
      (value) =>
        Math.abs(value) >= threshold,
    ).length / returns.length
  );
}

function createObservations(
  market: MarketDataset,
): Observation[] {
  const candles = market.candles;
  const observations: Observation[] = [];

  const lastIndex =
    candles.length - 51;

  for (
    let index = WARMUP;
    index <= lastIndex;
    index += 1
  ) {
    const quoteVolumes20 =
      rollingQuoteVolumes(
        candles,
        index,
        20,
      );

    const quoteVolumes50 =
      rollingQuoteVolumes(
        candles,
        index,
        50,
      );

    const quoteVolume20 =
      mean(quoteVolumes20);

    const quoteVolume50 =
      mean(quoteVolumes50);

    const quoteVolumeStd =
      standardDeviation(
        quoteVolumes20,
      );

    const quoteVolumeConsistency20 =
      quoteVolume20 > 0
        ? quoteVolumeStd / quoteVolume20
        : 0;

    const quoteVolumeStd50 =
      standardDeviation(
        quoteVolumes50,
      );

    const quoteVolumeConsistency50 =
      quoteVolume50 > 0
        ? quoteVolumeStd50 / quoteVolume50
        : 0;

    const volatility5 = volatility(
      candles,
      index,
      5,
    );

    const volatility15 = volatility(
      candles,
      index,
      15,
    );

    const volatility50 = volatility(
      candles,
      index,
      50,
    );

    const returns50 =
      oneMinuteReturns(
        candles,
        index - 49,
        index,
      );

    const volatilityRatio5To50 =
      volatility50 > 0
        ? volatility5 / volatility50
        : 0;

    const volatilityRatio15To50 =
      volatility50 > 0
        ? volatility15 / volatility50
        : 0;

    const return1 =
      returnBetween(
        candles,
        index - 1,
        index,
      );

    const return5 =
      returnBetween(
        candles,
        index - 5,
        index,
      );

    const return15 =
      returnBetween(
        candles,
        index - 15,
        index,
      );

    const return50 =
      returnBetween(
        candles,
        index - 50,
        index,
      );

    observations.push({
      quoteVolume20,
      quoteVolume50,

      relativeVolume20:
        relativeVolume(
          candles,
          index,
        ),

      volumeExpansion:
        volumeExpansion(
          candles,
          index,
        ),

      volatility5,
      volatility15,
      volatility50,

      volatilityRatio5To50,
      volatilityRatio15To50,

      return1,
      return5,
      return15,
      return50,

      largeMove01:
        largeMoveRate(
          candles,
          index,
          20,
          0.001,
        ),

      largeMove025:
        largeMoveRate(
          candles,
          index,
          20,
          0.0025,
        ),

      largeMove05:
        largeMoveRate(
          candles,
          index,
          20,
          0.005,
        ),

      forward5:
        returnBetween(
          candles,
          index,
          index + 5,
        ),

      forward10:
        returnBetween(
          candles,
          index,
          index + 10,
        ),

      forward20:
        returnBetween(
          candles,
          index,
          index + 20,
        ),

      forward50:
        returnBetween(
          candles,
          index,
          index + 50,
        ),
    });
  }

  return observations;
}

function analyseMarket(
  market: MarketDataset,
  group: 'first60' | 'second60',
): Fingerprint {
  const observations =
    createObservations(market);

  const candles = market.candles;

  const getObservationValues = (
    name: keyof Observation,
  ): number[] =>
    observations.map(
      (observation) =>
        observation[name] as number,
    );

  const marketReturns =
    observations.map(
      (observation) =>
        observation.return1,
    );

  const totalReturn =
    returnBetween(
      candles,
      0,
      candles.length - 1,
    );

  const allReturns =
    oneMinuteReturns(
      candles,
      1,
      candles.length - 1,
    );

  const returnStd =
    standardDeviation(allReturns);

  const annualisedVolatility =
    returnStd *
    Math.sqrt(365 * 24 * 60);

  const correlations: Record<
    string,
    number
  > = {};

  for (const feature of FEATURE_NAMES) {
    for (const forward of FORWARD_NAMES) {
      correlations[
        `${feature}_vs_${forward}`
      ] = pearsonCorrelation(
        getObservationValues(
          feature as keyof Observation,
        ),
        getObservationValues(
          forward as keyof Observation,
        ),
      );
    }
  }

  const return5Values =
    getObservationValues('return5');

  const return15Values =
    getObservationValues('return15');

  const return50Values =
    getObservationValues('return50');

  return {
    symbol: market.symbol,
    group,

    observations: observations.length,

    totalReturn,
    annualisedVolatility,

    meanQuoteVolume20: mean(
      getObservationValues(
        'quoteVolume20',
      ),
    ),

    medianQuoteVolume20: median(
      getObservationValues(
        'quoteVolume20',
      ),
    ),

    meanQuoteVolume50: mean(
      getObservationValues(
        'quoteVolume50',
      ),
    ),

    quoteVolumeConsistency20: mean(
      observations.map(
        (observation) => {
          const volumes =
            rollingQuoteVolumes(
              market.candles,
              WARMUP,
              20,
            );

          return volumes.length > 0
            ? standardDeviation(
                volumes,
              ) /
                Math.max(
                  mean(volumes),
                  Number.EPSILON,
                )
            : 0;
        },
      ),
    ),

    quoteVolumeConsistency50:
      mean(
        getObservationValues(
          'quoteVolume50',
        ),
      ) > 0
        ? standardDeviation(
            getObservationValues(
              'quoteVolume50',
            ),
          ) /
          mean(
            getObservationValues(
              'quoteVolume50',
            ),
          )
        : 0,

    meanRelativeVolume20: mean(
      getObservationValues(
        'relativeVolume20',
      ),
    ),

    medianRelativeVolume20: median(
      getObservationValues(
        'relativeVolume20',
      ),
    ),

    volumeExpansionRate: mean(
      getObservationValues(
        'volumeExpansion',
      ),
    ),

    volatility5: mean(
      getObservationValues(
        'volatility5',
      ),
    ),

    volatility15: mean(
      getObservationValues(
        'volatility15',
      ),
    ),

    volatility50: mean(
      getObservationValues(
        'volatility50',
      ),
    ),

    volatilityRatio5To50: mean(
      getObservationValues(
        'volatilityRatio5To50',
      ),
    ),

    volatilityRatio15To50: mean(
      getObservationValues(
        'volatilityRatio15To50',
      ),
    ),

    meanReturn1: mean(
      getObservationValues(
        'return1',
      ),
    ),

    meanReturn5: mean(return5Values),

    meanReturn15: mean(return15Values),

    meanReturn50: mean(return50Values),

    returnStd1: standardDeviation(
      marketReturns,
    ),

    returnSkew1: skewness(
      marketReturns,
    ),

    positiveReturnRate20: mean(
      observations.map(
        (observation) =>
          observation.return1 > 0
            ? 1
            : 0,
      ),
    ),

    trendPersistence20:
      trendPersistence(
        market.candles,
        Math.min(
          market.candles.length - 1,
          WARMUP + 1000,
        ),
        20,
      ),

    largeMoveRate01: mean(
      getObservationValues(
        'largeMove01',
      ),
    ),

    largeMoveRate025: mean(
      getObservationValues(
        'largeMove025',
      ),
    ),

    largeMoveRate05: mean(
      getObservationValues(
        'largeMove05',
      ),
    ),

    autocorrelation1:
      autocorrelation(
        allReturns,
        1,
      ),

    autocorrelation5:
      autocorrelation(
        allReturns,
        5,
      ),

    autocorrelation15:
      autocorrelation(
        allReturns,
        15,
      ),

    autocorrelation50:
      autocorrelation(
        allReturns,
        50,
      ),

    meanReversion5:
      meanReversion(
        allReturns,
        5,
      ),

    meanReversion15:
      meanReversion(
        allReturns,
        15,
      ),

    meanReversion50:
      meanReversion(
        allReturns,
        50,
      ),

    forward5: mean(
      getObservationValues(
        'forward5',
      ),
    ),

    forward10: mean(
      getObservationValues(
        'forward10',
      ),
    ),

    forward20: mean(
      getObservationValues(
        'forward20',
      ),
    ),

    forward50: mean(
      getObservationValues(
        'forward50',
      ),
    ),

    correlations,
  };
}

function summariseGroup(
  fingerprints: Fingerprint[],
  group: 'first60' | 'second60',
): GroupSummary {
  const markets =
    fingerprints.filter(
      (fingerprint) =>
        fingerprint.group === group,
    );

  const values = (
    name: keyof Fingerprint,
  ): number[] =>
    markets.map(
      (market) =>
        market[name] as number,
    );

  return {
    group,
    markets: markets.length,

    meanTotalReturn: mean(
      values('totalReturn'),
    ),

    medianTotalReturn: median(
      values('totalReturn'),
    ),

    meanAnnualisedVolatility: mean(
      values(
        'annualisedVolatility',
      ),
    ),

    meanQuoteVolume20: mean(
      values('meanQuoteVolume20'),
    ),

    medianQuoteVolume20: median(
      values('meanQuoteVolume20'),
    ),

    meanRelativeVolume20: mean(
      values(
        'meanRelativeVolume20',
      ),
    ),

    meanVolumeExpansionRate: mean(
      values(
        'volumeExpansionRate',
      ),
    ),

    meanVolatility5: mean(
      values('volatility5'),
    ),

    meanVolatility15: mean(
      values('volatility15'),
    ),

    meanVolatility50: mean(
      values('volatility50'),
    ),

    meanVolatilityRatio5To50: mean(
      values(
        'volatilityRatio5To50',
      ),
    ),

    meanVolatilityRatio15To50: mean(
      values(
        'volatilityRatio15To50',
      ),
    ),

    meanReturn1: mean(
      values('meanReturn1'),
    ),

    meanReturn5: mean(
      values('meanReturn5'),
    ),

    meanReturn15: mean(
      values('meanReturn15'),
    ),

    meanReturn50: mean(
      values('meanReturn50'),
    ),

    meanReturnSkew1: mean(
      values('returnSkew1'),
    ),

    meanPositiveReturnRate20: mean(
      values(
        'positiveReturnRate20',
      ),
    ),

    meanTrendPersistence20: mean(
      values(
        'trendPersistence20',
      ),
    ),

    meanLargeMoveRate01: mean(
      values(
        'largeMoveRate01',
      ),
    ),

    meanLargeMoveRate025: mean(
      values(
        'largeMoveRate025',
      ),
    ),

    meanLargeMoveRate05: mean(
      values(
        'largeMoveRate05',
      ),
    ),

    meanAutocorrelation1: mean(
      values('autocorrelation1'),
    ),

    meanAutocorrelation5: mean(
      values('autocorrelation5'),
    ),

    meanAutocorrelation15: mean(
      values('autocorrelation15'),
    ),

    meanAutocorrelation50: mean(
      values('autocorrelation50'),
    ),

    meanReversion5: mean(
      values('meanReversion5'),
    ),

    meanReversion15: mean(
      values('meanReversion15'),
    ),

    meanReversion50: mean(
      values('meanReversion50'),
    ),

    meanForward5: mean(
      values('forward5'),
    ),

    meanForward10: mean(
      values('forward10'),
    ),

    meanForward20: mean(
      values('forward20'),
    ),

    meanForward50: mean(
      values('forward50'),
    ),

    positiveMarkets: markets.filter(
      (market) =>
        market.totalReturn > 0,
    ).length,

    negativeMarkets: markets.filter(
      (market) =>
        market.totalReturn < 0,
    ).length,
  };
}

function calculateDifferences(
  first: GroupSummary,
  second: GroupSummary,
): Difference[] {
  const metrics: Array<
    keyof GroupSummary
  > = [
    'meanTotalReturn',
    'medianTotalReturn',
    'meanAnnualisedVolatility',
    'meanQuoteVolume20',
    'medianQuoteVolume20',
    'meanRelativeVolume20',
    'meanVolumeExpansionRate',
    'meanVolatility5',
    'meanVolatility15',
    'meanVolatility50',
    'meanVolatilityRatio5To50',
    'meanVolatilityRatio15To50',
    'meanReturn1',
    'meanReturn5',
    'meanReturn15',
    'meanReturn50',
    'meanReturnSkew1',
    'meanPositiveReturnRate20',
    'meanTrendPersistence20',
    'meanLargeMoveRate01',
    'meanLargeMoveRate025',
    'meanLargeMoveRate05',
    'meanAutocorrelation1',
    'meanAutocorrelation5',
    'meanAutocorrelation15',
    'meanAutocorrelation50',
    'meanReversion5',
    'meanReversion15',
    'meanReversion50',
    'meanForward5',
    'meanForward10',
    'meanForward20',
    'meanForward50',
  ];

  return metrics
    .map((metric) => {
      const firstValue =
        first[metric] as number;

      const secondValue =
        second[metric] as number;

      const difference =
        firstValue - secondValue;

      const denominator =
        Math.abs(secondValue);

      return {
        metric,
        first60: firstValue,
        second60: secondValue,
        difference,
        relativeDifference:
          denominator > 0
            ? difference / denominator
            : 0,
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.relativeDifference) -
        Math.abs(a.relativeDifference),
    );
}

function profitabilityCorrelations(
  fingerprints: Fingerprint[],
): Array<{
  metric: string;
  correlation: number;
  absoluteCorrelation: number;
}> {
  const metrics: Array<
    keyof Fingerprint
  > = [
    'meanQuoteVolume20',
    'medianQuoteVolume20',
    'meanRelativeVolume20',
    'volumeExpansionRate',
    'volatility5',
    'volatility15',
    'volatility50',
    'volatilityRatio5To50',
    'volatilityRatio15To50',
    'meanReturn1',
    'meanReturn5',
    'meanReturn15',
    'meanReturn50',
    'returnStd1',
    'returnSkew1',
    'positiveReturnRate20',
    'trendPersistence20',
    'largeMoveRate01',
    'largeMoveRate025',
    'largeMoveRate05',
    'autocorrelation1',
    'autocorrelation5',
    'autocorrelation15',
    'autocorrelation50',
    'meanReversion5',
    'meanReversion15',
    'meanReversion50',
    'forward5',
    'forward10',
    'forward20',
    'forward50',
  ];

  const returns =
    fingerprints.map(
      (fingerprint) =>
        fingerprint.totalReturn,
    );

  return metrics
    .map((metric) => {
      const values =
        fingerprints.map(
          (fingerprint) =>
            fingerprint[
              metric
            ] as number,
        );

      const correlation =
        pearsonCorrelation(
          values,
          returns,
        );

      return {
        metric,
        correlation,
        absoluteCorrelation:
          Math.abs(correlation),
      };
    })
    .sort(
      (a, b) =>
        b.absoluteCorrelation -
        a.absoluteCorrelation,
    );
}

function featureFutureRelationships(
  fingerprints: Fingerprint[],
): Array<{
  feature: string;
  forward: string;
  meanCorrelation: number;
  meanAbsoluteCorrelation: number;
}> {
  const results: Array<{
    feature: string;
    forward: string;
    meanCorrelation: number;
    meanAbsoluteCorrelation: number;
  }> = [];

  for (const feature of FEATURE_NAMES) {
    for (const forward of FORWARD_NAMES) {
      const values =
        fingerprints.map(
          (fingerprint) =>
            fingerprint.correlations[
              `${feature}_vs_${forward}`
            ],
        );

      results.push({
        feature,
        forward,
        meanCorrelation: mean(values),
        meanAbsoluteCorrelation:
          mean(
            values.map(
              (value) =>
                Math.abs(value),
            ),
          ),
      });
    }
  }

  return results.sort(
    (a, b) =>
      b.meanAbsoluteCorrelation -
      a.meanAbsoluteCorrelation,
  );
}

function validateDataset(
  dataset: Dataset,
  filename: string,
): void {
  if (
    !dataset ||
    !Array.isArray(dataset.markets)
  ) {
    throw new Error(
      `${filename} does not contain a markets array.`,
    );
  }

  if (dataset.markets.length !== 60) {
    throw new Error(
      `${filename} contains ${dataset.markets.length} markets; expected exactly 60.`,
    );
  }

  for (const market of dataset.markets) {
    if (
      typeof market.symbol !== 'string' ||
      !Array.isArray(market.candles)
    ) {
      throw new Error(
        `Invalid market structure in ${filename}: ${market.symbol}`,
      );
    }

    if (
      market.candles.length <
      WARMUP + 51
    ) {
      throw new Error(
        `Market ${market.symbol} does not contain enough candles.`,
      );
    }
  }
}

function getPeriod(
  dataset: Dataset,
): {
  startTime: number;
  endTime: number;
  startIso: string;
  endIso: string;
} {
  const market = dataset.markets[0];

  const first = market.candles[0];
  const last =
    market.candles[
      market.candles.length - 1
    ];

  const startTime =
    Number(first.openTime);

  const endTime =
    Number(
      last.closeTime ??
        last.openTime,
    );

  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime)
  ) {
    throw new Error(
      'Could not determine dataset period from candle timestamps.',
    );
  }

  return {
    startTime,
    endTime,
    startIso:
      new Date(
        startTime,
      ).toISOString(),
    endIso:
      new Date(
        endTime,
      ).toISOString(),
  };
}

function formatPercent(
  value: number,
): string {
  return `${(
    value * 100
  ).toFixed(4)}%`;
}

function printSummary(
  summary: GroupSummary,
): void {
  console.log('');
  console.log(
    `GROUP: ${summary.group}`,
  );
  console.log(
    `  Markets:                 ${summary.markets}`,
  );
  console.log(
    `  Mean total return:       ${formatPercent(summary.meanTotalReturn)}`,
  );
  console.log(
    `  Median total return:     ${formatPercent(summary.medianTotalReturn)}`,
  );
  console.log(
    `  Mean quote volume:       ${summary.meanQuoteVolume20.toFixed(2)}`,
  );
  console.log(
    `  Mean relative volume:    ${summary.meanRelativeVolume20.toFixed(4)}`,
  );
  console.log(
    `  Mean volume expansion:   ${summary.meanVolumeExpansionRate.toFixed(4)}`,
  );
  console.log(
    `  Volatility 5m:           ${formatPercent(summary.meanVolatility5)}`,
  );
  console.log(
    `  Volatility 15m:          ${formatPercent(summary.meanVolatility15)}`,
  );
  console.log(
    `  Volatility 50m:          ${formatPercent(summary.meanVolatility50)}`,
  );
  console.log(
    `  Volatility ratio 5/50:   ${summary.meanVolatilityRatio5To50.toFixed(4)}`,
  );
  console.log(
    `  Volatility ratio 15/50:  ${summary.meanVolatilityRatio15To50.toFixed(4)}`,
  );
  console.log(
    `  Return skew:             ${summary.meanReturnSkew1.toFixed(4)}`,
  );
  console.log(
    `  Autocorrelation 1m:      ${summary.meanAutocorrelation1.toFixed(4)}`,
  );
  console.log(
    `  Autocorrelation 5m:      ${summary.meanAutocorrelation5.toFixed(4)}`,
  );
  console.log(
    `  Autocorrelation 15m:     ${summary.meanAutocorrelation15.toFixed(4)}`,
  );
  console.log(
    `  Autocorrelation 50m:     ${summary.meanAutocorrelation50.toFixed(4)}`,
  );
  console.log(
    `  Mean reversion 5m:       ${summary.meanReversion5.toFixed(4)}`,
  );
  console.log(
    `  Mean reversion 15m:      ${summary.meanReversion15.toFixed(4)}`,
  );
  console.log(
    `  Mean reversion 50m:      ${summary.meanReversion50.toFixed(4)}`,
  );
  console.log(
    `  Large moves >=0.1%:      ${formatPercent(summary.meanLargeMoveRate01)}`,
  );
  console.log(
    `  Large moves >=0.25%:     ${formatPercent(summary.meanLargeMoveRate025)}`,
  );
  console.log(
    `  Large moves >=0.5%:      ${formatPercent(summary.meanLargeMoveRate05)}`,
  );
  console.log(
    `  Positive markets:        ${summary.positiveMarkets}`,
  );
  console.log(
    `  Negative markets:        ${summary.negativeMarkets}`,
  );
}

async function main(): Promise<void> {
  const [
    ,
    ,
    firstFilename,
    secondFilename,
  ] = process.argv;

  if (
    !firstFilename ||
    !secondFilename
  ) {
    console.error('');
    console.error(
      'Usage:',
    );
    console.error('');
    console.error(
      'npx tsx server/market-fingerprint-analysis.ts <first-60-dataset> <second-60-dataset>',
    );
    console.error('');
    console.error(
      'Example:',
    );
    console.error(
      'npx tsx server/market-fingerprint-analysis.ts \\',
    );
    console.error(
      '  server/research-output/ema-data-1789061547934.json \\',
    );
    console.error(
      '  server/research-output/ema-data-oos-60-1789165540440.json',
    );

    process.exit(1);
  }

  console.log(
    '======================================================================',
  );
  console.log(
    'Market fingerprint analysis',
  );
  console.log(
    '======================================================================',
  );

  console.log('');
  console.log(
    `First 60:  ${firstFilename}`,
  );
  console.log(
    `Second 60: ${secondFilename}`,
  );

  const firstDataset =
    JSON.parse(
      fs.readFileSync(
        firstFilename,
        'utf8',
      ),
    ) as Dataset;

  const secondDataset =
    JSON.parse(
      fs.readFileSync(
        secondFilename,
        'utf8',
      ),
    ) as Dataset;

  validateDataset(
    firstDataset,
    firstFilename,
  );

  validateDataset(
    secondDataset,
    secondFilename,
  );

  const firstPeriod =
    getPeriod(firstDataset);

  const secondPeriod =
    getPeriod(secondDataset);

  console.log('');
  console.log(
    `First period:  ${firstPeriod.startIso} -> ${firstPeriod.endIso}`,
  );
  console.log(
    `Second period: ${secondPeriod.startIso} -> ${secondPeriod.endIso}`,
  );

  if (
    firstPeriod.startTime !==
      secondPeriod.startTime ||
    firstPeriod.endTime !==
      secondPeriod.endTime
  ) {
    console.warn('');
    console.warn(
      'WARNING: the datasets do not cover exactly the same period.',
    );
  }

  console.log('');
  console.log(
    'Calculating market fingerprints...',
  );

  const firstFingerprints =
    firstDataset.markets.map(
      (market) =>
        analyseMarket(
          market,
          'first60',
        ),
    );

  const secondFingerprints =
    secondDataset.markets.map(
      (market) =>
        analyseMarket(
          market,
          'second60',
        ),
    );

  const fingerprints = [
    ...firstFingerprints,
    ...secondFingerprints,
  ];

  console.log(
    'Market fingerprints complete.',
  );

  const firstSummary =
    summariseGroup(
      fingerprints,
      'first60',
    );

  const secondSummary =
    summariseGroup(
      fingerprints,
      'second60',
    );

  printSummary(firstSummary);
  printSummary(secondSummary);

  const differences =
    calculateDifferences(
      firstSummary,
      secondSummary,
    );

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Largest first-60 / second-60 characteristic differences',
  );
  console.log(
    '======================================================================',
  );

  for (
    const difference of differences.slice(
      0,
      20,
    )
  ) {
    console.log(
      `${difference.metric.padEnd(32)} ` +
      `first=${difference.first60.toFixed(6)} ` +
      `second=${difference.second60.toFixed(6)} ` +
      `difference=${difference.difference.toFixed(6)} ` +
      `relative=${formatPercent(difference.relativeDifference)}`,
    );
  }

  const profitability =
    profitabilityCorrelations(
      fingerprints,
    );

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Market characteristic -> total-return relationships',
  );
  console.log(
    '======================================================================',
  );

  for (
    const result of profitability.slice(
      0,
      20,
    )
  ) {
    console.log(
      `${result.metric.padEnd(32)} ` +
      `r=${result.correlation.toFixed(4)} ` +
      `|r|=${result.absoluteCorrelation.toFixed(4)}`,
    );
  }

  const futureRelationships =
    featureFutureRelationships(
      fingerprints,
    );

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Market characteristic -> forward-return relationships',
  );
  console.log(
    '======================================================================',
  );

  for (
    const result of futureRelationships.slice(
      0,
      20,
    )
  ) {
    console.log(
      `${result.feature.padEnd(32)} ` +
      `${result.forward.padEnd(12)} ` +
      `mean r=${result.meanCorrelation.toFixed(4)} ` +
      `mean |r|=${result.meanAbsoluteCorrelation.toFixed(4)}`,
    );
  }

  const marketReturnRanking =
    [...fingerprints].sort(
      (a, b) =>
        b.totalReturn -
        a.totalReturn,
    );

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Markets ranked by total return',
  );
  console.log(
    '======================================================================',
  );

  marketReturnRanking
    .slice(0, 20)
    .forEach(
      (market, index) => {
        console.log(
          `${String(index + 1).padStart(2)}. ` +
          `${market.symbol.padEnd(18)} ` +
          `${market.group.padEnd(9)} ` +
          `${formatPercent(market.totalReturn)}`,
        );
      },
    );

  const outputDirectory =
    path.dirname(
      firstFilename,
    );

  fs.mkdirSync(
    outputDirectory,
    {
      recursive: true,
    },
  );

  const output = {
    metadata: {
      generatedAt:
        new Date().toISOString(),

      firstDataset:
        path.resolve(
          firstFilename,
        ),

      secondDataset:
        path.resolve(
          secondFilename,
        ),

      firstPeriod,
      secondPeriod,

      methodology: {
        warmupCandles: WARMUP,

        quoteVolume:
          'close price multiplied by base-asset candle volume',

        purpose:
          'Identify structural market characteristics that distinguish the first 60 Binance markets from the second 60, and determine which market characteristics are associated with realised market returns.',

        characteristics: [
          'quote volume',
          'relative quote volume',
          'volume expansion',
          'short/medium/long volatility',
          'volatility regime ratios',
          'return distribution',
          'return skew',
          'large move frequency',
          'return autocorrelation',
          'mean reversion',
          'trend persistence',
          'forward returns',
        ],
      },
    },

    groupSummaries: {
      first60: firstSummary,
      second60: secondSummary,
      differences,
    },

    marketFingerprints:
      fingerprints,

    profitabilityRelationships:
      profitability,

    forwardReturnRelationships:
      futureRelationships,

    rankings: {
      byTotalReturn:
        marketReturnRanking.map(
          (market) => ({
            symbol: market.symbol,
            group: market.group,
            totalReturn:
              market.totalReturn,
          }),
        ),
    },
  };

  const outputFilename =
    path.join(
      outputDirectory,
      `market-fingerprint-analysis-${Date.now()}.json`,
    );

  fs.writeFileSync(
    outputFilename,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Analysis complete',
  );
  console.log(
    '======================================================================',
  );
  console.log('');
  console.log(
    `Output: ${outputFilename}`,
  );
}

main().catch(
  (error: unknown) => {
    console.error('');
    console.error(
      'Market fingerprint analysis failed:',
    );

    console.error(
      error instanceof Error
        ? error.stack ??
            error.message
        : error,
    );

    process.exit(1);
  },
);