require('dotenv').config();
import { Request, Response } from 'express';
const local = process.env.ENVIRONMENT === 'local'

// Server

const axios = require("axios");
const express = require("express");
const app = express();
app.use(express.json());
const cors = require("cors");
const path = require("path");

app.use(local ? cors({origin: 'http://localhost:3000'}) : cors());

app.use(express.static(path.join(__dirname, "build")));

app.get("/data", (req: Request, res: Response) => {
  const dataJSON = JSON.stringify({
    wallet          : wallet,
    currentTask     : currentTask,
    transactions  : log.transactions,
    marketChart         : marketChart,
    currentMarket   : markets[wallet.data.currentMarket.name] ?? null
  });
  res.setHeader('Content-Type', 'application/json');
  res.send(dataJSON);
});

app.get('/local-data', (req: Request, res: Response) => {
  res.json({
    wallet          : wallet,
    currentTask     : currentTask,
    transactions    : log.transactions,
    marketChart     : marketChart,
    currentMarket   : markets[wallet.data.currentMarket.name] ?? null
  })
})

const port = process.env.PORT || 5000;

app.listen(port, () => {
  const currentTask = `Server listening on port ${port}`
  console.log(currentTask);
});



// Database

const username = process.env.MONGODB_USERNAME
const password = process.env.MONGODB_PASSWORD

const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${username}:${password}@magic-money-tree.ohcuy3y.mongodb.net/?retryWrites=true&w=majority`;
const mongo = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
let database
let collection: collection
const dbName = "magic-money-tree";
const collectionName = local ? 'local-data' : 'data'
console.log(collectionName)

// Types

interface collection {
  [key: string]: any
}

type rawMarket = {
  status: string, 
  symbol: string
}

export interface wallet {
  coins: {
    [key: string]: {
      dollarPrice : number
      dollarValue : number
      volume      : number
    }
  }
  data: {
    baseCoin      : string
    prices        : {
      targetPrice?    : number
      currentPrice?   : number
      purchasePrice?  : number
      stopLossPrice?  : number
    }
    currentMarket: {
      name: string
    }
    purchaseTime: number
  }
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
  open    : number;
  high    : number;
  low     : number;
  close   : number;
  time    : number;
  average : number;
}

export interface market {
  histories: {
    [key: string]: indexedFrame[]
  }
  emaRatio?     : number
  shape?        : number
  name          : string
  strength?     : number
  currentPrice? : number
  trendScore?   : number
}

type LogTopic = 'general' | 'transactions';

type transaction = {
  text: string,
  time: string
}

type logEntryType = string | transaction;

interface log {
  general: string[];
  transactions: transaction[];
  [key: string]: logEntryType[] | undefined;
};

// Data

let log: log = {
  general       : [],
  transactions  : [],
};

let currentTask: string = ''
let marketChart: string[] = []
let viableSymbols: string[] = []
let markets: { [key: string]: market } = {}
let wallet: wallet = simulatedWallet()
let i: number = 0
const minimumDollarVolume = 28000000
const fee = 0.001
const stopLossThreshold = 0.78
const timeScales: {[key: string]: string} = {
  // months  : 'M', 
  // weeks   : 'w', 
  // days    : 'd', 
  // hours   : 'h', 
  minutes : 'm',
  seconds : 's'
}
let trading: Boolean



// Functions

async function run() {

  currentTask = `Running at ${timeNow()}`
  console.log(currentTask)
  try {
    viableSymbols = await fetchSymbols() as string[]
    await setupDB();
    await pullFromDatabase();
    trading = Boolean(Object.keys(markets).length)
    tick()
  } catch (error) {
    console.log(error)
  }
}

function timeNow() {
  const currentTime = Date.now()
  const prettyTime = new Date(currentTime).toLocaleString()
  return prettyTime
}

function logEntry(entry: logEntryType, topic: string = 'general') {
  console.log(
    isTransaction(entry)
      ? `${entry.time}  |  ${entry.text}`
      : entry
  );
  log[topic] = log[topic] ?? [];
  log[topic]?.push(entry);
}

function isTransaction(entry: logEntryType): entry is transaction {
  return (entry as transaction).time !== undefined;
}

async function fetchSymbols() {

  try {
    const markets = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
    if (markets) {
      const viableSymbols = analyseMarkets(markets.data.symbols)
      return viableSymbols
    }
  } catch (error) {
    console.log(error)
    return []
  }
}

async function setupDB() {
  currentTask = 'Setting up database ...'
  logEntry(currentTask)
  await mongo.connect()
  database = mongo.db(dbName);
  collection = database.collection(collectionName)
  const count = await collection.countDocuments();
  if (count === 0) {
    console.log('Setting up blank database')
    await collection.insertOne({
      data: {}
    });
  }
  currentTask = "Database setup complete"
  logEntry(currentTask)
}

async function pullFromDatabase() {
  logEntry("Fetching data ...")
  const data = await collection.findOne({});
  if (data?.data?.wallet) { wallet = data.data.wallet}
  if (data?.data?.markets) { markets = data.data.markets}
  if (data?.data?.log) { log = data.data.log}
  if (data?.data?.viableSymbols) { viableSymbols = data.data.viableSymbols}
}

async function tick() {

  try {

    if (!viableSymbols[i]) {

      await collection.replaceOne({}, { data: {
        wallet: wallet,
        markets: markets,
        log: log,
        viableSymbols: viableSymbols
      } });

      console.log(`----- Tick at ${timeNow()} -----`)

      i = 0

      viableSymbols = await fetchSymbols() as string[]
      trading = true
    }

    const symbolName = viableSymbols[i].replace('/', '')

    const isVoluminous = await checkVolume(symbolName)

    currentTask = `Checking volume of ${i+1}/${viableSymbols.length} - ${symbolName} ... ${!isVoluminous.includes("Insufficient") && isVoluminous !== "No response." ? 'Market included.' : isVoluminous}`
    console.log(currentTask)

    if (!isVoluminous.includes("Insufficient") && isVoluminous !== 'Invalid market.' && isVoluminous !== "No response.") {
      await updateMarket(viableSymbols[i].replace('/', ''), i+1)
    }

    await refreshWallet()
    if (wallet.data.baseCoin !== 'USDT') {await updateMarket(`${wallet.data.baseCoin}USDT`)}

    let sortedMarkets = sortMarkets()
    logMarkets(sortedMarkets)
    sortedMarkets = roundObjects(sortedMarkets, ['emaRatio', 'shape', 'strength'])
    formatMarketDisplay(sortedMarkets)
    // sortedMarkets = filterMarkets(sortedMarkets)
    if ((sortedMarkets.length && trading) || wallet.data.baseCoin !== 'USDT') await trade(sortedMarkets)  } catch (error) {
    console.log(error)
  }
  i++
  tick()
}

function analyseMarkets(allMarkets: rawMarket[]) {
  const goodMarketNames = allMarkets.filter(
    market => market.status === 'TRADING' 
    && isGoodMarketName(market.symbol)
  )
  .map(market => market.symbol)
  return goodMarketNames
}

function isGoodMarketName(marketName: string) {
  return marketName.includes('USDT')
  && marketName.indexOf('USDT') 
  && !marketName.includes('UP') 
  && !marketName.includes('DOWN') 
  && !marketName.includes('BUSD')
  && !marketName.includes('TUSD')
  && !marketName.includes('USDC')
  && !marketName.includes(':')
  // && marketName === 'GBPUSDT'
  // && !marketName.includes('BNB')
}

async function checkVolume(symbolName: string) {
  try {
    const twentyFourHour = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbolName}`, { timeout: 10000 })
    return twentyFourHour.data ? `${twentyFourHour.data.quoteVolume < minimumDollarVolume ? 'Ins' : 'S'}ufficient volume.` : "No response."
  } catch (error) {
    return 'Invalid market.'
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
      },
      purchaseTime: 0
    }
  }
}

async function updateMarket(symbolName: string, id: number|null=null) {
  const response = await fetchSingleHistory(symbolName)
  if (id) {
    currentTask = `Fetching history for ${id}/${viableSymbols.length} - ${symbolName} ... ${response === 'No response.' ? response : ''}`
    console.log(currentTask)
  }

  if (response !== 'No response.') {
    const indexedHistories = indexData(response) as {[key: string]: indexedFrame[]}
    let market: market = {
      name: symbolName,
      histories: indexedHistories
    }
    market = addEmaRatio(market) as market
    market = addShape(market)
    market.trendScore = calculateTrendScore(ratioArray(extractData(market.histories['minutes'], 'average')))
    console.log(market)
    markets[symbolName] = market
  }
}

function logMarkets(markets: market[]) {
  markets.map(market => {
    const report = `${market.name.replace('USDT', '')} ... trend ${market.trendScore}`
    console.log(report)
    return report
  })
}

function formatMarketDisplay(markets: market[]) {
  marketChart = markets.map(market => {
    const report = `${market.name.replace('USDT', '')} ... trend ${market.trendScore}`
    return report
  })
}

async function refreshWallet() {
  try {
  
    const n = Object.keys(wallet.coins).length

    for (let i = 0; i < n; i ++) {
      const coin = Object.keys(wallet.coins)[i]
      wallet.coins[coin].dollarPrice = coin === 'USDT' ? 1 : await fetchPrice(`${coin}USDT`) as number
      wallet.coins[coin].dollarValue = wallet.coins[coin].volume * wallet.coins[coin].dollarPrice
    }

    const sorted = Object.keys(wallet.coins).sort((a, b) => wallet.coins[a].dollarValue - wallet.coins[b].dollarValue)
    wallet.data.baseCoin = sorted.pop() as string

    if (wallet.data.baseCoin === 'USDT') {
      wallet.data.prices = {}
    } else {
      wallet.data.currentMarket.name = `${wallet.data.baseCoin}USDT`
    }
  } catch (error) {
      console.log(error)
  }  
}

async function fetchPrice(marketName: string) {
  try {
    const symbolName = marketName.replace('/', '')
    const rawPrice = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbolName}`) 
    const price = parseFloat(rawPrice.data.price)
    return price
  } catch (error) {
    console.log(error)
  }
}

async function fetchSingleHistory(symbolName: string) {
  try {
    const histories: { [key: string]: rawFrame[]} = {}

    for (let i = 0; i < Object.keys(timeScales).length; i++) {
      const timeScale = Object.keys(timeScales)[i]
      const history = await axios.get(`https://api.binance.com/api/v1/klines?symbol=${symbolName}&interval=1${timeScales[timeScale]}`, { timeout: 10000 })
      histories[timeScale] = history.data
    }
    return histories
  } catch (error) {
    return 'No response.'
  }
}

function indexData(rawHistories: { [key: string]: rawFrame[]}) {
  try {
    const indexedHistories: {  [key: string]: indexedFrame[]} = {}

    Object.keys(rawHistories).map(timeSpan => {
      const history: indexedFrame[] = []

      rawHistories[timeSpan].map(frame => {
  
        const average = frame.slice(1, 5).map(element => parseFloat(element as string)).reduce((a,b)=>a+b)/4

        history.push(
          {
            open      : parseFloat(frame[1]),
            high      : parseFloat(frame[2]),
            low       : parseFloat(frame[3]),
            close     : parseFloat(frame[4]),
            time      : frame[6],
            average   : average
          }
        )
      })
      indexedHistories[timeSpan] = history
    })
    return indexedHistories

  } catch(error) {
    console.log(error)
  }
}

function addEmaRatio(market: market) {

  try {
    const spans = [
      500, 377, 233, 144, 89, 55, 34, 
      21, 13, 8, 5, 3, 2, 1
    ]
    const frameRatioEmas = Object.keys(timeScales).map(timeScale => {
      const emas = spans.map(span => 
        ema(extractData(market.histories[timeScale], 'average'), span)
      )
      return ema(ratioArray(emas))
    })

    market.emaRatio = ema(frameRatioEmas)
  
    return market
  } catch (error) {
    console.log(error)
  }
}

function ratioArray(valueArray: number[]) {

  const ratioArray: number[] = []
  for (let i = 0; i < valueArray.length-1; i++) {
    ratioArray.push(valueArray[i+1]/valueArray[i])
  }
  return ratioArray
}

function ema(data: number[], time: number|null=null) {

  time = time ?? data.length
  const k = 2/(time + 1)
  const emaData: number[] = []
  emaData[0] = data[0]

  for (let i = 1; i < data.length; i++) {
    const newPoint = (data[i] * k) + (emaData[i-1] * (1-k))
    emaData.push(newPoint)
  }

  const currentEma = [...emaData].pop() as number
  return +currentEma
}

function extractData(dataArray: indexedFrame[], key: string) {
  const outputArray: number[] = []
  dataArray.map(obj => {
    if (key === "open" || key === "high" || key === "low" || key === "close" || key === "average") {
      outputArray.push(obj[key])
    }
  })

  return outputArray
}

function addShape(market: market) {

  const shapes = Object.keys(timeScales).map(timeScale => {

    const m = market.histories[timeScale].length
    const totalChange = market.histories[timeScale][m - 1].close - market.histories[timeScale][0].open
    const percentageChange = market.histories[timeScale][m - 1].close / market.histories[timeScale][0].open
    let straightLineIncrement = totalChange / m
    let deviations: number[] = []
    let straightLine = market.histories[timeScale][0].open

    market.histories[timeScale].map(frame => {
      straightLine += straightLineIncrement
      deviations.push(
        frame.average === straightLine ? 1 : 
        frame.average < straightLine ? frame.average / straightLine : 
        market.name.includes(wallet.data.baseCoin) && frame.time > wallet.data.purchaseTime ?
        frame.average / straightLine :
        straightLine / frame.average
      )
    })

    const shape = percentageChange * ema(deviations)
    return shape
  })
  market.shape = ema(shapes)
  
  return market
}

function calculateTrendScore(values: number[]): number {
  let trendScore = 0;
  let trendDirection = 0;
  let lastValue = values[0];

  for (let i = 1; i < values.length; i++) {
    const currentValue = values[i];

    if (currentValue > lastValue) {
      if (trendDirection < 0) {
        trendScore = 0;
      }
      trendScore += currentValue - lastValue;
      trendDirection = 1;
    } else if (currentValue < lastValue) {
      if (trendDirection > 0) {
        trendScore = 0;
      }
      trendScore += lastValue - currentValue;
      trendDirection = -1;
    } else {
      trendDirection = 0;
    }

    lastValue = currentValue;
  }

  return trendScore;
}

function filterMarkets(markets: market[]) {
  return markets.filter(market => 
    market.shape    as number >= 1.002  && 
    market.emaRatio as number >= 1.002  &&
    market.strength as number >= 1.002
  )
}

function round(number: number, decimals: number=2) {
  let outputNumber = parseFloat(number.toFixed(decimals))
  if (!outputNumber) {outputNumber = round(number, decimals+1) as number}
  return outputNumber
}

function roundObjects(inMarkets: market[], keys: ('shape'|'strength'|'currentPrice'|'emaRatio')[]) {
  
  const midMarkets: market[] = []
  const outMarkets: market[] = []

  inMarkets.map(market => {
    const outMarket: market = { ...market }

    keys.forEach(key => {
      outMarket[key] = round(market[key] as number)
    })
    midMarkets.push(outMarket)
  })

  inMarkets.map(market => {
    const outMarket: market = { ...market }
    
    keys.forEach(key => {
      const length = Math.max(...midMarkets.map(market => (''+market[key]).split('.')[1]?.length ?? 0))
      outMarket[key] = round(market[key] as number, length)
    })
    outMarkets.push(outMarket)
  })
  
  function round(inNumber: number, decimals: number = 2) {
    if (!inNumber) {
      return inNumber
    }
    let outNumber = Math.floor(inNumber * Math.pow(10, decimals)) / Math.pow(10, decimals)
    if (
      (!outNumber ||
        midMarkets.some(outObj =>
          keys.some(key => outObj[key] === outNumber)
        ) ||
        inMarkets.some(inObj =>
          keys.some(key => inObj[key] === outNumber)
        )) &&
      decimals < 100
    ) {
      outNumber = round(inNumber, decimals + 1)
    }
    return outNumber
  }
  return outMarkets
}



// TRADE FUNCTIONS

async function trade(sortedMarkets: market[]) {

  const targetMarket = sortedMarkets[0]?.strength as number > 0 ? sortedMarkets[0] : null  
  if (wallet.data.baseCoin === 'USDT') {   

    if (!targetMarket) {
      console.log('No bulls')
    } else if (wallet.coins[wallet.data.baseCoin].volume > 10) {
      await simulatedBuyOrder(targetMarket)
    } 
  } else {
    try {
      const currentMarket = markets[wallet.data.currentMarket.name]
      console.log(targetMarket)
      console.log(currentMarket)
      if (currentMarket.shape as number < 1 || currentMarket.emaRatio as number < 1 || currentMarket.strength as number < 1) {
        // simulatedSellOrder('Bear', currentMarket)
      } else if (!currentMarket) {
        // simulatedSellOrder('No response for current market', markets[wallet.data.currentMarket.name])
      } else if (targetMarket?.name !== currentMarket.name && wallet.coins[wallet.data.baseCoin].dollarPrice >= (wallet.data.prices.targetPrice as number)) { 
        simulatedSellOrder('New Bull', currentMarket)
      } else if (!wallet.data.prices.targetPrice || !wallet.data.prices.stopLossPrice) {
        // simulatedSellOrder('Price information undefined', markets[wallet.data.currentMarket.name])
      } else if (wallet.coins[wallet.data.baseCoin].dollarPrice as number < wallet.data.prices.stopLossPrice) {
        // simulatedSellOrder('Below Stop Loss', markets[wallet.data.currentMarket.name])
      }
      
    } catch(error) {
      console.log(error)
    }
  }
}

function sortMarkets() {

  let marketsToSort = Object.keys(markets).map(market => markets[market])

  marketsToSort = marketsToSort.map(market => {
    const emaRatio = market.emaRatio as number | undefined;
    const shape = market.shape as number | undefined;
    market.strength = emaRatio && shape ? emaRatio * shape : 0;
    return market;
  })
  const sortedMarkets = marketsToSort.sort((a,b) => (b.trendScore as number) - (a.trendScore as number))
  return sortedMarkets
}

async function simulatedBuyOrder(market: market) {
  try {
    const asset = market.name.replace(wallet.data.baseCoin, '')
    const base  = wallet.data.baseCoin
    const response = await fetchPrice(market.name)
    if (response) {
      const currentPrice = response as number
      const baseVolume = wallet.coins[base].volume
      if (!wallet.coins[asset]) wallet.coins[asset] = { volume: 0, dollarPrice: 0, dollarValue: 0 }
      wallet.coins[base].volume = 0

      wallet.coins[asset].volume += baseVolume * (1 - fee) / currentPrice
      const targetVolume = baseVolume * (1 + (2 * fee))

      wallet.data.prices = {
        targetPrice   : targetVolume / wallet.coins[asset].volume,
        purchasePrice : currentPrice,
        stopLossPrice : currentPrice * stopLossThreshold,
        currentPrice  : currentPrice
      }

      wallet.data.currentMarket.name = market.name
      const tradeReport: transaction = {
        time: timeNow(),
        text: `${round(wallet.coins[asset].volume)} ${asset} @ ${round(currentPrice)} = $${round(baseVolume * (1 - fee))}  |  Trend ${market.trendScore as number}`
      }      
      logEntry(tradeReport, 'transactions')
    }
  } catch (error) {
    console.log(error)
  }
}

async function simulatedSellOrder(sellType: string, market: market) {
  try {
    const asset = wallet.data.currentMarket.name.replace('USDT', '')
    const base  = 'USDT'
    const assetVolume = wallet.coins[asset].volume
    wallet.coins[base].volume += assetVolume * (1 - fee) * wallet.coins[asset].dollarPrice
    wallet.data.prices = {}
    const tradeReport = {
      time: timeNow(),
      text: `${round(assetVolume)} ${asset} @ ${round(wallet.coins[asset].dollarPrice)} = $${round(wallet.coins[base].volume)}  |   |  ${sellType}`
    }
    logEntry(tradeReport, 'transactions')
    delete wallet.coins[asset]
    wallet.data.purchaseTime = 0
  } catch (error) {
    console.log(error)
  }
}

run()

export {}
