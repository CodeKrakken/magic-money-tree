interface indexedFrame {
  startTime : number;
  open      : number;
  high      : number;
  low       : number;
  close     : number;
  endTime   : number;
  average   : number;
}

interface market {
  histories: {
    [key: string]: indexedFrame[]
  }
  emaRatio  : number
  shape     : number
  name      : string
  strength  : number
}

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

const log: string[] = [];
const axios = require("axios");
const express = require("express");
const app = express();
app.use(express.json());
const cors = require("cors");
const path = require("path");

app.use(cors());

app.use(express.static(path.join(__dirname, "build")));

app.get("/log", (req, res) => {
  const logJSON = JSON.stringify(log);
  res.setHeader('Content-Type', 'application/json');
  res.send(logJSON);
});

const port = process.env.PORT || 5000;

app.listen(port, () => {
  logEntry(`Server listening on port ${port}`);
});

const minimumDollarVolume = 28000000
const fee = 0.001
const stopLossThreshold = 0.78
const timeScales = {
  // months  : 'M', 
  // weeks   : 'w', 
  // days    : 'd', 
  // hours   : 'h', 
  minutes : 'm',
  seconds : 's'
}

async function run() {
  const i = 0
  logEntry(`Running at ${timeNow()}`)
  try {
    // await setupDB();
    // await dbAppend(tradeHistory, timeNow(), 'Running')
    const viableSymbols = await fetchSymbols()

    if (viableSymbols?.length) {

      const wallet = simulatedWallet()
      tick(wallet, viableSymbols, i)
    }
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

  logEntry('Setting up database ...')

  // await mongo.connect()
  // db = mongo.db(dbName);
  // priceData = db.collection("price-data")  
  // tradeHistory = db.collection("trade-history")
  // await dbOverwrite(priceData,    {sessionStart: timeNow()})
  // await dbOverwrite(tradeHistory, {sessionStart: timeNow()})
  logEntry("Database setup complete")
}

function logEntry (entry: string) {
  console.log(entry)
  log.push(entry)    
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

async function analyseMarkets(allMarkets) {
  const goodMarketNames = allMarkets.filter(
    market => market.status === 'TRADING' 
    && isGoodMarketName(market.symbol)
  )
  .map(market => market.symbol)
  const viableMarketNames = await getViableMarketNames(goodMarketNames)  
  return viableMarketNames
}

function isGoodMarketName(marketName) {
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

async function getViableMarketNames(marketNames) {
  const viableMarketNames: string[] = []
  const n = marketNames.length

  if (!n) { 
    logEntry('No viable markets.') 
  } else {

    for (let i = 0; i < n; i++) {
      const symbolName = marketNames[i].replace('/', '')

      logEntry(`Checking volume of ${i+1}/${n} - ${marketNames[i]}`)
      const response = await checkVolume(symbolName)

      if (!response.includes("Insufficient") && response !== "No response.") {
        viableMarketNames.push(marketNames[i])
        logEntry('Market included.')
      } else {
        logEntry(response)
      }
    }
    return viableMarketNames
  }
}

async function checkVolume(symbolName) {
  const twentyFourHour = await fetch24Hour(symbolName)
  return twentyFourHour.data ? `${twentyFourHour.data.quoteVolume < minimumDollarVolume ? 'Ins' : 'S'}ufficient volume.` : "No response."
}

async function fetch24Hour(symbolName) {
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

async function tick(wallet, viableSymbols, i) {
    try {
      logEntry(''+i)
      i++
      logEntry(`----- Tick at ${timeNow()} -----`)
      await refreshWallet(wallet)
      displayWallet(wallet)
      let markets = await fetchAllHistory(viableSymbols) as market[]
      if (markets.length) {
        markets = await addEmaRatio(markets) as market[]
        markets = await addShape(markets)
        markets = await filterMarkets(markets)
        markets = sortMarkets(markets)
        await displayMarkets(markets)
        await trade(markets, wallet)
      }
    } catch (error) {
      console.log(error)
    }
    tick(wallet, viableSymbols, i)
}

async function refreshWallet(wallet) {
  const n = Object.keys(wallet.coins).length

  for (let i = 0; i < n; i ++) {
    const coin = Object.keys(wallet.coins)[i]
    wallet.coins[coin].dollarPrice = coin === 'USDT' ? 1 : await fetchPrice(`${coin}USDT`)
    wallet.coins[coin].dollarValue = wallet.coins[coin].volume * wallet.coins[coin].dollarPrice
  }

  const sorted = Object.keys(wallet.coins).sort((a, b) => wallet.coins[a].dollarValue - wallet.coins[b].dollarValue)
  wallet.data = wallet.data || {}
  wallet.data.baseCoin = sorted.pop()

  if (wallet.data.baseCoin === 'USDT') {
    wallet.data.currentMarket = {
      name: ''
    }
    wallet.data.prices = {}
  } else {
    wallet.data.currentMarket = { 
      name: `${wallet.data.baseCoin}USDT`,
      currentPrice: wallet.coins[wallet.data.baseCoin].dollarPrice
    }
    
    // if (!Object.keys(wallet.data.prices).length) {
    //   const data = await priceData.find().toArray();
    //   wallet.data.prices = data[0]      
    // }
  }
  return wallet
}

async function fetchPrice(marketName) {
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

function displayWallet(wallet) {
  logEntry('Wallet')

  Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => {
    logEntry(`${wallet.coins[name].volume} ${name} @ ${wallet.coins[name].dollarPrice} = $${wallet.coins[name].dollarValue}`)
  })
  logEntry(`Total = $${getDollarTotal(wallet)}`)

  if (wallet.data.baseCoin !== 'USDT') {
    logEntry(`Target Price    - ${wallet.data.prices.targetPrice}`)
    logEntry(`High Price      - ${wallet.data.prices.highPrice}`)
    logEntry(`Purchase Price  - ${wallet.data.prices.purchasePrice}`)
    logEntry(`Stop Loss Price - ${wallet.data.prices.stopLossPrice}`)
  }
}

function getDollarTotal(wallet) {
  let total = 0

  Object.keys(wallet.coins).map(name => {
    total += wallet.coins[name].dollarValue
  })

  return total
}

async function fetchAllHistory(marketNames: string[]) {
  const n = marketNames.length
  const returnArray: {}[] = []

  for (let i = 0; i < n; i++) {
    try {
        logEntry(`Fetching history for ${i+1}/${marketNames.length} - ${marketNames[i]} ...`)
        
        const response = await fetchSingleHistory(marketNames[i].replace('/', ''))

        if (response === 'No response.') {
          logEntry(response)
        } else {
          const indexedHistories = await indexData(response)
          returnArray.push({
            name: marketNames[i],
            histories: indexedHistories
          })
        }
    } catch (error) {
      console.log(error)
    }
  }
  return returnArray
}

async function fetchSingleHistory(symbolName) {
  try {
    const histories = {}

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

async function indexData(rawHistories) {
  try {
    const indexedHistories = {}

    Object.keys(rawHistories).map(timeSpan => {
      const history: indexedFrame[] = []

      rawHistories[timeSpan].map(frame  => {
  
        const average = frame.slice(1, 5).map(element => parseFloat(element)).reduce((a,b)=>a+b)/4

        history.push(
          {
            startTime : frame[0],
            open      : parseFloat(frame[1]),
            high      : parseFloat(frame[2]),
            low       : parseFloat(frame[3]),
            close     : parseFloat(frame[4]),
            endTime   : frame[6],
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

async function addShape(markets) {

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
    market.shape = ema(shapes)/100
  })
  return markets
}

function filterMarkets(markets) {
  return markets.filter(market => 
    market.shape > 0 
    && 
    market.emaRatio > 1
  )
}

function displayMarkets(markets) {
  markets.map(market => {
    logEntry(`${market.name} ... shape ${market.shape} * ema ratio ${market.emaRatio} = strength ${market.strength}`)
  })
}

// TRADE FUNCTIONS

async function trade(markets, wallet) {
  
  const targetMarket = markets[0].strength > 0 ? markets[0] : null

  if (wallet.data.baseCoin === 'USDT') {   

    if (!targetMarket) {
      logEntry('No bullish markets')
    } else if (wallet.coins[wallet.data.baseCoin].volume > 10) {
      await simulatedBuyOrder(wallet, targetMarket)
    } 
  } else {
    try {
      const currentMarket = markets.filter(market => market.name === wallet.data.currentMarket.name)[0]

      if (!targetMarket) {

        logEntry('No bullish markets')
        await simulatedSellOrder(wallet, 'Current market bearish', currentMarket)

      } else {

        if (!currentMarket) {
          await simulatedSellOrder(wallet, 'No response for current market', wallet.data.currentMarket)
        } else if (targetMarket.name !== wallet.data.currentMarket.name) { 
          await simulatedSellOrder(wallet, 'Better market found', currentMarket)
        } else if (!wallet.data.prices.targetPrice || !wallet.data.prices.stopLossPrice) {
          await simulatedSellOrder(wallet, 'Price information undefined', currentMarket)
        } else if (wallet.data.currentMarket.currentPrice < wallet.data.prices.stopLossPrice) {
          await simulatedSellOrder(wallet, 'Below Stop Loss', currentMarket)
        }
      }
    } catch(error) {
      console.log(error)
    }
  }
}

function sortMarkets(markets) {

  markets = markets.map(market => {
    market.strength = market.emaRatio * market.shape
    return market
  })
  markets = markets.sort((a,b) => b.strength - a.strength)
  return markets
}

async function simulatedBuyOrder(wallet, market) {
  try {
    const asset = market.name.replace(wallet.data.baseCoin, '')
    const base  = wallet.data.baseCoin
    const response = await fetchPrice(market.name)

    if (response) {
      const currentPrice = response
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
      const tradeReport = `Bought ${wallet.coins[asset].volume} ${asset} @ ${currentPrice} ($${baseVolume * (1 - fee)}) [${market.shape}]`
      logEntry(tradeReport)
      // await dbAppend(tradeHistory, tradeReport)
    }
  } catch (error) {
    console.log(error)
  }
}

async function simulatedSellOrder(wallet, sellType, market) {

  try {
    const asset = wallet.data.currentMarket.name.split('/')[0]
    const base  = wallet.data.currentMarket.name.split('/')[1]
    console.log(wallet)
    console.log(wallet.coins)
    console.log(asset)
    console.log(wallet.coins[asset])
    console.log(wallet.coins[asset].volume)
    const assetVolume = wallet.coins[asset].volume
    wallet.coins[base].volume += assetVolume * (1 - fee) * wallet.coins[asset].dollarPrice
    wallet.data.prices = {}
    // await dbOverwrite(priceData, wallet.data.prices as {})
    const tradeReport = `${timeNow()} - Sold   ${assetVolume} ${asset} @ ${wallet.coins[asset].dollarPrice} ($${wallet.coins[base].volume}) ${market.shape ? `[${market.shape}]` : ''} [${sellType}]`
    logEntry(tradeReport)
    // await dbAppend(tradeHistory, tradeReport)
    delete wallet.coins[asset]
  } catch (error) {
    console.log(error)
  }
}

run()