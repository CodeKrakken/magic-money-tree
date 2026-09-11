import axios from 'axios';

export const RESEARCH_HORIZONS = [5, 10, 20, 50] as const;

export type Horizon = (typeof RESEARCH_HORIZONS)[number];

export interface BinanceDataCapability {
  name: string;
  endpoint: string;
  availableHistorically: 'yes' | 'partial' | 'no';
  availableRealtime: 'yes' | 'partial' | 'no';
  fields: string[];
  notes: string;
}

export const binanceDataCapabilities: BinanceDataCapability[] = [
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

export function auditBinanceDataSources(): BinanceDataCapability[] {
  return binanceDataCapabilities.map((item) => ({ ...item, fields: [...item.fields] }));
}

export interface KlinePoint {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
}

export interface TradeEvent {
  id: number;
  price: number;
  qty: number;
  quoteQty: number;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}

export interface DepthSnapshot {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  lastUpdateId: number;
  time: number;
}

export interface FeatureVector {
  priceReturnShort: number;
  priceReturnMedium: number;
  priceReturnLong: number;
  slopeShort: number;
  slopeMedium: number;
  slopeLong: number;
  acceleration: number;
  volatility: number;
  volatilityChange: number;
  distanceFromRecentHigh: number;
  distanceFromRecentLow: number;
  volume: number;
  volumeAcceleration: number;
  tradeFrequency: number;
  tradePressure: number;
  spread: number;
  orderBookImbalance: number;
  depthChange: number;
  relativeStrength: number;
  trendStrength: number;
}

export interface FutureReturnObservation {
  symbol: string;
  timestamp: number;
  features: FeatureVector;
  futureReturns: Record<number, number>;
}

export interface LegacySignalSnapshot {
  emaRatio: number;
  shape: number;
  strength: number;
}

export interface MarketObservation extends FutureReturnObservation {
  closePrice: number;
  volumeAtTimestamp: number;
  tradeCountAtTimestamp: number;
  legacySignals?: LegacySignalSnapshot;
}

export interface FeatureEvaluationSummary {
  feature: string;
  horizon: number;
  count: number;
  meanReturn: number;
  medianReturn: number;
  positiveRate: number;
  correlation: number;
  topQuartileMeanReturn: number;
  bottomQuartileMeanReturn: number;
  averagePositiveReturn: number;
  averageNegativeReturn: number;
  quartileMeans: number[];
  monotonicTrend: 'increasing' | 'decreasing' | 'flat' | 'mixed';
}

const defaultFeeRate = 0.001;
const defaultExecutionCost = 0.0005;

export function toKlinePoint(raw: any): KlinePoint {
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

export function toTradeEvent(raw: any): TradeEvent {
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

export function toDepthSnapshot(raw: any): DepthSnapshot {
  const bids = Array.isArray(raw.bids) ? raw.bids.map((level: any) => [Number(level[0]), Number(level[1])]) : [];
  const asks = Array.isArray(raw.asks) ? raw.asks.map((level: any) => [Number(level[0]), Number(level[1])]) : [];

  return {
    bids,
    asks,
    lastUpdateId: Number(raw.lastUpdateId ?? 0),
    time: Number(raw.time ?? Date.now())
  };
}

export async function fetchKlines(symbol: string, interval: string = '1m', limit: number = 500) {
  const response = await axios.get('https://api.binance.com/api/v3/klines', {
    params: { symbol, interval, limit }
  });

  return response.data.map((raw: any) => toKlinePoint(raw));
}

export async function fetchKlinesInRange(symbol: string, interval: string = '1m', startTime?: number, endTime?: number, limit: number = 1000) {
  const safeEnd = typeof endTime === 'number' ? endTime : Date.now();
  const safeStart = typeof startTime === 'number' ? startTime : safeEnd - (30 * 24 * 60 * 60 * 1000);

  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart || limit <= 0) return [];

  const all: KlinePoint[] = [];
  const seen = new Set<number>();
  let cursor = safeStart;
  const maxIterations = 250;
  const batchWindowMs = limit * 60 * 1000;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (cursor >= safeEnd) break;

    const batchEnd = Math.min(cursor + batchWindowMs, safeEnd);
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, startTime: cursor, endTime: batchEnd, limit }
    });

    const rows = response.data.map((raw: any) => toKlinePoint(raw));
    if (!rows.length) break;

    for (const row of rows) {
      if (!seen.has(row.closeTime)) {
        all.push(row);
        seen.add(row.closeTime);
      }
    }

    const lastRow = rows[rows.length - 1];
    const nextCursor = lastRow.closeTime + 1;

    if (nextCursor >= safeEnd) break;
    if (nextCursor <= cursor) break;

    cursor = nextCursor;
  }

  return all.sort((left, right) => left.openTime - right.openTime);
}

export async function fetchTrades(symbol: string, limit: number = 1000) {
  const response = await axios.get('https://api.binance.com/api/v3/trades', {
    params: { symbol, limit }
  });

  return response.data.map((raw: any) => toTradeEvent(raw));
}

export async function fetchDepth(symbol: string, limit: number = 20) {
  const response = await axios.get('https://api.binance.com/api/v3/depth', {
    params: { symbol, limit }
  });

  return toDepthSnapshot(response.data);
}

export async function fetchBookTicker(symbol: string) {
  const response = await axios.get('https://api.binance.com/api/v3/ticker/bookTicker', {
    params: { symbol }
  });

  return response.data;
}

export async function fetchTicker24hr(symbol: string) {
  const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
    params: { symbol }
  });

  return response.data;
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, next) => sum + next, 0) / values.length;
}

export function netReturn(grossReturn: number, feeRate: number = defaultFeeRate, executionCost: number = defaultExecutionCost) {
  return grossReturn - feeRate - executionCost;
}

export function makeDeterministicRandom(seed: number = 1337) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) ^ (t >>> 14);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

export function percentageChange(from: number, to: number) {
  if (!from) return 0;
  return (to - from) / from;
}

export function slope(values: number[], lookback: number) {
  const slice = values.slice(-lookback);
  if (slice.length < 2) return 0;
  const start = slice[0];
  const end = slice[slice.length - 1];
  return percentageChange(start, end) / Math.max(slice.length - 1, 1);
}

export function acceleration(values: number[], shortWindow: number, longWindow: number) {
  const shortSlope = slope(values, shortWindow);
  const longSlope = slope(values, longWindow);
  return shortSlope - longSlope;
}

export function rollingVolatility(values: number[], window: number) {
  const slice = values.slice(-window);
  return standardDeviation(slice);
}

export function recentHigh(values: number[], lookback: number) {
  const slice = values.slice(-lookback);
  return Math.max(...slice, 0);
}

export function recentLow(values: number[], lookback: number) {
  const slice = values.slice(-lookback);
  return Math.min(...slice, Number.POSITIVE_INFINITY);
}

export function estimateSpread(bidPrice: number | undefined, askPrice: number | undefined) {
  if (!bidPrice || !askPrice || askPrice <= bidPrice) return 0;
  return (askPrice - bidPrice) / ((bidPrice + askPrice) / 2);
}

export function estimateOrderBookImbalance(bids: Array<[number, number]>, asks: Array<[number, number]>) {
  const bidTotal = bids.reduce((sum, [, size]) => sum + size, 0);
  const askTotal = asks.reduce((sum, [, size]) => sum + size, 0);
  const total = bidTotal + askTotal;
  if (!total) return 0;
  return (bidTotal - askTotal) / total;
}

export function depthChange(bids: Array<[number, number]>, asks: Array<[number, number]>, previousBids: Array<[number, number]> = [], previousAsks: Array<[number, number]> = []) {
  const previousBidTotal = previousBids.reduce((sum, [, size]) => sum + size, 0);
  const previousAskTotal = previousAsks.reduce((sum, [, size]) => sum + size, 0);
  const currentBidTotal = bids.reduce((sum, [, size]) => sum + size, 0);
  const currentAskTotal = asks.reduce((sum, [, size]) => sum + size, 0);
  const totalBefore = previousBidTotal + previousAskTotal;
  const totalAfter = currentBidTotal + currentAskTotal;
  if (!totalBefore) return 0;
  return (totalAfter - totalBefore) / totalBefore;
}

export function estimateTradePressure(trades: TradeEvent[], lookback: number = 100) {
  const recent = trades.slice(-lookback);
  if (!recent.length) return 0;

  const buyers = recent.filter((trade) => trade.isBuyerMaker === false).reduce((sum, trade) => sum + trade.quoteQty, 0);
  const sellers = recent.filter((trade) => trade.isBuyerMaker === true).reduce((sum, trade) => sum + trade.quoteQty, 0);
  const total = buyers + sellers;
  if (!total) return 0;

  return (buyers - sellers) / total;
}

export function buildFeatureVector(
  closes: number[],
  volumes: number[] = [],
  tradeCounts: number[] = [],
  bidPrice?: number,
  askPrice?: number,
  bids: Array<[number, number]> = [],
  asks: Array<[number, number]> = [],
  previousBids: Array<[number, number]> = [],
  previousAsks: Array<[number, number]> = [],
  marketRelativeReturns: number[] = []
): FeatureVector {
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

export function computeFutureReturn(series: number[], index: number, horizon: number) {
  const entryPrice = series[index];
  if (!entryPrice || index >= series.length - 1) return 0;
  const futureIndex = Math.min(series.length - 1, index + horizon);
  const futurePrice = series[futureIndex];
  return percentageChange(entryPrice, futurePrice);
}

export function buildFutureReturnObservations(
  symbol: string,
  closes: number[],
  featuresAtIndex: (index: number) => FeatureVector,
  horizons: readonly number[] = RESEARCH_HORIZONS
): FutureReturnObservation[] {
  const observations: FutureReturnObservation[] = [];

  for (let index = 0; index < closes.length; index++) {
    const timestamp = index;
    const futureReturns: Record<number, number> = {};
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

export function ema(data: number[], time: number|null=null) {
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

export function ratioArray(valueArray: number[]) {
  const output: number[] = [];
  for (let i = 0; i < valueArray.length - 1; i++) {
    output.push(valueArray[i + 1] / valueArray[i]);
  }
  return output;
}

export function legacyEmaRatioFromSeries(closeSeries: number[]) {
  if (closeSeries.length < 2) return 0;

  const spans = [500, 377, 233, 144, 89, 55, 34, 21, 13, 8, 5, 3, 2, 1];
  const spanEmas: number[] = [];

  for (const span of spans) {
    const slice = closeSeries.slice(-span);
    if (slice.length > 1) {
      spanEmas.push(ema(slice, Math.min(span, slice.length)));
    }
  }

  if (spanEmas.length < 2) return 0;
  const ratios = ratioArray(spanEmas);
  if (!ratios.length) return 0;
  return ema(ratios, Math.min(ratios.length, 14));
}

export function legacyShapeFromSeries(closeSeries: number[], marketName: string = '') {
  if (closeSeries.length < 2) return 0;

  const m = closeSeries.length;
  const totalChange = closeSeries[m - 1] - closeSeries[0];
  const percentageChange = closeSeries[m - 1] / closeSeries[0];
  const straightLineIncrement = totalChange / m;
  let straightLine = closeSeries[0];
  const deviations: number[] = [];

  for (const value of closeSeries) {
    straightLine += straightLineIncrement;
    const deviation = value === straightLine ? 1 :
      value < straightLine ? value / straightLine :
      marketName.includes('USDT') ? value / straightLine : straightLine / value;
    deviations.push(deviation);
  }

  return percentageChange * ema(deviations, Math.min(deviations.length, 14));
}

export function buildLegacySignalsForSeries(closeSeries: number[], marketName: string = ''): LegacySignalSnapshot {
  const emaRatio = legacyEmaRatioFromSeries(closeSeries);
  const shape = legacyShapeFromSeries(closeSeries, marketName);
  const strength = emaRatio && shape ? emaRatio * shape : 0;

  return {
    emaRatio,
    shape,
    strength
  };
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }

  return sorted[midpoint];
}

export function quartileMeans(values: number[]) {
  if (!values.length) return [0, 0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const quartileCount = Math.max(1, Math.ceil(sorted.length / 4));
  const groups: number[] = [0, 0, 0, 0];

  for (let index = 0; index < 4; index++) {
    const start = Math.min(sorted.length, index * quartileCount);
    const end = Math.min(sorted.length, (index + 1) * quartileCount);
    const slice = sorted.slice(start, end);
    groups[index] = average(slice);
  }

  return groups;
}

export function monotonicityFromQuartiles(quartileMeans: number[]) {
  if (!quartileMeans.length) return 'flat';

  const diffs = quartileMeans.map((value, index, array) => index === 0 ? 0 : value - array[index - 1]);
  const increasing = diffs.slice(1).every((diff) => diff >= 0);
  const decreasing = diffs.slice(1).every((diff) => diff <= 0);

  if (increasing) return 'increasing';
  if (decreasing) return 'decreasing';
  if (diffs.slice(1).every((diff) => Math.abs(diff) < Number.EPSILON)) return 'flat';
  return 'mixed';
}

function buildQuartileMeans(
  pairs: Array<{ value: number; adjustedReturn: number }>
): number[] {
  if (!pairs.length) {
    return [0, 0, 0, 0];
  }

  pairs.sort((left, right) => left.value - right.value);

  const quartileIndex = Math.max(1, Math.floor(pairs.length / 4));
  const bounds = [
    { start: 0, end: Math.min(pairs.length, quartileIndex) },
    { start: quartileIndex, end: Math.min(pairs.length, quartileIndex * 2) },
    { start: quartileIndex * 2, end: Math.min(pairs.length, quartileIndex * 3) },
    { start: Math.max(0, pairs.length - quartileIndex), end: pairs.length }
  ];

  const quartileMeans = [0, 0, 0, 0];

  for (let index = 0; index < bounds.length; index++) {
    const { start, end } = bounds[index];
    if (start >= end) {
      continue;
    }

    let total = 0;
    for (let cursor = start; cursor < end; cursor++) {
      total += pairs[cursor].adjustedReturn;
    }

    quartileMeans[index] = total / (end - start);
  }

  return quartileMeans;
}

function buildQuartileMeansForPairs(
  pairs: Array<{ value: number; adjustedReturn: number }>
): number[] {
  if (!pairs.length) {
    return [0, 0, 0, 0];
  }

  const sorted = [...pairs].sort((left, right) => left.value - right.value);
  const bucketMeans = [0, 0, 0, 0];
  const bucketCounts = [0, 0, 0, 0];
  const bucketSize = Math.max(1, Math.ceil(sorted.length / 4));

  for (let index = 0; index < sorted.length; index++) {
    const bucketIndex = Math.min(3, Math.floor(index / bucketSize));
    const value = sorted[index];
    bucketMeans[bucketIndex] += value.adjustedReturn;
    bucketCounts[bucketIndex]++;
  }

  return bucketMeans.map((total, index) =>
    bucketCounts[index] ? total / bucketCounts[index] : 0
  );
}

function pearsonFromPairs(
  pairs: Array<{ value: number; adjustedReturn: number }>
): number {
  if (!pairs.length) {
    return 0;
  }

  let xMean = 0;
  let yMean = 0;
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (let index = 0; index < pairs.length; index++) {
    const entry = pairs[index];
    const xDelta = entry.value - xMean;
    const yDelta = entry.adjustedReturn - yMean;
    const count = index + 1;

    xMean += xDelta / count;
    yMean += yDelta / count;

    const xShift = entry.value - xMean;
    const yShift = entry.adjustedReturn - yMean;

    numerator += xDelta * yShift;
    xVariance += xDelta * xShift;
    yVariance += yDelta * yShift;
  }

  if (!xVariance || !yVariance) {
    return 0;
  }

  return numerator / Math.sqrt(xVariance * yVariance);
}

export function evaluateFeatureRelationship(
  observations: FutureReturnObservation[],
  featureKey: keyof FeatureVector,
  horizon: number,
  costAdjustment: number = defaultFeeRate + defaultExecutionCost
): FeatureEvaluationSummary {
  const pairs: Array<{ value: number; adjustedReturn: number }> = [];

  let totalReturn = 0;
  let positiveReturnTotal = 0;
  let positiveCount = 0;
  let negativeReturnTotal = 0;
  let negativeCount = 0;

  for (const observation of observations) {
    const value = observation.features[featureKey];
    const futureReturn = observation.futureReturns[horizon] ?? 0;
    if (!Number.isFinite(value)) {
      continue;
    }

    const adjustedReturn = futureReturn - costAdjustment;
    if (!Number.isFinite(adjustedReturn)) {
      continue;
    }

    pairs.push({ value, adjustedReturn });
    totalReturn += adjustedReturn;

    if (adjustedReturn > 0) {
      positiveReturnTotal += adjustedReturn;
      positiveCount++;
    }

    if (adjustedReturn < 0) {
      negativeReturnTotal += adjustedReturn;
      negativeCount++;
    }
  }

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

  const returns = pairs.map((entry) => entry.adjustedReturn);
  const meanReturn = totalReturn / pairs.length;
  const medianReturn = median(returns);
  const positiveRate = positiveCount / pairs.length;
  const correlation = pearsonFromPairs(pairs);
  const quartileMeans = buildQuartileMeansForPairs(pairs);
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
    averagePositiveReturn: positiveCount ? positiveReturnTotal / positiveCount : 0,
    averageNegativeReturn: negativeCount ? negativeReturnTotal / negativeCount : 0,
    quartileMeans: quartileMeans.length ? quartileMeans : [0, 0, 0, 0],
    monotonicTrend: monotonicityFromQuartiles(quartileMeans.length ? quartileMeans : [0, 0, 0, 0]),
  };
}

export function pearson(x: number[], y: number[]) {
  if (x.length !== y.length || x.length === 0) return 0;

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

  if (!xVariance || !yVariance) return 0;
  return numerator / Math.sqrt(xVariance * yVariance);
}

export function evaluateFeatureSet(
  observations: FutureReturnObservation[],
  featureKeys: Array<keyof FeatureVector>,
  horizons: readonly number[] = RESEARCH_HORIZONS
): FeatureEvaluationSummary[] {
  const results: FeatureEvaluationSummary[] = [];

  for (const featureKey of featureKeys) {
    for (const horizon of horizons) {
      results.push(evaluateFeatureRelationship(observations, featureKey, horizon));
    }
  }

  return results;
}

export function isGoodMarketName(marketName: string) {
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
    .filter((market: any) => market.status === 'TRADING' && isGoodMarketName(market.symbol))
    .map((market: any) => market.symbol);
}

export async function fetchBroadResearchUniverse(options: { maxSymbols?: number } = {}) {
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

export async function buildHistoricalResearchDataset(
  symbols: string[] = [],
  options: {
    limit?: number;
    interval?: string;
    minHistory?: number;
    horizons?: readonly number[];
    startTime?: number;
    endTime?: number;
  } = {}
): Promise<MarketObservation[]> {
  const limit = options.limit ?? 2000;
  const interval = options.interval ?? '1m';
  const minHistory = options.minHistory ?? 200;
  const horizons = options.horizons ?? RESEARCH_HORIZONS;
  const marketUniverse = symbols.length ? symbols : await fetchEligibleUsdtSymbols();
  const dataset: MarketObservation[] = [];

  const totalMarkets = marketUniverse.length;

  console.log(`Stage 2: Building historical dataset for ${totalMarkets} markets`);

  for (let marketIndex = 0; marketIndex < marketUniverse.length; marketIndex++) {
    const symbol = marketUniverse[marketIndex];

    try {
      console.log(
        `Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Fetching historical data`
      );

      const klines = typeof options.startTime === 'number' || typeof options.endTime === 'number'
        ? await fetchKlinesInRange(symbol, interval, options.startTime, options.endTime, limit) as KlinePoint[]
        : await fetchKlines(symbol, interval, limit) as KlinePoint[];

      console.log(
        `Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | ${klines.length} candles fetched`
      );

      if (klines.length < minHistory) {
        console.log(
          `Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Skipped: insufficient history`
        );
        continue;
      }

      const closes = klines.map((kline: KlinePoint) => kline.close);
      const volumes = klines.map((kline: KlinePoint) => kline.volume);
      const tradeCounts = klines.map((kline: KlinePoint) => kline.numberOfTrades);

      const totalObservations =
        closes.length - Math.max(...horizons) - 60;

      let lastReportedPercentage = -1;

      for (let index = 60; index < closes.length - Math.max(...horizons); index++) {
        const historyCloses = closes.slice(0, index + 1);
        const historyVolumes = volumes.slice(0, index + 1);
        const historyTradeCounts = tradeCounts.slice(0, index + 1);
        const features = buildFeatureVector(historyCloses, historyVolumes, historyTradeCounts);

        const futureReturns: Record<number, number> = {};
        for (const horizon of horizons) {
          if (index + horizon < closes.length) {
            futureReturns[horizon] = computeFutureReturn(closes, index, horizon);
          } else {
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
        const percentage = Math.floor(
          (completedObservations / totalObservations) * 100
        );

        if (percentage >= lastReportedPercentage + 10) {
          lastReportedPercentage = percentage;

          console.log(
            `Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Building observations ${percentage}%`
          );
        }
      }

      console.log(
        `Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Complete | ${totalObservations} observations`
      );
    } catch (error) {
      console.log(
        `Stage 2 | Market ${marketIndex + 1}/${totalMarkets} | ${symbol} | Failed`
      );
      continue;
    }
  }

  console.log(
    `Stage 2 complete | ${dataset.length} observations from ${totalMarkets} markets`
  );

  return dataset;
}

export function evaluateFeatureEvidence(
  observations: MarketObservation[],
  featureKey: keyof FeatureVector,
  horizons: readonly number[] = RESEARCH_HORIZONS,
  feeRate: number = defaultFeeRate,
  executionCost: number = defaultExecutionCost
) {
  const evidence: FeatureEvaluationSummary[] = [];

  for (const horizon of horizons) {
    const summary = evaluateFeatureRelationship(
      observations,
      featureKey,
      horizon,
      feeRate + executionCost
    );

    evidence.push(summary);
  }

  return evidence;
}

export function splitResearchPeriods(observations: MarketObservation[], trainRatio: number = 0.6, validationRatio: number = 0.2) {
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

export function evaluateLegacySignalEvidence(
  observations: MarketObservation[],
  horizons: readonly number[] = RESEARCH_HORIZONS,
  feeRate: number = defaultFeeRate,
  executionCost: number = defaultExecutionCost
) {
  const signalNames = ['shape', 'emaRatio', 'strength'] as const;
  const results: Record<string, FeatureEvaluationSummary[]> = {};

  for (const signalName of signalNames) {
    const evidence: FeatureEvaluationSummary[] = [];

    for (const horizon of horizons) {
      const values: number[] = [];
      const returns: number[] = [];
      let positiveCount = 0;
      let positiveReturnTotal = 0;
      let negativeCount = 0;
      let negativeReturnTotal = 0;
      let totalReturn = 0;

      for (const observation of observations) {
        const value = observation.legacySignals?.[signalName] ?? 0;
        const futureReturn = observation.futureReturns[horizon] ?? 0;

        if (!Number.isFinite(value)) {
          continue;
        }

        const adjustedReturn = futureReturn - feeRate - executionCost;
        if (!Number.isFinite(adjustedReturn)) {
          continue;
        }

        values.push(value);
        returns.push(adjustedReturn);
        totalReturn += adjustedReturn;

        if (adjustedReturn > 0) {
          positiveCount++;
          positiveReturnTotal += adjustedReturn;
        }

        if (adjustedReturn < 0) {
          negativeCount++;
          negativeReturnTotal += adjustedReturn;
        }
      }

      if (!values.length) {
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

      const meanReturn = totalReturn / values.length;
      const medianReturn = median(returns);
      const positiveRate = positiveCount / values.length;
      const correlation = pearson(values, returns);

      const sortedPairs = [...values].map((value, index) => ({
        value,
        adjustedReturn: returns[index]
      })).sort((left, right) => left.value - right.value);

      const quartileIndex = Math.max(1, Math.floor(sortedPairs.length / 4));
      const quartiles = [
        sortedPairs.slice(0, quartileIndex),
        sortedPairs.slice(quartileIndex, quartileIndex * 2),
        sortedPairs.slice(quartileIndex * 2, quartileIndex * 3),
        sortedPairs.slice(-quartileIndex)
      ].filter((group) => group.length > 0);

      const quartileMeans = quartiles.map((group) => average(group.map((entry) => entry.adjustedReturn)));
      const summary: FeatureEvaluationSummary = {
        feature: signalName,
        horizon,
        count: values.length,
        meanReturn,
        medianReturn,
        positiveRate,
        correlation,
        topQuartileMeanReturn: quartileMeans[quartileMeans.length - 1] ?? 0,
        bottomQuartileMeanReturn: quartileMeans[0] ?? 0,
        averagePositiveReturn: positiveCount ? positiveReturnTotal / positiveCount : 0,
        averageNegativeReturn: negativeCount ? negativeReturnTotal / negativeCount : 0,
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
