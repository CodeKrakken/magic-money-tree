import dotenv from 'dotenv';
import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import { writeFile } from 'fs/promises';
import axios from 'axios';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ServerApiVersion } from 'mongodb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const local = process.env.ENVIRONMENT === 'local' || false;

// Server

const app = express();
app.use(express.json());

app.use(local ? cors({ origin: 'http://localhost:3000' }) : cors());

if (!local) app.use(express.static(path.join(__dirname, "../../client/build")));

app.get("/data", (req: Request, res: Response) => {
  console.log('[Server] /data requested, currentTask:', currentTask);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const dataJSON = JSON.stringify({
    wallet: wallet,
    currentTask: currentTask,
    transactions: log.transactions,
    marketChart: marketChart,
    currentMarket: markets[wallet.data.currentMarket.name] ?? null,
    tradingMode
  });

  res.setHeader('Content-Type', 'application/json');
  res.send(dataJSON);
});

// Serve React app for all other routes
if (!local) {
  app.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../../client/build/index.html"));
  });
}

const port = process.env.PORT || 5000;

type TradingMode = 'simulation' | 'test' | 'live';

const resolveTradingMode = (value: string | undefined): TradingMode => {
  if (value === 'test') return 'test';
  if (value === 'live') return 'live';
  return 'simulation';
};

let tradingMode: TradingMode = resolveTradingMode(process.env.TRADING_MODE);

app.get('/api/trading-mode', (req: Request, res: Response) => {
  res.json({ tradingMode });
});

app.post('/api/trading-mode', (req: Request, res: Response) => {
  const nextMode = typeof req.body?.mode === 'string'
    ? req.body.mode.toLowerCase()
    : '';

  if (
    nextMode !== 'simulation' &&
    nextMode !== 'test' &&
    nextMode !== 'live'
  ) {
    res.status(400).json({ error: 'Invalid trading mode.' });
    return;
  }

  if (nextMode === 'live' && req.body?.confirm !== true) {
    res.status(400).json({ error: 'Live trading confirmation is required.' });
    return;
  }

  tradingMode = nextMode;
  res.json({ tradingMode });
});

app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
  await run();
});

// Database

const username = process.env.MONGODB_USERNAME;
const password = process.env.MONGODB_PASSWORD;

const uri =
  `mongodb+srv://${username}:${password}@magic-money-tree.ohcuy3y.mongodb.net/?retryWrites=true&w=majority`;

const mongo = new MongoClient(
  uri,
  {
    serverApi: ServerApiVersion.v1
  }
);

let database;

let collection: any;

const dbName = "magic-money-tree";
const collectionName: string = process.env.COLLECTION as string;

// Types

interface collection {
  [key: string]: any
}

type rawMarket = {
  status: string,
  symbol: string
}

type rawFrame = [
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

export interface indexedFrame {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
  average: number;
}

export interface market {
  histories: {
    [key: string]: indexedFrame[]
  }
  name: string
  currentPrice?: number
  slope20?: number
  slope50?: number
  acceleration?: number
  signal?: boolean
}

type transaction = {
  text: string,
  time: string
}

type logEntryType = string | transaction;

interface log {
  general: string[];
  transactions: transaction[];
  [key: string]: logEntryType[] | undefined;
}

export interface positionTarget {
  name: string;
  returnPct: number;
  fraction: number;
  targetPrice: number;
  triggered: boolean;
}

export interface position {
  symbol: string;
  asset: string;
  quantity: number;
  originalQuantity: number;
  entryPrice: number;
  entryTime: number;
  entryNotional: number;
  entryFee: number;
  targets: positionTarget[];
  marketIndex: number;
}

export interface wallet {
  coins: {
    [key: string]: {
      dollarPrice: number
      dollarValue: number
      volume: number
    }
  }
  data: {
    baseCoin: string
    prices: {
      targetPrice?: number
      highPrice?: number
      purchasePrice?: number
      stopLossPrice?: number
    }
    currentMarket: {
      name: string
    }
    positions: position[]
    startingBalance: number
    realisedProfit: number
  }
}

// Data

let log: log = {
  general: [],
  transactions: [],
};

let currentTask: string = '';
let marketChart: string[] = [];
let viableSymbols: string[] = [];
let markets: { [key: string]: market } = {};

// A signal may remain true for many scans, but it should only create one
// entry until the signal becomes false and then true again.
const signalEntryEvents = new Set<string>();
const previousSignals: Record<string, boolean> = {};

let wallet: wallet = simulatedWallet();
let i: number = 0;

/*
 * These constants are the strategy established by the research.
 */

const POSITION_NOTIONAL = 10;
const MAX_CONCURRENT_POSITIONS = 43;

const fee = 0.001;

const stopLossThreshold = 0.90;

const maximumHoldMilliseconds = 48 * 60 * 60 * 1000;

const slopeThreshold = -0.0001425851160546487;
const accelerationThreshold = 0.00013986740450809692;

const targets: {
  name: string;
  returnPct: number;
  fraction: number;
}[] = [
  {
    name: 'target_1pct',
    returnPct: 0.01,
    fraction: 0.50
  },
  {
    name: 'target_2pct',
    returnPct: 0.02,
    fraction: 0.25
  },
  {
    name: 'target_4pct',
    returnPct: 0.04,
    fraction: 0.25
  }
];

const timeScales: { [key: string]: string } = {
  minutes: 'm',
};

let trading: Boolean = false;

const binanceApiKey = process.env.BINANCE_API_KEY ?? '';
const binanceSecretKey = process.env.BINANCE_SECRET_KEY ?? '';

type SymbolFilterResult = {
  symbol: string;
  minQty: string;
  maxQty: string;
  stepSize: string;
  minPrice: string;
  maxPrice: string;
  tickSize: string;
  minNotional: string;
};

type BinanceOrderState = {
  accepted: boolean;
  status: 'accepted' | 'rejected' | 'uncertain' | 'error';
  message: string;
  binanceCode?: number;
  binanceMessage?: string;
  symbol?: string;
  side?: 'BUY' | 'SELL';
  quantity?: string;
  price?: string;
};

const EXCHANGE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;

let exchangeInfoCache: {
  fetchedAt: number;
  bySymbol: Record<string, SymbolFilterResult>;
} | null = null;

function normalizeDecimalString(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '0') {
    return '0';
  }

  const negative = trimmed.startsWith('-');
  const absolute = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw = '0', fractionRaw = ''] = absolute.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');

  if (fraction.length === 0) {
    return negative ? `-${whole}` : whole;
  }

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function decimalPlaces(value: string): number {
  const normalized = normalizeDecimalString(value);

  if (!normalized.includes('.')) {
    return 0;
  }

  return normalized.split('.')[1]?.length ?? 0;
}

function toScaledInteger(value: string, scale: number): bigint {
  const normalized = normalizeDecimalString(value);
  const [whole, fraction = ''] = normalized.split('.');

  const digits =
    `${whole.replace(/^-?0+(?=\d)/, '') || '0'}${fraction
      .padEnd(scale, '0')
      .slice(0, scale)}`;

  const number = BigInt(digits.replace(/^-/, ''));

  return normalized.startsWith('-') ? -number : number;
}

function toDecimalString(value: bigint, scale: number): string {
  if (scale === 0) {
    return value.toString();
  }

  const absolute = value < 0n ? -value : value;
  const digits = absolute.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale) || '0';
  const fraction = digits.slice(-scale).replace(/0+$/, '');

  return `${value < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function compareDecimalStrings(left: string, right: string): number {
  const scale = Math.max(
    decimalPlaces(left),
    decimalPlaces(right)
  );

  const leftValue = toScaledInteger(left, scale);
  const rightValue = toScaledInteger(right, scale);

  if (leftValue < rightValue) {
    return -1;
  }

  if (leftValue > rightValue) {
    return 1;
  }

  return 0;
}

function multiplyDecimalStrings(left: string, right: string): string {
  const scale = Math.max(
    decimalPlaces(left),
    decimalPlaces(right)
  );

  const scaledLeft = toScaledInteger(left, scale);
  const scaledRight = toScaledInteger(right, scale);

  return toDecimalString(
    (scaledLeft * scaledRight) / 10n ** BigInt(scale),
    scale
  );
}

function roundDownToStep(value: string, step: string): string {
  const normalizedValue = normalizeDecimalString(value);
  const normalizedStep = normalizeDecimalString(step);

  const scale = Math.max(
    decimalPlaces(normalizedValue),
    decimalPlaces(normalizedStep)
  );

  const valueScaled = toScaledInteger(normalizedValue, scale);
  const stepScaled = toScaledInteger(normalizedStep, scale);

  if (stepScaled <= 0n) {
    return normalizedValue;
  }

  const quotient = valueScaled / stepScaled;
  const rounded = quotient * stepScaled;

  return toDecimalString(rounded, scale);
}

function roundToTickSize(value: string, tick: string): string {
  const normalizedValue = normalizeDecimalString(value);
  const normalizedTick = normalizeDecimalString(tick);

  const scale = Math.max(
    decimalPlaces(normalizedValue),
    decimalPlaces(normalizedTick)
  );

  const stepScaled = toScaledInteger(normalizedTick, scale);

  if (stepScaled <= 0n) {
    return normalizedValue;
  }

  const valueScaled = toScaledInteger(normalizedValue, scale);
  const rounded = (valueScaled / stepScaled) * stepScaled;

  return toDecimalString(rounded, scale);
}

function getFilterMapFromExchangeInfo(
  symbolInfo: {
    symbols: Array<{
      symbol: string;
      filters: Array<{
        filterType: string;
        minQty?: string;
        maxQty?: string;
        stepSize?: string;
        minPrice?: string;
        maxPrice?: string;
        tickSize?: string;
        minNotional?: string;
      }>
    }>
  }
): Record<string, SymbolFilterResult> {
  const bySymbol: Record<string, SymbolFilterResult> = {};

  for (const symbolEntry of symbolInfo.symbols) {
    const filters = symbolEntry.filters;

    const found = {
      symbol: symbolEntry.symbol,
      minQty: '0',
      maxQty: '0',
      stepSize: '0',
      minPrice: '0',
      maxPrice: '0',
      tickSize: '0',
      minNotional: '0'
    };

    for (const filter of filters) {
      if (filter.filterType === 'LOT_SIZE') {
        found.minQty = filter.minQty ?? found.minQty;
        found.maxQty = filter.maxQty ?? found.maxQty;
        found.stepSize = filter.stepSize ?? found.stepSize;
      }

      if (filter.filterType === 'PRICE_FILTER') {
        found.minPrice = filter.minPrice ?? found.minPrice;
        found.maxPrice = filter.maxPrice ?? found.maxPrice;
        found.tickSize = filter.tickSize ?? found.tickSize;
      }

      if (filter.filterType === 'MIN_NOTIONAL') {
        found.minNotional = filter.minNotional ?? found.minNotional;
      }

      if (filter.filterType === 'NOTIONAL') {
        found.minNotional = filter.minNotional ?? found.minNotional;
      }
    }

    bySymbol[symbolEntry.symbol] = found;
  }

  return bySymbol;
}

async function refreshExchangeInfoCache(
  force = false
): Promise<Record<string, SymbolFilterResult>> {
  const now = Date.now();

  if (
    !force &&
    exchangeInfoCache &&
    now - exchangeInfoCache.fetchedAt < EXCHANGE_INFO_CACHE_TTL_MS
  ) {
    return exchangeInfoCache.bySymbol;
  }

  const response = await axios.get(
    'https://api.binance.com/api/v3/exchangeInfo',
    { timeout: 15000 }
  );

  const bySymbol = getFilterMapFromExchangeInfo(response.data);

  exchangeInfoCache = {
    fetchedAt: now,
    bySymbol
  };

  return bySymbol;
}

async function getExchangeFiltersForSymbol(
  symbol: string
): Promise<SymbolFilterResult | null> {
  const bySymbol = await refreshExchangeInfoCache();
  return bySymbol[symbol] ?? null;
}

function validateOrderAgainstFilters(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  price: string,
  filters: SymbolFilterResult
):
  | {
      ok: true;
      quantity: string;
      price: string;
      notional: string;
    }
  | {
      ok: false;
      reason: string;
    } {
  const normalizedQuantity = normalizeDecimalString(quantity);
  const normalizedPrice = normalizeDecimalString(price);

  const minQty = normalizeDecimalString(filters.minQty);
  const maxQty = normalizeDecimalString(filters.maxQty);
  const stepSize = normalizeDecimalString(filters.stepSize);
  const minPrice = normalizeDecimalString(filters.minPrice);
  const maxPrice = normalizeDecimalString(filters.maxPrice);
  const tickSize = normalizeDecimalString(filters.tickSize);
  const minNotional = normalizeDecimalString(filters.minNotional);

  let validQuantity = normalizedQuantity;

  if (stepSize !== '0') {
    validQuantity = roundDownToStep(validQuantity, stepSize);
  }

  if (
    compareDecimalStrings(validQuantity, minQty) < 0 &&
    minQty !== '0'
  ) {
    return {
      ok: false,
      reason:
        `${symbol} quantity ${validQuantity} is below MIN_QTY ${minQty}.`
    };
  }

  if (
    maxQty !== '0' &&
    compareDecimalStrings(validQuantity, maxQty) > 0
  ) {
    return {
      ok: false,
      reason:
        `${symbol} quantity ${validQuantity} exceeds MAX_QTY ${maxQty}.`
    };
  }

  let validPrice = normalizedPrice;

  if (tickSize !== '0') {
    validPrice = roundToTickSize(validPrice, tickSize);
  }

  if (
    minPrice !== '0' &&
    compareDecimalStrings(validPrice, minPrice) < 0
  ) {
    return {
      ok: false,
      reason:
        `${symbol} price ${validPrice} is below MIN_PRICE ${minPrice}.`
    };
  }

  if (
    maxPrice !== '0' &&
    compareDecimalStrings(validPrice, maxPrice) > 0
  ) {
    return {
      ok: false,
      reason:
        `${symbol} price ${validPrice} exceeds MAX_PRICE ${maxPrice}.`
    };
  }

  const notional = multiplyDecimalStrings(
    validPrice,
    validQuantity
  );

  const minNotionalValue =
    minNotional === '0' ? '0' : minNotional;

  if (
    minNotionalValue !== '0' &&
    compareDecimalStrings(notional, minNotionalValue) < 0
  ) {
    return {
      ok: false,
      reason:
        `${symbol} order notional ${notional} is below MIN_NOTIONAL ${minNotionalValue}.`
    };
  }

  if (
    side === 'BUY' &&
    minNotionalValue !== '0' &&
    compareDecimalStrings(notional, minNotionalValue) < 0
  ) {
    return {
      ok: false,
      reason:
        `${symbol} order notional ${notional} is below the minimum notional ${minNotionalValue}.`
    };
  }

  return {
    ok: true,
    quantity: validQuantity,
    price: validPrice,
    notional
  };
}

function buildBinanceSignedOrderParams(
  marketName: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  price: string
) {
  const params = new URLSearchParams({
    symbol: marketName,
    side,
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity,
    price,
    recvWindow: '60000',
    timestamp: String(Date.now())
  });

  const signature = createHmac('sha256', binanceSecretKey)
    .update(params.toString())
    .digest('hex');

  return { params, signature };
}

async function submitBinanceOrder(
  side: 'BUY' | 'SELL',
  marketName: string,
  quantity: string,
  price: string
): Promise<BinanceOrderState> {
  if (tradingMode === 'simulation') {
    return {
      accepted: false,
      status: 'rejected',
      message: 'Simulation mode does not submit Binance orders.'
    };
  }

  if (tradingMode !== 'test' && tradingMode !== 'live') {
    return {
      accepted: false,
      status: 'rejected',
      message: 'Trading mode is not enabled for Binance orders.'
    };
  }

  if (!binanceApiKey || !binanceSecretKey) {
    return {
      accepted: false,
      status: 'error',
      message:
        'Binance API credentials are required for test or live orders.'
    };
  }

  const filters = await getExchangeFiltersForSymbol(marketName);

  if (!filters) {
    return {
      accepted: false,
      status: 'error',
      message:
        `Binance exchange filters are unavailable for ${marketName}.`
    };
  }

  const validated = validateOrderAgainstFilters(
    marketName,
    side,
    quantity,
    price,
    filters
  );

  if (!validated.ok) {
    return {
      accepted: false,
      status: 'rejected',
      message: validated.reason,
      symbol: marketName,
      side,
      quantity,
      price
    };
  }

  const endpoint =
    tradingMode === 'test'
      ? 'https://api.binance.com/api/v3/order/test'
      : 'https://api.binance.com/api/v3/order';

  const { params, signature } =
    buildBinanceSignedOrderParams(
      marketName,
      side,
      validated.quantity,
      validated.price
    );

  try {
    const response = await axios.post(
      endpoint,
      `${params.toString()}&signature=${signature}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-MBX-APIKEY': binanceApiKey
        },
        timeout: 15000
      }
    );

    if (response.status >= 200 && response.status < 300) {
      const orderData = response.data as {
        status?: string;
        orderId?: string;
        symbol?: string;
        side?: 'BUY' | 'SELL';
      };

      const status = orderData.status ?? 'NEW';

      return {
        accepted: true,
        status: 'accepted',
        message:
          `Binance ${tradingMode} order request accepted for ${marketName}.`,
        symbol: marketName,
        side,
        quantity: validated.quantity,
        price: validated.price,
        binanceCode: 200,
        binanceMessage: status
      };
    }

    return {
      accepted: false,
      status: 'error',
      message:
        `Binance request for ${marketName} returned an unexpected HTTP status.`,
      symbol: marketName,
      side,
      quantity: validated.quantity,
      price: validated.price,
      binanceCode: response.status
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const responseData =
        error.response?.data as
          | { code?: number; msg?: string }
          | undefined;

      if (error.response) {
        return {
          accepted: false,
          status: 'rejected',
          message:
            `Binance ${marketName} order rejected: ${responseData?.msg ?? error.message}`,
          symbol: marketName,
          side,
          quantity,
          price,
          binanceCode: responseData?.code,
          binanceMessage:
            responseData?.msg ?? error.message
        };
      }

      return {
        accepted: false,
        status: 'uncertain',
        message:
          `Binance ${marketName} order response is uncertain because of a network timeout or connection issue. No duplicate retry was attempted.`,
        symbol: marketName,
        side,
        quantity,
        price,
        binanceMessage: error.message
      };
    }

    return {
      accepted: false,
      status: 'error',
      message:
        `Binance ${marketName} order failed unexpectedly.`,
      symbol: marketName,
      side,
      quantity,
      price,
      binanceMessage:
        error instanceof Error
          ? error.message
          : 'Unknown error'
    };
  }
}

// Functions

async function writeToFile(fileName: any, data: any) {
  try {
    await writeFile(fileName, data);
    console.log(`Wrote data to ${fileName}`);
  } catch (error: any) {
    console.error(
      `Got an error trying to write the file: ${error.message}`
    );
  }
}

async function run() {
  currentTask = `Running at ${timeNow()}`;

  console.log(currentTask);
  console.log(`Server is ${process.env.ENVIRONMENT}`);
  console.log(
    `Strategy: slope/acceleration portfolio | ${MAX_CONCURRENT_POSITIONS} positions | $${POSITION_NOTIONAL} each`
  );

  try {
    viableSymbols = await fetchSymbols() as string[];

    await setupDB();
    await pullFromDatabase();

    trading = true;

    tick();
  } catch (error: any) {
    console.log(error.message);
  }
}

function timeNow() {
  const currentTime = Date.now();
  const prettyTime = new Date(currentTime).toLocaleString();

  return prettyTime;
}

function logEntry(
  entry: logEntryType,
  topic: string = 'general'
) {
  console.log(
    isTransaction(entry)
      ? `${entry.time}  |  ${entry.text}`
      : entry
  );

  log[topic] = log[topic] ?? [];
  log[topic]?.push(entry);
}

function isTransaction(
  entry: logEntryType
): entry is transaction {
  return (entry as transaction).time !== undefined;
}

async function fetchSymbols() {
  try {
    const marketsResponse = await axios.get(
      'https://api.binance.com/api/v3/exchangeInfo'
    );

    if (marketsResponse) {
      const viableSymbols =
        analyseMarkets(marketsResponse.data.symbols);

      return viableSymbols;
    }
  } catch (error: any) {
    console.log(error.message);
    return [];
  }
}

async function setupDB() {
  currentTask = 'Setting up database ...';
  logEntry(currentTask);

  await mongo.connect();

  database = mongo.db(dbName);
  collection = database.collection(collectionName);

  const count = await collection.countDocuments();

  if (count === 0) {
    console.log('Setting up blank database');

    await collection.insertOne({
      data: {}
    });
  }

  currentTask = "Database setup complete";
  logEntry(currentTask);
}

async function pullFromDatabase() {
  logEntry("Fetching data ...");

  const data = await collection.findOne({});

  if (data?.data?.wallet) {
    wallet = migrateWallet(data.data.wallet);
  }

  if (data?.data?.log) {
    log = data.data.log;
  }

  if (data?.data?.viableSymbols) {
    viableSymbols = data.data.viableSymbols;
  }

  console.log(
    `Loaded simulated wallet: $${round(getCashBalance(), 2)} cash, ${wallet.data.positions.length} open positions`
  );
}

function migrateWallet(savedWallet: wallet): wallet {
  if (
    savedWallet?.data?.positions &&
    Array.isArray(savedWallet.data.positions)
  ) {
    return savedWallet;
  }

  console.log(
    'Existing wallet uses the old single-position structure. Starting the new 43-position portfolio with $1000.'
  );

  return simulatedWallet();
}

async function saveState() {
  await collection.replaceOne(
    {},
    {
      data: {
        wallet: wallet,
        log: log,
        viableSymbols: viableSymbols
      }
    }
  );
}

async function tick() {

      console.log('Really new')

  try {
    /*
     * Once every market has been checked, save the portfolio,
     * refresh the Binance symbol list and begin another scan.
     */
    if (!viableSymbols[i]) {
      await saveState();

      console.log(
        `----- Tick at ${timeNow()} | ${wallet.data.positions.length}/${MAX_CONCURRENT_POSITIONS} positions | $${round(getPortfolioValue(), 2)} portfolio -----`
      );

      i = 0;

      viableSymbols =
        await fetchSymbols() as string[];

      trading = true;
    }

    const symbolName =
      viableSymbols[i].replace('/', '');

    currentTask =
      `Checking market ${symbolName} ...`;

    console.log(currentTask);

    await updateMarket(
      symbolName,
      i + 1
    );

    await refreshWallet();

    /*
     * Position exits must be evaluated independently of the
     * market currently being scanned.
     */
    await manageOpenPositions();

    const sortedMarkets = sortMarkets();

    logMarkets(sortedMarkets);

    const roundedMarkets =
      roundObjects(
        sortedMarkets,
        [
          'currentPrice',
          'slope20',
          'slope50',
          'acceleration'
        ]
      );

    formatMarketDisplay(roundedMarkets);

    const filteredMarkets =
      filterMarkets(sortedMarkets);

    if (trading) {
      await trade(filteredMarkets);
    }
  } catch (error: any) {
    console.log(error.message);
  }

  i++;

  /*
   * Preserve the existing continuously-running architecture,
   * but yield to the event loop between markets.
   */
  setImmediate(() => {
    tick();
  });
}

function analyseMarkets(allMarkets: rawMarket[]) {
  const goodMarketNames = allMarkets
    .filter(
      market =>
        market.status === 'TRADING' &&
        isGoodMarketName(market.symbol)
    )
    .map(market => market.symbol);

  return goodMarketNames;
}

function isGoodMarketName(marketName: string) {
  return marketName.includes('USDT') &&
    marketName.indexOf('USDT') &&
    !marketName.includes('UP') &&
    !marketName.includes('DOWN') &&
    !marketName.includes('BUSD') &&
    !marketName.includes('TUSD') &&
    !marketName.includes('USDC') &&
    !marketName.includes(':');
}

function simulatedWallet(): wallet {
  return {
    coins: {
      USDT: {
        volume: 1000,
        dollarPrice: 1,
        dollarValue: 1000
      }
    },

    data: {
      baseCoin: 'USDT',

      prices: {},

      currentMarket: {
        name: ''
      },

      positions: [],

      startingBalance: 1000,

      realisedProfit: 0
    }
  };
}

async function updateMarket(
  symbolName: string,
  id: number | null = null
) {
  const response =
    await fetchSingleHistory(symbolName);

  if (id) {
    currentTask =
      `Fetching history of ${symbolName} ... ${response === 'No response.' ? response : ''}`;

    console.log(currentTask);
  }

  if (response !== 'No response.') {
    const indexedHistories =
      indexData(response) as {
        [key: string]: indexedFrame[]
      };

    let currentMarket: market = {
      name: symbolName,
      histories: indexedHistories
    };

    currentMarket =
      addSignalData(currentMarket);

    const signalIsActive = currentMarket.signal === true;
    const wasPreviouslyActive = previousSignals[symbolName] === true;

    // Only a false -> true transition creates a new entry event.
    if (signalIsActive && !wasPreviouslyActive) {
      signalEntryEvents.add(symbolName);
    }

    if (!signalIsActive) {
      signalEntryEvents.delete(symbolName);
    }

    previousSignals[symbolName] = signalIsActive;
    markets[symbolName] = currentMarket;
  }
}

function logMarkets(markets: market[]) {
  markets.map(market => {
    const report =
      `${market.name} ... slope20 ${market.slope20} * acceleration ${market.acceleration} = ${market.signal ? 'SIGNAL' : 'no signal'}`;

    return report;
  });
}

function formatMarketDisplay(markets: market[]) {
  marketChart = markets.map(market => {
    return `${market.name} ... slope20 ${market.slope20} | slope50 ${market.slope50} | acceleration ${market.acceleration} | ${market.signal ? 'SIGNAL' : 'no signal'}`;
  });
}

async function refreshWallet() {
  try {
    const coins = Object.keys(wallet.coins);

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];

      if (coin === 'USDT') {
        wallet.coins[coin].dollarPrice = 1;
      } else {
        wallet.coins[coin].dollarPrice =
          await fetchPrice(`${coin}USDT`) as number ||
          wallet.coins[coin].dollarPrice;
      }

      wallet.coins[coin].dollarValue =
        wallet.coins[coin].volume *
        wallet.coins[coin].dollarPrice;
    }

    /*
     * Keep currentMarket for compatibility with the existing
     * client, but it no longer represents the whole portfolio.
     */
    const openPositions =
      wallet.data.positions;

    if (openPositions.length > 0) {
      wallet.data.currentMarket.name =
        openPositions[openPositions.length - 1].symbol;
    } else {
      wallet.data.currentMarket.name = '';
      wallet.data.prices = {};
    }

    wallet.data.baseCoin = 'USDT';

    /*
     * Update legacy price fields from the most recently opened
     * position so existing UI code still has sensible values.
     */
    const currentPosition =
      openPositions[openPositions.length - 1];

    if (currentPosition) {
      wallet.data.prices = {
        purchasePrice: currentPosition.entryPrice,
        stopLossPrice:
          currentPosition.entryPrice *
          stopLossThreshold,
        highPrice:
          currentPosition.entryPrice
      };
    }
  } catch (error: any) {
    console.log(error.message);
  }
}

async function fetchPrice(marketName: string) {
  let price = 0;

  try {
    const symbolName =
      marketName.replace('/', '');

    const rawPrice =
      await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbolName}`,
        { timeout: 10000 }
      );

    price = parseFloat(rawPrice.data.price);

    return price;
  } catch (error: any) {
    console.log(error.message);

    return price;
  }
}

async function fetchSingleHistory(symbolName: string) {
  try {
    const histories: {
      [key: string]: rawFrame[]
    } = {};

    for (
      let i = 0;
      i < Object.keys(timeScales).length;
      i++
    ) {
      const timeScale =
        Object.keys(timeScales)[i];

      // The final Binance kline is the currently-forming 1-minute candle.
      // Keep 51 observations so the 50-period regression is available.
      const history =
        await axios.get(
          `https://api.binance.com/api/v3/klines?symbol=${symbolName}&interval=1${timeScales[timeScale]}&limit=51`,
          { timeout: 10000 }
        );

      histories[timeScale] =
        history.data;
    }

    return histories;
  } catch (error) {
    return 'No response.';
  }
}

function indexData(
  rawHistories: {
    [key: string]: rawFrame[]
  }
) {
  try {
    const indexedHistories: {
      [key: string]: indexedFrame[]
    } = {};

    Object.keys(rawHistories).map(timeSpan => {
      const history: indexedFrame[] = [];

      rawHistories[timeSpan].map(frame => {
        const average =
          frame
            .slice(1, 5)
            .map(element =>
              parseFloat(element as string)
            )
            .reduce((a, b) => a + b) / 4;

        history.push({
          open: parseFloat(frame[1]),
          high: parseFloat(frame[2]),
          low: parseFloat(frame[3]),
          close: parseFloat(frame[4]),
          time: frame[6],
          average: average
        });
      });

      indexedHistories[timeSpan] =
        history;
    });

    return indexedHistories;
  } catch (error: any) {
    console.log(error.message);
  }
}

/*
 * OLS regression slope.
 *
 * This deliberately matches the calculation used by the
 * historical research runner.
 */
function regressionSlope(
  closes: number[]
): number {
  const n = closes.length;

  if (n < 2) {
    return 0;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const y = closes[i];

    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }

  const denominator =
    n * sumXX -
    sumX * sumX;

  if (
    Math.abs(denominator) <
    Number.EPSILON
  ) {
    return 0;
  }

  return (
    (n * sumXY - sumX * sumY) /
    denominator
  );
}

function addSignalData(market: market) {
  try {
    const histories =
      market.histories.minutes;

    if (!histories || histories.length < 50) {
      market.slope20 = 0;
      market.slope50 = 0;
      market.acceleration = 0;
      market.signal = false;
      return market;
    }

    /*
     * The final element is intentionally retained.
     *
     * Binance supplies the currently forming candle as the
     * final kline, so this is a live/current-candle signal,
     * not a completed-candle signal.
     */
    const closes =
      histories.map(frame => frame.close);

    const slope20 =
      regressionSlope(
        closes.slice(-20)
      );

    const slope50 =
      regressionSlope(
        closes.slice(-50)
      );

    const acceleration =
      slope20 - slope50;

    market.slope20 = slope20;
    market.slope50 = slope50;
    market.acceleration = acceleration;

    market.signal =
      slope20 <= slopeThreshold &&
      acceleration >= accelerationThreshold;

    market.currentPrice =
      closes[closes.length - 1];

    return market;
  } catch (error: any) {
    console.log(error.message);

    market.slope20 = 0;
    market.slope50 = 0;
    market.acceleration = 0;
    market.signal = false;

    return market;
  }
}

function filterMarkets(markets: market[]) {
  return markets.filter(market =>
    market.signal === true &&
    viableSymbols.includes(market.name) 
  );
}

function round(
  number: number,
  decimals: number = 2
) {
  let outputNumber =
    parseFloat(
      number.toFixed(decimals)
    );

  if (!outputNumber) {
    outputNumber =
      round(
        number,
        decimals + 1
      ) as number;
  }

  return outputNumber;
}

function roundObjects(
  inMarkets: market[],
  keys: (
    'currentPrice' |
    'slope20' |
    'slope50' |
    'acceleration'
  )[]
) {
  const midMarkets: market[] = [];
  const outMarkets: market[] = [];

  inMarkets.map(market => {
    const outMarket: market = {
      ...market
    };

    keys.forEach(key => {
      if (typeof market[key] === 'number') {
        outMarket[key] =
          round(
            market[key] as number
          );
      }
    });

    midMarkets.push(outMarket);
  });

  inMarkets.map(market => {
    const outMarket: market = {
      ...market
    };

    keys.forEach(key => {
      const length =
        Math.max(
          ...midMarkets.map(market =>
            ('' + market[key])
              .split('.')[1]
              ?.length ?? 0
          )
        );

      if (typeof market[key] === 'number') {
        outMarket[key] =
          round(
            market[key] as number,
            length
          );
      }
    });

    outMarkets.push(outMarket);
  });

  function roundMarketNumber(
    inNumber: number,
    decimals: number = 2
  ) {
    if (!inNumber) {
      return inNumber;
    }

    let outNumber =
      Math.floor(
        inNumber *
        Math.pow(10, decimals)
      ) /
      Math.pow(10, decimals);

    if (
      (
        !outNumber ||
        midMarkets.some(outObj =>
          keys.some(
            key =>
              outObj[key] === outNumber
          )
        ) ||
        inMarkets.some(inObj =>
          keys.some(
            key =>
              inObj[key] === outNumber
          )
        )
      ) &&
      decimals < 100
    ) {
      outNumber =
        roundMarketNumber(
          inNumber,
          decimals + 1
        );
    }

    return outNumber;
  }

  /*
   * Preserve the original local rounding behaviour.
   * The nested helper above deliberately exists with a distinct
   * name so it does not collide with the global round function.
   */
  void roundMarketNumber;

  return outMarkets;
}

// TRADE FUNCTIONS

async function trade(
  sortedMarkets: market[]
) {
  if (
    wallet.data.positions.length >=
    MAX_CONCURRENT_POSITIONS
  ) {
    return;
  }

  const targetMarket =
    sortedMarkets.find(market => signalEntryEvents.has(market.name)) ?? null;

  if (!targetMarket) {
    console.log('No qualifying signal');
    return;
  }

  if (!targetMarket.signal) {
    return;
  }

  const cash =
    getCashBalance();

  /*
   * The purchase is always $10. The fee is additional,
   * exactly as a Binance transaction fee would be.
   */
  const requiredCash =
    POSITION_NOTIONAL *
    (1 + fee);

  if (cash < requiredCash) {
    console.log(
      `Insufficient simulated cash for ${targetMarket.name}. Cash: $${round(cash, 2)}`
    );

    return;
  }

  await simulatedBuyOrder(
    targetMarket
  );
}

function sortMarkets() {
  let marketsToSort =
    Object.keys(markets)
      .map(market =>
        markets[market]
      );

  /*
   * This is the capacity-priority ordering used by the
   * historical portfolio research:
   *
   * 1. higher acceleration
   * 2. more negative slope20
   * 3. lower Binance array position
   * 4. symbol ascending
   */
  const sortedMarkets =
    marketsToSort.sort((a, b) => {
      const accelerationDifference =
        (b.acceleration ?? 0) -
        (a.acceleration ?? 0);

      if (accelerationDifference !== 0) {
        return accelerationDifference;
      }

      const slopeDifference =
        (a.slope20 ?? 0) -
        (b.slope20 ?? 0);

      if (slopeDifference !== 0) {
        return slopeDifference;
      }

      const aIndex =
        viableSymbols.indexOf(a.name);

      const bIndex =
        viableSymbols.indexOf(b.name);

      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }

      return a.name.localeCompare(
        b.name
      );
    });

  return sortedMarkets;
}

function getCashBalance() {
  return wallet.coins.USDT?.volume ?? 0;
}

function getPortfolioValue() {
  let value =
    getCashBalance();

  for (
    const position
    of wallet.data.positions
  ) {
    const coin =
      wallet.coins[position.asset];

    if (coin) {
      value +=
        coin.volume *
        coin.dollarPrice;
    }
  }

  return value;
}

async function simulatedBuyOrder(
  market: market
): Promise<boolean> {
  try {
    if (
      wallet.data.positions.length >=
      MAX_CONCURRENT_POSITIONS
    ) {
      return false;
    }

    const asset =
      market.name.replace(
        'USDT',
        ''
      );

    const currentPrice =
      await fetchPrice(
        market.name
      );

    if (
      !currentPrice ||
      currentPrice <= 0
    ) {
      return false;
    }

    const baseVolume =
      getCashBalance();

    const totalCost =
      POSITION_NOTIONAL *
      (1 + fee);

    if (
      baseVolume <
      totalCost
    ) {
      return false;
    }

    /*
     * $10 gross notional purchase.
     * The 0.1% entry fee is paid in addition.
     */
    const orderQuantity =
      POSITION_NOTIONAL /
      currentPrice;

    const entryTime =
      Date.now();

    const positionTargets =
      targets.map(target => ({
        name: target.name,
        returnPct: target.returnPct,
        fraction: target.fraction,
        targetPrice:
          currentPrice *
          (1 + target.returnPct),
        triggered: false
      }));

    const newPosition: position = {
      symbol: market.name,
      asset,
      quantity: orderQuantity,
      originalQuantity: orderQuantity,
      entryPrice: currentPrice,
      entryTime,
      entryNotional: POSITION_NOTIONAL,
      entryFee: POSITION_NOTIONAL * fee,
      targets: positionTargets,
      marketIndex:
        viableSymbols.indexOf(
          market.name
        )
    };

    /*
     * No Binance order is submitted here.
     *
     * This server is the requested field test:
     * real Binance market data, entirely simulated execution.
     */
    wallet.coins.USDT.volume -=
      totalCost;

    if (!wallet.coins[asset]) {
      wallet.coins[asset] = {
        volume: 0,
        dollarPrice: currentPrice,
        dollarValue: 0
      };
    }

    wallet.coins[asset].volume +=
      orderQuantity;

    wallet.coins[asset].dollarPrice =
      currentPrice;

    wallet.coins[asset].dollarValue =
      wallet.coins[asset].volume *
      currentPrice;

    wallet.data.positions.push(
      newPosition
    );

    // Consume this signal event. A persistent signal cannot open another
    // position until it becomes false and later turns true again.
    signalEntryEvents.delete(market.name);

    wallet.data.currentMarket.name =
      market.name;

    wallet.data.prices = {
      purchasePrice: currentPrice,
      stopLossPrice:
        currentPrice *
        stopLossThreshold,
      highPrice:
        currentPrice
    };

    const tradeReport: transaction = {
      time: timeNow(),

      text:
        `Bought ${round(orderQuantity)} ${asset} @ ${round(currentPrice)} = $${round(POSITION_NOTIONAL, 2)} + $${round(POSITION_NOTIONAL * fee, 2)} fee | Slope20 ${market.slope20} | Acceleration ${market.acceleration} | Positions ${wallet.data.positions.length}/${MAX_CONCURRENT_POSITIONS}`
    };

    logEntry(
      tradeReport,
      'transactions'
    );

    console.log(
      `OPEN ${market.name} | $${POSITION_NOTIONAL} | ${wallet.data.positions.length}/${MAX_CONCURRENT_POSITIONS}`
    );

    return true;
  } catch (error: any) {
    console.log(error.message);
  }
}

async function manageOpenPositions() {
  /*
   * Work on a copy because positions can be removed during
   * the loop.
   */
  const openPositions =
    [...wallet.data.positions];

  for (
    const currentPosition
    of openPositions
  ) {
    const currentPrice =
      await fetchPrice(
        currentPosition.symbol
      );

    if (
      !currentPrice ||
      currentPrice <= 0
    ) {
      continue;
    }

    if (
      currentPosition.quantity <= 0
    ) {
      continue;
    }

    const stopPrice =
      currentPosition.entryPrice *
      stopLossThreshold;

    /*
     * Stop loss has priority.
     */
    if (
      currentPrice <= stopPrice
    ) {
      await simulatedSellOrder(
        'Below Stop Loss',
        currentPosition.symbol,
        currentPosition.quantity,
        currentPrice,
        currentPosition
      );

      continue;
    }

    /*
     * Partial profit targets.
     *
     * The fractions refer to the ORIGINAL position quantity,
     * exactly as in the research.
     */
    for (
      const target
      of currentPosition.targets
    ) {
      if (
        target.triggered ||
        currentPrice <
          target.targetPrice
      ) {
        continue;
      }

      const quantityToSell =
        Math.min(
          currentPosition.originalQuantity *
            target.fraction,
          currentPosition.quantity
        );

      if (
        quantityToSell <= 0
      ) {
        target.triggered = true;
        continue;
      }

      await simulatedSellOrder(
        target.name,
        currentPosition.symbol,
        quantityToSell,
        currentPrice,
        currentPosition
      );

      target.triggered = true;

      /*
       * Position may have been completely closed.
       */
      if (
        currentPosition.quantity <= 0
      ) {
        break;
      }
    }

    /*
     * 48-hour maximum hold.
     */
    if (
      wallet.data.positions.some(
        position =>
          position.symbol ===
          currentPosition.symbol
      ) &&
      Date.now() -
        currentPosition.entryTime >=
        maximumHoldMilliseconds
    ) {
      const latestPosition =
        wallet.data.positions.find(
          position =>
            position.symbol ===
            currentPosition.symbol
        );

      if (
        latestPosition &&
        latestPosition.quantity > 0
      ) {
        await simulatedSellOrder(
          '48 Hour Maximum Hold',
          latestPosition.symbol,
          latestPosition.quantity,
          currentPrice,
          latestPosition
        );
      }
    }
  }
}

async function simulatedSellOrder(
  sellType: string,
  symbol: string,
  quantity: number,
  sellPrice: number,
  currentPosition: position
) {
  try {
    const positionIndex =
      wallet.data.positions.findIndex(
        position =>
          position.symbol ===
          currentPosition.symbol
      );

    if (
      positionIndex === -1
    ) {
      return;
    }

    const position =
      wallet.data.positions[positionIndex];

    const actualQuantity =
      Math.min(
        quantity,
        position.quantity
      );

    if (
      actualQuantity <= 0
    ) {
      return;
    }

    const grossProceeds =
      actualQuantity *
      sellPrice;

    const sellFee =
      grossProceeds *
      fee;

    const netProceeds =
      grossProceeds -
      sellFee;

    /*
     * Allocate the original $10 entry notional and entry fee
     * proportionally across each sale. This makes the realised
     * profit accounting correct for partial exits.
     */
    const quantityFraction =
      actualQuantity /
      position.originalQuantity;

    const allocatedEntryCost =
      (
        position.entryNotional +
        position.entryFee
      ) *
      quantityFraction;

    const realisedProfit =
      netProceeds -
      allocatedEntryCost;

    wallet.coins.USDT.volume +=
      netProceeds;

    if (
      wallet.coins[position.asset]
    ) {
      wallet.coins[position.asset].volume -=
        actualQuantity;

      if (
        wallet.coins[position.asset].volume <
        0.0000000001
      ) {
        wallet.coins[position.asset].volume = 0;
      }

      wallet.coins[position.asset].dollarPrice =
        sellPrice;

      wallet.coins[position.asset].dollarValue =
        wallet.coins[position.asset].volume *
        sellPrice;
    }

    position.quantity -=
      actualQuantity;

    if (
      Math.abs(position.quantity) <
      0.0000000001
    ) {
      position.quantity = 0;
    }

    wallet.data.realisedProfit +=
      realisedProfit;

    const tradeReport: transaction = {
      time: timeNow(),

      text:
        `Sold ${round(actualQuantity)} ${position.asset} @ ${round(sellPrice)} = $${round(netProceeds, 2)} net | P/L $${round(realisedProfit, 4)} | ${sellType}`
    };

    logEntry(
      tradeReport,
      'transactions'
    );

    if (
      position.quantity <= 0
    ) {
      wallet.data.positions.splice(
        positionIndex,
        1
      );

      if (
        wallet.coins[position.asset]
      ) {
        delete wallet.coins[
          position.asset
        ];
      }

      console.log(
        `CLOSED ${symbol} | ${sellType} | Realised P/L $${round(realisedProfit, 4)}`
      );
    } else {
      console.log(
        `PARTIAL ${symbol} | ${sellType} | Remaining ${round(position.quantity)}`
      );
    }

    /*
     * Keep legacy currentMarket/price fields usable.
     */
    const latestPosition =
      wallet.data.positions[
        wallet.data.positions.length - 1
      ];

    if (latestPosition) {
      wallet.data.currentMarket.name =
        latestPosition.symbol;

      wallet.data.prices = {
        purchasePrice:
          latestPosition.entryPrice,

        stopLossPrice:
          latestPosition.entryPrice *
          stopLossThreshold,

        highPrice:
          latestPosition.entryPrice
      };
    } else {
      wallet.data.currentMarket.name = '';
      wallet.data.prices = {};
    }
  } catch (error: any) {
    console.log(error.message);
  }
}

run();

export {}