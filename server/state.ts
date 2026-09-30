import {
  WalletType,
  market,
  PortfolioSnapshot
} from '@magic-money-tree/shared';

export type ServerState = {
  wallet: WalletType;
  currentTask: string;
  marketList: string[];
  viableSymbols: string[];
  markets: Record<string, market>;
  trading: boolean;
  tradingMode: 'simulation' | 'test' | 'live';
  scanIndex: number;
  portfolioHistory: PortfolioSnapshot[];
};

export const state: ServerState = {
  wallet: simulatedWallet(),
  currentTask: '',
  marketList: [],
  viableSymbols: [],
  markets: {},
  trading: false,
  tradingMode: 'simulation',
  scanIndex: 0,
  portfolioHistory: []
};

export const signalEntryEvents =
  new Set<string>();

export const previousSignals:
  Record<string, boolean> = {};

export function simulatedWallet(): WalletType {
  return {
    coins: {
      USDT: {
        volume: 100,
        dollarPrice: 1,
        dollarValue: 100
      }
    },

    data: {
      baseCoin: 'USDT',

      prices: {},

      currentMarket: {
        name: ''
      },

      positions: [],

      startingBalance: 100,

      realisedProfit: 0
    }
  };
}