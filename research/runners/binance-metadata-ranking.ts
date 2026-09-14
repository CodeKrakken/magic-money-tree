/**
 * Binance metadata profitability-ranking research
 *
 * Tests whether Binance exchangeInfo metadata can predict the profitability
 * ranking produced by the existing trading strategy.
 *
 * IMPORTANT:
 * - Does NOT rerun the trading strategy.
 * - Does NOT use strategy-derived variables as predictors.
 * - Sample 60 markets are used for feature selection/model fitting.
 * - OutOfSample 60 markets are a true market-universe holdout.
 *
 * Usage:
 *
 *   npx tsx server/binance-metadata-ranking.ts \
 *     server/research-output/market-strategy-ranking-independent-1789232701426.json
 */

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

  sampleUniqueValues: number;
  oosUniqueValues: number;

  sampleMin: number;
  sampleMax: number;

  oosMin: number;
  oosMax: number;

  usableForTraining: boolean;
}

interface ModelCoefficient {
  feature: string;
  coefficient: number;
  absCoefficient: number;
  sampleSpearman: number;
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
    "Usage: npx tsx server/binance-metadata-ranking.ts <input-json>",
  );
  process.exit(1);
}

const RIDGE_LAMBDA = 10;
const TOP_FEATURE_COUNT = 5;

/**
 * Features which are definitely strategy-derived and therefore must never
 * become predictors.
 */
const FORBIDDEN_FEATURE_TERMS = [
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

function readJson(filePath: string): ExperimentInput {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file does not exist: ${resolved}`);
  }

  return JSON.parse(
    fs.readFileSync(resolved, "utf8"),
  ) as ExperimentInput;
}

function isFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

/**
 * Convert Binance numeric strings such as:
 *
 *   "0.00001000"
 *   "100000.00000000"
 *
 * into actual numbers.
 */
function numericString(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

/**
 * Flatten Binance metadata.
 *
 * The important part is handling arrays of filter objects.
 *
 * Example:
 *
 * filters: [
 *   {
 *     filterType: "PRICE_FILTER",
 *     minPrice: "0.00000100",
 *     maxPrice: "100000.00000000",
 *     tickSize: "0.00000100"
 *   }
 * ]
 *
 * becomes:
 *
 * PRICE_FILTER.minPrice
 * PRICE_FILTER.maxPrice
 * PRICE_FILTER.tickSize
 */
function flattenBinanceMetadata(
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

  const parsedString = numericString(value);

  if (parsedString !== null) {
    if (prefix) {
      result.set(prefix, parsedString);
    }

    return result;
  }

  if (Array.isArray(value)) {
    /*
     * Binance's filters array contains objects with filterType.
     *
     * Flatten each filter by its filterType rather than treating
     * the entire array as an opaque value.
     */
    for (const item of value) {
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        const object =
          item as Record<string, unknown>;

        const filterType =
          typeof object.filterType === "string"
            ? object.filterType
            : null;

        const childPrefix =
          filterType
            ? filterType
            : prefix
              ? `${prefix}[]`
              : "array";

        for (const [key, child] of Object.entries(
          object,
        )) {
          /*
           * filterType itself is categorical and is not a numeric
           * predictor.
           */
          if (key === "filterType") {
            continue;
          }

          const fieldPrefix =
            `${childPrefix}.${key}`;

          for (const [
            flattenedName,
            flattenedValue,
          ] of flattenBinanceMetadata(
            child,
            fieldPrefix,
          )) {
            result.set(
              flattenedName,
              flattenedValue,
            );
          }
        }
      } else {
        /*
         * For non-object arrays, retain only the length.
         */
        if (prefix) {
          result.set(
            `${prefix}.__length`,
            value.length,
          );
        }
      }
    }

    return result;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      /*
       * Skip obviously categorical fields.
       */
      if (
        key === "symbol" ||
        key === "status" ||
        key === "baseAsset" ||
        key === "quoteAsset" ||
        key === "filterType"
      ) {
        continue;
      }

      const childPrefix = prefix
        ? `${prefix}.${key}`
        : key;

      for (const [
        flattenedName,
        flattenedValue,
      ] of flattenBinanceMetadata(
        child,
        childPrefix,
      )) {
        result.set(
          flattenedName,
          flattenedValue,
        );
      }
    }
  }

  return result;
}

function extractFeatures(
  market: MarketResult,
): Map<string, number> {
  const features = flattenBinanceMetadata(
    market.binance,
  );

  /*
   * Binance array position is stored outside the binance object
   * in the research output, so add it explicitly.
   */
  if (
    isFiniteNumber(
      market.binanceArrayPosition,
    )
  ) {
    features.set(
      "binanceArrayPosition",
      market.binanceArrayPosition,
    );
  }

  /*
   * Remove anything that could be derived from the strategy.
   */
  for (const feature of [
    ...features.keys(),
  ]) {
    const forbidden =
      FORBIDDEN_FEATURE_TERMS.some(
        (term) =>
          feature === term ||
          feature.endsWith(`.${term}`) ||
          feature.includes(`.${term}.`),
      );

    if (forbidden) {
      features.delete(feature);
    }
  }

  return features;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / values.length
  );
}

function standardDeviation(
  values: number[],
): number {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        (value - average) ** 2,
      0,
    ) / values.length;

  return Math.sqrt(variance);
}

function pearsonCorrelation(
  x: number[],
  y: number[],
): number {
  if (
    x.length !== y.length ||
    x.length < 2
  ) {
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

  const denominator =
    Math.sqrt(
      xVariance * yVariance,
    );

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function rankValues(
  values: number[],
): number[] {
  const indexed = values.map(
    (value, index) => ({
      value,
      index,
    }),
  );

  indexed.sort(
    (a, b) =>
      a.value - b.value,
  );

  const ranks =
    new Array<number>(
      values.length,
    );

  let i = 0;

  while (i < indexed.length) {
    let j = i + 1;

    while (
      j < indexed.length &&
      indexed[j].value ===
        indexed[i].value
    ) {
      j += 1;
    }

    /*
     * Average rank for ties.
     */
    const averageRank =
      (i + 1 + j) / 2;

    for (
      let k = i;
      k < j;
      k += 1
    ) {
      ranks[indexed[k].index] =
        averageRank;
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

/**
 * Percentile ranks in [0,1].
 */
function percentileRanks(
  values: number[],
): number[] {
  if (values.length === 1) {
    return [0.5];
  }

  const ranks =
    rankValues(values);

  return ranks.map(
    (rank) =>
      (rank - 1) /
      (values.length - 1),
  );
}

/**
 * Calculate an OOS percentile using ONLY the training values.
 *
 * This is important: OOS observations must not influence their own
 * transformation.
 */
function percentileFromTraining(
  value: number,
  trainingValues: number[],
): number {
  if (
    trainingValues.length === 0
  ) {
    return 0.5;
  }

  let less = 0;
  let equal = 0;

  for (
    const trainingValue of
      trainingValues
  ) {
    if (
      trainingValue < value
    ) {
      less += 1;
    } else if (
      trainingValue === value
    ) {
      equal += 1;
    }
  }

  return (
    less +
    equal / 2
  ) / trainingValues.length;
}

function invertMatrix(
  matrix: number[][],
): number[][] {
  const n = matrix.length;

  const augmented =
    matrix.map(
      (row, rowIndex) => [
        ...row,
        ...Array.from(
          { length: n },
          (_, columnIndex) =>
            rowIndex ===
            columnIndex
              ? 1
              : 0,
        ),
      ],
    );

  for (
    let column = 0;
    column < n;
    column += 1
  ) {
    let pivotRow =
      column;

    let pivotAbs =
      Math.abs(
        augmented[
          pivotRow
        ][column],
      );

    for (
      let row =
        column + 1;
      row < n;
      row += 1
    ) {
      const candidateAbs =
        Math.abs(
          augmented[row][
            column
          ],
        );

      if (
        candidateAbs >
        pivotAbs
      ) {
        pivotRow = row;
        pivotAbs =
          candidateAbs;
      }
    }

    if (
      pivotAbs <
      1e-12
    ) {
      throw new Error(
        `Matrix is singular at column ${column}`,
      );
    }

    if (
      pivotRow !==
      column
    ) {
      const temp =
        augmented[column];

      augmented[column] =
        augmented[pivotRow];

      augmented[
        pivotRow
      ] = temp;
    }

    const pivot =
      augmented[column][
        column
      ];

    for (
      let j = 0;
      j < 2 * n;
      j += 1
    ) {
      augmented[column][j] /=
        pivot;
    }

    for (
      let row = 0;
      row < n;
      row += 1
    ) {
      if (
        row === column
      ) {
        continue;
      }

      const factor =
        augmented[row][
          column
        ];

      if (factor === 0) {
        continue;
      }

      for (
        let j = 0;
        j < 2 * n;
        j += 1
      ) {
        augmented[row][j] -=
          factor *
          augmented[column][j];
      }
    }
  }

  return augmented.map(
    (row) =>
      row.slice(n),
  );
}

function matrixMultiply(
  a: number[][],
  b: number[][],
): number[][] {
  const rows = a.length;
  const inner = b.length;
  const columns =
    b[0].length;

  const result =
    Array.from(
      { length: rows },
      () =>
        Array<number>(
          columns,
        ).fill(0),
    );

  for (
    let i = 0;
    i < rows;
    i += 1
  ) {
    for (
      let k = 0;
      k < inner;
      k += 1
    ) {
      const value =
        a[i][k];

      if (value === 0) {
        continue;
      }

      for (
        let j = 0;
        j < columns;
        j += 1
      ) {
        result[i][j] +=
          value *
          b[k][j];
      }
    }
  }

  return result;
}

function matrixTranspose(
  matrix: number[][],
): number[][] {
  return matrix[0].map(
    (_, columnIndex) =>
      matrix.map(
        (row) =>
          row[columnIndex],
      ),
  );
}

function fitRidgeRegression(
  x: number[][],
  y: number[],
  lambda: number,
): number[] {
  const xWithIntercept =
    x.map((row) => [
      1,
      ...row,
    ]);

  const xt =
    matrixTranspose(
      xWithIntercept,
    );

  const xtx =
    matrixMultiply(
      xt,
      xWithIntercept,
    );

  /*
   * Penalise predictors but not the intercept.
   */
  for (
    let i = 1;
    i < xtx.length;
    i += 1
  ) {
    xtx[i][i] +=
      lambda;
  }

  const inverse =
    invertMatrix(xtx);

  const yMatrix =
    y.map((value) => [
      value,
    ]);

  const xty =
    matrixMultiply(
      xt,
      yMatrix,
    );

  const coefficients =
    matrixMultiply(
      inverse,
      xty,
    );

  return coefficients.map(
    (row) => row[0],
  );
}

function quartile(
  rank: number,
  count: number,
): number {
  if (count <= 1) {
    return 1;
  }

  const percentile =
    (rank - 1) /
    (count - 1);

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

function getFeatureValues(
  markets: MarketResult[],
  feature: string,
): number[] {
  return markets.map(
    (market) =>
      extractFeatures(
        market,
      ).get(feature) ?? 0,
  );
}

function selectVaryingFeatures(
  markets: MarketResult[],
): string[] {
  const allFeatures =
    new Set<string>();

  for (
    const market of markets
  ) {
    for (
      const feature of
        extractFeatures(
          market,
        ).keys()
    ) {
      allFeatures.add(
        feature,
      );
    }
  }

  return [
    ...allFeatures,
  ]
    .filter((feature) => {
      const values =
        getFeatureValues(
          markets,
          feature,
        );

      return (
        new Set(values)
          .size > 1
      );
    })
    .sort();
}

function calculateFeatureStats(
  sample: MarketResult[],
  oos: MarketResult[],
  features: string[],
): FeatureStats[] {
  const sampleTarget =
    sample.map(
      (market) =>
        market.netProfit,
    );

  const oosTarget =
    oos.map(
      (market) =>
        market.netProfit,
    );

  const allMarkets = [
    ...sample,
    ...oos,
  ];

  const allTarget =
    allMarkets.map(
      (market) =>
        market.netProfit,
    );

  return features
    .map((feature) => {
      const sampleValues =
        getFeatureValues(
          sample,
          feature,
        );

      const oosValues =
        getFeatureValues(
          oos,
          feature,
        );

      const allValues =
        getFeatureValues(
          allMarkets,
          feature,
        );

      const sampleStd =
        standardDeviation(
          sampleValues,
        );

      return {
        feature,

        sampleSpearman:
          sampleStd === 0
            ? 0
            : spearmanCorrelation(
                sampleValues,
                sampleTarget,
              ),

        samplePearson:
          sampleStd === 0
            ? 0
            : pearsonCorrelation(
                sampleValues,
                sampleTarget,
              ),

        oosSpearman:
          standardDeviation(
            oosValues,
          ) === 0
            ? 0
            : spearmanCorrelation(
                oosValues,
                oosTarget,
              ),

        oosPearson:
          standardDeviation(
            oosValues,
          ) === 0
            ? 0
            : pearsonCorrelation(
                oosValues,
                oosTarget,
              ),

        allSpearman:
          standardDeviation(
            allValues,
          ) === 0
            ? 0
            : spearmanCorrelation(
                allValues,
                allTarget,
              ),

        allPearson:
          standardDeviation(
            allValues,
          ) === 0
            ? 0
            : pearsonCorrelation(
                allValues,
                allTarget,
              ),

        sampleMean:
          mean(sampleValues),

        sampleStd,

        oosMean:
          mean(oosValues),

        oosStd:
          standardDeviation(
            oosValues,
          ),

        uniqueValues:
          new Set(allValues)
            .size,

        sampleUniqueValues:
          new Set(
            sampleValues,
          ).size,

        oosUniqueValues:
          new Set(
            oosValues,
          ).size,

        sampleMin:
          Math.min(
            ...sampleValues,
          ),

        sampleMax:
          Math.max(
            ...sampleValues,
          ),

        oosMin:
          Math.min(
            ...oosValues,
          ),

        oosMax:
          Math.max(
            ...oosValues,
          ),

        usableForTraining:
          sampleStd > 0,
      };
    })
    .sort(
      (a, b) =>
        Math.abs(
          b.sampleSpearman,
        ) -
        Math.abs(
          a.sampleSpearman,
        ),
    );
}

function buildModel(
  sample: MarketResult[],
  oos: MarketResult[],
  featureStats: FeatureStats[],
) {
  /*
   * Select only features that actually vary in Sample.
   *
   * This is critical. A field that is constant across the training
   * universe cannot contribute to a Sample-trained model.
   */
  const selectedStats =
    featureStats
      .filter(
        (stat) =>
          stat.usableForTraining &&
          Number.isFinite(
            stat.sampleSpearman,
          ),
      )
      .slice(
        0,
        TOP_FEATURE_COUNT,
      );

  const features =
    selectedStats.map(
      (stat) =>
        stat.feature,
    );

  if (
    features.length === 0
  ) {
    throw new Error(
      "No varying Binance metadata features are available for training.",
    );
  }

  /*
   * Convert each Sample feature into its percentile rank.
   *
   * This avoids problems such as tickSize being tiny while maxQty is
   * potentially very large.
   */
  const trainingFeatureValues =
    new Map<
      string,
      number[]
    >();

  for (
    const feature of
      features
  ) {
    trainingFeatureValues.set(
      feature,
      getFeatureValues(
        sample,
        feature,
      ),
    );
  }

  const sampleX =
    sample.map(
      (_, index) =>
        features.map(
          (feature) => {
            const values =
              trainingFeatureValues.get(
                feature,
              )!;

            const ranks =
              percentileRanks(
                values,
              );

            /*
             * Convert [0,1] percentile to approximately standard-normal
             * scale using the known variance of a uniform distribution.
             *
             * This is just numerical scaling for ridge regression.
             */
            return (
              ranks[index] -
              0.5
            ) /
              Math.sqrt(
                1 / 12,
              );
          },
        ),
    );

  const oosX =
    oos.map(
      (market) =>
        features.map(
          (feature) => {
            const trainingValues =
              trainingFeatureValues.get(
                feature,
              )!;

            const value =
              extractFeatures(
                market,
              ).get(
                feature,
              ) ?? 0;

            const percentile =
              percentileFromTraining(
                value,
                trainingValues,
              );

            return (
              percentile -
              0.5
            ) /
              Math.sqrt(
                1 / 12,
              );
          },
        ),
    );

  /*
   * Higher target = more profitable market.
   */
  const sampleTarget =
    percentileRanks(
      sample.map(
        (market) =>
          market.netProfit,
      ),
    );

  const coefficients =
    fitRidgeRegression(
      sampleX,
      sampleTarget,
      RIDGE_LAMBDA,
    );

  const intercept =
    coefficients[0];

  const featureCoefficients =
    coefficients.slice(1);

  const modelCoefficients =
    features.map(
      (feature, index) => ({
        feature,

        coefficient:
          featureCoefficients[
            index
          ],

        absCoefficient:
          Math.abs(
            featureCoefficients[
              index
            ],
          ),

        sampleSpearman:
          selectedStats[
            index
          ]?.sampleSpearman ??
          0,
      }),
    );

  function score(
    matrix: number[][],
  ): number[] {
    return matrix.map(
      (row) => {
        let value =
          intercept;

        for (
          let i = 0;
          i < row.length;
          i += 1
        ) {
          value +=
            row[i] *
            featureCoefficients[
              i
            ];
        }

        return value;
      },
    );
  }

  return {
    features,
    coefficients:
      modelCoefficients,
    sampleScores:
      score(sampleX),
    oosScores:
      score(oosX),
  };
}

function createScoredMarkets(
  markets: MarketResult[],
  scores: number[],
): ScoredMarket[] {
  /*
   * Rank 1 = highest actual profit.
   */
  const actualRanks =
    rankValues(
      markets.map(
        (market) =>
          -market.netProfit,
      ),
    );

  /*
   * Rank 1 = highest predicted score.
   */
  const predictedRanks =
    rankValues(
      scores.map(
        (score) => -score,
      ),
    );

  return markets.map(
    (market, index) => {
      const actualRank =
        actualRanks[index];

      const predictedRank =
        predictedRanks[index];

      return {
        symbol:
          market.symbol,

        datasetGroup:
          market.datasetGroup,

        binanceArrayPosition:
          market.binanceArrayPosition,

        actualNetProfit:
          market.netProfit,

        actualRank,

        predictedScore:
          scores[index],

        predictedRank,

        actualQuartile:
          quartile(
            actualRank,
            markets.length,
          ),

        predictedQuartile:
          quartile(
            predictedRank,
            markets.length,
          ),

        rankError:
          predictedRank -
          actualRank,

        absoluteRankError:
          Math.abs(
            predictedRank -
              actualRank,
          ),
      };
    },
  );
}

function intersectionCount(
  a: Set<string>,
  b: Set<string>,
): number {
  let count = 0;

  for (const value of a) {
    if (b.has(value)) {
      count += 1;
    }
  }

  return count;
}

function topBottomOverlap(
  scored: ScoredMarket[],
  count: number,
) {
  const actualTop =
    new Set(
      [...scored]
        .sort(
          (a, b) =>
            a.actualRank -
            b.actualRank,
        )
        .slice(0, count)
        .map(
          (market) =>
            market.symbol,
        ),
    );

  const predictedTop =
    new Set(
      [...scored]
        .sort(
          (a, b) =>
            a.predictedRank -
            b.predictedRank,
        )
        .slice(0, count)
        .map(
          (market) =>
            market.symbol,
        ),
    );

  const actualBottom =
    new Set(
      [...scored]
        .sort(
          (a, b) =>
            b.actualRank -
            a.actualRank,
        )
        .slice(0, count)
        .map(
          (market) =>
            market.symbol,
        ),
    );

  const predictedBottom =
    new Set(
      [...scored]
        .sort(
          (a, b) =>
            b.predictedRank -
            a.predictedRank,
        )
        .slice(0, count)
        .map(
          (market) =>
            market.symbol,
        ),
    );

  return {
    topOverlap:
      intersectionCount(
        actualTop,
        predictedTop,
      ),

    bottomOverlap:
      intersectionCount(
        actualBottom,
        predictedBottom,
      ),
  };
}

function median(
  values: number[],
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b,
    );

  const middle =
    Math.floor(
      sorted.length / 2,
    );

  if (
    sorted.length % 2 ===
    1
  ) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}

function quartilePerformance(
  scored: ScoredMarket[],
) {
  const result = [];

  for (
    let q = 1;
    q <= 4;
    q += 1
  ) {
    const markets =
      scored.filter(
        (market) =>
          market.predictedQuartile ===
          q,
      );

    const profits =
      markets.map(
        (market) =>
          market.actualNetProfit,
      );

    result.push({
      predictedQuartile:
        q,

      markets:
        markets.length,

      meanActualNetProfit:
        mean(profits),

      medianActualNetProfit:
        median(profits),

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
  const predictedScores =
    scored.map(
      (market) =>
        market.predictedScore,
    );

  const actualProfits =
    scored.map(
      (market) =>
        market.actualNetProfit,
    );

  const predictedRanks =
    scored.map(
      (market) =>
        market.predictedRank,
    );

  const actualRanks =
    scored.map(
      (market) =>
        market.actualRank,
    );

  const overlap =
    topBottomOverlap(
      scored,
      10,
    );

  const predictedTop =
    [...scored]
      .sort(
        (a, b) =>
          a.predictedRank -
          b.predictedRank,
      )
      .slice(0, 10);

  const predictedBottom =
    [...scored]
      .sort(
        (a, b) =>
          b.predictedRank -
          a.predictedRank,
      )
      .slice(0, 10);

  return {
    markets:
      scored.length,

    spearmanPredictedScoreVsActualProfitRank:
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
        predictedTop.map(
          (market) =>
            market.actualNetProfit,
        ),
      ),

    predictedBottom10MeanProfit:
      mean(
        predictedBottom.map(
          (market) =>
            market.actualNetProfit,
        ),
      ),

    quartiles:
      quartilePerformance(
        scored,
      ),
  };
}

function printFeatureTable(
  stats: FeatureStats[],
): void {
  console.log(
    "\n============================================================",
  );

  console.log(
    "BINANCE FEATURE CORRELATIONS",
  );

  console.log(
    "============================================================",
  );

  console.log(
    "Feature".padEnd(65) +
      "Sample".padStart(10) +
      "OOS".padStart(10) +
      "All".padStart(10) +
      "Unique".padStart(9),
  );

  console.log(
    "-".repeat(104),
  );

  for (const stat of stats) {
    console.log(
      stat.feature.padEnd(65) +
        stat.sampleSpearman
          .toFixed(4)
          .padStart(10) +
        stat.oosSpearman
          .toFixed(4)
          .padStart(10) +
        stat.allSpearman
          .toFixed(4)
          .padStart(10) +
        String(
          stat.uniqueValues,
        ).padStart(9),
    );
  }

  console.log(
    "-".repeat(104),
  );
}

function printModelSummary(
  label: string,
  summary: ReturnType<
    typeof summariseModel
  >,
): void {
  console.log(
    `\n${label}`,
  );

  console.log(
    "-".repeat(70),
  );

  console.log(
    `Markets:                         ${summary.markets}`,
  );

  console.log(
    `Score vs actual profit:          ${summary.pearsonPredictedScoreVsActualProfit.toFixed(4)}`,
  );

  console.log(
    `Score vs actual profit rank:     ${summary.spearmanPredictedScoreVsActualProfitRank.toFixed(4)}`,
  );

  console.log(
    `Predicted rank vs actual rank:   ${summary.spearmanPredictedRankVsActualRank.toFixed(4)}`,
  );

  console.log(
    `Mean absolute rank error:        ${summary.meanAbsoluteRankError.toFixed(2)}`,
  );

  console.log(
    `Top 10 overlap:                  ${summary.top10Overlap}/10`,
  );

  console.log(
    `Bottom 10 overlap:               ${summary.bottom10Overlap}/10`,
  );

  console.log(
    `Predicted top-10 mean profit:    ${summary.predictedTop10MeanProfit.toFixed(4)}`,
  );

  console.log(
    `Predicted bottom-10 mean profit: ${summary.predictedBottom10MeanProfit.toFixed(4)}`,
  );

  console.log(
    "\nPredicted quartile performance:",
  );

  for (
    const quartile of
      summary.quartiles
  ) {
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

  const input =
    readJson(INPUT_PATH);

  const sample =
    input.sample?.markets ??
    [];

  const oos =
    input.outOfSample
      ?.markets ?? [];

  if (
    sample.length === 0
  ) {
    throw new Error(
      "Sample market data is missing.",
    );
  }

  if (
    oos.length === 0
  ) {
    throw new Error(
      "OutOfSample market data is missing.",
    );
  }

  const allMarkets = [
    ...sample,
    ...oos,
  ];

  console.log(
    `Input: ${path.resolve(INPUT_PATH)}`,
  );

  console.log(
    `Sample markets: ${sample.length}`,
  );

  console.log(
    `OutOfSample markets: ${oos.length}`,
  );

  /*
   * Extract all varying numeric Binance metadata.
   *
   * This is where the previous runner failed to descend into filters[].
   */
  const features =
    selectVaryingFeatures(
      allMarkets,
    );

  console.log(
    `Varying Binance features found: ${features.length}`,
  );

  const featureStats =
    calculateFeatureStats(
      sample,
      oos,
      features,
    );

  printFeatureTable(
    featureStats,
  );

  /*
   * Model is fitted ONLY on Sample.
   */
  const model =
    buildModel(
      sample,
      oos,
      featureStats,
    );

  console.log(
    "\n============================================================",
  );

  console.log(
    "SELECTED MODEL FEATURES",
  );

  console.log(
    "============================================================",
  );

  for (
    const coefficient of
      model.coefficients
  ) {
    console.log(
      `${coefficient.feature}\n` +
        `  coefficient:       ${coefficient.coefficient.toFixed(8)}\n` +
        `  |coefficient|:     ${coefficient.absCoefficient.toFixed(8)}\n` +
        `  Sample Spearman:   ${coefficient.sampleSpearman.toFixed(6)}`,
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

  printModelSummary(
    "SAMPLE MODEL FIT",
    sampleSummary,
  );

  printModelSummary(
    "OUT-OF-SAMPLE HOLDOUT",
    oosSummary,
  );

  printModelSummary(
    "ALL 120 MARKETS",
    allSummary,
  );

  /*
   * Print OOS ranking.
   */
  console.log(
    "\n============================================================",
  );

  console.log(
    "OUT-OF-SAMPLE PREDICTED RANKING",
  );

  console.log(
    "============================================================",
  );

  console.log(
    "Rank".padStart(5) +
      " Symbol".padEnd(13) +
      "PredScore".padStart(12) +
      "ActualRank".padStart(12) +
      "NetProfit".padStart(12) +
      "BinancePos".padStart(12),
  );

  console.log(
    "-".repeat(66),
  );

  const oosRanking =
    [...oosScored].sort(
      (a, b) =>
        a.predictedRank -
        b.predictedRank,
    );

  for (
    const market of
      oosRanking
  ) {
    console.log(
      String(
        market.predictedRank,
      ).padStart(5) +
        ` ${market.symbol}`.padEnd(
          13,
        ) +
        market.predictedScore
          .toFixed(4)
          .padStart(12) +
        market.actualRank
          .toFixed(1)
          .padStart(12) +
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
      path.resolve(
        INPUT_PATH,
      ),

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
        `top ${TOP_FEATURE_COUNT} Sample-only absolute Spearman correlations among features varying in Sample`,

      featureTransformation:
        "Sample empirical percentile ranks",

      oosFeatureTransformation:
        "Sample empirical distribution applied to OOS values",

      targetTransformation:
        "profitability percentile rank",

      strategyVariablesUsed:
        false,

      binanceMetadataUsed:
        true,

      binanceArrayPositionUsed:
        true,

      filterArraysExpanded:
        true,

      filterExtraction:
        "filterType-qualified numeric fields",
    },

    marketCounts: {
      sample:
        sample.length,

      outOfSample:
        oos.length,

      total:
        allMarkets.length,
    },

    featureCount:
      features.length,

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
    {
      recursive: true,
    },
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