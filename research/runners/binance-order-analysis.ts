import fs from 'node:fs';
import path from 'node:path';

interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Market {
  symbol: string;
  candles: Candle[];
}

interface Dataset {
  version: number;
  interval: string;
  startTime: number;
  endTime: number;
  markets: Market[];
}

interface MarketAnalysis {
  symbol: string;
  rank: number;
  set: 1 | 2;

  baseAsset: string;
  quoteAsset: string;

  symbolLength: number;
  firstCharacter: string;
  firstCharacterCode: number;

  candleCount: number;

  firstPrice: number;
  lastPrice: number;

  meanPrice: number;
  medianPrice: number;

  meanVolume: number;
  medianVolume: number;
  totalVolume: number;

  returnPct: number;
  volatilityPct: number;

  averageCandleRangePct: number;
  averageBodyPct: number;

  positiveCandlePct: number;
  negativeCandlePct: number;
  flatCandlePct: number;
}

interface NumericResult {
  field: string;
  count: number;
  pearson: number;
  spearman: number;
  absPearson: number;
  absSpearman: number;
  first60Mean: number;
  second60Mean: number;
}

interface SymbolOrderingResult {
  test: string;
  matches: number;
  total: number;
  percentage: number;
  details?: string;
}

interface BoundaryResult {
  boundary: number;
  previousSymbol: string;
  nextSymbol: string;
  previousBase: string;
  nextBase: string;
  previousQuote: string;
  nextQuote: string;
  symbolLexicalChange: number;
}

interface Output {
  generatedAt: string;

  input: {
    first: string;
    second: string;
  };

  datasets: {
    firstMarkets: number;
    secondMarkets: number;
    totalMarkets: number;
    firstStartTime: number;
    firstEndTime: number;
    secondStartTime: number;
    secondEndTime: number;
  };

  exactOrdering: {
    alphabeticalAscending: SymbolOrderingResult;
    alphabeticalDescending: SymbolOrderingResult;
    baseAssetAscending: SymbolOrderingResult;
    baseAssetDescending: SymbolOrderingResult;
    quoteAssetAscending: SymbolOrderingResult;
    quoteAssetDescending: SymbolOrderingResult;
    symbolLengthAscending: SymbolOrderingResult;
    symbolLengthDescending: SymbolOrderingResult;
  };

  numericRelationships: NumericResult[];

  boundaries: BoundaryResult[];

  symbolAnalysis: {
    duplicateSymbols: string[];
    quoteAssetCounts: Record<string, number>;
    firstCharacterCounts: Record<string, number>;
  };

  markets: MarketAnalysis[];

  observations: string[];
}

function loadDataset(filename: string): Dataset {
  console.log(`Loading ${filename}...`);

  const parsed: unknown = JSON.parse(
    fs.readFileSync(filename, 'utf8'),
  );

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('markets' in parsed)
  ) {
    throw new Error(
      `${filename} does not contain a markets array.`,
    );
  }

  const dataset = parsed as Dataset;

  if (!Array.isArray(dataset.markets)) {
    throw new Error(
      `${filename}: markets is not an array.`,
    );
  }

  return dataset;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function pearson(
  x: number[],
  y: number[],
): number {
  if (
    x.length !== y.length ||
    x.length < 2
  ) {
    return 0;
  }

  const xMean = mean(x);
  const yMean = mean(y);

  let numerator = 0;
  let xSum = 0;
  let ySum = 0;

  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;

    numerator += dx * dy;
    xSum += dx * dx;
    ySum += dy * dy;
  }

  const denominator = Math.sqrt(
    xSum * ySum,
  );

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function rankValues(
  values: number[],
): number[] {
  const indexed = values.map(
    (value, index) => ({
      value,
      index,
    }),
  );

  indexed.sort(
    (a, b) => a.value - b.value,
  );

  const ranks =
    new Array<number>(values.length);

  let i = 0;

  while (i < indexed.length) {
    let end = i + 1;

    while (
      end < indexed.length &&
      indexed[end].value ===
        indexed[i].value
    ) {
      end += 1;
    }

    const rank =
      (i + 1 + end) / 2;

    for (
      let j = i;
      j < end;
      j += 1
    ) {
      ranks[indexed[j].index] =
        rank;
    }

    i = end;
  }

  return ranks;
}

function spearman(
  x: number[],
  y: number[],
): number {
  return pearson(
    rankValues(x),
    rankValues(y),
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

function extractAssets(
  symbol: string,
): {
  baseAsset: string;
  quoteAsset: string;
} {
  /*
   * Binance spot symbols don't contain a separator.
   *
   * We therefore test the common quote assets from longest
   * to shortest. This is sufficient for the symbols in the
   * research dataset.
   */
  const quoteAssets = [
    'USDT',
    'USDC',
    'FDUSD',
    'TUSD',
    'USDP',
    'DAI',
    'BTC',
    'ETH',
    'BNB',
    'EUR',
    'TRY',
    'BRL',
    'GBP',
    'AUD',
    'JPY',
    'RUB',
    'UAH',
    'PLN',
    'ZAR',
    'MXN',
    'ARS',
    'IDR',
    'NGN',
    'BUSD',
  ];

  const quote = quoteAssets.find(
    (candidate) =>
      symbol.endsWith(candidate),
  );

  if (!quote) {
    return {
      baseAsset: symbol,
      quoteAsset: '',
    };
  }

  return {
    baseAsset: symbol.slice(
      0,
      symbol.length - quote.length,
    ),
    quoteAsset: quote,
  };
}

function analyseMarket(
  market: Market,
  rank: number,
  set: 1 | 2,
): MarketAnalysis {
  const candles = market.candles;

  if (candles.length === 0) {
    const assets =
      extractAssets(market.symbol);

    return {
      symbol: market.symbol,
      rank,
      set,

      baseAsset: assets.baseAsset,
      quoteAsset: assets.quoteAsset,

      symbolLength: market.symbol.length,
      firstCharacter: market.symbol[0] ?? '',
      firstCharacterCode:
        market.symbol.charCodeAt(0) || 0,

      candleCount: 0,

      firstPrice: 0,
      lastPrice: 0,

      meanPrice: 0,
      medianPrice: 0,

      meanVolume: 0,
      medianVolume: 0,
      totalVolume: 0,

      returnPct: 0,
      volatilityPct: 0,

      averageCandleRangePct: 0,
      averageBodyPct: 0,

      positiveCandlePct: 0,
      negativeCandlePct: 0,
      flatCandlePct: 0,
    };
  }

  const prices = candles.map(
    (candle) => candle.close,
  );

  const volumes = candles.map(
    (candle) => candle.volume,
  );

  const returns: number[] = [];
  const ranges: number[] = [];
  const bodies: number[] = [];

  let positive = 0;
  let negative = 0;
  let flat = 0;

  for (const candle of candles) {
    const rangePct =
      candle.open === 0
        ? 0
        : ((candle.high - candle.low) /
            candle.open) *
          100;

    const bodyPct =
      candle.open === 0
        ? 0
        : (Math.abs(
            candle.close - candle.open,
          ) /
            candle.open) *
          100;

    ranges.push(rangePct);
    bodies.push(bodyPct);

    if (candle.close > candle.open) {
      positive += 1;
    } else if (
      candle.close < candle.open
    ) {
      negative += 1;
    } else {
      flat += 1;
    }
  }

  for (
    let i = 1;
    i < prices.length;
    i += 1
  ) {
    if (prices[i - 1] === 0) {
      continue;
    }

    returns.push(
      ((prices[i] -
        prices[i - 1]) /
        prices[i - 1]) *
        100,
    );
  }

  const firstPrice = prices[0];
  const lastPrice =
    prices[prices.length - 1];

  const returnPct =
    firstPrice === 0
      ? 0
      : ((lastPrice - firstPrice) /
          firstPrice) *
        100;

  const returnMean = mean(returns);

  const variance = mean(
    returns.map((value) =>
      Math.pow(
        value - returnMean,
        2,
      ),
    ),
  );

  const volatilityPct =
    Math.sqrt(variance);

  const assets =
    extractAssets(market.symbol);

  return {
    symbol: market.symbol,
    rank,
    set,

    baseAsset: assets.baseAsset,
    quoteAsset: assets.quoteAsset,

    symbolLength: market.symbol.length,
    firstCharacter:
      market.symbol[0] ?? '',
    firstCharacterCode:
      market.symbol.charCodeAt(0) || 0,

    candleCount: candles.length,

    firstPrice,
    lastPrice,

    meanPrice: mean(prices),
    medianPrice: median(prices),

    meanVolume: mean(volumes),
    medianVolume: median(volumes),
    totalVolume: volumes.reduce(
      (sum, value) => sum + value,
      0,
    ),

    returnPct,

    volatilityPct,

    averageCandleRangePct:
      mean(ranges),

    averageBodyPct:
      mean(bodies),

    positiveCandlePct:
      (positive / candles.length) *
      100,

    negativeCandlePct:
      (negative / candles.length) *
      100,

    flatCandlePct:
      (flat / candles.length) *
      100,
  };
}

function exactOrderingTest(
  markets: MarketAnalysis[],
  extractor: (
    market: MarketAnalysis,
  ) => string | number,
  ascending: boolean,
  name: string,
): SymbolOrderingResult {
  const expected = [...markets].sort(
    (a, b) => {
      const av = extractor(a);
      const bv = extractor(b);

      if (av < bv) {
        return ascending ? -1 : 1;
      }

      if (av > bv) {
        return ascending ? 1 : -1;
      }

      return 0;
    },
  );

  let matches = 0;

  for (let i = 0; i < markets.length; i += 1) {
    if (
      markets[i].symbol ===
      expected[i].symbol
    ) {
      matches += 1;
    }
  }

  return {
    test: name,
    matches,
    total: markets.length,
    percentage:
      (matches / markets.length) *
      100,
  };
}

function analyseNumeric(
  markets: MarketAnalysis[],
): NumericResult[] {
  const fields: Array<
    keyof MarketAnalysis
  > = [
    'symbolLength',
    'firstCharacterCode',
    'candleCount',
    'firstPrice',
    'lastPrice',
    'meanPrice',
    'medianPrice',
    'meanVolume',
    'medianVolume',
    'totalVolume',
    'returnPct',
    'volatilityPct',
    'averageCandleRangePct',
    'averageBodyPct',
    'positiveCandlePct',
    'negativeCandlePct',
    'flatCandlePct',
  ];

  const results: NumericResult[] = [];

  for (const field of fields) {
    const values: number[] = [];
    const ranks: number[] = [];

    for (const market of markets) {
      const value =
        market[field];

      if (
        typeof value !== 'number' ||
        !Number.isFinite(value)
      ) {
        continue;
      }

      values.push(value);
      ranks.push(market.rank);
    }

    if (values.length < 10) {
      continue;
    }

    const firstValues =
      markets
        .filter(
          (market) => market.set === 1,
        )
        .map(
          (market) =>
            market[field],
        )
        .filter(
          (value): value is number =>
            typeof value === 'number' &&
            Number.isFinite(value),
        );

    const secondValues =
      markets
        .filter(
          (market) => market.set === 2,
        )
        .map(
          (market) =>
            market[field],
        )
        .filter(
          (value): value is number =>
            typeof value === 'number' &&
            Number.isFinite(value),
        );

    const p =
      pearson(values, ranks);

    const s =
      spearman(values, ranks);

    results.push({
      field: String(field),
      count: values.length,

      pearson: p,
      spearman: s,

      absPearson: Math.abs(p),
      absSpearman: Math.abs(s),

      first60Mean:
        mean(firstValues),

      second60Mean:
        mean(secondValues),
    });
  }

  return results.sort(
    (a, b) =>
      b.absSpearman -
      a.absSpearman,
  );
}

function analyseBoundaries(
  markets: MarketAnalysis[],
): BoundaryResult[] {
  const results: BoundaryResult[] = [];

  for (
    let i = 1;
    i < markets.length;
    i += 1
  ) {
    const previous =
      markets[i - 1];

    const current =
      markets[i];

    const previousSymbol =
      previous.symbol;

    const currentSymbol =
      current.symbol;

    let lexicalChange = 0;

    const length = Math.min(
      previousSymbol.length,
      currentSymbol.length,
    );

    for (let j = 0; j < length; j += 1) {
      if (
        previousSymbol[j] !==
        currentSymbol[j]
      ) {
        lexicalChange +=
          Math.abs(
            previousSymbol.charCodeAt(j) -
              currentSymbol.charCodeAt(j),
          );

        break;
      }
    }

    results.push({
      boundary: i,

      previousSymbol,
      nextSymbol: currentSymbol,

      previousBase:
        previous.baseAsset,

      nextBase:
        current.baseAsset,

      previousQuote:
        previous.quoteAsset,

      nextQuote:
        current.quoteAsset,

      symbolLexicalChange:
        lexicalChange,
    });
  }

  return results;
}

function countValues(
  values: string[],
): Record<string, number> {
  const counts: Record<
    string,
    number
  > = {};

  for (const value of values) {
    counts[value] =
      (counts[value] ?? 0) + 1;
  }

  return counts;
}

function generateObservations(
  markets: MarketAnalysis[],
  exact: Output['exactOrdering'],
  numeric: NumericResult[],
  boundaries: BoundaryResult[],
): string[] {
  const observations: string[] = [];

  const bestExact = [
    exact.alphabeticalAscending,
    exact.alphabeticalDescending,
    exact.baseAssetAscending,
    exact.baseAssetDescending,
    exact.quoteAssetAscending,
    exact.quoteAssetDescending,
    exact.symbolLengthAscending,
    exact.symbolLengthDescending,
  ].sort(
    (a, b) =>
      b.percentage -
      a.percentage,
  )[0];

  observations.push(
    `Best exact ordering test: ${bestExact.test} matched ${bestExact.matches}/${bestExact.total} markets (${bestExact.percentage.toFixed(2)}%).`,
  );

  if (
    bestExact.percentage >= 95
  ) {
    observations.push(
      'The observed order is effectively explained by this deterministic symbol-level ordering.',
    );
  } else if (
    bestExact.percentage >= 50
  ) {
    observations.push(
      'The observed order has a substantial relationship with this symbol-level ordering, but is not a simple exact sort.',
    );
  } else {
    observations.push(
      'The observed order is not a simple alphabetical/base/quote/length ordering.',
    );
  }

  if (numeric.length > 0) {
    const strongest =
      numeric[0];

    observations.push(
      `Strongest numeric relationship with rank: ${strongest.field} (Spearman ${strongest.spearman.toFixed(4)}).`,
    );
  }

  const first60 =
    markets.filter(
      (market) => market.set === 1,
    );

  const second60 =
    markets.filter(
      (market) => market.set === 2,
    );

  const firstQuotes =
    new Set(
      first60.map(
        (market) =>
          market.quoteAsset,
      ),
    );

  const secondQuotes =
    new Set(
      second60.map(
        (market) =>
          market.quoteAsset,
      ),
    );

  if (
    firstQuotes.size === 1 &&
    secondQuotes.size === 1
  ) {
    const first =
      [...firstQuotes][0];

    const second =
      [...secondQuotes][0];

    if (first !== second) {
      observations.push(
        `The two 60-market blocks use different quote assets: ${first} versus ${second}. This is a potentially important ordering boundary.`,
      );
    }
  }

  const boundary60 =
    boundaries.find(
      (boundary) =>
        boundary.boundary === 60,
    );

  if (boundary60) {
    observations.push(
      `The 60/61 boundary is ${boundary60.previousSymbol} → ${boundary60.nextSymbol}.`,
    );
  }

  const repeatedBases =
    markets.length -
    new Set(
      markets.map(
        (market) =>
          market.baseAsset,
      ),
    ).size;

  if (repeatedBases > 0) {
    observations.push(
      `${repeatedBases} markets share a base-asset name with another market; this can reveal whether Binance groups the same asset across quote currencies.`,
    );
  }

  return observations;
}

function printSummary(
  output: Output,
): void {
  console.log('');
  console.log(
    '='.repeat(72),
  );
  console.log(
    'BINANCE MARKET ORDER ANALYSIS',
  );
  console.log(
    '='.repeat(72),
  );

  console.log('');
  console.log(
    `Markets: ${output.datasets.totalMarkets}`,
  );

  console.log(
    `First dataset:  ${output.datasets.firstMarkets}`,
  );

  console.log(
    `Second dataset: ${output.datasets.secondMarkets}`,
  );

  console.log('');
  console.log(
    'EXACT ORDERING TESTS',
  );
  console.log(
    '-'.repeat(72),
  );

  const tests = [
    output.exactOrdering
      .alphabeticalAscending,

    output.exactOrdering
      .alphabeticalDescending,

    output.exactOrdering
      .baseAssetAscending,

    output.exactOrdering
      .baseAssetDescending,

    output.exactOrdering
      .quoteAssetAscending,

    output.exactOrdering
      .quoteAssetDescending,

    output.exactOrdering
      .symbolLengthAscending,

    output.exactOrdering
      .symbolLengthDescending,
  ];

  for (const test of tests) {
    console.log(
      `${test.test.padEnd(35)} ` +
        `${test.matches}/${test.total} ` +
        `(${test.percentage.toFixed(2)}%)`,
    );
  }

  console.log('');
  console.log(
    'STRONGEST NUMERIC RELATIONSHIPS',
  );
  console.log(
    '-'.repeat(72),
  );

  for (
    const result of output.numericRelationships.slice(
      0,
      12,
    )
  ) {
    console.log(
      `${result.field.padEnd(32)} ` +
        `Spearman=${result.spearman.toFixed(4)} ` +
        `Pearson=${result.pearson.toFixed(4)}`,
    );
  }

  console.log('');
  console.log(
    '60/61 BOUNDARY',
  );
  console.log(
    '-'.repeat(72),
  );

  const boundary =
    output.boundaries.find(
      (item) =>
        item.boundary === 60,
    );

  if (boundary) {
    console.log(
      `${boundary.previousSymbol} ` +
        `(${boundary.previousQuote}) -> ` +
        `${boundary.nextSymbol} ` +
        `(${boundary.nextQuote})`,
    );
  }

  console.log('');
  console.log(
    'OBSERVATIONS',
  );
  console.log(
    '-'.repeat(72),
  );

  for (
    const observation of output.observations
  ) {
    console.log(
      `- ${observation}`,
    );
  }

  console.log('');
}

function main(): void {
  const firstFilename =
    process.argv[2];

  const secondFilename =
    process.argv[3];

  if (
    !firstFilename ||
    !secondFilename
  ) {
    console.error(
      'Usage:',
    );

    console.error(
      'npx tsx server/binance-order-analysis.ts <first.json> <second.json>',
    );

    process.exit(1);
  }

  const first =
    loadDataset(firstFilename);

  const second =
    loadDataset(secondFilename);

  console.log(
    `First dataset contains ${first.markets.length} markets.`,
  );

  console.log(
    `Second dataset contains ${second.markets.length} markets.`,
  );

  const markets: MarketAnalysis[] = [];

  for (
    let i = 0;
    i < first.markets.length;
    i += 1
  ) {
    markets.push(
      analyseMarket(
        first.markets[i],
        i + 1,
        1,
      ),
    );
  }

  const offset =
    first.markets.length;

  for (
    let i = 0;
    i < second.markets.length;
    i += 1
  ) {
    markets.push(
      analyseMarket(
        second.markets[i],
        offset + i + 1,
        2,
      ),
    );
  }

  console.log(
    `Analysing ${markets.length} ordered markets...`,
  );

  const exactOrdering = {
    alphabeticalAscending:
      exactOrderingTest(
        markets,
        (market) =>
          market.symbol,
        true,
        'Symbol alphabetical ascending',
      ),

    alphabeticalDescending:
      exactOrderingTest(
        markets,
        (market) =>
          market.symbol,
        false,
        'Symbol alphabetical descending',
      ),

    baseAssetAscending:
      exactOrderingTest(
        markets,
        (market) =>
          market.baseAsset,
        true,
        'Base asset ascending',
      ),

    baseAssetDescending:
      exactOrderingTest(
        markets,
        (market) =>
          market.baseAsset,
        false,
        'Base asset descending',
      ),

    quoteAssetAscending:
      exactOrderingTest(
        markets,
        (market) =>
          market.quoteAsset,
        true,
        'Quote asset ascending',
      ),

    quoteAssetDescending:
      exactOrderingTest(
        markets,
        (market) =>
          market.quoteAsset,
        false,
        'Quote asset descending',
      ),

    symbolLengthAscending:
      exactOrderingTest(
        markets,
        (market) =>
          market.symbolLength,
        true,
        'Symbol length ascending',
      ),

    symbolLengthDescending:
      exactOrderingTest(
        markets,
        (market) =>
          market.symbolLength,
        false,
        'Symbol length descending',
      ),
  };

  console.log(
    'Calculating numeric relationships...',
  );

  const numericRelationships =
    analyseNumeric(markets);

  console.log(
    'Analysing ordering boundaries...',
  );

  const boundaries =
    analyseBoundaries(markets);

  const duplicateMap =
    new Map<string, number>();

  for (const market of markets) {
    duplicateMap.set(
      market.symbol,
      (duplicateMap.get(
        market.symbol,
      ) ?? 0) + 1,
    );
  }

  const duplicateSymbols =
    [...duplicateMap.entries()]
      .filter(
        ([, count]) => count > 1,
      )
      .map(([symbol]) => symbol);

  const quoteAssetCounts =
    countValues(
      markets.map(
        (market) =>
          market.quoteAsset,
      ),
    );

  const firstCharacterCounts =
    countValues(
      markets.map(
        (market) =>
          market.firstCharacter,
      ),
    );

  const observations =
    generateObservations(
      markets,
      exactOrdering,
      numericRelationships,
      boundaries,
    );

  const output: Output = {
    generatedAt:
      new Date().toISOString(),

    input: {
      first: path.resolve(
        firstFilename,
      ),
      second: path.resolve(
        secondFilename,
      ),
    },

    datasets: {
      firstMarkets:
        first.markets.length,

      secondMarkets:
        second.markets.length,

      totalMarkets:
        markets.length,

      firstStartTime:
        first.startTime,

      firstEndTime:
        first.endTime,

      secondStartTime:
        second.startTime,

      secondEndTime:
        second.endTime,
    },

    exactOrdering,

    numericRelationships,

    boundaries,

    symbolAnalysis: {
      duplicateSymbols,
      quoteAssetCounts,
      firstCharacterCounts,
    },

    markets,
    observations,
  };

  const outputDirectory =
    path.dirname(
      firstFilename,
    );

  const outputFilename =
    path.join(
      outputDirectory,
      `binance-order-analysis-${Date.now()}.json`,
    );

  fs.writeFileSync(
    outputFilename,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  printSummary(output);

  console.log(
    `Output: ${outputFilename}`,
  );
}

main();