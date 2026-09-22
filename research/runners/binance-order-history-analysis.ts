/**
 * Binance Spot order/history analysis.
 *
 * Purpose:
 *   Determine what properties are associated with the order in which
 *   Binance returns symbols from /api/v3/exchangeInfo, and compare that
 *   with the historical order preserved in our research datasets.
 *
 * Usage:
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx \
 *     server/research/runners/binance-order-history-analysis.ts \
 *     server/research-output/<first-60-file>.json \
 *     server/research-output/<second-60-file>.json
 *
 * The two input files must contain:
 *
 *   {
 *     "markets": [
 *       {
 *         "symbol": "BTCUSDT",
 *         "candles": [...]
 *       }
 *     ]
 *   }
 *
 * The first file is assigned ranks 1..N.
 * The second file continues at N+1.
 *
 * Output:
 *
 *   server/research-output/binance-order-history-analysis-<timestamp>.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const BINANCE_EXCHANGE_INFO_URL =
  'https://api.binance.com/api/v3/exchangeInfo';

const OUTPUT_DIRECTORY = path.resolve(
  process.cwd(),
  'server/research-output',
);

interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ResearchMarket {
  symbol: string;
  candles?: Candle[];
  [key: string]: unknown;
}

interface ResearchFile {
  version?: number;
  interval?: string;
  startTime?: number;
  endTime?: number;
  markets: ResearchMarket[];
  [key: string]: unknown;
}

interface BinanceFilter {
  filterType?: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  applyToMarket?: boolean;
  multiplierUp?: string;
  multiplierDown?: string;
  avgPriceMins?: number;
  limit?: number;
  maxNumOrders?: number;
  maxNumAlgoOrders?: number;
  maxPosition?: string;
  [key: string]: unknown;
}

interface BinanceSymbol {
  symbol: string;
  status?: string;
  baseAsset?: string;
  baseAssetPrecision?: number;
  quoteAsset?: string;
  quotePrecision?: number;
  quoteAssetPrecision?: number;
  baseCommissionPrecision?: number;
  quoteCommissionPrecision?: number;
  orderTypes?: string[];
  icebergAllowed?: boolean;
  ocoAllowed?: boolean;
  otoAllowed?: boolean;
  quoteOrderQtyMarketAllowed?: boolean;
  isSpotTradingAllowed?: boolean;
  isMarginTradingAllowed?: boolean;
  permissions?: string[];
  permissionSets?: unknown;
  defaultSelfTradePreventionMode?: string;
  allowedSelfTradePreventionModes?: string[];
  filters?: BinanceFilter[];
  [key: string]: unknown;
}

interface BinanceExchangeInfo {
  timezone?: string;
  serverTime?: number;
  rateLimits?: unknown[];
  exchangeFilters?: unknown[];
  symbols: BinanceSymbol[];
}

interface MarketRow {
  historicalRank: number;
  researchFile: 'first' | 'second';
  symbol: string;

  baseAsset: string | null;
  quoteAsset: string | null;

  candleCount: number;

  firstCandleTime: number | null;
  lastCandleTime: number | null;

  returnPct: number | null;
  volatilityPct: number | null;
  averageVolume: number | null;
  medianVolume: number | null;
  averageRangePct: number | null;
  averageBodyPct: number | null;
  positiveCandlePct: number | null;
  negativeCandlePct: number | null;
  flatCandlePct: number | null;

  currentBinanceRank: number | null;
  currentBinanceRankPercentile: number | null;
  currentBinanceSymbolExists: boolean;

  currentStatus: string | null;
  currentBaseAsset: string | null;
  currentQuoteAsset: string | null;

  baseAssetPrecision: number | null;
  quotePrecision: number | null;
  quoteAssetPrecision: number | null;
  baseCommissionPrecision: number | null;
  quoteCommissionPrecision: number | null;

  icebergAllowed: boolean | null;
  ocoAllowed: boolean | null;
  otoAllowed: boolean | null;
  quoteOrderQtyMarketAllowed: boolean | null;
  isSpotTradingAllowed: boolean | null;
  isMarginTradingAllowed: boolean | null;

  orderTypes: string[];
  permissions: string[];
  defaultSelfTradePreventionMode: string | null;
  allowedSelfTradePreventionModes: string[];

  filterTypes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  tickSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  stepSize: number | null;
  minNotional: number | null;
  maxNumOrders: number | null;
  maxNumAlgoOrders: number | null;

  historicalToCurrentRankDelta: number | null;
  historicalToCurrentRankRatio: number | null;
}

interface NumericCorrelation {
  field: string;
  count: number;
  pearson: number | null;
  spearman: number | null;
}

interface OrderingTest {
  name: string;
  matchedPositions: number;
  totalPositions: number;
  matchPercentage: number;
  spearman: number | null;
}

interface GroupSummary {
  name: string;
  count: number;

  historicalRankMin: number;
  historicalRankMax: number;

  averageReturnPct: number | null;
  medianReturnPct: number | null;
  averageVolatilityPct: number | null;
  averageVolume: number | null;

  averageCurrentBinanceRank: number | null;
  averageCurrentBinanceRankPercentile: number | null;

  averageHistoricalToCurrentRankDelta: number | null;
}

interface Output {
  generatedAt: string;

  source: {
    endpoint: string;
    firstFile: string;
    secondFile: string;
    firstMarketCount: number;
    secondMarketCount: number;
    totalMarketCount: number;
  };

  historicalOrdering: {
    description: string;
    firstMarket: string | null;
    lastMarket: string | null;
    boundary: {
      firstFileLastSymbol: string | null;
      secondFileFirstSymbol: string | null;
    };
  };

  currentBinanceExchangeInfo: {
    symbolCount: number;
    returnedOrderPreserved: boolean;
    duplicateSymbols: string[];
    matchedHistoricalMarkets: number;
    missingHistoricalMarkets: string[];
  };

  orderingTests: OrderingTest[];

  rankCorrelations: NumericCorrelation[];

  groupComparison: GroupSummary[];

  markets: MarketRow[];

  conclusions: {
    currentOrderMatchesHistoricalOrder: boolean;
    currentOrderCorrelation: number | null;
    strongestRankCorrelations: NumericCorrelation[];
    notes: string[];
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadJson(filePath: string): Promise<ResearchFile> {
  console.log(`Loading ${filePath}...`);

  const text = await fs.readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(text);

  assert(
    typeof parsed === 'object' &&
      parsed !== null &&
      'markets' in parsed &&
      Array.isArray(parsed.markets),
    `Invalid research file: ${filePath}`,
  );

  const researchFile = parsed as ResearchFile;

  assert(
    researchFile.markets.every(
      (market) =>
        typeof market === 'object' &&
        market !== null &&
        typeof market.symbol === 'string',
    ),
    `Research file contains a market without a symbol: ${filePath}`,
  );

  return researchFile;
}

async function fetchExchangeInfo(): Promise<BinanceExchangeInfo> {
  console.log('');
  console.log('Fetching Binance Spot exchangeInfo...');
  console.log(`  ${BINANCE_EXCHANGE_INFO_URL}`);

  const response = await fetch(BINANCE_EXCHANGE_INFO_URL);

  if (!response.ok) {
    throw new Error(
      `Binance exchangeInfo request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data: unknown = await response.json();

  assert(
    typeof data === 'object' &&
      data !== null &&
      'symbols' in data &&
      Array.isArray(data.symbols),
    'Binance exchangeInfo response does not contain symbols[]',
  );

  const exchangeInfo = data as BinanceExchangeInfo;

  console.log(`  Binance returned ${exchangeInfo.symbols.length} symbols.`);

  return exchangeInfo;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculatePearson(
  x: number[],
  y: number[],
): number | null {
  if (x.length !== y.length || x.length < 2) {
    return null;
  }

  const meanX = mean(x);
  const meanY = mean(y);

  if (meanX === null || meanY === null) {
    return null;
  }

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;

    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }

  if (denominatorX === 0 || denominatorY === 0) {
    return null;
  }

  return numerator / Math.sqrt(denominatorX * denominatorY);
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({
    value,
    index,
  }));

  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);

  let i = 0;

  while (i < indexed.length) {
    let j = i + 1;

    while (
      j < indexed.length &&
      indexed[j].value === indexed[i].value
    ) {
      j += 1;
    }

    const averageRank = (i + 1 + j) / 2;

    for (let k = i; k < j; k += 1) {
      ranks[indexed[k].index] = averageRank;
    }

    i = j;
  }

  return ranks;
}

function calculateSpearman(
  x: number[],
  y: number[],
): number | null {
  if (x.length !== y.length || x.length < 2) {
    return null;
  }

  const rankedX = rankValues(x);
  const rankedY = rankValues(y);

  return calculatePearson(rankedX, rankedY);
}

function calculateMarketStatistics(
  market: ResearchMarket,
): Pick<
  MarketRow,
  | 'candleCount'
  | 'firstCandleTime'
  | 'lastCandleTime'
  | 'returnPct'
  | 'volatilityPct'
  | 'averageVolume'
  | 'medianVolume'
  | 'averageRangePct'
  | 'averageBodyPct'
  | 'positiveCandlePct'
  | 'negativeCandlePct'
  | 'flatCandlePct'
> {
  const candles = Array.isArray(market.candles)
    ? market.candles
    : [];

  if (candles.length === 0) {
    return {
      candleCount: 0,
      firstCandleTime: null,
      lastCandleTime: null,
      returnPct: null,
      volatilityPct: null,
      averageVolume: null,
      medianVolume: null,
      averageRangePct: null,
      averageBodyPct: null,
      positiveCandlePct: null,
      negativeCandlePct: null,
      flatCandlePct: null,
    };
  }

  const returns: number[] = [];
  const volumes: number[] = [];
  const ranges: number[] = [];
  const bodies: number[] = [];

  let positive = 0;
  let negative = 0;
  let flat = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];

    if (
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close) ||
      !Number.isFinite(candle.volume)
    ) {
      continue;
    }

    volumes.push(candle.volume);

    if (candle.open !== 0) {
      ranges.push(
        ((candle.high - candle.low) / candle.open) * 100,
      );

      bodies.push(
        (Math.abs(candle.close - candle.open) /
          candle.open) *
          100,
      );
    }

    if (candle.open !== 0 && candle.close !== 0) {
      returns.push(
        Math.log(candle.close / candle.open),
      );
    }

    if (candle.close > candle.open) {
      positive += 1;
    } else if (candle.close < candle.open) {
      negative += 1;
    } else {
      flat += 1;
    }
  }

  const first = candles[0];
  const last = candles[candles.length - 1];

  let returnPct: number | null = null;

  if (
    Number.isFinite(first.open) &&
    Number.isFinite(last.close) &&
    first.open !== 0
  ) {
    returnPct =
      ((last.close - first.open) / first.open) * 100;
  }

  let volatilityPct: number | null = null;

  if (returns.length > 1) {
    const averageReturn = mean(returns);

    if (averageReturn !== null) {
      const variance =
        returns.reduce(
          (sum, value) =>
            sum +
            Math.pow(value - averageReturn, 2),
          0,
        ) /
        (returns.length - 1);

      volatilityPct = Math.sqrt(variance) * 100;
    }
  }

  const directionalCount = positive + negative + flat;

  return {
    candleCount: candles.length,
    firstCandleTime:
      typeof first.openTime === 'number'
        ? first.openTime
        : null,
    lastCandleTime:
      typeof last.closeTime === 'number'
        ? last.closeTime
        : null,
    returnPct,
    volatilityPct,
    averageVolume: mean(volumes),
    medianVolume: median(volumes),
    averageRangePct: mean(ranges),
    averageBodyPct: mean(bodies),
    positiveCandlePct:
      directionalCount > 0
        ? (positive / directionalCount) * 100
        : null,
    negativeCandlePct:
      directionalCount > 0
        ? (negative / directionalCount) * 100
        : null,
    flatCandlePct:
      directionalCount > 0
        ? (flat / directionalCount) * 100
        : null,
  };
}

function getFilter(
  symbol: BinanceSymbol,
  filterType: string,
): BinanceFilter | null {
  const filter = symbol.filters?.find(
    (candidate) => candidate.filterType === filterType,
  );

  return filter ?? null;
}

function getFilterNumber(
  symbol: BinanceSymbol,
  filterType: string,
  property: keyof BinanceFilter,
): number | null {
  const filter = getFilter(symbol, filterType);

  if (!filter) {
    return null;
  }

  return getNumber(filter[property]);
}

function extractBaseAsset(symbol: string): string | null {
  const commonQuotes = [
    'USDT',
    'USDC',
    'FDUSD',
    'TUSD',
    'USDP',
    'DAI',
    'BTC',
    'ETH',
    'BNB',
    'TRY',
    'EUR',
    'GBP',
    'BRL',
    'AUD',
    'BIDR',
    'IDRT',
    'UAH',
    'RUB',
    'ZAR',
    'PLN',
    'RON',
    'ARS',
    'MXN',
    'COP',
    'JPY',
  ];

  const quote = commonQuotes.find((candidate) =>
    symbol.endsWith(candidate),
  );

  if (!quote) {
    return null;
  }

  return symbol.slice(0, -quote.length);
}

function buildHistoricalMarkets(
  firstFile: ResearchFile,
  secondFile: ResearchFile,
): ResearchMarket[] {
  const markets = [
    ...firstFile.markets,
    ...secondFile.markets,
  ];

  const symbols = new Set<string>();

  for (const market of markets) {
    if (symbols.has(market.symbol)) {
      throw new Error(
        `Duplicate symbol across research files: ${market.symbol}`,
      );
    }

    symbols.add(market.symbol);
  }

  return markets;
}

function getNumericRankCorrelation(
  rows: MarketRow[],
  field: string,
  getter: (row: MarketRow) => number | null,
): NumericCorrelation {
  const x: number[] = [];
  const y: number[] = [];

  for (const row of rows) {
    const value = getter(row);

    if (value === null || !Number.isFinite(value)) {
      continue;
    }

    x.push(row.historicalRank);
    y.push(value);
  }

  return {
    field,
    count: x.length,
    pearson: calculatePearson(x, y),
    spearman: calculateSpearman(x, y),
  };
}

function compareOrdering(
  historical: string[],
  current: string[],
): OrderingTest {
  const currentRank = new Map<string, number>();

  current.forEach((symbol, index) => {
    currentRank.set(symbol, index + 1);
  });

  const historicalRanks: number[] = [];
  const currentRanks: number[] = [];

  let matchedPositions = 0;

  historical.forEach((symbol, index) => {
    const rank = currentRank.get(symbol);

    if (rank === undefined) {
      return;
    }

    historicalRanks.push(index + 1);
    currentRanks.push(rank);

    if (rank === index + 1) {
      matchedPositions += 1;
    }
  });

  return {
    name: 'Historical research order vs current Binance exchangeInfo order',
    matchedPositions,
    totalPositions: historicalRanks.length,
    matchPercentage:
      historicalRanks.length > 0
        ? (matchedPositions / historicalRanks.length) * 100
        : 0,
    spearman: calculateSpearman(
      historicalRanks,
      currentRanks,
    ),
  };
}

function compareAgainstSortedOrder(
  historical: string[],
  comparator: (a: string, b: string) => number,
  name: string,
): OrderingTest {
  const expected = [...historical].sort(comparator);

  let matchedPositions = 0;

  for (let i = 0; i < historical.length; i += 1) {
    if (historical[i] === expected[i]) {
      matchedPositions += 1;
    }
  }

  const actualRanks = new Map<string, number>();

  historical.forEach((symbol, index) => {
    actualRanks.set(symbol, index + 1);
  });

  const expectedRanks = expected.map(
    (symbol) => actualRanks.get(symbol) ?? 0,
  );

  return {
    name,
    matchedPositions,
    totalPositions: historical.length,
    matchPercentage:
      historical.length > 0
        ? (matchedPositions / historical.length) * 100
        : 0,
    spearman: calculateSpearman(
      historical.map((_, index) => index + 1),
      expectedRanks,
    ),
  };
}

function averageNullable(
  rows: MarketRow[],
  getter: (row: MarketRow) => number | null,
): number | null {
  const values = rows
    .map(getter)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value),
    );

  return mean(values);
}

function buildGroupSummary(
  rows: MarketRow[],
  name: string,
): GroupSummary {
  const returns = rows
    .map((row) => row.returnPct)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value),
    );

  return {
    name,
    count: rows.length,

    historicalRankMin: Math.min(
      ...rows.map((row) => row.historicalRank),
    ),
    historicalRankMax: Math.max(
      ...rows.map((row) => row.historicalRank),
    ),

    averageReturnPct: mean(returns),
    medianReturnPct: median(returns),
    averageVolatilityPct: averageNullable(
      rows,
      (row) => row.volatilityPct,
    ),
    averageVolume: averageNullable(
      rows,
      (row) => row.averageVolume,
    ),

    averageCurrentBinanceRank: averageNullable(
      rows,
      (row) => row.currentBinanceRank,
    ),
    averageCurrentBinanceRankPercentile: averageNullable(
      rows,
      (row) => row.currentBinanceRankPercentile,
    ),

    averageHistoricalToCurrentRankDelta:
      averageNullable(
        rows,
        (row) => row.historicalToCurrentRankDelta,
      ),
  };
}

function sortCorrelations(
  correlations: NumericCorrelation[],
): NumericCorrelation[] {
  return [...correlations].sort((a, b) => {
    const aValue =
      a.spearman === null ? -Infinity : Math.abs(a.spearman);

    const bValue =
      b.spearman === null ? -Infinity : Math.abs(b.spearman);

    return bValue - aValue;
  });
}

function printSummary(output: Output): void {
  console.log('');
  console.log('='.repeat(70));
  console.log('BINANCE ORDER / HISTORY ANALYSIS');
  console.log('='.repeat(70));

  console.log('');
  console.log(
    `Historical markets: ${output.source.totalMarketCount}`,
  );

  console.log(
    `Current Binance symbols: ${output.currentBinanceExchangeInfo.symbolCount}`,
  );

  console.log(
    `Historical symbols matched: ${output.currentBinanceExchangeInfo.matchedHistoricalMarkets}`,
  );

  console.log('');
  console.log('Historical boundary:');

  console.log(
    `  ${output.historicalOrdering.boundary.firstFileLastSymbol} -> ${output.historicalOrdering.boundary.secondFileFirstSymbol}`,
  );

  console.log('');
  console.log('Historical order vs current Binance order:');

  const orderTest =
    output.orderingTests.find(
      (test) =>
        test.name ===
        'Historical research order vs current Binance exchangeInfo order',
    );

  if (orderTest) {
    console.log(
      `  Exact position matches: ${orderTest.matchedPositions}/${orderTest.totalPositions} (${orderTest.matchPercentage.toFixed(2)}%)`,
    );

    console.log(
      `  Spearman rank correlation: ${
        orderTest.spearman === null
          ? 'n/a'
          : orderTest.spearman.toFixed(4)
      }`,
    );
  }

  console.log('');
  console.log('Strongest rank correlations:');

  const strongest =
    output.conclusions.strongestRankCorrelations.slice(
      0,
      10,
    );

  for (const correlation of strongest) {
    console.log(
      `  ${correlation.field.padEnd(42)} ` +
        `n=${String(correlation.count).padStart(3)} ` +
        `Spearman=${
          correlation.spearman === null
            ? 'n/a'
            : correlation.spearman.toFixed(4)
        }`,
    );
  }

  console.log('');
  console.log('Group comparison:');

  for (const group of output.groupComparison) {
    console.log(
      `  ${group.name}:`,
    );

    console.log(
      `    ranks ${group.historicalRankMin}-${group.historicalRankMax}`,
    );

    console.log(
      `    average return: ${
        group.averageReturnPct === null
          ? 'n/a'
          : `${group.averageReturnPct.toFixed(4)}%`
      }`,
    );

    console.log(
      `    average current Binance rank: ${
        group.averageCurrentBinanceRank === null
          ? 'n/a'
          : group.averageCurrentBinanceRank.toFixed(2)
      }`,
    );
  }

  console.log('');
  console.log('Notes:');

  for (const note of output.conclusions.notes) {
    console.log(`  - ${note}`);
  }

  console.log('');
  console.log('='.repeat(70));
}

async function main(): Promise<void> {
  const [, , firstPath, secondPath] = process.argv;

  if (!firstPath || !secondPath) {
    console.error(
      'Usage: npx tsx server/research/runners/binance-order-history-analysis.ts <first-file.json> <second-file.json>',
    );
    process.exitCode = 1;
    return;
  }

  const [firstFile, secondFile] = await Promise.all([
    loadJson(path.resolve(firstPath)),
    loadJson(path.resolve(secondPath)),
  ]);

  console.log('');
  console.log(
    `First research file:  ${firstFile.markets.length} markets`,
  );
  console.log(
    `Second research file: ${secondFile.markets.length} markets`,
  );

  const historicalMarkets = buildHistoricalMarkets(
    firstFile,
    secondFile,
  );

  const historicalSymbols = historicalMarkets.map(
    (market) => market.symbol,
  );

  console.log('');
  console.log(
    `Combined historical market count: ${historicalMarkets.length}`,
  );

  const exchangeInfo = await fetchExchangeInfo();

  const currentSymbols = exchangeInfo.symbols.map(
    (symbol) => symbol.symbol,
  );

  const currentRankBySymbol = new Map<string, number>();

  currentSymbols.forEach((symbol, index) => {
    currentRankBySymbol.set(symbol, index + 1);
  });

  const exchangeInfoBySymbol = new Map<
    string,
    BinanceSymbol
  >();

  const duplicateSymbols: string[] = [];

  for (const symbol of exchangeInfo.symbols) {
    if (exchangeInfoBySymbol.has(symbol.symbol)) {
      duplicateSymbols.push(symbol.symbol);
    }

    exchangeInfoBySymbol.set(symbol.symbol, symbol);
  }

  const rows: MarketRow[] = [];

  for (
    let historicalIndex = 0;
    historicalIndex < historicalMarkets.length;
    historicalIndex += 1
  ) {
    const market = historicalMarkets[historicalIndex];

    if (historicalIndex % 10 === 0) {
      console.log(
        `Processing market ${historicalIndex + 1}/${historicalMarkets.length}...`,
      );
    }

    const historicalRank = historicalIndex + 1;

    const currentRank =
      currentRankBySymbol.get(market.symbol) ?? null;

    const current =
      exchangeInfoBySymbol.get(market.symbol) ?? null;

    const statistics = calculateMarketStatistics(market);

    const currentRankPercentile =
      currentRank === null ||
      exchangeInfo.symbols.length === 0
        ? null
        : (currentRank / exchangeInfo.symbols.length) *
          100;

    const priceFilter = current
      ? getFilter(current, 'PRICE_FILTER')
      : null;

    const lotSizeFilter = current
      ? getFilter(current, 'LOT_SIZE')
      : null;

    const marketLotSizeFilter = current
      ? getFilter(current, 'MARKET_LOT_SIZE')
      : null;

    const notionalFilter = current
      ? getFilter(current, 'NOTIONAL')
      : null;

    const minNotionalFilter = current
      ? getFilter(current, 'MIN_NOTIONAL')
      : null;

    const filterTypes = current
      ? [
          ...new Set(
            (current.filters ?? [])
              .map((filter) => filter.filterType)
              .filter(
                (value): value is string =>
                  typeof value === 'string',
              ),
          ),
        ]
      : [];

    const minQty =
      getFilterNumber(
        current ?? {
          symbol: '',
        },
        'LOT_SIZE',
        'minQty',
      ) ??
      getFilterNumber(
        current ?? {
          symbol: '',
        },
        'MARKET_LOT_SIZE',
        'minQty',
      );

    const maxQty =
      getFilterNumber(
        current ?? {
          symbol: '',
        },
        'LOT_SIZE',
        'maxQty',
      ) ??
      getFilterNumber(
        current ?? {
          symbol: '',
        },
        'MARKET_LOT_SIZE',
        'maxQty',
      );

    const stepSize =
      getFilterNumber(
        current ?? {
          symbol: '',
        },
        'LOT_SIZE',
        'stepSize',
      ) ??
      getFilterNumber(
        current ?? {
          symbol: '',
        },
        'MARKET_LOT_SIZE',
        'stepSize',
      );

    const minNotional =
      getNumber(notionalFilter?.minNotional) ??
      getNumber(minNotionalFilter?.minNotional);

    const maxNumOrders = getNumber(
      current?.filters?.find(
        (filter) =>
          filter.filterType === 'MAX_NUM_ORDERS',
      )?.maxNumOrders,
    );

    const maxNumAlgoOrders = getNumber(
      current?.filters?.find(
        (filter) =>
          filter.filterType === 'MAX_NUM_ALGO_ORDERS',
      )?.maxNumAlgoOrders,
    );

    rows.push({
      historicalRank,
      researchFile:
        historicalIndex < firstFile.markets.length
          ? 'first'
          : 'second',
      symbol: market.symbol,

      baseAsset:
        current?.baseAsset ??
        extractBaseAsset(market.symbol),
      quoteAsset: current?.quoteAsset ?? null,

      ...statistics,

      currentBinanceRank: currentRank,
      currentBinanceRankPercentile:
        currentRankPercentile,

      currentBinanceSymbolExists: current !== null,

      currentStatus: current?.status ?? null,
      currentBaseAsset: current?.baseAsset ?? null,
      currentQuoteAsset: current?.quoteAsset ?? null,

      baseAssetPrecision:
        current?.baseAssetPrecision ?? null,
      quotePrecision:
        current?.quotePrecision ?? null,
      quoteAssetPrecision:
        current?.quoteAssetPrecision ?? null,
      baseCommissionPrecision:
        current?.baseCommissionPrecision ?? null,
      quoteCommissionPrecision:
        current?.quoteCommissionPrecision ?? null,

      icebergAllowed: current?.icebergAllowed ?? null,
      ocoAllowed: current?.ocoAllowed ?? null,
      otoAllowed: current?.otoAllowed ?? null,
      quoteOrderQtyMarketAllowed:
        current?.quoteOrderQtyMarketAllowed ?? null,
      isSpotTradingAllowed:
        current?.isSpotTradingAllowed ?? null,
      isMarginTradingAllowed:
        current?.isMarginTradingAllowed ?? null,

      orderTypes: current?.orderTypes ?? [],
      permissions: current?.permissions ?? [],
      defaultSelfTradePreventionMode:
        current?.defaultSelfTradePreventionMode ??
        null,
      allowedSelfTradePreventionModes:
        current?.allowedSelfTradePreventionModes ?? [],

      filterTypes,

      minPrice:
        getNumber(priceFilter?.minPrice),
      maxPrice:
        getNumber(priceFilter?.maxPrice),
      tickSize:
        getNumber(priceFilter?.tickSize),

      minQty,
      maxQty,
      stepSize,

      minNotional,

      maxNumOrders,
      maxNumAlgoOrders,

      historicalToCurrentRankDelta:
        currentRank === null
          ? null
          : currentRank - historicalRank,

      historicalToCurrentRankRatio:
        currentRank === null ||
        historicalRank === 0
          ? null
          : currentRank / historicalRank,
    });
  }

  const matchedRows = rows.filter(
    (row) => row.currentBinanceSymbolExists,
  );

  const missingHistoricalMarkets = rows
    .filter((row) => !row.currentBinanceSymbolExists)
    .map((row) => row.symbol);

  const rankCorrelations: NumericCorrelation[] = [
    getNumericRankCorrelation(
      matchedRows,
      'currentBinanceRank',
      (row) => row.currentBinanceRank,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'currentBinanceRankPercentile',
      (row) => row.currentBinanceRankPercentile,
    ),
    getNumericRankCorrelation(
      rows,
      'returnPct',
      (row) => row.returnPct,
    ),
    getNumericRankCorrelation(
      rows,
      'volatilityPct',
      (row) => row.volatilityPct,
    ),
    getNumericRankCorrelation(
      rows,
      'averageVolume',
      (row) => row.averageVolume,
    ),
    getNumericRankCorrelation(
      rows,
      'medianVolume',
      (row) => row.medianVolume,
    ),
    getNumericRankCorrelation(
      rows,
      'averageRangePct',
      (row) => row.averageRangePct,
    ),
    getNumericRankCorrelation(
      rows,
      'averageBodyPct',
      (row) => row.averageBodyPct,
    ),
    getNumericRankCorrelation(
      rows,
      'positiveCandlePct',
      (row) => row.positiveCandlePct,
    ),
    getNumericRankCorrelation(
      rows,
      'negativeCandlePct',
      (row) => row.negativeCandlePct,
    ),
    getNumericRankCorrelation(
      rows,
      'flatCandlePct',
      (row) => row.flatCandlePct,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'baseAssetPrecision',
      (row) => row.baseAssetPrecision,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'quotePrecision',
      (row) => row.quotePrecision,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'quoteAssetPrecision',
      (row) => row.quoteAssetPrecision,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'minPrice',
      (row) => row.minPrice,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'maxPrice',
      (row) => row.maxPrice,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'tickSize',
      (row) => row.tickSize,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'minQty',
      (row) => row.minQty,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'maxQty',
      (row) => row.maxQty,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'stepSize',
      (row) => row.stepSize,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'minNotional',
      (row) => row.minNotional,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'maxNumOrders',
      (row) => row.maxNumOrders,
    ),
    getNumericRankCorrelation(
      matchedRows,
      'maxNumAlgoOrders',
      (row) => row.maxNumAlgoOrders,
    ),
  ];

  const historicalOrderTest = compareOrdering(
    historicalSymbols,
    currentSymbols,
  );

  const alphabeticalTest =
    compareAgainstSortedOrder(
      historicalSymbols,
      (a, b) => a.localeCompare(b),
      'Alphabetical symbol order',
    );

  const baseAssetTest =
    compareAgainstSortedOrder(
      historicalSymbols,
      (a, b) => {
        const baseA = extractBaseAsset(a) ?? a;
        const baseB = extractBaseAsset(b) ?? b;

        return baseA.localeCompare(baseB);
      },
      'Alphabetical base-asset order',
    );

  const symbolLengthTest =
    compareAgainstSortedOrder(
      historicalSymbols,
      (a, b) => a.length - b.length,
      'Symbol-length ascending order',
    );

  const currentRankTest = matchedRows.length
    ? calculateSpearman(
        matchedRows.map(
          (row) => row.historicalRank,
        ),
        matchedRows.map(
          (row) => row.currentBinanceRank ?? 0,
        ),
      )
    : null;

  const orderingTests: OrderingTest[] = [
    historicalOrderTest,
    alphabeticalTest,
    baseAssetTest,
    symbolLengthTest,
  ];

  const firstRows = rows.filter(
    (row) => row.researchFile === 'first',
  );

  const secondRows = rows.filter(
    (row) => row.researchFile === 'second',
  );

  const firstReturnValues = firstRows
    .map((row) => row.returnPct)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value),
    );

  const secondReturnValues = secondRows
    .map((row) => row.returnPct)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value),
    );

  const sortedCorrelations =
    sortCorrelations(rankCorrelations);

  const notes: string[] = [];

  if (historicalOrderTest.spearman !== null) {
    if (
      historicalOrderTest.spearman >= 0.9
    ) {
      notes.push(
        'The historical market order is extremely similar to the current Binance exchangeInfo order.',
      );
    } else if (
      historicalOrderTest.spearman >= 0.7
    ) {
      notes.push(
        'The historical market order has a strong positive relationship with the current Binance exchangeInfo order.',
      );
    } else if (
      historicalOrderTest.spearman >= 0.4
    ) {
      notes.push(
        'The historical market order has a moderate positive relationship with the current Binance exchangeInfo order.',
      );
    } else {
      notes.push(
        'The historical market order has only a weak relationship with the current Binance exchangeInfo order.',
      );
    }
  }

  if (missingHistoricalMarkets.length > 0) {
    notes.push(
      `${missingHistoricalMarkets.length} historical markets are no longer present in the current Binance Spot symbol catalogue.`,
    );
  }

  if (
    firstReturnValues.length > 0 &&
    secondReturnValues.length > 0
  ) {
    const firstMean = mean(firstReturnValues);
    const secondMean = mean(secondReturnValues);

    if (
      firstMean !== null &&
      secondMean !== null
    ) {
      notes.push(
        `The two historical groups have mean candle-period returns of ${firstMean.toFixed(4)}% and ${secondMean.toFixed(4)}%; these are descriptive candle statistics, not the trading-strategy profitability metric.`,
      );
    }
  }

  notes.push(
    'Current Spot exchangeInfo does not provide a Spot onboard/listing date, so this runner deliberately does not infer historical listing dates.',
  );

  notes.push(
    'A strong historical-to-current rank relationship would indicate that the research dataset preserved Binance catalogue order across time; it would not by itself prove what internal rule Binance uses to construct that order.',
  );

  notes.push(
    'Historical listing dates should be joined in a separate analysis once a reliable dated Spot listing source has been identified.',
  );

  const output: Output = {
    generatedAt: new Date().toISOString(),

    source: {
      endpoint: BINANCE_EXCHANGE_INFO_URL,
      firstFile: path.resolve(firstPath),
      secondFile: path.resolve(secondPath),
      firstMarketCount: firstFile.markets.length,
      secondMarketCount: secondFile.markets.length,
      totalMarketCount: historicalMarkets.length,
    },

    historicalOrdering: {
      description:
        'Order is the concatenation of markets[] from the first research file followed by markets[] from the second research file.',
      firstMarket:
        historicalSymbols[0] ?? null,
      lastMarket:
        historicalSymbols[
          historicalSymbols.length - 1
        ] ?? null,
      boundary: {
        firstFileLastSymbol:
          firstFile.markets[
            firstFile.markets.length - 1
          ]?.symbol ?? null,
        secondFileFirstSymbol:
          secondFile.markets[0]?.symbol ?? null,
      },
    },

    currentBinanceExchangeInfo: {
      symbolCount: exchangeInfo.symbols.length,
      returnedOrderPreserved: true,
      duplicateSymbols,
      matchedHistoricalMarkets:
        matchedRows.length,
      missingHistoricalMarkets,
    },

    orderingTests,

    rankCorrelations,

    groupComparison: [
      buildGroupSummary(firstRows, 'First research file'),
      buildGroupSummary(secondRows, 'Second research file'),
    ],

    markets: rows,

    conclusions: {
      currentOrderMatchesHistoricalOrder:
        currentRankTest !== null &&
        currentRankTest >= 0.9,

      currentOrderCorrelation: currentRankTest,

      strongestRankCorrelations:
        sortedCorrelations.slice(0, 10),

      notes,
    },
  };

  await fs.mkdir(OUTPUT_DIRECTORY, {
    recursive: true,
  });

  const outputPath = path.join(
    OUTPUT_DIRECTORY,
    `binance-order-history-analysis-${Date.now()}.json`,
  );

  await fs.writeFile(
    outputPath,
    JSON.stringify(output, null, 2),
    'utf8',
  );

  printSummary(output);

  console.log('');
  console.log(`Output written to: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error('');
  console.error('Runner failed.');

  if (error instanceof Error) {
    console.error(error.message);
    console.error(error.stack);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
