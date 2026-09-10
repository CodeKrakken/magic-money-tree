export declare const RESEARCH_HORIZONS: readonly [5, 10, 20, 50];
export type Horizon = (typeof RESEARCH_HORIZONS)[number];
export interface BinanceDataCapability {
    name: string;
    endpoint: string;
    availableHistorically: 'yes' | 'partial' | 'no';
    availableRealtime: 'yes' | 'partial' | 'no';
    fields: string[];
    notes: string;
}
export declare const binanceDataCapabilities: BinanceDataCapability[];
export declare function auditBinanceDataSources(): BinanceDataCapability[];
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
export declare function toKlinePoint(raw: any): KlinePoint;
export declare function toTradeEvent(raw: any): TradeEvent;
export declare function toDepthSnapshot(raw: any): DepthSnapshot;
export declare function fetchKlines(symbol: string, interval?: string, limit?: number): Promise<any>;
export declare function fetchKlinesInRange(symbol: string, interval?: string, startTime?: number, endTime?: number, limit?: number): Promise<KlinePoint[]>;
export declare function fetchTrades(symbol: string, limit?: number): Promise<any>;
export declare function fetchDepth(symbol: string, limit?: number): Promise<DepthSnapshot>;
export declare function fetchBookTicker(symbol: string): Promise<any>;
export declare function fetchTicker24hr(symbol: string): Promise<any>;
export declare function average(values: number[]): number;
export declare function netReturn(grossReturn: number, feeRate?: number, executionCost?: number): number;
export declare function makeDeterministicRandom(seed?: number): () => number;
export declare function standardDeviation(values: number[]): number;
export declare function percentageChange(from: number, to: number): number;
export declare function slope(values: number[], lookback: number): number;
export declare function acceleration(values: number[], shortWindow: number, longWindow: number): number;
export declare function rollingVolatility(values: number[], window: number): number;
export declare function recentHigh(values: number[], lookback: number): number;
export declare function recentLow(values: number[], lookback: number): number;
export declare function estimateSpread(bidPrice: number | undefined, askPrice: number | undefined): number;
export declare function estimateOrderBookImbalance(bids: Array<[number, number]>, asks: Array<[number, number]>): number;
export declare function depthChange(bids: Array<[number, number]>, asks: Array<[number, number]>, previousBids?: Array<[number, number]>, previousAsks?: Array<[number, number]>): number;
export declare function estimateTradePressure(trades: TradeEvent[], lookback?: number): number;
export declare function buildFeatureVector(closes: number[], volumes?: number[], tradeCounts?: number[], bidPrice?: number, askPrice?: number, bids?: Array<[number, number]>, asks?: Array<[number, number]>, previousBids?: Array<[number, number]>, previousAsks?: Array<[number, number]>, marketRelativeReturns?: number[]): FeatureVector;
export declare function computeFutureReturn(series: number[], index: number, horizon: number): number;
export declare function buildFutureReturnObservations(symbol: string, closes: number[], featuresAtIndex: (index: number) => FeatureVector, horizons?: readonly number[]): FutureReturnObservation[];
export declare function ema(data: number[], time?: number | null): number;
export declare function ratioArray(valueArray: number[]): number[];
export declare function legacyEmaRatioFromSeries(closeSeries: number[]): number;
export declare function legacyShapeFromSeries(closeSeries: number[], marketName?: string): number;
export declare function buildLegacySignalsForSeries(closeSeries: number[], marketName?: string): LegacySignalSnapshot;
export declare function median(values: number[]): number;
export declare function quartileMeans(values: number[]): number[];
export declare function monotonicityFromQuartiles(quartileMeans: number[]): "increasing" | "decreasing" | "flat" | "mixed";
export declare function evaluateFeatureRelationship(observations: FutureReturnObservation[], featureKey: keyof FeatureVector, horizon: number, costAdjustment?: number): FeatureEvaluationSummary;
export declare function pearson(x: number[], y: number[]): number;
export declare function evaluateFeatureSet(observations: FutureReturnObservation[], featureKeys: Array<keyof FeatureVector>, horizons?: readonly number[]): FeatureEvaluationSummary[];
export declare function isGoodMarketName(marketName: string): boolean | 0;
export declare function fetchEligibleUsdtSymbols(): Promise<any>;
export declare function fetchBroadResearchUniverse(options?: {
    maxSymbols?: number;
}): Promise<{
    source: string;
    universe: any;
    totalAvailable: any;
    selectedCount: any;
    limitation: string;
    notes: string[];
}>;
export declare function buildHistoricalResearchDataset(symbols?: string[], options?: {
    limit?: number;
    interval?: string;
    minHistory?: number;
    horizons?: readonly number[];
    startTime?: number;
    endTime?: number;
}): Promise<MarketObservation[]>;
export declare function evaluateFeatureEvidence(observations: MarketObservation[], featureKey: keyof FeatureVector, horizons?: readonly number[], feeRate?: number, executionCost?: number): FeatureEvaluationSummary[];
export declare function splitResearchPeriods(observations: MarketObservation[], trainRatio?: number, validationRatio?: number): {
    train: MarketObservation[];
    validation: MarketObservation[];
    test: MarketObservation[];
    trainEnd: number;
    validationEnd: number;
    total: number;
};
export declare function evaluateLegacySignalEvidence(observations: MarketObservation[], horizons?: readonly number[], feeRate?: number, executionCost?: number): Record<string, FeatureEvaluationSummary[]>;
export declare function buildResearchAudit(): {
    dataSources: BinanceDataCapability[];
    horizons: (5 | 10 | 20 | 50)[];
    feeRate: number;
    executionCost: number;
    notes: string[];
};
//# sourceMappingURL=research.d.ts.map