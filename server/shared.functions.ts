import { WalletType } from "@magic-money-tree/shared";

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