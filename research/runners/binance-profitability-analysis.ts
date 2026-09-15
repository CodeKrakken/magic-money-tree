import fs from "node:fs";
import path from "node:path";

interface StrategyMarket {
  symbol: string;
  datasetGroup?: string;
  marketIndex?: number;
  binanceArrayPosition?: number;
  binance?: BinanceSymbol;
  signals?: number;
  accepted?: number;
  rejectedByCapacity?: number;
  buys?: number;
  sells?: number;
  winningPositions?: number;
  losingPositions?: number;
  flatPositions?: number;
  winRate?: number;
  grossProfit?: number;
  fees?: number;
  netProfit: number;
  returnPct?: number;
  totalBuyNotional?: number;
  totalSellNotional?: number;
  target1PctCount?: number;
  target2PctCount?: number;
  target4PctCount?: number;
  stopCount?: number;
  maxHoldCount?: number;
  endOfDataCount?: number;
  averageHoldMinutes?: number;
  medianHoldMinutes?: number;
  averageProfitPerAcceptedPosition?: number;
  averageSlope20?: number;
  averageAcceleration?: number;
}

interface StrategyGroup {
  markets: StrategyMarket[];
  [key: string]: unknown;
}

interface StrategyFile {
  sample?: StrategyGroup;
  outOfSample?: StrategyGroup;
  [key: string]: unknown;
}

interface BinanceFilter {
  filterType?: string;
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
  baseCommissionPrecision?: number;
  quoteCommissionPrecision?: number;
  orderTypes?: string[];
  icebergAllowed?: boolean;
  ocoAllowed?: boolean;
  otoAllowed?: boolean;
  opoAllowed?: boolean;
  quoteOrderQtyMarketAllowed?: boolean;
  allowTrailingStop?: boolean;
  cancelReplaceAllowed?: boolean;
  amendAllowed?: boolean;
  pegInstructionsAllowed?: boolean;
  isSpotTradingAllowed?: boolean;
  isMarginTradingAllowed?: boolean;
  filters?: BinanceFilter[];
  permissions?: string[];
  permissionSets?: string[][];
  defaultSelfTradePreventionMode?: string;
  allowedSelfTradePreventionModes?: string[];
  [key: string]: unknown;
}

interface ExchangeInfo {
  symbols: BinanceSymbol[];
  [key: string]: unknown;
}

interface Market {
  symbol: string;
  apiPosition: number;
  datasetGroup: string;
  netProfit: number;
  returnPct: number | null;
  winner: boolean;
  winningPositions: number;
  losingPositions: number;
  metadata: Record<string, unknown>;
}

interface NumericObservation {
  value: number;
  netProfit: number;
  winner: boolean;
  position: number;
}

interface NumericAnalysis {
  field: string;
  availableMarkets: number;
  uniqueValues: number;
  winnerCount: number;
  loserCount: number;
  winnerMean: number | null;
  loserMean: number | null;
  winnerMedian: number | null;
  loserMedian: number | null;
  winnerMeanNetProfit: number | null;
  loserMeanNetProfit: number | null;
  pearsonVsNetProfit: number | null;
  spearmanVsNetProfit: number | null;
  pearsonVsWinner: number | null;
  spearmanVsWinner: number | null;
  adjacentMonotonicity: number | null;
}

interface ValueGroup {
  value: string;
  numericValue: number | null;
  count: number;
  winners: number;
  losers: number;
  winnerRate: number;
  meanNetProfit: number;
  medianNetProfit: number;
  meanPosition: number;
  minPosition: number;
  maxPosition: number;
  markets: string[];
}

interface CategoricalAnalysis {
  field: string;
  availableMarkets: number;
  uniqueValues: number;
  groups: ValueGroup[];
}

interface ProfitabilityBand {
  rankFrom: number;
  rankTo: number;
  markets: number;
  winners: number;
  losers: number;
  winnerRate: number;
  meanNetProfit: number;
  medianNetProfit: number;
  minNetProfit: number;
  maxNetProfit: number;
  symbols: string[];
}

interface CombinationGroup {
  key: string;
  count: number;
  winners: number;
  losers: number;
  winnerRate: number;
  meanNetProfit: number;
  medianNetProfit: number;
  meanPosition: number;
  markets: string[];
}

const ROOT = path.resolve(process.cwd());

const STRATEGY_FILE = path.join(
  ROOT,
  "research",
  "output",
  "market-strategy-ranking-independent-1789232701426.json",
);

const EXCHANGE_INFO_FILE = path.join(
  ROOT,
  "research",
  "output",
  "binance-exchange-info-20260915T122749Z.json",
);

const OUTPUT_DIR = path.join(ROOT, "research", "output");

const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");

const OUTPUT_JSON = path.join(
  OUTPUT_DIR,
  `binance-profitability-analysis-${timestamp}.json`,
);

const OUTPUT_CSV = path.join(
  OUTPUT_DIR,
  `binance-profitability-analysis-${timestamp}.csv`,
);

const OUTPUT_GROUPS_CSV = path.join(
  OUTPUT_DIR,
  `binance-profitability-groups-${timestamp}.csv`,
);

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function pearson(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 2) {
    return null;
  }

  const meanX = mean(x);
  const meanY = mean(y);

  if (meanX === null || meanY === null) {
    return null;
  }

  let numerator = 0;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;

    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }

  const denominator = Math.sqrt(sumX * sumY);

  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function ranks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({
    value,
    index,
  }));

  indexed.sort((a, b) => a.value - b.value);

  const result = new Array<number>(values.length);

  let start = 0;

  while (start < indexed.length) {
    let end = start + 1;

    while (
      end < indexed.length &&
      indexed[end].value === indexed[start].value
    ) {
      end += 1;
    }

    const averageRank = (start + 1 + end) / 2;

    for (let index = start; index < end; index += 1) {
      result[indexed[index].index] = averageRank;
    }

    start = end;
  }

  return result;
}

function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 2) {
    return null;
  }

  return pearson(ranks(x), ranks(y));
}

function adjacentMonotonicity(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }

  let positive = 0;
  let negative = 0;

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === values[index - 1]) {
      continue;
    }

    if (values[index] > values[index - 1]) {
      positive += 1;
    } else {
      negative += 1;
    }
  }

  const comparisons = positive + negative;

  if (comparisons === 0) {
    return null;
  }

  return Math.max(positive, negative) / comparisons;
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return String(numeric);
    }

    return value;
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return JSON.stringify(value);
}

function flattenBinanceMetadata(
  symbol: BinanceSymbol,
  apiPosition: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    apiPosition,
    symbol: symbol.symbol,
    status: symbol.status ?? null,
    baseAsset: symbol.baseAsset ?? null,
    quoteAsset: symbol.quoteAsset ?? null,
    baseAssetPrecision: symbol.baseAssetPrecision ?? null,
    quotePrecision: symbol.quotePrecision ?? null,
    quoteAssetPrecision: symbol.quoteAssetPrecision ?? null,
    baseCommissionPrecision: symbol.baseCommissionPrecision ?? null,
    quoteCommissionPrecision: symbol.quoteCommissionPrecision ?? null,
    icebergAllowed: symbol.icebergAllowed ?? null,
    ocoAllowed: symbol.ocoAllowed ?? null,
    otoAllowed: symbol.otoAllowed ?? null,
    opoAllowed: symbol.opoAllowed ?? null,
    quoteOrderQtyMarketAllowed:
      symbol.quoteOrderQtyMarketAllowed ?? null,
    allowTrailingStop: symbol.allowTrailingStop ?? null,
    cancelReplaceAllowed: symbol.cancelReplaceAllowed ?? null,
    amendAllowed: symbol.amendAllowed ?? null,
    pegInstructionsAllowed: symbol.pegInstructionsAllowed ?? null,
    isSpotTradingAllowed: symbol.isSpotTradingAllowed ?? null,
    isMarginTradingAllowed: symbol.isMarginTradingAllowed ?? null,
    defaultSelfTradePreventionMode:
      symbol.defaultSelfTradePreventionMode ?? null,
  };

  if (Array.isArray(symbol.orderTypes)) {
    result.orderTypes = symbol.orderTypes.join("|");
  }

  if (Array.isArray(symbol.permissions)) {
    result.permissions = symbol.permissions.join("|");
  }

  if (Array.isArray(symbol.permissionSets)) {
    result.permissionSets = JSON.stringify(symbol.permissionSets);
  }

  if (Array.isArray(symbol.allowedSelfTradePreventionModes)) {
    result.allowedSelfTradePreventionModes =
      symbol.allowedSelfTradePreventionModes.join("|");
  }

  if (Array.isArray(symbol.filters)) {
    for (const filter of symbol.filters) {
      const filterType = filter.filterType;

      if (!filterType) {
        continue;
      }

      for (const [key, value] of Object.entries(filter)) {
        if (key === "filterType") {
          continue;
        }

        result[`filters.${filterType}.${key}`] = value;
      }
    }
  }

  return result;
}

function extractMarkets(strategy: StrategyFile): StrategyMarket[] {
  const markets: StrategyMarket[] = [];

  if (Array.isArray(strategy.sample?.markets)) {
    markets.push(...strategy.sample.markets);
  }

  if (Array.isArray(strategy.outOfSample?.markets)) {
    markets.push(...strategy.outOfSample.markets);
  }

  if (markets.length === 0) {
    throw new Error(
      "Could not find sample.markets or outOfSample.markets in the strategy ranking file.",
    );
  }

  return markets;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function writeCsv(
  file: string,
  rows: Record<string, unknown>[],
  columns: string[],
): void {
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvEscape(row[column])).join(","),
    ),
  ];

  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function buildMarkets(
  strategyMarkets: StrategyMarket[],
  exchangeInfo: ExchangeInfo,
): Market[] {
  const metadataBySymbol = new Map<string, Record<string, unknown>>();

  exchangeInfo.symbols.forEach((symbol, index) => {
    metadataBySymbol.set(
      symbol.symbol,
      flattenBinanceMetadata(symbol, index + 1),
    );
  });

  const markets: Market[] = [];

  for (const strategyMarket of strategyMarkets) {
    const metadata = metadataBySymbol.get(strategyMarket.symbol);

    if (!metadata) {
      throw new Error(
        `Strategy market ${strategyMarket.symbol} is missing from the saved exchangeInfo snapshot.`,
      );
    }

    const apiPosition = Number(metadata.apiPosition);

    markets.push({
      symbol: strategyMarket.symbol,
      apiPosition,
      datasetGroup: strategyMarket.datasetGroup ?? "Unknown",
      netProfit: strategyMarket.netProfit,
      returnPct:
        typeof strategyMarket.returnPct === "number"
          ? strategyMarket.returnPct
          : null,
      winner: strategyMarket.netProfit > 0,
      winningPositions: strategyMarket.winningPositions ?? 0,
      losingPositions: strategyMarket.losingPositions ?? 0,
      metadata,
    });
  }

  return markets;
}

function buildNumericAnalyses(
  markets: Market[],
): NumericAnalysis[] {
  const observationsByField =
    new Map<string, NumericObservation[]>();

  for (const market of markets) {
    for (const [field, rawValue] of Object.entries(
      market.metadata,
    )) {
      if (field === "apiPosition") {
        continue;
      }

      const value = normaliseNumber(rawValue);

      if (value === null) {
        continue;
      }

      const observations =
        observationsByField.get(field) ?? [];

      observations.push({
        value,
        netProfit: market.netProfit,
        winner: market.winner,
        position: market.apiPosition,
      });

      observationsByField.set(field, observations);
    }
  }

  const analyses: NumericAnalysis[] = [];

  for (const [field, observations] of observationsByField) {
    const values = observations.map(
      (observation) => observation.value,
    );

    const profits = observations.map(
      (observation) => observation.netProfit,
    );

    const winnerBinary = observations.map((observation) =>
      observation.winner ? 1 : 0,
    );

    const winnerValues = observations
      .filter((observation) => observation.winner)
      .map((observation) => observation.value);

    const loserValues = observations
      .filter((observation) => !observation.winner)
      .map((observation) => observation.value);

    const winnerProfits = observations
      .filter((observation) => observation.winner)
      .map((observation) => observation.netProfit);

    const loserProfits = observations
      .filter((observation) => !observation.winner)
      .map((observation) => observation.netProfit);

    const ordered = [...observations].sort(
      (a, b) => a.position - b.position,
    );

    analyses.push({
      field,
      availableMarkets: observations.length,
      uniqueValues: new Set(values).size,
      winnerCount: winnerValues.length,
      loserCount: loserValues.length,
      winnerMean: mean(winnerValues),
      loserMean: mean(loserValues),
      winnerMedian: median(winnerValues),
      loserMedian: median(loserValues),
      winnerMeanNetProfit: mean(winnerProfits),
      loserMeanNetProfit: mean(loserProfits),
      pearsonVsNetProfit: pearson(values, profits),
      spearmanVsNetProfit: spearman(values, profits),
      pearsonVsWinner: pearson(values, winnerBinary),
      spearmanVsWinner: spearman(values, winnerBinary),
      adjacentMonotonicity: adjacentMonotonicity(
        ordered.map((observation) => observation.value),
      ),
    });
  }

  analyses.sort((a, b) => {
    const scoreA = Math.abs(a.spearmanVsNetProfit ?? 0);
    const scoreB = Math.abs(b.spearmanVsNetProfit ?? 0);

    return scoreB - scoreA;
  });

  return analyses;
}

function buildCategoricalAnalyses(
  markets: Market[],
): CategoricalAnalysis[] {
  const fields = new Set<string>();

  for (const market of markets) {
    for (const field of Object.keys(market.metadata)) {
      fields.add(field);
    }
  }

  const analyses: CategoricalAnalysis[] = [];

  for (const field of fields) {
    const groups = new Map<string, Market[]>();

    for (const market of markets) {
      const value = normaliseValue(
        market.metadata[field],
      );

      if (value === "") {
        continue;
      }

      const members = groups.get(value) ?? [];
      members.push(market);
      groups.set(value, members);
    }

    if (groups.size <= 1) {
      continue;
    }

    const resultGroups: ValueGroup[] = [];

    for (const [value, members] of groups) {
      const profits = members.map(
        (member) => member.netProfit,
      );

      const winners = members.filter(
        (member) => member.winner,
      ).length;

      const positions = members.map(
        (member) => member.apiPosition,
      );

      resultGroups.push({
        value,
        numericValue: normaliseNumber(value),
        count: members.length,
        winners,
        losers: members.length - winners,
        winnerRate: winners / members.length,
        meanNetProfit: mean(profits) ?? 0,
        medianNetProfit: median(profits) ?? 0,
        meanPosition: mean(positions) ?? 0,
        minPosition: Math.min(...positions),
        maxPosition: Math.max(...positions),
        markets: members.map((member) => member.symbol),
      });
    }

    resultGroups.sort(
      (a, b) => b.meanNetProfit - a.meanNetProfit,
    );

    analyses.push({
      field,
      availableMarkets: resultGroups.reduce(
        (sum, group) => sum + group.count,
        0,
      ),
      uniqueValues: resultGroups.length,
      groups: resultGroups,
    });
  }

  analyses.sort((a, b) => {
    const spreadA =
      Math.max(
        ...a.groups.map((group) => group.meanNetProfit),
      ) -
      Math.min(
        ...a.groups.map((group) => group.meanNetProfit),
      );

    const spreadB =
      Math.max(
        ...b.groups.map((group) => group.meanNetProfit),
      ) -
      Math.min(
        ...b.groups.map((group) => group.meanNetProfit),
      );

    return spreadB - spreadA;
  });

  return analyses;
}

function buildProfitabilityBands(
  markets: Market[],
): ProfitabilityBand[] {
  const sorted = [...markets].sort(
    (a, b) => b.netProfit - a.netProfit,
  );

  const bands: ProfitabilityBand[] = [];
  const bandSize = 20;

  for (
    let start = 0;
    start < sorted.length;
    start += bandSize
  ) {
    const members = sorted.slice(start, start + bandSize);
    const profits = members.map(
      (member) => member.netProfit,
    );

    const winners = members.filter(
      (member) => member.winner,
    ).length;

    bands.push({
      rankFrom: start + 1,
      rankTo: start + members.length,
      markets: members.length,
      winners,
      losers: members.length - winners,
      winnerRate: winners / members.length,
      meanNetProfit: mean(profits) ?? 0,
      medianNetProfit: median(profits) ?? 0,
      minNetProfit: Math.min(...profits),
      maxNetProfit: Math.max(...profits),
      symbols: members.map((member) => member.symbol),
    });
  }

  return bands;
}

function buildCombinationGroups(
  markets: Market[],
  fields: string[],
): CombinationGroup[] {
  const groups = new Map<string, Market[]>();

  for (const market of markets) {
    const values = fields.map((field) =>
      normaliseValue(market.metadata[field]),
    );

    if (values.some((value) => value === "")) {
      continue;
    }

    const key = values.join(" | ");
    const members = groups.get(key) ?? [];

    members.push(market);
    groups.set(key, members);
  }

  return [...groups.entries()]
    .map(([key, members]) => {
      const profits = members.map(
        (member) => member.netProfit,
      );

      const winners = members.filter(
        (member) => member.winner,
      ).length;

      return {
        key,
        count: members.length,
        winners,
        losers: members.length - winners,
        winnerRate: winners / members.length,
        meanNetProfit: mean(profits) ?? 0,
        medianNetProfit: median(profits) ?? 0,
        meanPosition:
          mean(
            members.map(
              (member) => member.apiPosition,
            ),
          ) ?? 0,
        markets: members.map((member) => member.symbol),
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return b.meanNetProfit - a.meanNetProfit;
    });
}

function buildMarketRows(
  markets: Market[],
): Record<string, unknown>[] {
  return markets.map((market) => ({
    symbol: market.symbol,
    datasetGroup: market.datasetGroup,
    apiPosition: market.apiPosition,
    netProfit: market.netProfit,
    returnPct: market.returnPct,
    winner: market.winner,
    winningPositions: market.winningPositions,
    losingPositions: market.losingPositions,
    ...market.metadata,
  }));
}

function main(): void {
  console.log("=".repeat(72));
  console.log("Binance profitability analysis");
  console.log("=".repeat(72));

  console.log(`Strategy file:     ${STRATEGY_FILE}`);
  console.log(`ExchangeInfo file: ${EXCHANGE_INFO_FILE}`);

  if (!fs.existsSync(STRATEGY_FILE)) {
    throw new Error(`Missing strategy file: ${STRATEGY_FILE}`);
  }

  if (!fs.existsSync(EXCHANGE_INFO_FILE)) {
    throw new Error(
      `Missing exchangeInfo file: ${EXCHANGE_INFO_FILE}`,
    );
  }

  const strategy = readJson<StrategyFile>(STRATEGY_FILE);
  const exchangeInfo =
    readJson<ExchangeInfo>(EXCHANGE_INFO_FILE);

  const strategyMarkets = extractMarkets(strategy);

  console.log(
    `Strategy markets:  ${strategyMarkets.length}`,
  );

  console.log(
    `Exchange symbols:  ${exchangeInfo.symbols.length}`,
  );

  const sampleCount = strategy.sample?.markets?.length ?? 0;
  const oosCount =
    strategy.outOfSample?.markets?.length ?? 0;

  console.log(`Sample markets:    ${sampleCount}`);
  console.log(`OOS markets:       ${oosCount}`);

  const markets = buildMarkets(
    strategyMarkets,
    exchangeInfo,
  );

  if (markets.length !== strategyMarkets.length) {
    throw new Error(
      `Expected ${strategyMarkets.length} matched markets but got ${markets.length}.`,
    );
  }

  const winners = markets.filter(
    (market) => market.winner,
  );

  const losers = markets.filter(
    (market) => !market.winner,
  );

  const totalNetProfit = markets.reduce(
    (sum, market) => sum + market.netProfit,
    0,
  );

  console.log(`Matched markets:   ${markets.length}`);
  console.log(`Profitable:        ${winners.length}`);
  console.log(`Non-profitable:    ${losers.length}`);
  console.log(
    `Total net profit:  ${totalNetProfit.toFixed(6)}`,
  );

  console.log("\nAnalysing numeric Binance fields...");

  const numericAnalyses =
    buildNumericAnalyses(markets);

  console.log(
    `Numeric analyses:  ${numericAnalyses.length}`,
  );

  console.log(
    "\nTop fields by absolute Spearman correlation with netProfit:",
  );

  for (const analysis of numericAnalyses.slice(0, 20)) {
    console.log(
      `  ${analysis.field.padEnd(60)} ` +
        `rho=${(analysis.spearmanVsNetProfit ?? 0).toFixed(4)} ` +
        `winnerRho=${(analysis.spearmanVsWinner ?? 0).toFixed(4)} ` +
        `unique=${analysis.uniqueValues}`,
    );
  }

  console.log(
    "\nAnalysing categorical Binance fields...",
  );

  const categoricalAnalyses =
    buildCategoricalAnalyses(markets);

  console.log(
    `Categorical analyses: ${categoricalAnalyses.length}`,
  );

  const profitabilityBands =
    buildProfitabilityBands(markets);

  console.log("\nProfitability bands:");

  for (const band of profitabilityBands) {
    console.log(
      `  ${String(band.rankFrom).padStart(3)}-${String(
        band.rankTo,
      ).padEnd(3)} ` +
        `winnerRate=${(band.winnerRate * 100).toFixed(1)}% ` +
        `meanProfit=${band.meanNetProfit.toFixed(4)}`,
    );
  }

  /*
   * These combinations are deliberately limited.
   *
   * We are testing plausible Binance catalogue cohorts rather
   * than allowing an arbitrary combinatorial explosion across
   * every field.
   */
  const combinationDefinitions = [
    [
      "filters.LOT_SIZE.maxQty",
      "filters.LOT_SIZE.minQty",
      "filters.PRICE_FILTER.maxPrice",
    ],
    [
      "filters.LOT_SIZE.maxQty",
      "filters.PRICE_FILTER.maxPrice",
    ],
    [
      "filters.LOT_SIZE.maxQty",
      "filters.PERCENT_PRICE_BY_SIDE.askMultiplierDown",
    ],
    [
      "filters.LOT_SIZE.minQty",
      "filters.PRICE_FILTER.maxPrice",
    ],
  ];

  const combinations = combinationDefinitions.map(
    (fields) => ({
      fields,
      groups: buildCombinationGroups(
        markets,
        fields,
      ),
    }),
  );

  const marketRows = buildMarketRows(markets);

  const csvColumns = [
    ...new Set(
      marketRows.flatMap((row) =>
        Object.keys(row),
      ),
    ),
  ];

  writeCsv(
    OUTPUT_CSV,
    marketRows,
    csvColumns,
  );

  const groupRows: Record<string, unknown>[] = [];

  for (const analysis of categoricalAnalyses) {
    for (const group of analysis.groups) {
      groupRows.push({
        field: analysis.field,
        value: group.value,
        numericValue: group.numericValue,
        count: group.count,
        winners: group.winners,
        losers: group.losers,
        winnerRate: group.winnerRate,
        meanNetProfit: group.meanNetProfit,
        medianNetProfit: group.medianNetProfit,
        meanPosition: group.meanPosition,
        minPosition: group.minPosition,
        maxPosition: group.maxPosition,
        markets: group.markets.join("|"),
      });
    }
  }

  writeCsv(
    OUTPUT_GROUPS_CSV,
    groupRows,
    [
      "field",
      "value",
      "numericValue",
      "count",
      "winners",
      "losers",
      "winnerRate",
      "meanNetProfit",
      "medianNetProfit",
      "meanPosition",
      "minPosition",
      "maxPosition",
      "markets",
    ],
  );

  const output = {
    generatedAt: new Date().toISOString(),

    experiment:
      "binance_metadata_profitability_analysis",

    objective:
      "Identify Binance exchange metadata characteristics associated with market-level strategy profitability.",

    methodology: {
      profitabilityTarget:
        "market netProfit",

      winnerDefinition:
        "netProfit > 0",

      nonProfitDefinition:
        "netProfit <= 0",

      sampleVsOosUsedAsPrimaryVariable: false,

      apiPositionDefinition:
        "1-based position in the exact saved exchangeInfo.symbols[] response",

      metadataSource:
        "saved Binance exchangeInfo snapshot",

      profitabilitySource:
        "market-strategy-ranking-independent-1789232701426.json",

      numericAnalysis: [
        "Pearson correlation with netProfit",
        "Spearman correlation with netProfit",
        "Pearson correlation with binary winner status",
        "Spearman correlation with binary winner status",
        "winner and loser value distributions",
        "adjacent API-position monotonicity",
      ],

      categoricalAnalysis: [
        "group count",
        "winner count",
        "loser count",
        "winner rate",
        "mean netProfit",
        "median netProfit",
        "mean API position",
        "position range",
      ],

      numericNormalisation:
        "Numeric strings are converted to numbers before grouping, so formatting-only differences are ignored.",
    },

    sourceFiles: {
      strategy: STRATEGY_FILE,
      exchangeInfo: EXCHANGE_INFO_FILE,
    },

    population: {
      exchangeInfoSymbolCount:
        exchangeInfo.symbols.length,

      strategyMarketCount:
        strategyMarkets.length,

      matchedMarketCount:
        markets.length,

      profitableMarketCount:
        winners.length,

      nonProfitableMarketCount:
        losers.length,

      profitableMarketRate:
        markets.length > 0
          ? winners.length / markets.length
          : null,

      totalNetProfit,

      meanNetProfit:
        mean(
          markets.map(
            (market) => market.netProfit,
          ),
        ),

      medianNetProfit:
        median(
          markets.map(
            (market) => market.netProfit,
          ),
        ),

      meanWinnerNetProfit:
        mean(
          winners.map(
            (market) => market.netProfit,
          ),
        ),

      meanLoserNetProfit:
        mean(
          losers.map(
            (market) => market.netProfit,
          ),
        ),
    },

    datasetGroups: {
      sample: sampleCount,
      outOfSample: oosCount,
    },

    profitabilityBands,

    numericAnalyses,

    categoricalAnalyses,

    combinations,

    markets: marketRows,

    outputFiles: {
      marketCsv: OUTPUT_CSV,
      groupCsv: OUTPUT_GROUPS_CSV,
    },
  };

  fs.writeFileSync(
    OUTPUT_JSON,
    JSON.stringify(output, null, 2),
  );

  console.log("\n" + "=".repeat(72));
  console.log("Complete");
  console.log("=".repeat(72));
  console.log(`JSON:   ${OUTPUT_JSON}`);
  console.log(`CSV:    ${OUTPUT_CSV}`);
  console.log(`Groups: ${OUTPUT_GROUPS_CSV}`);
}

main();
