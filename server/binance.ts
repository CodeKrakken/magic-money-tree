import axios from "axios";
import { createHmac } from "crypto";
import { binanceApiKey, binanceSecretKey } from "./config.js";
import { state } from './state.js'
import { rawFrame } from "./shared.types.js";

const EXCHANGE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;

type SymbolFilterResult = {
  symbol      : string;
  minQty      : string;
  maxQty      : string;
  stepSize    : string;
  minPrice    : string;
  maxPrice    : string;
  tickSize    : string;
  minNotional : string;
};

let exchangeInfoCache: {
  fetchedAt : number;
  bySymbol  : Record<string, SymbolFilterResult>;
} | null = null;

const timeScales: { [key: string]: string } = {
  minutes: 'm',
};

function getFilterMapFromExchangeInfo(
  symbolInfo: {
    symbols: Array<{
      symbol  : string;
      filters : Array<{
        filterType  : string;
        minQty?     : string;
        maxQty?     : string;
        stepSize?   : string;
        minPrice?   : string;
        maxPrice?   : string;
        tickSize?   : string;
        minNotional?: string;
      }>
    }>
  }
): Record<string, SymbolFilterResult> {

  const bySymbol: Record<string, SymbolFilterResult> = {};

  for (const symbolEntry of symbolInfo.symbols) {
    const filters = symbolEntry.filters;

    const found = {
      symbol      : symbolEntry.symbol,
      minQty      : '0',
      maxQty      : '0',
      stepSize    : '0',
      minPrice    : '0',
      maxPrice    : '0',
      tickSize    : '0',
      minNotional : '0'
    };


    for (const filter of filters) {

      switch (filter.filterType) {
        case 'LOT_SIZE':  {
          found.minQty   = filter.minQty   ?? found.minQty;
          found.maxQty   = filter.maxQty   ?? found.maxQty;
          found.stepSize = filter.stepSize ?? found.stepSize;
          break;
        }

        case 'PRICE_FILTER':  {
          found.minPrice = filter.minPrice ?? found.minPrice;
          found.maxPrice = filter.maxPrice ?? found.maxPrice;
          found.tickSize = filter.tickSize ?? found.tickSize;
          break;
        }

        case 'MIN_NOTIONAL':
        case 'NOTIONAL':  {
          found.minNotional = filter.minNotional ?? found.minNotional;
          break;
        }
      }
    }

    bySymbol[symbolEntry.symbol] = found;
  }

  return bySymbol;
}

async function refreshExchangeInfoCache(
  force = false
): Promise<Record<string, SymbolFilterResult>> {
  
  const now = Date.now();

  if (
    !force &&
    exchangeInfoCache &&
    now - exchangeInfoCache.fetchedAt < EXCHANGE_INFO_CACHE_TTL_MS
  ) {
    return exchangeInfoCache.bySymbol;
  }

  const response = await axios.get(
    'https://api.binance.com/api/v3/exchangeInfo',
    { timeout: 15000 }
  );

  const bySymbol = getFilterMapFromExchangeInfo(response.data);

  exchangeInfoCache = {
    fetchedAt: now,
    bySymbol
  };

  return bySymbol;
}

async function getExchangeFiltersForSymbol(
  symbol: string
): Promise<SymbolFilterResult | null> {

  const bySymbol = await refreshExchangeInfoCache();
  return bySymbol[symbol] ?? null;
}

type OrderSuccess = {
  ok: true;
  quantity: string;
  price: string;
  notional: string;
}

type OrderFailure = {
  ok: false;
  reason: string;
}

function validateOrderAgainstFilters(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  price: string,
  filters: SymbolFilterResult
) : OrderSuccess | OrderFailure {

  const normalisedPrice     = normaliseDecimalString(price);
  const minQty              = normaliseDecimalString(filters.minQty);
  const maxQty              = normaliseDecimalString(filters.maxQty);
  const stepSize            = normaliseDecimalString(filters.stepSize);
  const minPrice            = normaliseDecimalString(filters.minPrice);
  const maxPrice            = normaliseDecimalString(filters.maxPrice);
  const tickSize            = normaliseDecimalString(filters.tickSize);
  const minNotional         = normaliseDecimalString(filters.minNotional);
  
  let validQuantity         = normaliseDecimalString(quantity);

  if (stepSize !== '0') {
    validQuantity = roundDownToStep(validQuantity, stepSize);
  }

  if (
    compareDecimalStrings(validQuantity, minQty) < 0 &&
    minQty !== '0'
  ) return {
    ok: false,
    reason: `${symbol} quantity ${validQuantity} is below MIN_QTY ${minQty}.`
  };
  
  if (
    maxQty !== '0' &&
    compareDecimalStrings(validQuantity, maxQty) > 0
  ) return {
    ok: false,
    reason: `${symbol} quantity ${validQuantity} exceeds MAX_QTY ${maxQty}.`
  };
  
  let validPrice = normalisedPrice;

  if (tickSize !== '0') validPrice = roundToTickSize(validPrice, tickSize);

  if (
    minPrice !== '0' &&
    compareDecimalStrings(validPrice, minPrice) < 0
  ) return {
    ok: false,
    reason:
      `${symbol} price ${validPrice} is below MIN_PRICE ${minPrice}.`
  };
  
  if (
    maxPrice !== '0' &&
    compareDecimalStrings(validPrice, maxPrice) > 0
  ) return {
    ok: false,
    reason:
      `${symbol} price ${validPrice} exceeds MAX_PRICE ${maxPrice}.`
  };
  
  const notional = multiplyDecimalStrings(
    validPrice,
    validQuantity
  );


  if (
    minNotional !== '0' &&
    compareDecimalStrings(notional, minNotional) < 0
  ) {
    return {
      ok: false,
      reason:
        `${symbol} order notional ${notional} is below MIN_NOTIONAL ${minNotional}.`
    };
  }

  if (
    side === 'BUY' &&
    minNotional !== '0' &&
    compareDecimalStrings(notional, minNotional) < 0
  ) {
    return {
      ok: false,
      reason:
        `${symbol} order notional ${notional} is below the minimum notional ${minNotional}.`
    };
  }

  return {
    ok: true,
    quantity: validQuantity,
    price: validPrice,
    notional
  };
}

function buildBinanceSignedOrderParams(
  marketName: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  price: string
) {
  const params = new URLSearchParams({
    symbol: marketName,
    side,
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity,
    price,
    recvWindow: '60000',
    timestamp: String(Date.now())
  });

  const signature = createHmac('sha256', binanceSecretKey)
    .update(params.toString())
    .digest('hex');

  return { params, signature };
}

type BinanceOrderState = {
  accepted: boolean;
  status: 'accepted' | 'rejected' | 'uncertain' | 'error';
  message: string;
  binanceCode?: number;
  binanceMessage?: string;
  symbol?: string;
  side?: 'BUY' | 'SELL';
  quantity?: string;
  price?: string;
};

async function submitBinanceOrder(
  side: 'BUY' | 'SELL',
  marketName: string,
  quantity: string,
  price: string
): Promise<BinanceOrderState> {
  if (state.tradingMode === 'simulation') {
    return {
      accepted: false,
      status: 'rejected',
      message: 'Simulation mode does not submit Binance orders.'
    };
  }

  if (!binanceApiKey || !binanceSecretKey) {
    return {
      accepted: false,
      status: 'error',
      message:
        'Binance API credentials are required for test or live orders.'
    };
  }

  const filters = await getExchangeFiltersForSymbol(marketName);

  if (!filters) {
    return {
      accepted: false,
      status: 'error',
      message:
        `Binance exchange filters are unavailable for ${marketName}.`
    };
  }

  const validated = validateOrderAgainstFilters(
    marketName,
    side,
    quantity,
    price,
    filters
  );

  if (!validated.ok) {
    return {
      accepted: false,
      status: 'rejected',
      message: validated.reason,
      symbol: marketName,
      side,
      quantity,
      price
    };
  }

  const endpoint = 'https://api.binance.com/api/v3/order';

  const { params, signature } =
    buildBinanceSignedOrderParams(
      marketName,
      side,
      validated.quantity,
      validated.price
    );

  try {
    const response = await axios.post(
      endpoint,
      `${params.toString()}&signature=${signature}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-MBX-APIKEY': binanceApiKey
        },
        timeout: 15000
      }
    );

    if (response.status >= 200 && response.status < 300) {
      const orderData = response.data as {
        status?: string;
        orderId?: string;
        symbol?: string;
        side?: 'BUY' | 'SELL';
      };

      const status = orderData.status ?? 'NEW';

      return {
        accepted: true,
        status: 'accepted',
        message:
          `Binance ${state.tradingMode} order request accepted for ${marketName}.`,
        symbol: marketName,
        side,
        quantity: validated.quantity,
        price: validated.price,
        binanceCode: 200,
        binanceMessage: status
      };
    }

    return {
      accepted: false,
      status: 'error',
      message:
        `Binance request for ${marketName} returned an unexpected HTTP status.`,
      symbol: marketName,
      side,
      quantity: validated.quantity,
      price: validated.price,
      binanceCode: response.status
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const responseData =
        error.response?.data as
          | { code?: number; msg?: string }
          | undefined;

      if (error.response) {
        return {
          accepted: false,
          status: 'rejected',
          message:
            `Binance ${marketName} order rejected: ${responseData?.msg ?? error.message}`,
          symbol: marketName,
          side,
          quantity,
          price,
          binanceCode: responseData?.code,
          binanceMessage:
            responseData?.msg ?? error.message
        };
      }

      return {
        accepted: false,
        status: 'uncertain',
        message:
          `Binance ${marketName} order response is uncertain because of a network timeout or connection issue. No duplicate retry was attempted.`,
        symbol: marketName,
        side,
        quantity,
        price,
        binanceMessage: error.message
      };
    }

    return {
      accepted: false,
      status: 'error',
      message:
        `Binance ${marketName} order failed unexpectedly.`,
      symbol: marketName,
      side,
      quantity,
      price,
      binanceMessage:
        error instanceof Error
          ? error.message
          : 'Unknown error'
    };
  }
}

export async function fetchSymbols() {
  try {
    const marketsResponse = await axios.get(
      'https://api.binance.com/api/v3/exchangeInfo'
    );

    if (marketsResponse) {
      const viableSymbols =
        analyseMarkets(marketsResponse.data.symbols);

      return viableSymbols;
    }
  } catch (error: any) {
    console.log(error.message);
    return [];
  }
}

type rawMarket = {
  status                : string
  symbol                : string
  isSpotTradingAllowed  : Boolean
  quoteAsset            : string
}

function analyseMarkets(allMarkets: rawMarket[]) {
  const goodMarketNames = allMarkets
    .filter(
      market =>
      market.quoteAsset === "USDT" &&
      market.isSpotTradingAllowed &&
      market.status === 'TRADING' &&
      isGoodSymbol(market.symbol)
    )
    .map(market => market.symbol);

  return goodMarketNames;
}

function isGoodSymbol(symbol: string) {
  return (
    !symbol.includes('UP')    &&
    !symbol.includes('DOWN')  &&
    !symbol.includes('BUSD')  &&
    !symbol.includes('TUSD')  &&
    !symbol.includes('USDC')  &&
    !symbol.includes(':')
  )
}

export async function fetchPrice(marketName: string) {
  let price = 0;

  try {
    const symbolName =
      marketName.replace('/', '');

    const rawPrice =
      await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbolName}`,
        { timeout: 10000 }
      );

    price = parseFloat(rawPrice.data.price);

    return price;
  } catch (error: any) {
    console.log(error.message);

    return price;
  }
}

export async function fetchSingleHistory(symbolName: string) {
  try {
    const histories: {
      [key: string]: rawFrame[]
    } = {};

    for (
      let i = 0;
      i < Object.keys(timeScales).length;
      i++
    ) {
      const timeScale =
        Object.keys(timeScales)[i];

      // The final Binance kline is the currently-forming 1-minute candle.
      // Keep 51 observations so the 50-period regression is available.
      const history =
        await axios.get(
          `https://api.binance.com/api/v3/klines?symbol=${symbolName}&interval=1${timeScales[timeScale]}&limit=51`,
          { timeout: 10000 }
        );

      histories[timeScale] =
        history.data;
    }

    return histories;
  } catch (error) {
    return 'No response.';
  }
}
