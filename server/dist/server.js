import dotenv from 'dotenv';
import { createHmac } from 'crypto';
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
const app = express();
app.use(express.json());
app.use(local ? cors({ origin: 'http://localhost:3000' }) : cors());
if (!local)
    app.use(express.static(path.join(__dirname, "../../client/build")));
app.get("/data", (req, res) => {
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
if (!local) {
    app.get("*", (req, res) => {
        res.sendFile(path.join(__dirname, "../../client/build/index.html"));
    });
}
const port = process.env.PORT || 5000;
const resolveTradingMode = (value) => {
    if (value === 'test')
        return 'test';
    if (value === 'live')
        return 'live';
    return 'simulation';
};
let tradingMode = resolveTradingMode(process.env.TRADING_MODE);
app.get('/api/trading-mode', (req, res) => {
    res.json({ tradingMode });
});
app.post('/api/trading-mode', (req, res) => {
    const nextMode = typeof req.body?.mode === 'string' ? req.body.mode.toLowerCase() : '';
    if (nextMode !== 'simulation' && nextMode !== 'test' && nextMode !== 'live') {
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
const username = process.env.MONGODB_USERNAME;
const password = process.env.MONGODB_PASSWORD;
const uri = `mongodb+srv://${username}:${password}@magic-money-tree.ohcuy3y.mongodb.net/?retryWrites=true&w=majority`;
const mongo = new MongoClient(uri, {
    serverApi: ServerApiVersion.v1
});
let database;
let collection;
const dbName = "magic-money-tree";
const collectionName = process.env.COLLECTION;
;
let log = {
    general: [],
    transactions: [],
};
let currentTask = '';
let marketChart = [];
let viableSymbols = [];
let markets = {};
let wallet = simulatedWallet();
let i = 0;
const minimumDollarVolume = 28000000;
const fee = 0.001;
const stopLossThreshold = 0.78;
const timeScales = {
    minutes: 'm',
};
let trading = false;
const binanceApiKey = process.env.BINANCE_API_KEY ?? '';
const binanceSecretKey = process.env.BINANCE_SECRET_KEY ?? '';
const EXCHANGE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
let exchangeInfoCache = null;
function normalizeDecimalString(value) {
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
function decimalPlaces(value) {
    const normalized = normalizeDecimalString(value);
    if (!normalized.includes('.')) {
        return 0;
    }
    return normalized.split('.')[1]?.length ?? 0;
}
function toScaledInteger(value, scale) {
    const normalized = normalizeDecimalString(value);
    const [whole, fraction = ''] = normalized.split('.');
    const digits = `${whole.replace(/^-?0+(?=\d)/, '') || '0'}${fraction.padEnd(scale, '0').slice(0, scale)}`;
    const number = BigInt(digits.replace(/^-/, ''));
    return normalized.startsWith('-') ? -number : number;
}
function toDecimalString(value, scale) {
    if (scale === 0) {
        return value.toString();
    }
    const absolute = value < 0n ? -value : value;
    const digits = absolute.toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, -scale) || '0';
    const fraction = digits.slice(-scale).replace(/0+$/, '');
    return `${value < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
function compareDecimalStrings(left, right) {
    const scale = Math.max(decimalPlaces(left), decimalPlaces(right));
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
function multiplyDecimalStrings(left, right) {
    const scale = Math.max(decimalPlaces(left), decimalPlaces(right));
    const scaledLeft = toScaledInteger(left, scale);
    const scaledRight = toScaledInteger(right, scale);
    return toDecimalString((scaledLeft * scaledRight) / 10n ** BigInt(scale), scale);
}
function roundDownToStep(value, step) {
    const normalizedValue = normalizeDecimalString(value);
    const normalizedStep = normalizeDecimalString(step);
    const scale = Math.max(decimalPlaces(normalizedValue), decimalPlaces(normalizedStep));
    const valueScaled = toScaledInteger(normalizedValue, scale);
    const stepScaled = toScaledInteger(normalizedStep, scale);
    if (stepScaled <= 0n) {
        return normalizedValue;
    }
    const quotient = valueScaled / stepScaled;
    const rounded = quotient * stepScaled;
    return toDecimalString(rounded, scale);
}
function roundToTickSize(value, tick) {
    const normalizedValue = normalizeDecimalString(value);
    const normalizedTick = normalizeDecimalString(tick);
    const stepScaled = toScaledInteger(normalizedTick, Math.max(decimalPlaces(normalizedValue), decimalPlaces(normalizedTick)));
    if (stepScaled <= 0n) {
        return normalizedValue;
    }
    const scale = Math.max(decimalPlaces(normalizedValue), decimalPlaces(normalizedTick));
    const valueScaled = toScaledInteger(normalizedValue, scale);
    const rounded = (valueScaled / stepScaled) * stepScaled;
    return toDecimalString(rounded, scale);
}
function getFilterMapFromExchangeInfo(symbolInfo) {
    const bySymbol = {};
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
async function refreshExchangeInfoCache(force = false) {
    const now = Date.now();
    if (!force && exchangeInfoCache && now - exchangeInfoCache.fetchedAt < EXCHANGE_INFO_CACHE_TTL_MS) {
        return exchangeInfoCache.bySymbol;
    }
    const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo', { timeout: 15000 });
    const bySymbol = getFilterMapFromExchangeInfo(response.data);
    exchangeInfoCache = {
        fetchedAt: now,
        bySymbol
    };
    return bySymbol;
}
async function getExchangeFiltersForSymbol(symbol) {
    const bySymbol = await refreshExchangeInfoCache();
    return bySymbol[symbol] ?? null;
}
function validateOrderAgainstFilters(symbol, side, quantity, price, filters) {
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
    if (compareDecimalStrings(validQuantity, minQty) < 0 && minQty !== '0') {
        return { ok: false, reason: `${symbol} quantity ${validQuantity} is below MIN_QTY ${minQty}.` };
    }
    if (maxQty !== '0' && compareDecimalStrings(validQuantity, maxQty) > 0) {
        return { ok: false, reason: `${symbol} quantity ${validQuantity} exceeds MAX_QTY ${maxQty}.` };
    }
    let validPrice = normalizedPrice;
    if (tickSize !== '0') {
        validPrice = roundToTickSize(validPrice, tickSize);
    }
    if (minPrice !== '0' && compareDecimalStrings(validPrice, minPrice) < 0) {
        return { ok: false, reason: `${symbol} price ${validPrice} is below MIN_PRICE ${minPrice}.` };
    }
    if (maxPrice !== '0' && compareDecimalStrings(validPrice, maxPrice) > 0) {
        return { ok: false, reason: `${symbol} price ${validPrice} exceeds MAX_PRICE ${maxPrice}.` };
    }
    const notional = multiplyDecimalStrings(validPrice, validQuantity);
    const minNotionalValue = minNotional === '0' ? '0' : minNotional;
    if (minNotionalValue !== '0' && compareDecimalStrings(notional, minNotionalValue) < 0) {
        return { ok: false, reason: `${symbol} order notional ${notional} is below MIN_NOTIONAL ${minNotionalValue}.` };
    }
    if (side === 'BUY' && minNotionalValue !== '0' && compareDecimalStrings(notional, minNotionalValue) < 0) {
        return { ok: false, reason: `${symbol} order notional ${notional} is below the minimum notional ${minNotionalValue}.` };
    }
    return {
        ok: true,
        quantity: validQuantity,
        price: validPrice,
        notional
    };
}
function buildBinanceSignedOrderParams(marketName, side, quantity, price) {
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
;
async function submitBinanceOrder(side, marketName, quantity, price) {
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
            message: 'Binance API credentials are required for test or live orders.'
        };
    }
    const filters = await getExchangeFiltersForSymbol(marketName);
    if (!filters) {
        return {
            accepted: false,
            status: 'error',
            message: `Binance exchange filters are unavailable for ${marketName}.`
        };
    }
    const validated = validateOrderAgainstFilters(marketName, side, quantity, price, filters);
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
    const endpoint = tradingMode === 'test'
        ? 'https://api.binance.com/api/v3/order/test'
        : 'https://api.binance.com/api/v3/order';
    const { params, signature } = buildBinanceSignedOrderParams(marketName, side, validated.quantity, validated.price);
    try {
        const response = await axios.post(endpoint, `${params.toString()}&signature=${signature}`, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-MBX-APIKEY': binanceApiKey
            },
            timeout: 15000
        });
        if (response.status >= 200 && response.status < 300) {
            const orderData = response.data;
            const status = orderData.status ?? 'NEW';
            return {
                accepted: true,
                status: status === 'FILLED' || status === 'PARTIALLY_FILLED' ? 'accepted' : 'accepted',
                message: `Binance ${tradingMode} order request accepted for ${marketName}.`,
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
            message: `Binance request for ${marketName} returned an unexpected HTTP status.`,
            symbol: marketName,
            side,
            quantity: validated.quantity,
            price: validated.price,
            binanceCode: response.status
        };
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            const responseData = error.response?.data;
            if (error.response) {
                return {
                    accepted: false,
                    status: 'rejected',
                    message: `Binance ${marketName} order rejected: ${responseData?.msg ?? error.message}`,
                    symbol: marketName,
                    side,
                    quantity,
                    price,
                    binanceCode: responseData?.code,
                    binanceMessage: responseData?.msg ?? error.message
                };
            }
            return {
                accepted: false,
                status: 'uncertain',
                message: `Binance ${marketName} order response is uncertain because of a network timeout or connection issue. No duplicate retry was attempted.`,
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
            message: `Binance ${marketName} order failed unexpectedly.`,
            symbol: marketName,
            side,
            quantity,
            price,
            binanceMessage: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
async function writeToFile(fileName, data) {
    try {
        await writeFile(fileName, data);
        console.log(`Wrote data to ${fileName}`);
    }
    catch (error) {
        console.error(`Got an error trying to write the file: ${error.message}`);
    }
}
async function run() {
    currentTask = `Running at ${timeNow()}`;
    console.log(currentTask);
    console.log(`Server is ${process.env.ENVIRONMENT}`);
    try {
        viableSymbols = await fetchSymbols();
        await setupDB();
        await pullFromDatabase();
        tick();
    }
    catch (error) {
        console.log(error.message);
    }
}
function timeNow() {
    const currentTime = Date.now();
    const prettyTime = new Date(currentTime).toLocaleString();
    return prettyTime;
}
function logEntry(entry, topic = 'general') {
    console.log(isTransaction(entry)
        ? `${entry.time}  |  ${entry.text}`
        : entry);
    log[topic] = log[topic] ?? [];
    log[topic]?.push(entry);
}
function isTransaction(entry) {
    return entry.time !== undefined;
}
async function fetchSymbols() {
    try {
        const markets = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        if (markets) {
            const viableSymbols = analyseMarkets(markets.data.symbols);
            return viableSymbols;
        }
    }
    catch (error) {
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
        wallet = data.data.wallet;
    }
    if (data?.data?.log) {
        log = data.data.log;
    }
    if (data?.data?.viableSymbols) {
        viableSymbols = data.data.viableSymbols;
    }
}
async function tick() {
    try {
        if (!viableSymbols[i]) {
            await collection.replaceOne({}, { data: {
                    wallet: wallet,
                    log: log,
                    viableSymbols: viableSymbols
                } });
            console.log(`----- Tick at ${timeNow()} -----`);
            i = 0;
            viableSymbols = await fetchSymbols();
            trading = true;
        }
        const symbolName = viableSymbols[i].replace('/', '');
        const isVoluminous = await checkVolume(symbolName);
        currentTask = `Checking volume of ${symbolName} ... ${!isVoluminous.includes("Insufficient") && isVoluminous !== "No response." ? 'Market included.' : isVoluminous}`;
        console.log(currentTask);
        if (!isVoluminous.includes("Insufficient") && isVoluminous !== 'Invalid market.' && isVoluminous !== "No response.") {
            await updateMarket(viableSymbols[i].replace('/', ''), i + 1);
        }
        await refreshWallet();
        if (wallet.data.baseCoin !== 'USDT') {
            await updateMarket(`${wallet.data.baseCoin}USDT`);
        }
        let sortedMarkets = sortMarkets();
        logMarkets(sortedMarkets);
        sortedMarkets = roundObjects(sortedMarkets, ['emaRatio', 'shape', 'strength']);
        formatMarketDisplay(sortedMarkets);
        sortedMarkets = filterMarkets(sortedMarkets);
        if (trading)
            await trade(sortedMarkets);
    }
    catch (error) {
        console.log(error.message);
    }
    i++;
    tick();
}
function analyseMarkets(allMarkets) {
    const goodMarketNames = allMarkets.filter(market => market.status === 'TRADING'
        && isGoodMarketName(market.symbol))
        .map(market => market.symbol);
    return goodMarketNames;
}
function isGoodMarketName(marketName) {
    return marketName.includes('USDT')
        && marketName.indexOf('USDT')
        && !marketName.includes('UP')
        && !marketName.includes('DOWN')
        && !marketName.includes('BUSD')
        && !marketName.includes('TUSD')
        && !marketName.includes('USDC')
        && !marketName.includes(':');
}
async function checkVolume(symbolName) {
    try {
        const twentyFourHour = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbolName}`, { timeout: 10000 });
        return twentyFourHour.data ? `${twentyFourHour.data.quoteVolume < minimumDollarVolume ? 'Ins' : 'S'}ufficient volume.` : "No response.";
    }
    catch (error) {
        return 'Invalid market.';
    }
}
function simulatedWallet() {
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
            }
        }
    };
}
async function updateMarket(symbolName, id = null) {
    const response = await fetchSingleHistory(symbolName);
    if (id) {
        currentTask = `Fetching history of ${symbolName} ... ${response === 'No response.' ? response : ''}`;
        console.log(currentTask);
    }
    if (response !== 'No response.') {
        const indexedHistories = indexData(response);
        let market = {
            name: symbolName,
            histories: indexedHistories
        };
        market = addEmaRatio(market);
        market = addShape(market);
        markets[symbolName] = market;
    }
}
function logMarkets(markets) {
    markets.map(market => {
        const report = `${market.name} ... shape ${market.shape} * ema ${market.emaRatio} = strength ${market.strength}`;
        return report;
    });
}
function formatMarketDisplay(markets) {
    marketChart = markets.map(market => {
        const report = `${market.name} ... shape ${market.shape} * ema ${market.emaRatio} = strength ${market.strength}`;
        return report;
    });
}
async function refreshWallet() {
    try {
        const n = Object.keys(wallet.coins).length;
        for (let i = 0; i < n; i++) {
            const coin = Object.keys(wallet.coins)[i];
            wallet.coins[coin].dollarPrice = coin === 'USDT' ? 1 : await fetchPrice(`${coin}USDT`) || wallet.coins[coin].dollarPrice;
            wallet.coins[coin].dollarValue = wallet.coins[coin].volume * wallet.coins[coin].dollarPrice;
        }
        const sorted = Object.keys(wallet.coins).sort((a, b) => wallet.coins[a].dollarValue - wallet.coins[b].dollarValue);
        wallet.data.baseCoin = sorted.pop();
        if (wallet.data.baseCoin === 'USDT') {
            wallet.data.prices = {};
        }
        else {
            wallet.data.currentMarket.name = `${wallet.data.baseCoin}USDT`;
        }
    }
    catch (error) {
        console.log(error.message);
    }
}
async function fetchPrice(marketName) {
    let price = 0;
    try {
        const symbolName = marketName.replace('/', '');
        const rawPrice = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbolName}`);
        price = parseFloat(rawPrice.data.price);
        return price;
    }
    catch (error) {
        console.log(error.message);
        fetchPrice(marketName);
    }
}
async function fetchSingleHistory(symbolName) {
    try {
        const histories = {};
        for (let i = 0; i < Object.keys(timeScales).length; i++) {
            const timeScale = Object.keys(timeScales)[i];
            const history = await axios.get(`https://api.binance.com/api/v1/klines?symbol=${symbolName}&interval=1${timeScales[timeScale]}`, { timeout: 10000 });
            histories[timeScale] = history.data;
        }
        return histories;
    }
    catch (error) {
        return 'No response.';
    }
}
function indexData(rawHistories) {
    try {
        const indexedHistories = {};
        Object.keys(rawHistories).map(timeSpan => {
            const history = [];
            rawHistories[timeSpan].map(frame => {
                const average = frame.slice(1, 5).map(element => parseFloat(element)).reduce((a, b) => a + b) / 4;
                history.push({
                    open: parseFloat(frame[1]),
                    high: parseFloat(frame[2]),
                    low: parseFloat(frame[3]),
                    close: parseFloat(frame[4]),
                    time: frame[6],
                    average: average
                });
            });
            indexedHistories[timeSpan] = history;
        });
        return indexedHistories;
    }
    catch (error) {
        console.log(error.message);
    }
}
function addEmaRatio(market) {
    try {
        const spans = [
            500, 377, 233, 144, 89, 55, 34,
            21, 13, 8, 5, 3, 2, 1
        ];
        const frameRatioEmas = Object.keys(timeScales).map(timeScale => {
            const emas = spans.map(span => ema(extractData(market.histories[timeScale], 'average'), span));
            return ema(ratioArray(emas));
        });
        market.emaRatio = ema(frameRatioEmas);
        return market;
    }
    catch (error) {
        console.log(error.message);
    }
}
function ratioArray(valueArray) {
    const ratioArray = [];
    for (let i = 0; i < valueArray.length - 1; i++) {
        ratioArray.push(valueArray[i + 1] / valueArray[i]);
    }
    return ratioArray;
}
function ema(data, time = null) {
    time = time ?? data.length;
    const k = 2 / (time + 1);
    const emaData = [];
    emaData[0] = data[0];
    for (let i = 1; i < data.length; i++) {
        const newPoint = (data[i] * k) + (emaData[i - 1] * (1 - k));
        emaData.push(newPoint);
    }
    const currentEma = [...emaData].pop();
    return +currentEma;
}
function extractData(dataArray, key) {
    const outputArray = [];
    dataArray.map(obj => {
        if (key === "open" || key === "high" || key === "low" || key === "close" || key === "average") {
            outputArray.push(obj[key]);
        }
    });
    return outputArray;
}
function addShape(market) {
    const shapes = Object.keys(timeScales).map(timeScale => {
        const m = market.histories[timeScale].length;
        const totalChange = market.histories[timeScale][m - 1].close - market.histories[timeScale][0].open;
        const percentageChange = market.histories[timeScale][m - 1].close / market.histories[timeScale][0].open;
        let straightLineIncrement = totalChange / m;
        let deviations = [];
        let straightLine = market.histories[timeScale][0].open;
        market.histories[timeScale].map(frame => {
            straightLine += straightLineIncrement;
            deviations.push(frame.average === straightLine ? 1 :
                frame.average < straightLine ? frame.average / straightLine :
                    market.name.includes(wallet.data.baseCoin) ?
                        frame.average / straightLine :
                        straightLine / frame.average);
        });
        const shape = percentageChange * ema(deviations);
        return shape;
    });
    market.shape = ema(shapes);
    return market;
}
function filterMarkets(markets) {
    return markets.filter(market => market.shape >= 1 &&
        market.emaRatio >= 1 &&
        market.strength >= 1 &&
        viableSymbols.includes(market.name));
}
function round(number, decimals = 2) {
    let outputNumber = parseFloat(number.toFixed(decimals));
    if (!outputNumber) {
        outputNumber = round(number, decimals + 1);
    }
    return outputNumber;
}
function roundObjects(inMarkets, keys) {
    const midMarkets = [];
    const outMarkets = [];
    inMarkets.map(market => {
        const outMarket = { ...market };
        keys.forEach(key => {
            outMarket[key] = round(market[key]);
        });
        midMarkets.push(outMarket);
    });
    inMarkets.map(market => {
        const outMarket = { ...market };
        keys.forEach(key => {
            const length = Math.max(...midMarkets.map(market => ('' + market[key]).split('.')[1]?.length ?? 0));
            outMarket[key] = round(market[key], length);
        });
        outMarkets.push(outMarket);
    });
    function round(inNumber, decimals = 2) {
        if (!inNumber) {
            return inNumber;
        }
        let outNumber = Math.floor(inNumber * Math.pow(10, decimals)) / Math.pow(10, decimals);
        if ((!outNumber ||
            midMarkets.some(outObj => keys.some(key => outObj[key] === outNumber)) ||
            inMarkets.some(inObj => keys.some(key => inObj[key] === outNumber))) &&
            decimals < 100) {
            outNumber = round(inNumber, decimals + 1);
        }
        return outNumber;
    }
    return outMarkets;
}
async function trade(sortedMarkets) {
    const targetMarket = sortedMarkets[0]?.strength > 0 ? sortedMarkets[0] : null;
    if (wallet.data.baseCoin === 'USDT') {
        if (!targetMarket) {
            console.log('No bulls');
        }
        else if (wallet.coins[wallet.data.baseCoin].volume > 10) {
            await simulatedBuyOrder(targetMarket);
        }
    }
    else {
        try {
            const currentMarket = markets[wallet.data.currentMarket.name];
            if (currentMarket.shape < 1 || currentMarket.emaRatio < 1 || currentMarket.strength < 1) {
            }
            else if (!currentMarket) {
            }
            else if (targetMarket?.name !== currentMarket.name
                && wallet.coins[wallet.data.baseCoin].dollarPrice >= wallet.data.prices.targetPrice) {
                simulatedSellOrder('New Bull', currentMarket);
            }
            else if (!wallet.data.prices.targetPrice || !wallet.data.prices.stopLossPrice) {
            }
            else if (wallet.coins[wallet.data.baseCoin].dollarPrice < wallet.data.prices.stopLossPrice) {
                simulatedSellOrder('Below Stop Loss', markets[wallet.data.currentMarket.name]);
            }
        }
        catch (error) {
            console.log(error.message);
        }
    }
}
function sortMarkets() {
    let marketsToSort = Object.keys(markets).map(market => markets[market]);
    marketsToSort = marketsToSort.map(market => {
        const emaRatio = market.emaRatio;
        const shape = market.shape;
        market.strength = emaRatio && shape ? emaRatio * shape : 0;
        return market;
    });
    const sortedMarkets = marketsToSort.sort((a, b) => b.strength - a.strength);
    return sortedMarkets;
}
async function simulatedBuyOrder(market) {
    try {
        const asset = market.name.replace(wallet.data.baseCoin, '');
        const base = wallet.data.baseCoin;
        const response = await fetchPrice(market.name);
        if (response) {
            const currentPrice = response;
            const baseVolume = wallet.coins[base].volume;
            const orderQuantity = baseVolume * (1 - fee) / currentPrice;
            if (tradingMode === 'test' || tradingMode === 'live') {
                const orderResult = await submitBinanceOrder('BUY', market.name, String(orderQuantity), String(currentPrice));
                if (!orderResult.accepted) {
                    throw new Error(orderResult.message || `Binance ${tradingMode} buy order was rejected for ${market.name}.`);
                }
            }
            if (!wallet.coins[asset]) {
                wallet.coins[asset] = { volume: 0, dollarPrice: 0, dollarValue: 0 };
            }
            wallet.coins[base].volume = 0;
            wallet.coins[asset].volume += orderQuantity;
            const targetVolume = baseVolume * (1 + (2 * fee));
            wallet.data.prices = {
                targetPrice: targetVolume / wallet.coins[asset].volume,
                purchasePrice: currentPrice,
                stopLossPrice: currentPrice * stopLossThreshold,
                highPrice: currentPrice
            };
            wallet.data.currentMarket.name = market.name;
            const tradeReport = {
                time: timeNow(),
                text: `Bought ${round(wallet.coins[asset].volume)} ${asset} @ ${round(currentPrice)} = $${round(baseVolume * (1 - fee))}  |  Strength ${round(market.strength)}`
            };
            logEntry(tradeReport, 'transactions');
        }
    }
    catch (error) {
        console.log(error.message);
    }
}
async function simulatedSellOrder(sellType, market) {
    try {
        const asset = wallet.data.currentMarket.name.replace('USDT', '');
        const base = 'USDT';
        const assetVolume = wallet.coins[asset].volume;
        const sellPrice = wallet.coins[asset].dollarPrice;
        if (tradingMode === 'test' || tradingMode === 'live') {
            const orderResult = await submitBinanceOrder('SELL', wallet.data.currentMarket.name, String(assetVolume), String(sellPrice));
            if (!orderResult.accepted) {
                throw new Error(orderResult.message || `Binance ${tradingMode} sell order was rejected for ${wallet.data.currentMarket.name}.`);
            }
        }
        wallet.coins[base].volume += assetVolume * (1 - fee) * sellPrice;
        wallet.data.prices = {};
        const tradeReport = {
            time: timeNow(),
            text: `Sold ${round(assetVolume)} ${asset} @ ${round(sellPrice)} = $${round(wallet.coins[base].volume)}  |  Strength ${round(market.strength)}  |  ${sellType}`
        };
        logEntry(tradeReport, 'transactions');
        delete wallet.coins[asset];
    }
    catch (error) {
        console.log(error.message);
    }
}
run();
//# sourceMappingURL=server.js.map