import {
  WalletType,
  market,
  PortfolioSnapshot
} from '@magic-money-tree/shared';
import { simulatedWallet } from './shared.functions';

export type ServerState = {
  wallet: WalletType;
  currentTask: string;
  marketList: string[];
  viableSymbols: string[];
  markets: Record<string, market>;
  trading: boolean;
  tradingMode: 'simulation' | 'test' | 'live';
  symbolIndex: number;
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
  symbolIndex: 0,
  portfolioHistory: []
};

export const signalEntryEvents =
  new Set<string>();

export const previousSignals:
  Record<string, boolean> = {};

