interface wallet {
  coins: {
    [key: string]: {
      dollarPrice : number
      dollarValue : number
      volume      : number
    }
  }
  data: {
    baseCoin: string
    currentMarket: {
      name: string
      currentPrice?: number
    }
    prices: {
      targetPrice?: number
      highPrice?: number
      purchasePrice?: number
      stopLossPrice?: number
    }
  }
}

interface data {
  name: string;
  histories: {
    [key: string]: any
  };
}

interface periodObject {
  startTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  endTime: string;
  average: number;
}

interface histories {
  [key: string]: period[];
}

interface market {
  histories: histories
  emaRatio: number
  shape: number
  name: string
  strength: number
}

require('dotenv').config();

const fs = require('fs');
const ccxt = require('ccxt');
const axios = require('axios')
const { MongoClient } = require('mongodb');
const e = require('cors');
const { clear } = require('console');
const username = process.env.MONGODB_USERNAME
const password = process.env.MONGODB_PASSWORD
const uri = `mongodb+srv://${username}:${password}@cluster0.ra0fk.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const mongo = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
let db
let collection: {
  [key: string]: Function
} = {}
const dbName = "magic-money-tree";
const express = require('express');
const app = express();
const port = process.env.PORT || 8000;
const minimumDollarVolume = 28000000
const fee = 0.001
const stopLossThreshold = 0.78
const periods: {[key: string]: string} = {
  // months  : 'M', 
  // weeks   : 'w', 
  // days    : 'd', 
  // hours   : 'h', 
  minutes : 'm',
  seconds : 's'
}

const binance = new ccxt.binance({
  apiKey: process.env.API_KEY,
  secret: process.env.API_SECRET,
  'enableRateLimit': true,
});

const server = {
  run: async function() {
    try {
      await record(`---------- Running at ${timeNow()} ----------`)
      await setupDB();
      const viableMarketNames: string[] = await fetchMarkets()
      
      if (viableMarketNames.length) {
        const wallet: wallet = simulatedWallet()
        tick(wallet, viableMarketNames)
      }
    } catch (error) {
      console.log(error)
    }
  }
}

// async function run() {
//   try {
//     await record(`---------- Running at ${timeNow()} ----------`)
//     await setupDB();
//     const viableMarketNames = await fetchMarkets()
    
//     if (viableMarketNames.length) {
//       const wallet: wallet = simulatedWallet()
//       tick(wallet, viableMarketNames)
//     }
//   } catch (error) {
//     console.log(error)
//   }
// }

function record(report: string) {
  report = report.concat('\n')
  fs.appendFile(`server-trade-history.txt`, report, function(err: Error) {
    if (err) return console.log(err);
  })
}

function timeNow() {
  const currentTime = Date.now()
  const prettyTime = new Date(currentTime).toLocaleString()
  return prettyTime
}

async function setupDB() {
  console.log('Setting up database ...')
  await mongo.connect()
  db = mongo.db(dbName);
  collection = db.collection("price-data")
  await dbOverwrite({sessionStart: timeNow()})
  console.log("Database setup complete")
}

async function dbOverwrite(data: {[key: string]: string}) {
  const query = { key: data.key };
  const options = {
    upsert: true,
  };
  await collection.replaceOne(query, data, options);
}

async function fetchMarkets() {
  try {
    const markets: {} = await binance.load_markets()
    const viableMarketNames: string[] = await analyseMarkets(markets)
    return viableMarketNames
  } catch (error) {
    console.log(error)
    return []
  }
}

async function analyseMarkets(allMarkets: {}) {
  const goodMarketNames = Object.keys(allMarkets).filter(marketName => isGoodMarketName(marketName, allMarkets))
  const viableMarketNames = await getViableMarketNames(goodMarketNames)  
  return viableMarketNames
}

function isGoodMarketName(marketName: string, markets: {[key: string]: { active: boolean }}) {
  return markets[marketName].active
  && marketName.includes('/USDT') 
  && !marketName.includes('UP') 
  && !marketName.includes('DOWN') 
  && !marketName.includes('BUSD')
  && !marketName.includes('TUSD')
  && !marketName.includes('USDC')
  && !marketName.includes(':')
  // && marketName === 'GBP/USDT'
  // && !marketName.includes('BNB')
}

async function getViableMarketNames(marketNames: string[]) {
  const viableMarketNames = []
  const n = marketNames.length

  for (let i = 0; i < n; i++) {
    const symbolName = marketNames[i].replace('/', '')
    console.log(`Checking volume of ${i+1}/${n} - ${marketNames[i]}`)
    const response = await checkVolume(symbolName)

    if (!response.includes("Insufficient") && response !== "No response.") {
      viableMarketNames.push(marketNames[i])
      console.log('Market included.')
    } else {
      console.log(response)
    }
  }
  return viableMarketNames
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
        dollarPrice: 1000,
        dollarValue: 1
      }
    },
    data: {
      baseCoin: '',
      currentMarket: {
        name: ''
      },
      prices: {}
    }
  }
}

async function tick(wallet: wallet, viableMarketNames: string[]) {
  try {
    console.log(`----- Tick at ${timeNow()} -----`)
    await refreshWallet(wallet)
    displayWallet(wallet)
    let markets: market[] = await fetchAllHistory(viableMarketNames) as market[]
    markets = await addEmaRatio(markets) as market[]
    markets = await addShape(markets)
    markets = await filterMarkets(markets)
    markets = sortMarkets(markets)
    await displayMarkets(markets)
    await trade(markets, wallet)
  } catch (error) {
    console.log(error)
  }
  tick(wallet, viableMarketNames)
}

async function refreshWallet(wallet: wallet) {
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
      name: ''
    }
    wallet.data.prices = {}
  } else {
    wallet.data.currentMarket = { 
      name: `${wallet.data.baseCoin}/USDT`,
      currentPrice: wallet.coins[wallet.data.baseCoin].dollarPrice
    }
    
    if (!Object.keys(wallet.data.prices).length) {
      const data = await collection.find().toArray();
      wallet.data.prices = data[0]      
    }
  }
  return wallet
}

async function fetchPrice(marketName: string) {
  try {
    const symbolName = marketName.replace('/', '')
    console.log(`Fetching price for ${marketName}`)
    const rawPrice = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbolName}`) 
    const price: number = parseFloat(rawPrice.data.price) as number
    return price
  } catch (error) {clear
    console.log(error)
  }
}

function displayWallet(wallet: wallet) {
  console.log('Wallet')

  Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => {
    console.log(`${wallet.coins[name].volume} ${name} @ ${wallet.coins[name].dollarPrice} = $${wallet.coins[name].dollarValue}`)
  })
  console.log(`Total = $${getDollarTotal(wallet)}`)

  if (wallet.data.baseCoin !== 'USDT') {
    console.log(`Target Price    - ${wallet.data.prices.targetPrice}`)
    console.log(`High Price      - ${wallet.data.prices.highPrice}`)
    console.log(`Purchase Price  - ${wallet.data.prices.purchasePrice}`)
    console.log(`Stop Loss Price - ${wallet.data.prices.stopLossPrice}`)
  }
}

function getDollarTotal(wallet: wallet) {
  let total = 0

  Object.keys(wallet.coins).map(name => {
    total += wallet.coins[name].dollarValue
  })

  return total
}

async function fetchAllHistory(marketNames: string[]) {
  const n = marketNames.length
  const returnArray = []

  for (let i = 0; i < n; i++) {
    try {
      console.log(`Fetching history for ${i+1}/${marketNames.length} - ${marketNames[i]} ...`)
      const response = await fetchSingleHistory(marketNames[i].replace('/', ''))

      if (response === 'No response.') {
        console.log(response)
      } else { 
        const symbolObject = await annotateData({
          name      : marketNames[i],
          histories : response
        })

        returnArray.push(symbolObject)
      }
    } catch (error) {
      console.log(error)
    }
  }
  return returnArray
}

async function fetchSingleHistory(symbolName: string) {
  try {
    const histories: histories = {}

    for (let i = 0; i < Object.keys(periods).length; i++) {
      const period = Object.keys(periods)[i]
      const history = await axios.get(`https://api.binance.com/api/v1/klines?symbol=${symbolName}&interval=1${periods[period]}`, { timeout: 10000 })
      histories[period] = history.data
    }
    return histories
  } catch (error) {
    return 'No response.'
  }
}

async function annotateData(data: data) {
  try {
    const histories: histories = {}

    console.log('data')
    console.log(data)

    Object.keys(data.histories).map(timeSpan => {
      const history: periodObject[] = []

      data.histories[timeSpan].map((period: string[])  => {
  
        const average: number = period.slice(1, 5).map(element => parseFloat(element)).reduce((a,b)=>a+b)/4

        history.push(
          {
            startTime : period[0],
            open      : parseFloat(period[1]),
            high      : parseFloat(period[2]),
            low       : parseFloat(period[3]),
            close     : parseFloat(period[4]),
            endTime   : period[6],
            average   : average
          }
        )
      })
      histories[periods] = history
    })

    return {
      name      : data.name,
      histories : histories
    }
  
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
      const periodRatioEmas = Object.keys(periods).map(period => {
        const emas = spans.map((span: number) => 
          ema(market.histories[period], span,  'average')
        )
        return ema(ratioArray(emas as number[]))
      })

      market.emaRatio = ema(periodRatioEmas as number[])
    })
    return markets
  } catch (error) {
    console.log(error)
  }
}

function ratioArray(valueArray: number[]) {

  const ratioArray = []
  for (let i = 0; i < valueArray.length-1; i++) {
    ratioArray.push(valueArray[i+1]/valueArray[i])
  }
  return ratioArray
}

function ema(rawData: number[], time: number | null=null, parameter: string | null=null) {

  const data = +rawData[0] ? rawData : extractData(rawData, parameter as string)
  time = time ?? data.length
  const k = 2/(time + 1)
  const emaData = []
  emaData[0] = data[0]

  for (let i = 1; i < data.length; i++) {
    const newPoint: number = (data[i] * k) + (emaData[i-1] * (1-k))
    emaData.push(newPoint)
  }

  const currentEma: number = [...emaData].pop() as number
  return +currentEma
}

function extractData(dataArray: number[], key: string) {
  const outputArray: number[] = []

  dataArray.map((obj) => {
    outputArray.push(obj[key])
  })

  return outputArray
}

async function addShape(markets: market[]) {

  markets.map(market => {

    const shapes = Object.keys(periods).map(period => {

      const m = market.histories[period].length
      const totalChange = market.histories[period][m - 1].average - market.histories[period][0].average
      const percentageChange = totalChange / market.histories[period][0].average * 100
      let straightLineIncrement = totalChange / m

      let deviations: number[] = []
      let straightLine = market.histories[period][0].average
  
      market.histories[period].map(thisPeriod => {
        straightLine += straightLineIncrement
        deviations.push(thisPeriod.low < straightLine ? thisPeriod.low / straightLine : -(Math.abs(thisPeriod.high / straightLine)))
      })
  
      const shape = percentageChange * ema(deviations)
      return shape
    })
    market.shape = ema(shapes)/100
  })
    

  return markets
}

function filterMarkets(markets: market[]) {
  return markets.filter(market => 
    market.shape > 0 
    && 
    market.emaRatio > 1
    )
}

function displayMarkets(markets: market[]) {
  markets.map(market => {
    console.log(`${market.name} ... shape ${market.shape} * ema ratio ${market.emaRatio} = strength ${market.strength}`)
  })
}

// TRADE FUNCTIONS

async function trade(markets: market[], wallet: wallet) {
  
  const targetMarket = markets[0].strength > 0 ? markets[0] : null

  if (wallet.data.baseCoin === 'USDT') {   

    if (!targetMarket) {
      console.log('No bullish markets')
    } else if (wallet.coins[wallet.data.baseCoin].volume > 10) {
      await simulatedBuyOrder(wallet, targetMarket)
    } 
  } else {
    try {
      const currentMarket = markets.filter(market => market.name === wallet.data.currentMarket.name)[0]

      if (!targetMarket) {

        console.log('No bullish markets')
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
    market.strength = market.emaRatio * market.shape
    return market
  })
  markets = markets.sort((a,b) => b.strength - a.strength)
  return markets
}

async function simulatedBuyOrder(wallet: wallet, market: market) {
  try {
    const asset = market.name.split('/')[0]
    const base  = market.name.split('/')[1]
    const response: string | number = await fetchPrice(`${asset}${base}`) as string | number

    if (response !== 'No response.') {
      const currentPrice: number = response as number
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
      await dbOverwrite(wallet.data.prices as {})
      const tradeReport = `${timeNow()} - Bought ${wallet.coins[asset].volume} ${asset} @ ${currentPrice} ($${baseVolume * (1 - fee)}) [${market.shape}]`
      console.log(tradeReport)
      await record(tradeReport)
    }
  } catch (error) {
    console.log(error)
  }
}

async function simulatedSellOrder(wallet: wallet, sellType: string, market: market) {

  try {
    const asset: string = wallet.data.currentMarket.name.split('/')[0] as string
    const base  = wallet.data.currentMarket.name.split('/')[1]
    console.log(wallet)
    console.log(wallet.coins)
    console.log(asset)
    console.log(wallet.coins[asset])
    console.log(wallet.coins[asset].volume)
    const assetVolume = wallet.coins[asset].volume
    wallet.coins[base].volume += assetVolume * (1 - fee) * wallet.coins[asset].dollarPrice
    wallet.data.prices = {}
    await dbOverwrite(wallet.data.prices as {})
    const tradeReport = `${timeNow()} - Sold   ${assetVolume} ${asset} @ ${wallet.coins[asset].dollarPrice} ($${wallet.coins[base].volume}) ${market.shape ? `[${market.shape}]` : ''} [${sellType}]`
    console.log(tradeReport)
    record(tradeReport)
    delete wallet.coins[asset]
  } catch (error) {
    console.log(error)
  }
}

app.listen(port);

export default server