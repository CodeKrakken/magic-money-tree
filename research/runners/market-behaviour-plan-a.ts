import fs from "fs";
import path from "path";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketData {
  symbol: string;
  candles: Candle[];
}

interface Dataset {
  markets: MarketData[];
}

interface StrategyMarketResult {
  symbol: string;
  datasetGroup: string;
  marketIndex: number;
  binanceArrayPosition: number | null;

  signals: number;
  accepted: number;
  rejectedByCapacity: number;

  buys: number;
  sells: number;
  winningPositions: number;
  losingPositions: number;
  flatPositions: number;
  winRate: number;

  grossProfit: number;
  fees: number;
  netProfit: number;
  returnPct: number;

  totalBuyNotional: number;
  totalSellNotional: number;

  target1PctCount: number;
  target2PctCount: number;
  target4PctCount: number;
  stopCount: number;
  maxHoldCount: number;
  endOfDataCount: number;

  averageHoldMinutes: number;
  medianHoldMinutes: number;

  averageProfitPerAcceptedPosition: number;
  firstTarget1AvgMinutes: number;
  firstTarget2AvgMinutes: number;
  firstTarget4AvgMinutes: number;

  averageSlope20: number;
  averageAcceleration: number;
}

interface StrategyRanking {
  sample?: {
    markets: StrategyMarketResult[];
  };
  outOfSample?: {
    markets: StrategyMarketResult[];
  };
  [key: string]: unknown;
}

type MarketClass = "positive" | "flat" | "negative";

interface IndicatorArrays {
  slope20: Float64Array;
  slope50: Float64Array;
  acceleration: Float64Array;

  normalisedSlope20: Float64Array;
  normalisedSlope50: Float64Array;
  normalisedAcceleration: Float64Array;

  return5: Float64Array;
  return20: Float64Array;
  return50: Float64Array;

  volatility20: Float64Array;
  volatility50: Float64Array;

  efficiency20: Float64Array;
  efficiency50: Float64Array;

  trendPersistence20: Float64Array;
  trendPersistence50: Float64Array;

  reversalRate20: Float64Array;
  reversalRate50: Float64Array;
}

interface SignalObservation {
  symbol: string;
  datasetGroup: string;
  marketClass: MarketClass;

  marketNetProfit: number;
  marketReturnPct: number;

  signalIndex: number;
  signalTime: number;
  entryPrice: number;

  slope20: number;
  slope50: number;
  acceleration: number;

  normalisedSlope20: number;
  normalisedSlope50: number;
  normalisedAcceleration: number;

  return5: number;
  return20: number;
  return50: number;

  volatility20: number;
  volatility50: number;

  efficiency20: number;
  efficiency50: number;

  trendPersistence20: number;
  trendPersistence50: number;

  reversalRate20: number;
  reversalRate50: number;

  forward5Return: number | null;
  forward15Return: number | null;
  forward30Return: number | null;
  forward60Return: number | null;
  forward120Return: number | null;
  forward360Return: number | null;
  forward720Return: number | null;
  forward1440Return: number | null;
  forward2880Return: number | null;

  mfe5: number | null;
  mfe15: number | null;
  mfe30: number | null;
  mfe60: number | null;
  mfe120: number | null;
  mfe360: number | null;
  mfe720: number | null;
  mfe1440: number | null;
  mfe2880: number | null;

  mae5: number | null;
  mae15: number | null;
  mae30: number | null;
  mae60: number | null;
  mae120: number | null;
  mae360: number | null;
  mae720: number | null;
  mae1440: number | null;
  mae2880: number | null;

  timeTo1PctMinutes: number | null;
  timeTo2PctMinutes: number | null;
  timeTo4PctMinutes: number | null;
  timeToStopMinutes: number | null;

  reached1Pct: boolean;
  reached2Pct: boolean;
  reached4Pct: boolean;
  reachedStop: boolean;

  reached1ThenFailed2: boolean;
  reached2ThenFailed4: boolean;
}

interface MarketBehaviourSummary {
  symbol: string;
  datasetGroup: string;
  marketClass: MarketClass;

  marketNetProfit: number;
  marketReturnPct: number;

  strategySignals: number;
  acceptedSignals: number;
  rejectedByCapacity: number;
  acceptanceRate: number;

  candidateSignalsAnalysed: number;
  signalsPerDay: number;

  meanSlope20: number;
  medianSlope20: number;
  meanAcceleration: number;
  medianAcceleration: number;

  meanNormalisedSlope20: number;
  medianNormalisedSlope20: number;
  meanNormalisedAcceleration: number;
  medianNormalisedAcceleration: number;

  meanReturn5: number;
  meanReturn20: number;
  meanReturn50: number;

  meanVolatility20: number;
  meanVolatility50: number;

  meanEfficiency20: number;
  meanEfficiency50: number;

  meanTrendPersistence20: number;
  meanTrendPersistence50: number;

  meanReversalRate20: number;
  meanReversalRate50: number;

  meanForward5Return: number;
  meanForward15Return: number;
  meanForward30Return: number;
  meanForward60Return: number;
  meanForward120Return: number;
  meanForward360Return: number;
  meanForward720Return: number;
  meanForward1440Return: number;
  meanForward2880Return: number;

  meanMfe5: number;
  meanMfe15: number;
  meanMfe30: number;
  meanMfe60: number;
  meanMfe120: number;
  meanMfe360: number;
  meanMfe720: number;
  meanMfe1440: number;
  meanMfe2880: number;

  meanMae5: number;
  meanMae15: number;
  meanMae30: number;
  meanMae60: number;
  meanMae120: number;
  meanMae360: number;
  meanMae720: number;
  meanMae1440: number;
  meanMae2880: number;

  target1Rate: number;
  target2Rate: number;
  target4Rate: number;
  stopRate: number;

  reached1ThenFailed2Rate: number;
  reached2ThenFailed4Rate: number;

  meanTimeTo1PctMinutes: number;
  medianTimeTo1PctMinutes: number;
  meanTimeTo2PctMinutes: number;
  medianTimeTo2PctMinutes: number;
  meanTimeTo4PctMinutes: number;
  medianTimeTo4PctMinutes: number;
  meanTimeToStopMinutes: number;
  medianTimeToStopMinutes: number;
}

interface GroupSummary {
  marketClass: MarketClass;

  markets: number;
  marketsWithSignals: number;

  totalStrategySignals: number;
  totalAcceptedSignals: number;

  meanMarketNetProfit: number;
  medianMarketNetProfit: number;

  totalMarketNetProfit: number;

  meanMarketReturnPct: number;
  medianMarketReturnPct: number;

  meanSignalsPerDay: number;
  meanAcceptanceRate: number;

  meanSlope20: number;
  meanAcceleration: number;
  meanNormalisedSlope20: number;
  meanNormalisedAcceleration: number;

  meanReturn5: number;
  meanReturn20: number;
  meanReturn50: number;

  meanVolatility20: number;
  meanVolatility50: number;

  meanEfficiency20: number;
  meanEfficiency50: number;

  meanTrendPersistence20: number;
  meanTrendPersistence50: number;

  meanReversalRate20: number;
  meanReversalRate50: number;

  meanForward5Return: number;
  meanForward15Return: number;
  meanForward30Return: number;
  meanForward60Return: number;
  meanForward120Return: number;
  meanForward360Return: number;
  meanForward720Return: number;
  meanForward1440Return: number;
  meanForward2880Return: number;

  meanMfe60: number;
  meanMfe360: number;
  meanMfe1440: number;
  meanMfe2880: number;

  meanMae60: number;
  meanMae360: number;
  meanMae1440: number;
  meanMae2880: number;

  target1Rate: number;
  target2Rate: number;
  target4Rate: number;
  stopRate: number;

  reached1ThenFailed2Rate: number;
  reached2ThenFailed4Rate: number;
}

interface DatasetOutput {
  dataset: string;
  markets: number;
  totalCandidateSignals: number;
  observations: number;

  marketSummaries: MarketBehaviourSummary[];
  groupSummaries: GroupSummary[];
  signalObservations: SignalObservation[];
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const SLOPE_THRESHOLD =
  -0.0001425851160546487;

const ACCELERATION_THRESHOLD =
  0.00013986740450809692;

const LONG_WINDOW = 50;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const FORWARD_HORIZONS = [
  5,
  15,
  30,
  60,
  120,
  360,
  720,
  1440,
  2880,
] as const;

const OUTPUT_DIR = path.join(
  process.cwd(),
  "research",
  "output"
);

const ORIGINAL_DATASET_PATH = path.join(
  process.cwd(),
  "research",
  "data",
  "ema-data-1789061547934.json"
);

const OOS_DATASET_PATH = path.join(
  process.cwd(),
  "research",
  "data",
  "ema-data-oos-60-1789165540440.json"
);

const STRATEGY_RESULTS_PATH = path.join(
  OUTPUT_DIR,
  "market-strategy-ranking-independent-1789232701426.json"
);

/* -------------------------------------------------------------------------- */
/* General utilities                                                           */
/* -------------------------------------------------------------------------- */

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const middle = Math.floor(
    sorted.length / 2
  );

  if (sorted.length % 2 === 0) {
    return (
      (sorted[middle - 1] +
        sorted[middle]) /
      2
    );
  }

  return sorted[middle];
}

function finiteValues(
  values: Array<number | null>
): number[] {
  const result: number[] = [];

  for (const value of values) {
    if (
      value !== null &&
      Number.isFinite(value)
    ) {
      result.push(value);
    }
  }

  return result;
}

function meanNullable(
  values: Array<number | null>
): number {
  return mean(finiteValues(values));
}

function medianNullable(
  values: Array<number | null>
): number {
  return median(finiteValues(values));
}

function rate(
  numerator: number,
  denominator: number
): number {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function classifyProfit(
  netProfit: number
): MarketClass {
  if (netProfit > 0) {
    return "positive";
  }

  if (netProfit < 0) {
    return "negative";
  }

  return "flat";
}

function formatDuration(
  milliseconds: number
): string {
  const seconds =
    milliseconds / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = seconds / 60;

  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }

  return `${(minutes / 60).toFixed(2)}h`;
}

function correlation(
  x: number[],
  y: number[]
): number {
  if (
    x.length !== y.length ||
    x.length < 2
  ) {
    return 0;
  }

  const meanX = mean(x);
  const meanY = mean(y);

  let numerator = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;

    numerator += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denominator =
    Math.sqrt(sumX2) *
    Math.sqrt(sumY2);

  return denominator > 0
    ? numerator / denominator
    : 0;
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

function loadDataset(
  filePath: string
): Dataset {
  console.log(`Loading ${filePath}`);

  const parsed = JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8"
    )
  ) as Dataset;

  if (
    !parsed ||
    !Array.isArray(parsed.markets)
  ) {
    throw new Error(
      `Invalid dataset: ${filePath}`
    );
  }

  const markets = parsed.markets.filter(
    market =>
      Array.isArray(market.candles) &&
      market.candles.length >= LONG_WINDOW
  );

  return {
    markets,
  };
}

function loadStrategyResults(): StrategyRanking {
  const parsed = JSON.parse(
    fs.readFileSync(
      STRATEGY_RESULTS_PATH,
      "utf8"
    )
  ) as StrategyRanking;

  if (!parsed) {
    throw new Error(
      `Invalid strategy result file: ${STRATEGY_RESULTS_PATH}`
    );
  }

  return parsed;
}

function buildStrategyMap(
  ranking: StrategyRanking
): Map<string, StrategyMarketResult> {
  const map =
    new Map<string, StrategyMarketResult>();

  const groups = [
    ranking.sample?.markets ?? [],
    ranking.outOfSample?.markets ?? [],
  ];

  for (const markets of groups) {
    for (const market of markets) {
      map.set(
        `${market.datasetGroup}:${market.symbol}`,
        market
      );
    }
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/* Regression slopes                                                           */
/* -------------------------------------------------------------------------- */

function buildRegressionSlopes(
  closes: Float64Array,
  windowSize: number
): Float64Array {
  const n = closes.length;

  const slopes =
    new Float64Array(n);

  if (n < windowSize) {
    return slopes;
  }

  let sumY = 0;
  let sumXY = 0;

  for (let j = 0; j < windowSize; j++) {
    sumY += closes[j];
    sumXY += j * closes[j];
  }

  const sumX =
    (windowSize * (windowSize - 1)) /
    2;

  const sumX2 =
    (windowSize *
      (windowSize - 1) *
      (2 * windowSize - 1)) /
    6;

  const denominator =
    windowSize * sumX2 -
    sumX * sumX;

  slopes[windowSize - 1] =
    denominator !== 0
      ? (
          windowSize * sumXY -
          sumX * sumY
        ) / denominator
      : 0;

  for (
    let end = windowSize;
    end < n;
    end++
  ) {
    const outgoing =
      closes[end - windowSize];

    const incoming =
      closes[end];

    /*
     * When the window moves right:
     *
     * old x positions become one smaller,
     * then the incoming value receives
     * position windowSize - 1.
     */
    sumXY =
      sumXY -
      (sumY - outgoing) +
      (windowSize - 1) *
        incoming;

    sumY =
      sumY -
      outgoing +
      incoming;

    slopes[end] =
      denominator !== 0
        ? (
            windowSize * sumXY -
            sumX * sumY
          ) / denominator
        : 0;
  }

  return slopes;
}

/* -------------------------------------------------------------------------- */
/* Rolling return                                                              */
/* -------------------------------------------------------------------------- */

function buildRollingReturn(
  closes: Float64Array,
  windowSize: number
): Float64Array {
  const result =
    new Float64Array(
      closes.length
    );

  for (
    let i = windowSize;
    i < closes.length;
    i++
  ) {
    const start =
      closes[i - windowSize];

    const end =
      closes[i];

    result[i] =
      start > 0
        ? end / start - 1
        : 0;
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Rolling volatility                                                          */
/* -------------------------------------------------------------------------- */

function buildRollingVolatility(
  closes: Float64Array,
  windowSize: number
): Float64Array {
  const result =
    new Float64Array(
      closes.length
    );

  if (closes.length <= windowSize) {
    return result;
  }

  const logReturns =
    new Float64Array(
      closes.length
    );

  for (let i = 1; i < closes.length; i++) {
    const previous =
      closes[i - 1];

    const current =
      closes[i];

    if (
      previous > 0 &&
      current > 0
    ) {
      logReturns[i] =
        Math.log(
          current / previous
        );
    }
  }

  const prefix =
    new Float64Array(
      closes.length + 1
    );

  const prefixSquares =
    new Float64Array(
      closes.length + 1
    );

  for (let i = 1; i < closes.length; i++) {
    const value =
      logReturns[i];

    prefix[i + 1] =
      prefix[i] + value;

    prefixSquares[i + 1] =
      prefixSquares[i] +
      value * value;
  }

  for (
    let i = windowSize;
    i < closes.length;
    i++
  ) {
    const start =
      Math.max(
        1,
        i - windowSize + 1
      );

    const end = i + 1;

    const count =
      end - start;

    if (count <= 0) {
      continue;
    }

    const sum =
      prefix[end] -
      prefix[start];

    const sumSquares =
      prefixSquares[end] -
      prefixSquares[start];

    const average =
      sum / count;

    const variance =
      Math.max(
        0,
        sumSquares / count -
          average * average
      );

    result[i] =
      Math.sqrt(variance);
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Rolling efficiency                                                          */
/* -------------------------------------------------------------------------- */

function buildRollingEfficiency(
  closes: Float64Array,
  windowSize: number
): Float64Array {
  const result =
    new Float64Array(
      closes.length
    );

  const prefixMovement =
    new Float64Array(
      closes.length
    );

  for (let i = 1; i < closes.length; i++) {
    prefixMovement[i] =
      prefixMovement[i - 1] +
      Math.abs(
        closes[i] -
          closes[i - 1]
      );
  }

  for (
    let i = windowSize;
    i < closes.length;
    i++
  ) {
    const movement =
      prefixMovement[i] -
      prefixMovement[
        i - windowSize
      ];

    const netMove =
      Math.abs(
        closes[i] -
          closes[i - windowSize]
      );

    result[i] =
      movement > 0
        ? netMove / movement
        : 0;
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Trend persistence                                                          */
/* -------------------------------------------------------------------------- */

function buildTrendPersistence(
  closes: Float64Array,
  windowSize: number
): Float64Array {
  const result =
    new Float64Array(
      closes.length
    );

  const positivePrefix =
    new Int32Array(
      closes.length
    );

  for (let i = 1; i < closes.length; i++) {
    positivePrefix[i] =
      positivePrefix[i - 1] +
      (
        closes[i] >
        closes[i - 1]
          ? 1
          : 0
      );
  }

  for (
    let i = windowSize;
    i < closes.length;
    i++
  ) {
    const start =
      i - windowSize + 1;

    const positive =
      positivePrefix[i] -
      positivePrefix[
        start - 1
      ];

    result[i] =
      rate(
        positive,
        windowSize
      );
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Reversal frequency                                                          */
/* -------------------------------------------------------------------------- */

function buildReversalRate(
  closes: Float64Array,
  windowSize: number
): Float64Array {
  const result =
    new Float64Array(
      closes.length
    );

  const direction =
    new Int8Array(
      closes.length
    );

  const reversalsPrefix =
    new Int32Array(
      closes.length
    );

  for (let i = 1; i < closes.length; i++) {
    if (
      closes[i] >
      closes[i - 1]
    ) {
      direction[i] = 1;
    } else if (
      closes[i] <
      closes[i - 1]
    ) {
      direction[i] = -1;
    }

    reversalsPrefix[i] =
      reversalsPrefix[i - 1] +
      (
        direction[i] !== 0 &&
        direction[i - 1] !== 0 &&
        direction[i] !==
          direction[i - 1]
          ? 1
          : 0
      );
  }

  for (
    let i = windowSize;
    i < closes.length;
    i++
  ) {
    const start =
      i - windowSize + 1;

    const reversals =
      reversalsPrefix[i] -
      reversalsPrefix[
        Math.max(0, start - 1)
      ];

    result[i] =
      rate(
        reversals,
        Math.max(
          1,
          windowSize - 1
        )
      );
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Indicators                                                                  */
/* -------------------------------------------------------------------------- */

function buildIndicators(
  candles: Candle[]
): IndicatorArrays {
  const closes =
    new Float64Array(
      candles.length
    );

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {
    closes[i] =
      candles[i].close;
  }

  const slope20 =
    buildRegressionSlopes(
      closes,
      20
    );

  const slope50 =
    buildRegressionSlopes(
      closes,
      50
    );

  const acceleration =
    new Float64Array(
      candles.length
    );

  const normalisedSlope20 =
    new Float64Array(
      candles.length
    );

  const normalisedSlope50 =
    new Float64Array(
      candles.length
    );

  const normalisedAcceleration =
    new Float64Array(
      candles.length
    );

  for (
    let i = LONG_WINDOW - 1;
    i < candles.length;
    i++
  ) {
    const price =
      closes[i];

    acceleration[i] =
      slope20[i] -
      slope50[i];

    if (price > 0) {
      normalisedSlope20[i] =
        slope20[i] / price;

      normalisedSlope50[i] =
        slope50[i] / price;

      normalisedAcceleration[i] =
        acceleration[i] / price;
    }
  }

  return {
    slope20,
    slope50,
    acceleration,

    normalisedSlope20,
    normalisedSlope50,
    normalisedAcceleration,

    return5:
      buildRollingReturn(
        closes,
        5
      ),

    return20:
      buildRollingReturn(
        closes,
        20
      ),

    return50:
      buildRollingReturn(
        closes,
        50
      ),

    volatility20:
      buildRollingVolatility(
        closes,
        20
      ),

    volatility50:
      buildRollingVolatility(
        closes,
        50
      ),

    efficiency20:
      buildRollingEfficiency(
        closes,
        20
      ),

    efficiency50:
      buildRollingEfficiency(
        closes,
        50
      ),

    trendPersistence20:
      buildTrendPersistence(
        closes,
        20
      ),

    trendPersistence50:
      buildTrendPersistence(
        closes,
        50
      ),

    reversalRate20:
      buildReversalRate(
        closes,
        20
      ),

    reversalRate50:
      buildReversalRate(
        closes,
        50
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Signal detection                                                            */
/* -------------------------------------------------------------------------- */

function isSignal(
  indicators: IndicatorArrays,
  index: number
): boolean {
  return (
    indicators.slope20[index] <=
      SLOPE_THRESHOLD &&
    indicators.acceleration[index] >=
      ACCELERATION_THRESHOLD
  );
}

/* -------------------------------------------------------------------------- */
/* Forward path analysis                                                       */
/* -------------------------------------------------------------------------- */

interface ForwardPath {
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
}

function findFirstAtLeast(
  candles: Candle[],
  startIndex: number,
  endIndex: number,
  entryPrice: number,
  targetPrice: number
): number {
  for (
    let i = startIndex;
    i <= endIndex;
    i++
  ) {
    if (
      candles[i].high >=
      targetPrice
    ) {
      return i;
    }
  }

  return -1;
}

function findFirstAtMost(
  candles: Candle[],
  startIndex: number,
  endIndex: number,
  targetPrice: number
): number {
  for (
    let i = startIndex;
    i <= endIndex;
    i++
  ) {
    if (
      candles[i].low <=
      targetPrice
    ) {
      return i;
    }
  }

  return -1;
}

function buildForwardPath(
  candles: Candle[],
  signalIndex: number,
  horizonMinutes: number
): ForwardPath {
  const entryPrice =
    candles[signalIndex].close;

  if (entryPrice <= 0) {
    return {
      returnPct: null,
      mfePct: null,
      maePct: null,
    };
  }

  const horizonEnd =
    Math.min(
      candles.length - 1,
      signalIndex +
        horizonMinutes
    );

  if (
    horizonEnd <= signalIndex
  ) {
    return {
      returnPct: null,
      mfePct: null,
      maePct: null,
    };
  }

  const close =
    candles[horizonEnd].close;

  let maximumHigh =
    Number.NEGATIVE_INFINITY;

  let minimumLow =
    Number.POSITIVE_INFINITY;

  for (
    let i = signalIndex + 1;
    i <= horizonEnd;
    i++
  ) {
    maximumHigh =
      Math.max(
        maximumHigh,
        candles[i].high
      );

    minimumLow =
      Math.min(
        minimumLow,
        candles[i].low
      );
  }

  return {
    returnPct:
      close / entryPrice - 1,

    mfePct:
      maximumHigh /
        entryPrice -
      1,

    maePct:
      minimumLow /
        entryPrice -
      1,
  };
}

/* -------------------------------------------------------------------------- */
/* Signal observation                                                          */
/* -------------------------------------------------------------------------- */

function buildSignalObservation(
  market: MarketData,
  datasetGroup: string,
  marketResult: StrategyMarketResult,
  indicators: IndicatorArrays,
  signalIndex: number
): SignalObservation {
  const candles =
    market.candles;

  const entryPrice =
    candles[signalIndex].close;

  const forwardByHorizon =
    new Map<
      number,
      ForwardPath
    >();

  for (const horizon of FORWARD_HORIZONS) {
    forwardByHorizon.set(
      horizon,
      buildForwardPath(
        candles,
        signalIndex,
        horizon
      )
    );
  }

  const findTarget =
    (
      returnPct: number
    ): number | null => {
      const targetPrice =
        entryPrice *
        (1 + returnPct);

      const endIndex =
        Math.min(
          candles.length - 1,
          signalIndex + 2880
        );

      const index =
        findFirstAtLeast(
          candles,
          signalIndex + 1,
          endIndex,
          entryPrice,
          targetPrice
        );

      return index >= 0
        ? (
            index -
            signalIndex
          )
        : null;
    };

  const stopPrice =
    entryPrice * 0.90;

  const stopEndIndex =
    Math.min(
      candles.length - 1,
      signalIndex + 2880
    );

  const stopIndex =
    findFirstAtMost(
      candles,
      signalIndex + 1,
      stopEndIndex,
      stopPrice
    );

  const timeTo1 =
    findTarget(0.01);

  const timeTo2 =
    findTarget(0.02);

  const timeTo4 =
    findTarget(0.04);

  const timeToStop =
    stopIndex >= 0
      ? stopIndex -
        signalIndex
      : null;

  return {
    symbol:
      market.symbol,

    datasetGroup,

    marketClass:
      classifyProfit(
        marketResult.netProfit
      ),

    marketNetProfit:
      marketResult.netProfit,

    marketReturnPct:
      marketResult.returnPct,

    signalIndex,

    signalTime:
      candles[signalIndex]
        .openTime,

    entryPrice,

    slope20:
      indicators.slope20[
        signalIndex
      ],

    slope50:
      indicators.slope50[
        signalIndex
      ],

    acceleration:
      indicators.acceleration[
        signalIndex
      ],

    normalisedSlope20:
      indicators.normalisedSlope20[
        signalIndex
      ],

    normalisedSlope50:
      indicators.normalisedSlope50[
        signalIndex
      ],

    normalisedAcceleration:
      indicators.normalisedAcceleration[
        signalIndex
      ],

    return5:
      indicators.return5[
        signalIndex
      ],

    return20:
      indicators.return20[
        signalIndex
      ],

    return50:
      indicators.return50[
        signalIndex
      ],

    volatility20:
      indicators.volatility20[
        signalIndex
      ],

    volatility50:
      indicators.volatility50[
        signalIndex
      ],

    efficiency20:
      indicators.efficiency20[
        signalIndex
      ],

    efficiency50:
      indicators.efficiency50[
        signalIndex
      ],

    trendPersistence20:
      indicators.trendPersistence20[
        signalIndex
      ],

    trendPersistence50:
      indicators.trendPersistence50[
        signalIndex
      ],

    reversalRate20:
      indicators.reversalRate20[
        signalIndex
      ],

    reversalRate50:
      indicators.reversalRate50[
        signalIndex
      ],

    forward5Return:
      forwardByHorizon.get(5)!
        .returnPct,

    forward15Return:
      forwardByHorizon.get(15)!
        .returnPct,

    forward30Return:
      forwardByHorizon.get(30)!
        .returnPct,

    forward60Return:
      forwardByHorizon.get(60)!
        .returnPct,

    forward120Return:
      forwardByHorizon.get(120)!
        .returnPct,

    forward360Return:
      forwardByHorizon.get(360)!
        .returnPct,

    forward720Return:
      forwardByHorizon.get(720)!
        .returnPct,

    forward1440Return:
      forwardByHorizon.get(1440)!
        .returnPct,

    forward2880Return:
      forwardByHorizon.get(2880)!
        .returnPct,

    mfe5:
      forwardByHorizon.get(5)!
        .mfePct,

    mfe15:
      forwardByHorizon.get(15)!
        .mfePct,

    mfe30:
      forwardByHorizon.get(30)!
        .mfePct,

    mfe60:
      forwardByHorizon.get(60)!
        .mfePct,

    mfe120:
      forwardByHorizon.get(120)!
        .mfePct,

    mfe360:
      forwardByHorizon.get(360)!
        .mfePct,

    mfe720:
      forwardByHorizon.get(720)!
        .mfePct,

    mfe1440:
      forwardByHorizon.get(1440)!
        .mfePct,

    mfe2880:
      forwardByHorizon.get(2880)!
        .mfePct,

    mae5:
      forwardByHorizon.get(5)!
        .maePct,

    mae15:
      forwardByHorizon.get(15)!
        .maePct,

    mae30:
      forwardByHorizon.get(30)!
        .maePct,

    mae60:
      forwardByHorizon.get(60)!
        .maePct,

    mae120:
      forwardByHorizon.get(120)!
        .maePct,

    mae360:
      forwardByHorizon.get(360)!
        .maePct,

    mae720:
      forwardByHorizon.get(720)!
        .maePct,

    mae1440:
      forwardByHorizon.get(1440)!
        .maePct,

    mae2880:
      forwardByHorizon.get(2880)!
        .maePct,

    timeTo1PctMinutes:
      timeTo1,

    timeTo2PctMinutes:
      timeTo2,

    timeTo4PctMinutes:
      timeTo4,

    timeToStopMinutes:
      timeToStop,

    reached1Pct:
      timeTo1 !== null,

    reached2Pct:
      timeTo2 !== null,

    reached4Pct:
      timeTo4 !== null,

    reachedStop:
      timeToStop !== null,

    reached1ThenFailed2:
      timeTo1 !== null &&
      timeTo2 === null,

    reached2ThenFailed4:
      timeTo2 !== null &&
      timeTo4 === null,
  };
}

/* -------------------------------------------------------------------------- */
/* Market summary                                                             */
/* -------------------------------------------------------------------------- */

function buildMarketSummary(
  observations: SignalObservation[],
  marketResult: StrategyMarketResult,
  datasetGroup: string,
  durationDays: number
): MarketBehaviourSummary {
  const values = <
    K extends keyof SignalObservation
  >(
    key: K
  ): number[] => {
    const result: number[] = [];

    for (const observation of observations) {
      const value =
        observation[key];

      if (
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        result.push(value);
      }
    }

    return result;
  };

  const timeTo1 =
    finiteValues(
      observations.map(
        observation =>
          observation.timeTo1PctMinutes
      )
    );

  const timeTo2 =
    finiteValues(
      observations.map(
        observation =>
          observation.timeTo2PctMinutes
      )
    );

  const timeTo4 =
    finiteValues(
      observations.map(
        observation =>
          observation.timeTo4PctMinutes
      )
    );

  const timeToStop =
    finiteValues(
      observations.map(
        observation =>
          observation.timeToStopMinutes
      )
    );

  return {
    symbol:
      marketResult.symbol,

    datasetGroup,

    marketClass:
      classifyProfit(
        marketResult.netProfit
      ),

    marketNetProfit:
      marketResult.netProfit,

    marketReturnPct:
      marketResult.returnPct,

    strategySignals:
      marketResult.signals,

    acceptedSignals:
      marketResult.accepted,

    rejectedByCapacity:
      marketResult.rejectedByCapacity,

    acceptanceRate:
      rate(
        marketResult.accepted,
        marketResult.signals
      ),

    candidateSignalsAnalysed:
      observations.length,

    signalsPerDay:
      durationDays > 0
        ? observations.length /
          durationDays
        : 0,

    meanSlope20:
      mean(values("slope20")),

    medianSlope20:
      median(values("slope20")),

    meanAcceleration:
      mean(values("acceleration")),

    medianAcceleration:
      median(
        values("acceleration")
      ),

    meanNormalisedSlope20:
      mean(
        values(
          "normalisedSlope20"
        )
      ),

    medianNormalisedSlope20:
      median(
        values(
          "normalisedSlope20"
        )
      ),

    meanNormalisedAcceleration:
      mean(
        values(
          "normalisedAcceleration"
        )
      ),

    medianNormalisedAcceleration:
      median(
        values(
          "normalisedAcceleration"
        )
      ),

    meanReturn5:
      mean(values("return5")),

    meanReturn20:
      mean(values("return20")),

    meanReturn50:
      mean(values("return50")),

    meanVolatility20:
      mean(
        values("volatility20")
      ),

    meanVolatility50:
      mean(
        values("volatility50")
      ),

    meanEfficiency20:
      mean(
        values("efficiency20")
      ),

    meanEfficiency50:
      mean(
        values("efficiency50")
      ),

    meanTrendPersistence20:
      mean(
        values(
          "trendPersistence20"
        )
      ),

    meanTrendPersistence50:
      mean(
        values(
          "trendPersistence50"
        )
      ),

    meanReversalRate20:
      mean(
        values(
          "reversalRate20"
        )
      ),

    meanReversalRate50:
      mean(
        values(
          "reversalRate50"
        )
      ),

    meanForward5Return:
      meanNullable(
        observations.map(
          o => o.forward5Return
        )
      ),

    meanForward15Return:
      meanNullable(
        observations.map(
          o => o.forward15Return
        )
      ),

    meanForward30Return:
      meanNullable(
        observations.map(
          o => o.forward30Return
        )
      ),

    meanForward60Return:
      meanNullable(
        observations.map(
          o => o.forward60Return
        )
      ),

    meanForward120Return:
      meanNullable(
        observations.map(
          o => o.forward120Return
        )
      ),

    meanForward360Return:
      meanNullable(
        observations.map(
          o => o.forward360Return
        )
      ),

    meanForward720Return:
      meanNullable(
        observations.map(
          o => o.forward720Return
        )
      ),

    meanForward1440Return:
      meanNullable(
        observations.map(
          o => o.forward1440Return
        )
      ),

    meanForward2880Return:
      meanNullable(
        observations.map(
          o => o.forward2880Return
        )
      ),

    meanMfe5:
      meanNullable(
        observations.map(
          o => o.mfe5
        )
      ),

    meanMfe15:
      meanNullable(
        observations.map(
          o => o.mfe15
        )
      ),

    meanMfe30:
      meanNullable(
        observations.map(
          o => o.mfe30
        )
      ),

    meanMfe60:
      meanNullable(
        observations.map(
          o => o.mfe60
        )
      ),

    meanMfe120:
      meanNullable(
        observations.map(
          o => o.mfe120
        )
      ),

    meanMfe360:
      meanNullable(
        observations.map(
          o => o.mfe360
        )
      ),

    meanMfe720:
      meanNullable(
        observations.map(
          o => o.mfe720
        )
      ),

    meanMfe1440:
      meanNullable(
        observations.map(
          o => o.mfe1440
        )
      ),

    meanMfe2880:
      meanNullable(
        observations.map(
          o => o.mfe2880
        )
      ),

    meanMae5:
      meanNullable(
        observations.map(
          o => o.mae5
        )
      ),

    meanMae15:
      meanNullable(
        observations.map(
          o => o.mae15
        )
      ),

    meanMae30:
      meanNullable(
        observations.map(
          o => o.mae30
        )
      ),

    meanMae60:
      meanNullable(
        observations.map(
          o => o.mae60
        )
      ),

    meanMae120:
      meanNullable(
        observations.map(
          o => o.mae120
        )
      ),

    meanMae360:
      meanNullable(
        observations.map(
          o => o.mae360
        )
      ),

    meanMae720:
      meanNullable(
        observations.map(
          o => o.mae720
        )
      ),

    meanMae1440:
      meanNullable(
        observations.map(
          o => o.mae1440
        )
      ),

    meanMae2880:
      meanNullable(
        observations.map(
          o => o.mae2880
        )
      ),

    target1Rate:
      rate(
        observations.filter(
          o => o.reached1Pct
        ).length,
        observations.length
      ),

    target2Rate:
      rate(
        observations.filter(
          o => o.reached2Pct
        ).length,
        observations.length
      ),

    target4Rate:
      rate(
        observations.filter(
          o => o.reached4Pct
        ).length,
        observations.length
      ),

    stopRate:
      rate(
        observations.filter(
          o => o.reachedStop
        ).length,
        observations.length
      ),

    reached1ThenFailed2Rate:
      rate(
        observations.filter(
          o => o.reached1ThenFailed2
        ).length,
        observations.length
      ),

    reached2ThenFailed4Rate:
      rate(
        observations.filter(
          o => o.reached2ThenFailed4
        ).length,
        observations.length
      ),

    meanTimeTo1PctMinutes:
      mean(timeTo1),

    medianTimeTo1PctMinutes:
      median(timeTo1),

    meanTimeTo2PctMinutes:
      mean(timeTo2),

    medianTimeTo2PctMinutes:
      median(timeTo2),

    meanTimeTo4PctMinutes:
      mean(timeTo4),

    medianTimeTo4PctMinutes:
      median(timeTo4),

    meanTimeToStopMinutes:
      mean(timeToStop),

    medianTimeToStopMinutes:
      median(timeToStop),
  };
}

/* -------------------------------------------------------------------------- */
/* Group summary                                                              */
/* -------------------------------------------------------------------------- */

function buildGroupSummary(
  marketSummaries: MarketBehaviourSummary[],
  marketClass: MarketClass
): GroupSummary {
  const markets =
    marketSummaries.filter(
      market =>
        market.marketClass ===
        marketClass
    );

  const withSignals =
    markets.filter(
      market =>
        market.candidateSignalsAnalysed >
        0
    );

  const average = (
    selector: (
      market: MarketBehaviourSummary
    ) => number
  ): number =>
    mean(
      withSignals.map(selector)
    );

  const total = (
    selector: (
      market: MarketBehaviourSummary
    ) => number
  ): number => {
    let result = 0;

    for (const market of markets) {
      result += selector(market);
    }

    return result;
  };

  const medianMetric = (
    selector: (
      market: MarketBehaviourSummary
    ) => number
  ): number =>
    median(
      withSignals.map(selector)
    );

  return {
    marketClass,

    markets: markets.length,

    marketsWithSignals:
      withSignals.length,

    totalStrategySignals:
      total(
        market =>
          market.strategySignals
      ),

    totalAcceptedSignals:
      total(
        market =>
          market.acceptedSignals
      ),

    meanMarketNetProfit:
      mean(
        markets.map(
          market =>
            market.marketNetProfit
        )
      ),

    medianMarketNetProfit:
      median(
        markets.map(
          market =>
            market.marketNetProfit
        )
      ),

    totalMarketNetProfit:
      total(
        market =>
          market.marketNetProfit
      ),

    meanMarketReturnPct:
      mean(
        markets.map(
          market =>
            market.marketReturnPct
        )
      ),

    medianMarketReturnPct:
      median(
        markets.map(
          market =>
            market.marketReturnPct
        )
      ),

    meanSignalsPerDay:
      average(
        market =>
          market.signalsPerDay
      ),

    meanAcceptanceRate:
      average(
        market =>
          market.acceptanceRate
      ),

    meanSlope20:
      average(
        market =>
          market.meanSlope20
      ),

    meanAcceleration:
      average(
        market =>
          market.meanAcceleration
      ),

    meanNormalisedSlope20:
      average(
        market =>
          market.meanNormalisedSlope20
      ),

    meanNormalisedAcceleration:
      average(
        market =>
          market.meanNormalisedAcceleration
      ),

    meanReturn5:
      average(
        market =>
          market.meanReturn5
      ),

    meanReturn20:
      average(
        market =>
          market.meanReturn20
      ),

    meanReturn50:
      average(
        market =>
          market.meanReturn50
      ),

    meanVolatility20:
      average(
        market =>
          market.meanVolatility20
      ),

    meanVolatility50:
      average(
        market =>
          market.meanVolatility50
      ),

    meanEfficiency20:
      average(
        market =>
          market.meanEfficiency20
      ),

    meanEfficiency50:
      average(
        market =>
          market.meanEfficiency50
      ),

    meanTrendPersistence20:
      average(
        market =>
          market.meanTrendPersistence20
      ),

    meanTrendPersistence50:
      average(
        market =>
          market.meanTrendPersistence50
      ),

    meanReversalRate20:
      average(
        market =>
          market.meanReversalRate20
      ),

    meanReversalRate50:
      average(
        market =>
          market.meanReversalRate50
      ),

    meanForward5Return:
      average(
        market =>
          market.meanForward5Return
      ),

    meanForward15Return:
      average(
        market =>
          market.meanForward15Return
      ),

    meanForward30Return:
      average(
        market =>
          market.meanForward30Return
      ),

    meanForward60Return:
      average(
        market =>
          market.meanForward60Return
      ),

    meanForward120Return:
      average(
        market =>
          market.meanForward120Return
      ),

    meanForward360Return:
      average(
        market =>
          market.meanForward360Return
      ),

    meanForward720Return:
      average(
        market =>
          market.meanForward720Return
      ),

    meanForward1440Return:
      average(
        market =>
          market.meanForward1440Return
      ),

    meanForward2880Return:
      average(
        market =>
          market.meanForward2880Return
      ),

    meanMfe60:
      average(
        market =>
          market.meanMfe60
      ),

    meanMfe360:
      average(
        market =>
          market.meanMfe360
      ),

    meanMfe1440:
      average(
        market =>
          market.meanMfe1440
      ),

    meanMfe2880:
      average(
        market =>
          market.meanMfe2880
      ),

    meanMae60:
      average(
        market =>
          market.meanMae60
      ),

    meanMae360:
      average(
        market =>
          market.meanMae360
      ),

    meanMae1440:
      average(
        market =>
          market.meanMae1440
      ),

    meanMae2880:
      average(
        market =>
          market.meanMae2880
      ),

    target1Rate:
      average(
        market =>
          market.target1Rate
      ),

    target2Rate:
      average(
        market =>
          market.target2Rate
      ),

    target4Rate:
      average(
        market =>
          market.target4Rate
      ),

    stopRate:
      average(
        market =>
          market.stopRate
      ),

    reached1ThenFailed2Rate:
      average(
        market =>
          market.reached1ThenFailed2Rate
      ),

    reached2ThenFailed4Rate:
      average(
        market =>
          market.reached2ThenFailed4Rate
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

function csvEscape(
  value: unknown
): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replaceAll(
      '"',
      '""'
    )}"`;
  }

  return text;
}

function toCsv(
  rows: Array<Record<string, unknown>>
): string {
  if (rows.length === 0) {
    return "";
  }

  const headers =
    Object.keys(rows[0]);

  const lines = [
    headers.join(","),
  ];

  for (const row of rows) {
    lines.push(
      headers
        .map(
          header =>
            csvEscape(
              row[header]
            )
        )
        .join(",")
    );
  }

  return lines.join("\n") + "\n";
}

/* -------------------------------------------------------------------------- */
/* Dataset processing                                                          */
/* -------------------------------------------------------------------------- */

function processDataset(
  datasetName: string,
  dataset: Dataset,
  strategyMap: Map<
    string,
    StrategyMarketResult
  >
): DatasetOutput {
  const startedAt =
    Date.now();

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    `Processing ${datasetName}`
  );
  console.log(
    "============================================================"
  );

  console.log(
    `Markets: ${dataset.markets.length}`
  );

  let earliestTime =
    Number.POSITIVE_INFINITY;

  let latestTime =
    Number.NEGATIVE_INFINITY;

  for (const market of dataset.markets) {
    if (market.candles.length === 0) {
      continue;
    }

    earliestTime =
      Math.min(
        earliestTime,
        market.candles[0]
          .openTime
      );

    latestTime =
      Math.max(
        latestTime,
        market.candles[
          market.candles.length - 1
        ].openTime
      );
  }

  const durationDays =
    Number.isFinite(
      earliestTime
    ) &&
    Number.isFinite(
      latestTime
    )
      ? (
          latestTime -
          earliestTime
        ) / DAY_MS
      : 0;

  const allObservations: SignalObservation[] =
    [];

  const marketSummaries: MarketBehaviourSummary[] =
    [];

  let totalCandidateSignals = 0;

  for (
    let marketIndex = 0;
    marketIndex <
    dataset.markets.length;
    marketIndex++
  ) {
    const market =
      dataset.markets[
        marketIndex
      ];

    const strategyKey =
      `${datasetName === "Sample"
        ? "Sample"
        : "OutOfSample"}:${market.symbol}`;

    const marketResult =
      strategyMap.get(
        strategyKey
      );

    if (!marketResult) {
      console.log(
        `[${marketIndex + 1}/${dataset.markets.length}] ${market.symbol} | no strategy result`
      );
      continue;
    }

    const marketStartedAt =
      Date.now();

    console.log(
      `[${marketIndex + 1}/${dataset.markets.length}] ` +
        `${market.symbol} | ` +
        `class=${classifyProfit(
          marketResult.netProfit
        )} | ` +
        `net=${marketResult.netProfit.toFixed(
          4
        )} | ` +
        `signals=${marketResult.signals.toLocaleString()}`
    );

    const indicators =
      buildIndicators(
        market.candles
      );

    const observations: SignalObservation[] =
      [];

    for (
      let i = LONG_WINDOW - 1;
      i < market.candles.length;
      i++
    ) {
      if (
        !isSignal(
          indicators,
          i
        )
      ) {
        continue;
      }

      const observation =
        buildSignalObservation(
          market,
          datasetName,
          marketResult,
          indicators,
          i
        );

      observations.push(
        observation
      );

      allObservations.push(
        observation
      );

      totalCandidateSignals++;
    }

    const summary =
      buildMarketSummary(
        observations,
        marketResult,
        datasetName,
        durationDays
      );

    marketSummaries.push(
      summary
    );

    const elapsed =
      Date.now() -
      marketStartedAt;

    console.log(
      `    analysed=${observations.length.toLocaleString()} | ` +
        `acceptance=${(
          summary.acceptanceRate * 100
        ).toFixed(2)}% | ` +
        `runtime=${formatDuration(
          elapsed
        )}`
    );
  }

  const groupSummaries = [
    buildGroupSummary(
      marketSummaries,
      "positive"
    ),
    buildGroupSummary(
      marketSummaries,
      "flat"
    ),
    buildGroupSummary(
      marketSummaries,
      "negative"
    ),
  ];

  console.log("");
  console.log(
    `${datasetName} complete: ` +
      `${totalCandidateSignals.toLocaleString()} candidate signals`
  );
  console.log(
    `Runtime: ${formatDuration(
      Date.now() - startedAt
    )}`
  );

  return {
    dataset: datasetName,
    markets:
      dataset.markets.length,
    totalCandidateSignals,
    observations:
      allObservations.length,
    marketSummaries,
    groupSummaries,
    signalObservations:
      allObservations,
  };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

function main(): void {
  const globalStartedAt =
    Date.now();

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Plan A - Market Behaviour Analysis"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Strategy results: ${STRATEGY_RESULTS_PATH}`
  );
  console.log(
    `Original candles: ${ORIGINAL_DATASET_PATH}`
  );
  console.log(
    `OOS candles: ${OOS_DATASET_PATH}`
  );
  console.log("");

  console.log(
    "Strategy:"
  );
  console.log(
    `  slope20 <= ${SLOPE_THRESHOLD}`
  );
  console.log(
    `  acceleration >= ${ACCELERATION_THRESHOLD}`
  );
  console.log(
    "  stop = -10%"
  );
  console.log(
    "  maximum forward horizon = 2880 minutes"
  );
  console.log(
    "  market classes: positive / flat / negative"
  );
  console.log("");

  const ranking =
    loadStrategyResults();

  const strategyMap =
    buildStrategyMap(
      ranking
    );

  console.log(
    `Strategy market results loaded: ${strategyMap.size}`
  );

  const datasets = [
    {
      name: "Sample",
      path:
        ORIGINAL_DATASET_PATH,
    },
    {
      name: "OutOfSample",
      path:
        OOS_DATASET_PATH,
    },
  ] as const;

  const outputs: DatasetOutput[] =
    [];

  for (const datasetConfig of datasets) {
    const dataset =
      loadDataset(
        datasetConfig.path
      );

    const output =
      processDataset(
        datasetConfig.name,
        dataset,
        strategyMap
      );

    outputs.push(output);

    /*
     * Explicitly release the dataset before
     * loading/processing the next one.
     */
  }

  const combinedMarketSummaries =
    outputs.flatMap(
      output =>
        output.marketSummaries
    );

  const combinedObservations =
    outputs.flatMap(
      output =>
        output.signalObservations
    );

  const combinedGroupSummaries = [
    buildGroupSummary(
      combinedMarketSummaries,
      "positive"
    ),
    buildGroupSummary(
      combinedMarketSummaries,
      "flat"
    ),
    buildGroupSummary(
      combinedMarketSummaries,
      "negative"
    ),
  ];

  /*
   * Correlations are calculated at signal level.
   * This is diagnostic only; no feature is selected
   * or used to modify the strategy.
   */
  const correlationFeatures = [
    "slope20",
    "acceleration",
    "normalisedSlope20",
    "normalisedAcceleration",
    "return5",
    "return20",
    "return50",
    "volatility20",
    "volatility50",
    "efficiency20",
    "efficiency50",
    "trendPersistence20",
    "trendPersistence50",
    "reversalRate20",
    "reversalRate50",
    "forward5Return",
    "forward15Return",
    "forward30Return",
    "forward60Return",
    "forward120Return",
    "forward360Return",
    "forward720Return",
    "forward1440Return",
    "forward2880Return",
    "mfe60",
    "mfe360",
    "mfe1440",
    "mfe2880",
    "mae60",
    "mae360",
    "mae1440",
    "mae2880",
  ] as const;

  const correlationResults: Array<{
    feature: string;
    correlationWithMarketNetProfit: number;
  }> = [];

  for (const feature of correlationFeatures) {
    const x: number[] = [];
    const y: number[] = [];

    for (
      const observation of
      combinedObservations
    ) {
      const value =
        observation[
          feature
        ];

      if (
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        continue;
      }

      x.push(value);
      y.push(
        observation.marketNetProfit
      );
    }

    correlationResults.push({
      feature,
      correlationWithMarketNetProfit:
        correlation(x, y),
    });
  }

  correlationResults.sort(
    (a, b) =>
      Math.abs(
        b.correlationWithMarketNetProfit
      ) -
      Math.abs(
        a.correlationWithMarketNetProfit
      )
  );

  const output = {
    generatedAt:
      new Date().toISOString(),

    experiment:
      "plan_a_market_behaviour_analysis",

    purpose:
      "Identify behavioural characteristics at strategy signal time and during the subsequent price path that distinguish positive, flat and negative strategy markets.",

    methodology: {
      strategyUnchanged: true,

      signalDefinition: {
        slope20Lte:
          SLOPE_THRESHOLD,
        accelerationGte:
          ACCELERATION_THRESHOLD,
      },

      marketClassification:
        "positive if netProfit > 0; flat if netProfit === 0; negative if netProfit < 0",

      positionStrategy:
        "Existing strategy results are used only to classify each market. This runner does not alter capacity selection or strategy thresholds.",

      signalPopulation:
        "All qualifying strategy signals in the existing candle datasets are analysed.",

      forwardHorizonsMinutes:
        FORWARD_HORIZONS,

      forwardReturnDefinition:
        "close-to-close percentage return from the signal candle close to the close at the requested future horizon.",

      mfeDefinition:
        "maximum future candle high relative to the signal candle close within the requested horizon.",

      maeDefinition:
        "minimum future candle low relative to the signal candle close within the requested horizon.",

      targetDefinitions: {
        target1Pct:
          "+1%",
        target2Pct:
          "+2%",
        target4Pct:
          "+4%",
        stop:
          "-10%",
      },

      timeToTargetDefinition:
        "First future candle whose high reaches the target price.",

      timeToStopDefinition:
        "First future candle whose low reaches the -10% stop price.",

      trendPersistenceDefinition:
        "Fraction of recent one-minute returns that are positive.",

      reversalRateDefinition:
        "Direction changes between consecutive non-zero one-minute returns divided by the number of possible transitions.",

      efficiencyDefinition:
        "Absolute net price movement divided by the sum of absolute one-minute movements over the lookback window.",

      volatilityDefinition:
        "Standard deviation of one-minute logarithmic returns over the lookback window.",

      normalisation:
        "Regression slope divided by the signal candle close price.",

      leakage:
        "No future candles are used to construct entry indicators. Forward measurements are only used diagnostically after the signal.",

      optimisation:
        "None. This is a diagnostic experiment, not a threshold-selection experiment.",
    },

    datasets: outputs.map(
      dataset => ({
        dataset:
          dataset.dataset,
        markets:
          dataset.markets,
        totalCandidateSignals:
          dataset.totalCandidateSignals,
        observations:
          dataset.observations,
        groupSummaries:
          dataset.groupSummaries,
      })
    ),

    combined: {
      markets:
        combinedMarketSummaries.length,

      observations:
        combinedObservations.length,

      groupSummaries:
        combinedGroupSummaries,

      correlationsWithMarketNetProfit:
        correlationResults,

      marketSummaries:
        combinedMarketSummaries,

      signalObservations:
        combinedObservations,
    },

    runtime: {
      milliseconds:
        Date.now() -
        globalStartedAt,
      formatted:
        formatDuration(
          Date.now() -
            globalStartedAt
        ),
    },
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  const timestamp =
    Date.now();

  const jsonPath =
    path.join(
      OUTPUT_DIR,
      `plan-a-market-behaviour-${timestamp}.json`
    );

  const marketCsvPath =
    path.join(
      OUTPUT_DIR,
      `plan-a-market-behaviour-markets-${timestamp}.csv`
    );

  const groupCsvPath =
    path.join(
      OUTPUT_DIR,
      `plan-a-market-behaviour-groups-${timestamp}.csv`
    );

  const signalCsvPath =
    path.join(
      OUTPUT_DIR,
      `plan-a-market-behaviour-signals-${timestamp}.csv`
    );

  const correlationCsvPath =
    path.join(
      OUTPUT_DIR,
      `plan-a-market-behaviour-correlations-${timestamp}.csv`
    );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  fs.writeFileSync(
    marketCsvPath,
    toCsv(
      combinedMarketSummaries as unknown as Array<
        Record<string, unknown>
      >
    )
  );

  fs.writeFileSync(
    groupCsvPath,
    toCsv(
      combinedGroupSummaries as unknown as Array<
        Record<string, unknown>
      >
    )
  );

  fs.writeFileSync(
    signalCsvPath,
    toCsv(
      combinedObservations as unknown as Array<
        Record<string, unknown>
      >
    )
  );

  fs.writeFileSync(
    correlationCsvPath,
    toCsv(
      correlationResults as unknown as Array<
        Record<string, unknown>
      >
    )
  );

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "Plan A complete"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Markets analysed: ${combinedMarketSummaries.length}`
  );

  console.log(
    `Signal observations: ${combinedObservations.length.toLocaleString()}`
  );

  console.log("");

  for (
    const group of
    combinedGroupSummaries
  ) {
    console.log(
      `${group.marketClass.toUpperCase()}:`
    );

    console.log(
      `  markets = ${group.markets}`
    );

    console.log(
      `  total net profit = ${group.totalMarketNetProfit.toFixed(
        6
      )}`
    );

    console.log(
      `  mean market net profit = ${group.meanMarketNetProfit.toFixed(
        6
      )}`
    );

    console.log(
      `  mean target +1% rate = ${(
        group.target1Rate * 100
      ).toFixed(2)}%`
    );

    console.log(
      `  mean target +2% rate = ${(
        group.target2Rate * 100
      ).toFixed(2)}%`
    );

    console.log(
      `  mean target +4% rate = ${(
        group.target4Rate * 100
      ).toFixed(2)}%`
    );

    console.log(
      `  mean stop rate = ${(
        group.stopRate * 100
      ).toFixed(2)}%`
    );

    console.log("");
  }

  console.log(
    "Strongest signal-level correlations with market net profit:"
  );

  for (
    const result of
    correlationResults.slice(
      0,
      10
    )
  ) {
    console.log(
      `  ${result.feature.padEnd(
        28
      )} ${result.correlationWithMarketNetProfit.toFixed(
        6
      )}`
    );
  }

  console.log("");

  console.log(
    `JSON: ${jsonPath}`
  );

  console.log(
    `Markets CSV: ${marketCsvPath}`
  );

  console.log(
    `Groups CSV: ${groupCsvPath}`
  );

  console.log(
    `Signals CSV: ${signalCsvPath}`
  );

  console.log(
    `Correlations CSV: ${correlationCsvPath}`
  );

  console.log("");

  console.log(
    `Total runtime: ${formatDuration(
      Date.now() -
        globalStartedAt
    )}`
  );

  console.log(
    "============================================================"
  );
}

main();