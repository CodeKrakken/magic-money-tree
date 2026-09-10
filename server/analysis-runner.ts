import fs from "fs";
import path from "path";

interface Candle {
  openTime: number;
  closeTime: number;
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

interface RawDataset {
  generatedAt: string;
  interval: string;
  lookbackDays: number;
  markets: MarketData[];
}

interface Observation {
  symbol: string;
  timestamp: number;

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

  target05Stop03: PathResult;
  target05Stop05: PathResult;
  target03Stop03: PathResult;
}

interface PathResult {
  result: "target" | "stop" | "neither";
  timeToResult: number | null;
  mae: number;
  mfe: number;
}

interface FeatureDefinition {
  name: keyof FeatureValues;
  direction: "high" | "low";
}

interface FeatureValues {
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
  feature: FeatureDefinition;
  percentile: number;
}

interface CombinationResult {
  conditions: string[];

  target: number;
  stop: number;

  observations: number;

  targetRate: number;
  stopRate: number;
  neitherRate: number;

  averageTimeToTarget: number | null;

  averageMae: number;
  averageMfe: number;

  targetNetReturn: number;
  stopNetReturn: number;

  expectancy: number;

  annualised?: never;
}

const OUTPUT_DIR = path.join(
  process.cwd(),
  "server",
  "research-output"
);

const TOTAL_COST = 0.002;

/*
 * These are the economically interesting paths.
 *
 * +0.5% target / -0.3% stop:
 *
 * target = +0.5% - 0.2% costs = +0.3%
 * stop   = -0.3% - 0.2% costs = -0.5%
 *
 * Break-even target-first rate is therefore 62.5%.
 */
const PATHS = [
  {
    name: "target05_stop03",
    target: 0.005,
    stop: -0.003,
  },
  {
    name: "target05_stop05",
    target: 0.005,
    stop: -0.005,
  },
  {
    name: "target03_stop03",
    target: 0.003,
    stop: -0.003,
  },
] as const;

const MIN_LOOKBACK = 50;
const MAX_FORWARD_MINUTES = 120;

/*
 * We deliberately use fairly broad percentile thresholds.
 *
 * 20/80:
 *   bottom 20% / top 20%
 *
 * 30/70:
 *   bottom 30% / top 30%
 *
 * 40/60:
 *   bottom 40% / top 40%
 *
 * This avoids searching thousands of arbitrary numerical
 * thresholds and greatly reduces overfitting.
 */
const PERCENTILES = [20, 30, 40, 60, 70, 80];

/*
 * A combination must contain enough observations to have
 * some statistical credibility.
 */
const MIN_COMBINATION_OBSERVATIONS = 500;

/*
 * We test pairs first and triples second.
 *
 * Going beyond three conditions at this stage would make
 * overfitting much too easy.
 */
const MAX_CONDITIONS = 2;

const RESEARCH_MARKET_LIMIT = 5;

function findLatestDataFile(): string {
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter(
      (file) =>
        file.startsWith("ema-data-") &&
        file.endsWith(".json")
    )
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No ema-data-*.json files found in ${OUTPUT_DIR}`
    );
  }

  return path.join(
    OUTPUT_DIR,
    files[files.length - 1]
  );
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function percentile(
  sortedValues: number[],
  percentileValue: number
): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const position =
    (percentileValue / 100) *
    (sortedValues.length - 1);

  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = position - lower;

  return (
    sortedValues[lower] * (1 - weight) +
    sortedValues[upper] * weight
  );
}

function priceReturn(
  candles: Candle[],
  index: number,
  lookback: number
): number {
  const start =
    candles[index - lookback]?.close;

  const end =
    candles[index]?.close;

  if (
    start === undefined ||
    end === undefined ||
    start === 0
  ) {
    return 0;
  }

  return (end - start) / start;
}

function regressionSlope(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex =
    endIndex - lookback + 1;

  if (startIndex < 0) {
    return 0;
  }

  const values = candles
    .slice(startIndex, endIndex + 1)
    .map((candle) => candle.close);

  if (values.length < 2) {
    return 0;
  }

  const meanX =
    (values.length - 1) / 2;

  const meanY = mean(values);

  let numerator = 0;
  let denominator = 0;

  for (
    let i = 0;
    i < values.length;
    i += 1
  ) {
    const x = i - meanX;
    const y = values[i] - meanY;

    numerator += x * y;
    denominator += x * x;
  }

  if (
    denominator === 0 ||
    meanY === 0
  ) {
    return 0;
  }

  return (
    numerator / denominator / meanY
  );
}

function maximumDrawdown(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex =
    endIndex - lookback + 1;

  if (startIndex < 0) {
    return 0;
  }

  let highest =
    candles[startIndex].close;

  let maximum = 0;

  for (
    let index = startIndex;
    index <= endIndex;
    index += 1
  ) {
    const close =
      candles[index].close;

    if (close > highest) {
      highest = close;
    }

    if (highest > 0) {
      const drawdown =
        (close - highest) / highest;

      if (drawdown < maximum) {
        maximum = drawdown;
      }
    }
  }

  return maximum;
}

function volatility(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex =
    endIndex - lookback;

  if (startIndex < 0) {
    return 0;
  }

  const returns: number[] = [];

  for (
    let index = startIndex + 1;
    index <= endIndex;
    index += 1
  ) {
    const previous =
      candles[index - 1].close;

    const current =
      candles[index].close;

    if (previous > 0) {
      returns.push(
        (current - previous) /
          previous
      );
    }
  }

  if (returns.length === 0) {
    return 0;
  }

  const average = mean(returns);

  const variance = mean(
    returns.map(
      (value) =>
        (value - average) ** 2
    )
  );

  return Math.sqrt(variance);
}

function efficiencyRatio(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const startIndex =
    endIndex - lookback;

  if (startIndex < 0) {
    return 0;
  }

  const start =
    candles[startIndex].close;

  const end =
    candles[endIndex].close;

  let totalMovement = 0;

  for (
    let index = startIndex + 1;
    index <= endIndex;
    index += 1
  ) {
    totalMovement += Math.abs(
      candles[index].close -
        candles[index - 1].close
    );
  }

  if (totalMovement === 0) {
    return 0;
  }

  return (
    Math.abs(end - start) /
    totalMovement
  );
}

function calculatePath(
  candles: Candle[],
  entryIndex: number,
  target: number,
  stop: number
): PathResult {
  const entryPrice =
    candles[entryIndex].close;

  let mae = 0;
  let mfe = 0;

  const lastIndex = Math.min(
    candles.length - 1,
    entryIndex +
      MAX_FORWARD_MINUTES
  );

  for (
    let index = entryIndex + 1;
    index <= lastIndex;
    index += 1
  ) {
    const candle = candles[index];

    const highReturn =
      (candle.high - entryPrice) /
      entryPrice;

    const lowReturn =
      (candle.low - entryPrice) /
      entryPrice;

    mfe = Math.max(
      mfe,
      highReturn
    );

    mae = Math.min(
      mae,
      lowReturn
    );

    const hitTarget =
      highReturn >= target;

    const hitStop =
      lowReturn <= stop;

    /*
     * If both levels occur in the same
     * candle, OHLC data cannot establish
     * which happened first.
     *
     * Do not manufacture an ordering.
     */
    if (hitTarget && hitStop) {
      return {
        result: "neither",
        timeToResult: null,
        mae,
        mfe,
      };
    }

    if (hitTarget) {
      return {
        result: "target",
        timeToResult:
          index - entryIndex,
        mae,
        mfe,
      };
    }

    if (hitStop) {
      return {
        result: "stop",
        timeToResult:
          index - entryIndex,
        mae,
        mfe,
      };
    }
  }

  return {
    result: "neither",
    timeToResult: null,
    mae,
    mfe,
  };
}

function calculateFeatures(
  candles: Candle[],
  index: number
): FeatureValues {
  const slope20 =
    regressionSlope(
      candles,
      index,
      20
    );

  const slope50 =
    regressionSlope(
      candles,
      index,
      50
    );

  return {
    return20: priceReturn(
      candles,
      index,
      20
    ),

    return50: priceReturn(
      candles,
      index,
      50
    ),

    slope20,

    slope50,

    drawdown20:
      maximumDrawdown(
        candles,
        index,
        20
      ),

    drawdown50:
      maximumDrawdown(
        candles,
        index,
        50
      ),

    volatility20:
      volatility(
        candles,
        index,
        20
      ),

    volatility50:
      volatility(
        candles,
        index,
        50
      ),

    efficiency20:
      efficiencyRatio(
        candles,
        index,
        20
      ),

    efficiency50:
      efficiencyRatio(
        candles,
        index,
        50
      ),

    acceleration:
      slope20 - slope50,
  };
}

function buildObservations(
  dataset: RawDataset
): Observation[] {
  const observations: Observation[] =
    [];

  let processed = 0;

  for (const market of dataset.markets) {
    const candles =
      market.candles;

    const firstIndex =
      MIN_LOOKBACK;

    const lastIndex =
      candles.length -
      MAX_FORWARD_MINUTES -
      1;

    for (
      let index = firstIndex;
      index <= lastIndex;
      index += 1
    ) {
      const features =
        calculateFeatures(
          candles,
          index
        );

      const target05Stop03 =
        calculatePath(
          candles,
          index,
          0.005,
          -0.003
        );

      const target05Stop05 =
        calculatePath(
          candles,
          index,
          0.005,
          -0.005
        );

      const target03Stop03 =
        calculatePath(
          candles,
          index,
          0.003,
          -0.003
        );

      observations.push({
        symbol: market.symbol,
        timestamp:
          candles[index].closeTime,

        ...features,

        target05Stop03,
        target05Stop05,
        target03Stop03,
      });

      processed += 1;

      if (
        processed % 100000 ===
        0
      ) {
        console.log(
          `Processed ${processed.toLocaleString()} observations`
        );
      }
    }
  }

  return observations;
}

function getFeatureDefinitions(): FeatureDefinition[] {
  return [
    {
      name: "return20",
      direction: "low",
    },
    {
      name: "return50",
      direction: "low",
    },
    {
      name: "slope20",
      direction: "low",
    },
    {
      name: "slope50",
      direction: "low",
    },
    {
      name: "drawdown20",
      direction: "high",
    },
    {
      name: "drawdown50",
      direction: "high",
    },
    {
      name: "volatility20",
      direction: "high",
    },
    {
      name: "volatility50",
      direction: "high",
    },
    {
      name: "efficiency20",
      direction: "low",
    },
    {
      name: "efficiency50",
      direction: "low",
    },
    {
      name: "acceleration",
      direction: "high",
    },
  ];
}

function getFeatureValue(
  observation: Observation,
  feature: FeatureDefinition
): number {
  return observation[
    feature.name
  ];
}

function buildThresholds(
  observations: Observation[]
): Map<
  string,
  Map<number, number>
> {
  const thresholds = new Map<
    string,
    Map<number, number>
  >();

  for (const feature of getFeatureDefinitions()) {
    const values = observations
      .map((observation) =>
        getFeatureValue(
          observation,
          feature
        )
      )
      .sort(
        (a, b) => a - b
      );

    const featureThresholds =
      new Map<number, number>();

    for (const percentileValue of PERCENTILES) {
      featureThresholds.set(
        percentileValue,
        percentile(
          values,
          percentileValue
        )
      );
    }

    thresholds.set(
      feature.name,
      featureThresholds
    );
  }

  return thresholds;
}

function conditionMatches(
  observation: Observation,
  condition: Condition,
  thresholds: Map<
    string,
    Map<number, number>
  >
): boolean {
  const threshold =
    thresholds
      .get(condition.feature.name)
      ?.get(condition.percentile);

  if (threshold === undefined) {
    throw new Error(
      `Missing threshold for ${condition.feature.name}`
    );
  }

  const value =
    getFeatureValue(
      observation,
      condition.feature
    );

  if (
    condition.feature.direction ===
    "low"
  ) {
    return value <= threshold;
  }

  return value >= threshold;
}

function conditionLabel(
  condition: Condition
): string {
  const direction =
    condition.feature.direction ===
    "low"
      ? "<="
      : ">=";

  return (
    `${condition.feature.name} ` +
    `${direction} P${condition.percentile}`
  );
}

function combinations<T>(
  values: T[],
  size: number
): T[][] {
  const results: T[][] = [];

  function recurse(
    start: number,
    current: T[]
  ): void {
    if (current.length === size) {
      results.push([...current]);
      return;
    }

    for (
      let index = start;
      index < values.length;
      index += 1
    ) {
      recurse(
        index + 1,
        [...current, values[index]]
      );
    }
  }

  recurse(0, []);

  return results;
}

function evaluateCombination(
  observations: Observation[],
  conditions: Condition[],
  thresholds: Map<
    string,
    Map<number, number>
  >,
  target: number,
  stop: number
): CombinationResult | null {
  let matched = 0;
  let targetCount = 0;
  let stopCount = 0;
  let neitherCount = 0;

  const targetTimes: number[] = [];
  const maes: number[] = [];
  const mfes: number[] = [];

  for (const observation of observations) {
    let matches = true;

    for (const condition of conditions) {
      if (
        !conditionMatches(
          observation,
          condition,
          thresholds
        )
      ) {
        matches = false;
        break;
      }
    }

    if (!matches) {
      continue;
    }

    matched += 1;

    let outcome: PathResult;

    if (
      target === 0.005 &&
      stop === -0.003
    ) {
      outcome =
        observation.target05Stop03;
    } else if (
      target === 0.005 &&
      stop === -0.005
    ) {
      outcome =
        observation.target05Stop05;
    } else {
      outcome =
        observation.target03Stop03;
    }

    if (outcome.result === "target") {
      targetCount += 1;

      if (
        outcome.timeToResult !== null
      ) {
        targetTimes.push(
          outcome.timeToResult
        );
      }
    } else if (
      outcome.result === "stop"
    ) {
      stopCount += 1;
    } else {
      neitherCount += 1;
    }

    maes.push(outcome.mae);
    mfes.push(outcome.mfe);
  }

  if (
    matched <
    MIN_COMBINATION_OBSERVATIONS
  ) {
    return null;
  }

  const targetRate =
    targetCount / matched;

  const stopRate =
    stopCount / matched;

  const neitherRate =
    neitherCount / matched;

  const targetNetReturn =
    target - TOTAL_COST;

  const stopNetReturn =
    stop - TOTAL_COST;

  /*
   * "Neither" has zero realised return
   * for this simplified path expectancy.
   */
  const expectancy =
    targetRate *
      targetNetReturn +
    stopRate *
      stopNetReturn;

  return {
    conditions:
      conditions.map(
        conditionLabel
      ),

    target,
    stop,

    observations: matched,

    targetRate,
    stopRate,
    neitherRate,

    averageTimeToTarget:
      targetTimes.length === 0
        ? null
        : mean(targetTimes),

    averageMae:
      mean(maes),

    averageMfe:
      mean(mfes),

    targetNetReturn,
    stopNetReturn,

    expectancy,
  };
}

function buildConditions(
  feature: FeatureDefinition
): Condition[] {
  return PERCENTILES.map(
    (percentileValue) => ({
      feature,
      percentile:
        percentileValue,
    })
  );
}

function searchCombinations(
  observations: Observation[],
  thresholds: Map<
    string,
    Map<number, number>
  >
): CombinationResult[] {
  const definitions =
    getFeatureDefinitions();

  const allConditions =
    definitions.flatMap(
      buildConditions
    );

  const results: CombinationResult[] =
    [];

  for (
    let size = 1;
    size <= MAX_CONDITIONS;
    size += 1
  ) {
    console.log(
      `\nSearching ${size}-condition combinations...`
    );

    const candidates =
      combinations(
        allConditions,
        size
      ).filter((conditions) => {
        /*
         * Don't allow the same feature
         * to appear twice in a combination.
         */
        const features =
          conditions.map(
            (condition) =>
              condition.feature.name
          );

        return (
          new Set(features).size ===
          features.length
        );
      });

    console.log(
      `Candidates: ${candidates.length.toLocaleString()}`
    );

    for (
      let index = 0;
      index < candidates.length;
      index += 1
    ) {
      const conditions =
        candidates[index];

      for (const path of PATHS) {
        const result =
          evaluateCombination(
            observations,
            conditions,
            thresholds,
            path.target,
            path.stop
          );

        if (result !== null) {
          results.push(result);
        }
      }

      if (
        (index + 1) % 1000 ===
        0
      ) {
        console.log(
          `Evaluated ${(
            index + 1
          ).toLocaleString()} / ${candidates.length.toLocaleString()}`
        );
      }
    }
  }

  return results;
}

function printResults(
  results: CombinationResult[]
): void {
  for (const path of PATHS) {
    console.log(
      "\n========================================"
    );

    console.log(
      `TARGET ${percentage(
        path.target
      )} / STOP ${percentage(
        path.stop
      )}`
    );

    console.log(
      "========================================"
    );

    const relevant =
      results.filter(
        (result) =>
          result.target ===
            path.target &&
          result.stop ===
            path.stop
      );

    const best = [...relevant]
      .sort(
        (a, b) =>
          b.expectancy -
          a.expectancy
      )
      .slice(0, 20);

    if (best.length === 0) {
      console.log(
        "No combinations met the minimum sample size."
      );

      continue;
    }

    for (
      let index = 0;
      index < best.length;
      index += 1
    ) {
      const result =
        best[index];

      console.log(
        `\n#${index + 1}`
      );

      console.log(
        result.conditions.join(
          " AND "
        )
      );

      console.log(
        `observations: ${result.observations.toLocaleString()}`
      );

      console.log(
        `target first: ${percentage(
          result.targetRate
        )}`
      );

      console.log(
        `stop first:   ${percentage(
          result.stopRate
        )}`
      );

      console.log(
        `neither:      ${percentage(
          result.neitherRate
        )}`
      );

      console.log(
        `expectancy:   ${percentage(
          result.expectancy
        )}`
      );

      console.log(
        `avg target:   ${
          result.averageTimeToTarget ===
          null
            ? "n/a"
            : `${result.averageTimeToTarget.toFixed(
                1
              )} minutes`
        }`
      );

      console.log(
        `avg MAE:      ${percentage(
          result.averageMae
        )}`
      );

      console.log(
        `avg MFE:      ${percentage(
          result.averageMfe
        )}`
      );
    }
  }
}

function printBreakEvenRates(): void {
  console.log(
    "\n========================================"
  );

  console.log(
    "BREAK-EVEN TARGET-FIRST RATES"
  );

  console.log(
    "========================================\n"
  );

  for (const path of PATHS) {
    const targetNet =
      path.target -
      TOTAL_COST;

    const stopNet =
      path.stop -
      TOTAL_COST;

    /*
     * p * targetNet +
     * (1-p) * stopNet = 0
     *
     * p = -stopNet /
     *     (targetNet - stopNet)
     */
    const breakEven =
      -stopNet /
      (targetNet - stopNet);

    console.log(
      `${percentage(
        path.target
      )} target / ${percentage(
        path.stop
      )} stop: ` +
        `${percentage(
          breakEven
        )}`
    );
  }
}

function main(): void {
  console.log(
    "Loading raw historical dataset..."
  );

  const inputFile =
    findLatestDataFile();

  console.log(
    `Input: ${inputFile}`
  );

  const dataset = JSON.parse(
    fs.readFileSync(
      inputFile,
      "utf8"
    )
  ) as RawDataset;

  const researchDataset: RawDataset = {
    ...dataset,
    markets: dataset.markets.slice(
      0,
      RESEARCH_MARKET_LIMIT
    ),
  };

  console.log(
    `Markets: ${researchDataset.markets.length}`
  );

  console.log(
    `Research markets: ${researchDataset.markets
      .map((market) => market.symbol)
      .join(", ")}`
  );

  console.log(
    `Markets: ${dataset.markets.length}`
  );

  console.log(
    `Interval: ${dataset.interval}`
  );

  console.log(
    `Lookback: ${dataset.lookbackDays} days`
  );

  console.log(
    `Assumed trading cost: ${percentage(
      TOTAL_COST
    )}`
  );

  printBreakEvenRates();

  console.log(
    "\nBuilding observations..."
  );

  const observations =
  buildObservations(researchDataset);

  console.log(
    `\nBuilt ${observations.length.toLocaleString()} observations`
  );

  console.log(
    "\nBuilding feature thresholds..."
  );

  const thresholds =
    buildThresholds(
      observations
    );

  console.log(
    "Searching combinations..."
  );

  const results =
    searchCombinations(
      observations,
      thresholds
    );

  console.log(
    `\nFound ${results.length.toLocaleString()} qualifying combinations`
  );

  printResults(results);

  const sortedResults =
    [...results].sort(
      (a, b) =>
        b.expectancy -
        a.expectancy
    );

  const output = {
    generatedAt:
      new Date().toISOString(),

    sourceFile:
      path.basename(inputFile),

    markets:
      researchDataset.markets.length,

    interval:
      dataset.interval,

    lookbackDays:
      dataset.lookbackDays,

    observations:
      observations.length,

    assumptions: {
      totalCost: TOTAL_COST,

      minimumCombinationObservations:
        MIN_COMBINATION_OBSERVATIONS,

      maxForwardMinutes:
        MAX_FORWARD_MINUTES,

      percentiles:
        PERCENTILES,

      maxConditions:
        MAX_CONDITIONS,

      paths: PATHS,
    },

    bestResults:
      sortedResults.slice(0, 500),
  };

  const outputFile =
    path.join(
      OUTPUT_DIR,
      `combination-analysis-${Date.now()}.json`
    );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    `\nSaved analysis to: ${outputFile}`
  );
}

main();