import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  RESEARCH_HORIZONS,
  buildHistoricalResearchDataset,
  evaluateFeatureEvidence,
  evaluateLegacySignalEvidence,
  splitResearchPeriods,
  average,
  median,
  netReturn,
  makeDeterministicRandom,
  buildResearchAudit,
  fetchBroadResearchUniverse,
  type FeatureVector,
  type MarketObservation
} from './research';

const FEATURE_KEYS = [
  'priceReturnMedium',
  'acceleration',
  'volatility',
  'volatilityChange',
  'distanceFromRecentHigh',
  'distanceFromRecentLow',
  'volume',
  'volumeAcceleration',
  'tradeFrequency',
  'trendStrength'
] as const;

const SIGNAL_KEYS = [
  'shape',
  'emaRatio',
  'strength'
] as const;

const RANKING_KEYS = [
  'strength',
  'trendStrength',
  'shape',
  'emaRatio',
  'contrarianTrendStrength',
  'contrarianAcceleration',
  'contrarianDistanceFromRecentHigh',
  'contrarianDistanceFromRecentLow'
] as const;

const DATASET_VERSION = 'research-v1.3';

const FEE_RATE = 0.002;
const EXECUTION_COST = 0;
const TOTAL_COST =
  FEE_RATE + EXECUTION_COST;

type EvidenceRow = {
  horizon: number;
  baselineMeanReturnNet: string;
  baselinePositiveRate: string;
  correlation: string;
  meanReturnNet: string;
  positiveRateNet: string;
  medianReturnNet: string;
  quartileMeansNet: string[];
};

type RankingSummary = {
  topRankedMean: number;
  avgEligibleMean: number;
  medianEligibleMean: number;
  randomSelectionMean: number;
  excessVsMeanMean: number;
  excessVsMedianMean: number;
  excessVsRandomMean: number;
};

type RankingAccumulator = {
  topReturns: number[];
  avgReturns: number[];
  medianReturns: number[];
  randomReturns: number[];
  excessVsMean: number[];
  excessVsMedian: number[];
  excessVsRandom: number[];
};

function formatNumber(
  value: number | undefined,
  decimals = 6
): string {
  const safe = Number.isFinite(value)
    ? value
    : 0;

  return Number(safe).toFixed(decimals);
}

function getRankingValue(
  row: MarketObservation,
  rankingKey:
    | keyof FeatureVector
    | 'strength'
    | 'shape'
    | 'emaRatio'
    | 'contrarianTrendStrength'
    | 'contrarianAcceleration'
    | 'contrarianDistanceFromRecentHigh'
    | 'contrarianDistanceFromRecentLow'
): number {
  if (rankingKey === 'strength') {
    return (
      row.legacySignals?.strength ?? 0
    );
  }

  if (rankingKey === 'shape') {
    return (
      row.legacySignals?.shape ?? 0
    );
  }

  if (rankingKey === 'emaRatio') {
    return (
      row.legacySignals?.emaRatio ?? 0
    );
  }

  if (
    rankingKey ===
    'contrarianTrendStrength'
  ) {
    return -(
      row.features.trendStrength ?? 0
    );
  }

  if (
    rankingKey ===
    'contrarianAcceleration'
  ) {
    return -(
      row.features.acceleration ?? 0
    );
  }

  if (
    rankingKey ===
    'contrarianDistanceFromRecentHigh'
  ) {
    return -(
      row.features
        .distanceFromRecentHigh ?? 0
    );
  }

  if (
    rankingKey ===
    'contrarianDistanceFromRecentLow'
  ) {
    return -(
      row.features
        .distanceFromRecentLow ?? 0
    );
  }

  return row.features[rankingKey] ?? 0;
}

function groupByTimestamp(
  observations: MarketObservation[]
): Map<number, MarketObservation[]> {
  const groups = new Map<
    number,
    MarketObservation[]
  >();

  for (const observation of observations) {
    const existing = groups.get(
      observation.timestamp
    );

    if (existing) {
      existing.push(observation);
    } else {
      groups.set(
        observation.timestamp,
        [observation]
      );
    }
  }

  return groups;
}

function buildBaselineSummaries(
  observations: MarketObservation[],
  horizons: readonly number[]
) {
  const result = new Map<
    number,
    {
      mean: number;
      median: number;
      positiveRate: number;
      count: number;
    }
  >();

  for (const horizon of horizons) {
    const returns: number[] = [];

    for (const row of observations) {
      const gross =
        row.futureReturns[horizon];

      if (!Number.isFinite(gross)) {
        continue;
      }

      returns.push(
        netReturn(
          gross,
          FEE_RATE,
          EXECUTION_COST
        )
      );
    }

    const positive = returns.filter(
      (value) => value > 0
    ).length;

    result.set(horizon, {
      mean: average(returns),
      median: median(returns),
      positiveRate: returns.length
        ? positive / returns.length
        : 0,
      count: returns.length
    });
  }

  return result;
}

function buildFeatureEvidence(
  observations: MarketObservation[],
  baselines: ReturnType<
    typeof buildBaselineSummaries
  >
) {
  const result: Record<
    string,
    EvidenceRow[]
  > = {};

  for (const featureKey of FEATURE_KEYS) {
    const evidence =
      evaluateFeatureEvidence(
        observations,
        featureKey,
        RESEARCH_HORIZONS,
        FEE_RATE,
        EXECUTION_COST
      );

    result[featureKey] =
      RESEARCH_HORIZONS.flatMap(
        (horizon) => {
          const row = evidence.find(
            (entry) =>
              entry.horizon === horizon
          );

          const baseline =
            baselines.get(horizon);

          if (!row || !baseline) {
            return [];
          }

          return [
            {
              horizon,
              baselineMeanReturnNet:
                formatNumber(
                  baseline.mean
                ),
              baselinePositiveRate:
                formatNumber(
                  baseline.positiveRate
                ),
              correlation:
                formatNumber(
                  row.correlation
                ),
              meanReturnNet:
                formatNumber(
                  row.meanReturn
                ),
              positiveRateNet:
                formatNumber(
                  row.positiveRate
                ),
              medianReturnNet:
                formatNumber(
                  row.medianReturn
                ),
              quartileMeansNet:
                row.quartileMeans.map(
                  (value) =>
                    formatNumber(value)
                )
            }
          ];
        }
      );
  }

  return result;
}

function buildLegacyEvidence(
  observations: MarketObservation[],
  baselines: ReturnType<
    typeof buildBaselineSummaries
  >
) {
  const evidence =
    evaluateLegacySignalEvidence(
      observations,
      RESEARCH_HORIZONS,
      FEE_RATE,
      EXECUTION_COST
    );

  const result: Record<
    string,
    EvidenceRow[]
  > = {};

  for (const signalKey of SIGNAL_KEYS) {
    result[signalKey] =
      RESEARCH_HORIZONS.flatMap(
        (horizon) => {
          const row =
            evidence[signalKey]?.find(
              (entry) =>
                entry.horizon === horizon
            );

          const baseline =
            baselines.get(horizon);

          if (!row || !baseline) {
            return [];
          }

          return [
            {
              horizon,
              baselineMeanReturnNet:
                formatNumber(
                  baseline.mean
                ),
              baselinePositiveRate:
                formatNumber(
                  baseline.positiveRate
                ),
              correlation:
                formatNumber(
                  row.correlation
                ),
              meanReturnNet:
                formatNumber(
                  row.meanReturn
                ),
              positiveRateNet:
                formatNumber(
                  row.positiveRate
                ),
              medianReturnNet:
                formatNumber(
                  row.medianReturn
                ),
              quartileMeansNet:
                row.quartileMeans.map(
                  (value) =>
                    formatNumber(value)
                )
            }
          ];
        }
      );
  }

  return result;
}

function createRankingAccumulator(): RankingAccumulator {
  return {
    topReturns: [],
    avgReturns: [],
    medianReturns: [],
    randomReturns: [],
    excessVsMean: [],
    excessVsMedian: [],
    excessVsRandom: []
  };
}

function summariseRankingAccumulator(
  accumulator: RankingAccumulator
): RankingSummary {
  return {
    topRankedMean: average(
      accumulator.topReturns
    ),
    avgEligibleMean: average(
      accumulator.avgReturns
    ),
    medianEligibleMean: average(
      accumulator.medianReturns
    ),
    randomSelectionMean: average(
      accumulator.randomReturns
    ),
    excessVsMeanMean: average(
      accumulator.excessVsMean
    ),
    excessVsMedianMean: average(
      accumulator.excessVsMedian
    ),
    excessVsRandomMean: average(
      accumulator.excessVsRandom
    )
  };
}

function rankingBenchmarkAll(
  observations: MarketObservation[],
  horizons: readonly number[]
): {
  gross: Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingSummary>
  >;
  net: Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingSummary>
  >;
} {
  const byTimestamp =
    groupByTimestamp(observations);

  const accumulators: Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingAccumulator>
  > = {} as Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingAccumulator>
  >;

  for (const rankingKey of RANKING_KEYS) {
    accumulators[rankingKey] = {};

    for (const horizon of horizons) {
      accumulators[rankingKey][horizon] =
        createRankingAccumulator();
    }
  }

  const randomGenerators: Record<
    (typeof RANKING_KEYS)[number],
    () => number
  > = {
    strength:
      makeDeterministicRandom(1337),

    trendStrength:
      makeDeterministicRandom(1338),

    shape:
      makeDeterministicRandom(1339),

    emaRatio:
      makeDeterministicRandom(1340),

    contrarianTrendStrength:
      makeDeterministicRandom(1341),

    contrarianAcceleration:
      makeDeterministicRandom(1342),

    contrarianDistanceFromRecentHigh:
      makeDeterministicRandom(1343),

    contrarianDistanceFromRecentLow:
      makeDeterministicRandom(1344)
  };

  for (const timestampRows of byTimestamp.values()) {
    if (!timestampRows.length) {
      continue;
    }

    const returnsByHorizon = new Map<
      number,
      {
        gross: number[];
        grossMean: number;
        grossMedian: number;
      }
    >();

    for (const horizon of horizons) {
      const gross: number[] = [];

      for (const row of timestampRows) {
        const value =
          row.futureReturns[horizon];

        if (Number.isFinite(value)) {
          gross.push(value);
        }
      }

      returnsByHorizon.set(horizon, {
        gross,
        grossMean: average(gross),
        grossMedian: median(gross)
      });
    }

    for (const rankingKey of RANKING_KEYS) {
      const ranked = [
        ...timestampRows
      ].sort(
        (left, right) =>
          getRankingValue(
            right,
            rankingKey
          ) -
          getRankingValue(
            left,
            rankingKey
          )
      );

      const top = ranked[0];

      if (!top) {
        continue;
      }

      const randomFn =
        randomGenerators[rankingKey];

      for (const horizon of horizons) {
        const returns =
          returnsByHorizon.get(horizon);

        if (
          !returns ||
          !returns.gross.length
        ) {
          continue;
        }

        const topGross =
          top.futureReturns[horizon];

        if (!Number.isFinite(topGross)) {
          continue;
        }

        const randomIndex = Math.floor(
          randomFn() *
            returns.gross.length
        );

        const randomGross =
          returns.gross[randomIndex] ?? 0;

        const accumulator =
          accumulators[rankingKey][
            horizon
          ];

        accumulator.topReturns.push(
          topGross
        );

        accumulator.avgReturns.push(
          returns.grossMean
        );

        accumulator.medianReturns.push(
          returns.grossMedian
        );

        accumulator.randomReturns.push(
          randomGross
        );

        accumulator.excessVsMean.push(
          topGross -
            returns.grossMean
        );

        accumulator.excessVsMedian.push(
          topGross -
            returns.grossMedian
        );

        accumulator.excessVsRandom.push(
          topGross -
            randomGross
        );
      }
    }
  }

  const gross: Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingSummary>
  > = {} as Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingSummary>
  >;

  const net: Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingSummary>
  > = {} as Record<
    (typeof RANKING_KEYS)[number],
    Record<number, RankingSummary>
  >;

  for (const rankingKey of RANKING_KEYS) {
    gross[rankingKey] = {};
    net[rankingKey] = {};

    for (const horizon of horizons) {
      const summary =
        summariseRankingAccumulator(
          accumulators[rankingKey][
            horizon
          ]
        );

      gross[rankingKey][horizon] =
        summary;

      net[rankingKey][horizon] = {
        topRankedMean:
          summary.topRankedMean -
          TOTAL_COST,

        avgEligibleMean:
          summary.avgEligibleMean -
          TOTAL_COST,

        medianEligibleMean:
          summary.medianEligibleMean -
          TOTAL_COST,

        randomSelectionMean:
          summary.randomSelectionMean -
          TOTAL_COST,

        excessVsMeanMean:
          summary.excessVsMeanMean,

        excessVsMedianMean:
          summary.excessVsMedianMean,

        excessVsRandomMean:
          summary.excessVsRandomMean
      };
    }
  }

  return {
    gross,
    net
  };
}

function writeResearchResults(
  payload: Record<string, unknown>
): string {
  const currentFilePath =
    fileURLToPath(import.meta.url);

  const currentDirectory =
    path.dirname(currentFilePath);

  const resultsDir = path.join(
    currentDirectory,
    'research-output'
  );

  fs.mkdirSync(resultsDir, {
    recursive: true
  });

  const fileName =
    `research-${Date.now()}.json`;

  const filePath = path.join(
    resultsDir,
    fileName
  );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      payload,
      null,
      2
    ),
    'utf8'
  );

  return filePath;
}

async function main() {
  const experimentStart =
    Date.now();

  console.log(
    `Research experiment started at ${new Date(
      experimentStart
    ).toISOString()}`
  );

  console.log(
    '\nResearch audit:'
  );

  console.log(
    JSON.stringify(
      buildResearchAudit(),
      null,
      2
    )
  );

  console.log(
    '\nFetching research universe...'
  );

  const universeInfo =
    await fetchBroadResearchUniverse({
      maxSymbols: 60
    });

  console.log(
    `Research universe fetched: ${universeInfo.selectedCount} symbols`
  );

  const endTime = Date.now();

  const startTime =
    endTime -
    30 *
      24 *
      60 *
      60 *
      1000;

  console.log(
    '\nBuilding historical research dataset...'
  );

  const datasetHeartbeat =
    setInterval(() => {
      const elapsedSeconds =
        Math.floor(
          (Date.now() -
            experimentStart) /
            1000
        );

      console.log(
        `Dataset still running: ${Math.floor(
          elapsedSeconds / 60
        )}m ${elapsedSeconds % 60}s elapsed`
      );
    }, 30000);

  const dataset =
    await buildHistoricalResearchDataset(
      universeInfo.universe,
      {
        startTime,
        endTime,
        limit: 1000,
        minHistory: 400,
        horizons:
          RESEARCH_HORIZONS,
        interval: '1m'
      }
    );

  clearInterval(
    datasetHeartbeat
  );

  console.log(
    `Dataset built: ${dataset.length.toLocaleString()} observations`
  );

  const sorted = [...dataset].sort(
    (left, right) =>
      left.timestamp -
      right.timestamp
  );

  const split =
    splitResearchPeriods(
      sorted,
      0.6,
      0.2
    );

  const symbols = [
    ...new Set(
      sorted.map(
        (row) => row.symbol
      )
    )
  ];

  const duplicateKeys =
    new Set<string>();

  let duplicateObservations = 0;

  for (const row of sorted) {
    const key =
      `${row.symbol}:${row.timestamp}`;

    if (duplicateKeys.has(key)) {
      duplicateObservations++;
    }

    duplicateKeys.add(key);
  }

  console.log(
    '\nDataset summary:'
  );

  console.log(
    JSON.stringify(
      {
        observations: sorted.length,
        markets: symbols.length,
        duplicateObservations,
        train:
          split.train.length,
        validation:
          split.validation.length,
        test:
          split.test.length
      },
      null,
      2
    )
  );

  const splitResults = {
    train: {
      observations:
        split.train.length,

      baselines:
        Object.fromEntries(
          buildBaselineSummaries(
            split.train,
            RESEARCH_HORIZONS
          )
        ),

      featureEvidence:
        buildFeatureEvidence(
          split.train,
          buildBaselineSummaries(
            split.train,
            RESEARCH_HORIZONS
          )
        ),

      legacySignals:
        buildLegacyEvidence(
          split.train,
          buildBaselineSummaries(
            split.train,
            RESEARCH_HORIZONS
          )
        ),

      ranking:
        rankingBenchmarkAll(
          split.train,
          RESEARCH_HORIZONS
        )
    },

    validation: {
      observations:
        split.validation.length,

      baselines:
        Object.fromEntries(
          buildBaselineSummaries(
            split.validation,
            RESEARCH_HORIZONS
          )
        ),

      featureEvidence:
        buildFeatureEvidence(
          split.validation,
          buildBaselineSummaries(
            split.validation,
            RESEARCH_HORIZONS
          )
        ),

      legacySignals:
        buildLegacyEvidence(
          split.validation,
          buildBaselineSummaries(
            split.validation,
            RESEARCH_HORIZONS
          )
        ),

      ranking:
        rankingBenchmarkAll(
          split.validation,
          RESEARCH_HORIZONS
        )
    },

    test: {
      observations:
        split.test.length,

      baselines:
        Object.fromEntries(
          buildBaselineSummaries(
            split.test,
            RESEARCH_HORIZONS
          )
        ),

      featureEvidence:
        buildFeatureEvidence(
          split.test,
          buildBaselineSummaries(
            split.test,
            RESEARCH_HORIZONS
          )
        ),

      legacySignals:
        buildLegacyEvidence(
          split.test,
          buildBaselineSummaries(
            split.test,
            RESEARCH_HORIZONS
          )
        ),

      ranking:
        rankingBenchmarkAll(
          split.test,
          RESEARCH_HORIZONS
        )
    }
  };

  const experimentOutput = {
    experimentTimestamp:
      new Date(
        experimentStart
      ).toISOString(),

    experiment: {
      purpose:
        'Determine whether individual features or their contrarian transformations can rank markets by subsequent return.',

      rankingKeys: [
        ...RANKING_KEYS
      ],

      contrarianTransformations: {
        contrarianTrendStrength:
          '-trendStrength',

        contrarianAcceleration:
          '-acceleration',

        contrarianDistanceFromRecentHigh:
          '-distanceFromRecentHigh',

        contrarianDistanceFromRecentLow:
          '-distanceFromRecentLow'
      }
    },

    datasetConfiguration: {
      version:
        DATASET_VERSION,

      interval: '1m',
      limit: 1000,
      minHistory: 400,

      horizons: [
        ...RESEARCH_HORIZONS
      ],

      startTime,
      endTime,

      startISO:
        new Date(
          startTime
        ).toISOString(),

      endISO:
        new Date(
          endTime
        ).toISOString(),

      feeRate: FEE_RATE,
      executionCost:
        EXECUTION_COST,
      totalCost:
        TOTAL_COST
    },

    universe: {
      source:
        universeInfo.source,

      totalAvailable:
        universeInfo.totalAvailable,

      selectedCount:
        universeInfo.selectedCount,

      symbols:
        universeInfo.universe,

      limitation:
        universeInfo.limitation,

      notes:
        universeInfo.notes
    },

    dateRange: {
      startTime,
      endTime,

      startISO:
        new Date(
          startTime
        ).toISOString(),

      endISO:
        new Date(
          endTime
        ).toISOString(),

      elapsedDays:
        (endTime - startTime) /
        (24 * 60 * 60 * 1000)
    },

    observationCount:
      sorted.length,

    duplicateObservations,

    trainValidationTest: {
      train:
        split.train.length,

      validation:
        split.validation.length,

      test:
        split.test.length,

      total:
        sorted.length,

      trainStart:
        split.train[0]
          ? new Date(
              split.train[0].timestamp
            ).toISOString()
          : null,

      trainEnd:
        split.train.length
          ? new Date(
              split.train[
                split.train.length - 1
              ].timestamp
            ).toISOString()
          : null,

      validationStart:
        split.validation[0]
          ? new Date(
              split.validation[0].timestamp
            ).toISOString()
          : null,

      validationEnd:
        split.validation.length
          ? new Date(
              split.validation[
                split.validation.length - 1
              ].timestamp
            ).toISOString()
          : null,

      testStart:
        split.test[0]
          ? new Date(
              split.test[0].timestamp
            ).toISOString()
          : null,

      testEnd:
        split.test.length
          ? new Date(
              split.test[
                split.test.length - 1
              ].timestamp
            ).toISOString()
          : null
    },

    results: splitResults,

    methodology: {
      rankingMethod:
        'At each timestamp, markets are ranked by the selected feature or signal. The highest-ranked market is compared with the cross-sectional mean, median and deterministic random selection.',

      grossReturn:
        'Close-to-close future return from T to T + horizon.',

      netReturn:
        'Gross future return minus the configured round-trip trading cost.',

      transactionCost:
        '0.20% total, representing 0.10% entry fee plus 0.10% exit fee.',

      splitMethod:
        'Chronological 60% train, 20% validation and 20% test split.',

      contrarianMethod:
        'A contrarian ranking negates the feature value, so the lowest original feature values become the highest-ranked observations.',

      importantComparison:
        'excessVsRandomMean should be positive if the ranking contains useful predictive information beyond deterministic random selection.'
    },

    researchAudit:
      buildResearchAudit()
  };

  const jsonPath =
    writeResearchResults(
      experimentOutput
    );

  console.log(
    `\nResearch results saved to ${jsonPath}`
  );

  console.log(
    '\nResearch experiment complete.'
  );
}

main().catch((error) => {
  console.error(
    'research-runner failed:',
    error
  );

  process.exit(1);
});