interface positionTarget {
  name: string;
  returnPct: number;
  fraction: number;
  targetPrice: number;
  triggered: boolean;
}

export interface position {
  symbol: string;
  asset: string;
  quantity: number;
  originalQuantity: number;
  entryPrice: number;
  entryTime: number;
  entryNotional: number;
  entryFee: number;
  targets: positionTarget[];
  marketIndex: number;
}

export interface WalletType {
  coins: {
    [key: string]: {
      dollarPrice: number
      dollarValue: number
      volume: number
    }
  }
  data: {
    baseCoin: string
    prices: {
      targetPrice?: number
      highPrice?: number
      purchasePrice?: number
      stopLossPrice?: number
    }
    currentMarket: {
      name: string
    }
    positions: position[]
    startingBalance: number
    realisedProfit: number
  }
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
    [key: string]: indexedFrame[]
  }
  name: string
  currentPrice?: number
  slope20?: number
  slope50?: number
  acceleration?: number
  signal?: boolean
}

export type PortfolioSnapshot = {
  timestamp: number;
  values: Record<string, number>;
  total: number;
};