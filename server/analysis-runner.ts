import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const fibNumbers = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657]
fibNumbers.push(43200)

const constructPairs = <T>(items: T[]) => {
  const pairArray = []

  const count = items.length

  for (let i = 0; i < count - 1; i++) {
    for (let j = i + 1; j < count; j++) {
      pairArray.push([fibNumbers[i], fibNumbers[j]])
    }
  }

  return pairArray
}

const EMA_PAIRS = constructPairs(fibNumbers)

// [
//   [2, 3],
//   [3, 5],
//   [3, 8],
//   [5, 8],
//   [5, 13],
//   [8, 13],
//   [8, 20],
//   [13, 21],
//   [13, 34],
//   [21, 34],
//   [21, 55],
//   [34, 55],
//   [34, 89],
//   [55, 89],
//   [89, 144],
// ] as const;

console.log(EMA_PAIRS)


const HORIZONS = [5, 10, 20, 50] as const;

// 0.20% total round-trip trading cost.
const TOTAL_COST = 0.002;

type Crossover = 'bullish' | 'bearish';
type Interpretation = 'momentum' | 'contrarian';

interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ResearchMarket {
  symbol: string;
  candles: Candle[];
}

interface ResearchDataset {
  version: number;
  interval: string;
  startTime: number;
  endTime: number;
  markets: ResearchMarket[];
}

interface AggregateResult {
  shortEma: number;
  longEma: number;
  crossover: Crossover;
  interpretation: Interpretation;
  horizonMinutes: number;
  signals: number;
  profitableSignals: number;
  losingSignals: number;
  winRate: number;
  averageGrossReturn: number;
  averageNetReturn: number;
  totalNetReturn: number;
  averagePositiveReturn: number | null;
  averageNegativeReturn: number | null;
  medianNetReturn: number;
}

interface Accumulator {
  returns: number[];
  grossReturnTotal: number;
  netReturnTotal: number;
  profitableSignals: number;
  losingSignals: number;
}

function calculateEmaSeries(
  prices: number[],
  period: number
): number[] {
  const result = new Array<number>(prices.length);

  if (prices.length === 0) {
    return result;
  }

  const multiplier = 2 / (period + 1);

  result[0] = prices[0];

  for (let i = 1; i < prices.length; i++) {
    result[i] =
      prices[i] * multiplier +
      result[i - 1] * (1 - multiplier);
  }

  return result;
}

function createAccumulator(): Accumulator {
  return {
    returns: [],
    grossReturnTotal: 0,
    netReturnTotal: 0,
    profitableSignals: 0,
    losingSignals: 0,
  };
}

function createAccumulatorKey(
  crossover: Crossover,
  interpretation: Interpretation,
  horizonMinutes: number
): string {
  return `${crossover}:${interpretation}:${horizonMinutes}`;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (
      (sorted[middle - 1] + sorted[middle]) / 2
    );
  }

  return sorted[middle];
}

function round(value: number): number {
  return Number(value.toFixed(8));
}

function calculateDirectionalReturn(
  entryPrice: number,
  exitPrice: number,
  crossover: Crossover,
  interpretation: Interpretation
): number {
  const priceReturn =
    (exitPrice - entryPrice) / entryPrice;

  const longPosition =
    interpretation === 'momentum'
      ? crossover === 'bullish'
      : crossover === 'bearish';

  return longPosition
    ? priceReturn
    : -priceReturn;
}

function processMarket(
  market: ResearchMarket,
  shortEma: number,
  longEma: number,
  accumulators: Map<string, Accumulator>
): void {
  const candles = market.candles;

  if (candles.length <= longEma) {
    return;
  }

  const prices = candles.map(
    (candle) => candle.close
  );

  const shortValues = calculateEmaSeries(
    prices,
    shortEma
  );

  const longValues = calculateEmaSeries(
    prices,
    longEma
  );

  /*
   * We only need to detect each crossover once.
   *
   * Bullish:
   * previous short <= previous long
   * current short  > current long
   *
   * Bearish:
   * previous short >= previous long
   * current short  < current long
   */
  for (
    let index = longEma;
    index < candles.length;
    index++
  ) {
    const previousShort =
      shortValues[index - 1];

    const previousLong =
      longValues[index - 1];

    const currentShort =
      shortValues[index];

    const currentLong =
      longValues[index];

    let crossover: Crossover | null = null;

    if (
      previousShort <= previousLong &&
      currentShort > currentLong
    ) {
      crossover = 'bullish';
    } else if (
      previousShort >= previousLong &&
      currentShort < currentLong
    ) {
      crossover = 'bearish';
    }

    if (crossover === null) {
      continue;
    }

    const entryPrice =
      candles[index].close;

    for (const horizonMinutes of HORIZONS) {
      const exitIndex =
        index + horizonMinutes;

      if (exitIndex >= candles.length) {
        continue;
      }

      const exitPrice =
        candles[exitIndex].close;

      for (const interpretation of [
        'momentum',
        'contrarian',
      ] as const) {
        const directionalReturn =
          calculateDirectionalReturn(
            entryPrice,
            exitPrice,
            crossover,
            interpretation
          );

        const netReturn =
          directionalReturn - TOTAL_COST;

        const key =
          createAccumulatorKey(
            crossover,
            interpretation,
            horizonMinutes
          );

        const accumulator =
          accumulators.get(key);

        if (!accumulator) {
          throw new Error(
            `Missing accumulator: ${key}`
          );
        }

        accumulator.returns.push(
          netReturn
        );

        accumulator.grossReturnTotal +=
          directionalReturn;

        accumulator.netReturnTotal +=
          netReturn;

        if (netReturn > 0) {
          accumulator.profitableSignals++;
        } else if (netReturn < 0) {
          accumulator.losingSignals++;
        }
      }
    }
  }
}

function buildResults(
  shortEma: number,
  longEma: number,
  accumulators: Map<string, Accumulator>
): AggregateResult[] {
  const results: AggregateResult[] = [];

  for (const crossover of [
    'bullish',
    'bearish',
  ] as const) {
    for (const interpretation of [
      'momentum',
      'contrarian',
    ] as const) {
      for (const horizonMinutes of HORIZONS) {
        const key =
          createAccumulatorKey(
            crossover,
            interpretation,
            horizonMinutes
          );

        const accumulator =
          accumulators.get(key);

        if (!accumulator) {
          throw new Error(
            `Missing accumulator: ${key}`
          );
        }

        const signals =
          accumulator.returns.length;

        const positiveReturns =
          accumulator.returns.filter(
            (value) => value > 0
          );

        const negativeReturns =
          accumulator.returns.filter(
            (value) => value < 0
          );

        results.push({
          shortEma,
          longEma,
          crossover,
          interpretation,
          horizonMinutes,

          signals,

          profitableSignals:
            accumulator.profitableSignals,

          losingSignals:
            accumulator.losingSignals,

          winRate:
            signals === 0
              ? 0
              : round(
                  accumulator.profitableSignals /
                    signals
                ),

          averageGrossReturn:
            signals === 0
              ? 0
              : round(
                  accumulator.grossReturnTotal /
                    signals
                ),

          averageNetReturn:
            signals === 0
              ? 0
              : round(
                  accumulator.netReturnTotal /
                    signals
                ),

          totalNetReturn: round(
            accumulator.netReturnTotal
          ),

          averagePositiveReturn:
            positiveReturns.length === 0
              ? null
              : round(
                  positiveReturns.reduce(
                    (total, value) =>
                      total + value,
                    0
                  ) /
                    positiveReturns.length
                ),

          averageNegativeReturn:
            negativeReturns.length === 0
              ? null
              : round(
                  negativeReturns.reduce(
                    (total, value) =>
                      total + value,
                    0
                  ) /
                    negativeReturns.length
                ),

          medianNetReturn: round(
            calculateMedian(
              accumulator.returns
            )
          ),
        });
      }
    }
  }

  return results;
}

export function analyseEmaCrossovers(
  inputPath: string
): string {
  console.log(
    `Loading research data from ${inputPath}`
  );

  const fileContents =
    fs.readFileSync(inputPath, 'utf8');

  const dataset =
    JSON.parse(
      fileContents
    ) as ResearchDataset;

  console.log(
    `Loaded ${dataset.markets.length} markets`
  );

  console.log(
    `Testing ${EMA_PAIRS.length} EMA pairs`
  );

  console.log(
    `Horizons: ${HORIZONS.join(', ')} minutes`
  );

  console.log(
    `Round-trip cost: ${TOTAL_COST * 100}%`
  );

  const allResults: AggregateResult[] = [];

  for (
    let pairIndex = 0;
    pairIndex < EMA_PAIRS.length;
    pairIndex++
  ) {
    const [shortEma, longEma] =
      EMA_PAIRS[pairIndex];

    console.log(
      `\nEMA pair ${pairIndex + 1}/${EMA_PAIRS.length}: ${shortEma}/${longEma}`
    );

    const accumulators =
      new Map<string, Accumulator>();

    for (const crossover of [
      'bullish',
      'bearish',
    ] as const) {
      for (const interpretation of [
        'momentum',
        'contrarian',
      ] as const) {
        for (const horizonMinutes of HORIZONS) {
          accumulators.set(
            createAccumulatorKey(
              crossover,
              interpretation,
              horizonMinutes
            ),
            createAccumulator()
          );
        }
      }
    }

    for (
      let marketIndex = 0;
      marketIndex < dataset.markets.length;
      marketIndex++
    ) {
      const market =
        dataset.markets[marketIndex];

      processMarket(
        market,
        shortEma,
        longEma,
        accumulators
      );

      if (
        (marketIndex + 1) % 10 === 0 ||
        marketIndex ===
          dataset.markets.length - 1
      ) {
        console.log(
          `  Processed ${marketIndex + 1}/${dataset.markets.length} markets`
        );
      }
    }

    const pairResults =
      buildResults(
        shortEma,
        longEma,
        accumulators
      );

    allResults.push(...pairResults);

    /*
     * Release the references to the EMA arrays and
     * market-level processing data before moving to
     * the next pair.
     */
  }

  const output: {
    version: number;
    generatedAt: string;
    sourceDataset: {
      version: number;
      interval: string;
      startTime: number;
      endTime: number;
      markets: number;
    };
    totalCost: number;
    emaPairs: Array<{
      short: number;
      long: number;
    }>;
    horizons: number[];
    results: AggregateResult[];
  } = {
    version: 1,

    generatedAt:
      new Date().toISOString(),

    sourceDataset: {
      version: dataset.version,
      interval: dataset.interval,
      startTime: dataset.startTime,
      endTime: dataset.endTime,
      markets: dataset.markets.length,
    },

    totalCost: TOTAL_COST,

    emaPairs: EMA_PAIRS.map(
      ([short, long]) => ({
        short,
        long,
      })
    ),

    horizons: [...HORIZONS],

    results: allResults,
  };

  const outputDirectory =
    path.join(
      path.dirname(
        fileURLToPath(import.meta.url)
      ),
      'research-output'
    );

  fs.mkdirSync(outputDirectory, {
    recursive: true,
  });

  const outputPath = path.join(
    outputDirectory,
    `ema-analysis-${Date.now()}.json`
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(output, null, 2),
    'utf8'
  );

  console.log(
    `\nAnalysis saved to ${outputPath}`
  );

  console.log(
    `Results generated: ${allResults.length}`
  );

  return outputPath;
}

const inputPath = process.argv[2];

if (!inputPath) {
  console.error(
    'Usage: npx tsx server/ema-analysis-runner.ts <ema-data-file.json>'
  );

  process.exit(1);
}

analyseEmaCrossovers(inputPath);