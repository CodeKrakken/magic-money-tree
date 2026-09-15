import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ============================================================
// Configuration
// ============================================================

const INPUT_PLAN_A = path.join(
  process.cwd(),
  "research",
  "output",
  "plan-a-market-behaviour-1789486025444.json",
);

const INPUT_SIGNAL_FILES = [
  path.join(
    process.cwd(),
    "research",
    "output",
    "plan-a-market-behaviour-signals-1789486025444-01.csv",
  ),
  path.join(
    process.cwd(),
    "research",
    "output",
    "plan-a-market-behaviour-signals-1789486025444-02.csv",
  ),
];

const OUTPUT_DIR = path.join(process.cwd(), "research", "output");

const TARGETS = [
  {
    name: "1pct",
    column: "timeTo1PctMinutes",
    reachedColumn: "reached1Pct",
  },
  {
    name: "2pct",
    column: "timeTo2PctMinutes",
    reachedColumn: "reached2Pct",
  },
  {
    name: "4pct",
    column: "timeTo4PctMinutes",
    reachedColumn: "reached4Pct",
  },
] as const;

const DEADLINES_MINUTES = [
  60,
  120,
  360,
  720,
  1440,
  2160,
  2880,
];

const QUINTILES = 5;

const ACCELERATION_THRESHOLD = 0.00013986740450809692;
const SLOPE_THRESHOLD = -0.0001425851160546487;

// ============================================================
// Types
// ============================================================

interface CsvRow {
  symbol: string;
  datasetGroup: string;
  marketClass: string;
  marketNetProfit: number;
  marketReturnPct: number;
  signalIndex: number;
  signalTime: string;
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

  forward5Return: number;
  forward15Return: number;
  forward30Return: number;
  forward60Return: number;
  forward120Return: number;
  forward360Return: number;
  forward720Return: number;
  forward1440Return: number;
  forward2880Return: number;

  mfe5: number;
  mfe15: number;
  mfe30: number;
  mfe60: number;
  mfe120: number;
  mfe360: number;
  mfe720: number;
  mfe1440: number;
  mfe2880: number;

  mae5: number;
  mae15: number;
  mae30: number;
  mae60: number;
  mae120: number;
  mae360: number;
  mae720: number;
  mae1440: number;
  mae2880: number;

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

interface StrengthObservation {
  symbol: string;
  datasetGroup: string;
  marketNetProfit: number;

  strength: number;

  normalisedAcceleration: number;
  slopeStrength: number;
  accelerationExcess: number;
  slopeExcess: number;
  combinedStrength: number;
  accelerationToSlopeRatio: number;

  targets: {
    [key: string]: {
      reached: boolean;
      timeMinutes: number | null;
    };
  };
}

interface NumericSummary {
  count: number;
  mean: number | null;
  median: number | null;
  p75: number | null;
  p80: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

interface CorrelationResult {
  pearson: number | null;
  spearman: number | null;
  n: number;
}

interface TargetDeadlineResult {
  target: string;
  deadlineMinutes: number;
  signalCount: number;
  hitCount: number;
  hitRatePct: number | null;
}

interface StrengthBucketResult {
  strengthDefinition: string;
  target: string;
  quintile: number;
  signalCount: number;
  reachedCount: number;
  hitRatePct: number | null;

  strengthMin: number | null;
  strengthMedian: number | null;
  strengthMax: number | null;

  timeToTarget: NumericSummary;

  deadlineHitRates: TargetDeadlineResult[];
}

interface StrengthDefinitionResult {
  strengthDefinition: string;

  signalCount: number;

  strengthSummary: NumericSummary;

  correlations: {
    timeTo1Pct: CorrelationResult;
    timeTo2Pct: CorrelationResult;
    timeTo4Pct: CorrelationResult;
  };

  buckets: StrengthBucketResult[];

  deadlines: TargetDeadlineResult[];
}

interface MarketStrengthResult {
  symbol: string;
  datasetGroup: string;
  marketNetProfit: number;
  signalCount: number;

  positiveSignals: number;
  flatSignals: number;
  negativeSignals: number;

  averageStrength: number | null;
  medianStrength: number | null;

  averageNormalisedAcceleration: number | null;
  medianNormalisedAcceleration: number | null;

  averageSlopeStrength: number | null;
  medianSlopeStrength: number | null;

  averageAccelerationExcess: number | null;
  medianAccelerationExcess: number | null;

  averageSlopeExcess: number | null;
  medianSlopeExcess: number | null;

  averageCombinedStrength: number | null;
  medianCombinedStrength: number | null;

  averageAccelerationToSlopeRatio: number | null;
  medianAccelerationToSlopeRatio: number | null;

  targets: {
    [key: string]: {
      signalCount: number;
      reachedCount: number;
      hitRatePct: number | null;
      timeToTarget: NumericSummary;
      deadlineHitRates: TargetDeadlineResult[];
    };
  };
}

interface MarketCorrelationResult {
  strengthDefinition: string;
  metric: string;
  pearson: number | null;
  spearman: number | null;
  n: number;
}

interface Output {
  generatedAt: string;

  input: {
    planAFile: string;
    signalFiles: string[];
  };

  configuration: {
    accelerationThreshold: number;
    slopeThreshold: number;
    deadlinesMinutes: number[];
    quintiles: number;
  };

  datasetSummary: {
    totalSignals: number;
    markets: number;
    positiveMarkets: number;
    flatMarkets: number;
    negativeMarkets: number;
  };

  definitions: StrengthDefinitionResult[];

  marketResults: MarketStrengthResult[];

  marketCorrelations: MarketCorrelationResult[];
}

// ============================================================
// CSV parsing
// ============================================================

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);

  return values;
}

function parseNumber(value: string): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseNullableNumber(value: string): number | null {
  if (value === "" || value === "null" || value === "undefined") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string): boolean {
  return (
    value === "true" ||
    value === "1" ||
    value === "TRUE" ||
    value === "True"
  );
}

function createRow(header: string[], values: string[]): CsvRow {
  const record: Record<string, string> = {};

  for (let i = 0; i < header.length; i += 1) {
    record[header[i]] = values[i] ?? "";
  }

  return {
    symbol: record.symbol,
    datasetGroup: record.datasetGroup,
    marketClass: record.marketClass,
    marketNetProfit: parseNumber(record.marketNetProfit),
    marketReturnPct: parseNumber(record.marketReturnPct),
    signalIndex: parseNumber(record.signalIndex),
    signalTime: record.signalTime,
    entryPrice: parseNumber(record.entryPrice),

    slope20: parseNumber(record.slope20),
    slope50: parseNumber(record.slope50),
    acceleration: parseNumber(record.acceleration),

    normalisedSlope20: parseNumber(record.normalisedSlope20),
    normalisedSlope50: parseNumber(record.normalisedSlope50),
    normalisedAcceleration: parseNumber(record.normalisedAcceleration),

    return5: parseNumber(record.return5),
    return20: parseNumber(record.return20),
    return50: parseNumber(record.return50),

    volatility20: parseNumber(record.volatility20),
    volatility50: parseNumber(record.volatility50),

    efficiency20: parseNumber(record.efficiency20),
    efficiency50: parseNumber(record.efficiency50),

    trendPersistence20: parseNumber(record.trendPersistence20),
    trendPersistence50: parseNumber(record.trendPersistence50),

    reversalRate20: parseNumber(record.reversalRate20),
    reversalRate50: parseNumber(record.reversalRate50),

    forward5Return: parseNumber(record.forward5Return),
    forward15Return: parseNumber(record.forward15Return),
    forward30Return: parseNumber(record.forward30Return),
    forward60Return: parseNumber(record.forward60Return),
    forward120Return: parseNumber(record.forward120Return),
    forward360Return: parseNumber(record.forward360Return),
    forward720Return: parseNumber(record.forward720Return),
    forward1440Return: parseNumber(record.forward1440Return),
    forward2880Return: parseNumber(record.forward2880Return),

    mfe5: parseNumber(record.mfe5),
    mfe15: parseNumber(record.mfe15),
    mfe30: parseNumber(record.mfe30),
    mfe60: parseNumber(record.mfe60),
    mfe120: parseNumber(record.mfe120),
    mfe360: parseNumber(record.mfe360),
    mfe720: parseNumber(record.mfe720),
    mfe1440: parseNumber(record.mfe1440),
    mfe2880: parseNumber(record.mfe2880),

    mae5: parseNumber(record.mae5),
    mae15: parseNumber(record.mae15),
    mae30: parseNumber(record.mae30),
    mae60: parseNumber(record.mae60),
    mae120: parseNumber(record.mae120),
    mae360: parseNumber(record.mae360),
    mae720: parseNumber(record.mae720),
    mae1440: parseNumber(record.mae1440),
    mae2880: parseNumber(record.mae2880),

    timeTo1PctMinutes: parseNullableNumber(record.timeTo1PctMinutes),
    timeTo2PctMinutes: parseNullableNumber(record.timeTo2PctMinutes),
    timeTo4PctMinutes: parseNullableNumber(record.timeTo4PctMinutes),
    timeToStopMinutes: parseNullableNumber(record.timeToStopMinutes),

    reached1Pct: parseBoolean(record.reached1Pct),
    reached2Pct: parseBoolean(record.reached2Pct),
    reached4Pct: parseBoolean(record.reached4Pct),
    reachedStop: parseBoolean(record.reachedStop),

    reached1ThenFailed2: parseBoolean(record.reached1ThenFailed2),
    reached2ThenFailed4: parseBoolean(record.reached2ThenFailed4),
  };
}

// ============================================================
// Statistics
// ============================================================

function finiteValues(values: number[]): number[] {
  return values.filter(Number.isFinite);
}

function mean(values: number[]): number | null {
  const valid = finiteValues(values);

  if (valid.length === 0) {
    return null;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sortedValues(values: number[]): number[] {
  return [...finiteValues(values)].sort((a, b) => a - b);
}

function percentile(values: number[], p: number): number | null {
  const sorted = sortedValues(values);

  if (sorted.length === 0) {
    return null;
  }

  if (sorted.length === 1) {
    return sorted[0];
  }

  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const fraction = index - lower;

  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

function numericSummary(values: number[]): NumericSummary {
  const valid = finiteValues(values);

  return {
    count: valid.length,
    mean: mean(valid),
    median: median(valid),
    p75: percentile(valid, 0.75),
    p80: percentile(valid, 0.8),
    p90: percentile(valid, 0.9),
    min: valid.length > 0 ? Math.min(...valid) : null,
    max: valid.length > 0 ? Math.max(...valid) : null,
  };
}

function pearson(
  x: number[],
  y: number[],
): number | null {
  if (x.length !== y.length || x.length < 2) {
    return null;
  }

  const meanX = mean(x);
  const meanY = mean(y);

  if (meanX === null || meanY === null) {
    return null;
  }

  let numerator = 0;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;

    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }

  const denominator = Math.sqrt(sumX * sumY);

  if (denominator === 0) {
    return null;
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

  let start = 0;

  while (start < indexed.length) {
    let end = start + 1;

    while (
      end < indexed.length &&
      indexed[end].value === indexed[start].value
    ) {
      end += 1;
    }

    const rank = (start + end - 1) / 2 + 1;

    for (let i = start; i < end; i += 1) {
      ranks[indexed[i].index] = rank;
    }

    start = end;
  }

  return ranks;
}

function spearman(
  x: number[],
  y: number[],
): number | null {
  if (x.length !== y.length || x.length < 2) {
    return null;
  }

  return pearson(rankValues(x), rankValues(y));
}

function correlation(
  x: number[],
  y: number[],
): CorrelationResult {
  const filteredX: number[] = [];
  const filteredY: number[] = [];

  for (let i = 0; i < x.length; i += 1) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      filteredX.push(x[i]);
      filteredY.push(y[i]);
    }
  }

  return {
    pearson: pearson(filteredX, filteredY),
    spearman: spearman(filteredX, filteredY),
    n: filteredX.length,
  };
}

// ============================================================
// Strength definitions
// ============================================================

function calculateStrengths(row: CsvRow): {
  normalisedAcceleration: number;
  slopeStrength: number;
  accelerationExcess: number;
  slopeExcess: number;
  combinedStrength: number;
  accelerationToSlopeRatio: number;
} {
  const normalisedAcceleration = row.normalisedAcceleration;

  const slopeStrength = -row.normalisedSlope20;

  const accelerationExcess =
    row.normalisedAcceleration - ACCELERATION_THRESHOLD;

  const slopeExcess =
    (-row.normalisedSlope20) - (-SLOPE_THRESHOLD);

  const combinedStrength =
    row.normalisedAcceleration + (-row.normalisedSlope20);

  const accelerationToSlopeRatio =
    slopeStrength > 0
      ? row.normalisedAcceleration / slopeStrength
      : NaN;

  return {
    normalisedAcceleration,
    slopeStrength,
    accelerationExcess,
    slopeExcess,
    combinedStrength,
    accelerationToSlopeRatio,
  };
}

const STRENGTH_NAMES = [
  "normalisedAcceleration",
  "slopeStrength",
  "accelerationExcess",
  "slopeExcess",
  "combinedStrength",
  "accelerationToSlopeRatio",
] as const;

type StrengthName = (typeof STRENGTH_NAMES)[number];

function getStrength(
  observation: StrengthObservation,
  definition: StrengthName,
): number {
  return observation[definition];
}

// ============================================================
// CSV streaming
// ============================================================

async function* readCsvFile(
  filename: string,
): AsyncGenerator<CsvRow> {
  const stream = fs.createReadStream(filename);

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;

  for await (const line of rl) {
    if (line.length === 0) {
      continue;
    }

    const values = parseCsvLine(line);

    if (header === null) {
      header = values;
      continue;
    }

    yield createRow(header, values);
  }
}

async function readAllRows(
  files: string[],
): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];

  for (const filename of files) {
    if (!fs.existsSync(filename)) {
      throw new Error(`Signal CSV not found: ${filename}`);
    }

    console.log(`Loading ${path.basename(filename)}...`);

    let count = 0;

    for await (const row of readCsvFile(filename)) {
      rows.push(row);
      count += 1;

      if (count % 10_000 === 0) {
        process.stdout.write(
          `\r  ${count.toLocaleString()} rows from current shard`,
        );
      }
    }

    process.stdout.write(
      `\r  ${count.toLocaleString()} rows from current shard\n`,
    );
  }

  return rows;
}

// ============================================================
// Observation conversion
// ============================================================

function createObservation(
  row: CsvRow,
): StrengthObservation {
  const strengths = calculateStrengths(row);

  return {
    symbol: row.symbol,
    datasetGroup: row.datasetGroup,
    marketNetProfit: row.marketNetProfit,

    ...strengths,

    targets: {
      "1pct": {
        reached: row.reached1Pct,
        timeMinutes: row.timeTo1PctMinutes,
      },
      "2pct": {
        reached: row.reached2Pct,
        timeMinutes: row.timeTo2PctMinutes,
      },
      "4pct": {
        reached: row.reached4Pct,
        timeMinutes: row.timeTo4PctMinutes,
      },
    },
  };
}

// ============================================================
// Quintiles
// ============================================================

function getQuintile(
  value: number,
  sortedStrengths: number[],
): number {
  if (sortedStrengths.length === 0) {
    return 0;
  }

  const rank = sortedStrengths.findIndex(
    (strength) => strength >= value,
  );

  if (rank === -1) {
    return QUINTILES - 1;
  }

  const fraction = rank / sortedStrengths.length;

  return Math.min(
    QUINTILES - 1,
    Math.floor(fraction * QUINTILES),
  );
}

// ============================================================
// Deadline analysis
// ============================================================

function calculateDeadlineRates(
  observations: StrengthObservation[],
  targetName: string,
): TargetDeadlineResult[] {
  return DEADLINES_MINUTES.map((deadlineMinutes) => {
    let hitCount = 0;

    for (const observation of observations) {
      const target = observation.targets[targetName];

      if (
        target.reached &&
        target.timeMinutes !== null &&
        target.timeMinutes <= deadlineMinutes
      ) {
        hitCount += 1;
      }
    }

    return {
      target: targetName,
      deadlineMinutes,
      signalCount: observations.length,
      hitCount,
      hitRatePct:
        observations.length > 0
          ? (hitCount / observations.length) * 100
          : null,
    };
  });
}

// ============================================================
// Strength definition analysis
// ============================================================

function analyseStrengthDefinition(
  observations: StrengthObservation[],
  definition: StrengthName,
): StrengthDefinitionResult {
  const valid = observations.filter((observation) =>
    Number.isFinite(getStrength(observation, definition)),
  );

  const strengths = valid.map((observation) =>
    getStrength(observation, definition),
  );

  const result: StrengthDefinitionResult = {
    strengthDefinition: definition,
    signalCount: valid.length,

    strengthSummary: numericSummary(strengths),

    correlations: {
      timeTo1Pct: correlation(
        valid
          .filter((observation) => {
            const target = observation.targets["1pct"];
            return target.reached && target.timeMinutes !== null;
          })
          .map((observation) => getStrength(observation, definition)),
        valid
          .filter((observation) => {
            const target = observation.targets["1pct"];
            return target.reached && target.timeMinutes !== null;
          })
          .map(
            (observation) =>
              observation.targets["1pct"].timeMinutes as number,
          ),
      ),

      timeTo2Pct: correlation(
        valid
          .filter((observation) => {
            const target = observation.targets["2pct"];
            return target.reached && target.timeMinutes !== null;
          })
          .map((observation) => getStrength(observation, definition)),
        valid
          .filter((observation) => {
            const target = observation.targets["2pct"];
            return target.reached && target.timeMinutes !== null;
          })
          .map(
            (observation) =>
              observation.targets["2pct"].timeMinutes as number,
          ),
      ),

      timeTo4Pct: correlation(
        valid
          .filter((observation) => {
            const target = observation.targets["4pct"];
            return target.reached && target.timeMinutes !== null;
          })
          .map((observation) => getStrength(observation, definition)),
        valid
          .filter((observation) => {
            const target = observation.targets["4pct"];
            return target.reached && target.timeMinutes !== null;
          })
          .map(
            (observation) =>
              observation.targets["4pct"].timeMinutes as number,
          ),
      ),
    },

    buckets: [],
    deadlines: [],
  };

  const sortedStrengths = [...strengths].sort((a, b) => a - b);

  for (let quintile = 0; quintile < QUINTILES; quintile += 1) {
    const bucket = valid.filter(
      (observation) =>
        getQuintile(
          getStrength(observation, definition),
          sortedStrengths,
        ) === quintile,
    );

    const bucketStrengths = bucket.map((observation) =>
      getStrength(observation, definition),
    );

    for (const target of TARGETS) {
      const reached = bucket
        .filter(
          (observation) =>
            observation.targets[target.name].reached &&
            observation.targets[target.name].timeMinutes !== null,
        )
        .map(
          (observation) =>
            observation.targets[target.name].timeMinutes as number,
        );

      result.buckets.push({
        strengthDefinition: definition,
        target: target.name,
        quintile: quintile + 1,
        signalCount: bucket.length,
        reachedCount: reached.length,
        hitRatePct:
          bucket.length > 0
            ? (reached.length / bucket.length) * 100
            : null,

        strengthMin:
          bucketStrengths.length > 0
            ? Math.min(...bucketStrengths)
            : null,

        strengthMedian: median(bucketStrengths),

        strengthMax:
          bucketStrengths.length > 0
            ? Math.max(...bucketStrengths)
            : null,

        timeToTarget: numericSummary(reached),

        deadlineHitRates: calculateDeadlineRates(
          bucket,
          target.name,
        ),
      });
    }
  }

  for (const target of TARGETS) {
    result.deadlines.push(
      ...calculateDeadlineRates(valid, target.name),
    );
  }

  return result;
}

// ============================================================
// Market-level analysis
// ============================================================

function calculateMarketTarget(
  observations: StrengthObservation[],
  targetName: string,
): {
  signalCount: number;
  reachedCount: number;
  hitRatePct: number | null;
  timeToTarget: NumericSummary;
  deadlineHitRates: TargetDeadlineResult[];
} {
  const reached = observations
    .filter(
      (observation) =>
        observation.targets[targetName].reached &&
        observation.targets[targetName].timeMinutes !== null,
    )
    .map(
      (observation) =>
        observation.targets[targetName].timeMinutes as number,
    );

  return {
    signalCount: observations.length,
    reachedCount: reached.length,
    hitRatePct:
      observations.length > 0
        ? (reached.length / observations.length) * 100
        : null,
    timeToTarget: numericSummary(reached),
    deadlineHitRates: calculateDeadlineRates(
      observations,
      targetName,
    ),
  };
}

function averageField(
  observations: StrengthObservation[],
  definition: StrengthName,
): number | null {
  return mean(
    observations
      .map((observation) => getStrength(observation, definition))
      .filter(Number.isFinite),
  );
}

function medianField(
  observations: StrengthObservation[],
  definition: StrengthName,
): number | null {
  return median(
    observations
      .map((observation) => getStrength(observation, definition))
      .filter(Number.isFinite),
  );
}

function createMarketResults(
  observations: StrengthObservation[],
): MarketStrengthResult[] {
  const groups = new Map<string, StrengthObservation[]>();

  for (const observation of observations) {
    const existing = groups.get(observation.symbol);

    if (existing) {
      existing.push(observation);
    } else {
      groups.set(observation.symbol, [observation]);
    }
  }

  const results: MarketStrengthResult[] = [];

  for (const [symbol, marketObservations] of groups) {
    const first = marketObservations[0];

    let positiveSignals = 0;
    let flatSignals = 0;
    let negativeSignals = 0;

    for (const observation of marketObservations) {
      if (observation.marketNetProfit > 0) {
        positiveSignals += 1;
      } else if (observation.marketNetProfit < 0) {
        negativeSignals += 1;
      } else {
        flatSignals += 1;
      }
    }

    results.push({
      symbol,
      datasetGroup: first.datasetGroup,
      marketNetProfit: first.marketNetProfit,
      signalCount: marketObservations.length,

      positiveSignals,
      flatSignals,
      negativeSignals,

      averageStrength: averageField(
        marketObservations,
        "combinedStrength",
      ),
      medianStrength: medianField(
        marketObservations,
        "combinedStrength",
      ),

      averageNormalisedAcceleration: averageField(
        marketObservations,
        "normalisedAcceleration",
      ),
      medianNormalisedAcceleration: medianField(
        marketObservations,
        "normalisedAcceleration",
      ),

      averageSlopeStrength: averageField(
        marketObservations,
        "slopeStrength",
      ),
      medianSlopeStrength: medianField(
        marketObservations,
        "slopeStrength",
      ),

      averageAccelerationExcess: averageField(
        marketObservations,
        "accelerationExcess",
      ),
      medianAccelerationExcess: medianField(
        marketObservations,
        "accelerationExcess",
      ),

      averageSlopeExcess: averageField(
        marketObservations,
        "slopeExcess",
      ),
      medianSlopeExcess: medianField(
        marketObservations,
        "slopeExcess",
      ),

      averageCombinedStrength: averageField(
        marketObservations,
        "combinedStrength",
      ),
      medianCombinedStrength: medianField(
        marketObservations,
        "combinedStrength",
      ),

      averageAccelerationToSlopeRatio: averageField(
        marketObservations,
        "accelerationToSlopeRatio",
      ),
      medianAccelerationToSlopeRatio: medianField(
        marketObservations,
        "accelerationToSlopeRatio",
      ),

      targets: {
        "1pct": calculateMarketTarget(
          marketObservations,
          "1pct",
        ),
        "2pct": calculateMarketTarget(
          marketObservations,
          "2pct",
        ),
        "4pct": calculateMarketTarget(
          marketObservations,
          "4pct",
        ),
      },
    });
  }

  results.sort((a, b) => b.marketNetProfit - a.marketNetProfit);

  return results;
}

// ============================================================
// Market-level correlation
// ============================================================

function createMarketCorrelation(
  markets: MarketStrengthResult[],
  strengthDefinition: StrengthName,
  metric: string,
  values: number[],
): MarketCorrelationResult {
  const x: number[] = [];
  const y: number[] = [];

  for (let i = 0; i < markets.length; i += 1) {
    if (
      Number.isFinite(values[i]) &&
      Number.isFinite(markets[i].marketNetProfit)
    ) {
      x.push(values[i]);
      y.push(markets[i].marketNetProfit);
    }
  }

  return {
    strengthDefinition,
    metric,
    pearson: pearson(x, y),
    spearman: spearman(x, y),
    n: x.length,
  };
}

function createMarketCorrelations(
  markets: MarketStrengthResult[],
): MarketCorrelationResult[] {
  const results: MarketCorrelationResult[] = [];

  const definitions: Array<{
    name: StrengthName;
    get: (market: MarketStrengthResult) => number | null;
  }> = [
    {
      name: "normalisedAcceleration",
      get: (market) => market.averageNormalisedAcceleration,
    },
    {
      name: "slopeStrength",
      get: (market) => market.averageSlopeStrength,
    },
    {
      name: "accelerationExcess",
      get: (market) => market.averageAccelerationExcess,
    },
    {
      name: "slopeExcess",
      get: (market) => market.averageSlopeExcess,
    },
    {
      name: "combinedStrength",
      get: (market) => market.averageCombinedStrength,
    },
    {
      name: "accelerationToSlopeRatio",
      get: (market) =>
        market.averageAccelerationToSlopeRatio,
    },
  ];

  for (const definition of definitions) {
    results.push(
      createMarketCorrelation(
        markets,
        definition.name,
        "averageStrengthVsMarketNetProfit",
        markets.map((market) => {
          const value = definition.get(market);
          return value ?? NaN;
        }),
      ),
    );
  }

  const targetMetrics: Array<{
    target: "1pct" | "2pct" | "4pct";
    metric: string;
    get: (market: MarketStrengthResult) => number | null;
  }> = [
    {
      target: "1pct",
      metric: "targetHitRatePct",
      get: (market) => market.targets["1pct"].hitRatePct,
    },
    {
      target: "2pct",
      metric: "targetHitRatePct",
      get: (market) => market.targets["2pct"].hitRatePct,
    },
    {
      target: "4pct",
      metric: "targetHitRatePct",
      get: (market) => market.targets["4pct"].hitRatePct,
    },
    {
      target: "1pct",
      metric: "medianTimeToTarget",
      get: (market) =>
        market.targets["1pct"].timeToTarget.median,
    },
    {
      target: "2pct",
      metric: "medianTimeToTarget",
      get: (market) =>
        market.targets["2pct"].timeToTarget.median,
    },
    {
      target: "4pct",
      metric: "medianTimeToTarget",
      get: (market) =>
        market.targets["4pct"].timeToTarget.median,
    },
  ];

  for (const definition of definitions) {
    for (const targetMetric of targetMetrics) {
      results.push(
        createMarketCorrelation(
          markets,
          definition.name,
          `${targetMetric.target}_${targetMetric.metric}`,
          markets.map(() => NaN),
        ),
      );

      const entry = results[results.length - 1];

      const x: number[] = [];
      const y: number[] = [];

      for (const market of markets) {
        const strength = definition.get(market);
        const metricValue = targetMetric.get(market);

        if (
          strength !== null &&
          metricValue !== null &&
          Number.isFinite(strength) &&
          Number.isFinite(metricValue)
        ) {
          x.push(strength);
          y.push(metricValue);
        }
      }

      entry.pearson = pearson(x, y);
      entry.spearman = spearman(x, y);
      entry.n = x.length;
    }
  }

  return results;
}

// ============================================================
// CSV output
// ============================================================

function csvEscape(value: unknown): string {
  const stringValue =
    value === null || value === undefined
      ? ""
      : String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}

function writeCsv(
  filename: string,
  headers: string[],
  rows: Array<Record<string, unknown>>,
): void {
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => csvEscape(row[header]))
        .join(","),
    ),
  ];

  fs.writeFileSync(filename, `${lines.join("\n")}\n`);
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log("============================================================");
  console.log("Signal strength / time-to-profit analysis");
  console.log("============================================================");
  console.log();

  if (!fs.existsSync(INPUT_PLAN_A)) {
    throw new Error(
      `Plan A output not found: ${INPUT_PLAN_A}`,
    );
  }

  console.log(
    `Plan A summary: ${INPUT_PLAN_A}`,
  );

  const planA = JSON.parse(
    fs.readFileSync(INPUT_PLAN_A, "utf8"),
  ) as {
    datasetSummary?: {
      totalSignals?: number;
    };
    signalFiles?: Array<{
      file: string;
      bytes: number;
      megabytes: number;
    }>;
  };

  if (planA.signalFiles) {
    console.log();
    console.log("Signal files recorded by Plan A:");

    for (const signalFile of planA.signalFiles) {
      console.log(
        `  ${signalFile.file} (${signalFile.megabytes.toFixed(2)} MB)`,
      );
    }
  }

  console.log();
  console.log("Reading signal CSV shards...");

  const rows = await readAllRows(INPUT_SIGNAL_FILES);

  console.log();
  console.log(
    `Loaded ${rows.length.toLocaleString()} signal observations.`,
  );

  if (rows.length === 0) {
    throw new Error("No signal observations were loaded.");
  }

  const observations = rows.map(createObservation);

  const marketResults = createMarketResults(observations);

  const positiveMarkets = marketResults.filter(
    (market) => market.marketNetProfit > 0,
  ).length;

  const flatMarkets = marketResults.filter(
    (market) => market.marketNetProfit === 0,
  ).length;

  const negativeMarkets = marketResults.filter(
    (market) => market.marketNetProfit < 0,
  ).length;

  console.log();
  console.log("============================================================");
  console.log("Dataset summary");
  console.log("============================================================");
  console.log(
    `Signals:          ${observations.length.toLocaleString()}`,
  );
  console.log(
    `Markets:          ${marketResults.length.toLocaleString()}`,
  );
  console.log(`Positive markets: ${positiveMarkets}`);
  console.log(`Flat markets:     ${flatMarkets}`);
  console.log(`Negative markets: ${negativeMarkets}`);

  console.log();
  console.log("============================================================");
  console.log("Analysing signal strength definitions");
  console.log("============================================================");

  const definitions: StrengthDefinitionResult[] = [];

  for (const definition of STRENGTH_NAMES) {
    console.log(`  ${definition}...`);

    const result = analyseStrengthDefinition(
      observations,
      definition,
    );

    definitions.push(result);

    console.log(
      `    signals: ${result.signalCount.toLocaleString()}`,
    );

    console.log(
      `    +1% time correlation: ` +
        `Pearson ${result.correlations.timeTo1Pct.pearson?.toFixed(4) ?? "n/a"}, ` +
        `Spearman ${result.correlations.timeTo1Pct.spearman?.toFixed(4) ?? "n/a"} ` +
        `(n=${result.correlations.timeTo1Pct.n})`,
    );

    console.log(
      `    +2% time correlation: ` +
        `Pearson ${result.correlations.timeTo2Pct.pearson?.toFixed(4) ?? "n/a"}, ` +
        `Spearman ${result.correlations.timeTo2Pct.spearman?.toFixed(4) ?? "n/a"} ` +
        `(n=${result.correlations.timeTo2Pct.n})`,
    );

    console.log(
      `    +4% time correlation: ` +
        `Pearson ${result.correlations.timeTo4Pct.pearson?.toFixed(4) ?? "n/a"}, ` +
        `Spearman ${result.correlations.timeTo4Pct.spearman?.toFixed(4) ?? "n/a"} ` +
        `(n=${result.correlations.timeTo4Pct.n})`,
    );
  }

  console.log();
  console.log("============================================================");
  console.log("Market-level correlations");
  console.log("============================================================");

  const marketCorrelations =
    createMarketCorrelations(marketResults);

  const importantMarketCorrelations =
    marketCorrelations.filter(
      (result) =>
        result.metric ===
        "averageStrengthVsMarketNetProfit",
    );

  for (const result of importantMarketCorrelations) {
    console.log(
      `  ${result.strengthDefinition.padEnd(32)} ` +
        `Pearson=${result.pearson?.toFixed(4) ?? "n/a"} ` +
        `Spearman=${result.spearman?.toFixed(4) ?? "n/a"} ` +
        `(n=${result.n})`,
    );
  }

  console.log();
  console.log("============================================================");
  console.log("Strongest unconditional deadline results");
  console.log("============================================================");

  for (const definition of definitions) {
    const onePct = definition.deadlines.filter(
      (deadline) => deadline.target === "1pct",
    );

    const strongest = [...onePct].sort(
      (a, b) => b.hitRatePct - a.hitRatePct,
    )[0];

    if (strongest) {
      console.log(
        `  ${definition.strengthDefinition.padEnd(32)} ` +
          `+1% @ ${strongest.deadlineMinutes}m: ` +
          `${strongest.hitRatePct?.toFixed(2) ?? "n/a"}%`,
      );
    }
  }

  const timestamp =
    new Date().toISOString().replace(/[:.]/g, "-");

  const jsonFilename = path.join(
    OUTPUT_DIR,
    `signal-strength-time-to-profit-${timestamp}.json`,
  );

  const correlationsFilename = path.join(
    OUTPUT_DIR,
    `signal-strength-time-to-profit-correlations-${timestamp}.csv`,
  );

  const marketCorrelationsFilename = path.join(
    OUTPUT_DIR,
    `signal-strength-time-to-profit-market-correlations-${timestamp}.csv`,
  );

  const marketsFilename = path.join(
    OUTPUT_DIR,
    `signal-strength-time-to-profit-markets-${timestamp}.csv`,
  );

  const deadlinesFilename = path.join(
    OUTPUT_DIR,
    `signal-strength-time-to-profit-deadlines-${timestamp}.csv`,
  );

  const quintilesFilename = path.join(
    OUTPUT_DIR,
    `signal-strength-time-to-profit-quintiles-${timestamp}.csv`,
  );

  const output: Output = {
    generatedAt: new Date().toISOString(),

    input: {
      planAFile: INPUT_PLAN_A,
      signalFiles: INPUT_SIGNAL_FILES,
    },

    configuration: {
      accelerationThreshold: ACCELERATION_THRESHOLD,
      slopeThreshold: SLOPE_THRESHOLD,
      deadlinesMinutes: DEADLINES_MINUTES,
      quintiles: QUINTILES,
    },

    datasetSummary: {
      totalSignals: observations.length,
      markets: marketResults.length,
      positiveMarkets,
      flatMarkets,
      negativeMarkets,
    },

    definitions,

    marketResults,

    marketCorrelations,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  fs.writeFileSync(
    jsonFilename,
    JSON.stringify(output, null, 2),
  );

  // ----------------------------------------------------------
  // Correlations CSV
  // ----------------------------------------------------------

  writeCsv(
    correlationsFilename,
    [
      "strengthDefinition",
      "metric",
      "pearson",
      "spearman",
      "n",
    ],
    definitions.flatMap((definition) => [
      {
        strengthDefinition:
          definition.strengthDefinition,
        metric: "timeTo1Pct",
        pearson:
          definition.correlations.timeTo1Pct.pearson,
        spearman:
          definition.correlations.timeTo1Pct.spearman,
        n: definition.correlations.timeTo1Pct.n,
      },
      {
        strengthDefinition:
          definition.strengthDefinition,
        metric: "timeTo2Pct",
        pearson:
          definition.correlations.timeTo2Pct.pearson,
        spearman:
          definition.correlations.timeTo2Pct.spearman,
        n: definition.correlations.timeTo2Pct.n,
      },
      {
        strengthDefinition:
          definition.strengthDefinition,
        metric: "timeTo4Pct",
        pearson:
          definition.correlations.timeTo4Pct.pearson,
        spearman:
          definition.correlations.timeTo4Pct.spearman,
        n: definition.correlations.timeTo4Pct.n,
      },
    ]),
  );

  // ----------------------------------------------------------
  // Market correlations CSV
  // ----------------------------------------------------------

  writeCsv(
    marketCorrelationsFilename,
    [
      "strengthDefinition",
      "metric",
      "pearson",
      "spearman",
      "n",
    ],
    marketCorrelations.map((result) => ({
      strengthDefinition:
        result.strengthDefinition,
      metric: result.metric,
      pearson: result.pearson,
      spearman: result.spearman,
      n: result.n,
    })),
  );

  // ----------------------------------------------------------
  // Market CSV
  // ----------------------------------------------------------

  writeCsv(
    marketsFilename,
    [
      "symbol",
      "datasetGroup",
      "marketNetProfit",
      "signalCount",
      "positiveSignals",
      "flatSignals",
      "negativeSignals",

      "averageNormalisedAcceleration",
      "medianNormalisedAcceleration",

      "averageSlopeStrength",
      "medianSlopeStrength",

      "averageAccelerationExcess",
      "medianAccelerationExcess",

      "averageSlopeExcess",
      "medianSlopeExcess",

      "averageCombinedStrength",
      "medianCombinedStrength",

      "averageAccelerationToSlopeRatio",
      "medianAccelerationToSlopeRatio",

      "target1PctHitRatePct",
      "target1PctMedianTimeMinutes",

      "target2PctHitRatePct",
      "target2PctMedianTimeMinutes",

      "target4PctHitRatePct",
      "target4PctMedianTimeMinutes",
    ],
    marketResults.map((market) => ({
      symbol: market.symbol,
      datasetGroup: market.datasetGroup,
      marketNetProfit: market.marketNetProfit,
      signalCount: market.signalCount,
      positiveSignals: market.positiveSignals,
      flatSignals: market.flatSignals,
      negativeSignals: market.negativeSignals,

      averageNormalisedAcceleration:
        market.averageNormalisedAcceleration,
      medianNormalisedAcceleration:
        market.medianNormalisedAcceleration,

      averageSlopeStrength:
        market.averageSlopeStrength,
      medianSlopeStrength:
        market.medianSlopeStrength,

      averageAccelerationExcess:
        market.averageAccelerationExcess,
      medianAccelerationExcess:
        market.medianAccelerationExcess,

      averageSlopeExcess:
        market.averageSlopeExcess,
      medianSlopeExcess:
        market.medianSlopeExcess,

      averageCombinedStrength:
        market.averageCombinedStrength,
      medianCombinedStrength:
        market.medianCombinedStrength,

      averageAccelerationToSlopeRatio:
        market.averageAccelerationToSlopeRatio,
      medianAccelerationToSlopeRatio:
        market.medianAccelerationToSlopeRatio,

      target1PctHitRatePct:
        market.targets["1pct"].hitRatePct,
      target1PctMedianTimeMinutes:
        market.targets["1pct"].timeToTarget.median,

      target2PctHitRatePct:
        market.targets["2pct"].hitRatePct,
      target2PctMedianTimeMinutes:
        market.targets["2pct"].timeToTarget.median,

      target4PctHitRatePct:
        market.targets["4pct"].hitRatePct,
      target4PctMedianTimeMinutes:
        market.targets["4pct"].timeToTarget.median,
    })),
  );

  // ----------------------------------------------------------
  // Deadline CSV
  // ----------------------------------------------------------

  writeCsv(
    deadlinesFilename,
    [
      "strengthDefinition",
      "scope",
      "quintile",
      "target",
      "deadlineMinutes",
      "signalCount",
      "hitCount",
      "hitRatePct",
    ],
    definitions.flatMap((definition) =>
      definition.deadlines.map((deadline) => ({
        strengthDefinition:
          definition.strengthDefinition,
        scope: "allSignals",
        quintile: "",
        target: deadline.target,
        deadlineMinutes:
          deadline.deadlineMinutes,
        signalCount: deadline.signalCount,
        hitCount: deadline.hitCount,
        hitRatePct: deadline.hitRatePct,
      })),
    ),
  );

  // ----------------------------------------------------------
  // Quintile CSV
  // ----------------------------------------------------------

  writeCsv(
    quintilesFilename,
    [
      "strengthDefinition",
      "target",
      "quintile",
      "signalCount",
      "reachedCount",
      "hitRatePct",
      "strengthMin",
      "strengthMedian",
      "strengthMax",
      "timeMeanMinutes",
      "timeMedianMinutes",
      "timeP75Minutes",
      "timeP80Minutes",
      "timeP90Minutes",
      "deadline60mHitRatePct",
      "deadline120mHitRatePct",
      "deadline360mHitRatePct",
      "deadline720mHitRatePct",
      "deadline1440mHitRatePct",
      "deadline2160mHitRatePct",
      "deadline2880mHitRatePct",
    ],
    definitions.flatMap((definition) =>
      definition.buckets.map((bucket) => {
        const deadlineMap = new Map(
          bucket.deadlineHitRates.map((deadline) => [
            deadline.deadlineMinutes,
            deadline.hitRatePct,
          ]),
        );

        return {
          strengthDefinition:
            bucket.strengthDefinition,
          target: bucket.target,
          quintile: bucket.quintile,
          signalCount: bucket.signalCount,
          reachedCount: bucket.reachedCount,
          hitRatePct: bucket.hitRatePct,

          strengthMin: bucket.strengthMin,
          strengthMedian: bucket.strengthMedian,
          strengthMax: bucket.strengthMax,

          timeMeanMinutes:
            bucket.timeToTarget.mean,
          timeMedianMinutes:
            bucket.timeToTarget.median,
          timeP75Minutes:
            bucket.timeToTarget.p75,
          timeP80Minutes:
            bucket.timeToTarget.p80,
          timeP90Minutes:
            bucket.timeToTarget.p90,

          deadline60mHitRatePct:
            deadlineMap.get(60) ?? null,
          deadline120mHitRatePct:
            deadlineMap.get(120) ?? null,
          deadline360mHitRatePct:
            deadlineMap.get(360) ?? null,
          deadline720mHitRatePct:
            deadlineMap.get(720) ?? null,
          deadline1440mHitRatePct:
            deadlineMap.get(1440) ?? null,
          deadline2160mHitRatePct:
            deadlineMap.get(2160) ?? null,
          deadline2880mHitRatePct:
            deadlineMap.get(2880) ?? null,
        };
      }),
    ),
  );

  console.log();
  console.log("============================================================");
  console.log("Complete");
  console.log("============================================================");
  console.log();
  console.log(`JSON:          ${jsonFilename}`);
  console.log(`Correlations:  ${correlationsFilename}`);
  console.log(`Market corr.:  ${marketCorrelationsFilename}`);
  console.log(`Markets:       ${marketsFilename}`);
  console.log(`Deadlines:     ${deadlinesFilename}`);
  console.log(`Quintiles:     ${quintilesFilename}`);
  console.log();
}

main().catch((error: unknown) => {
  console.error();
  console.error("ERROR");
  console.error("-----");

  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});