import { formatNumber, indexedFrame, market, position } from "@magic-money-tree/shared";
import { fetchPrice, fetchSingleHistory, fetchSymbols } from "./binance";
import { saveState } from "./database";
import { getCashBalance, timeNow } from "./shared.functions";
import { previousSignals, signalEntryEvents, state } from "./state";
import { accelerationThreshold, LONG_SLOPE, MAX_CONCURRENT_POSITIONS, MINIMUM_POSITION_NOTIONAL, POSITION_PERCENTAGE, SHORT_SLOPE, slopeThreshold, stopLossThreshold, targets } from "./config";
import { rawFrame, transaction } from "./shared.types";
import { logEntry } from "./utils/logging";

const { 
  wallet,
  log,
  markets,
  portfolioHistory
} = state

let { 
  symbolIndex,
  viableSymbols,
  trading,
  currentTask,
  marketList,

} = state

const fee = 0.001;

export async function tick() {
  try {
    /*
     * Once every market has been checked, save the portfolio,
     * refresh the Binance symbol list and begin another scan.
     */
    if (!viableSymbols[symbolIndex]) {
      await saveState(wallet, log, viableSymbols);

      console.log(
        `
          ----- Tick at ${timeNow()} | 
          ${wallet.data.positions.length}/${MAX_CONCURRENT_POSITIONS} positions | 
          $${formatNumber(getPortfolioValue(), 2)} portfolio -----
        `
      );

      symbolIndex = 0;

      viableSymbols =
        await fetchSymbols() as string[];

      trading = true;
    }

    const symbolName =
      viableSymbols[symbolIndex].replace('/', '');

    currentTask =
      `Checking market ${symbolName} ...`;

    console.log(currentTask);

    await updateMarket(
      symbolName,
      symbolIndex + 1
    );

    await refreshWallet();
    recordPortfolioSnapshotIfDue();

    /*
     * Position exits must be evaluated independently of the
     * market currently being scanned.
     */
    await manageOpenPositions();

    const sortedMarkets = sortMarkets();

    logMarkets(sortedMarkets);

    const roundedMarkets =
      roundObjects(
        sortedMarkets,
        [
          'currentPrice',
          'shortSlope',
          'longSlope',
          'acceleration'
        ]
      );

    formatMarketDisplay(roundedMarkets);

    const filteredMarkets =
      filterMarkets(sortedMarkets);

    if (trading) {
      await trade(filteredMarkets);
    }
  } catch (error: any) {
    console.log(error.message);
  }

  symbolIndex++;

  /*
   * Preserve the existing continuously-running architecture,
   * but yield to the event loop between markets.
   */
  setImmediate(() => {
    tick();
  });
}

async function updateMarket(
  symbolName: string,
  id: number | null = null
) {
  const response =
    await fetchSingleHistory(symbolName);

  if (id) {
    currentTask =
      `Fetching history of ${symbolName} ... ${response === 'No response.' ? response : ''}`;

    console.log(currentTask);
  }

  if (response !== 'No response.') {
    const indexedHistories =
      indexData(response) as {
        [key: string]: indexedFrame[]
      };

    let currentMarket: market = {
      name: symbolName,
      histories: indexedHistories
    };

    currentMarket =
      addSignalData(currentMarket);

    const signalIsActive = currentMarket.signal === true;
    const wasPreviouslyActive = previousSignals[symbolName] === true;

    // Only a false -> true transition creates a new entry event.
    if (signalIsActive && !wasPreviouslyActive) {
      signalEntryEvents.add(symbolName);
    }

    if (!signalIsActive) {
      signalEntryEvents.delete(symbolName);
    }

    previousSignals[symbolName] = signalIsActive;
    markets[symbolName] = currentMarket;
  }
}

function logMarkets(markets: market[]) {
  markets.map(market => {
    const report =
      `${market.name} ... shortSlope ${market.shortSlope} * acceleration ${market.acceleration} = ${market.signal ? 'SIGNAL' : 'no signal'}`;

    return report;
  });
}

function formatMarketDisplay(markets: market[]) {
  marketList = markets.map(market => {
    return `${market.name} ... shortSlope ${market.shortSlope} | longSlope ${market.longSlope} | acceleration ${market.acceleration} | ${market.signal ? 'SIGNAL' : 'no signal'}`;
  });
}

async function refreshWallet() {
  try {
    const coins = Object.keys(wallet.coins);

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];

      if (coin === 'USDT') {
        wallet.coins[coin].dollarPrice = 1;
      } else {
        wallet.coins[coin].dollarPrice =
          await fetchPrice(`${coin}USDT`) as number ||
          wallet.coins[coin].dollarPrice;
      }

      wallet.coins[coin].dollarValue =
        wallet.coins[coin].volume *
        wallet.coins[coin].dollarPrice;
    }

    /*
     * Keep currentMarket for compatibility with the existing
     * client, but it no longer represents the whole portfolio.
     */
    const openPositions =
      wallet.data.positions;

    if (openPositions.length > 0) {
      wallet.data.currentMarket.name =
        openPositions[openPositions.length - 1].symbol;
    } else {
      wallet.data.currentMarket.name = '';
      wallet.data.prices = {};
    }

    wallet.data.baseCoin = 'USDT';

    /*
     * Update legacy price fields from the most recently opened
     * position so existing UI code still has sensible values.
     */
    const currentPosition =
      openPositions[openPositions.length - 1];

    if (currentPosition) {
      wallet.data.prices = {
        purchasePrice: currentPosition.entryPrice,
        stopLossPrice:
          currentPosition.entryPrice *
          stopLossThreshold,
        highPrice:
          currentPosition.entryPrice
      };
    }
  } catch (error: any) {
    console.log(error.message);
  }
}

function indexData(
  rawHistories: {
    [key: string]: rawFrame[]
  }
) {
  try {
    const indexedHistories: {
      [key: string]: indexedFrame[]
    } = {};

    Object.keys(rawHistories).map(timeSpan => {
      const history: indexedFrame[] = [];

      rawHistories[timeSpan].map(frame => {
        const average =
          frame
            .slice(1, 5)
            .map(element =>
              parseFloat(element as string)
            )
            .reduce((a, b) => a + b) / 4;

        history.push({
          open: parseFloat(frame[1]),
          high: parseFloat(frame[2]),
          low: parseFloat(frame[3]),
          close: parseFloat(frame[4]),
          time: frame[6],
          average: average
        });
      });

      indexedHistories[timeSpan] =
        history;
    });

    return indexedHistories;
  } catch (error: any) {
    console.log(error.message);
  }
}

function regressionSlope(
  closes: number[]
): number {
  const n = closes.length;

  if (n < 2) {
    return 0;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const y = closes[i];

    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }

  const denominator =
    n * sumXX -
    sumX * sumX;

  if (
    Math.abs(denominator) <
    Number.EPSILON
  ) {
    return 0;
  }

  return (
    (n * sumXY - sumX * sumY) /
    denominator
  );
}

function addSignalData(market: market) {
  try {
    const histories =
      market.histories.minutes;

    if (!histories || histories.length < 50) {
      market.shortSlope = 0;
      market.longSlope = 0;
      market.acceleration = 0;
      market.signal = false;
      return market;
    }

    /*
     * The final element is intentionally retained.
     *
     * Binance supplies the currently forming candle as the
     * final kline, so this is a live/current-candle signal,
     * not a completed-candle signal.
     */
    const closes =
      histories.map(frame => frame.close);

    const shortSlope =
      regressionSlope(
        closes.slice(SHORT_SLOPE)
      );

    const longSlope =
      regressionSlope(
        closes.slice(LONG_SLOPE)
      );

    const acceleration =
      shortSlope - longSlope;

    market.shortSlope = shortSlope;
    market.longSlope = longSlope;
    market.acceleration = acceleration;

    market.signal =
      shortSlope <= slopeThreshold &&
      acceleration >= accelerationThreshold;

    market.currentPrice =
      closes[closes.length - 1];

    return market;
  } catch (error: any) {
    console.log(error.message);

    market.shortSlope = 0;
    market.longSlope = 0;
    market.acceleration = 0;
    market.signal = false;

    return market;
  }
}

function filterMarkets(markets: market[]) {
  return markets.filter(market =>
    market.signal === true &&
    viableSymbols.includes(market.name)
  );
}

function roundObjects(
  inMarkets: market[],
  keys: (
    'currentPrice' |
    'shortSlope' |
    'longSlope' |
    'acceleration'
  )[]
) {
  const midMarkets: market[] = [];
  const outMarkets: market[] = [];

  inMarkets.map(market => {
    const outMarket: market = {
      ...market
    };

    keys.forEach(key => {
      if (typeof market[key] === 'number') {
        outMarket[key] =
          formatNumber(
            market[key] as number
          );
      }
    });

    midMarkets.push(outMarket);
  });

  inMarkets.map(market => {
    const outMarket: market = {
      ...market
    };

    keys.forEach(key => {
      const length =
        Math.max(
          ...midMarkets.map(market =>
            ('' + market[key])
              .split('.')[1]
              ?.length ?? 0
          )
        );

      if (typeof market[key] === 'number') {
        outMarket[key] =
          formatNumber(
            market[key] as number,
            length
          );
      }
    });

    outMarkets.push(outMarket);
  });

  function roundMarketNumber(
    inNumber: number,
    decimals: number = 2
  ) {
    if (!inNumber) {
      return inNumber;
    }

    let outNumber =
      Math.floor(
        inNumber *
        Math.pow(10, decimals)
      ) /
      Math.pow(10, decimals);

    if (
      (
        !outNumber ||
        midMarkets.some(outObj =>
          keys.some(
            key =>
              outObj[key] === outNumber
          )
        ) ||
        inMarkets.some(inObj =>
          keys.some(
            key =>
              inObj[key] === outNumber
          )
        )
      ) &&
      decimals < 100
    ) {
      outNumber =
        roundMarketNumber(
          inNumber,
          decimals + 1
        );
    }

    return outNumber;
  }

  /*
   * Preserve the original local rounding behaviour.
   * The nested helper above deliberately exists with a distinct
   * name so it does not collide with the global round function.
   */
  void roundMarketNumber;

  return outMarkets;
}

async function trade(
  sortedMarkets: market[]
) {
  if (
    wallet.data.positions.length >=
    MAX_CONCURRENT_POSITIONS
  ) {
    return;
  }

  const targetMarket =
    sortedMarkets.find(
      market =>
        signalEntryEvents.has(market.name)
    ) ?? null;

  if (!targetMarket) {
    console.log('No qualifying signal');
    return;
  }

  if (!targetMarket.signal) {
    return;
  }

  const cash =
    getCashBalance(wallet);

  const portfolioValue =
    getPortfolioValue();

  const desiredPositionNotional =
    Math.max(
      portfolioValue * POSITION_PERCENTAGE,
      MINIMUM_POSITION_NOTIONAL
    );

  const maximumAffordableNotional =
    cash / (1 + fee);

  if (
    maximumAffordableNotional <
    MINIMUM_POSITION_NOTIONAL
  ) {
    console.log(
      `Insufficient simulated cash for minimum position in ${targetMarket.name}. Cash: $${formatNumber(cash, 2)}`
    );

    return;
  }

  const positionNotional =
    Math.min(
      desiredPositionNotional,
      maximumAffordableNotional
    );

  await simulatedBuyOrder(
    targetMarket,
    positionNotional
  );
}

function sortMarkets() {
  let marketsToSort =
    Object.keys(markets)
      .map(market =>
        markets[market]
      );

  /*
   * This is the capacity-priority ordering used by the
   * historical portfolio research:
   *
   * 1. higher acceleration
   * 2. more negative shortSlope
   * 3. lower Binance array position
   * 4. symbol ascending
   */
  const sortedMarkets =
    marketsToSort.sort((a, b) => {
      const accelerationDifference =
        (b.acceleration ?? 0) -
        (a.acceleration ?? 0);

      if (accelerationDifference !== 0) {
        return accelerationDifference;
      }

      const slopeDifference =
        (a.shortSlope ?? 0) -
        (b.shortSlope ?? 0);

      if (slopeDifference !== 0) {
        return slopeDifference;
      }

      const aIndex =
        viableSymbols.indexOf(a.name);

      const bIndex =
        viableSymbols.indexOf(b.name);

      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }

      return a.name.localeCompare(
        b.name
      );
    });

  return sortedMarkets;
}




function getPortfolioValue() {
  let value = 0

  for (
    const coin
    of Object.values(wallet.coins)
  ) {
    value +=
      coin.volume *
      coin.dollarPrice;
  }
  return value;
}

async function simulatedBuyOrder(
  market: market,
  positionNotional: number
): Promise<boolean> {
  try {
    /*
     * Do not allow more than the configured number of
     * concurrent positions.
     */
    if (
      wallet.data.positions.length >=
      MAX_CONCURRENT_POSITIONS
    ) {
      return false;
    }

    /*
     * Recalculate available cash immediately before opening
     * the position.
     */
    const baseVolume =
      getCashBalance(wallet);

    const maximumAffordableNotional =
      baseVolume / (1 + fee);

    /*
     * Use the position size calculated by trade(), but never
     * spend more than the currently available cash allows.
     */
    const actualPositionNotional =
      Math.min(
        positionNotional,
        maximumAffordableNotional
      );

    /*
     * The minimum position is $10. If less than $10 can be
     * purchased, do not open the position.
     */
    if (
      actualPositionNotional <
      MINIMUM_POSITION_NOTIONAL
    ) {
      console.log(
        `Cannot open ${market.name}: available cash $${formatNumber(baseVolume, 2)} is insufficient for the $${formatNumber(MINIMUM_POSITION_NOTIONAL, 2)} minimum position.`
      );

      return false;
    }

    const totalCost =
      actualPositionNotional *
      (1 + fee);

    if (
      baseVolume <
      totalCost
    ) {
      console.log(
        `Cannot open ${market.name}: available cash $${formatNumber(baseVolume, 2)} is below required $${formatNumber(totalCost, 2)}.`
      );

      return false;
    }

    const currentPrice =
      await fetchPrice(
        market.name
      );

    if (
      !currentPrice ||
      currentPrice <= 0
    ) {
      return false;
    }

    /*
     * Consume the signal only after the purchase has passed
     * the validation checks.
     */
    signalEntryEvents.delete(
      market.name
    );

    const asset =
      market.name.replace(
        'USDT',
        ''
      );

    const orderQuantity =
      actualPositionNotional /
      currentPrice;

    const entryTime =
      Date.now();

    const positionTargets =
      targets.map(target => ({
        name: target.name,
        returnPct: target.returnPct,
        fraction: target.fraction,
        targetPrice:
          currentPrice *
          (1 + target.returnPct),
        triggered: false
      }));

    const newPosition: position = {
      symbol: market.name,
      asset,
      quantity: orderQuantity,
      originalQuantity: orderQuantity,
      entryPrice: currentPrice,
      entryTime,
      entryNotional: actualPositionNotional,
      entryFee:
        actualPositionNotional * fee,
      targets: positionTargets,
      marketIndex:
        viableSymbols.indexOf(
          market.name
        )
    };

    /*
     * Simulated execution:
     * asset purchase + entry fee.
     */
    wallet.coins.USDT.volume -=
      totalCost;

    if (!wallet.coins[asset]) {
      wallet.coins[asset] = {
        volume: 0,
        dollarPrice: currentPrice,
        dollarValue: 0
      };
    }

    wallet.coins[asset].volume +=
      orderQuantity;

    wallet.coins[asset].dollarPrice =
      currentPrice;

    wallet.coins[asset].dollarValue =
      wallet.coins[asset].volume *
      currentPrice;

    wallet.data.positions.push(
      newPosition
    );

    wallet.data.currentMarket.name =
      market.name;

    wallet.data.prices = {
      purchasePrice: currentPrice,
      stopLossPrice:
        currentPrice *
        stopLossThreshold,
      highPrice:
        currentPrice
    };

    const tradeReport: transaction = {
      time: timeNow(),

      text:
        `Bought ${formatNumber(orderQuantity)} ${asset} @ ${formatNumber(currentPrice)} = $${formatNumber(actualPositionNotional, 2)} + $${formatNumber(actualPositionNotional * fee, 2)} fee | ${formatNumber(POSITION_PERCENTAGE * 100, 1)}% portfolio value | short slope ${market.shortSlope} | Acceleration ${market.acceleration} | Positions ${wallet.data.positions.length}/${MAX_CONCURRENT_POSITIONS}`
    };

    logEntry(
      tradeReport,
      'transactions'
    );

    console.log(
      `OPEN ${market.name} | $${formatNumber(actualPositionNotional, 2)} | ${formatNumber(POSITION_PERCENTAGE * 100, 1)}% portfolio | ${wallet.data.positions.length}/${MAX_CONCURRENT_POSITIONS}`
    );

    return true;
  } catch (error: any) {
    console.log(error.message);
    return false;
  }
}

async function manageOpenPositions() {

  const openPositions =
    [...wallet.data.positions];

  for (
    const currentPosition
    of openPositions
  ) {
    const currentPrice =
      await fetchPrice(
        currentPosition.symbol
      );

    if (
      !currentPrice ||
      currentPrice <= 0
    ) {
      continue;
    }

    if (
      currentPosition.quantity <= 0
    ) {
      continue;
    }

    const stopPrice =
      currentPosition.entryPrice *
      stopLossThreshold;

    /*
     * Stop loss has priority.
     */
    if (
      currentPrice <= stopPrice
    ) {
      await simulatedSellOrder(
        'Below Stop Loss',
        currentPosition.symbol,
        currentPosition.quantity,
        currentPrice,
        currentPosition
      );

      continue;
    }

    /*
     * Single profit target.
     *
     * The entire remaining position is sold once the price
     * reaches +12% from the entry price.
     */
    for (
      const target
      of currentPosition.targets
    ) {
      if (
        target.triggered ||
        currentPrice <
          target.targetPrice
      ) {
        continue;
      }

      const quantityToSell =
        Math.min(
          currentPosition.originalQuantity *
            target.fraction,
          currentPosition.quantity
        );

      if (
        quantityToSell <= 0
      ) {
        target.triggered = true;
        continue;
      }

      await simulatedSellOrder(
        target.name,
        currentPosition.symbol,
        quantityToSell,
        currentPrice,
        currentPosition
      );

      target.triggered = true;

      /*
       * Position may have been completely closed.
       */
      if (
        currentPosition.quantity <= 0
      ) {
        break;
      }
    }
  }
}

async function simulatedSellOrder(
  sellType: string,
  symbol: string,
  quantity: number,
  sellPrice: number,
  currentPosition: position
) {
  try {
    const positionIndex =
      wallet.data.positions.indexOf(
        currentPosition
      );

    if (
      positionIndex === -1
    ) {
      return;
    }

    const position =
      wallet.data.positions[positionIndex];

    const actualQuantity =
      Math.min(
        quantity,
        position.quantity
      );

    if (
      actualQuantity <= 0
    ) {
      return;
    }

    const grossProceeds =
      actualQuantity *
      sellPrice;

    const sellFee =
      grossProceeds *
      fee;

    const netProceeds =
      grossProceeds -
      sellFee;

    /*
     * Allocate the actual entry notional and entry fee
     * proportionally across each sale. This makes the realised
     * profit accounting correct for dynamic position sizes.
     */
    const quantityFraction =
      actualQuantity /
      position.originalQuantity;

    const allocatedEntryCost =
      (
        position.entryNotional +
        position.entryFee
      ) *
      quantityFraction;

    const realisedProfit =
      netProceeds -
      allocatedEntryCost;

    wallet.coins.USDT.volume +=
      netProceeds;

    if (
      wallet.coins[position.asset]
    ) {
      wallet.coins[position.asset].volume -=
        actualQuantity;

      if (
        wallet.coins[position.asset].volume <
        0.0000000001
      ) {
        wallet.coins[position.asset].volume = 0;
      }

      wallet.coins[position.asset].dollarPrice =
        sellPrice;

      wallet.coins[position.asset].dollarValue =
        wallet.coins[position.asset].volume *
        sellPrice;
    }

    position.quantity -=
      actualQuantity;

    if (
      Math.abs(position.quantity) <
      0.0000000001
    ) {
      position.quantity = 0;
    }

    wallet.data.realisedProfit +=
      realisedProfit;

    const tradeReport: transaction = {
      time: timeNow(),

      text:
        `Sold ${formatNumber(actualQuantity)} ${position.asset} @ ${formatNumber(sellPrice)} = $${formatNumber(netProceeds, 2)} net | P/L $${formatNumber(realisedProfit, 4)} | ${sellType}`
    };

    logEntry(
      tradeReport,
      'transactions'
    );

    if (
      position.quantity <= 0
    ) {
      wallet.data.positions.splice(
        positionIndex,
        1
      );

      if (
        wallet.coins[position.asset] &&
        !wallet.data.positions.some(
          openPosition =>
            openPosition.asset ===
            position.asset
        )
      ) {
        delete wallet.coins[
          position.asset
        ];
      }

      console.log(
        `CLOSED ${symbol} | ${sellType} | Realised P/L $${formatNumber(realisedProfit, 4)}`
      );
    } else {
      console.log(
        `PARTIAL ${symbol} | ${sellType} | Remaining ${formatNumber(position.quantity)}`
      );
    }

    /*
     * Keep legacy currentMarket/price fields usable.
     */
    const latestPosition =
      wallet.data.positions[
        wallet.data.positions.length - 1
      ];

    if (latestPosition) {
      wallet.data.currentMarket.name =
        latestPosition.symbol;

      wallet.data.prices = {
        purchasePrice:
          latestPosition.entryPrice,

        stopLossPrice:
          latestPosition.entryPrice *
          stopLossThreshold,

        highPrice:
          latestPosition.entryPrice
      };
    } else {
      wallet.data.currentMarket.name = '';
      wallet.data.prices = {};
    }
  } catch (error: any) {
    console.log(error.message);
  }
}

function recordPortfolioSnapshot() {
  const values: Record<string, number> = {};

  for (const [asset, coin] of Object.entries(wallet.coins)) {
    values[asset] = coin.volume * coin.dollarPrice;
  }

  portfolioHistory.push({
    timestamp: Date.now(),
    values,
    total: Object.values(values).reduce(
      (total, value) => total + value,
      0
    )
  });
}

const portfolioSnapshotInterval = 60 * 1000;
let lastPortfolioSnapshot = 0;

function recordPortfolioSnapshotIfDue() {
  const now = Date.now();

  if (now - lastPortfolioSnapshot < portfolioSnapshotInterval) {
    return;
  }

  lastPortfolioSnapshot = now;
  recordPortfolioSnapshot();
}