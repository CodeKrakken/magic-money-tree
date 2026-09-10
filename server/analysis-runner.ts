import fs from "fs";
import path from "path";

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawMarket {
  symbol: string;
  candles: Candle[];
}

interface RawDataset {
  markets: RawMarket[];
}

interface Observation {
  symbol: string;
  index: number;
  price: number;

  return20: number;
  return50: number;

  slope20: number;
  slope50: number;

  drawdown20: number;
  drawdown50: number;

  volatility20: number;
  volatility50: number;

  efficiency20: number;
  efficiency50: number;

  acceleration: number;
}

interface Condition {
  feature: keyof Pick<
    Observation,
    | "return20"
    | "return50"
    | "slope20"
    | "slope50"
    | "drawdown20"
    | "drawdown50"
    | "volatility20"
    | "volatility50"
    | "efficiency20"
    | "efficiency50"
    | "acceleration"
  >;
  operator: "<=" | ">=";
  percentile: number;
  threshold: number;
}

interface ForwardResult {
  return5: number;
  return10: number;
  return20: number;
  return50: number;
  return120: number;

  mfe5: number;
  mfe10: number;
  mfe20: number;
  mfe50: number;
  mfe120: number;

  mae5: number;
  mae10: number;
  mae20: number;
  mae50: number;
  mae120: number;
}

interface CombinationResult {
  conditions: Condition[];
  observations: number;

  horizons: {
    "5": HorizonResult;
    "10": HorizonResult;
    "20": HorizonResult;
    "50": HorizonResult;
    "120": HorizonResult;
  };
}

interface HorizonResult {
  averageReturn: number;
  medianReturn: number;
  positiveRate: number;
  profitableRate: number;
  averageMfe: number;
  averageMae: number;
  medianMfe: number;
  medianMae: number;
}

const TOTAL_COST = 0.002;

const RESEARCH_MARKET_LIMIT = 5;

const MIN_LOOKBACK = 50;
const MAX_FORWARD_MINUTES = 120;

const PERCENTILES = [20, 30, 40, 60, 70, 80];

const MIN_COMBINATION_OBSERVATIONS = 500;
const MAX_CONDITIONS = 2;

const HORIZONS = [5, 10, 20, 50, 120] as const;

const FEATURES: Array<Condition["feature"]> = [
  "return20",
  "return50",
  "slope20",
  "slope50",
  "drawdown20",
  "drawdown50",
  "volatility20",
  "volatility50",
  "efficiency20",
  "efficiency50",
  "acceleration",
];

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);

  if (sorted.length === 0) {
    throw new Error("Cannot calculate percentile of empty array");
  }

  const index = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return percentile(values, 50);
}

function calculateSlope(prices: number[]): number {
  if (prices.length < 2) {
    return 0;
  }

  const n = prices.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;

  const averagePrice = mean(prices);

  if (averagePrice === 0) {
    return 0;
  }

  return slope / averagePrice;
}

function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) {
    return 0;
  }

  const returns: number[] = [];

  for (let i = 1; i < prices.length; i += 1) {
    returns.push(prices[i] / prices[i - 1] - 1);
  }

  const average = mean(returns);

  const variance =
    mean(returns.map((value) => (value - average) ** 2));

  return Math.sqrt(variance);
}

function calculateEfficiency(prices: number[]): number {
  if (prices.length < 2) {
    return 0;
  }

  const netMove = Math.abs(prices[prices.length - 1] - prices[0]);

  let pathLength = 0;

  for (let i = 1; i < prices.length; i += 1) {
    pathLength += Math.abs(prices[i] - prices[i - 1]);
  }

  if (pathLength === 0) {
    return 0;
  }

  return netMove / pathLength;
}

function calculateDrawdown(prices: number[]): number {
  if (prices.length === 0) {
    return 0;
  }

  let peak = prices[0];
  let maximumDrawdown = 0;

  for (const price of prices) {
    if (price > peak) {
      peak = price;
    }

    const drawdown = price / peak - 1;

    if (drawdown < maximumDrawdown) {
      maximumDrawdown = drawdown;
    }
  }

  return maximumDrawdown;
}

function buildObservation(
  market: RawMarket,
  index: number,
): Observation | null {
  if (index < MIN_LOOKBACK) {
    return null;
  }

  const prices = market.candles.map((candle) => candle.close);

  const currentPrice = prices[index];

  if (!currentPrice || !Number.isFinite(currentPrice)) {
    return null;
  }

  const prices20 = prices.slice(index - 20, index + 1);
  const prices50 = prices.slice(index - 50, index + 1);

  const price20Ago = prices[index - 20];
  const price50Ago = prices[index - 50];

  const return20 = currentPrice / price20Ago - 1;
  const return50 = currentPrice / price50Ago - 1;

  const slope20 = calculateSlope(prices20);
  const slope50 = calculateSlope(prices50);

  const drawdown20 = calculateDrawdown(prices20);
  const drawdown50 = calculateDrawdown(prices50);

  const volatility20 = calculateVolatility(prices20);
  const volatility50 = calculateVolatility(prices50);

  const efficiency20 = calculateEfficiency(prices20);
  const efficiency50 = calculateEfficiency(prices50);

  const acceleration = slope20 - slope50;

  return {
    symbol: market.symbol,
    index,
    price: currentPrice,

    return20,
    return50,

    slope20,
    slope50,

    drawdown20,
    drawdown50,

    volatility20,
    volatility50,

    efficiency20,
    efficiency50,

    acceleration,
  };
}

function buildObservations(dataset: RawDataset): Observation[] {
  const observations: Observation[] = [];

  for (const market of dataset.markets) {
    const lastUsableIndex =
      market.candles.length - MAX_FORWARD_MINUTES;

    for (
      let index = MIN_LOOKBACK;
      index < lastUsableIndex;
      index += 1
    ) {
      const observation = buildObservation(market, index);

      if (observation) {
        observations.push(observation);
      }
    }
  }

  return observations;
}

function calculateForwardResult(
  market: RawMarket,
  index: number,
): ForwardResult | null {
  const entryPrice = market.candles[index]?.close;

  if (!entryPrice) {
    return null;
  }

  const returns: Record<number, number> = {};
  const mfes: Record<number, number> = {};
  const maes: Record<number, number> = {};

  for (const horizon of HORIZONS) {
    const endIndex = index + horizon;
    const endCandle = market.candles[endIndex];

    if (!endCandle) {
      return null;
    }

    returns[horizon] = endCandle.close / entryPrice - 1;

    let maximumHigh = entryPrice;
    let minimumLow = entryPrice;

    for (
      let i = index + 1;
      i <= endIndex;
      i += 1
    ) {
      const candle = market.candles[i];

      if (candle.high > maximumHigh) {
        maximumHigh = candle.high;
      }

      if (candle.low < minimumLow) {
        minimumLow = candle.low;
      }
    }

    mfes[horizon] = maximumHigh / entryPrice - 1;
    maes[horizon] = minimumLow / entryPrice - 1;
  }

  return {
    return5: returns[5],
    return10: returns[10],
    return20: returns[20],
    return50: returns[50],
    return120: returns[120],

    mfe5: mfes[5],
    mfe10: mfes[10],
    mfe20: mfes[20],
    mfe50: mfes[50],
    mfe120: mfes[120],

    mae5: maes[5],
    mae10: maes[10],
    mae20: maes[20],
    mae50: maes[50],
    mae120: maes[120],
  };
}

function buildForwardResults(
  dataset: RawDataset,
  observations: Observation[],
): Map<string, ForwardResult> {
  const markets = new Map(
    dataset.markets.map((market) => [market.symbol, market]),
  );

  const results = new Map<string, ForwardResult>();

  for (const observation of observations) {
    const market = markets.get(observation.symbol);

    if (!market) {
      continue;
    }

    const result = calculateForwardResult(
      market,
      observation.index,
    );

    if (result) {
      results.set(
        `${observation.symbol}:${observation.index}`,
        result,
      );
    }
  }

  return results;
}

function createConditions(
  observations: Observation[],
): Condition[] {
  const conditions: Condition[] = [];

  for (const feature of FEATURES) {
    const values = observations.map(
      (observation) => observation[feature],
    );

    for (const percentileValue of PERCENTILES) {
      const threshold = percentile(
        values,
        percentileValue,
      );

      conditions.push({
        feature,
        operator: "<=",
        percentile: percentileValue,
        threshold,
      });

      conditions.push({
        feature,
        operator: ">=",
        percentile: percentileValue,
        threshold,
      });
    }
  }

  return conditions;
}

function conditionMatches(
  observation: Observation,
  condition: Condition,
): boolean {
  const value = observation[condition.feature];

  if (condition.operator === "<=") {
    return value <= condition.threshold;
  }

  return value >= condition.threshold;
}

function conditionsMatch(
  observation: Observation,
  conditions: Condition[],
): boolean {
  return conditions.every((condition) =>
    conditionMatches(observation, condition),
  );
}

function describeCondition(condition: Condition): string {
  return `${condition.feature} ${condition.operator} P${condition.percentile}`;
}

function calculateHorizonResult(
  returns: number[],
  mfes: number[],
  maes: number[],
): HorizonResult {
  return {
    averageReturn: mean(returns),
    medianReturn: median(returns),

    positiveRate:
      returns.filter((value) => value > 0).length /
      returns.length,

    profitableRate:
      returns.filter((value) => value > TOTAL_COST).length /
      returns.length,

    averageMfe: mean(mfes),
    averageMae: mean(maes),

    medianMfe: median(mfes),
    medianMae: median(maes),
  };
}

function evaluateCombination(
  observations: Observation[],
  forwardResults: Map<string, ForwardResult>,
  conditions: Condition[],
): CombinationResult | null {
  const horizonReturns = new Map<number, number[]>();
  const horizonMfes = new Map<number, number[]>();
  const horizonMaes = new Map<number, number[]>();

  for (const horizon of HORIZONS) {
    horizonReturns.set(horizon, []);
    horizonMfes.set(horizon, []);
    horizonMaes.set(horizon, []);
  }

  let matched = 0;

  for (const observation of observations) {
    if (!conditionsMatch(observation, conditions)) {
      continue;
    }

    const forward = forwardResults.get(
      `${observation.symbol}:${observation.index}`,
    );

    if (!forward) {
      continue;
    }

    matched += 1;

    const values = {
      5: {
        return: forward.return5,
        mfe: forward.mfe5,
        mae: forward.mae5,
      },
      10: {
        return: forward.return10,
        mfe: forward.mfe10,
        mae: forward.mae10,
      },
      20: {
        return: forward.return20,
        mfe: forward.mfe20,
        mae: forward.mae20,
      },
      50: {
        return: forward.return50,
        mfe: forward.mfe50,
        mae: forward.mae50,
      },
      120: {
        return: forward.return120,
        mfe: forward.mfe120,
        mae: forward.mae120,
      },
    };

    for (const horizon of HORIZONS) {
      horizonReturns.get(horizon)!.push(
        values[horizon as 5 | 10 | 20 | 50 | 120].return,
      );

      horizonMfes.get(horizon)!.push(
        values[horizon as 5 | 10 | 20 | 50 | 120].mfe,
      );

      horizonMaes.get(horizon)!.push(
        values[horizon as 5 | 10 | 20 | 50 | 120].mae,
      );
    }
  }

  if (matched < MIN_COMBINATION_OBSERVATIONS) {
    return null;
  }

  const horizons = {} as CombinationResult["horizons"];

  for (const horizon of HORIZONS) {
    const result = calculateHorizonResult(
      horizonReturns.get(horizon)!,
      horizonMfes.get(horizon)!,
      horizonMaes.get(horizon)!,
    );

    horizons[String(horizon) as keyof CombinationResult["horizons"]] =
      result;
  }

  return {
    conditions,
    observations: matched,
    horizons,
  };
}

function generateCombinations(
  conditions: Condition[],
): Condition[][] {
  const combinations: Condition[][] = [];

  for (const condition of conditions) {
    combinations.push([condition]);
  }

  if (MAX_CONDITIONS < 2) {
    return combinations;
  }

  for (let i = 0; i < conditions.length; i += 1) {
    for (
      let j = i + 1;
      j < conditions.length;
      j += 1
    ) {
      const first = conditions[i];
      const second = conditions[j];

      if (first.feature === second.feature) {
        continue;
      }

      combinations.push([first, second]);
    }
  }

  return combinations;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function printTopResults(
  results: CombinationResult[],
): void {
  const sorted = [...results].sort(
    (a, b) =>
      b.horizons[20].averageReturn -
      a.horizons[20].averageReturn,
  );

  console.log("\nTop combinations by 20-minute average return:\n");

  for (const result of sorted.slice(0, 30)) {
    const conditionText = result.conditions
      .map(describeCondition)
      .join(" AND ");

    const h5 = result.horizons[5];
    const h20 = result.horizons[20];
    const h50 = result.horizons[50];
    const h120 = result.horizons[120];

    console.log(
      [
        conditionText,
        `n=${result.observations}`,
        `5m=${formatPercent(h5.averageReturn)}`,
        `20m=${formatPercent(h20.averageReturn)}`,
        `50m=${formatPercent(h50.averageReturn)}`,
        `120m=${formatPercent(h120.averageReturn)}`,
        `20m>cost=${formatPercent(h20.profitableRate)}`,
        `20m MFE=${formatPercent(h20.averageMfe)}`,
        `20m MAE=${formatPercent(h20.averageMae)}`,
      ].join(" | "),
    );
  }
}

function main(): void {
  const outputDirectory = path.join(
    process.cwd(),
    "server",
    "research-output",
  );

  const files = fs
    .readdirSync(outputDirectory)
    .filter(
      (file) =>
        file.startsWith("ema-data-") &&
        file.endsWith(".json"),
    )
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No ema-data JSON files found in ${outputDirectory}`,
    );
  }

  const sourceFile = files[files.length - 1];
  const sourcePath = path.join(
    outputDirectory,
    sourceFile,
  );

  console.log(`Loading ${sourceFile}`);

  const dataset = JSON.parse(
    fs.readFileSync(sourcePath, "utf8"),
  ) as RawDataset;

  const researchDataset: RawDataset = {
    ...dataset,
    markets: dataset.markets.slice(
      0,
      RESEARCH_MARKET_LIMIT,
    ),
  };

  console.log(
    `Research markets: ${researchDataset.markets.length}`,
  );

  console.log(
    `Symbols: ${researchDataset.markets
      .map((market) => market.symbol)
      .join(", ")}`,
  );

  const observations = buildObservations(
    researchDataset,
  );

  console.log(
    `Built ${observations.length} observations`,
  );

  const forwardResults = buildForwardResults(
    researchDataset,
    observations,
  );

  console.log(
    `Built ${forwardResults.size} forward-path records`,
  );

  const conditions = createConditions(observations);

  console.log(
    `Conditions: ${conditions.length}`,
  );

  const combinations = generateCombinations(
    conditions,
  );

  console.log(
    `Combinations: ${combinations.length}`,
  );

  const results: CombinationResult[] = [];

  let processed = 0;

  for (const combination of combinations) {
    const result = evaluateCombination(
      observations,
      forwardResults,
      combination,
    );

    if (result) {
      results.push(result);
    }

    processed += 1;

    if (processed % 500 === 0) {
      console.log(
        `Progress: ${processed}/${combinations.length}`,
      );
    }
  }

  console.log(
    `Qualifying combinations: ${results.length}`,
  );

  printTopResults(results);

  const timestamp = Date.now();

  const output = {
    generatedAt: new Date(timestamp).toISOString(),

    sourceFile,

    markets: researchDataset.markets.length,
    symbols: researchDataset.markets.map(
      (market) => market.symbol,
    ),

    observations: observations.length,

    totalCost: TOTAL_COST,

    horizons: HORIZONS,

    minimumCombinationObservations:
      MIN_COMBINATION_OBSERVATIONS,

    maxConditions: MAX_CONDITIONS,

    results: results
      .sort(
        (a, b) =>
          b.horizons[20].averageReturn -
          a.horizons[20].averageReturn,
      )
      .slice(0, 500),
  };

  const outputPath = path.join(
    outputDirectory,
    `forward-return-analysis-${timestamp}.json`,
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(output, null, 2),
  );

  console.log(`\nWritten: ${outputPath}`);
}

main();