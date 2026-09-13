import fs from "node:fs";
import path from "node:path";

type DatasetGroup = "Sample" | "OutOfSample";

interface MarketResult {
  symbol: string;
  datasetGroup: DatasetGroup;
  marketIndex: number;
  binanceArrayPosition: number;
  binance: Record<string, unknown>;
  netProfit: number;
  returnPct?: number;
  accepted?: number;
  buys?: number;
  sells?: number;
  winningPositions?: number;
  losingPositions?: number;
  averageProfitPerAcceptedPosition?: number;
}

interface ExperimentInput {
  generatedAt?: string;
  experiment?: string;
  sample?: {
    markets: MarketResult[];
  };
  outOfSample?: {
    markets: MarketResult[];
  };
}

interface FeatureValue {
  feature: string;
  value: number;
}

interface FeatureStats {
  feature: string;
  sampleSpearman: number;
  samplePearson: number;
  oosSpearman: number;
  oosPearson: number;
  allSpearman: number;
  allPearson: number;
  sampleMean: number;
  sampleStd: number;
  oosMean: number;
  oosStd: number;
  uniqueValues: number;
  sampleMin: number;
  sampleMax: number;
}

interface ModelCoefficient {
  feature: string;
  coefficient: number;
  absCoefficient: number;
  trainingCorrelation: number;
}

interface ScoredMarket {
  symbol: string;
  datasetGroup: DatasetGroup;
  binanceArrayPosition: number;
  actualNetProfit: number;
  actualRank: number;
  predictedScore: number;
  predictedRank: number;
  actualQuartile: number;
  predictedQuartile: number;
  rankError: number;
  absoluteRankError: number;
}

const INPUT_PATH = process.argv[2];

if (!INPUT_PATH) {
  console.error(
    "Usage: npx tsx server/binance-metadata-ranking.ts <market-strategy-ranking-json>",
  );
  process.exit(1);
}

const RIDGE_LAMBDA = 10;
const TOP_FEATURE_COUNT = 5;

function readJson(filePath: string): ExperimentInput {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file does not exist: ${resolved}`);
  }

  return JSON.parse(fs.readFileSync(resolved, "utf8")) as ExperimentInput;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function flattenNumericValues(
  value: unknown,
  prefix = "",
): Map<string, number> {
  const result = new Map<string, number>();

  if (isFiniteNumber(value)) {
    if (prefix) {
      result.set(prefix, value);
    }
    return result;
  }

  if (typeof value === "string") {
    const numeric = Number(value);

    if (Number.isFinite(numeric) && prefix) {
      result.set(prefix, numeric);
    }

    return result;
  }

  if (Array.isArray(value)) {
    /*
     * Arrays such as permissions/orderTypes are categorical collections.
     * Their contents are not directly numeric predictors.
     *
     * We deliberately only expose the length.
     */
    if (prefix) {
      result.set(`${prefix}.__length`, value.length);
    }

    return result;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;

      for (const [name, numeric] of flattenNumericValues(
        child,
        childPrefix,
      )) {
        result.set(name, numeric);
      }
    }
  }

  return result;
}

function extractFeatures(market: MarketResult): Map<string, number> {
  const features = flattenNumericValues(market.binance);

  /*
   * This field is outside exchangeInfo.symbol and is included explicitly.
   * It is still Binance-derived and was part of the original research output.
   */
  if (isFiniteNumber(market.binanceArrayPosition)) {
    features.set(
      "binanceArrayPosition",
      market.binanceArrayPosition,
    );
  }

  /*
   * Do not allow strategy results to leak into the predictors.
   */
  const forbidden = [
    "signals",
    "accepted",
    "rejectedByCapacity",
    "buys",
    "sells",
    "winningPositions",
    "losingPositions",
    "flatPositions",
    "grossProfit",
    "fees",
    "netProfit",
    "returnPct",
    "totalBuyNotional",
    "totalSellNotional",
    "target1PctCount",
    "target2PctCount",
    "target4PctCount",
    "stopCount",
    "maxHoldCount",
    "endOfDataCount",
    "averageHoldMinutes",
    "medianHoldMinutes",
    "averageProfitPerAcceptedPosition",
    "firstTarget1AvgMinutes",
    "firstTarget2AvgMinutes",
    "firstTarget4AvgMinutes",
    "averageSlope20",
    "averageAcceleration",
  ];

  for (const key of [...features.keys()]) {
    if (
      forbidden.some(
        (blocked) =>
          key === blocked ||
          key.endsWith(`.${blocked}`) ||
          key.includes(blocked),
      )
    ) {
      features.delete(key);
    }
  }

  return features;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);

  const variance =
    values.reduce(
      (sum, value) => sum + (value - average) ** 2,
      0,
    ) / values.length;

  return Math.sqrt(variance);
}

function pearsonCorrelation(
  x: number[],
  y: number[],
): number {
  if (x.length !== y.length || x.length < 2) {
    return 0;
  }

  const xMean = mean(x);
  const yMean = mean(y);

  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;

    numerator += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  }

  const denominator = Math.sqrt(xVariance * yVariance);

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({
    value,
    index,
  }));

  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);

  let i = 0;

  while (i < indexed.length) {
    let j = i + 1;

    while (
      j < indexed.length &&
      indexed[j].value === indexed[i].value
    ) {
      j += 1;
    }

    const averageRank = (i + 1 + j) / 2;

    for (let k = i; k < j; k += 1) {
      ranks[indexed[k].index] = averageRank;
    }

    i = j;
  }

  return ranks;
}

function spearmanCorrelation(
  x: number[],
  y: number[],
): number {
  return pearsonCorrelation(
    rankValues(x),
    rankValues(y),
  );
}

function percentileRanks(values: number[]): number[] {
  if (values.length === 1) {
    return [0.5];
  }

  const ranks = rankValues(values);

  return ranks.map(
    (rank) => (rank - 1) / (values.length - 1),
  );
}

function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;

  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from(
      { length: n },
      (_, columnIndex) =>
        rowIndex === columnIndex ? 1 : 0,
    ),
  ]);

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column;
    let pivotAbs = Math.abs(
      augmented[pivotRow][column],
    );

    for (let row = column + 1; row < n; row += 1) {
      const candidateAbs = Math.abs(
        augmented[row][column],
      );

      if (candidateAbs > pivotAbs) {
        pivotRow = row;
        pivotAbs = candidateAbs;
      }
    }

    if (pivotAbs < 1e-12) {
      throw new Error(
        `Matrix is singular at column ${column}`,
      );
    }

    if (pivotRow !== column) {
      const temp = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = temp;
    }

    const pivot = augmented[column][column];

    for (let j = 0; j < 2 * n; j += 1) {
      augmented[column][j] /= pivot;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row][column];

      if (factor === 0) {
        continue;
      }

      for (let j = 0; j < 2 * n; j += 1) {
        augmented[row][j] -=
          factor * augmented[column][j];
      }
    }
  }

  return augmented.map((row) =>
    row.slice(n),
  );
}

function matrixMultiply(
  a: number[][],
  b: number[][],
): number[][] {
  const rows = a.length;
  const inner = b.length;
  const columns = b[0].length;

  const result = Array.from(
    { length: rows },
    () => Array<number>(columns).fill(0),
  );

  for (let i = 0; i < rows; i += 1) {
    for (let k = 0; k < inner; k += 1) {
      const value = a[i][k];

      if (value === 0) {
        continue;
      }

      for (let j = 0; j < columns; j += 1) {
        result[i][j] += value * b[k][j];
      }
    }
  }

  return result;
}

function matrixTranspose(
  matrix: number[][],
): number[][] {
  return matrix[0].map((_, columnIndex) =>
    matrix.map((row) => row[columnIndex]),
  );
}

function fitRidgeRegression(
  x: number[][],
  y: number[],
  lambda: number,
): number[] {
  const rows = x.length;
  const columns = x[0].length;

  const xWithIntercept = x.map((row) => [
    1,
    ...row,
  ]);

  const xt = matrixTranspose(xWithIntercept);

  const xtx = matrixMultiply(
    xt,
    xWithIntercept,
  );

  /*
   * Do not penalise the intercept.
   */
  for (let i = 1; i < xtx.length; i += 1) {
    xtx[i][i] += lambda;
  }

  const inverse = invertMatrix(xtx);

  const yMatrix = y.map((value) => [value]);

  const xty = matrixMultiply(
    xt,
    yMatrix,
  );

  const coefficients = matrixMultiply(
    inverse,
    xty,
  );

  return coefficients.map((row) => row[0]);
}

function quartile(rank: number, count: number): number {
  const percentile =
    count <= 1
      ? 0
      : (rank - 1) / (count - 1);

  if (percentile < 0.25) {
    return 1;
  }

  if (percentile < 0.5) {
    return 2;
  }

  if (percentile < 0.75) {
    return 3;
  }

  return 4;
}

function formatNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(10));
}

function getFeatureValues(
  markets: MarketResult[],
  feature: string,
): number[] {
  return markets.map((market) => {
    const features = extractFeatures(market);
    return features.get(feature) ?? 0;
  });
}

function selectVaryingFeatures(
  markets: MarketResult[],
): string[] {
  const allFeatures = new Set<string>();

  for (const market of markets) {
    for (const feature of extractFeatures(market).keys()) {
      allFeatures.add(feature);
    }
  }

  return [...allFeatures]
    .filter((feature) => {
      const values = getFeatureValues(
        markets,
        feature,
      );

      return new Set(values).size > 1;
    })
    .sort();
}

function calculateFeatureStats(
  sample: MarketResult[],
  oos: MarketResult[],
  features: string[],
): FeatureStats[] {
  const sampleTarget = sample.map(
    (market) => market.netProfit,
  );

  const oosTarget = oos.map(
    (market) => market.netProfit,
  );

  const allMarkets = [...sample, ...oos];

  const allTarget = allMarkets.map(
    (market) => market.netProfit,
  );

  const stats: FeatureStats[] = [];

  for (const feature of features) {
    const sampleValues = getFeatureValues(
      sample,
      feature,
    );

    const oosValues = getFeatureValues(
      oos,
      feature,
    );

    const allValues = getFeatureValues(
      allMarkets,
      feature,
    );

    stats.push({
      feature,
      sampleSpearman: spearmanCorrelation(
        sampleValues,
        sampleTarget,
      ),
      samplePearson: pearsonCorrelation(
        sampleValues,
        sampleTarget,
      ),
      oosSpearman: spearmanCorrelation(
        oosValues,
        oosTarget,
      ),
      oosPearson: pearsonCorrelation(
        oosValues,
        oosTarget,
      ),
      allSpearman: spearmanCorrelation(
        allValues,
        allTarget,
      ),
      allPearson: pearsonCorrelation(
        allValues,
        allTarget,
      ),
      sampleMean: mean(sampleValues),
      sampleStd: standardDeviation(
        sampleValues,
      ),
      oosMean: mean(oosValues),
      oosStd: standardDeviation(
        oosValues,
      ),
      uniqueValues: new Set(allValues).size,
      sampleMin: Math.min(...sampleValues),
      sampleMax: Math.max(...sampleValues),
    });
  }

  return stats.sort(
    (a, b) =>
      Math.abs(b.sampleSpearman) -
      Math.abs(a.sampleSpearman),
  );
}

function standardiseForTraining(
  values: number[],
  trainingMean: number,
  trainingStd: number,
): number[] {
  if (trainingStd === 0) {
    return values.map(() => 0);
  }

  return values.map(
    (value) =>
      (value - trainingMean) /
      trainingStd,
  );
}

function buildModel(
  sample: MarketResult[],
  oos: MarketResult[],
  featureStats: FeatureStats[],
): {
  features: string[];
  coefficients: ModelCoefficient[];
  sampleScores: number[];
  oosScores: number[];
} {
  /*
   * We select the strongest features in the Sample universe only.
   *
   * This prevents OOS performance from influencing feature selection.
   */
  const selectedStats = featureStats
    .filter(
      (stat) =>
        stat.sampleStd > 0 &&
        Number.isFinite(stat.sampleSpearman),
    )
    .slice(0, TOP_FEATURE_COUNT);

  const features = selectedStats.map(
    (stat) => stat.feature,
  );

  if (features.length === 0) {
    throw new Error(
      "No varying numeric Binance features were available.",
    );
  }

  const trainingStatistics = new Map<
    string,
    { mean: number; std: number }
  >();

  for (const feature of features) {
    const values = getFeatureValues(
      sample,
      feature,
    );

    trainingStatistics.set(feature, {
      mean: mean(values),
      std: standardDeviation(values),
    });
  }

  const sampleX = sample.map((market) =>
    features.map((feature) => {
      const values = getFeatureValues(
        sample,
        feature,
      );

      const statistics =
        trainingStatistics.get(feature)!;

      /*
       * Percentile rank is the primary representation.
       * This removes arbitrary scale differences.
       */
      const ranked =
        percentileRanks(values);

      const index = sample.indexOf(market);

      /*
       * Light standardisation is retained after ranking
       * to make the regression numerically stable.
       */
      return standardiseForTraining(
        [ranked[index]],
        0.5,
        Math.sqrt(1 / 12),
      )[0];
    }),
  );

  const oosX = oos.map((market) =>
    features.map((feature) => {
      /*
       * OOS is transformed using the Sample empirical
       * distribution, not an OOS-fitted distribution.
       */
      const trainingValues = getFeatureValues(
        sample,
        feature,
      );

      const value = extractFeatures(
        market,
      ).get(feature) ?? 0;

      const less = trainingValues.filter(
        (trainingValue) =>
          trainingValue < value,
      ).length;

      const equal = trainingValues.filter(
        (trainingValue) =>
          trainingValue === value,
      ).length;

      const percentile =
        trainingValues.length === 1
          ? 0.5
          : (
              less +
              equal / 2
            ) /
            trainingValues.length;

      return standardiseForTraining(
        [percentile],
        0.5,
        Math.sqrt(1 / 12),
      )[0];
    }),
  );

  /*
   * Target is the actual profitability percentile.
   *
   * Higher score = more profitable market.
   */
  const sampleProfitRanks = percentileRanks(
    sample.map((market) => market.netProfit),
  );

  const coefficients = fitRidgeRegression(
    sampleX,
    sampleProfitRanks,
    RIDGE_LAMBDA,
  );

  const intercept = coefficients[0];

  const featureCoefficients =
    coefficients.slice(1);

  const modelCoefficients =
    features.map((feature, index) => ({
      feature,
      coefficient:
        featureCoefficients[index],
      absCoefficient:
        Math.abs(
          featureCoefficients[index],
        ),
      trainingCorrelation:
        selectedStats[index]
          ?.sampleSpearman ?? 0,
    }));

  const score = (
    matrix: number[][],
  ): number[] =>
    matrix.map((row) => {
      let value = intercept;

      for (let i = 0; i < row.length; i += 1) {
        value +=
          row[i] *
          featureCoefficients[i];
      }

      return value;
    });

  return {
    features,
    coefficients: modelCoefficients,
    sampleScores: score(sampleX),
    oosScores: score(oosX),
  };
}

function createScoredMarkets(
  markets: MarketResult[],
  scores: number[],
): ScoredMarket[] {
  const actualRanks = rankValues(
    markets.map(
      (market) => -market.netProfit,
    ),
  );

  /*
   * rankValues ranks ascending. Since negative profit is used,
   * rank 1 means highest actual profit.
   */
  const predictedRanks = rankValues(
    scores.map((score) => -score),
  );

  const count = markets.length;

  return markets.map((market, index) => {
    const actualRank = actualRanks[index];
    const predictedRank = predictedRanks[index];

    return {
      symbol: market.symbol,
      datasetGroup: market.datasetGroup,
      binanceArrayPosition:
        market.binanceArrayPosition,
      actualNetProfit:
        market.netProfit,
      actualRank,
      predictedScore:
        scores[index],
      predictedRank,
      actualQuartile:
        quartile(actualRank, count),
      predictedQuartile:
        quartile(predictedRank, count),
      rankError:
        predictedRank - actualRank,
      absoluteRankError:
        Math.abs(
          predictedRank - actualRank,
        ),
    };
  });
}

function topBottomOverlap(
  scored: ScoredMarket[],
  count: number,
): {
  topOverlap: number;
  bottomOverlap: number;
} {
  const actualTop = new Set(
    [...scored]
      .sort(
        (a, b) =>
          a.actualRank -
          b.actualRank,
      )
      .slice(0, count)
      .map((market) => market.symbol),
  );

  const predictedTop = new Set(
    [...scored]
      .sort(
        (a, b) =>
          a.predictedRank -
          b.predictedRank,
      )
      .slice(0, count)
      .map((market) => market.symbol),
  );

  const actualBottom = new Set(
    [...scored]
      .sort(
        (a, b) =>
          b.actualRank -
          a.actualRank,
      )
      .slice(0, count)
      .map((market) => market.symbol),
  );

  const predictedBottom = new Set(
    [...scored]
      .sort(
        (a, b) =>
          b.predictedRank -
          a.predictedRank,
      )
      .slice(0, count)
      .map((market) => market.symbol),
  );

  const intersectionSize = (
    a: Set<string>,
    b: Set<string>,
  ): number =>
    [...a].filter((value) =>
      b.has(value),
    ).length;

  return {
    topOverlap:
      intersectionSize(
        actualTop,
        predictedTop,
      ),
    bottomOverlap:
      intersectionSize(
        actualBottom,
        predictedBottom,
      ),
  };
}

function quartilePerformance(
  scored: ScoredMarket[],
): Array<{
  predictedQuartile: number;
  markets: number;
  meanActualNetProfit: number;
  medianActualNetProfit: number;
  totalActualNetProfit: number;
  meanActualRank: number;
}> {
  const result = [];

  for (
    let quartileNumber = 1;
    quartileNumber <= 4;
    quartileNumber += 1
  ) {
    const markets = scored.filter(
      (market) =>
        market.predictedQuartile ===
        quartileNumber,
    );

    const profits = markets.map(
      (market) =>
        market.actualNetProfit,
    );

    const sortedProfits = [
      ...profits,
    ].sort((a, b) => a - b);

    const median =
      sortedProfits.length === 0
        ? 0
        : sortedProfits.length % 2 === 1
          ? sortedProfits[
              Math.floor(
                sortedProfits.length / 2,
              )
            ]
          : (
              sortedProfits[
                sortedProfits.length / 2 - 1
              ] +
              sortedProfits[
                sortedProfits.length / 2
              ]
            ) / 2;

    result.push({
      predictedQuartile:
        quartileNumber,
      markets: markets.length,
      meanActualNetProfit:
        mean(profits),
      medianActualNetProfit:
        median,
      totalActualNetProfit:
        profits.reduce(
          (sum, value) =>
            sum + value,
          0,
        ),
      meanActualRank:
        mean(
          markets.map(
            (market) =>
              market.actualRank,
          ),
        ),
    });
  }

  return result;
}

function summariseModel(
  scored: ScoredMarket[],
) {
  const actualRanks = scored.map(
    (market) => market.actualRank,
  );

  const predictedRanks = scored.map(
    (market) => market.predictedRank,
  );

  const actualProfits = scored.map(
    (market) =>
      market.actualNetProfit,
  );

  const predictedScores = scored.map(
    (market) =>
      market.predictedScore,
  );

  const overlap =
    topBottomOverlap(scored, 10);

  return {
    markets: scored.length,
    spearmanPredictedVsActualRank:
      spearmanCorrelation(
        predictedScores,
        actualProfits,
      ),
    spearmanPredictedRankVsActualRank:
      spearmanCorrelation(
        predictedRanks,
        actualRanks,
      ),
    pearsonPredictedScoreVsActualProfit:
      pearsonCorrelation(
        predictedScores,
        actualProfits,
      ),
    meanAbsoluteRankError:
      mean(
        scored.map(
          (market) =>
            market.absoluteRankError,
        ),
      ),
    top10Overlap:
      overlap.topOverlap,
    bottom10Overlap:
      overlap.bottomOverlap,
    predictedTop10MeanProfit:
      mean(
        [...scored]
          .sort(
            (a, b) =>
              a.predictedRank -
              b.predictedRank,
          )
          .slice(0, 10)
          .map(
            (market) =>
              market.actualNetProfit,
          ),
      ),
    predictedBottom10MeanProfit:
      mean(
        [...scored]
          .sort(
            (a, b) =>
              b.predictedRank -
              a.predictedRank,
          )
          .slice(0, 10)
          .map(
            (market) =>
              market.actualNetProfit,
          ),
      ),
    quartiles:
      quartilePerformance(scored),
  };
}

function printFeatureTable(
  stats: FeatureStats[],
): void {
  console.log("\nFeature correlations");
  console.log(
    "--------------------------------------------------------------------------",
  );
  console.log(
    "Feature".padEnd(55) +
      "Sample".padStart(10) +
      "OOS".padStart(10) +
      "All".padStart(10) +
      "Unique".padStart(9),
  );
  console.log(
    "--------------------------------------------------------------------------",
  );

  for (const stat of stats) {
    console.log(
      stat.feature.padEnd(55) +
        stat.sampleSpearman
          .toFixed(4)
          .padStart(10) +
        stat.oosSpearman
          .toFixed(4)
          .padStart(10) +
        stat.allSpearman
          .toFixed(4)
          .padStart(10) +
        String(stat.uniqueValues).padStart(9),
    );
  }

  console.log(
    "--------------------------------------------------------------------------",
  );
}

function printModel(
  label: string,
  summary: ReturnType<typeof summariseModel>,
): void {
  console.log(`\n${label}`);
  console.log(
    "--------------------------------------------------------------------------",
  );
  console.log(
    `Markets:                         ${summary.markets}`,
  );
  console.log(
    `Predicted score vs profit:      ${summary.pearsonPredictedScoreVsActualProfit.toFixed(4)}`,
  );
  console.log(
    `Predicted score vs profit rank: ${summary.spearmanPredictedVsActualRank.toFixed(4)}`,
  );
  console.log(
    `Predicted rank vs actual rank:  ${summary.spearmanPredictedRankVsActualRank.toFixed(4)}`,
  );
  console.log(
    `Mean absolute rank error:        ${summary.meanAbsoluteRankError.toFixed(2)}`,
  );
  console.log(
    `Top 10 overlap:                 ${summary.top10Overlap}/10`,
  );
  console.log(
    `Bottom 10 overlap:              ${summary.bottom10Overlap}/10`,
  );
  console.log(
    `Predicted top-10 mean profit:   ${summary.predictedTop10MeanProfit.toFixed(4)}`,
  );
  console.log(
    `Predicted bottom-10 mean profit:${summary.predictedBottom10MeanProfit.toFixed(4)}`,
  );

  console.log("\nPredicted quartile performance:");

  for (const quartile of summary.quartiles) {
    console.log(
      `  Q${quartile.predictedQuartile}: ` +
        `${quartile.markets} markets | ` +
        `mean profit ${quartile.meanActualNetProfit.toFixed(4)} | ` +
        `median ${quartile.medianActualNetProfit.toFixed(4)} | ` +
        `total ${quartile.totalActualNetProfit.toFixed(4)} | ` +
        `mean actual rank ${quartile.meanActualRank.toFixed(2)}`,
    );
  }
}

function main(): void {
  console.log(
    "============================================================",
  );
  console.log(
    "Binance Metadata Profitability Ranking Research",
  );
  console.log(
    "============================================================",
  );

  const input = readJson(INPUT_PATH);

  const sample = input.sample?.markets ?? [];
  const oos =
    input.outOfSample?.markets ?? [];

  if (sample.length === 0) {
    throw new Error(
      "Sample market data is missing from the input.",
    );
  }

  if (oos.length === 0) {
    throw new Error(
      "OutOfSample market data is missing from the input.",
    );
  }

  console.log(
    `Input: ${path.resolve(INPUT_PATH)}`,
  );
  console.log(
    `Sample markets: ${sample.length}`,
  );
  console.log(
    `OutOfSample markets: ${oos.length}`,
  );

  const allMarkets = [
    ...sample,
    ...oos,
  ];

  const features =
    selectVaryingFeatures(
      allMarkets,
    );

  console.log(
    `Varying numeric Binance features: ${features.length}`,
  );

  const featureStats =
    calculateFeatureStats(
      sample,
      oos,
      features,
    );

  printFeatureTable(featureStats);

  /*
   * Fit the model using Sample only.
   */
  const model = buildModel(
    sample,
    oos,
    featureStats,
  );

  console.log("\nSelected model features:");

  for (const coefficient of model.coefficients) {
    console.log(
      `  ${coefficient.feature}: ` +
        `coefficient=${coefficient.coefficient.toFixed(6)} ` +
        `sampleCorrelation=${coefficient.trainingCorrelation.toFixed(4)}`,
    );
  }

  const sampleScored =
    createScoredMarkets(
      sample,
      model.sampleScores,
    );

  const oosScored =
    createScoredMarkets(
      oos,
      model.oosScores,
    );

  /*
   * All-120 scores are useful for describing the model,
   * but they are NOT used to fit it.
   */
  const allScored = [
    ...sampleScored,
    ...oosScored,
  ];

  const sampleSummary =
    summariseModel(
      sampleScored,
    );

  const oosSummary =
    summariseModel(
      oosScored,
    );

  const allSummary =
    summariseModel(
      allScored,
    );

  printModel(
    "Sample model fit",
    sampleSummary,
  );

  printModel(
    "OutOfSample holdout",
    oosSummary,
  );

  printModel(
    "All 120 markets",
    allSummary,
  );

  /*
   * Produce a compact market ranking.
   */
  const oosRanking = [
    ...oosScored,
  ].sort(
    (a, b) =>
      a.predictedRank -
      b.predictedRank,
  );

  console.log(
    "\nOutOfSample predicted ranking",
  );
  console.log(
    "--------------------------------------------------------------------------",
  );
  console.log(
    "Rank".padStart(5) +
      " Symbol".padEnd(12) +
      "Predicted".padStart(12) +
      "Actual".padStart(9) +
      "NetProfit".padStart(12) +
      "BinancePos".padStart(12),
  );
  console.log(
    "--------------------------------------------------------------------------",
  );

  for (const market of oosRanking) {
    console.log(
      String(
        market.predictedRank,
      ).padStart(5) +
        ` ${market.symbol}`.padEnd(12) +
        market.predictedScore
          .toFixed(4)
          .padStart(12) +
        market.actualRank
          .toFixed(1)
          .padStart(9) +
        market.actualNetProfit
          .toFixed(4)
          .padStart(12) +
        String(
          market.binanceArrayPosition,
        ).padStart(12),
    );
  }

  const timestamp =
    Date.now();

  const output = {
    generatedAt:
      new Date().toISOString(),

    experiment:
      "binance_metadata_profitability_ranking",

    inputFile:
      path.resolve(INPUT_PATH),

    methodology: {
      trainingUniverse:
        "Sample",
      holdoutUniverse:
        "OutOfSample",
      target:
        "market netProfit profitability ranking",
      model:
        "ridge regression",
      ridgeLambda:
        RIDGE_LAMBDA,
      featureSelection:
        `top ${TOP_FEATURE_COUNT} Sample-only absolute Spearman correlations`,
      featureTransformation:
        "Sample empirical percentile ranks",
      targetTransformation:
        "profitability percentile rank",
      strategyVariablesUsed:
        false,
      binanceMetadataUsed:
        true,
      binanceArrayPositionUsed:
        true,
    },

    marketCounts: {
      sample:
        sample.length,
      outOfSample:
        oos.length,
      total:
        allMarkets.length,
    },

    featureStats,

    selectedFeatures:
      model.features,

    modelCoefficients:
      model.coefficients,

    sampleSummary,

    outOfSampleSummary:
      oosSummary,

    allMarketsSummary:
      allSummary,

    sampleRanking:
      [...sampleScored].sort(
        (a, b) =>
          a.predictedRank -
          b.predictedRank,
      ),

    outOfSampleRanking:
      oosRanking,

    allRanking:
      [...allScored].sort(
        (a, b) =>
          a.predictedRank -
          b.predictedRank,
      ),
  };

  const outputDir =
    path.resolve(
      "server/research-output",
    );

  fs.mkdirSync(
    outputDir,
    { recursive: true },
  );

  const outputPath =
    path.join(
      outputDir,
      `binance-metadata-ranking-${timestamp}.json`,
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  console.log(
    `\nOutput written to: ${outputPath}`,
  );

  console.log(
    "\n============================================================",
  );
  console.log(
    "Research complete",
  );
  console.log(
    "============================================================",
  );
}

main();