import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  stat,
  writeFile,
  readFile,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// ============================================================
// CONFIGURATION
// ============================================================

const ROOT = process.cwd();

const DATA_ROOT = join(
  ROOT,
  "research",
  "data",
  "binance",
);

const OUTPUT_ROOT = join(
  ROOT,
  "research",
  "output",
);

const BINANCE_API =
  "https://data-api.binance.vision";

const BINANCE_ARCHIVE =
  "https://data.binance.vision/data/spot/monthly/klines";

const HISTORICAL_MONTHS = [
  "2025-12",
  "2026-01",
  "2026-03",
  "2026-05",
  "2026-07",
  "2026-08",
];

const HISTORICAL_MONTH_SET =
  new Set(HISTORICAL_MONTHS);

// ------------------------------------------------------------
// Parameter sweep
// ------------------------------------------------------------

const HOLDING_PERIOD_HOURS = [
  1,
  3,
  6,
  12,
  24,
  48,
  72,
] as const;

const PROFIT_TARGETS = [
  0.02,
  0.04,
  0.06,
  0.08,
  0.10,
  0.12,
] as const;

const STOP_LOSSES = [
  0.05,
  0.08,
  0.10,
  0.12,
  0.15,
] as const;

const SLOPE_LOOKBACKS = [
  10,
  15,
  20,
  30,
  40,
] as const;

const SLOPE_THRESHOLD_MULTIPLIERS = [
  0.75,
  0.90,
  1.00,
  1.10,
  1.25,
  1.50,
] as const;

const CURRENT_SLOPE_THRESHOLD =
  -0.0001425851160546487;

const SLOPE_THRESHOLDS =
  SLOPE_THRESHOLD_MULTIPLIERS.map(
    (multiplier) =>
      CURRENT_SLOPE_THRESHOLD *
      multiplier,
  );

const ACCELERATION_THRESHOLD_MULTIPLIERS = [
  0.75,
  0.90,
  1.00,
  1.10,
  1.25,
  1.50,
] as const;

const CURRENT_ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const ACCELERATION_THRESHOLDS =
  ACCELERATION_THRESHOLD_MULTIPLIERS.map(
    (multiplier) =>
      CURRENT_ACCELERATION_THRESHOLD *
      multiplier,
  );

const MAX_CONCURRENT_POSITIONS = [
  10,
  20,
  30,
  43,
  50,
  60,
] as const;

// ------------------------------------------------------------
// Fixed strategy assumptions
// ------------------------------------------------------------

const ENTRY_FEE = 0.001;
const EXIT_FEE = 0.001;
const EXECUTION_COST = 0;
const SALE_FRACTION = 1;

const STARTING_CAPITAL = 100;
const MIN_POSITION_NOTIONAL = 10;
const MAX_POSITION_FRACTION = 0.05;

const DOWNLOAD_CONCURRENCY = 4;

// ============================================================
// TYPES
// ============================================================

interface ExchangeSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  baseCommissionPrecision: number;
  quoteCommissionPrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  otoAllowed: boolean;
  opoAllowed: boolean;
  quoteOrderQtyMarketAllowed: boolean;
  allowTrailingStop: boolean;
  cancelReplaceAllowed: boolean;
  amendAllowed: boolean;
  pegInstructionsAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  filters: unknown[];
  permissions: string[];
  permissionSets: string[][];
  defaultSelfTradePreventionMode: string;
  allowedSelfTradePreventionModes: string[];
}

interface CandleData {
  times: Float64Array;
  opens: Float64Array;
  highs: Float64Array;
  lows: Float64Array;
  closes: Float64Array;
}

interface MarketData {
  symbol: string;
  candles: CandleData;
  slopes: Map<number, Float64Array>;
  signalIndices: Map<string, Int32Array>;
  availableTargetMonths: string[];
}

interface Position {
  symbol: string;
  entryTime: number;
  entryIndex: number;
  entryPrice: number;
  quantity: number;
  notional: number;
  entryFee: number;
}

type ExitReason =
  | "target"
  | "stop"
  | "timeout"
  | "dataset_end";

interface Trade {
  symbol: string;

  entryTime: number;
  exitTime: number;

  entryPrice: number;
  exitPrice: number;

  notional: number;
  quantity: number;

  grossValue: number;

  entryFee: number;
  exitFee: number;

  netPnl: number;
  returnFraction: number;

  holdingHours: number;

  exitReason: ExitReason;
  profitable: boolean;
}

interface StrategyParameters {
  holdingPeriodHours: number;
  profitTarget: number;
  stopLoss: number;
  slopeLookback: number;
  slopeThreshold: number;
  accelerationThreshold: number;
  maxConcurrentPositions: number;
}

interface BacktestResult {
  parameters: StrategyParameters;

  startingCapital: number;
  finalCapital: number;

  profit: number;
  returnFraction: number;

  maxDrawdownFraction: number;

  trades: number;
  winningTrades: number;
  losingTrades: number;

  successRate: number;

  targetExits: number;
  stopExits: number;
  timeoutExits: number;
  datasetEndExits: number;

  profitFactor: number;

  totalFees: number;

  averageTradeReturn: number;
  medianTradeReturn: number;

  averageHoldingHours: number;

  maximumOpenPositions: number;
  averageOpenPositions: number;

  capitalUtilisation: number;
}

interface ParameterAggregate {
  value: number;

  combinations: number;

  trades: number;
  winningTrades: number;

  successRate: number;

  totalProfit: number;
  averageReturn: number;

  averageMaxDrawdown: number;

  profitFactor: number;
}

interface DownloadResult {
  month: string;
  symbol: string;
  path: string;
  sizeBytes: number;
  status: "downloaded" | "cached" | "missing";
}

interface MissingArchive {
  month: string;
  symbol: string;
  url: string;
  status?: number;
  recordedAt: string;
}

interface ManifestEntry {
  month: string;
  symbol: string;
  url: string;
  path: string;
  sizeBytes: number;
}

interface ResearchOutput {
  generatedAt: string;

  methodology: {
    historicalMonths: string[];
    numberOfMarkets: number;

    startingCapital: number;

    entryFee: number;
    exitFee: number;

    executionCost: number;
    saleFraction: number;

    minimumPositionNotional: number;
    maximumPositionFraction: number;

    signalDefinition: string;
    thresholdDefinition: string;

    datasetEndHandling: string;
    stopPriority: string;

    overlapAllowed: boolean;

    currentMarketUniverseBias: string;

    marketAvailabilityHandling: string;
  };

  marketAvailability: {
    symbol: string;
    availableTargetMonths: string[];
  }[];

  parameterSpace: {
    holdingPeriods: number[];
    profitTargets: number[];
    stopLosses: number[];
    slopeLookbacks: number[];
    slopeThresholds: number[];
    accelerationThresholds: number[];
    maximumConcurrentPositions: number[];
  };

  totalCombinations: number;

  combinations: BacktestResult[];

  aggregates: {
    holdingPeriod: ParameterAggregate[];
    profitTarget: ParameterAggregate[];
    stopLoss: ParameterAggregate[];
    slopeLookback: ParameterAggregate[];
    slopeThreshold: ParameterAggregate[];
    accelerationThreshold: ParameterAggregate[];
    maximumConcurrentPositions: ParameterAggregate[];
  };
}

// ============================================================
// UTILS
// ============================================================

function previousMonth(
  month: string,
): string {
  const [year, monthNumber] =
    month
      .split("-")
      .map(Number);

  if (monthNumber === 1) {
    return `${year - 1}-12`;
  }

  return `${year}-${String(
    monthNumber - 1,
  ).padStart(2, "0")}`;
}

function monthFromTimestamp(
  timestamp: number,
): string {
  return new Date(
    timestamp,
  )
    .toISOString()
    .slice(0, 7);
}

function isTradingTime(
  timestamp: number,
): boolean {
  return HISTORICAL_MONTH_SET.has(
    monthFromTimestamp(timestamp),
  );
}

function median(
  values: number[],
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const middle = Math.floor(
    sorted.length / 2,
  );

  if (sorted.length % 2 === 0) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function formatPercent(
  value: number,
): string {
  return `${(
    value * 100
  ).toFixed(2)}%`;
}

function formatMoney(
  value: number,
): string {
  return `$${value.toFixed(2)}`;
}

function formatDuration(
  hours: number,
): string {
  if (hours < 1) {
    return `${(
      hours * 60
    ).toFixed(1)}m`;
  }

  return `${hours.toFixed(2)}h`;
}

function signalKey(
  lookback: number,
  slopeThreshold: number,
  accelerationThreshold: number,
): string {
  return [
    lookback,
    slopeThreshold,
    accelerationThreshold,
  ].join("|");
}

// ============================================================
// BINANCE MARKET DISCOVERY
// ============================================================

async function discoverMarkets(): Promise<ExchangeSymbol[]> {
  const response = await fetch(`${BINANCE_API}/api/v3/exchangeInfo`);

  if (!response.ok) {
    throw new Error(
      `Binance exchangeInfo failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    symbols: ExchangeSymbol[];
  };

  const markets = data.symbols
    .filter((symbol) => symbol.status === "TRADING")
    .filter((symbol) => symbol.quoteAsset === "USDT")
    .filter((symbol) => symbol.isSpotTradingAllowed)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  console.log(
    `Binance exchangeInfo returned ${data.symbols.length} symbols.`,
  );

  console.log(
    `Selected ${markets.length} current Spot USDT markets ` +
      `using API attributes only.`,
  );

  console.log(
    "No symbol-name filters or market-count cap are applied.",
  );

  return markets;
}

// ============================================================
// ZIP CACHE
// ============================================================

async function loadMissingArchives(): Promise<
  MissingArchive[]
> {
  const path = join(
    DATA_ROOT,
    "missing.json",
  );

  if (!existsSync(path)) {
    return [];
  }

  const raw =
    await readFile(
      path,
      "utf8",
    );

  const parsed: unknown =
    JSON.parse(raw);

  if (
    parsed !== null &&
    typeof parsed ===
      "object" &&
    "entries" in parsed &&
    Array.isArray(
      (
        parsed as {
          entries: unknown;
        }
      ).entries,
    )
  ) {
    return (
      parsed as {
        entries: MissingArchive[];
      }
    ).entries;
  }

  if (Array.isArray(parsed)) {
    return parsed as MissingArchive[];
  }

  if (
    parsed !== null &&
    typeof parsed ===
      "object" &&
    "missing" in parsed &&
    Array.isArray(
      (
        parsed as {
          missing: unknown;
        }
      ).missing,
    )
  ) {
    return (
      parsed as {
        missing: MissingArchive[];
      }
    ).missing;
  }

  throw new Error(
    'Invalid missing.json format: expected an array or an object containing an "entries" or "missing" array.',
  );
}

async function saveMissingArchives(
  missing: MissingArchive[],
): Promise<void> {
  await mkdir(
    DATA_ROOT,
    {
      recursive: true,
    },
  );

  await writeFile(
    join(
      DATA_ROOT,
      "missing.json",
    ),
    JSON.stringify(
      {
        generatedAt:
          new Date().toISOString(),

        source:
          "Binance official public data archive",

        entries: missing,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function buildArchiveUrl(
  month: string,
  symbol: string,
): string {
  return (
    `${BINANCE_ARCHIVE}/${symbol}/1m/` +
    `${symbol}-1m-${month}.zip`
  );
}

async function downloadArchive(
  month: string,
  symbol: string,
  missing: MissingArchive[],
): Promise<DownloadResult> {
  const monthDir = join(
    DATA_ROOT,
    month,
  );

  await mkdir(
    monthDir,
    {
      recursive: true,
    },
  );

  const filename =
    `${symbol}-1m-${month}.zip`;

  const finalPath =
    join(
      monthDir,
      filename,
    );

  if (existsSync(finalPath)) {
    const fileStat =
      await stat(
        finalPath,
      );

    if (fileStat.size > 0) {
      return {
        month,
        symbol,
        path: finalPath,
        sizeBytes:
          fileStat.size,
        status: "cached",
      };
    }
  }

  const missingEntry =
    missing.find(
      (entry) =>
        entry.month ===
          month &&
        entry.symbol ===
          symbol,
    );

  if (missingEntry) {
    return {
      month,
      symbol,
      path: finalPath,
      sizeBytes: 0,
      status: "missing",
    };
  }

  const url =
    buildArchiveUrl(
      month,
      symbol,
    );

  console.log(
    `Downloading ${month} ${symbol}`,
  );

  const response =
    await fetch(url);

  if (response.status === 404) {
    console.log(
      `  404 unavailable: ${symbol}`,
    );

    return {
      month,
      symbol,
      path: finalPath,
      sizeBytes: 0,
      status: "missing",
    };
  }

  if (!response.ok) {
    throw new Error(
      `Failed downloading ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer(),
    );

  if (buffer.length === 0) {
    throw new Error(
      `Downloaded empty archive: ${url}`,
    );
  }

  const partialPath =
    `${finalPath}.partial`;

  await writeFile(
    partialPath,
    buffer,
  );

  await rename(
    partialPath,
    finalPath,
  );

  return {
    month,
    symbol,
    path: finalPath,
    sizeBytes:
      buffer.length,
    status: "downloaded",
  };
}

async function ensureZipCache(
  markets: ExchangeSymbol[],
): Promise<Set<string>> {
  const missing =
    await loadMissingArchives();

  const required =
    new Map<
      string,
      {
        month: string;
        symbol: string;
      }
    >();

  for (
    const targetMonth of
      HISTORICAL_MONTHS
  ) {
    const months = [
      previousMonth(
        targetMonth,
      ),
      targetMonth,
    ];

    for (const month of months) {
      for (const market of markets) {
        required.set(
          `${month}:${market.symbol}`,
          {
            month,
            symbol:
              market.symbol,
          },
        );
      }
    }
  }

  const items = [
    ...required.values(),
  ];

  let nextIndex = 0;
  let completed = 0;

  const missingKeys =
    new Set<string>();

  const newlyMissing:
    MissingArchive[] = [];

  const worker =
    async (): Promise<void> => {
      while (true) {
        const index =
          nextIndex++;

        if (
          index >=
          items.length
        ) {
          return;
        }

        const item =
          items[index];

        const result =
          await downloadArchive(
            item.month,
            item.symbol,
            missing,
          );

        if (
          result.status ===
          "missing"
        ) {
          const key =
            `${item.month}:${item.symbol}`;

          missingKeys.add(
            key,
          );

          const alreadyKnown =
            missing.some(
              (entry) =>
                entry.month ===
                  item.month &&
                entry.symbol ===
                  item.symbol,
            );

          const alreadyQueued =
            newlyMissing.some(
              (entry) =>
                entry.month ===
                  item.month &&
                entry.symbol ===
                  item.symbol,
            );

          if (
            !alreadyKnown &&
            !alreadyQueued
          ) {
            newlyMissing.push({
              month:
                item.month,

              symbol:
                item.symbol,

              url:
                buildArchiveUrl(
                  item.month,
                  item.symbol,
                ),

              status: 404,

              recordedAt:
                new Date().toISOString(),
            });
          }
        }

        completed++;

        if (
          completed % 10 ===
            0 ||
          completed ===
            items.length
        ) {
          console.log(
            `Archive progress: ${completed}/${items.length}`,
          );
        }
      }
    };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          DOWNLOAD_CONCURRENCY,
          items.length,
        ),
      },
      () => worker(),
    ),
  );

  if (
    newlyMissing.length >
    0
  ) {
    const deduplicated =
      new Map<
        string,
        MissingArchive
      >();

    for (
      const entry of [
        ...missing,
        ...newlyMissing,
      ]
    ) {
      deduplicated.set(
        `${entry.month}:${entry.symbol}`,
        entry,
      );
    }

    await saveMissingArchives(
      [
        ...deduplicated.values(),
      ],
    );
  }

  return missingKeys;
}

// ============================================================
// ZIP / CSV READING
// ============================================================

async function readZipCsv(
  zipPath: string,
): Promise<CandleData> {
  const { stdout } =
    await execFileAsync(
      "unzip",
      ["-p", zipPath],
      {
        maxBuffer:
          1024 * 1024 * 1024,
      },
    );

  const lines =
    stdout
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim().length >
          0,
      );

  if (lines.length === 0) {
    throw new Error(
      `Empty archive: ${zipPath}`,
    );
  }

  const firstColumns =
    lines[0].split(",");

  const hasHeader =
    Number.isNaN(
      Number(
        firstColumns[0],
      ),
    );

  const startIndex =
    hasHeader ? 1 : 0;

  const length =
    lines.length -
    startIndex;

  const times =
    new Float64Array(
      length,
    );

  const opens =
    new Float64Array(
      length,
    );

  const highs =
    new Float64Array(
      length,
    );

  const lows =
    new Float64Array(
      length,
    );

  const closes =
    new Float64Array(
      length,
    );

  let writeIndex = 0;

  for (
    let lineIndex =
      startIndex;
    lineIndex <
      lines.length;
    lineIndex++
  ) {
    const columns =
      lines[
        lineIndex
      ].split(",");

    let timestamp =
      Number(
        columns[0],
      );

    if (
      timestamp >
      10 ** 13
    ) {
      timestamp /=
        1000;
    }

    const open =
      Number(columns[1]);

    const high =
      Number(columns[2]);

    const low =
      Number(columns[3]);

    const close =
      Number(columns[4]);

    if (
      !Number.isFinite(
        timestamp,
      ) ||
      !Number.isFinite(
        open,
      ) ||
      !Number.isFinite(
        high,
      ) ||
      !Number.isFinite(
        low,
      ) ||
      !Number.isFinite(
        close,
      )
    ) {
      continue;
    }

    times[writeIndex] =
      timestamp;

    opens[writeIndex] =
      open;

    highs[writeIndex] =
      high;

    lows[writeIndex] =
      low;

    closes[writeIndex] =
      close;

    writeIndex++;
  }

  if (
    writeIndex === length
  ) {
    return {
      times,
      opens,
      highs,
      lows,
      closes,
    };
  }

  return {
    times: times.slice(
      0,
      writeIndex,
    ),

    opens: opens.slice(
      0,
      writeIndex,
    ),

    highs: highs.slice(
      0,
      writeIndex,
    ),

    lows: lows.slice(
      0,
      writeIndex,
    ),

    closes: closes.slice(
      0,
      writeIndex,
    ),
  };
}

function combineCandles(
  parts: CandleData[],
): CandleData {
  const totalLength =
    parts.reduce(
      (total, part) =>
        total +
        part.times.length,
      0,
    );

  const times =
    new Float64Array(
      totalLength,
    );

  const opens =
    new Float64Array(
      totalLength,
    );

  const highs =
    new Float64Array(
      totalLength,
    );

  const lows =
    new Float64Array(
      totalLength,
    );

  const closes =
    new Float64Array(
      totalLength,
    );

  let offset = 0;

  for (const part of parts) {
    times.set(
      part.times,
      offset,
    );

    opens.set(
      part.opens,
      offset,
    );

    highs.set(
      part.highs,
      offset,
    );

    lows.set(
      part.lows,
      offset,
    );

    closes.set(
      part.closes,
      offset,
    );

    offset +=
      part.times.length;
  }

  return {
    times,
    opens,
    highs,
    lows,
    closes,
  };
}

// ============================================================
// REGRESSION SLOPE
// ============================================================

function buildRegressionSlopes(
  closes: Float64Array,
  window: number,
): Float64Array {
  const result =
    new Float64Array(
      closes.length,
    );

  result.fill(
    Number.NaN,
  );

  if (
    window < 2 ||
    closes.length < window
  ) {
    return result;
  }

  let sumX = 0;
  let sumXX = 0;

  for (
    let x = 0;
    x < window;
    x++
  ) {
    sumX += x;
    sumXX += x * x;
  }

  const denominator =
    window * sumXX -
    sumX * sumX;

  let sumY = 0;
  let sumXY = 0;

  for (
    let i = 0;
    i < window;
    i++
  ) {
    const y =
      closes[i];

    sumY += y;
    sumXY += i * y;
  }

  result[window - 1] =
    (
      window * sumXY -
      sumX * sumY
    ) /
    denominator;

  for (
    let end = window;
    end <
    closes.length;
    end++
  ) {
    const outgoing =
      closes[
        end - window
      ];

    const incoming =
      closes[end];

    const oldSumY =
      sumY;

    sumY =
      oldSumY -
      outgoing +
      incoming;

    sumXY =
      sumXY -
      (
        oldSumY -
        outgoing
      ) +
      incoming *
        (window - 1);

    result[end] =
      (
        window * sumXY -
        sumX * sumY
      ) /
      denominator;
  }

  return result;
}

// ============================================================
// SIGNAL PRECOMPUTATION
// ============================================================

function buildSignalIndices(
  fastSlope: Float64Array,
  slowSlope: Float64Array,
  times: Float64Array,
  slopeThreshold: number,
  accelerationThreshold: number,
): Int32Array {
  const values: number[] =
    [];

  for (
    let i = 0;
    i < fastSlope.length;
    i++
  ) {
    const timestamp =
      times[i];

    //
    // Warm-up candles are available to the
    // regression, but must never generate
    // trades.
    //
    if (
      !isTradingTime(
        timestamp,
      )
    ) {
      continue;
    }

    const fast =
      fastSlope[i];

    const slow =
      slowSlope[i];

    if (
      !Number.isFinite(
        fast,
      ) ||
      !Number.isFinite(
        slow,
      )
    ) {
      continue;
    }

    const acceleration =
      fast - slow;

    if (
      fast <=
        slopeThreshold &&
      acceleration >=
        accelerationThreshold
    ) {
      values.push(i);
    }
  }

  return Int32Array.from(
    values,
  );
}

function buildAllSignals(
  market: MarketData,
): void {
  const slowSlope =
    market.slopes.get(50);

  if (!slowSlope) {
    throw new Error(
      `Missing 50-minute slope for ${market.symbol}`,
    );
  }

  for (
    const lookback of
      SLOPE_LOOKBACKS
  ) {
    const fastSlope =
      market.slopes.get(
        lookback,
      );

    if (!fastSlope) {
      throw new Error(
        `Missing slope ${lookback} for ${market.symbol}`,
      );
    }

    for (
      const slopeThreshold of
        SLOPE_THRESHOLDS
    ) {
      for (
        const accelerationThreshold of
          ACCELERATION_THRESHOLDS
      ) {
        const key =
          signalKey(
            lookback,
            slopeThreshold,
            accelerationThreshold,
          );

        market.signalIndices.set(
          key,
          buildSignalIndices(
            fastSlope,
            slowSlope,
            market.candles
              .times,
            slopeThreshold,
            accelerationThreshold,
          ),
        );
      }
    }
  }
}

// ============================================================
// MARKET LOADING
// ============================================================

async function loadMarket(
  symbol: string,
  missingKeys: Set<string>,
): Promise<MarketData | null> {
  const parts: CandleData[] =
    [];

  const availableTargetMonths:
    string[] = [];

  //
  // Load every available target month and
  // its optional preceding warm-up month.
  //
  // A missing month does not invalidate the
  // entire market.
  //
  const monthsToLoad =
    new Set<string>();

  for (
    const targetMonth of
      HISTORICAL_MONTHS
  ) {
    monthsToLoad.add(
      previousMonth(
        targetMonth,
      ),
    );

    monthsToLoad.add(
      targetMonth,
    );
  }

  const orderedMonths =
    [...monthsToLoad].sort();

  for (
    const month of
      orderedMonths
  ) {
    const key =
      `${month}:${symbol}`;

    if (
      missingKeys.has(key)
    ) {
      continue;
    }

    const zipPath =
      join(
        DATA_ROOT,
        month,
        `${symbol}-1m-${month}.zip`,
      );

    if (
      !existsSync(zipPath)
    ) {
      continue;
    }

    const candleData =
      await readZipCsv(
        zipPath,
      );

    if (
      candleData.times.length ===
      0
    ) {
      continue;
    }

    parts.push(
      candleData,
    );

    if (
      HISTORICAL_MONTH_SET.has(
        month,
      )
    ) {
      availableTargetMonths.push(
        month,
      );
    }
  }

  //
  // A market only needs one actual target
  // month to participate in the research.
  //
  if (
    availableTargetMonths.length ===
    0
  ) {
    return null;
  }

  const combined =
    combineCandles(parts);

  const rows =
    Array.from(
      {
        length:
          combined.times.length,
      },
      (_, index) =>
        index,
    );

  rows.sort(
    (a, b) =>
      combined.times[a] -
      combined.times[b],
  );

  const uniqueTimes: number[] =
    [];

  const uniqueOpens: number[] =
    [];

  const uniqueHighs: number[] =
    [];

  const uniqueLows: number[] =
    [];

  const uniqueCloses: number[] =
    [];

  let lastTime = -1;

  for (
    const index of rows
  ) {
    const time =
      combined.times[index];

    if (
      time === lastTime
    ) {
      continue;
    }

    lastTime = time;

    uniqueTimes.push(
      time,
    );

    uniqueOpens.push(
      combined.opens[index],
    );

    uniqueHighs.push(
      combined.highs[index],
    );

    uniqueLows.push(
      combined.lows[index],
    );

    uniqueCloses.push(
      combined.closes[index],
    );
  }

  const candles: CandleData = {
    times:
      Float64Array.from(
        uniqueTimes,
      ),

    opens:
      Float64Array.from(
        uniqueOpens,
      ),

    highs:
      Float64Array.from(
        uniqueHighs,
      ),

    lows:
      Float64Array.from(
        uniqueLows,
      ),

    closes:
      Float64Array.from(
        uniqueCloses,
      ),
  };

  const market: MarketData = {
    symbol,

    candles,

    slopes:
      new Map(),

    signalIndices:
      new Map(),

    availableTargetMonths:
      [
        ...new Set(
          availableTargetMonths,
        ),
      ].sort(),
  };

  market.slopes.set(
    50,
    buildRegressionSlopes(
      candles.closes,
      50,
    ),
  );

  for (
    const lookback of
      SLOPE_LOOKBACKS
  ) {
    market.slopes.set(
      lookback,
      buildRegressionSlopes(
        candles.closes,
        lookback,
      ),
    );
  }

  buildAllSignals(
    market,
  );

  return market;
}

async function loadMarkets(
  markets: ExchangeSymbol[],
  missingKeys: Set<string>,
): Promise<MarketData[]> {
  const loaded: MarketData[] =
    [];

  for (
    let index = 0;
    index < markets.length;
    index++
  ) {
    const market =
      await loadMarket(
        markets[index].symbol,
        missingKeys,
      );

    if (market) {
      loaded.push(
        market,
      );

      console.log(
        `Market loading: ${index + 1}/${markets.length} (${loaded.length} usable) ` +
          `${market.symbol} [${market.availableTargetMonths.join(", ")}]`,
      );
    } else {
      console.log(
        `Market loading: ${index + 1}/${markets.length} (${loaded.length} usable)`,
      );
    }
  }

  return loaded;
}

// ============================================================
// TIMELINE
// ============================================================

function buildGlobalTimeline(
  markets: MarketData[],
): number[] {
  const values =
    new Set<number>();

  for (
    const market of markets
  ) {
    for (
      let i = 0;
      i <
        market.candles.times.length;
      i++
    ) {
      values.add(
        market.candles.times[i],
      );
    }
  }

  return [
    ...values,
  ].sort(
    (a, b) => a - b,
  );
}

// ============================================================
// SIGNAL LOOKUP
// ============================================================

function buildSignalLookup(
  market: MarketData,
  key: string,
): Set<number> {
  const indices =
    market.signalIndices.get(
      key,
    );

  if (!indices) {
    throw new Error(
      `Missing signal array ${key} for ${market.symbol}`,
    );
  }

  const result =
    new Set<number>();

  for (
    const index of indices
  ) {
    result.add(
      market.candles.times[
        index
      ],
    );
  }

  return result;
}

// ============================================================
// BACKTEST
// ============================================================

function runBacktest(
  markets: MarketData[],
  timeline: number[],
  parameters: StrategyParameters,
): BacktestResult {
  const signalKeyValue =
    signalKey(
      parameters.slopeLookback,
      parameters.slopeThreshold,
      parameters.accelerationThreshold,
    );

  const signalTimes =
    new Map<
      string,
      Set<number>
    >();

  for (
    const market of markets
  ) {
    signalTimes.set(
      market.symbol,
      buildSignalLookup(
        market,
        signalKeyValue,
      ),
    );
  }

  const pointers =
    new Map<string, number>();

  const marketBySymbol =
    new Map<
      string,
      MarketData
    >();

  for (
    const market of markets
  ) {
    pointers.set(
      market.symbol,
      -1,
    );

    marketBySymbol.set(
      market.symbol,
      market,
    );
  }

  const positions: Position[] =
    [];

  const trades: Trade[] =
    [];

  let cash =
    STARTING_CAPITAL;

  let peakEquity =
    STARTING_CAPITAL;

  let maxDrawdown = 0;

  let totalOpenPositionSamples =
    0;

  let timelineSamples = 0;

  let maximumOpenPositions =
    0;

  let totalCapitalUtilisation =
    0;

  const closePosition = (
    position: Position,
    exitTime: number,
    exitPrice: number,
    reason: ExitReason,
  ): void => {
    const grossValue =
      position.quantity *
      exitPrice *
      SALE_FRACTION;

    const exitFee =
      grossValue *
      EXIT_FEE;

    const netValue =
      grossValue -
      exitFee -
      grossValue *
        EXECUTION_COST;

    const netPnl =
      netValue -
      position.notional -
      position.entryFee;

    const returnFraction =
      netPnl /
      position.notional;

    const holdingHours =
      (
        exitTime -
        position.entryTime
      ) /
      (60 * 60 * 1000);

    trades.push({
      symbol:
        position.symbol,

      entryTime:
        position.entryTime,

      exitTime,

      entryPrice:
        position.entryPrice,

      exitPrice,

      notional:
        position.notional,

      quantity:
        position.quantity,

      grossValue,

      entryFee:
        position.entryFee,

      exitFee,

      netPnl,

      returnFraction,

      holdingHours,

      exitReason:
        reason,

      profitable:
        netPnl > 0,
    });

    cash += netValue;
  };

  for (
    const currentTime of
      timeline
  ) {
    //
    // Advance each market to its latest
    // candle at or before currentTime.
    //
    for (
      const market of markets
    ) {
      let pointer =
        pointers.get(
          market.symbol,
        ) ?? -1;

      while (
        pointer + 1 <
          market.candles
            .times.length &&
        market.candles
          .times[
            pointer + 1
          ] <= currentTime
      ) {
        pointer++;
      }

      pointers.set(
        market.symbol,
        pointer,
      );
    }

    //
    // Exit positions first.
    //
    for (
      let positionIndex =
        positions.length - 1;
      positionIndex >= 0;
      positionIndex--
    ) {
      const position =
        positions[
          positionIndex
        ];

      const market =
        marketBySymbol.get(
          position.symbol,
        );

      if (!market) {
        continue;
      }

      const pointer =
        pointers.get(
          position.symbol,
        ) ?? -1;

      if (pointer < 0) {
        continue;
      }

      const candleTime =
        market.candles.times[
          pointer
        ];

      if (
        candleTime !==
        currentTime
      ) {
        continue;
      }

      const high =
        market.candles.highs[
          pointer
        ];

      const low =
        market.candles.lows[
          pointer
        ];

      const close =
        market.candles.closes[
          pointer
        ];

      const targetPrice =
        position.entryPrice *
        (
          1 +
          parameters.profitTarget
        );

      const stopPrice =
        position.entryPrice *
        (
          1 -
          parameters.stopLoss
        );

      const holdingHours =
        (
          currentTime -
          position.entryTime
        ) /
        (60 * 60 * 1000);

      let exitReason:
        | ExitReason
        | null = null;

      let exitPrice =
        close;

      //
      // Stop has priority if both target and
      // stop are touched during the same candle.
      //
      if (
        low <= stopPrice
      ) {
        exitReason =
          "stop";

        exitPrice =
          stopPrice;
      } else if (
        high >= targetPrice
      ) {
        exitReason =
          "target";

        exitPrice =
          targetPrice;
      } else if (
        holdingHours >=
        parameters.holdingPeriodHours
      ) {
        exitReason =
          "timeout";

        exitPrice =
          close;
      }

      if (exitReason) {
        closePosition(
          position,
          currentTime,
          exitPrice,
          exitReason,
        );

        positions.splice(
          positionIndex,
          1,
        );
      }
    }

    //
    // Mark-to-market equity before entries.
    //
    let openValue = 0;

    for (
      const position of
        positions
    ) {
      const market =
        marketBySymbol.get(
          position.symbol,
        );

      if (!market) {
        continue;
      }

      const pointer =
        pointers.get(
          position.symbol,
        ) ?? -1;

      if (pointer < 0) {
        continue;
      }

      openValue +=
        position.quantity *
        market.candles.closes[
          pointer
        ];
    }

    const equity =
      cash +
      openValue;

    if (
      equity >
      peakEquity
    ) {
      peakEquity =
        equity;
    }

    const drawdown =
      peakEquity > 0
        ? (
            peakEquity -
            equity
          ) /
          peakEquity
        : 0;

    if (
      drawdown >
      maxDrawdown
    ) {
      maxDrawdown =
        drawdown;
    }

    totalOpenPositionSamples +=
      positions.length;

    timelineSamples++;

    totalCapitalUtilisation +=
      equity > 0
        ? openValue /
          equity
        : 0;

    maximumOpenPositions =
      Math.max(
        maximumOpenPositions,
        positions.length,
      );

    //
    // Entries.
    //
    if (
      positions.length >=
      parameters.maxConcurrentPositions
    ) {
      continue;
    }

    for (
      const market of markets
    ) {
      if (
        positions.length >=
        parameters.maxConcurrentPositions
      ) {
        break;
      }

      const pointer =
        pointers.get(
          market.symbol,
        ) ?? -1;

      if (pointer < 0) {
        continue;
      }

      if (
        market.candles.times[
          pointer
        ] !== currentTime
      ) {
        continue;
      }

      const signals =
        signalTimes.get(
          market.symbol,
        );

      if (
        !signals?.has(
          currentTime,
        )
      ) {
        continue;
      }

      //
      // Size each new position from current
      // mark-to-market portfolio equity.
      //
      let currentOpenValue = 0;

      for (
        const position of
          positions
      ) {
        const positionMarket =
          marketBySymbol.get(
            position.symbol,
          );

        if (!positionMarket) {
          continue;
        }

        const positionPointer =
          pointers.get(
            position.symbol,
          ) ?? -1;

        if (
          positionPointer <
          0
        ) {
          continue;
        }

        currentOpenValue +=
          position.quantity *
          positionMarket
            .candles
            .closes[
              positionPointer
            ];
      }

      const currentEquity =
        cash +
        currentOpenValue;

      const desiredNotional =
        Math.max(
          MIN_POSITION_NOTIONAL,
          currentEquity *
            MAX_POSITION_FRACTION,
        );

      const entryPrice =
        market.candles.closes[
          pointer
        ];

      const entryFee =
        desiredNotional *
        ENTRY_FEE;

      if (
        cash <
        desiredNotional +
          entryFee
      ) {
        continue;
      }

      const quantity =
        desiredNotional /
        entryPrice;

      cash -=
        desiredNotional +
        entryFee;

      positions.push({
        symbol:
          market.symbol,

        entryTime:
          currentTime,

        entryIndex:
          pointer,

        entryPrice,

        quantity,

        notional:
          desiredNotional,

        entryFee,
      });
    }
  }

  //
  // Liquidate remaining positions at each
  // market's final available candle.
  //
  for (
    let positionIndex =
      positions.length - 1;
    positionIndex >= 0;
    positionIndex--
  ) {
    const position =
      positions[
        positionIndex
      ];

    const market =
      marketBySymbol.get(
        position.symbol,
      );

    if (!market) {
      continue;
    }

    const finalIndex =
      market.candles.times.length -
      1;

    if (finalIndex < 0) {
      continue;
    }

    closePosition(
      position,
      market.candles.times[
        finalIndex
      ],
      market.candles.closes[
        finalIndex
      ],
      "dataset_end",
    );
  }

  const finalCapital =
    cash;

  const winningTrades =
    trades.filter(
      (trade) =>
        trade.profitable,
    ).length;

  const losingTrades =
    trades.filter(
      (trade) =>
        !trade.profitable,
    ).length;

  const grossProfit =
    trades
      .filter(
        (trade) =>
          trade.netPnl > 0,
      )
      .reduce(
        (sum, trade) =>
          sum + trade.netPnl,
        0,
      );

  const grossLoss =
    Math.abs(
      trades
        .filter(
          (trade) =>
            trade.netPnl < 0,
        )
        .reduce(
          (sum, trade) =>
            sum + trade.netPnl,
          0,
        ),
    );

  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : grossProfit > 0
        ? Infinity
        : 0;

  const totalFees =
    trades.reduce(
      (sum, trade) =>
        sum +
        trade.entryFee +
        trade.exitFee,
      0,
    );

  const tradeReturns =
    trades.map(
      (trade) =>
        trade.returnFraction,
    );

  const averageTradeReturn =
    tradeReturns.length > 0
      ? tradeReturns.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        tradeReturns.length
      : 0;

  const averageHoldingHours =
    trades.length > 0
      ? trades.reduce(
          (sum, trade) =>
            sum +
            trade.holdingHours,
          0,
        ) /
        trades.length
      : 0;

  const profit =
    finalCapital -
    STARTING_CAPITAL;

  const returnFraction =
    STARTING_CAPITAL > 0
      ? profit /
        STARTING_CAPITAL
      : 0;

  return {
    parameters,

    startingCapital:
      STARTING_CAPITAL,

    finalCapital,

    profit,

    returnFraction,

    maxDrawdownFraction:
      maxDrawdown,

    trades:
      trades.length,

    winningTrades,

    losingTrades,

    successRate:
      trades.length > 0
        ? winningTrades /
          trades.length
        : 0,

    targetExits:
      trades.filter(
        (trade) =>
          trade.exitReason ===
          "target",
      ).length,

    stopExits:
      trades.filter(
        (trade) =>
          trade.exitReason ===
          "stop",
      ).length,

    timeoutExits:
      trades.filter(
        (trade) =>
          trade.exitReason ===
          "timeout",
      ).length,

    datasetEndExits:
      trades.filter(
        (trade) =>
          trade.exitReason ===
          "dataset_end",
      ).length,

    profitFactor,

    totalFees,

    averageTradeReturn,

    medianTradeReturn:
      median(
        tradeReturns,
      ),

    averageHoldingHours,

    maximumOpenPositions,

    averageOpenPositions:
      timelineSamples > 0
        ? totalOpenPositionSamples /
          timelineSamples
        : 0,

    capitalUtilisation:
      timelineSamples > 0
        ? totalCapitalUtilisation /
          timelineSamples
        : 0,
  };
}

// ============================================================
// PARAMETER GENERATION
// ============================================================

function buildParameterCombinations(): StrategyParameters[] {
  const combinations:
    StrategyParameters[] = [];

  for (
    const holdingPeriodHours of
      HOLDING_PERIOD_HOURS
  ) {
    for (
      const profitTarget of
        PROFIT_TARGETS
    ) {
      for (
        const stopLoss of
          STOP_LOSSES
      ) {
        for (
          const slopeLookback of
            SLOPE_LOOKBACKS
        ) {
          for (
            const slopeThreshold of
              SLOPE_THRESHOLDS
          ) {
            for (
              const accelerationThreshold of
                ACCELERATION_THRESHOLDS
            ) {
              for (
                const maxConcurrentPositions of
                  MAX_CONCURRENT_POSITIONS
              ) {
                combinations.push({
                  holdingPeriodHours,

                  profitTarget,

                  stopLoss,

                  slopeLookback,

                  slopeThreshold,

                  accelerationThreshold,

                  maxConcurrentPositions,
                });
              }
            }
          }
        }
      }
    }
  }

  return combinations;
}

// ============================================================
// AGGREGATION
// ============================================================

interface AggregateAccumulator {
  combinations: number;

  trades: number;
  winningTrades: number;

  totalProfit: number;

  returnSum: number;

  drawdownSum: number;

  grossProfit: number;
  grossLoss: number;
}

function createAccumulator():
  AggregateAccumulator {
  return {
    combinations: 0,

    trades: 0,
    winningTrades: 0,

    totalProfit: 0,

    returnSum: 0,

    drawdownSum: 0,

    grossProfit: 0,
    grossLoss: 0,
  };
}

function addResultToAccumulator(
  accumulator:
    AggregateAccumulator,
  result: BacktestResult,
): void {
  accumulator.combinations++;

  accumulator.trades +=
    result.trades;

  accumulator.winningTrades +=
    result.winningTrades;

  accumulator.totalProfit +=
    result.profit;

  accumulator.returnSum +=
    result.returnFraction;

  accumulator.drawdownSum +=
    result.maxDrawdownFraction;

  if (
    result.profit > 0
  ) {
    accumulator.grossProfit +=
      result.profit;
  } else {
    accumulator.grossLoss +=
      Math.abs(
        result.profit,
      );
  }
}

function finaliseAggregate(
  value: number,
  accumulator:
    AggregateAccumulator,
): ParameterAggregate {
  return {
    value,

    combinations:
      accumulator.combinations,

    trades:
      accumulator.trades,

    winningTrades:
      accumulator.winningTrades,

    successRate:
      accumulator.trades > 0
        ? accumulator.winningTrades /
          accumulator.trades
        : 0,

    totalProfit:
      accumulator.totalProfit,

    averageReturn:
      accumulator.combinations >
      0
        ? accumulator.returnSum /
          accumulator.combinations
        : 0,

    averageMaxDrawdown:
      accumulator.combinations >
      0
        ? accumulator.drawdownSum /
          accumulator.combinations
        : 0,

    profitFactor:
      accumulator.grossLoss > 0
        ? accumulator.grossProfit /
          accumulator.grossLoss
        : accumulator.grossProfit >
            0
          ? Infinity
          : 0,
  };
}

function buildAggregates(
  results: BacktestResult[],
): ResearchOutput["aggregates"] {
  function aggregate(
    values: number[],
    selector: (
      parameters:
        StrategyParameters,
    ) => number,
  ): ParameterAggregate[] {
    return values.map(
      (value) => {
        const accumulator =
          createAccumulator();

        for (
          const result of
            results
        ) {
          if (
            selector(
              result.parameters,
            ) !== value
          ) {
            continue;
          }

          addResultToAccumulator(
            accumulator,
            result,
          );
        }

        return finaliseAggregate(
          value,
          accumulator,
        );
      },
    );
  }

  return {
    holdingPeriod:
      aggregate(
        [
          ...HOLDING_PERIOD_HOURS,
        ],
        (parameters) =>
          parameters.holdingPeriodHours,
      ),

    profitTarget:
      aggregate(
        [
          ...PROFIT_TARGETS,
        ],
        (parameters) =>
          parameters.profitTarget,
      ),

    stopLoss:
      aggregate(
        [
          ...STOP_LOSSES,
        ],
        (parameters) =>
          parameters.stopLoss,
      ),

    slopeLookback:
      aggregate(
        [
          ...SLOPE_LOOKBACKS,
        ],
        (parameters) =>
          parameters.slopeLookback,
      ),

    slopeThreshold:
      aggregate(
        [
          ...SLOPE_THRESHOLDS,
        ],
        (parameters) =>
          parameters.slopeThreshold,
      ),

    accelerationThreshold:
      aggregate(
        [
          ...ACCELERATION_THRESHOLDS,
        ],
        (parameters) =>
          parameters.accelerationThreshold,
      ),

    maximumConcurrentPositions:
      aggregate(
        [
          ...MAX_CONCURRENT_POSITIONS,
        ],
        (parameters) =>
          parameters.maxConcurrentPositions,
      ),
  };
}

// ============================================================
// MANIFEST
// ============================================================

async function writeManifest(
  markets: ExchangeSymbol[],
): Promise<void> {
  const entries:
    ManifestEntry[] = [];

  const months =
    new Set<string>();

  for (
    const targetMonth of
      HISTORICAL_MONTHS
  ) {
    months.add(
      previousMonth(
        targetMonth,
      ),
    );

    months.add(
      targetMonth,
    );
  }

  for (
    const month of
      [...months].sort()
  ) {
    for (
      const market of markets
    ) {
      const path =
        join(
          DATA_ROOT,
          month,
          `${market.symbol}-1m-${month}.zip`,
        );

      if (
        !existsSync(path)
      ) {
        continue;
      }

      const fileStat =
        await stat(path);

      entries.push({
        month,

        symbol:
          market.symbol,

        url:
          buildArchiveUrl(
            month,
            market.symbol,
          ),

        path,

        sizeBytes:
          fileStat.size,
      });
    }
  }

  await writeFile(
    join(
      OUTPUT_ROOT,
      "binance-data-manifest.json",
    ),
    JSON.stringify(
      {
        generatedAt:
          new Date().toISOString(),

        entries,
      },
      null,
      2,
    ),
    "utf8",
  );
}

// ============================================================
// PROGRESS
// ============================================================

function printResultProgress(
  completed: number,
  total: number,
  startedAt: number,
): void {
  const elapsed =
    Date.now() -
    startedAt;

  const rate =
    completed /
    Math.max(
      elapsed,
      1,
    );

  const remaining =
    total -
    completed;

  const etaMs =
    rate > 0
      ? remaining /
        rate
      : 0;

  const percent =
    (
      completed /
      total
    ) *
    100;

  process.stdout.write(
    `\rBacktests: ${completed.toLocaleString()}/${total.toLocaleString()} ` +
      `(${percent.toFixed(2)}%) ` +
      `ETA ${formatDuration(
        etaMs /
          1000 /
          60 /
          60,
      )}       `,
  );
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  const startedAt =
    Date.now();

  console.log(
    "============================================================",
  );

  console.log(
    "Full historical slope/acceleration parameter sweep",
  );

  console.log(
    "============================================================",
  );

  console.log();

  console.log(
    `Historical months: ${HISTORICAL_MONTHS.join(", ")}`,
  );

  console.log(
    "Markets:           all current Binance Spot USDT markets",
  );

  console.log(
    `Starting capital:  ${formatMoney(STARTING_CAPITAL)}`,
  );

  console.log(
    `Entry fee:         ${formatPercent(ENTRY_FEE)}`,
  );

  console.log(
    `Exit fee:          ${formatPercent(EXIT_FEE)}`,
  );

  console.log(
    `Execution cost:    ${formatPercent(EXECUTION_COST)}`,
  );

  console.log(
    `Sale:              ${SALE_FRACTION * 100}%`,
  );

  const combinations =
    buildParameterCombinations();

  console.log();

  console.log(
    `Parameter combinations: ${combinations.length.toLocaleString()}`,
  );

  if (
    combinations.length !==
    226800
  ) {
    throw new Error(
      `Expected exactly 226,800 parameter combinations, got ${combinations.length}.`,
    );
  }

  await mkdir(
    OUTPUT_ROOT,
    {
      recursive: true,
    },
  );

  const markets =
    await discoverMarkets();

  if (markets.length === 0) {
    throw new Error(
      "No Binance Spot USDT markets are available.",
    );
  }

  console.log();

  console.log(
    "Ensuring historical Binance archives...",
  );

  const missingKeys =
    await ensureZipCache(
      markets,
    );

  await writeManifest(
    markets,
  );

  console.log();

  console.log(
    "Loading and preprocessing markets...",
  );

  console.log(
    "Markets may have different historical availability; missing months are skipped.",
  );

  const loadedMarkets =
    await loadMarkets(
      markets,
      missingKeys,
    );

  if (
    loadedMarkets.length ===
    0
  ) {
    throw new Error(
      "No markets could be loaded.",
    );
  }

  console.log();

  console.log(
    `Loaded ${loadedMarkets.length} of ${markets.length} eligible markets with at least one target month.`,
  );

  console.log(
    `${markets.length - loadedMarkets.length} eligible markets have no available target-month data.`,
  );

  console.log();

  console.log(
    "Historical market availability:",
  );

  for (
    const market of
      loadedMarkets
  ) {
    console.log(
      `  ${market.symbol.padEnd(16)} ${market.availableTargetMonths.join(", ")}`,
    );
  }

  console.log();

  console.log(
    "Building global historical timeline...",
  );

  const timeline =
    buildGlobalTimeline(
      loadedMarkets,
    );

  if (
    timeline.length === 0
  ) {
    throw new Error(
      "No historical candles were available.",
    );
  }

  console.log(
    `Timeline: ${timeline.length.toLocaleString()} candles`,
  );

  console.log();

  console.log(
    "Running complete parameter sweep...",
  );

  console.log(
    "The strategy is evaluated across the entire available historical dataset.",
  );

  console.log(
    "Markets participate only during target months for which historical data exists.",
  );

  const results:
    BacktestResult[] = [];

  for (
    let index = 0;
    index <
    combinations.length;
    index++
  ) {
    const parameters =
      combinations[index];

    const result =
      runBacktest(
        loadedMarkets,
        timeline,
        parameters,
      );

    results.push(
      result,
    );

    if (
      index === 0 ||
      (index + 1) % 100 ===
        0 ||
      index ===
        combinations.length - 1
    ) {
      printResultProgress(
        index + 1,
        combinations.length,
        startedAt,
      );
    }
  }

  process.stdout.write(
    "\n",
  );

  console.log();

  console.log(
    "Building parameter aggregates...",
  );

  const aggregates =
    buildAggregates(
      results,
    );

  results.sort(
    (a, b) =>
      b.finalCapital -
      a.finalCapital,
  );

  const output:
    ResearchOutput = {
    generatedAt:
      new Date().toISOString(),

    methodology: {
      historicalMonths:
        HISTORICAL_MONTHS,

      numberOfMarkets:
        loadedMarkets.length,

      startingCapital:
        STARTING_CAPITAL,

      entryFee:
        ENTRY_FEE,

      exitFee:
        EXIT_FEE,

      executionCost:
        EXECUTION_COST,

      saleFraction:
        SALE_FRACTION,

      minimumPositionNotional:
        MIN_POSITION_NOTIONAL,

      maximumPositionFraction:
        MAX_POSITION_FRACTION,

      signalDefinition:
        "Buy when the selected fast regression slope is at or below the selected slope threshold AND fast slope minus 50-minute regression slope is at or above the selected acceleration threshold.",

      thresholdDefinition:
        "Six values are generated by multiplying the current threshold magnitude by 0.75, 0.90, 1.00, 1.10, 1.25 and 1.50.",

      datasetEndHandling:
        "All remaining positions are sold at each market's final available candle.",

      stopPriority:
        "If a candle touches both stop and target, the stop is assumed to execute first.",

      overlapAllowed:
        true,

      currentMarketUniverseBias:
        "The market universe is selected from currently listed Binance Spot markets using status=TRADING, quoteAsset=USDT and isSpotTradingAllowed=true. Current-listing survivorship bias therefore remains present.",

      marketAvailabilityHandling:
        "Every current Binance Spot USDT market satisfying the API eligibility attributes is considered. Each market participates independently during whichever historical target months are available for that market. Missing target months do not exclude the market from other periods. The preceding month is used as optional regression warm-up data when available. Warm-up candles cannot generate trades.",
    },

    marketAvailability:
      loadedMarkets.map(
        (market) => ({
          symbol:
            market.symbol,

          availableTargetMonths:
            market.availableTargetMonths,
        }),
      ),

    parameterSpace: {
      holdingPeriods:
        [
          ...HOLDING_PERIOD_HOURS,
        ],

      profitTargets:
        [
          ...PROFIT_TARGETS,
        ],

      stopLosses:
        [
          ...STOP_LOSSES,
        ],

      slopeLookbacks:
        [
          ...SLOPE_LOOKBACKS,
        ],

      slopeThresholds:
        [
          ...SLOPE_THRESHOLDS,
        ],

      accelerationThresholds:
        [
          ...ACCELERATION_THRESHOLDS,
        ],

      maximumConcurrentPositions:
        [
          ...MAX_CONCURRENT_POSITIONS,
        ],
    },

    totalCombinations:
      combinations.length,

    combinations:
      results,

    aggregates,
  };

  const outputPath =
    join(
      OUTPUT_ROOT,
      `slope-acceleration-full-sweep-${Date.now()}.json`,
    );

  await writeFile(
    outputPath,
    JSON.stringify(
      output,
      null,
      2,
    ),
    "utf8",
  );

  const elapsedHours =
    (
      Date.now() -
      startedAt
    ) /
    (1000 * 60 * 60);

  console.log();

  console.log(
    "============================================================",
  );

  console.log(
    "Research complete",
  );

  console.log(
    "============================================================",
  );

  console.log(
    `Markets:       ${loadedMarkets.length}`,
  );

  console.log(
    `Combinations:  ${combinations.length.toLocaleString()}`,
  );

  console.log(
    `Elapsed:       ${elapsedHours.toFixed(2)}h`,
  );

  console.log(
    `Output:        ${outputPath}`,
  );

  console.log();

  console.log(
    "Top 10 complete parameter combinations by final capital:",
  );

  for (
    let index = 0;
    index <
    Math.min(
      10,
      results.length,
    );
    index++
  ) {
    const result =
      results[index];

    console.log(
      `${String(index + 1).padStart(2)}. ` +
        `${formatMoney(result.finalCapital)} ` +
        `return=${formatPercent(result.returnFraction)} ` +
        `success=${formatPercent(result.successRate)} ` +
        `drawdown=${formatPercent(result.maxDrawdownFraction)} ` +
        `trades=${result.trades}`,
    );

    console.log(
      `    hold=${result.parameters.holdingPeriodHours}h ` +
        `target=${formatPercent(result.parameters.profitTarget)} ` +
        `stop=${formatPercent(result.parameters.stopLoss)} ` +
        `slopeLookback=${result.parameters.slopeLookback} ` +
        `slope=${result.parameters.slopeThreshold} ` +
        `acceleration=${result.parameters.accelerationThreshold} ` +
        `maxPositions=${result.parameters.maxConcurrentPositions}`,
    );
  }

  console.log();

  console.log(
    "Aggregated success rates by parameter:",
  );

  function printAggregate(
    title: string,
    values:
      ParameterAggregate[],
    formatter: (
      value: number,
    ) => string,
  ): void {
    console.log();

    console.log(
      title,
    );

    for (
      const value of values
    ) {
      console.log(
        `  ${formatter(value.value).padEnd(18)} ` +
          `success=${formatPercent(value.successRate).padEnd(9)} ` +
          `trades=${value.trades.toLocaleString().padEnd(10)} ` +
          `avgReturn=${formatPercent(value.averageReturn).padEnd(10)} ` +
          `avgDrawdown=${formatPercent(value.averageMaxDrawdown)}`,
      );
    }
  }

  printAggregate(
    "Holding period",
    aggregates.holdingPeriod,
    (value) =>
      `${value}h`,
  );

  printAggregate(
    "Profit target",
    aggregates.profitTarget,
    formatPercent,
  );

  printAggregate(
    "Stop loss",
    aggregates.stopLoss,
    formatPercent,
  );

  printAggregate(
    "Slope lookback",
    aggregates.slopeLookback,
    (value) =>
      `${value}m`,
  );

  printAggregate(
    "Slope threshold",
    aggregates.slopeThreshold,
    (value) =>
      value.toExponential(6),
  );

  printAggregate(
    "Acceleration threshold",
    aggregates.accelerationThreshold,
    (value) =>
      value.toExponential(6),
  );

  printAggregate(
    "Maximum concurrent positions",
    aggregates.maximumConcurrentPositions,
    (value) =>
      `${value}`,
  );
}

main().catch(
  (error) => {
    console.error();

    console.error(
      "Research runner failed:",
    );

    console.error(
      error,
    );

    process.exit(1);
  },
);