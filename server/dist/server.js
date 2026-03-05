import dotenv from 'dotenv';
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
    app.use(express.static(path.join(__dirname, "../client/build")));
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
        currentMarket: markets[wallet.data.currentMarket.name] ?? null
    });
    res.setHeader('Content-Type', 'application/json');
    res.send(dataJSON);
});
if (!local) {
    app.get("*", (req, res) => {
        res.sendFile(path.join(__dirname, "../client/build/index.html"));
    });
}
const port = process.env.PORT || 5000;
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
        currentTask = `Checking volume of ${i + 1}/${viableSymbols.length} - ${symbolName} ... ${!isVoluminous.includes("Insufficient") && isVoluminous !== "No response." ? 'Market included.' : isVoluminous}`;
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
        currentTask = `Fetching history for ${id}/${viableSymbols.length} - ${symbolName} ... ${response === 'No response.' ? response : ''}`;
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
            if (!wallet.coins[asset]) {
                wallet.coins[asset] = { volume: 0, dollarPrice: 0, dollarValue: 0 };
            }
            wallet.coins[base].volume = 0;
            wallet.coins[asset].volume += baseVolume * (1 - fee) / currentPrice;
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
        wallet.coins[base].volume += assetVolume * (1 - fee) * wallet.coins[asset].dollarPrice;
        wallet.data.prices = {};
        const tradeReport = {
            time: timeNow(),
            text: `Sold ${round(assetVolume)} ${asset} @ ${round(wallet.coins[asset].dollarPrice)} = $${round(wallet.coins[base].volume)}  |  Strength ${round(market.strength)}  |  ${sellType}`
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