import { Request, Response } from 'express';

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
    currentMarket : market
    prices        : {
      targetPrice?    : number
      highPrice?      : number
      purchasePrice?  : number
      stopLossPrice?  : number
    }
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

interface market {
  histories: {
    [key: string]: indexedFrame[]
  }
  emaRatio?      : number
  shape?         : number
  name          : string
  strength?      : number
  currentPrice  :  number
}

type LogTopic = 'general' | 'transactions';

// interface collection { [key: string]: Function }
// const { MongoClient } = require('mongodb');
// const username = process.env.MONGODB_USERNAME
// const password = process.env.MONGODB_PASSWORD
// const uri = `mongodb+srv://${username}:${password}@cluster0.ra0fk.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
// const mongo = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
// let db
// let priceData: { [key: string]: Function } = {}
// let tradeHistory: { [key: string]: Function } = {}
// const dbName = "magic-money-tree";
// const mongoose = require('mongoose');
// mongoose.connect(process.env.MONGODB_URI || uri)

const log: {
  [key in LogTopic]: string[]
} = {
  general: [],
  transactions: [],
};

let currentTask: string = ''
let ranking: string[] = []
const wallet: wallet = simulatedWallet()
const axios = require("axios");
const express = require("express");
const app = express();
app.use(express.json());
const cors = require("cors");
const path = require("path");

app.use(cors());

app.use(express.static(path.join(__dirname, "build")));

app.get("/data", (req: Request, res: Response) => {
  const dataJSON = JSON.stringify({
    wallet          : wallet,
    currentTask     : currentTask,
    transactionLog  : log.transactions,
    ranking         : ranking
  });
  res.setHeader('Content-Type', 'application/json');
  res.send(dataJSON);
});

const port = process.env.PORT || 5000;

app.listen(port, () => {
  const currentTask = `Server listening on port ${port}`
  logEntry(currentTask);
});

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

async function run() {
  currentTask = `Running at ${timeNow()}`
  logEntry(currentTask)
  try {
    // await setupDB();
    // await dbAppend(tradeHistory, timeNow(), 'Running')
    tick(wallet)
  } catch (error) {
    console.log(error)
  }
}

function timeNow() {
  const currentTime = Date.now()
  const prettyTime = new Date(currentTime).toLocaleString()
  return prettyTime
}

async function setupDB() {

  currentTask = 'Setting up database ...'
  logEntry(currentTask)

  // await mongo.connect()
  // db = mongo.db(dbName);
  // priceData = db.collection("price-data")  
  // tradeHistory = db.collection("trade-history")
  // await dbOverwrite(priceData,    {sessionStart: timeNow()})
  // await dbOverwrite(tradeHistory, {sessionStart: timeNow()})
  currentTask = "Database setup complete"
  logEntry(currentTask)
}

function logEntry (entry: string, topic: LogTopic='general') {
  console.log(entry)
  log[topic].push(entry)    
}

// async function dbOverwrite(collection: collection, data: {[key: string]: string}) {
//   const query = { key: data.key };
//   const options = {
//     upsert: true,
//   };
//   await collection.replaceOne(query, data, options);
// }

// async function dbAppend(collection: collection, value: string, key: string=timeNow(), ) {
//   await collection.insert({[key]: value});
// }

async function fetchSymbols() {

  try {
    const markets = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
    if (markets) {
      const viableSymbols = await analyseMarkets(markets.data.symbols)
      return viableSymbols
    }
  } catch (error) {
    console.log(error)
    return []
  }
}

async function analyseMarkets(allMarkets: rawMarket[]) {
  const goodMarketNames = allMarkets.filter(
    market => market.status === 'TRADING' 
    && isGoodMarketName(market.symbol)
  )
  .map(market => market.symbol)
  const viableMarketNames = await getViableMarketNames(goodMarketNames)  
  return viableMarketNames
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

async function getViableMarketNames(marketNames: string[]) {
  const viableMarketNames: string[] = []
  const n = marketNames.length

  if (!n) {
    logEntry('No viable markets.') 
  } else {

    for (let i = 0; i < n; i++) {
      const symbolName = marketNames[i].replace('/', '')
      const response = await checkVolume(symbolName)

      if (!response.includes("Insufficient") && response !== "No response."){
        viableMarketNames.push(marketNames[i])
      }

      currentTask = `Checking volume of ${i+1}/${n} - ${marketNames[i]} ... ${!response.includes("Insufficient") && response !== "No response." ? 'Market included.' : response}`

      logEntry(currentTask)
      await refreshWallet(wallet)
    }
    return viableMarketNames
  }
}

async function checkVolume(symbolName: string) {
  const twentyFourHour = await fetch24Hour(symbolName)
  return twentyFourHour.data ? `${twentyFourHour.data.quoteVolume < minimumDollarVolume ? 'Ins' : 'S'}ufficient volume.` : "No response."
}

async function fetch24Hour(symbolName: string) {
  try {
      const twentyFourHour = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbolName}`, { timeout: 10000 })
      return twentyFourHour
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
      currentMarket: {
        name: '',
        histories: {},
        emaRatio: NaN,
        shape: NaN,
        strength: NaN,
        currentPrice: NaN
      },
      prices: {}
    }
  }
}

async function tick(wallet: wallet) {
  try {
    logEntry(`----- Tick at ${timeNow()} -----`)
    const viableSymbols = await fetchSymbols()

    if (viableSymbols?.length) {
      let markets = await fetchAllHistory(viableSymbols) as market[]
      if (markets.length) {
        markets = await addEmaRatio(markets) as market[]
        markets = await addShape(markets)
        markets = sortMarkets(markets)
        await logMarkets(markets)
        markets = await filterMarkets(markets)
        if (markets.length) await trade(markets, wallet)
      }
    }
  } catch (error) {
    console.log(error)
  }
  tick(wallet)
}

async function refreshWallet(wallet: wallet) {
  try {
    
    const n = Object.keys(wallet.coins).length

    for (let i = 0; i < n; i ++) {
      const coin = Object.keys(wallet.coins)[i]
      wallet.coins[coin].dollarPrice = coin === 'USDT' ? 1 : await fetchPrice(`${coin}USDT`) as number
      wallet.coins[coin].dollarValue = wallet.coins[coin].volume * wallet.coins[coin].dollarPrice
    }

    const sorted = Object.keys(wallet.coins).sort((a, b) => wallet.coins[a].dollarValue - wallet.coins[b].dollarValue)
    wallet.data = wallet.data || {}
    wallet.data.baseCoin = sorted.pop() as string

    if (wallet.data.baseCoin === 'USDT') {
      wallet.data.currentMarket = {
        histories     : {},
        emaRatio      : NaN,
        shape         : NaN,
        name          : '',
        strength      : NaN,
        currentPrice  : NaN
      }
      wallet.data.prices = {}
    } else {
      const histories = await fetchSingleHistory(`${wallet.data.baseCoin}USDT`)  
      if (histories !== 'No response.') {
        const indexedHistories = await indexData(histories as {[key: string]: rawFrame[];})
        wallet.data.currentMarket.histories = indexedHistories as {[key: string]: indexedFrame[]}
      }
      wallet.data.currentMarket.name = `${wallet.data.baseCoin}USDT`
      wallet.data.currentMarket.currentPrice = wallet.coins[wallet.data.baseCoin].dollarPrice
      
      // if (!Object.keys(wallet.data.prices).length) {
      //   const data = await priceData.find().toArray();
      //   wallet.data.prices = data[0]      
      // }
    }
    return wallet
  } catch (error) {
      console.log(error)
  }  
}

async function fetchPrice(marketName: string) {
  try {
      const symbolName = marketName.replace('/', '')
      logEntry(`Fetching price for ${marketName}`)
      const rawPrice = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbolName}`) 
      const price = parseFloat(rawPrice.data.price)
      return price
  } catch (error) {
    console.log(error)
  }
}

async function fetchAllHistory(marketNames: string[]) {
  const n = marketNames.length
  const returnArray: {}[] = []

  for (let i = 0; i < n; i++) {
    try {
      const response = await fetchSingleHistory(marketNames[i].replace('/', ''))
      currentTask = `Fetching history for ${i+1}/${marketNames.length} - ${marketNames[i]} ... ${response === 'No response.' ? response : ''}`
      logEntry(currentTask)

      if (response !== 'No response.') {
        const indexedHistories = await indexData(response)
        returnArray.push({
          name: marketNames[i],
          histories: indexedHistories
        })
      }
      await refreshWallet(wallet)
    } catch (error) {
      console.log(error)
    }

  }
  return returnArray
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

async function indexData(rawHistories: { [key: string]: rawFrame[]}) {
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

async function addEmaRatio(markets: market[]) {

  try {
    const spans = [
      500, 377, 233, 144, 89, 55, 34, 
      21, 13, 8, 5, 3, 2, 1
    ]
    
    markets.map(market => {
      const frameRatioEmas = Object.keys(timeScales).map(timeScale => {
        const emas = spans.map(span => 
          
          ema(extractData(market.histories[timeScale], 'average'), span)
        )
        return ema(ratioArray(emas))
      })

      market.emaRatio = ema(frameRatioEmas)
    })
    return markets
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

async function addShape(markets: market[]) {

  markets.map(market => {

    const shapes = Object.keys(timeScales).map(timeScale => {

      const m = market.histories[timeScale].length
      const totalChange = market.histories[timeScale][m - 1].average - market.histories[timeScale][0].average
      const percentageChange = totalChange / market.histories[timeScale][0].average * 100
      let straightLineIncrement = totalChange / m
      let deviations: number[] = []
      let straightLine = market.histories[timeScale][0].average
  
      market.histories[timeScale].map(frame => {
        straightLine += straightLineIncrement
        deviations.push(frame.low < straightLine ? frame.low / straightLine : -(Math.abs(frame.high / straightLine)))
      })
  
      const shape = percentageChange * ema(deviations)
      return shape
    })
    market.shape = ema(shapes)
  })
  return markets
}

function filterMarkets(markets: market[]) {
  return markets.filter(market => 
    market.shape as number > 0 
    && 
    market.emaRatio as number > 1
  )
}

function logMarkets(markets: market[]) {
  ranking = markets.map(market => {
    const report = `${market.name} ... shape ${n(market.shape as number)} * ema ratio ${n(market.emaRatio as number)} = strength ${n(market.strength as number)}`
    logEntry(report)
    return report
  })
}

function n(number: number, decimals: number=2) {
  let outputNumber = parseFloat(number.toFixed(decimals))
  if (!outputNumber) {outputNumber = n(number, decimals+1) as number}
  return outputNumber
}

// TRADE FUNCTIONS

async function trade(markets: market[], wallet: wallet) {
  const targetMarket = markets[0].strength as number > 0 ? markets[0] : null

  if (wallet.data.baseCoin === 'USDT') {   

    if (!targetMarket) {
      logEntry('No bullish markets')
    } else if (wallet.coins[wallet.data.baseCoin].volume > 10) {
      await simulatedBuyOrder(wallet, targetMarket)
    } 
  } else {
    try {
      const currentMarket = markets.filter((market: market) => market.name === wallet.data.currentMarket.name)[0]

      if (!targetMarket) {

        logEntry('No bullish markets')
        await simulatedSellOrder(wallet, 'Current market bearish', currentMarket)

      } else {

        if (!currentMarket) {
          await simulatedSellOrder(wallet, 'No response for current market', wallet.data.currentMarket as market)
        } else if (targetMarket.name !== wallet.data.currentMarket.name) { 
          await simulatedSellOrder(wallet, 'Better market found', currentMarket)
        } else if (!wallet.data.prices.targetPrice || !wallet.data.prices.stopLossPrice) {
          await simulatedSellOrder(wallet, 'Price information undefined', currentMarket)
        } else if (wallet.data.currentMarket.currentPrice as number < wallet.data.prices.stopLossPrice) {
          await simulatedSellOrder(wallet, 'Below Stop Loss', currentMarket)
        }
      }
    } catch(error) {
      console.log(error)
    }
  }
}

function sortMarkets(markets: market[]) {
  markets = markets.map(market => {
    const emaRatio = market.emaRatio as number | undefined;
    const shape = market.shape as number | undefined;
    market.strength = emaRatio && shape ? emaRatio * shape : 0;
    return market;
  })
  markets = markets.sort((a,b) => (b.strength as number) - (a.strength as number))
  return markets
}

async function simulatedBuyOrder(wallet: wallet, market: market) {
  try {
    const asset = market.name.replace(wallet.data.baseCoin, '')
    const base  = wallet.data.baseCoin
    const response = await fetchPrice(market.name)
    await refreshWallet(wallet)

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
        highPrice     : currentPrice
      }

      wallet.data.currentMarket = market
      // await dbOverwrite(priceData, wallet.data.prices as {})
      const tradeReport = `${timeNow()} - Bought ${n(wallet.coins[asset].volume)} ${asset} @ ${n(currentPrice)} = $${n(baseVolume * (1 - fee))} ... Strength - ${n(market.strength as number)}`
      logEntry(tradeReport, 'transactions')
      // await dbAppend(tradeHistory, tradeReport)
    }
  } catch (error) {
    console.log(error)
  }
}

async function simulatedSellOrder(wallet: wallet, sellType: string, market: market) {

  try {
    await refreshWallet(wallet)
    const asset = wallet.data.currentMarket.name.replace('USDT', '')
    const base  = 'USDT'
    console.log(wallet)
    console.log(wallet.coins)
    console.log(asset)
    console.log(wallet.coins[asset])
    console.log(wallet.coins[asset].volume)
    const assetVolume = wallet.coins[asset].volume
    wallet.coins[base].volume += assetVolume * (1 - fee) * wallet.coins[asset].dollarPrice
    wallet.data.prices = {}
    // await dbOverwrite(priceData, wallet.data.prices as {})
    const tradeReport = `${timeNow()} - Sold   ${n(assetVolume)} ${asset} @ ${n(wallet.coins[asset].dollarPrice)} = $${n(wallet.coins[base].volume)} ... Strength - ${n(market.strength as number)}} ... ${sellType}`
    logEntry(tradeReport, 'transactions')
    // await dbAppend(tradeHistory, tradeReport)
    delete wallet.coins[asset]
  } catch (error) {
    console.log(error)
  }
}

run()

export {}