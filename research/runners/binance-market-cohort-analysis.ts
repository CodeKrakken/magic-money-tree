import fs from "node:fs";
import path from "node:path";

const RESEARCH_DIR = path.resolve(process.cwd(), "research");
const OUTPUT_DIR = path.join(RESEARCH_DIR, "output");

const STRATEGY_FILE = path.join(
  OUTPUT_DIR,
  "market-strategy-ranking-independent-1789232701426.json",
);

const EXCHANGE_INFO_FILE = path.join(
  OUTPUT_DIR,
  "binance-exchange-info-20260915T122749Z.json",
);

interface BinanceFilter {
  filterType: string;
  [key: string]: unknown;
}

interface BinanceSymbol {
  symbol: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  baseAssetPrecision?: number;
  quotePrecision?: number;
  quoteAssetPrecision?: number;
  filters?: BinanceFilter[];
  [key: string]: unknown;
}

interface ExchangeInfo {
  symbols: BinanceSymbol[];
  [key: string]: unknown;
}

interface StrategyMarket {
  symbol: string;
  datasetGroup?: string;
  marketIndex?: number;
  binanceArrayPosition?: number;

  netProfit?: number;
  grossProfit?: number;
  fees?: number;
  returnPct?: number;

  signals?: number;
  accepted?: number;
  buys?: number;
  sells?: number;

  winningPositions?: number;
  losingPositions?: number;
  flatPositions?: number;
  winRate?: number;

  [key: string]: unknown;
}

interface StrategyOutput {
  sample?: {
    markets?: StrategyMarket[];
  };
  outOfSample?: {
    markets?: StrategyMarket[];
  };
  [key: string]: unknown;
}

type ProfitClass = "positive" | "flat" | "negative";

interface StrategyOverlay {
  symbol: string;
  datasetGroup: string;
  strategyMarketIndex: number | null;
  historicalBinanceArrayPosition: number | null;

  profitClass: ProfitClass;
  netProfit: number;

  grossProfit: number | null;
  fees: number | null;
  returnPct: number | null;

  signals: number | null;
  accepted: number | null;
  buys: number | null;
  sells: number | null;

  winningPositions: number | null;
  losingPositions: number | null;
  flatPositions: number | null;
  winRate: number | null;
}

interface CatalogueMarket {
  apiPosition: number;

  symbol: string;
  status: string | null;
  baseAsset: string | null;
  quoteAsset: string | null;

  baseAssetPrecision: number | null;
  quotePrecision: number | null;
  quoteAssetPrecision: number | null;

  priceMin: number | null;
  priceMax: number | null;
  priceTick: number | null;

  lotMin: number | null;
  lotMax: number | null;
  lotStep: number | null;

  marketLotMin: number | null;
  marketLotMax: number | null;
  marketLotStep: number | null;

  percentBidUp: number | null;
  percentBidDown: number | null;
  percentAskUp: number | null;
  percentAskDown: number | null;
  percentAvgPriceMins: number | null;

  minNotional: number | null;
  maxNotional: number | null;

  overlay: StrategyOverlay | null;

  exactFingerprint: string;
  structuralFingerprint: string;
  precisionFingerprint: string;
}

interface CohortStats {
  fingerprint: string;

  catalogueCount: number;
  strategyCount: number;

  apiPositionMin: number;
  apiPositionMax: number;
  apiPositionSpan: number;
  averageApiPosition: number;
  medianApiPosition: number;

  contiguousRunCount: number;
  largestContiguousRun: number;

  positiveCount: number;
  flatCount: number;
  negativeCount: number;

  positiveRate: number | null;
  flatRate: number | null;
  negativeRate: number | null;

  totalNetProfit: number;
  meanNetProfit: number | null;
  medianNetProfit: number | null;

  meanPositiveProfit: number | null;
  meanNegativeProfit: number | null;

  positiveNetProfit: number;
  negativeNetProfit: number;

  strategySymbols: string[];

  apiPositionRuns: Array<{
    start: number;
    end: number;
    length: number;
  }>;
}

interface StrategyMarketRow {
  symbol: string;
  datasetGroup: string;
  apiPosition: number;
  historicalBinanceArrayPosition: number | null;

  profitClass: ProfitClass;
  netProfit: number;

  grossProfit: number | null;
  fees: number | null;
  returnPct: number | null;

  signals: number | null;
  accepted: number | null;
  buys: number | null;
  sells: number | null;

  winningPositions: number | null;
  losingPositions: number | null;
  flatPositions: number | null;
  winRate: number | null;

  priceMin: number | null;
  priceMax: number | null;
  priceTick: number | null;

  lotMin: number | null;
  lotMax: number | null;
  lotStep: number | null;

  marketLotMin: number | null;
  marketLotMax: number | null;
  marketLotStep: number | null;

  percentBidUp: number | null;
  percentBidDown: number | null;
  percentAskUp: number | null;
  percentAskDown: number | null;
  percentAvgPriceMins: number | null;

  minNotional: number | null;
  maxNotional: number | null;

  baseAssetPrecision: number | null;
  quotePrecision: number | null;
  quoteAssetPrecision: number | null;

  structuralFingerprint: string;

  cohortCatalogueCount: number;
  cohortStrategyCount: number;

  cohortPositiveRate: number | null;
  cohortFlatRate: number | null;
  cohortNegativeRate: number | null;

  cohortTotalNetProfit: number;
  cohortMeanNetProfit: number | null;
  cohortMedianNetProfit: number | null;

  cohortPositiveNetProfit: number;
  cohortNegativeNetProfit: number;
}

interface OutputSummary {
  generatedAt: string;

  catalogueSymbols: number;
  catalogueTradingSymbols: number;

  strategyMarkets: number;
  matchedStrategyMarkets: number;
  unmatchedStrategyMarkets: number;

  positiveMarkets: number;
  flatMarkets: number;
  negativeMarkets: number;

  positiveRate: number;
  flatRate: number;
  negativeRate: number;

  totalNetProfit: number;
  meanNetProfit: number;
  medianNetProfit: number;

  exactFingerprintCount: number;
  structuralFingerprintCount: number;
  precisionFingerprintCount: number;

  exactFingerprintsWithStrategyMarkets: number;
  structuralFingerprintsWithStrategyMarkets: number;
  precisionFingerprintsWithStrategyMarkets: number;

  negativeExactCohorts: number;
  negativeStructuralCohorts: number;
  negativePrecisionCohorts: number;
}

interface AnalysisOutput {
  summary: OutputSummary;

  strategyMarkets: StrategyMarketRow[];

  exactCohorts: CohortStats[];
  structuralCohorts: CohortStats[];
  precisionCohorts: CohortStats[];

  negativeStructuralCohorts: CohortStats[];
  negativePrecisionCohorts: CohortStats[];

  strongestAvoidanceCandidates: CohortStats[];
  strongestPositiveCandidates: CohortStats[];
}

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getFilter(
  symbol: BinanceSymbol,
  filterType: string,
): BinanceFilter | undefined {
  return symbol.filters?.find(
    (filter) => filter.filterType === filterType,
  );
}

function filterNumber(
  symbol: BinanceSymbol,
  filterType: string,
  field: string,
): number | null {
  const filter = getFilter(symbol, filterType);

  return filter ? toNumber(filter[field]) : null;
}

function normalizeFingerprintValue(
  value: number | null,
): string {
  if (value === null) {
    return "null";
  }

  return String(value);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce(
    (sum, value) => sum + value,
    0,
  ) / values.length;
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

function profitClass(netProfit: number): ProfitClass {
  if (netProfit > 0) {
    return "positive";
  }

  if (netProfit < 0) {
    return "negative";
  }

  return "flat";
}

function getStrategyMarkets(
  strategy: StrategyOutput,
): StrategyMarket[] {
  return [
    ...(strategy.sample?.markets ?? []),
    ...(strategy.outOfSample?.markets ?? []),
  ];
}

function createOverlay(
  market: StrategyMarket,
): StrategyOverlay {
  const netProfit =
    toNumber(market.netProfit) ?? 0;

  return {
    symbol: market.symbol,

    datasetGroup:
      market.datasetGroup ?? "Unknown",

    strategyMarketIndex:
      market.marketIndex ?? null,

    historicalBinanceArrayPosition:
      market.binanceArrayPosition ?? null,

    profitClass: profitClass(netProfit),
    netProfit,

    grossProfit:
      toNumber(market.grossProfit),

    fees:
      toNumber(market.fees),

    returnPct:
      toNumber(market.returnPct),

    signals:
      toNumber(market.signals),

    accepted:
      toNumber(market.accepted),

    buys:
      toNumber(market.buys),

    sells:
      toNumber(market.sells),

    winningPositions:
      toNumber(market.winningPositions),

    losingPositions:
      toNumber(market.losingPositions),

    flatPositions:
      toNumber(market.flatPositions),

    winRate:
      toNumber(market.winRate),
  };
}

function buildCatalogueMarket(
  symbol: BinanceSymbol,
  apiPosition: number,
  overlay: StrategyOverlay | null,
): CatalogueMarket {
  const priceMin = filterNumber(
    symbol,
    "PRICE_FILTER",
    "minPrice",
  );

  const priceMax = filterNumber(
    symbol,
    "PRICE_FILTER",
    "maxPrice",
  );

  const priceTick = filterNumber(
    symbol,
    "PRICE_FILTER",
    "tickSize",
  );

  const lotMin = filterNumber(
    symbol,
    "LOT_SIZE",
    "minQty",
  );

  const lotMax = filterNumber(
    symbol,
    "LOT_SIZE",
    "maxQty",
  );

  const lotStep = filterNumber(
    symbol,
    "LOT_SIZE",
    "stepSize",
  );

  const marketLotMin = filterNumber(
    symbol,
    "MARKET_LOT_SIZE",
    "minQty",
  );

  const marketLotMax = filterNumber(
    symbol,
    "MARKET_LOT_SIZE",
    "maxQty",
  );

  const marketLotStep = filterNumber(
    symbol,
    "MARKET_LOT_SIZE",
    "stepSize",
  );

  const percentBidUp = filterNumber(
    symbol,
    "PERCENT_PRICE_BY_SIDE",
    "bidMultiplierUp",
  );

  const percentBidDown = filterNumber(
    symbol,
    "PERCENT_PRICE_BY_SIDE",
    "bidMultiplierDown",
  );

  const percentAskUp = filterNumber(
    symbol,
    "PERCENT_PRICE_BY_SIDE",
    "askMultiplierUp",
  );

  const percentAskDown = filterNumber(
    symbol,
    "PERCENT_PRICE_BY_SIDE",
    "askMultiplierDown",
  );

  const percentAvgPriceMins = filterNumber(
    symbol,
    "PERCENT_PRICE_BY_SIDE",
    "avgPriceMins",
  );

  const minNotional = filterNumber(
    symbol,
    "NOTIONAL",
    "minNotional",
  );

  const maxNotional = filterNumber(
    symbol,
    "NOTIONAL",
    "maxNotional",
  );

  const basePrecision = toNumber(
    symbol.baseAssetPrecision,
  );

  const quotePrecision = toNumber(
    symbol.quotePrecision,
  );

  const quoteAssetPrecision = toNumber(
    symbol.quoteAssetPrecision,
  );

  /*
   * Exact fingerprint.
   *
   * This is deliberately strict and therefore may produce many
   * small cohorts.
   */
  const exactFingerprint = [
    `priceMin=${normalizeFingerprintValue(priceMin)}`,
    `priceMax=${normalizeFingerprintValue(priceMax)}`,
    `priceTick=${normalizeFingerprintValue(priceTick)}`,

    `lotMin=${normalizeFingerprintValue(lotMin)}`,
    `lotMax=${normalizeFingerprintValue(lotMax)}`,
    `lotStep=${normalizeFingerprintValue(lotStep)}`,

    `marketLotMin=${normalizeFingerprintValue(marketLotMin)}`,
    `marketLotMax=${normalizeFingerprintValue(marketLotMax)}`,
    `marketLotStep=${normalizeFingerprintValue(marketLotStep)}`,

    `bidUp=${normalizeFingerprintValue(percentBidUp)}`,
    `bidDown=${normalizeFingerprintValue(percentBidDown)}`,
    `askUp=${normalizeFingerprintValue(percentAskUp)}`,
    `askDown=${normalizeFingerprintValue(percentAskDown)}`,
    `percentMins=${normalizeFingerprintValue(percentAvgPriceMins)}`,

    `minNotional=${normalizeFingerprintValue(minNotional)}`,
    `maxNotional=${normalizeFingerprintValue(maxNotional)}`,

    `basePrecision=${normalizeFingerprintValue(basePrecision)}`,
    `quotePrecision=${normalizeFingerprintValue(quotePrecision)}`,
    `quoteAssetPrecision=${normalizeFingerprintValue(
      quoteAssetPrecision,
    )}`,
  ].join("|");

  /*
   * Structural fingerprint.
   *
   * MARKET_LOT_SIZE is deliberately excluded here because it is
   * often extremely granular and can make otherwise similar
   * markets unique.
   *
   * This is the primary cohort definition for the analysis.
   */
  const structuralFingerprint = [
    `priceMin=${normalizeFingerprintValue(priceMin)}`,
    `priceMax=${normalizeFingerprintValue(priceMax)}`,
    `priceTick=${normalizeFingerprintValue(priceTick)}`,

    `lotMin=${normalizeFingerprintValue(lotMin)}`,
    `lotMax=${normalizeFingerprintValue(lotMax)}`,
    `lotStep=${normalizeFingerprintValue(lotStep)}`,

    `bidUp=${normalizeFingerprintValue(percentBidUp)}`,
    `bidDown=${normalizeFingerprintValue(percentBidDown)}`,
    `askUp=${normalizeFingerprintValue(percentAskUp)}`,
    `askDown=${normalizeFingerprintValue(percentAskDown)}`,
    `percentMins=${normalizeFingerprintValue(percentAvgPriceMins)}`,

    `minNotional=${normalizeFingerprintValue(minNotional)}`,
    `maxNotional=${normalizeFingerprintValue(maxNotional)}`,

    `basePrecision=${normalizeFingerprintValue(basePrecision)}`,
    `quotePrecision=${normalizeFingerprintValue(quotePrecision)}`,
    `quoteAssetPrecision=${normalizeFingerprintValue(
      quoteAssetPrecision,
    )}`,
  ].join("|");

  /*
   * Precision fingerprint.
   *
   * This gives us a simpler way to test whether the apparent
   * cohort effect is mostly explained by price/quantity scale.
   */
  const precisionFingerprint = [
    `priceMin=${normalizeFingerprintValue(priceMin)}`,
    `priceMax=${normalizeFingerprintValue(priceMax)}`,
    `priceTick=${normalizeFingerprintValue(priceTick)}`,

    `lotMin=${normalizeFingerprintValue(lotMin)}`,
    `lotMax=${normalizeFingerprintValue(lotMax)}`,
    `lotStep=${normalizeFingerprintValue(lotStep)}`,

    `basePrecision=${normalizeFingerprintValue(basePrecision)}`,
    `quotePrecision=${normalizeFingerprintValue(quotePrecision)}`,
    `quoteAssetPrecision=${normalizeFingerprintValue(
      quoteAssetPrecision,
    )}`,
  ].join("|");

  return {
    apiPosition,

    symbol: symbol.symbol,
    status: symbol.status ?? null,
    baseAsset: symbol.baseAsset ?? null,
    quoteAsset: symbol.quoteAsset ?? null,

    baseAssetPrecision: basePrecision,
    quotePrecision,
    quoteAssetPrecision,

    priceMin,
    priceMax,
    priceTick,

    lotMin,
    lotMax,
    lotStep,

    marketLotMin,
    marketLotMax,
    marketLotStep,

    percentBidUp,
    percentBidDown,
    percentAskUp,
    percentAskDown,
    percentAvgPriceMins,

    minNotional,
    maxNotional,

    overlay,

    exactFingerprint,
    structuralFingerprint,
    precisionFingerprint,
  };
}

function buildRuns(
  positions: number[],
): Array<{
  start: number;
  end: number;
  length: number;
}> {
  if (positions.length === 0) {
    return [];
  }

  const sorted = [...positions].sort(
    (a, b) => a - b,
  );

  const runs: Array<{
    start: number;
    end: number;
    length: number;
  }> = [];

  let start = sorted[0];
  let previous = sorted[0];

  for (
    let index = 1;
    index < sorted.length;
    index += 1
  ) {
    const current = sorted[index];

    if (current === previous + 1) {
      previous = current;
      continue;
    }

    runs.push({
      start,
      end: previous,
      length: previous - start + 1,
    });

    start = current;
    previous = current;
  }

  runs.push({
    start,
    end: previous,
    length: previous - start + 1,
  });

  return runs;
}

function buildCohortStats(
  fingerprint: string,
  markets: CatalogueMarket[],
): CohortStats {
  const overlays = markets
    .map((market) => market.overlay)
    .filter(
      (overlay): overlay is StrategyOverlay =>
        overlay !== null,
    );

  const positions = markets.map(
    (market) => market.apiPosition,
  );

  const profits = overlays.map(
    (overlay) => overlay.netProfit,
  );

  const positiveProfits = overlays
    .filter(
      (overlay) =>
        overlay.profitClass === "positive",
    )
    .map((overlay) => overlay.netProfit);

  const negativeProfits = overlays
    .filter(
      (overlay) =>
        overlay.profitClass === "negative",
    )
    .map((overlay) => overlay.netProfit);

  const positiveCount = positiveProfits.length;

  const flatCount = overlays.filter(
    (overlay) => overlay.profitClass === "flat",
  ).length;

  const negativeCount = negativeProfits.length;

  const totalNetProfit = profits.reduce(
    (sum, value) => sum + value,
    0,
  );

  const positiveNetProfit =
    positiveProfits.reduce(
      (sum, value) => sum + value,
      0,
    );

  const negativeNetProfit =
    negativeProfits.reduce(
      (sum, value) => sum + value,
      0,
    );

  const runs = buildRuns(positions);

  return {
    fingerprint,

    catalogueCount: markets.length,
    strategyCount: overlays.length,

    apiPositionMin: Math.min(...positions),
    apiPositionMax: Math.max(...positions),

    apiPositionSpan:
      Math.max(...positions) -
      Math.min(...positions),

    averageApiPosition:
      mean(positions),

    medianApiPosition:
      median(positions),

    contiguousRunCount: runs.length,

    largestContiguousRun:
      Math.max(...runs.map((run) => run.length)),

    positiveCount,
    flatCount,
    negativeCount,

    positiveRate:
      overlays.length > 0
        ? positiveCount / overlays.length
        : null,

    flatRate:
      overlays.length > 0
        ? flatCount / overlays.length
        : null,

    negativeRate:
      overlays.length > 0
        ? negativeCount / overlays.length
        : null,

    totalNetProfit,

    meanNetProfit:
      profits.length > 0
        ? mean(profits)
        : null,

    medianNetProfit:
      profits.length > 0
        ? median(profits)
        : null,

    meanPositiveProfit:
      positiveProfits.length > 0
        ? mean(positiveProfits)
        : null,

    meanNegativeProfit:
      negativeProfits.length > 0
        ? mean(negativeProfits)
        : null,

    positiveNetProfit,
    negativeNetProfit,

    strategySymbols:
      overlays.map((overlay) => overlay.symbol),

    apiPositionRuns: runs,
  };
}

function buildCohorts(
  markets: CatalogueMarket[],
  selector: (
    market: CatalogueMarket,
  ) => string,
): CohortStats[] {
  const groups =
    new Map<string, CatalogueMarket[]>();

  for (const market of markets) {
    const fingerprint = selector(market);

    const existing = groups.get(fingerprint);

    if (existing) {
      existing.push(market);
    } else {
      groups.set(fingerprint, [market]);
    }
  }

  return [...groups.entries()]
    .map(([fingerprint, group]) =>
      buildCohortStats(
        fingerprint,
        group,
      ),
    )
    .sort((a, b) => {
      if (b.strategyCount !== a.strategyCount) {
        return b.strategyCount - a.strategyCount;
      }

      if (
        b.catalogueCount !==
        a.catalogueCount
      ) {
        return (
          b.catalogueCount -
          a.catalogueCount
        );
      }

      return (
        b.totalNetProfit -
        a.totalNetProfit
      );
    });
}

function csvEscape(value: unknown): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const stringValue = String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replaceAll(
      '"',
      '""',
    )}"`;
  }

  return stringValue;
}

function writeCsv(
  filePath: string,
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) {
    fs.writeFileSync(
      filePath,
      "",
      "utf8",
    );

    return;
  }

  const headers = Object.keys(rows[0]);

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) =>
      headers
        .map((header) =>
          csvEscape(row[header]),
        )
        .join(","),
    ),
  ];

  fs.writeFileSync(
    filePath,
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

function cohortToCsvRow(
  cohort: CohortStats,
): Record<string, unknown> {
  return {
    fingerprint:
      cohort.fingerprint,

    catalogueCount:
      cohort.catalogueCount,

    strategyCount:
      cohort.strategyCount,

    apiPositionMin:
      cohort.apiPositionMin,

    apiPositionMax:
      cohort.apiPositionMax,

    apiPositionSpan:
      cohort.apiPositionSpan,

    averageApiPosition:
      cohort.averageApiPosition,

    medianApiPosition:
      cohort.medianApiPosition,

    contiguousRunCount:
      cohort.contiguousRunCount,

    largestContiguousRun:
      cohort.largestContiguousRun,

    positiveCount:
      cohort.positiveCount,

    flatCount:
      cohort.flatCount,

    negativeCount:
      cohort.negativeCount,

    positiveRate:
      cohort.positiveRate,

    flatRate:
      cohort.flatRate,

    negativeRate:
      cohort.negativeRate,

    totalNetProfit:
      cohort.totalNetProfit,

    meanNetProfit:
      cohort.meanNetProfit,

    medianNetProfit:
      cohort.medianNetProfit,

    meanPositiveProfit:
      cohort.meanPositiveProfit,

    meanNegativeProfit:
      cohort.meanNegativeProfit,

    positiveNetProfit:
      cohort.positiveNetProfit,

    negativeNetProfit:
      cohort.negativeNetProfit,

    strategySymbols:
      cohort.strategySymbols.join("|"),

    apiPositionRuns:
      cohort.apiPositionRuns
        .map(
          (run) =>
            `${run.start}-${run.end}`,
        )
        .join("|"),
  };
}

function buildStrategyMarketRow(
  market: CatalogueMarket,
  structuralCohort: CohortStats | undefined,
): StrategyMarketRow {
  const overlay = market.overlay;

  if (!overlay) {
    throw new Error(
      `Cannot build strategy row without overlay: ${market.symbol}`,
    );
  }

  return {
    symbol: market.symbol,
    datasetGroup:
      overlay.datasetGroup,

    apiPosition:
      market.apiPosition,

    historicalBinanceArrayPosition:
      overlay.historicalBinanceArrayPosition,

    profitClass:
      overlay.profitClass,

    netProfit:
      overlay.netProfit,

    grossProfit:
      overlay.grossProfit,

    fees:
      overlay.fees,

    returnPct:
      overlay.returnPct,

    signals:
      overlay.signals,

    accepted:
      overlay.accepted,

    buys:
      overlay.buys,

    sells:
      overlay.sells,

    winningPositions:
      overlay.winningPositions,

    losingPositions:
      overlay.losingPositions,

    flatPositions:
      overlay.flatPositions,

    winRate:
      overlay.winRate,

    priceMin:
      market.priceMin,

    priceMax:
      market.priceMax,

    priceTick:
      market.priceTick,

    lotMin:
      market.lotMin,

    lotMax:
      market.lotMax,

    lotStep:
      market.lotStep,

    marketLotMin:
      market.marketLotMin,

    marketLotMax:
      market.marketLotMax,

    marketLotStep:
      market.marketLotStep,

    percentBidUp:
      market.percentBidUp,

    percentBidDown:
      market.percentBidDown,

    percentAskUp:
      market.percentAskUp,

    percentAskDown:
      market.percentAskDown,

    percentAvgPriceMins:
      market.percentAvgPriceMins,

    minNotional:
      market.minNotional,

    maxNotional:
      market.maxNotional,

    baseAssetPrecision:
      market.baseAssetPrecision,

    quotePrecision:
      market.quotePrecision,

    quoteAssetPrecision:
      market.quoteAssetPrecision,

    structuralFingerprint:
      market.structuralFingerprint,

    cohortCatalogueCount:
      structuralCohort?.catalogueCount ?? 0,

    cohortStrategyCount:
      structuralCohort?.strategyCount ?? 0,

    cohortPositiveRate:
      structuralCohort?.positiveRate ?? null,

    cohortFlatRate:
      structuralCohort?.flatRate ?? null,

    cohortNegativeRate:
      structuralCohort?.negativeRate ?? null,

    cohortTotalNetProfit:
      structuralCohort?.totalNetProfit ?? 0,

    cohortMeanNetProfit:
      structuralCohort?.meanNetProfit ?? null,

    cohortMedianNetProfit:
      structuralCohort?.medianNetProfit ?? null,

    cohortPositiveNetProfit:
      structuralCohort?.positiveNetProfit ?? 0,

    cohortNegativeNetProfit:
      structuralCohort?.negativeNetProfit ?? 0,
  };
}

function main(): void {
  console.log(
    "============================================================",
  );
  console.log(
    "Binance market cohort analysis",
  );
  console.log(
    "Negative expectancy is the primary target",
  );
  console.log(
    "============================================================",
  );
  console.log();

  console.log(
    "Reading strategy results...",
  );

  const strategy =
    readJson<StrategyOutput>(
      STRATEGY_FILE,
    );

  console.log(
    "Reading Binance exchangeInfo catalogue...",
  );

  const exchangeInfo =
    readJson<ExchangeInfo>(
      EXCHANGE_INFO_FILE,
    );

  const strategyMarkets =
    getStrategyMarkets(strategy);

  console.log(
    `Strategy markets: ${strategyMarkets.length}`,
  );

  console.log(
    `Catalogue symbols: ${exchangeInfo.symbols.length}`,
  );

  console.log();

  /*
   * Create the strategy overlay keyed by symbol.
   */
  const overlaysBySymbol =
    new Map<string, StrategyOverlay>();

  for (const market of strategyMarkets) {
    if (
      overlaysBySymbol.has(
        market.symbol,
      )
    ) {
      throw new Error(
        `Duplicate strategy symbol: ${market.symbol}`,
      );
    }

    overlaysBySymbol.set(
      market.symbol,
      createOverlay(market),
    );
  }

  /*
   * Build the complete Binance catalogue.
   *
   * Every one of the 3,699 symbols is retained, even if it has no
   * strategy result. This gives us the denominator needed to tell
   * genuine Binance cohorts from accidental groups.
   */
  console.log(
    "Building complete Binance catalogue...",
  );

  const catalogueMarkets:
    CatalogueMarket[] = [];

  for (
    let apiPosition = 0;
    apiPosition <
    exchangeInfo.symbols.length;
    apiPosition += 1
  ) {
    const symbol =
      exchangeInfo.symbols[apiPosition];

    catalogueMarkets.push(
      buildCatalogueMarket(
        symbol,
        apiPosition,
        overlaysBySymbol.get(
          symbol.symbol,
        ) ?? null,
      ),
    );
  }

  const matchedStrategyMarkets =
    catalogueMarkets.filter(
      (market) =>
        market.overlay !== null,
    );

  const matchedSymbols =
    new Set(
      matchedStrategyMarkets.map(
        (market) => market.symbol,
      ),
    );

  const unmatchedStrategyMarkets =
    strategyMarkets.filter(
      (market) =>
        !matchedSymbols.has(
          market.symbol,
        ),
    );

  console.log(
    `Matched strategy markets: ${matchedStrategyMarkets.length}`,
  );

  console.log(
    `Unmatched strategy markets: ${unmatchedStrategyMarkets.length}`,
  );

  console.log();

  /*
   * Classify the strategy markets.
   *
   * Zero is explicitly neutral.
   */
  const positiveMarkets =
    matchedStrategyMarkets.filter(
      (market) =>
        market.overlay?.profitClass ===
        "positive",
    ).length;

  const flatMarkets =
    matchedStrategyMarkets.filter(
      (market) =>
        market.overlay?.profitClass ===
        "flat",
    ).length;

  const negativeMarkets =
    matchedStrategyMarkets.filter(
      (market) =>
        market.overlay?.profitClass ===
        "negative",
    ).length;

  const profits =
    matchedStrategyMarkets.map(
      (market) =>
        market.overlay?.netProfit ?? 0,
    );

  const totalNetProfit =
    profits.reduce(
      (sum, value) => sum + value,
      0,
    );

  /*
   * Build the three cohort levels.
   */
  console.log(
    "Building exact fingerprints...",
  );

  const exactCohorts =
    buildCohorts(
      catalogueMarkets,
      (market) =>
        market.exactFingerprint,
    );

  console.log(
    "Building structural fingerprints...",
  );

  const structuralCohorts =
    buildCohorts(
      catalogueMarkets,
      (market) =>
        market.structuralFingerprint,
    );

  console.log(
    "Building precision fingerprints...",
  );

  const precisionCohorts =
    buildCohorts(
      catalogueMarkets,
      (market) =>
        market.precisionFingerprint,
    );

  /*
   * The key analysis:
   *
   * A cohort is an avoidance candidate only when:
   *
   * - it has at least two strategy markets;
   * - it contains at least one negative market;
   * - its observed strategy markets have a negative rate of at
   *   least 25%.
   *
   * We retain smaller/weaker cohorts in the complete output, but
   * this filter prevents the console's "strongest candidates"
   * section being dominated by one-market accidents.
   */
  const negativeStructuralCohorts =
    structuralCohorts
      .filter(
        (cohort) =>
          cohort.strategyCount >= 2 &&
          cohort.negativeCount > 0,
      )
      .sort((a, b) => {
        const negativeRateA =
          a.negativeRate ?? 0;

        const negativeRateB =
          b.negativeRate ?? 0;

        if (
          negativeRateB !==
          negativeRateA
        ) {
          return (
            negativeRateB -
            negativeRateA
          );
        }

        if (
          b.negativeNetProfit !==
          a.negativeNetProfit
        ) {
          return (
            a.negativeNetProfit -
            b.negativeNetProfit
          );
        }

        if (
          b.strategyCount !==
          a.strategyCount
        ) {
          return (
            b.strategyCount -
            a.strategyCount
          );
        }

        return (
          b.catalogueCount -
          a.catalogueCount
        );
      });

  const negativePrecisionCohorts =
    precisionCohorts
      .filter(
        (cohort) =>
          cohort.strategyCount >= 2 &&
          cohort.negativeCount > 0,
      )
      .sort((a, b) => {
        const negativeRateA =
          a.negativeRate ?? 0;

        const negativeRateB =
          b.negativeRate ?? 0;

        if (
          negativeRateB !==
          negativeRateA
        ) {
          return (
            negativeRateB -
            negativeRateA
          );
        }

        if (
          b.negativeNetProfit !==
          a.negativeNetProfit
        ) {
          return (
            a.negativeNetProfit -
            b.negativeNetProfit
          );
        }

        return (
          b.strategyCount -
          a.strategyCount
        );
      });

  /*
   * Strong avoidance candidates.
   *
   * This is deliberately stricter than merely having a negative
   * market:
   *
   *   - >= 3 strategy observations
   *   - >= 25% negative
   *   - negative total net contribution
   *
   * A cohort with three markets where one loses heavily and the
   * other two are flat can therefore appear here, which is useful
   * because those are precisely the markets we may want to avoid.
   */
  const strongestAvoidanceCandidates =
    structuralCohorts
      .filter(
        (cohort) =>
          cohort.strategyCount >= 3 &&
          (cohort.negativeRate ?? 0) >=
            0.25 &&
          cohort.negativeNetProfit < 0,
      )
      .sort((a, b) => {
        const rateA =
          a.negativeRate ?? 0;

        const rateB =
          b.negativeRate ?? 0;

        if (rateB !== rateA) {
          return rateB - rateA;
        }

        if (
          a.negativeNetProfit !==
          b.negativeNetProfit
        ) {
          return (
            a.negativeNetProfit -
            b.negativeNetProfit
          );
        }

        return (
          b.catalogueCount -
          a.catalogueCount
        );
      })
      .slice(0, 100);

  /*
   * Positive candidates are retained for comparison, but they are
   * not the primary optimisation target.
   *
   * A useful positive cohort should:
   *   - have >= 3 observations;
   *   - have zero negative observations;
   *   - have at least one positive observation.
   */
  const strongestPositiveCandidates =
    structuralCohorts
      .filter(
        (cohort) =>
          cohort.strategyCount >= 3 &&
          cohort.positiveCount > 0 &&
          cohort.negativeCount === 0,
      )
      .sort((a, b) => {
        const rateA =
          a.positiveRate ?? 0;

        const rateB =
          b.positiveRate ?? 0;

        if (rateB !== rateA) {
          return rateB - rateA;
        }

        if (
          b.totalNetProfit !==
          a.totalNetProfit
        ) {
          return (
            b.totalNetProfit -
            a.totalNetProfit
          );
        }

        return (
          b.catalogueCount -
          a.catalogueCount
        );
      })
      .slice(0, 100);

  const summary: OutputSummary = {
    generatedAt:
      new Date().toISOString(),

    catalogueSymbols:
      exchangeInfo.symbols.length,

    catalogueTradingSymbols:
      exchangeInfo.symbols.filter(
        (symbol) =>
          symbol.status === "TRADING",
      ).length,

    strategyMarkets:
      strategyMarkets.length,

    matchedStrategyMarkets:
      matchedStrategyMarkets.length,

    unmatchedStrategyMarkets:
      unmatchedStrategyMarkets.length,

    positiveMarkets,
    flatMarkets,
    negativeMarkets,

    positiveRate:
      matchedStrategyMarkets.length > 0
        ? positiveMarkets /
          matchedStrategyMarkets.length
        : 0,

    flatRate:
      matchedStrategyMarkets.length > 0
        ? flatMarkets /
          matchedStrategyMarkets.length
        : 0,

    negativeRate:
      matchedStrategyMarkets.length > 0
        ? negativeMarkets /
          matchedStrategyMarkets.length
        : 0,

    totalNetProfit,

    meanNetProfit:
      profits.length > 0
        ? mean(profits)
        : 0,

    medianNetProfit:
      profits.length > 0
        ? median(profits)
        : 0,

    exactFingerprintCount:
      exactCohorts.length,

    structuralFingerprintCount:
      structuralCohorts.length,

    precisionFingerprintCount:
      precisionCohorts.length,

    exactFingerprintsWithStrategyMarkets:
      exactCohorts.filter(
        (cohort) =>
          cohort.strategyCount > 0,
      ).length,

    structuralFingerprintsWithStrategyMarkets:
      structuralCohorts.filter(
        (cohort) =>
          cohort.strategyCount > 0,
      ).length,

    precisionFingerprintsWithStrategyMarkets:
      precisionCohorts.filter(
        (cohort) =>
          cohort.strategyCount > 0,
      ).length,

    negativeExactCohorts:
      exactCohorts.filter(
        (cohort) =>
          cohort.strategyCount >= 2 &&
          cohort.negativeCount > 0,
      ).length,

    negativeStructuralCohorts:
      negativeStructuralCohorts.length,

    negativePrecisionCohorts:
      negativePrecisionCohorts.length,
  };

  /*
   * Add structural cohort context to every strategy market.
   */
  const structuralByFingerprint =
    new Map(
      structuralCohorts.map(
        (cohort) => [
          cohort.fingerprint,
          cohort,
        ],
      ),
    );

  const strategyMarketRows =
    matchedStrategyMarkets.map(
      (market) =>
        buildStrategyMarketRow(
          market,
          structuralByFingerprint.get(
            market.structuralFingerprint,
          ),
        ),
    );

  /*
   * Profit ranking is still useful in the spreadsheet.
   */
  strategyMarketRows.sort(
    (a, b) =>
      b.netProfit - a.netProfit,
  );

  const output: AnalysisOutput = {
    summary,

    strategyMarkets:
      strategyMarketRows,

    exactCohorts,

    structuralCohorts,

    precisionCohorts,

    negativeStructuralCohorts,

    negativePrecisionCohorts,

    strongestAvoidanceCandidates,

    strongestPositiveCandidates,
  };

  /*
   * Fixed timestamp generation.
   *
   * replace() is used for the final regex because replaceAll()
   * requires a global regex.
   */
  const timestamp =
    new Date()
      .toISOString()
      .replaceAll(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");

  const jsonPath =
    path.join(
      OUTPUT_DIR,
      `binance-market-cohort-analysis-${timestamp}.json`,
    );

  const strategyCsvPath =
    path.join(
      OUTPUT_DIR,
      `binance-market-cohort-strategy-markets-${timestamp}.csv`,
    );

  const structuralCsvPath =
    path.join(
      OUTPUT_DIR,
      `binance-market-cohort-structural-${timestamp}.csv`,
    );

  const precisionCsvPath =
    path.join(
      OUTPUT_DIR,
      `binance-market-cohort-precision-${timestamp}.csv`,
    );

  const exactCsvPath =
    path.join(
      OUTPUT_DIR,
      `binance-market-cohort-exact-${timestamp}.csv`,
    );

  const avoidanceCsvPath =
    path.join(
      OUTPUT_DIR,
      `binance-market-cohort-avoidance-${timestamp}.csv`,
    );

  console.log();
  console.log(
    "Writing JSON...",
  );

  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(
      output,
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    "Writing strategy-market CSV...",
  );

  writeCsv(
    strategyCsvPath,
    strategyMarketRows.map(
      (market) => ({
        symbol: market.symbol,
        datasetGroup:
          market.datasetGroup,

        apiPosition:
          market.apiPosition,

        historicalBinanceArrayPosition:
          market.historicalBinanceArrayPosition ??
          "",

        profitClass:
          market.profitClass,

        netProfit:
          market.netProfit,

        grossProfit:
          market.grossProfit ?? "",

        fees:
          market.fees ?? "",

        returnPct:
          market.returnPct ?? "",

        signals:
          market.signals ?? "",

        accepted:
          market.accepted ?? "",

        buys:
          market.buys ?? "",

        sells:
          market.sells ?? "",

        winningPositions:
          market.winningPositions ?? "",

        losingPositions:
          market.losingPositions ?? "",

        flatPositions:
          market.flatPositions ?? "",

        winRate:
          market.winRate ?? "",

        priceMin:
          market.priceMin ?? "",

        priceMax:
          market.priceMax ?? "",

        priceTick:
          market.priceTick ?? "",

        lotMin:
          market.lotMin ?? "",

        lotMax:
          market.lotMax ?? "",

        lotStep:
          market.lotStep ?? "",

        marketLotMin:
          market.marketLotMin ?? "",

        marketLotMax:
          market.marketLotMax ?? "",

        marketLotStep:
          market.marketLotStep ?? "",

        percentBidUp:
          market.percentBidUp ?? "",

        percentBidDown:
          market.percentBidDown ?? "",

        percentAskUp:
          market.percentAskUp ?? "",

        percentAskDown:
          market.percentAskDown ?? "",

        percentAvgPriceMins:
          market.percentAvgPriceMins ?? "",

        minNotional:
          market.minNotional ?? "",

        maxNotional:
          market.maxNotional ?? "",

        baseAssetPrecision:
          market.baseAssetPrecision ?? "",

        quotePrecision:
          market.quotePrecision ?? "",

        quoteAssetPrecision:
          market.quoteAssetPrecision ?? "",

        structuralFingerprint:
          market.structuralFingerprint,

        cohortCatalogueCount:
          market.cohortCatalogueCount,

        cohortStrategyCount:
          market.cohortStrategyCount,

        cohortPositiveRate:
          market.cohortPositiveRate ?? "",

        cohortFlatRate:
          market.cohortFlatRate ?? "",

        cohortNegativeRate:
          market.cohortNegativeRate ?? "",

        cohortTotalNetProfit:
          market.cohortTotalNetProfit,

        cohortMeanNetProfit:
          market.cohortMeanNetProfit ?? "",

        cohortMedianNetProfit:
          market.cohortMedianNetProfit ?? "",

        cohortPositiveNetProfit:
          market.cohortPositiveNetProfit,

        cohortNegativeNetProfit:
          market.cohortNegativeNetProfit,
      }),
    ),
  );

  console.log(
    "Writing structural cohort CSV...",
  );

  writeCsv(
    structuralCsvPath,
    structuralCohorts.map(
      cohortToCsvRow,
    ),
  );

  console.log(
    "Writing precision cohort CSV...",
  );

  writeCsv(
    precisionCsvPath,
    precisionCohorts.map(
      cohortToCsvRow,
    ),
  );

  console.log(
    "Writing exact cohort CSV...",
  );

  writeCsv(
    exactCsvPath,
    exactCohorts.map(
      cohortToCsvRow,
    ),
  );

  console.log(
    "Writing avoidance candidates CSV...",
  );

  writeCsv(
    avoidanceCsvPath,
    strongestAvoidanceCandidates.map(
      cohortToCsvRow,
    ),
  );

  console.log();
  console.log(
    "============================================================",
  );
  console.log(
    "RESULT",
  );
  console.log(
    "============================================================",
  );

  console.log(
    `Catalogue symbols:              ${summary.catalogueSymbols}`,
  );

  console.log(
    `Trading symbols:                ${summary.catalogueTradingSymbols}`,
  );

  console.log(
    `Strategy markets:               ${summary.strategyMarkets}`,
  );

  console.log(
    `Matched strategy markets:       ${summary.matchedStrategyMarkets}`,
  );

  console.log(
    `Unmatched strategy markets:     ${summary.unmatchedStrategyMarkets}`,
  );

  console.log();

  console.log(
    `Positive:                       ${summary.positiveMarkets} (${(
      summary.positiveRate * 100
    ).toFixed(1)}%)`,
  );

  console.log(
    `Flat:                           ${summary.flatMarkets} (${(
      summary.flatRate * 100
    ).toFixed(1)}%)`,
  );

  console.log(
    `Negative:                       ${summary.negativeMarkets} (${(
      summary.negativeRate * 100
    ).toFixed(1)}%)`,
  );

  console.log();

  console.log(
    `Total net profit:               ${summary.totalNetProfit.toFixed(6)}`,
  );

  console.log(
    `Mean net profit:                ${summary.meanNetProfit.toFixed(6)}`,
  );

  console.log(
    `Median net profit:              ${summary.medianNetProfit.toFixed(6)}`,
  );

  console.log();

  console.log(
    `Exact fingerprints:             ${summary.exactFingerprintCount}`,
  );

  console.log(
    `Structural fingerprints:        ${summary.structuralFingerprintCount}`,
  );

  console.log(
    `Precision fingerprints:         ${summary.precisionFingerprintCount}`,
  );

  console.log();

  console.log(
    "------------------------------------------------------------",
  );

  console.log(
    "Strongest structural avoidance candidates",
  );

  console.log(
    "------------------------------------------------------------",
  );

  if (
    strongestAvoidanceCandidates.length ===
    0
  ) {
    console.log(
      "None met the minimum evidence threshold.",
    );
  }

  for (
    let index = 0;
    index <
      Math.min(
        20,
        strongestAvoidanceCandidates.length,
      );
    index += 1
  ) {
    const cohort =
      strongestAvoidanceCandidates[
        index
      ];

    console.log(
      `${String(index + 1).padStart(
        2,
        " ",
      )}. ` +
        `catalogue=${cohort.catalogueCount} ` +
        `strategy=${cohort.strategyCount} ` +
        `positive=${cohort.positiveCount} ` +
        `flat=${cohort.flatCount} ` +
        `negative=${cohort.negativeCount} ` +
        `negativeRate=${(
          (cohort.negativeRate ?? 0) *
          100
        ).toFixed(1)}% ` +
        `net=${cohort.totalNetProfit.toFixed(
          4,
        )} ` +
        `negativeNet=${cohort.negativeNetProfit.toFixed(
          4,
        )}`,
    );

    console.log(
      `    ${cohort.strategySymbols.join(
        ", ",
      )}`,
    );

    console.log(
      `    catalogue positions: ${cohort.apiPositionMin}-${cohort.apiPositionMax} ` +
        `(largest run ${cohort.largestContiguousRun})`,
    );
  }

  console.log();

  console.log(
    "------------------------------------------------------------",
  );

  console.log(
    "Strongest positive structural candidates",
  );

  console.log(
    "------------------------------------------------------------",
  );

  if (
    strongestPositiveCandidates.length ===
    0
  ) {
    console.log(
      "None met the minimum evidence threshold.",
    );
  }

  for (
    let index = 0;
    index <
      Math.min(
        20,
        strongestPositiveCandidates.length,
      );
    index += 1
  ) {
    const cohort =
      strongestPositiveCandidates[
        index
      ];

    console.log(
      `${String(index + 1).padStart(
        2,
        " ",
      )}. ` +
        `catalogue=${cohort.catalogueCount} ` +
        `strategy=${cohort.strategyCount} ` +
        `positive=${cohort.positiveCount} ` +
        `flat=${cohort.flatCount} ` +
        `negative=${cohort.negativeCount} ` +
        `positiveRate=${(
          (cohort.positiveRate ?? 0) *
          100
        ).toFixed(1)}% ` +
        `net=${cohort.totalNetProfit.toFixed(
          4,
        )}`,
    );

    console.log(
      `    ${cohort.strategySymbols.join(
        ", ",
      )}`,
    );

    console.log(
      `    catalogue positions: ${cohort.apiPositionMin}-${cohort.apiPositionMax} ` +
        `(largest run ${cohort.largestContiguousRun})`,
    );
  }

  console.log();

  console.log(
    `JSON:       ${jsonPath}`,
  );

  console.log(
    `Strategy:   ${strategyCsvPath}`,
  );

  console.log(
    `Structural: ${structuralCsvPath}`,
  );

  console.log(
    `Precision:  ${precisionCsvPath}`,
  );

  console.log(
    `Exact:      ${exactCsvPath}`,
  );

  console.log(
    `Avoidance:  ${avoidanceCsvPath}`,
  );

  console.log();
}

main();