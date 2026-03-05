export interface wallet {
    coins: {
        [key: string]: {
            dollarPrice: number;
            dollarValue: number;
            volume: number;
        };
    };
    data: {
        baseCoin: string;
        prices: {
            targetPrice?: number;
            highPrice?: number;
            purchasePrice?: number;
            stopLossPrice?: number;
        };
        currentMarket: {
            name: string;
        };
    };
}
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
        [key: string]: indexedFrame[];
    };
    emaRatio?: number;
    shape?: number;
    name: string;
    strength?: number;
    currentPrice?: number;
}
export {};
//# sourceMappingURL=server.d.ts.map