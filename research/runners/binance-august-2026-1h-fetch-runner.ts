import fs from "node:fs";
import path from "node:path";

interface BinanceFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  maxNotional?: string;
  [key: string]: unknown;
}

interface BinanceSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
  isMarginTradingAllowed?: boolean;
  baseAssetPrecision?: number;
  quotePrecision?: number;
  quoteAssetPrecision?: number;
  baseCommissionPrecision?: number;
  quoteCommissionPrecision?: number;
  orderTypes?: string[];
  permissions?: string[];
  permissionsSets?: string[][];
  filters?: BinanceFilter[];
  [key: string]: unknown;
}

interface BinanceExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits?: unknown[];
  exchangeFilters?: unknown[];
  symbols: BinanceSymbol[];
}

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketData {
  symbol: string;
  binanceArrayPosition: number;
  candleCount: number;
  firstCandleTime: number;
  lastCandleTime: number;
  candles: Candle[];
}

interface FailedMarket {
  symbol: string;
  binanceArrayPosition: number;
  error: string;
  attempts: number;
}

interface NoHistoricalDataMarket {
  symbol: string;
  binanceArrayPosition: number;
}

interface FetchManifest {
  generatedAt: string;
  endpoint: string;
  interval: string;
  startTime: string;
  endTimeExclusive: string;
  startTimeMs: number;
  endTimeExclusiveMs: number;

  exchangeInfoSymbolCount: number;
  eligibleUsdtSpotMarkets: number;

  marketsWithHistoricalData: number;
  marketsWithCompleteHistory: number;
  marketsWithPartialHistory: number;
  marketsWithNoHistoricalData: number;
  failedMarkets: number;

  totalCandles: number;
  expectedCandlesPerMarket: number;

  concurrency: number;
  requestDelayMs: number;
  maxRetries: number;

  outputFile: string;
  exchangeInfoFile: string;
  noHistoricalDataFile: string | null;
  failuresFile: string | null;

  durationSeconds: number;
}

const API_BASE = "https://api.binance.com";

const EXCHANGE_INFO_URL =
  `${API_BASE}/api/v3/exchangeInfo`;

const KLINES_URL =
  `${API_BASE}/api/v3/klines`;

const INTERVAL = "1h";

// Whole of August 2026, UTC.
// End is exclusive.
const START_TIME =
  Date.parse("2026-08-01T00:00:00.000Z");

const END_TIME_EXCLUSIVE =
  Date.parse("2026-09-01T00:00:00.000Z");

const OUTPUT_DIR =
  path.resolve(process.cwd(), "research/output");

const CONCURRENCY = 6;
const REQUEST_DELAY_MS = 100;
const MAX_RETRIES = 6;
const RETRY_BASE_DELAY_MS = 1_000;

const OUTPUT_TIMESTAMP = new Date()
  .toISOString()
  .replace(/\.\d{3}Z$/, "Z")
  .replace(/[:.]/g, "-");

const DATA_FILE = path.join(
  OUTPUT_DIR,
  `binance-august-2026-1h-${OUTPUT_TIMESTAMP}.json`
);

const EXCHANGE_INFO_FILE = path.join(
  OUTPUT_DIR,
  `binance-august-2026-exchange-info-${OUTPUT_TIMESTAMP}.json`
);

const MANIFEST_FILE = path.join(
  OUTPUT_DIR,
  `binance-august-2026-1h-manifest-${OUTPUT_TIMESTAMP}.json`
);

const NO_HISTORY_FILE = path.join(
  OUTPUT_DIR,
  `binance-august-2026-1h-no-history-${OUTPUT_TIMESTAMP}.json`
);

const FAILURES_FILE = path.join(
  OUTPUT_DIR,
  `binance-august-2026-1h-failures-${OUTPUT_TIMESTAMP}.json`
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "?";
  }

  const totalSeconds = Math.round(seconds);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
  );
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function getExpectedCandleCount(): number {
  return Math.round(
    (END_TIME_EXCLUSIVE - START_TIME) /
      (60 * 60 * 1_000)
  );
}

function getFilter(
  symbol: BinanceSymbol,
  filterType: string
): BinanceFilter | undefined {
  return symbol.filters?.find(
    (filter) => filter.filterType === filterType
  );
}

function isEligibleSpotUsdtMarket(
  symbol: BinanceSymbol
): boolean {
  if (symbol.status !== "TRADING") {
    return false;
  }

  if (symbol.quoteAsset !== "USDT") {
    return false;
  }

  if (symbol.isSpotTradingAllowed === false) {
    return false;
  }

  const priceFilter = getFilter(
    symbol,
    "PRICE_FILTER"
  );

  const lotSizeFilter = getFilter(
    symbol,
    "LOT_SIZE"
  );

  if (!priceFilter || !lotSizeFilter) {
    return false;
  }

  return true;
}

async function fetchJson<T>(
  url: string,
  attempt = 1
): Promise<T> {
  try {
    const response = await fetch(url);

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await response.text();

    const retryable =
      response.status === 429 ||
      response.status === 418 ||
      response.status >= 500;

    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(
        `HTTP ${response.status}: ${body.slice(0, 500)}`
      );
    }

    const retryAfterHeader =
      response.headers.get("retry-after");

    let retryDelay =
      RETRY_BASE_DELAY_MS *
      2 ** (attempt - 1);

    if (retryAfterHeader) {
      const retryAfterSeconds =
        Number(retryAfterHeader);

      if (Number.isFinite(retryAfterSeconds)) {
        retryDelay = Math.max(
          retryDelay,
          retryAfterSeconds * 1_000
        );
      }
    }

    retryDelay += Math.round(
      Math.random() * 500
    );

    console.log(
      `    HTTP ${response.status}; ` +
      `retrying in ${formatDuration(
        retryDelay / 1_000
      )}...`
    );

    await sleep(retryDelay);

    return fetchJson<T>(
      url,
      attempt + 1
    );
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      throw error;
    }

    const retryDelay =
      RETRY_BASE_DELAY_MS *
        2 ** (attempt - 1) +
      Math.round(Math.random() * 500);

    console.log(
      `    Request error; ` +
      `retrying in ${formatDuration(
        retryDelay / 1_000
      )}...`
    );

    await sleep(retryDelay);

    return fetchJson<T>(
      url,
      attempt + 1
    );
  }
}

async function fetchExchangeInfo(): Promise<BinanceExchangeInfo> {
  console.log(
    "Fetching Binance exchange information..."
  );

  const exchangeInfo =
    await fetchJson<BinanceExchangeInfo>(
      EXCHANGE_INFO_URL
    );

  if (!Array.isArray(exchangeInfo.symbols)) {
    throw new Error(
      "Binance exchangeInfo response does not contain symbols[]"
    );
  }

  console.log(
    `Binance returned ${formatNumber(
      exchangeInfo.symbols.length
    )} symbols.`
  );

  return exchangeInfo;
}

function klineToCandle(
  kline: BinanceKline
): Candle {
  return {
    time: kline[0],
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
  };
}

async function fetchMarketCandles(
  symbol: string
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval: INTERVAL,
    startTime: String(START_TIME),
    endTime: String(
      END_TIME_EXCLUSIVE - 1
    ),
    limit: "1000",
  });

  const url =
    `${KLINES_URL}?${params.toString()}`;

  const klines =
    await fetchJson<BinanceKline[]>(url);

  return klines
    .map(klineToCandle)
    .filter(
      (candle) =>
        candle.time >= START_TIME &&
        candle.time < END_TIME_EXCLUSIVE
    );
}

function validateCandles(
  symbol: string,
  candles: Candle[]
): void {
  for (
    let i = 0;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];

    if (
      !Number.isFinite(candle.time) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close) ||
      !Number.isFinite(candle.volume)
    ) {
      throw new Error(
        `${symbol}: invalid numeric candle at index ${i}`
      );
    }

    if (
      candle.open <= 0 ||
      candle.high <= 0 ||
      candle.low <= 0 ||
      candle.close <= 0
    ) {
      throw new Error(
        `${symbol}: non-positive price at index ${i}`
      );
    }

    if (
      candle.high < candle.low ||
      candle.high < candle.open ||
      candle.high < candle.close ||
      candle.low > candle.open ||
      candle.low > candle.close
    ) {
      throw new Error(
        `${symbol}: invalid OHLC relationship at index ${i}`
      );
    }

    if (
      i > 0 &&
      candle.time <= candles[i - 1].time
    ) {
      throw new Error(
        `${symbol}: candles are not strictly increasing`
      );
    }
  }
}

interface WorkerState {
  completed: number;
  startedAt: number;
}

async function runWorker(
  symbols: BinanceSymbol[],
  results: Array<MarketData | undefined>,
  failures: FailedMarket[],
  noHistoricalData: NoHistoricalDataMarket[],
  state: WorkerState
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;

      if (index >= symbols.length) {
        return;
      }

      const symbolInfo = symbols[index];
      const symbol = symbolInfo.symbol;

      try {
        const candles =
          await fetchMarketCandles(symbol);

        if (candles.length === 0) {
          noHistoricalData.push({
            symbol,
            binanceArrayPosition: index,
          });

          state.completed++;

          console.log(
            `[${formatNumber(
              state.completed
            )}/${formatNumber(
              symbols.length
            )}] ${symbol}: no August history`
          );
        } else {
          validateCandles(
            symbol,
            candles
          );

          const market: MarketData = {
            symbol,
            binanceArrayPosition: index,
            candleCount: candles.length,
            firstCandleTime: candles[0].time,
            lastCandleTime:
              candles[candles.length - 1].time,
            candles,
          };

          results[index] = market;

          state.completed++;

          const elapsedSeconds =
            (Date.now() -
              state.startedAt) /
            1_000;

          const rate =
            state.completed /
            elapsedSeconds;

          const remaining =
            symbols.length -
            state.completed;

          const etaSeconds =
            rate > 0
              ? remaining / rate
              : Number.NaN;

          const expected =
            getExpectedCandleCount();

          const status =
            candles.length === expected
              ? "complete"
              : `partial ${candles.length}/${expected}`;

          console.log(
            `[${formatNumber(
              state.completed
            )}/${formatNumber(
              symbols.length
            )}] ${symbol}: ` +
              `${candles.length} candles ` +
              `(${status}) | ` +
              `rate ${rate.toFixed(2)}/s | ` +
              `ETA ${formatDuration(
                etaSeconds
              )}`
          );
        }
      } catch (error) {
        state.completed++;

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        failures.push({
          symbol,
          binanceArrayPosition: index,
          error: message,
          attempts: MAX_RETRIES,
        });

        const elapsedSeconds =
          (Date.now() -
            state.startedAt) /
          1_000;

        const rate =
          state.completed /
          elapsedSeconds;

        const remaining =
          symbols.length -
          state.completed;

        const etaSeconds =
          rate > 0
            ? remaining / rate
            : Number.NaN;

        console.error(
          `[${formatNumber(
            state.completed
          )}/${formatNumber(
            symbols.length
          )}] ${symbol}: FAILED — ` +
          `${message} | ETA ${formatDuration(
            etaSeconds
          )}`
        );
      }

      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  const workerCount =
    Math.min(
      CONCURRENCY,
      symbols.length
    );

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => worker()
    )
  );
}

async function writeJsonFile(
  filename: string,
  value: unknown
): Promise<void> {
  await fs.promises.writeFile(
    filename,
    JSON.stringify(value),
    "utf8"
  );
}

async function main(): Promise<void> {
  const overallStart = Date.now();

  await fs.promises.mkdir(
    OUTPUT_DIR,
    { recursive: true }
  );

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Binance August 2026 hourly market fetch"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Interval:       ${INTERVAL}`
  );

  console.log(
    `Start:          ${
      new Date(START_TIME).toISOString()
    }`
  );

  console.log(
    `End exclusive:  ${
      new Date(
        END_TIME_EXCLUSIVE
      ).toISOString()
    }`
  );

  console.log(
    `Expected bars:  ${formatNumber(
      getExpectedCandleCount()
    )} per full-month market`
  );

  console.log(
    `Concurrency:    ${CONCURRENCY}`
  );

  console.log(
    `Request delay:  ${REQUEST_DELAY_MS}ms`
  );

  console.log(
    `Max retries:    ${MAX_RETRIES}`
  );

  console.log("");

  const exchangeInfo =
    await fetchExchangeInfo();

  await writeJsonFile(
    EXCHANGE_INFO_FILE,
    exchangeInfo
  );

  console.log(
    `Saved exchangeInfo: ${
      path.basename(
        EXCHANGE_INFO_FILE
      )
    }`
  );

  const eligibleSymbols =
    exchangeInfo.symbols.filter(
      isEligibleSpotUsdtMarket
    );

  console.log("");

  console.log(
    `Eligible USDT spot markets: ` +
    `${formatNumber(
      eligibleSymbols.length
    )}`
  );

  if (eligibleSymbols.length === 0) {
    throw new Error(
      "No eligible USDT spot markets were found."
    );
  }

  const results:
    Array<MarketData | undefined> =
    new Array(
      eligibleSymbols.length
    );

  const failures: FailedMarket[] = [];

  const noHistoricalData:
    NoHistoricalDataMarket[] = [];

  const state: WorkerState = {
    completed: 0,
    startedAt: Date.now(),
  };

  console.log("");
  console.log(
    "Starting candle download..."
  );
  console.log("");

  await runWorker(
    eligibleSymbols,
    results,
    failures,
    noHistoricalData,
    state
  );

  const orderedMarkets =
    results.filter(
      (
        market
      ): market is MarketData =>
        market !== undefined
    );

  const expectedCandleCount =
    getExpectedCandleCount();

  const completeMarkets =
    orderedMarkets.filter(
      (market) =>
        market.candleCount ===
        expectedCandleCount
    );

  const partialMarkets =
    orderedMarkets.filter(
      (market) =>
        market.candleCount !==
        expectedCandleCount
    );

  const totalCandles =
    orderedMarkets.reduce(
      (total, market) =>
        total + market.candleCount,
      0
    );

  const durationSeconds =
    (Date.now() -
      overallStart) /
    1_000;

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Fetch complete"
  );
  console.log(
    "============================================================"
  );

  console.log(
    `Markets requested:       ${formatNumber(
      eligibleSymbols.length
    )}`
  );

  console.log(
    `Markets with history:    ${formatNumber(
      orderedMarkets.length
    )}`
  );

  console.log(
    `Complete histories:      ${formatNumber(
      completeMarkets.length
    )}`
  );

  console.log(
    `Partial histories:       ${formatNumber(
      partialMarkets.length
    )}`
  );

  console.log(
    `No August history:       ${formatNumber(
      noHistoricalData.length
    )}`
  );

  console.log(
    `Failed requests:         ${formatNumber(
      failures.length
    )}`
  );

  console.log(
    `Total candles:           ${formatNumber(
      totalCandles
    )}`
  );

  console.log(
    `Duration:                ${formatDuration(
      durationSeconds
    )}`
  );

  console.log("");

  const dataset = {
    interval: INTERVAL,

    startTime: START_TIME,
    endTimeExclusive:
      END_TIME_EXCLUSIVE,

    startTimeIso:
      new Date(
        START_TIME
      ).toISOString(),

    endTimeExclusiveIso:
      new Date(
        END_TIME_EXCLUSIVE
      ).toISOString(),

    expectedCandleCount,

    markets: orderedMarkets,
  };

  console.log(
    `Writing dataset: ${
      path.basename(DATA_FILE)
    }`
  );

  await writeJsonFile(
    DATA_FILE,
    dataset
  );

  if (noHistoricalData.length > 0) {
    await writeJsonFile(
      NO_HISTORY_FILE,
      noHistoricalData
    );
  }

  if (failures.length > 0) {
    await writeJsonFile(
      FAILURES_FILE,
      failures
    );
  }

  const manifest: FetchManifest = {
    generatedAt:
      new Date().toISOString(),

    endpoint: KLINES_URL,

    interval: INTERVAL,

    startTime:
      new Date(
        START_TIME
      ).toISOString(),

    endTimeExclusive:
      new Date(
        END_TIME_EXCLUSIVE
      ).toISOString(),

    startTimeMs: START_TIME,

    endTimeExclusiveMs:
      END_TIME_EXCLUSIVE,

    exchangeInfoSymbolCount:
      exchangeInfo.symbols.length,

    eligibleUsdtSpotMarkets:
      eligibleSymbols.length,

    marketsWithHistoricalData:
      orderedMarkets.length,

    marketsWithCompleteHistory:
      completeMarkets.length,

    marketsWithPartialHistory:
      partialMarkets.length,

    marketsWithNoHistoricalData:
      noHistoricalData.length,

    failedMarkets:
      failures.length,

    totalCandles,

    expectedCandlesPerMarket:
      expectedCandleCount,

    concurrency: CONCURRENCY,

    requestDelayMs:
      REQUEST_DELAY_MS,

    maxRetries:
      MAX_RETRIES,

    outputFile:
      path.basename(DATA_FILE),

    exchangeInfoFile:
      path.basename(
        EXCHANGE_INFO_FILE
      ),

    noHistoricalDataFile:
      noHistoricalData.length > 0
        ? path.basename(
            NO_HISTORY_FILE
          )
        : null,

    failuresFile:
      failures.length > 0
        ? path.basename(
            FAILURES_FILE
          )
        : null,

    durationSeconds,
  };

  await writeJsonFile(
    MANIFEST_FILE,
    manifest
  );

  console.log("");
  console.log("Output files:");

  console.log(
    `  ${path.basename(DATA_FILE)}`
  );

  console.log(
    `  ${path.basename(
      EXCHANGE_INFO_FILE
    )}`
  );

  console.log(
    `  ${path.basename(
      MANIFEST_FILE
    )}`
  );

  if (noHistoricalData.length > 0) {
    console.log(
      `  ${path.basename(
        NO_HISTORY_FILE
      )}`
    );
  }

  if (failures.length > 0) {
    console.log(
      `  ${path.basename(
        FAILURES_FILE
      )}`
    );
  }

  console.log("");
  console.log("Done.");
}

main().catch((error) => {
  console.error("");
  console.error(
    "============================================================"
  );
  console.error(
    "FETCH FAILED"
  );
  console.error(
    "============================================================"
  );

  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : String(error)
  );

  process.exitCode = 1;
});