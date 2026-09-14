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

interface ExchangeSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed: boolean;
}

interface ExchangeInfo {
  symbols: ExchangeSymbol[];
}

interface Ticker24h {
  symbol: string;
  quoteVolume: string;
}

const SOURCE_DATASET_PATH = path.join(
  process.cwd(),
  "server",
  "research-output",
  "ema-data-1789061547934.json"
);

const OUTPUT_DIR = path.join(
  process.cwd(),
  "server",
  "research-output"
);

const TARGET_MARKET_COUNT = 60;
const KLINE_INTERVAL = "1m";
const KLINE_LIMIT = 1000;

// Binance's public REST API.
const BINANCE_BASE_URL = "https://api.binance.com";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSourceDataset(): Dataset {
  const raw = fs.readFileSync(
    SOURCE_DATASET_PATH,
    "utf8"
  );

  return JSON.parse(raw) as Dataset;
}

async function fetchJson<T>(
  url: string
): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Binance request failed: ${response.status} ${response.statusText}\n${body}`
    );
  }

  return response.json() as Promise<T>;
}

async function fetchExchangeInfo(): Promise<ExchangeInfo> {
  return fetchJson<ExchangeInfo>(
    `${BINANCE_BASE_URL}/api/v3/exchangeInfo`
  );
}

async function fetch24HourTickers(): Promise<Ticker24h[]> {
  return fetchJson<Ticker24h[]>(
    `${BINANCE_BASE_URL}/api/v3/ticker/24hr`
  );
}

function selectMarkets(
  exchangeInfo: ExchangeInfo,
  tickers: Ticker24h[],
  excludedSymbols: Set<string>
): string[] {
  const tickerBySymbol = new Map(
    tickers.map((ticker) => [
      ticker.symbol,
      Number(ticker.quoteVolume)
    ])
  );

  const eligible = exchangeInfo.symbols
    .filter((symbol) => {
      if (symbol.status !== "TRADING") {
        return false;
      }

      if (symbol.quoteAsset !== "USDT") {
        return false;
      }

      if (!symbol.isSpotTradingAllowed) {
        return false;
      }

      if (excludedSymbols.has(symbol.symbol)) {
        return false;
      }

      const quoteVolume =
        tickerBySymbol.get(symbol.symbol) ?? 0;

      return Number.isFinite(quoteVolume) &&
        quoteVolume > 0;
    })
    .map((symbol) => ({
      symbol: symbol.symbol,
      quoteVolume:
        tickerBySymbol.get(symbol.symbol) ?? 0
    }))
    .sort(
      (a, b) =>
        b.quoteVolume - a.quoteVolume
    );

  if (
    eligible.length <
    TARGET_MARKET_COUNT
  ) {
    throw new Error(
      `Only ${eligible.length} eligible markets found after excluding the original universe.`
    );
  }

  return eligible
    .slice(0, TARGET_MARKET_COUNT)
    .map((market) => market.symbol);
}

async function fetchKlines(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const candles: Candle[] = [];

  let currentStart = startTime;

  while (currentStart < endTime) {
    const url =
      `${BINANCE_BASE_URL}/api/v3/klines` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${KLINE_INTERVAL}` +
      `&startTime=${currentStart}` +
      `&endTime=${endTime}` +
      `&limit=${KLINE_LIMIT}`;

    const rows =
      await fetchJson<unknown[][]>(url);

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const [
        openTime,
        open,
        high,
        low,
        close,
        volume
      ] = row;

      if (
        typeof openTime !== "number" ||
        typeof open !== "string" ||
        typeof high !== "string" ||
        typeof low !== "string" ||
        typeof close !== "string" ||
        typeof volume !== "string"
      ) {
        throw new Error(
          `Unexpected Binance kline format for ${symbol}.`
        );
      }

      candles.push({
        openTime,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume)
      });
    }

    const lastOpenTime =
      Number(rows[rows.length - 1][0]);

    if (
      !Number.isFinite(lastOpenTime) ||
      lastOpenTime < currentStart
    ) {
      throw new Error(
        `Binance returned invalid pagination for ${symbol}.`
      );
    }

    const nextStart =
      lastOpenTime + 60_000;

    if (nextStart <= currentStart) {
      break;
    }

    currentStart = nextStart;

    if (rows.length < KLINE_LIMIT) {
      break;
    }

    // Stay comfortably below Binance request-rate limits.
    await sleep(100);
  }

  return candles.filter(
    (candle) =>
      candle.openTime >= startTime &&
      candle.openTime < endTime
  );
}

function validateCandles(
  symbol: string,
  candles: Candle[],
  expectedStart: number,
  expectedEnd: number
): void {
  if (candles.length === 0) {
    throw new Error(
      `${symbol}: no candles downloaded.`
    );
  }

  const first = candles[0];
  const last =
    candles[candles.length - 1];

  console.log(
    `${symbol}: ${candles.length.toLocaleString()} candles | ` +
    `${new Date(first.openTime).toISOString()} -> ` +
    `${new Date(last.openTime).toISOString()}`
  );

  if (first.openTime > expectedStart) {
    console.warn(
      `${symbol}: data starts later than the requested start.`
    );
  }

  if (last.openTime >= expectedEnd) {
    throw new Error(
      `${symbol}: candle data extends beyond requested end.`
    );
  }
}

async function main(): Promise<void> {
  console.log(
    "============================================================"
  );
  console.log(
    "Build out-of-sample 60-market dataset"
  );
  console.log(
    "============================================================"
  );

  const sourceDataset =
    loadSourceDataset();

  if (
    !sourceDataset.markets ||
    sourceDataset.markets.length === 0
  ) {
    throw new Error(
      "Source dataset contains no markets."
    );
  }

  const sourceMarkets =
    sourceDataset.markets;

  const sourceSymbols =
    new Set(
      sourceMarkets.map(
        (market) => market.symbol
      )
    );

  console.log(
    `Original universe: ${sourceMarkets.length} markets`
  );

  console.log(
    `Original symbols excluded: ${sourceSymbols.size}`
  );

  const allSourceCandles =
    sourceMarkets.flatMap(
      (market) => market.candles
    );

  if (allSourceCandles.length === 0) {
    throw new Error(
      "Source dataset contains no candles."
    );
  }

  const startTime =
    Math.min(
      ...sourceMarkets.map(
        (market) =>
          market.candles[0]?.openTime ??
          Number.POSITIVE_INFINITY
      )
    );

  const endTime =
    Math.max(
      ...sourceMarkets.map(
        (market) =>
          market.candles[
            market.candles.length - 1
          ]?.openTime ??
          Number.NEGATIVE_INFINITY
      )
    ) + 60_000;

  console.log(
    `Historical period: ${new Date(startTime).toISOString()}`
  );

  console.log(
    `Historical period end: ${new Date(endTime).toISOString()}`
  );

  console.log(
    "\nFetching Binance market metadata..."
  );

  const [
    exchangeInfo,
    tickers
  ] = await Promise.all([
    fetchExchangeInfo(),
    fetch24HourTickers()
  ]);

  const selectedSymbols =
    selectMarkets(
      exchangeInfo,
      tickers,
      sourceSymbols
    );

  console.log(
    "\nSelected out-of-sample universe:"
  );

  console.log(
    selectedSymbols.join(", ")
  );

  console.log(
    `\nDownloading ${selectedSymbols.length} markets...`
  );

  const markets: MarketData[] = [];

  for (
    let i = 0;
    i < selectedSymbols.length;
    i++
  ) {
    const symbol =
      selectedSymbols[i];

    console.log(
      `\n[${i + 1}/${selectedSymbols.length}] ${symbol}`
    );

    const candles =
      await fetchKlines(
        symbol,
        startTime,
        endTime
      );

    validateCandles(
      symbol,
      candles,
      startTime,
      endTime
    );

    markets.push({
      symbol,
      candles
    });
  }

  const dataset: Dataset = {
    markets
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true }
  );

  const timestamp =
    Date.now();

  const outputPath =
    path.join(
      OUTPUT_DIR,
      `ema-data-oos-60-${timestamp}.json`
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(dataset)
  );

  const totalCandles =
    markets.reduce(
      (total, market) =>
        total + market.candles.length,
      0
    );

  console.log(
    "\n============================================================"
  );

  console.log(
    "Out-of-sample dataset complete"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `Markets: ${markets.length}`
  );

  console.log(
    `Candles: ${totalCandles.toLocaleString()}`
  );

  console.log(
    `Start: ${new Date(startTime).toISOString()}`
  );

  console.log(
    `End: ${new Date(endTime).toISOString()}`
  );

  console.log(
    `Output: ${outputPath}`
  );

  console.log(
    "\nSelected markets:"
  );

  for (const symbol of selectedSymbols) {
    console.log(`  ${symbol}`);
  }
}

main().catch((error) => {
  console.error(
    "\nDataset build failed:"
  );

  console.error(error);

  process.exit(1);
});
