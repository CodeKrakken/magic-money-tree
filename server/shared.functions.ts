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

export function timeNow() {
  const currentTime = Date.now();
  const prettyTime = new Date(currentTime).toLocaleString();

  return prettyTime;
}

export function getCashBalance(wallet: WalletType) {
  return wallet.coins.USDT?.volume ?? 0;
}