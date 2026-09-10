import axios from 'axios';
export const RESEARCH_HORIZONS = [5, 10, 20, 50];
export const binanceDataCapabilities = [
    {
        name: 'Klines / OHLCV',
        endpoint: '/api/v3/klines',
        availableHistorically: 'yes',
        availableRealtime: 'yes',
        fields: [
            'openTime',
            'open',
            'high',
            'low',
            'close',
            'volume',
            'closeTime',
            'quoteAssetVolume',
            'numberOfTrades',
            'takerBuyBaseVolume',
            'takerBuyQuoteVolume',
            'ignore'
        ],
        notes: 'The most reliable historical market data available from Binance for strategy research.'
    },
    {
        name: 'Recent trades / aggregated trades',
        endpoint: '/api/v3/trades',
        availableHistorically: 'partial',
        availableRealtime: 'yes',
        fields: [
            'tradeId',
            'price',
            'qty',
            'quoteQty',
            'time',
            'isBuyerMaker',
            'isBestMatch'
        ],
        notes: 'Can be fetched live and retained with a collector, but historical reconstruction requires a dedicated backfill job. Trade direction is partially observable via isBuyerMaker.'
    },
    {
        name: 'Order book depth',
        endpoint: '/api/v3/depth',
        availableHistorically: 'partial',
        availableRealtime: 'yes',
        fields: ['bids', 'asks', 'lastUpdateId'],
        notes: 'Useful for spread, imbalance, and depth-change features, but full historical depth series is not naturally available from a single REST endpoint without a custom collector.'
    },
    {
        name: 'Book ticker',
        endpoint: '/api/v3/ticker/bookTicker',
        availableHistorically: 'no',
        availableRealtime: 'yes',
        fields: ['bidPrice', 'bidQty', 'askPrice', 'askQty', 'symbol'],
        notes: 'Good for live spread and best bid/ask observations but not a historical backtest source unless collected over time.'
    },
    {
        name: '24hr ticker statistics',
        endpoint: '/api/v3/ticker/24hr',
        availableHistorically: 'partial',
        availableRealtime: 'yes',
        fields: [
            'symbol',
            'priceChange',
            'priceChangePercent',
            'weightedAvgPrice',
            'prevClosePrice',
            'lastPrice',
            'lastQty',
            'bidPrice',
            'bidQty',
            'askPrice',
            'askQty',
            'openPrice',
            'highPrice',
            'lowPrice',
            'volume',
            'quoteVolume',
            'openTime',
            'closeTime',
            'firstId',
            'lastId',
            'count'
        ],
        notes: 'Useful for short-term regime context but not a complete historical signal source unless saved over time.'
    },
    {
        name: 'Exchange metadata',
        endpoint: '/api/v3/exchangeInfo',
        availableHistorically: 'no',
        availableRealtime: 'yes',
        fields: ['symbols', 'status', 'baseAsset', 'quoteAsset', 'filters'],
        notes: 'Useful for symbol filtering and market eligibility but not predictive in itself.'
    }
];
export function auditBinanceDataSources() {
    return binanceDataCapabilities.map((item) => ({ ...item, fields: [...item.fields] }));
}
const defaultFeeRate = 0.001;
const defaultExecutionCost = 0.0005;
export function toKlinePoint(raw) {
    return {
        openTime: Number(raw[0]),
        open: Number(raw[1]),
        high: Number(raw[2]),
        low: Number(raw[3]),
        close: Number(raw[4]),
        volume: Number(raw[5]),
        closeTime: Number(raw[6]),
        quoteAssetVolume: Number(raw[7]),
        numberOfTrades: Number(raw[8]),
        takerBuyBaseVolume: Number(raw[9]),
        takerBuyQuoteVolume: Number(raw[10])
    };
}
export function toTradeEvent(raw) {
    return {
        id: Number(raw.id),
        price: Number(raw.price),
        qty: Number(raw.qty),
        quoteQty: Number(raw.quoteQty),
        time: Number(raw.time),
        isBuyerMaker: Boolean(raw.isBuyerMaker),
        isBestMatch: Boolean(raw.isBestMatch)
    };
}
export function toDepthSnapshot(raw) {
    const bids = Array.isArray(raw.bids) ? raw.bids.map((level) => [Number(level[0]), Number(level[1])]) : [];
    const asks = Array.isArray(raw.asks) ? raw.asks.map((level) => [Number(level[0]), Number(level[1])]) : [];
    return {
        bids,
        asks,
        lastUpdateId: Number(raw.lastUpdateId ?? 0),
        time: Number(raw.time ?? Date.now())
    };
}
export async function fetchKlines(symbol, interval = '1m', limit = 500) {
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
        params: { symbol, interval, limit }
    });
    return response.data.map((raw) => toKlinePoint(raw));
}
export async function fetchKlinesInRange(symbol, interval = '1m', startTime, endTime, limit = 1000) {
    const safeEnd = typeof endTime === 'number' ? endTime : Date.now();
    const safeStart = typeof startTime === 'number' ? startTime : safeEnd - (30 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart || limit <= 0)
        return [];
    const all = [];
    const seen = new Set();
    let cursor = safeStart;
    const maxIterations = 250;
    const batchWindowMs = limit * 60 * 1000;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (cursor >= safeEnd)
            break;
        const batchEnd = Math.min(cursor + batchWindowMs, safeEnd);
        const response = await axios.get('https://api.binance.com/api/v3/klines', {
            params: { symbol, interval, startTime: cursor, endTime: batchEnd, limit }
        });
        const rows = response.data.map((raw) => toKlinePoint(raw));
        if (!rows.length)
            break;
        for (const row of rows) {
            if (!seen.has(row.closeTime)) {
                all.push(row);
                seen.add(row.closeTime);
            }
        }
        const lastRow = rows[rows.length - 1];
        const nextCursor = lastRow.closeTime + 1;
        if (nextCursor >= safeEnd)
            break;
        if (nextCursor <= cursor)
            break;
        cursor = nextCursor;
    }
    return all.sort((left, right) => left.openTime - right.openTime);
}
export async function fetchTrades(symbol, limit = 1000) {
    const response = await axios.get('https://api.binance.com/api/v3/trades', {
        params: { symbol, limit }
    });
    return response.data.map((raw) => toTradeEvent(raw));
}
export async function fetchDepth(symbol, limit = 20) {
    const response = await axios.get('https://api.binance.com/api/v3/depth', {
        params: { symbol, limit }
    });
    return toDepthSnapshot(response.data);
}
export async function fetchBookTicker(symbol) {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/bookTicker', {
        params: { symbol }
    });
    return response.data;
}
export async function fetchTicker24hr(symbol) {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
        params: { symbol }
    });
    return response.data;
}
export function average(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, next) => sum + next, 0) / values.length;
}
export function netReturn(grossReturn, feeRate = defaultFeeRate, executionCost = defaultExecutionCost) {
    return grossReturn - feeRate - executionCost;
}
export function makeDeterministicRandom(seed = 1337) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) ^ (t >>> 14);
        return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
    };
}
export function standardDeviation(values) {
    if (values.length < 2)
        return 0;
    const mean = average(values);
    const variance = average(values.map((value) => (value - mean) ** 2));
    return Math.sqrt(variance);
}
export function percentageChange(from, to) {
    if (!from)
        return 0;
    return (to - from) / from;
}
export function slope(values, lookback) {
    const slice = values.slice(-lookback);
    if (slice.length < 2)
        return 0;
    const start = slice[0];
    const end = slice[slice.length - 1];
    return percentageChange(start, end) / Math.max(slice.length - 1, 1);
}
export function acceleration(values, shortWindow, longWindow) {
    const shortSlope = slope(values, shortWindow);
    const longSlope = slope(values, longWindow);
    return shortSlope - longSlope;
}
export function rollingVolatility(values, window) {
    const slice = values.slice(-window);
    return standardDeviation(slice);
}
export function recentHigh(values, lookback) {
    const slice = values.slice(-lookback);
    return Math.max(...slice, 0);
}
export function recentLow(values, lookback) {
    const slice = values.slice(-lookback);
    return Math.min(...slice, Number.POSITIVE_INFINITY);
}
export function estimateSpread(bidPrice, askPrice) {
    if (!bidPrice || !askPrice || askPrice <= bidPrice)
        return 0;
    return (askPrice - bidPrice) / ((bidPrice + askPrice) / 2);
}
export function estimateOrderBookImbalance(bids, asks) {
    const bidTotal = bids.reduce((sum, [, size]) => sum + size, 0);
    const askTotal = asks.reduce((sum, [, size]) => sum + size, 0);
    const total = bidTotal + askTotal;
    if (!total)
        return 0;
    return (bidTotal - askTotal) / total;
}
export function depthChange(bids, asks, previousBids = [], previousAsks = []) {
    const previousBidTotal = previousBids.reduce((sum, [, size]) => sum + size, 0);
    const previousAskTotal = previousAsks.reduce((sum, [, size]) => sum + size, 0);
    const currentBidTotal = bids.reduce((sum, [, size]) => sum + size, 0);
    const currentAskTotal = asks.reduce((sum, [, size]) => sum + size, 0);
    const totalBefore = previousBidTotal + previousAskTotal;
    const totalAfter = currentBidTotal + currentAskTotal;
    if (!totalBefore)
        return 0;
    return (totalAfter - totalBefore) / totalBefore;
}
export function estimateTradePressure(trades, lookback = 100) {
    const recent = trades.slice(-lookback);
    if (!recent.length)
        return 0;
    const buyers = recent.filter((trade) => trade.isBuyerMaker === false).reduce((sum, trade) => sum + trade.quoteQty, 0);
    const sellers = recent.filter((trade) => trade.isBuyerMaker === true).reduce((sum, trade) => sum + trade.quoteQty, 0);
    const total = buyers + sellers;
    if (!total)
        return 0;
    return (buyers - sellers) / total;
}
export function buildFeatureVector(closes, volumes = [], tradeCounts = [], bidPrice, askPrice, bids = [], asks = [], previousBids = [], previousAsks = [], marketRelativeReturns = []) {
    const priceShort = closes.slice(-5);
    const priceMedium = closes.slice(-20);
    const priceLong = closes.slice(-50);
    const volumeSlice = volumes.slice(-20);
    const tradeSlice = tradeCounts.slice(-20);
    const relativeStrength = marketRelativeReturns.length ? average(marketRelativeReturns.slice(-10)) : 0;
    return {
        priceReturnShort: priceShort.length >= 2 ? percentageChange(priceShort[0], priceShort[priceShort.length - 1]) : 0,
        priceReturnMedium: priceMedium.length >= 2 ? percentageChange(priceMedium[0], priceMedium[priceMedium.length - 1]) : 0,
        priceReturnLong: priceLong.length >= 2 ? percentageChange(priceLong[0], priceLong[priceLong.length - 1]) : 0,
        slopeShort: slope(closes, 5),
        slopeMedium: slope(closes, 20),
        slopeLong: slope(closes, 50),
        acceleration: acceleration(closes, 5, 20),
        volatility: rollingVolatility(closes, 20),
        volatilityChange: rollingVolatility(closes, 20) - rollingVolatility(closes, 50),
        distanceFromRecentHigh: closes.length ? (closes[closes.length - 1] - recentHigh(closes, 20)) / recentHigh(closes, 20) : 0,
        distanceFromRecentLow: closes.length ? (closes[closes.length - 1] - recentLow(closes, 20)) / recentLow(closes, 20) : 0,
        volume: volumeSlice.length ? average(volumeSlice) : 0,
        volumeAcceleration: volumeSlice.length >= 2 ? percentageChange(volumeSlice[0], volumeSlice[volumeSlice.length - 1]) : 0,
        tradeFrequency: tradeSlice.length ? average(tradeSlice) : 0,
        tradePressure: 0,
        spread: estimateSpread(bidPrice, askPrice),
        orderBookImbalance: estimateOrderBookImbalance(bids, asks),
        depthChange: depthChange(bids, asks, previousBids, previousAsks),
        relativeStrength,
        trendStrength: slope(closes, 20) + slope(closes, 5),
    };
}
export function computeFutureReturn(series, index, horizon) {
    const entryPrice = series[index];
    if (!entryPrice || index >= series.length - 1)
        return 0;
    const futureIndex = Math.min(series.length - 1, index + horizon);
    const futurePrice = series[futureIndex];
    return percentageChange(entryPrice, futurePrice);
}
export function buildFutureReturnObservations(symbol, closes, featuresAtIndex, horizons = RESEARCH_HORIZONS) {
    const observations = [];
    for (let index = 0; index < closes.length; index++) {
        const timestamp = index;
        const futureReturns = {};
        for (const horizon of horizons) {
            futureReturns[horizon] = computeFutureReturn(closes, index, horizon);
        }
        observations.push({
            symbol,
            timestamp,
            features: featuresAtIndex(index),
            futureReturns
        });
    }
    return observations;
}
export function ema(data, time = null) {
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
export function ratioArray(valueArray) {
    const output = [];
    for (let i = 0; i < valueArray.length - 1; i++) {
        output.push(valueArray[i + 1] / valueArray[i]);
    }
    return output;
}
export function legacyEmaRatioFromSeries(closeSeries) {
    if (closeSeries.length < 2)
        return 0;
    const spans = [500, 377, 233, 144, 89, 55, 34, 21, 13, 8, 5, 3, 2, 1];
    const spanEmas = [];
    for (const span of spans) {
        const slice = closeSeries.slice(-span);
        if (slice.length > 1) {
            spanEmas.push(ema(slice, Math.min(span, slice.length)));
        }
    }
    if (spanEmas.length < 2)
        return 0;
    const ratios = ratioArray(spanEmas);
    if (!ratios.length)
        return 0;
    return ema(ratios, Math.min(ratios.length, 14));
}
export function legacyShapeFromSeries(closeSeries, marketName = '') {
    if (closeSeries.length < 2)
        return 0;
    const m = closeSeries.length;
    const totalChange = closeSeries[m - 1] - closeSeries[0];
    const percentageChange = closeSeries[m - 1] / closeSeries[0];
    const straightLineIncrement = totalChange / m;
    let straightLine = closeSeries[0];
    const deviations = [];
    for (const value of closeSeries) {
        straightLine += straightLineIncrement;
        const deviation = value === straightLine ? 1 :
            value < straightLine ? value / straightLine :
                marketName.includes('USDT') ? value / straightLine : straightLine / value;
        deviations.push(deviation);
    }
    return percentageChange * ema(deviations, Math.min(deviations.length, 14));
}
export function buildLegacySignalsForSeries(closeSeries, marketName = '') {
    const emaRatio = legacyEmaRatioFromSeries(closeSeries);
    const shape = legacyShapeFromSeries(closeSeries, marketName);
    const strength = emaRatio && shape ? emaRatio * shape : 0;
    return {
        emaRatio,
        shape,
        strength
    };
}
export function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
    }
    return sorted[midpoint];
}
export function quartileMeans(values) {
    if (!values.length)
        return [0, 0, 0, 0];
    const sorted = [...values].sort((a, b) => a - b);
    const quartileCount = Math.max(1, Math.ceil(sorted.length / 4));
    const groups = [0, 0, 0, 0];
    for (let index = 0; index < 4; index++) {
        const start = Math.min(sorted.length, index * quartileCount);
        const end = Math.min(sorted.length, (index + 1) * quartileCount);
        const slice = sorted.slice(start, end);
        groups[index] = average(slice);
    }
    return groups;
}
export function monotonicityFromQuartiles(quartileMeans) {
    if (!quartileMeans.length)
        return 'flat';
    const diffs = quartileMeans.map((value, index, array) => index === 0 ? 0 : value - array[index - 1]);
    const increasing = diffs.slice(1).every((diff) => diff >= 0);
    const decreasing = diffs.slice(1).every((diff) => diff <= 0);
    if (increasing)
        return 'increasing';
    if (decreasing)
        return 'decreasing';
    if (diffs.slice(1).every((diff) => Math.abs(diff) < Number.EPSILON))
        return 'flat';
    return 'mixed';
}
export function evaluateFeatureRelationship(observations, featureKey, horizon, costAdjustment = defaultFeeRate + defaultExecutionCost) {
    const pairs = observations
        .map((observation) => {
        const value = observation.features[featureKey];
        const futureReturn = observation.futureReturns[horizon] ?? 0;
        const adjustedReturn = futureReturn - costAdjustment;
        return { value, adjustedReturn };
    })
        .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.adjustedReturn));
    if (!pairs.length) {
        return {
            feature: featureKey,
            horizon,
            count: 0,
            meanReturn: 0,
            medianReturn: 0,
            positiveRate: 0,
            correlation: 0,
            topQuartileMeanReturn: 0,
            bottomQuartileMeanReturn: 0,
            averagePositiveReturn: 0,
            averageNegativeReturn: 0,
            quartileMeans: [0, 0, 0, 0],
            monotonicTrend: 'flat',
        };
    }
    const values = pairs.map((entry) => entry.value);
    const returns = pairs.map((entry) => entry.adjustedReturn);
    const meanReturn = average(returns);
    const medianReturn = median(returns);
    const positiveRate = returns.filter((entry) => entry > 0).length / returns.length;
    const correlation = pearson(values, returns);
    const sortedPairs = [...pairs].sort((a, b) => a.value - b.value);
    const quartileIndex = Math.max(1, Math.floor(sortedPairs.length / 4));
    const quartiles = [
        sortedPairs.slice(0, quartileIndex),
        sortedPairs.slice(quartileIndex, quartileIndex * 2),
        sortedPairs.slice(quartileIndex * 2, quartileIndex * 3),
        sortedPairs.slice(-quartileIndex)
    ].filter((group) => group.length > 0);
    const quartileMeans = quartiles.map((group) => average(group.map((entry) => entry.adjustedReturn)));
    const topQuartileMeanReturn = quartileMeans[quartileMeans.length - 1] ?? 0;
    const bottomQuartileMeanReturn = quartileMeans[0] ?? 0;
    return {
        feature: featureKey,
        horizon,
        count: pairs.length,
        meanReturn,
        medianReturn,
        positiveRate,
        correlation,
        topQuartileMeanReturn,
        bottomQuartileMeanReturn,
        averagePositiveReturn: average(returns.filter((entry) => entry > 0)) || 0,
        averageNegativeReturn: average(returns.filter((entry) => entry < 0)) || 0,
        quartileMeans: quartileMeans.length ? quartileMeans : [0, 0, 0, 0],
        monotonicTrend: monotonicityFromQuartiles(quartileMeans.length ? quartileMeans : [0, 0, 0, 0]),
    };
}
export function pearson(x, y) {
    if (x.length !== y.length || x.length === 0)
        return 0;
    const xMean = average(x);
    const yMean = average(y);
    let numerator = 0;
    let xVariance = 0;
    let yVariance = 0;
    for (let index = 0; index < x.length; index++) {
        const xDelta = x[index] - xMean;
        const yDelta = y[index] - yMean;
        numerator += xDelta * yDelta;
        xVariance += xDelta * xDelta;
        yVariance += yDelta * yDelta;
    }
    if (!xVariance || !yVariance)
        return 0;
    return numerator / Math.sqrt(xVariance * yVariance);
}
export function evaluateFeatureSet(observations, featureKeys, horizons = RESEARCH_HORIZONS) {
    const results = [];
    for (const featureKey of featureKeys) {
        for (const horizon of horizons) {
            results.push(evaluateFeatureRelationship(observations, featureKey, horizon));
        }
    }
    return results;
}
export function isGoodMarketName(marketName) {
    return marketName.includes('USDT')
        && marketName.indexOf('USDT')
        && !marketName.includes('UP')
        && !marketName.includes('DOWN')
        && !marketName.includes('BUSD')
        && !marketName.includes('TUSD')
        && !marketName.includes('USDC')
        && !marketName.includes(':');
}
export async function fetchEligibleUsdtSymbols() {
    const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
    return response.data.symbols
        .filter((market) => market.status === 'TRADING' && isGoodMarketName(market.symbol))
        .map((market) => market.symbol);
}
export async function fetchBroadResearchUniverse(options = {}) {
    const maxSymbols = options.maxSymbols ?? 200;
    const symbols = await fetchEligibleUsdtSymbols();
    const selected = symbols.slice(0, maxSymbols);
    return {
        source: 'Binance Spot exchangeInfo (current public USDT markets)',
        universe: selected,
        totalAvailable: symbols.length,
        selectedCount: selected.length,
        limitation: 'This is the broadest defensible public approximation of the research universe, not a complete historical reconstruction of all Binance USDT markets that may have existed in the past. Public REST endpoints do not provide a reliable full historical symbol universe for delisted or suspended markets without custom historical archives or exchange snapshots.',
        notes: [
            'The current universe is intentionally not treated as the full historical universe.',
            'Eligibility is based on the current public exchangeInfo snapshot only as an approximation.',
            'Markets that disappeared historically are not retroactively excluded from the research design, but they cannot be reconstructed reliably from public REST alone.'
        ]
    };
}
export async function buildHistoricalResearchDataset(symbols = [], options = {}) {
    const limit = options.limit ?? 2000;
    const interval = options.interval ?? '1m';
    const minHistory = options.minHistory ?? 200;
    const horizons = options.horizons ?? RESEARCH_HORIZONS;
    const marketUniverse = symbols.length ? symbols : await fetchEligibleUsdtSymbols();
    const dataset = [];
    const totalMarkets = marketUniverse.length;
    console.log(`Stage 2: Building historical dataset for ${totalMarkets} markets`);
    for (let marketIndex = 0; marketIndex < marketUniverse.length; marketIndex++) {
        const symbol = marketUniverse[marketIndex];
        try {
            console.log(`Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Fetching historical data`);
            const klines = typeof options.startTime === 'number' || typeof options.endTime === 'number'
                ? await fetchKlinesInRange(symbol, interval, options.startTime, options.endTime, limit)
                : await fetchKlines(symbol, interval, limit);
            console.log(`Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | ${klines.length} candles fetched`);
            if (klines.length < minHistory) {
                console.log(`Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Skipped: insufficient history`);
                continue;
            }
            const closes = klines.map((kline) => kline.close);
            const volumes = klines.map((kline) => kline.volume);
            const tradeCounts = klines.map((kline) => kline.numberOfTrades);
            const totalObservations = closes.length - Math.max(...horizons) - 60;
            let lastReportedPercentage = -1;
            for (let index = 60; index < closes.length - Math.max(...horizons); index++) {
                const historyCloses = closes.slice(0, index + 1);
                const historyVolumes = volumes.slice(0, index + 1);
                const historyTradeCounts = tradeCounts.slice(0, index + 1);
                const features = buildFeatureVector(historyCloses, historyVolumes, historyTradeCounts);
                const futureReturns = {};
                for (const horizon of horizons) {
                    if (index + horizon < closes.length) {
                        futureReturns[horizon] = computeFutureReturn(closes, index, horizon);
                    }
                    else {
                        futureReturns[horizon] = 0;
                    }
                }
                const legacySignals = buildLegacySignalsForSeries(historyCloses, symbol);
                dataset.push({
                    symbol,
                    timestamp: klines[index].closeTime,
                    features,
                    futureReturns,
                    closePrice: closes[index],
                    volumeAtTimestamp: volumes[index],
                    tradeCountAtTimestamp: tradeCounts[index],
                    legacySignals
                });
                const completedObservations = index - 59;
                const percentage = Math.floor((completedObservations / totalObservations) * 100);
                if (percentage >= lastReportedPercentage + 10) {
                    lastReportedPercentage = percentage;
                    console.log(`Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Building observations ${percentage}%`);
                }
            }
            console.log(`Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Complete | ${totalObservations} observations`);
        }
        catch (error) {
            console.log(`Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Failed`);
            continue;
        }
    }
    console.log(`Stage 2 complete | ${dataset.length} observations from ${totalMarkets} markets`);
    return dataset;
}
export function evaluateFeatureEvidence(observations, featureKey, horizons = RESEARCH_HORIZONS, feeRate = defaultFeeRate, executionCost = defaultExecutionCost) {
    const evidence = [];
    for (const horizon of horizons) {
        const summary = evaluateFeatureRelationship(observations.map((observation) => ({
            symbol: observation.symbol,
            timestamp: observation.timestamp,
            features: observation.features,
            futureReturns: observation.futureReturns
        })), featureKey, horizon, feeRate + executionCost);
        evidence.push(summary);
    }
    return evidence;
}
export function splitResearchPeriods(observations, trainRatio = 0.6, validationRatio = 0.2) {
    const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);
    const total = sorted.length;
    const trainEnd = Math.floor(total * trainRatio);
    const validationEnd = Math.floor(total * (trainRatio + validationRatio));
    return {
        train: sorted.slice(0, trainEnd),
        validation: sorted.slice(trainEnd, validationEnd),
        test: sorted.slice(validationEnd),
        trainEnd,
        validationEnd,
        total
    };
}
export function evaluateLegacySignalEvidence(observations, horizons = RESEARCH_HORIZONS, feeRate = defaultFeeRate, executionCost = defaultExecutionCost) {
    const signalNames = ['shape', 'emaRatio', 'strength'];
    const results = {};
    for (const signalName of signalNames) {
        const evidence = [];
        for (const horizon of horizons) {
            const pairs = observations
                .map((observation) => {
                const value = observation.legacySignals?.[signalName] ?? 0;
                const futureReturn = observation.futureReturns[horizon] ?? 0;
                return { value, adjustedReturn: futureReturn - feeRate - executionCost };
            })
                .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.adjustedReturn));
            if (!pairs.length) {
                evidence.push({
                    feature: signalName,
                    horizon,
                    count: 0,
                    meanReturn: 0,
                    medianReturn: 0,
                    positiveRate: 0,
                    correlation: 0,
                    topQuartileMeanReturn: 0,
                    bottomQuartileMeanReturn: 0,
                    averagePositiveReturn: 0,
                    averageNegativeReturn: 0,
                    quartileMeans: [0, 0, 0, 0],
                    monotonicTrend: 'flat'
                });
                continue;
            }
            const values = pairs.map((entry) => entry.value);
            const returns = pairs.map((entry) => entry.adjustedReturn);
            const sortedPairs = [...pairs].sort((a, b) => a.value - b.value);
            const quartileIndex = Math.max(1, Math.floor(sortedPairs.length / 4));
            const quartiles = [
                sortedPairs.slice(0, quartileIndex),
                sortedPairs.slice(quartileIndex, quartileIndex * 2),
                sortedPairs.slice(quartileIndex * 2, quartileIndex * 3),
                sortedPairs.slice(-quartileIndex)
            ].filter((group) => group.length > 0);
            const quartileMeans = quartiles.map((group) => average(group.map((entry) => entry.adjustedReturn)));
            const summary = {
                feature: signalName,
                horizon,
                count: pairs.length,
                meanReturn: average(returns),
                medianReturn: median(returns),
                positiveRate: returns.filter((entry) => entry > 0).length / returns.length,
                correlation: pearson(values, returns),
                topQuartileMeanReturn: quartileMeans[quartileMeans.length - 1] ?? 0,
                bottomQuartileMeanReturn: quartileMeans[0] ?? 0,
                averagePositiveReturn: average(returns.filter((entry) => entry > 0)) || 0,
                averageNegativeReturn: average(returns.filter((entry) => entry < 0)) || 0,
                quartileMeans: quartileMeans.length ? quartileMeans : [0, 0, 0, 0],
                monotonicTrend: monotonicityFromQuartiles(quartileMeans.length ? quartileMeans : [0, 0, 0, 0])
            };
            evidence.push(summary);
        }
        results[signalName] = evidence;
    }
    return results;
}
export function buildResearchAudit() {
    return {
        dataSources: auditBinanceDataSources(),
        horizons: [...RESEARCH_HORIZONS],
        feeRate: defaultFeeRate,
        executionCost: defaultExecutionCost,
        notes: [
            'This research layer intentionally does not modify the live trading strategy.',
            'All candidate features must be evaluated using only information available at the decision timestamp.',
            'Future-return evaluation is measured at 5, 10, 20 and 50 minute horizons after fees and execution cost.',
            'Threshold tuning and strategy selection must be separated from the discovery process.'
        ]
    };
}
//# sourceMappingURL=research.js.map