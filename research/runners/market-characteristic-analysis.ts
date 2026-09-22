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
  startTime?: number | string;
  endTime?: number | string;
  [key: string]: unknown;
}

interface Observation {
  symbol: string;
  group: 'first60' | 'second60';
  index: number;

  volumeMean20: number;
  volumeMedian20: number;
  volumeConsistency20: number;

  volatility5: number;
  volatility15: number;
  volatility50: number;

  return5: number;
  return15: number;
  return50: number;

  positiveReturnRate20: number;
  trendPersistence20: number;
  volumeToVolatility: number;

  forward5: number;
  forward10: number;
  forward20: number;
  forward50: number;
}

interface MarketAnalysis {
  symbol: string;
  group: 'first60' | 'second60';

  observations: number;

  averageVolume20: number;
  medianVolume20: number;
  averageVolumeConsistency20: number;

  averageVolatility5: number;
  averageVolatility15: number;
  averageVolatility50: number;

  averageReturn5: number;
  averageReturn15: number;
  averageReturn50: number;

  positiveReturnRate20: number;
  trendPersistence20: number;
  volumeToVolatility: number;

  averageForward5: number;
  averageForward10: number;
  averageForward20: number;
  averageForward50: number;

  totalReturn: number;
  annualisedVolatility: number;

  correlations: Record<string, number>;
}

interface GroupSummary {
  group: 'first60' | 'second60';

  markets: number;

  meanTotalReturn: number;
  medianTotalReturn: number;

  meanForward5: number;
  meanForward10: number;
  meanForward20: number;
  meanForward50: number;

  meanVolume: number;
  meanVolatility15: number;
  meanTrendPersistence: number;
  meanPositiveReturnRate: number;
  meanVolumeToVolatility: number;

  positiveMarkets: number;
  negativeMarkets: number;

  totalReturnAcrossMarkets: number;
}

interface MarketContribution {
  symbol: string;
  group: 'first60' | 'second60';
  totalReturn: number;
  positiveReturnContribution: number;
  absoluteReturnContribution: number;
  rank: number;
}

const WARMUP = 50;
const FEATURE_NAMES = [
  'volumeMean20',
  'volumeMedian20',
  'volumeConsistency20',
  'volatility5',
  'volatility15',
  'volatility50',
  'return5',
  'return15',
  'return50',
  'positiveReturnRate20',
  'trendPersistence20',
  'volumeToVolatility',
];

const FORWARD_NAMES = [
  'forward5',
  'forward10',
  'forward20',
  'forward50',
];

function mean(values: number[]): number {
  const valid = values.filter(Number.isFinite);

  if (valid.length === 0) {
    return 0;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function median(values: number[]): number {
  const valid = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (valid.length === 0) {
    return 0;
  }

  const middle = Math.floor(valid.length / 2);

  if (valid.length % 2 === 0) {
    return (valid[middle - 1] + valid[middle]) / 2;
  }

  return valid[middle];
}

function standardDeviation(values: number[]): number {
  const valid = values.filter(Number.isFinite);

  if (valid.length < 2) {
    return 0;
  }

  const average = mean(valid);

  const variance = mean(
    valid.map((value) => (value - average) ** 2),
  );

  return Math.sqrt(variance);
}

function pearsonCorrelation(
  xValues: number[],
  yValues: number[],
): number {
  const pairs: Array<[number, number]> = [];

  for (let i = 0; i < Math.min(xValues.length, yValues.length); i += 1) {
    const x = xValues[i];
    const y = yValues[i];

    if (Number.isFinite(x) && Number.isFinite(y)) {
      pairs.push([x, y]);
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
  let xDenominator = 0;
  let yDenominator = 0;

  for (let i = 0; i < pairs.length; i += 1) {
    const xDeviation = x[i] - xMean;
    const yDeviation = y[i] - yMean;

    numerator += xDeviation * yDeviation;
    xDenominator += xDeviation ** 2;
    yDenominator += yDeviation ** 2;
  }

  const denominator = Math.sqrt(
    xDenominator * yDenominator,
  );

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
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
    !Number.isFinite(startPrice) ||
    !Number.isFinite(endPrice) ||
    startPrice <= 0
  ) {
    return 0;
  }

  return endPrice / startPrice - 1;
}

function volatility(
  candles: Candle[],
  endIndex: number,
  window: number,
): number {
  const startIndex = endIndex - window + 1;

  if (startIndex < 1) {
    return 0;
  }

  const returns: number[] = [];

  for (let i = startIndex; i <= endIndex; i += 1) {
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

  return standardDeviation(returns);
}

function recentVolumes(
  candles: Candle[],
  endIndex: number,
  window: number,
): number[] {
  const start = Math.max(0, endIndex - window + 1);

  return candles
    .slice(start, endIndex + 1)
    .map((candle) => candle.volume)
    .filter(Number.isFinite);
}

function trendPersistence(
  candles: Candle[],
  endIndex: number,
  window: number,
): number {
  const start = Math.max(1, endIndex - window + 1);

  let sameDirection = 0;
  let comparisons = 0;

  let previousDirection = 0;

  for (let i = start; i <= endIndex; i += 1) {
    const previousClose = candles[i - 1].close;
    const close = candles[i].close;

    if (
      previousClose <= 0 ||
      !Number.isFinite(previousClose) ||
      !Number.isFinite(close)
    ) {
      continue;
    }

    const change = close / previousClose - 1;

    const direction =
      change > 0 ? 1 :
      change < 0 ? -1 :
      0;

    if (direction === 0) {
      continue;
    }

    if (previousDirection !== 0) {
      comparisons += 1;

      if (direction === previousDirection) {
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

function createObservations(
  market: MarketDataset,
  group: 'first60' | 'second60',
): Observation[] {
  const candles = market.candles;

  const observations: Observation[] = [];

  const lastIndex = candles.length - 51;

  for (
    let index = WARMUP;
    index <= lastIndex;
    index += 1
  ) {
    const volumes = recentVolumes(candles, index, 20);

    const volumeMean20 = mean(volumes);
    const volumeMedian20 = median(volumes);

    const volumeStd = standardDeviation(volumes);

    const volumeConsistency20 =
      volumeMean20 > 0
        ? volumeStd / volumeMean20
        : 0;

    const volatility5 = volatility(candles, index, 5);
    const volatility15 = volatility(candles, index, 15);
    const volatility50 = volatility(candles, index, 50);

    const return5 = returnBetween(
      candles,
      index - 5,
      index,
    );

    const return15 = returnBetween(
      candles,
      index - 15,
      index,
    );

    const return50 = returnBetween(
      candles,
      index - 50,
      index,
    );

    const positiveWindowStart =
      Math.max(1, index - 19);

    let positive = 0;
    let measured = 0;

    for (
      let i = positiveWindowStart;
      i <= index;
      i += 1
    ) {
      const previous = candles[i - 1].close;
      const current = candles[i].close;

      if (
        previous > 0 &&
        Number.isFinite(previous) &&
        Number.isFinite(current)
      ) {
        measured += 1;

        if (current > previous) {
          positive += 1;
        }
      }
    }

    const positiveReturnRate20 =
      measured > 0 ? positive / measured : 0;

    const trendPersistence20 = trendPersistence(
      candles,
      index,
      20,
    );

    const volumeToVolatility =
      volatility15 > 0
        ? volumeMean20 / volatility15
        : 0;

    const forward5 = returnBetween(
      candles,
      index,
      index + 5,
    );

    const forward10 = returnBetween(
      candles,
      index,
      index + 10,
    );

    const forward20 = returnBetween(
      candles,
      index,
      index + 20,
    );

    const forward50 = returnBetween(
      candles,
      index,
      index + 50,
    );

    observations.push({
      symbol: market.symbol,
      group,
      index,

      volumeMean20,
      volumeMedian20,
      volumeConsistency20,

      volatility5,
      volatility15,
      volatility50,

      return5,
      return15,
      return50,

      positiveReturnRate20,
      trendPersistence20,
      volumeToVolatility,

      forward5,
      forward10,
      forward20,
      forward50,
    });
  }

  return observations;
}

function analyseMarket(
  market: MarketDataset,
  group: 'first60' | 'second60',
): MarketAnalysis {
  const observations = createObservations(
    market,
    group,
  );

  const get = (name: keyof Observation): number[] =>
    observations.map((observation) =>
      Number(observation[name]),
    );

  const totalReturn =
    returnBetween(
      market.candles,
      0,
      market.candles.length - 1,
    );

  const hourlyReturns: number[] = [];

  for (let i = 1; i < market.candles.length; i += 1) {
    const previous = market.candles[i - 1].close;
    const current = market.candles[i].close;

    if (
      previous > 0 &&
      Number.isFinite(previous) &&
      Number.isFinite(current)
    ) {
      hourlyReturns.push(current / previous - 1);
    }
  }

  const periodVolatility =
    standardDeviation(hourlyReturns);

  const periodsPerYear =
    365 * 24 * 60;

  const annualisedVolatility =
    periodVolatility *
    Math.sqrt(periodsPerYear);

  const correlations: Record<string, number> = {};

  for (const feature of FEATURE_NAMES) {
    for (const forward of FORWARD_NAMES) {
      const key = `${feature}_vs_${forward}`;

      correlations[key] = pearsonCorrelation(
        get(feature as keyof Observation),
        get(forward as keyof Observation),
      );
    }
  }

  return {
    symbol: market.symbol,
    group,

    observations: observations.length,

    averageVolume20: mean(get('volumeMean20')),
    medianVolume20: median(get('volumeMean20')),
    averageVolumeConsistency20: mean(
      get('volumeConsistency20'),
    ),

    averageVolatility5: mean(
      get('volatility5'),
    ),
    averageVolatility15: mean(
      get('volatility15'),
    ),
    averageVolatility50: mean(
      get('volatility50'),
    ),

    averageReturn5: mean(get('return5')),
    averageReturn15: mean(get('return15')),
    averageReturn50: mean(get('return50')),

    positiveReturnRate20: mean(
      get('positiveReturnRate20'),
    ),
    trendPersistence20: mean(
      get('trendPersistence20'),
    ),
    volumeToVolatility: mean(
      get('volumeToVolatility'),
    ),

    averageForward5: mean(get('forward5')),
    averageForward10: mean(get('forward10')),
    averageForward20: mean(get('forward20')),
    averageForward50: mean(get('forward50')),

    totalReturn,
    annualisedVolatility,

    correlations,
  };
}

function summariseGroup(
  analyses: MarketAnalysis[],
  group: 'first60' | 'second60',
): GroupSummary {
  const markets = analyses.filter(
    (analysis) => analysis.group === group,
  );

  return {
    group,
    markets: markets.length,

    meanTotalReturn: mean(
      markets.map((market) => market.totalReturn),
    ),

    medianTotalReturn: median(
      markets.map((market) => market.totalReturn),
    ),

    meanForward5: mean(
      markets.map((market) => market.averageForward5),
    ),

    meanForward10: mean(
      markets.map((market) => market.averageForward10),
    ),

    meanForward20: mean(
      markets.map((market) => market.averageForward20),
    ),

    meanForward50: mean(
      markets.map((market) => market.averageForward50),
    ),

    meanVolume: mean(
      markets.map((market) => market.averageVolume20),
    ),

    meanVolatility15: mean(
      markets.map((market) => market.averageVolatility15),
    ),

    meanTrendPersistence: mean(
      markets.map((market) => market.trendPersistence20),
    ),

    meanPositiveReturnRate: mean(
      markets.map((market) => market.positiveReturnRate20),
    ),

    meanVolumeToVolatility: mean(
      markets.map((market) => market.volumeToVolatility),
    ),

    positiveMarkets: markets.filter(
      (market) => market.totalReturn > 0,
    ).length,

    negativeMarkets: markets.filter(
      (market) => market.totalReturn < 0,
    ).length,

    totalReturnAcrossMarkets: markets.reduce(
      (sum, market) => sum + market.totalReturn,
      0,
    ),
  };
}

function buildContributions(
  analyses: MarketAnalysis[],
): MarketContribution[] {
  const totalPositiveReturn = analyses
    .filter((market) => market.totalReturn > 0)
    .reduce(
      (sum, market) => sum + market.totalReturn,
      0,
    );

  const totalAbsoluteReturn = analyses.reduce(
    (sum, market) =>
      sum + Math.abs(market.totalReturn),
    0,
  );

  const sorted = [...analyses].sort(
    (a, b) => b.totalReturn - a.totalReturn,
  );

  return sorted.map((market, index) => ({
    symbol: market.symbol,
    group: market.group,
    totalReturn: market.totalReturn,

    positiveReturnContribution:
      market.totalReturn > 0 &&
      totalPositiveReturn > 0
        ? market.totalReturn / totalPositiveReturn
        : 0,

    absoluteReturnContribution:
      totalAbsoluteReturn > 0
        ? Math.abs(market.totalReturn) /
          totalAbsoluteReturn
        : 0,

    rank: index + 1,
  }));
}

function topNContribution(
  contributions: MarketContribution[],
  n: number,
): number {
  return contributions
    .slice(0, n)
    .reduce(
      (sum, contribution) =>
        sum + contribution.positiveReturnContribution,
      0,
    );
}

function strongestCorrelations(
  analyses: MarketAnalysis[],
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
      const values = analyses
        .map(
          (market) =>
            market.correlations[
              `${feature}_vs_${forward}`
            ],
        )
        .filter(Number.isFinite);

      results.push({
        feature,
        forward,
        meanCorrelation: mean(values),
        meanAbsoluteCorrelation: mean(
          values.map((value) => Math.abs(value)),
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

function aggregateObservationCorrelations(
  markets: MarketDataset[],
  group: 'first60' | 'second60',
): Record<string, number> {
  const observations = markets.flatMap((market) =>
    createObservations(market, group),
  );

  const result: Record<string, number> = {};

  const values = (name: keyof Observation): number[] =>
    observations.map((observation) =>
      Number(observation[name]),
    );

  for (const feature of FEATURE_NAMES) {
    for (const forward of FORWARD_NAMES) {
      result[`${feature}_vs_${forward}`] =
        pearsonCorrelation(
          values(feature as keyof Observation),
          values(forward as keyof Observation),
        );
    }
  }

  return result;
}

function parseDataset(
  filename: string,
): Dataset {
  if (!fs.existsSync(filename)) {
    throw new Error(
      `Dataset does not exist: ${filename}`,
    );
  }

  const raw = fs.readFileSync(filename, 'utf8');
  const dataset = JSON.parse(raw) as Dataset;

  if (
    !dataset ||
    !Array.isArray(dataset.markets)
  ) {
    throw new Error(
      `Invalid dataset: ${filename} does not contain a markets array`,
    );
  }

  return dataset;
}

function validateMarkets(
  dataset: Dataset,
  expectedCount: number,
  filename: string,
): void {
  if (dataset.markets.length !== expectedCount) {
    throw new Error(
      [
        `Expected ${expectedCount} markets in ${filename},`,
        `but found ${dataset.markets.length}.`,
      ].join(' '),
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

    if (market.candles.length <= WARMUP + 50) {
      throw new Error(
        `Market ${market.symbol} in ${filename} does not contain enough candles.`,
      );
    }
  }
}

function timestampToIso(
  timestamp: number | undefined,
): string | null {
  if (
    timestamp === undefined ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function datasetPeriod(
  dataset: Dataset,
): {
  startTime: number;
  endTime: number;
  startIso: string;
  endIso: string;
} {
  const firstMarket = dataset.markets[0];

  if (
    !firstMarket ||
    firstMarket.candles.length === 0
  ) {
    throw new Error(
      'Dataset contains no candles.',
    );
  }

  const firstCandle = firstMarket.candles[0];
  const lastCandle =
    firstMarket.candles[
      firstMarket.candles.length - 1
    ];

  const startTime = Number(firstCandle.openTime);

  const endTime = Number(
    lastCandle.closeTime ??
      lastCandle.openTime,
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
    startIso: new Date(startTime).toISOString(),
    endIso: new Date(endTime).toISOString(),
  };
}

function printGroupSummary(
  summary: GroupSummary,
): void {
  console.log('');
  console.log(
    `Group: ${summary.group}`,
  );
  console.log(
    `  Markets:                 ${summary.markets}`,
  );
  console.log(
    `  Mean total return:       ${(summary.meanTotalReturn * 100).toFixed(3)}%`,
  );
  console.log(
    `  Median total return:     ${(summary.medianTotalReturn * 100).toFixed(3)}%`,
  );
  console.log(
    `  Total return:             ${(summary.totalReturnAcrossMarkets * 100).toFixed(3)}%`,
  );
  console.log(
    `  Mean forward 5m:          ${(summary.meanForward5 * 100).toFixed(4)}%`,
  );
  console.log(
    `  Mean forward 10m:         ${(summary.meanForward10 * 100).toFixed(4)}%`,
  );
  console.log(
    `  Mean forward 20m:         ${(summary.meanForward20 * 100).toFixed(4)}%`,
  );
  console.log(
    `  Mean forward 50m:         ${(summary.meanForward50 * 100).toFixed(4)}%`,
  );
  console.log(
    `  Mean volume:               ${summary.meanVolume.toFixed(4)}`,
  );
  console.log(
    `  Mean volatility 15m:      ${(summary.meanVolatility15 * 100).toFixed(4)}%`,
  );
  console.log(
    `  Mean trend persistence:   ${summary.meanTrendPersistence.toFixed(4)}`,
  );
  console.log(
    `  Mean positive-rate 20m:   ${summary.meanPositiveReturnRate.toFixed(4)}`,
  );
  console.log(
    `  Positive markets:          ${summary.positiveMarkets}`,
  );
  console.log(
    `  Negative markets:          ${summary.negativeMarkets}`,
  );
}

async function main(): Promise<void> {
  const [, , firstFilename, secondFilename] =
    process.argv;

  if (!firstFilename || !secondFilename) {
    console.error(
      [
        'Usage:',
        '',
        'npx tsx server/market-characteristic-analysis.ts <first-60-dataset> <second-60-dataset>',
        '',
        'Example:',
        'npx tsx server/market-characteristic-analysis.ts \\',
        '  server/research-output/first-60.json \\',
        '  server/research-output/second-60.json',
      ].join('\n'),
    );

    process.exit(1);
  }

  console.log(
    '======================================================================',
  );
  console.log(
    'Market characteristic analysis',
  );
  console.log(
    '======================================================================',
  );
  console.log('');
  console.log(
    `First 60 dataset:  ${firstFilename}`,
  );
  console.log(
    `Second 60 dataset: ${secondFilename}`,
  );

  const firstDataset =
    parseDataset(firstFilename);

  const secondDataset =
    parseDataset(secondFilename);

  validateMarkets(
    firstDataset,
    60,
    firstFilename,
  );

  validateMarkets(
    secondDataset,
    60,
    secondFilename,
  );

  const firstPeriod =
    datasetPeriod(firstDataset);

  const secondPeriod =
    datasetPeriod(secondDataset);

  console.log('');
  console.log(
    `First 60 period:  ${firstPeriod.startIso} -> ${firstPeriod.endIso}`,
  );
  console.log(
    `Second 60 period: ${secondPeriod.startIso} -> ${secondPeriod.endIso}`,
  );

  if (
    firstPeriod.startTime !== secondPeriod.startTime ||
    firstPeriod.endTime !== secondPeriod.endTime
  ) {
    console.warn('');
    console.warn(
      'WARNING: the two datasets do not cover exactly the same period.',
    );
  }

  console.log('');
  console.log(
    'Analysing first 60 markets...',
  );

  const firstAnalyses =
    firstDataset.markets.map((market) =>
      analyseMarket(market, 'first60'),
    );

  console.log(
    'Analysing second 60 markets...',
  );

  const secondAnalyses =
    secondDataset.markets.map((market) =>
      analyseMarket(market, 'second60'),
    );

  const analyses = [
    ...firstAnalyses,
    ...secondAnalyses,
  ];

  const firstSummary =
    summariseGroup(analyses, 'first60');

  const secondSummary =
    summariseGroup(analyses, 'second60');

  printGroupSummary(firstSummary);
  printGroupSummary(secondSummary);

  const contributions =
    buildContributions(analyses);

  const firstContributions =
    contributions.filter(
      (contribution) =>
        contribution.group === 'first60',
    );

  const secondContributions =
    contributions.filter(
      (contribution) =>
        contribution.group === 'second60',
    );

  const strongest =
    strongestCorrelations(analyses);

  const aggregateFirst =
    aggregateObservationCorrelations(
      firstDataset.markets,
      'first60',
    );

  const aggregateSecond =
    aggregateObservationCorrelations(
      secondDataset.markets,
      'second60',
    );

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Top markets by total return',
  );
  console.log(
    '======================================================================',
  );

  for (
    const contribution of contributions.slice(0, 15)
  ) {
    console.log(
      `${String(contribution.rank).padStart(2)}. ` +
      `${contribution.symbol.padEnd(18)} ` +
      `${contribution.group.padEnd(8)} ` +
      `${(contribution.totalReturn * 100).toFixed(3)}%`,
    );
  }

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Return concentration',
  );
  console.log(
    '======================================================================',
  );

  console.log(
    `Top 1 market contribution:   ${(topNContribution(contributions, 1) * 100).toFixed(2)}%`,
  );

  console.log(
    `Top 3 market contribution:   ${(topNContribution(contributions, 3) * 100).toFixed(2)}%`,
  );

  console.log(
    `Top 5 market contribution:   ${(topNContribution(contributions, 5) * 100).toFixed(2)}%`,
  );

  console.log(
    `Top 10 market contribution:  ${(topNContribution(contributions, 10) * 100).toFixed(2)}%`,
  );

  console.log(
    `Top 20 market contribution:  ${(topNContribution(contributions, 20) * 100).toFixed(2)}%`,
  );

  console.log('');
  console.log(
    'First 60 return concentration:',
  );
  console.log(
    `  Top 1:  ${(topNContribution(firstContributions, 1) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Top 3:  ${(topNContribution(firstContributions, 3) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Top 5:  ${(topNContribution(firstContributions, 5) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Top 10: ${(topNContribution(firstContributions, 10) * 100).toFixed(2)}%`,
  );

  console.log('');
  console.log(
    'Second 60 return concentration:',
  );
  console.log(
    `  Top 1:  ${(topNContribution(secondContributions, 1) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Top 3:  ${(topNContribution(secondContributions, 3) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Top 5:  ${(topNContribution(secondContributions, 5) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Top 10: ${(topNContribution(secondContributions, 10) * 100).toFixed(2)}%`,
  );

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Strongest market-level feature relationships',
  );
  console.log(
    '======================================================================',
  );

  for (const result of strongest.slice(0, 15)) {
    console.log(
      `${result.feature.padEnd(26)} ` +
      `${result.forward.padEnd(10)} ` +
      `mean r=${result.meanCorrelation.toFixed(4)} ` +
      `mean |r|=${result.meanAbsoluteCorrelation.toFixed(4)}`,
    );
  }

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Aggregate observation correlations',
  );
  console.log(
    '======================================================================',
  );

  const aggregateDifferences =
    FEATURE_NAMES.flatMap((feature) =>
      FORWARD_NAMES.map((forward) => {
        const key = `${feature}_vs_${forward}`;

        return {
          feature,
          forward,
          first60: aggregateFirst[key] ?? 0,
          second60: aggregateSecond[key] ?? 0,
          difference:
            (aggregateFirst[key] ?? 0) -
            (aggregateSecond[key] ?? 0),
        };
      }),
    ).sort(
      (a, b) =>
        Math.abs(b.difference) -
        Math.abs(a.difference),
    );

  for (
    const result of aggregateDifferences.slice(0, 15)
  ) {
    console.log(
      `${result.feature.padEnd(26)} ` +
      `${result.forward.padEnd(10)} ` +
      `first=${result.first60.toFixed(4)} ` +
      `second=${result.second60.toFixed(4)} ` +
      `difference=${result.difference.toFixed(4)}`,
    );
  }

  console.log('');
  console.log(
    '======================================================================',
  );
  console.log(
    'Market rankings by structural characteristics',
  );
  console.log(
    '======================================================================',
  );

  const rankings = {
    totalReturn: [...analyses]
      .sort(
        (a, b) =>
          b.totalReturn - a.totalReturn,
      )
      .map((market) => market.symbol),

    forward20: [...analyses]
      .sort(
        (a, b) =>
          b.averageForward20 -
          a.averageForward20,
      )
      .map((market) => market.symbol),

    volume: [...analyses]
      .sort(
        (a, b) =>
          b.averageVolume20 -
          a.averageVolume20,
      )
      .map((market) => market.symbol),

    volatility15: [...analyses]
      .sort(
        (a, b) =>
          b.averageVolatility15 -
          a.averageVolatility15,
      )
      .map((market) => market.symbol),

    trendPersistence: [...analyses]
      .sort(
        (a, b) =>
          b.trendPersistence20 -
          a.trendPersistence20,
      )
      .map((market) => market.symbol),
  };

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),

      firstDataset: path.resolve(
        firstFilename,
      ),

      secondDataset: path.resolve(
        secondFilename,
      ),

      firstPeriod,
      secondPeriod,

      methodology: {
        warmupCandles: WARMUP,

        featureWindows: {
          volume: 20,
          volatility: [5, 15, 50],
          returns: [5, 15, 50],
          positiveReturnRate: 20,
          trendPersistence: 20,
        },

        forwardHorizons: [5, 10, 20, 50],

        purpose:
          'Determine whether the apparent performance difference between the first 60 and second 60 markets is broad-based or explained by a small number of markets or structural market characteristics.',
      },
    },

    groupSummaries: {
      first60: firstSummary,
      second60: secondSummary,

      differences: {
        meanTotalReturn:
          firstSummary.meanTotalReturn -
          secondSummary.meanTotalReturn,

        medianTotalReturn:
          firstSummary.medianTotalReturn -
          secondSummary.medianTotalReturn,

        meanForward5:
          firstSummary.meanForward5 -
          secondSummary.meanForward5,

        meanForward10:
          firstSummary.meanForward10 -
          secondSummary.meanForward10,

        meanForward20:
          firstSummary.meanForward20 -
          secondSummary.meanForward20,

        meanForward50:
          firstSummary.meanForward50 -
          secondSummary.meanForward50,

        meanVolume:
          firstSummary.meanVolume -
          secondSummary.meanVolume,

        meanVolatility15:
          firstSummary.meanVolatility15 -
          secondSummary.meanVolatility15,

        meanTrendPersistence:
          firstSummary.meanTrendPersistence -
          secondSummary.meanTrendPersistence,

        meanPositiveReturnRate:
          firstSummary.meanPositiveReturnRate -
          secondSummary.meanPositiveReturnRate,

        meanVolumeToVolatility:
          firstSummary.meanVolumeToVolatility -
          secondSummary.meanVolumeToVolatility,
      },
    },

    markets: analyses,

    contributionAnalysis: {
      allMarkets: contributions,
      first60: firstContributions,
      second60: secondContributions,

      concentration: {
        allMarkets: {
          top1: topNContribution(contributions, 1),
          top3: topNContribution(contributions, 3),
          top5: topNContribution(contributions, 5),
          top10: topNContribution(contributions, 10),
          top20: topNContribution(contributions, 20),
        },

        first60: {
          top1: topNContribution(firstContributions, 1),
          top3: topNContribution(firstContributions, 3),
          top5: topNContribution(firstContributions, 5),
          top10: topNContribution(firstContributions, 10),
        },

        second60: {
          top1: topNContribution(secondContributions, 1),
          top3: topNContribution(secondContributions, 3),
          top5: topNContribution(secondContributions, 5),
          top10: topNContribution(secondContributions, 10),
        },
      },
    },

    correlationAnalysis: {
      strongestAcrossMarkets: strongest,

      aggregateObservations: {
        first60: aggregateFirst,
        second60: aggregateSecond,
        largestDifferences:
          aggregateDifferences,
      },
    },

    rankings,
  };

  const outputDirectory = path.dirname(
    firstFilename,
  );

  fs.mkdirSync(outputDirectory, {
    recursive: true,
  });

  const outputFilename = path.join(
    outputDirectory,
    `market-characteristic-analysis-${Date.now()}.json`,
  );

  fs.writeFileSync(
    outputFilename,
    JSON.stringify(output, null, 2),
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

main().catch((error: unknown) => {
  console.error('');
  console.error(
    'Market characteristic analysis failed:',
  );
  console.error(
    error instanceof Error
      ? error.stack ?? error.message
      : error,
  );

  process.exit(1);
});

