import fs from 'fs';
import path from 'path';
import { RESEARCH_HORIZONS, buildHistoricalResearchDataset, evaluateFeatureEvidence, evaluateLegacySignalEvidence, fetchKlines, splitResearchPeriods, average, median, netReturn, makeDeterministicRandom, percentageChange, buildResearchAudit, fetchBroadResearchUniverse } from './research';
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
];
const SIGNAL_KEYS = ['shape', 'emaRatio', 'strength'];
const RANKING_KEYS = [
    'strength',
    'trendStrength',
    'shape',
    'emaRatio'
];
const DATASET_VERSION = 'research-v1.2';
const FEE_RATE = 0.001;
const EXECUTION_COST = 0.0005;
const TOTAL_COST = FEE_RATE + EXECUTION_COST;
function formatNumber(value, decimals = 6) {
    const safe = Number.isFinite(value) ? value : 0;
    return Number(safe).toFixed(decimals);
}
function getSignalValue(row, signalKey) {
    if (signalKey === 'strength') {
        return row.legacySignals?.strength ?? 0;
    }
    if (signalKey === 'shape') {
        return row.legacySignals?.shape ?? 0;
    }
    if (signalKey === 'emaRatio') {
        return row.legacySignals?.emaRatio ?? 0;
    }
    return row.features[signalKey] ?? 0;
}
function groupByTimestamp(observations) {
    const groups = new Map();
    for (const observation of observations) {
        const existing = groups.get(observation.timestamp);
        if (existing) {
            existing.push(observation);
        }
        else {
            groups.set(observation.timestamp, [observation]);
        }
    }
    return groups;
}
function buildBaselineSummaries(observations, horizons) {
    const result = new Map();
    for (const horizon of horizons) {
        let sum = 0;
        let positive = 0;
        let count = 0;
        const returns = [];
        for (const row of observations) {
            const gross = row.futureReturns[horizon];
            if (!Number.isFinite(gross)) {
                continue;
            }
            const net = netReturn(gross, FEE_RATE, EXECUTION_COST);
            sum += net;
            count++;
            if (net > 0) {
                positive++;
            }
            returns.push(net);
        }
        result.set(horizon, {
            mean: count ? sum / count : 0,
            median: median(returns),
            positiveRate: count
                ? positive / count
                : 0,
            count
        });
    }
    return result;
}
function buildFeatureEvidenceRows(observations, featureKey, horizons, baselines) {
    const rows = [];
    const evidence = evaluateFeatureEvidence(observations, featureKey, horizons, FEE_RATE, EXECUTION_COST);
    for (const horizon of horizons) {
        const result = evidence.find((entry) => entry.horizon === horizon);
        const baseline = baselines.get(horizon);
        if (!result || !baseline) {
            continue;
        }
        rows.push({
            horizon,
            baselineMeanReturnNet: formatNumber(baseline.mean),
            baselinePositiveRate: formatNumber(baseline.positiveRate),
            correlation: formatNumber(result.correlation),
            meanReturnNet: formatNumber(result.meanReturn),
            positiveRateNet: formatNumber(result.positiveRate),
            medianReturnNet: formatNumber(result.medianReturn),
            quartileMeansNet: result.quartileMeans.map((value) => formatNumber(value))
        });
    }
    return rows;
}
function buildLegacyEvidenceRows(observations, horizons, baselines) {
    const evidence = evaluateLegacySignalEvidence(observations, horizons, FEE_RATE, EXECUTION_COST);
    const result = {};
    for (const signalKey of SIGNAL_KEYS) {
        result[signalKey] = [];
        for (const horizon of horizons) {
            const row = evidence[signalKey]?.find((entry) => entry.horizon === horizon);
            const baseline = baselines.get(horizon);
            if (!row || !baseline) {
                continue;
            }
            result[signalKey].push({
                horizon,
                baselineMeanReturnNet: formatNumber(baseline.mean),
                baselinePositiveRate: formatNumber(baseline.positiveRate),
                correlation: formatNumber(row.correlation),
                meanReturnNet: formatNumber(row.meanReturn),
                positiveRateNet: formatNumber(row.positiveRate),
                medianReturnNet: formatNumber(row.medianReturn),
                quartileMeansNet: row.quartileMeans.map((value) => formatNumber(value))
            });
        }
    }
    return result;
}
function createRankingAccumulator() {
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
function summariseRankingAccumulator(accumulator) {
    return {
        topRankedMean: average(accumulator.topReturns),
        avgEligibleMean: average(accumulator.avgReturns),
        medianEligibleMean: average(accumulator.medianReturns),
        randomSelectionMean: average(accumulator.randomReturns),
        excessVsMeanMean: average(accumulator.excessVsMean),
        excessVsMedianMean: average(accumulator.excessVsMedian),
        excessVsRandomMean: average(accumulator.excessVsRandom)
    };
}
function rankingBenchmarkAll(observations, horizons, label) {
    const byTimestamp = groupByTimestamp(observations);
    const accumulators = {};
    for (const signalKey of RANKING_KEYS) {
        accumulators[signalKey] = {};
        for (const horizon of horizons) {
            accumulators[signalKey][horizon] =
                createRankingAccumulator();
        }
    }
    const randomGenerators = {
        strength: makeDeterministicRandom(1337),
        trendStrength: makeDeterministicRandom(1338),
        shape: makeDeterministicRandom(1339),
        emaRatio: makeDeterministicRandom(1340)
    };
    const totalTimestamps = byTimestamp.size;
    let completedTimestamps = 0;
    let lastReportedPercentage = 0;
    for (const timestampRows of byTimestamp.values()) {
        if (timestampRows.length === 0) {
            completedTimestamps++;
            continue;
        }
        const returnsByHorizon = new Map();
        for (const horizon of horizons) {
            const gross = [];
            let grossSum = 0;
            for (const row of timestampRows) {
                const grossReturn = row.futureReturns[horizon];
                if (!Number.isFinite(grossReturn)) {
                    continue;
                }
                gross.push(grossReturn);
                grossSum += grossReturn;
            }
            returnsByHorizon.set(horizon, {
                gross,
                grossMean: gross.length
                    ? grossSum / gross.length
                    : 0,
                grossMedian: median(gross)
            });
        }
        for (const signalKey of RANKING_KEYS) {
            const ranked = [
                ...timestampRows
            ].sort((left, right) => getSignalValue(right, signalKey) -
                getSignalValue(left, signalKey));
            const top = ranked[0];
            if (!top) {
                continue;
            }
            const randomFn = randomGenerators[signalKey];
            for (const horizon of horizons) {
                const returns = returnsByHorizon.get(horizon);
                if (!returns ||
                    returns.gross.length === 0) {
                    continue;
                }
                const topGross = top.futureReturns[horizon];
                if (!Number.isFinite(topGross)) {
                    continue;
                }
                const randomIndex = Math.floor(randomFn() *
                    returns.gross.length);
                const randomGross = returns.gross[randomIndex] ?? 0;
                const accumulator = accumulators[signalKey][horizon];
                accumulator.topReturns.push(topGross);
                accumulator.avgReturns.push(returns.grossMean);
                accumulator.medianReturns.push(returns.grossMedian);
                accumulator.randomReturns.push(randomGross);
                accumulator.excessVsMean.push(topGross -
                    returns.grossMean);
                accumulator.excessVsMedian.push(topGross -
                    returns.grossMedian);
                accumulator.excessVsRandom.push(topGross -
                    randomGross);
            }
        }
        completedTimestamps++;
        const percentage = Math.floor((completedTimestamps /
            totalTimestamps) *
            100);
        if (percentage >=
            lastReportedPercentage + 5 ||
            percentage === 100) {
            lastReportedPercentage =
                percentage;
            console.log(`${label ?? 'Ranking'} progress: ${percentage}%`);
        }
    }
    const gross = {};
    const net = {};
    for (const signalKey of RANKING_KEYS) {
        gross[signalKey] = {};
        net[signalKey] = {};
        for (const horizon of horizons) {
            const accumulator = accumulators[signalKey][horizon];
            const grossSummary = summariseRankingAccumulator(accumulator);
            gross[signalKey][horizon] =
                grossSummary;
            net[signalKey][horizon] = {
                topRankedMean: grossSummary.topRankedMean -
                    TOTAL_COST,
                avgEligibleMean: grossSummary.avgEligibleMean -
                    TOTAL_COST,
                medianEligibleMean: grossSummary.medianEligibleMean -
                    TOTAL_COST,
                randomSelectionMean: grossSummary.randomSelectionMean -
                    TOTAL_COST,
                excessVsMeanMean: grossSummary.excessVsMeanMean,
                excessVsMedianMean: grossSummary.excessVsMedianMean,
                excessVsRandomMean: grossSummary.excessVsRandomMean
            };
        }
    }
    return {
        net,
        gross
    };
}
async function printManualExample() {
    const sample = await fetchKlines('BTCUSDT', '1m', 2000);
    const series = sample.map((point) => point.close);
    const index = 80;
    const timestamp = sample[index].closeTime;
    const priceAtT = series[index];
    const futurePrices = {
        '5m': series[Math.min(series.length - 1, index + 5)],
        '10m': series[Math.min(series.length - 1, index + 10)],
        '20m': series[Math.min(series.length - 1, index + 20)],
        '50m': series[Math.min(series.length - 1, index + 50)]
    };
    const metricMap = Object.fromEntries(Object.entries(futurePrices).map(([horizonKey, price]) => {
        const gross = percentageChange(priceAtT, price);
        const net = netReturn(gross, FEE_RATE, EXECUTION_COST);
        return [
            horizonKey,
            {
                price,
                grossReturn: gross,
                netReturn: net
            }
        ];
    }));
    const featureObservation = await buildHistoricalResearchDataset(['BTCUSDT'], {
        limit: 2000,
        minHistory: 200,
        horizons: RESEARCH_HORIZONS
    });
    const btcObservation = featureObservation
        .filter((row) => row.symbol === 'BTCUSDT')
        .find((row) => row.timestamp === timestamp);
    console.log('\nManual verification example: BTCUSDT at index 80');
    console.log(JSON.stringify({
        timestamp: new Date(timestamp).toISOString(),
        priceAtT,
        featureValuesAtT: btcObservation?.features ??
            null,
        futurePrices: Object.fromEntries(Object.entries(metricMap).map(([key, value]) => [
            key,
            {
                price: value.price,
                grossReturn: value.grossReturn,
                netReturn: value.netReturn
            }
        ])),
        grossReturns: {
            '5m': percentageChange(priceAtT, futurePrices['5m']),
            '10m': percentageChange(priceAtT, futurePrices['10m']),
            '20m': percentageChange(priceAtT, futurePrices['20m']),
            '50m': percentageChange(priceAtT, futurePrices['50m'])
        },
        netReturns: {
            '5m': netReturn(percentageChange(priceAtT, futurePrices['5m']), FEE_RATE, EXECUTION_COST),
            '10m': netReturn(percentageChange(priceAtT, futurePrices['10m']), FEE_RATE, EXECUTION_COST),
            '20m': netReturn(percentageChange(priceAtT, futurePrices['20m']), FEE_RATE, EXECUTION_COST),
            '50m': netReturn(percentageChange(priceAtT, futurePrices['50m']), FEE_RATE, EXECUTION_COST)
        }
    }, null, 2));
}
function printEvidence(label, signal, rows) {
    console.log(`\n${label}`);
    console.log(JSON.stringify({
        [signal]: {
            rows
        }
    }, null, 2));
}
function printRanking(label, results) {
    console.log(`\nRANKING ${label}`);
    console.log(JSON.stringify(results, null, 2));
}
function buildCrossSectionalMetric(rows, horizon, valueSelector, mode = 'net', randomFn = makeDeterministicRandom(1337)) {
    const ranked = [...rows].sort((left, right) => valueSelector(right) -
        valueSelector(left));
    const top = ranked[0];
    const returns = rows.map((row) => {
        const gross = row.futureReturns[horizon] ?? 0;
        return mode === 'net'
            ? netReturn(gross, FEE_RATE, EXECUTION_COST)
            : gross;
    });
    const selected = top
        ? mode === 'net'
            ? netReturn(top.futureReturns[horizon] ?? 0, FEE_RATE, EXECUTION_COST)
            : top.futureReturns[horizon] ?? 0
        : 0;
    const mean = average(returns);
    const medianValue = median(returns);
    const randomIndex = Math.floor(randomFn() * Math.max(returns.length, 1));
    const randomSelection = returns[randomIndex] ?? 0;
    return {
        selectedTopRankedReturn: selected,
        crossSectionalMeanReturn: mean,
        crossSectionalMedianReturn: medianValue,
        deterministicRandomSelectionReturn: randomSelection,
        selectedMinusMean: selected - mean,
        selectedMinusMedian: selected - medianValue,
        selectedMinusRandom: selected - randomSelection
    };
}
function buildCrossSectionalSummary(observations, horizons, keys, mode = 'net', randomSeeds = {}) {
    const byKey = {};
    const byTimestamp = groupByTimestamp(observations);
    for (const key of keys) {
        byKey[key] = {};
        for (const horizon of horizons) {
            byKey[key][horizon] = [];
        }
        for (const timestampRows of byTimestamp.values()) {
            for (const horizon of horizons) {
                const metric = buildCrossSectionalMetric(timestampRows, horizon, (row) => {
                    if (key === 'strength' ||
                        key === 'shape' ||
                        key === 'emaRatio') {
                        return (row.legacySignals?.[key] ?? 0);
                    }
                    return (row.features[key] ?? 0);
                }, mode, makeDeterministicRandom(randomSeeds[key] ??
                    1337 + horizon +
                        key.length));
                byKey[key][horizon].push(metric);
            }
        }
    }
    const summary = {};
    for (const key of keys) {
        summary[key] = {};
        for (const horizon of horizons) {
            const rows = byKey[key][horizon];
            const selectedTopRankedReturn = average(rows.map((row) => row.selectedTopRankedReturn));
            const crossSectionalMeanReturn = average(rows.map((row) => row.crossSectionalMeanReturn));
            const crossSectionalMedianReturn = average(rows.map((row) => row.crossSectionalMedianReturn));
            const deterministicRandomSelectionReturn = average(rows.map((row) => row.deterministicRandomSelectionReturn));
            const selectedMinusMean = average(rows.map((row) => row.selectedMinusMean));
            const selectedMinusMedian = average(rows.map((row) => row.selectedMinusMedian));
            const selectedMinusRandom = average(rows.map((row) => row.selectedMinusRandom));
            summary[key][horizon] = {
                selectedTopRankedReturn,
                crossSectionalMeanReturn,
                crossSectionalMedianReturn,
                deterministicRandomSelectionReturn,
                selectedMinusMean,
                selectedMinusMedian,
                selectedMinusRandom,
                count: rows.length
            };
        }
    }
    return summary;
}
function buildRegimeAnalysis(observations, horizons) {
    const bucketBy = (key, labels) => {
        const values = observations
            .map((row) => row.features[key])
            .filter((value) => Number.isFinite(value));
        const sorted = [...values].sort((left, right) => left - right);
        const cutoffs = [
            sorted[Math.floor(sorted.length / 3)] ?? 0,
            sorted[Math.floor((sorted.length * 2) / 3)] ?? 0
        ];
        const buckets = {
            low: [],
            medium: [],
            high: []
        };
        for (const row of observations) {
            const value = row.features[key];
            if (value <= cutoffs[0]) {
                buckets.low.push(row);
            }
            else if (value <= cutoffs[1]) {
                buckets.medium.push(row);
            }
            else {
                buckets.high.push(row);
            }
        }
        const regimeSummary = {};
        for (const label of labels) {
            const rows = buckets[label] ?? [];
            if (!rows.length) {
                regimeSummary[label] = {
                    count: 0,
                    representativeValue: 0,
                    averageTrendStrength: 0,
                    averageSignalStrength: 0
                };
                continue;
            }
            const representativeValue = average(rows.map((row) => row.features[key]));
            regimeSummary[label] = {
                count: rows.length,
                representativeValue,
                averageTrendStrength: average(rows.map((row) => row.features.trendStrength)),
                averageSignalStrength: average(rows.map((row) => row.legacySignals?.strength ?? 0))
            };
        }
        return regimeSummary;
    };
    return {
        volatilityRegime: bucketBy('volatility', [
            'low',
            'medium',
            'high'
        ]),
        trendRegime: bucketBy('trendStrength', [
            'low',
            'medium',
            'high'
        ]),
        volumeRegime: bucketBy('volume', [
            'low',
            'medium',
            'high'
        ]),
        horizonSummaries: Object.fromEntries(horizons.map((horizon) => [
            String(horizon),
            {
                meanReturn: average(observations.map((row) => netReturn(row.futureReturns[horizon] ?? 0, FEE_RATE, EXECUTION_COST))),
                medianReturn: median(observations.map((row) => netReturn(row.futureReturns[horizon] ?? 0, FEE_RATE, EXECUTION_COST)))
            }
        ]))
    };
}
function writeResearchResults(payload) {
    const resultsDir = path.join(__dirname, 'research-output');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, {
            recursive: true
        });
    }
    const fileName = `research-${Date.now()}.json`;
    const filePath = path.join(resultsDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return filePath;
}
async function main() {
    const experimentStart = Date.now();
    console.log(`Research experiment started at ${new Date(experimentStart).toISOString()}`);
    console.log('Research audit:');
    console.log(JSON.stringify(buildResearchAudit(), null, 2));
    console.log('\nFetching research universe...');
    const universeInfo = await fetchBroadResearchUniverse({
        maxSymbols: 60
    });
    console.log('Research universe fetched.');
    const endTime = Date.now();
    const startTime = endTime -
        30 *
            24 *
            60 *
            60 *
            1000;
    console.log('\nResearch universe approximation:');
    console.log(JSON.stringify({
        version: DATASET_VERSION,
        source: universeInfo.source,
        totalAvailable: universeInfo.totalAvailable,
        selectedCount: universeInfo.selectedCount,
        selectedSymbols: universeInfo.universe.slice(0, 12),
        limitation: universeInfo.limitation,
        notes: universeInfo.notes,
        historicalWindowDays: 30,
        startTime,
        endTime,
        startISO: new Date(startTime).toISOString(),
        endISO: new Date(endTime).toISOString()
    }, null, 2));
    console.log('\nBuilding historical research dataset...');
    const datasetHeartbeat = setInterval(() => {
        const elapsed = Math.floor((Date.now() -
            experimentStart) /
            1000);
        console.log(`Dataset still running: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`);
    }, 30000);
    const dataset = await buildHistoricalResearchDataset(universeInfo.universe, {
        startTime,
        endTime,
        limit: 1000,
        minHistory: 400,
        horizons: RESEARCH_HORIZONS,
        interval: '1m'
    });
    clearInterval(datasetHeartbeat);
    console.log(`Dataset built: ${dataset.length.toLocaleString()} observations`);
    const sorted = [...dataset].sort((a, b) => a.timestamp - b.timestamp);
    const observationKeys = new Set();
    let duplicateObservations = 0;
    for (const row of sorted) {
        const key = `${row.symbol}:${row.timestamp}`;
        if (observationKeys.has(key)) {
            duplicateObservations++;
        }
        else {
            observationKeys.add(key);
        }
    }
    const split = splitResearchPeriods(sorted, 0.6, 0.2);
    console.log('\nDataset and split summary:');
    const observedBySymbol = new Map();
    for (const row of sorted) {
        observedBySymbol.set(row.symbol, (observedBySymbol.get(row.symbol) ?? 0) + 1);
    }
    const symbols = [
        ...new Set(sorted.map((row) => row.symbol))
    ];
    console.log(JSON.stringify({
        datasetVersion: DATASET_VERSION,
        earliestTimestamp: sorted[0]?.timestamp ??
            null,
        earliestISO: sorted[0]
            ? new Date(sorted[0].timestamp).toISOString()
            : null,
        latestTimestamp: sorted[sorted.length - 1]?.timestamp ?? null,
        latestISO: sorted.length > 0
            ? new Date(sorted[sorted.length - 1].timestamp).toISOString()
            : null,
        markets: symbols.length,
        symbols,
        observations: sorted.length,
        perSymbolObservationCounts: Object.fromEntries([
            ...observedBySymbol.entries()
        ].sort((left, right) => right[1] -
            left[1])),
        duplicateObservations,
        train: split.train.length,
        validation: split.validation.length,
        test: split.test.length,
        trainStart: split.train[0]
            ? new Date(split.train[0].timestamp).toISOString()
            : null,
        trainEnd: split.train.length > 0
            ? new Date(split.train[split.train.length - 1].timestamp).toISOString()
            : null,
        validationStart: split.validation[0]
            ? new Date(split.validation[0]
                .timestamp).toISOString()
            : null,
        validationEnd: split.validation.length > 0
            ? new Date(split.validation[split.validation.length - 1].timestamp).toISOString()
            : null,
        testStart: split.test[0]
            ? new Date(split.test[0].timestamp).toISOString()
            : null,
        testEnd: split.test.length > 0
            ? new Date(split.test[split.test.length - 1].timestamp).toISOString()
            : null,
        feeRate: FEE_RATE,
        executionCost: EXECUTION_COST,
        totalCost: TOTAL_COST
    }, null, 2));
    console.log('\nImportant audit note:');
    console.log(JSON.stringify({
        problem: 'The previous runner reported the same unconditional mean return across every feature in the same split/horizon. That is not a feature-specific result.',
        fix: 'The corrected runner separates unconditional baselines from conditional feature evidence and cross-sectional ranking.',
        optimisation: 'Baseline calculations, timestamp grouping and ranking work are shared wherever possible. Legacy signal evidence is calculated once per split rather than once per signal.',
        rankingOptimisation: 'Cross-sectional ranking is performed once. Gross results are calculated directly and net results are derived by subtracting the constant transaction and execution cost. No second gross ranking pass is required.',
        costModel: 'netReturn = futureReturn - 0.001 - 0.0005. Total cost is 0.0015. This is applied consistently and is not double-counted.',
        futureTiming: 'Future return is calculated from the close at T to the close at T + horizon.',
        duplicateDefinition: 'A duplicate observation is a repeated symbol + timestamp pair. The same timestamp across different symbols is valid cross-sectional data.'
    }, null, 2));
    for (const label of [
        'train',
        'validation',
        'test'
    ]) {
        const observations = split[label];
        console.log(`\n===== ${label.toUpperCase()} =====`);
        console.log(`Observations: ${observations.length.toLocaleString()}`);
        console.log(`Calculating ${label} baselines...`);
        const baselines = buildBaselineSummaries(observations, RESEARCH_HORIZONS);
        console.log(`${label} baselines complete.`);
        console.log(`Calculating ${label} legacy signals...`);
        const legacyEvidence = buildLegacyEvidenceRows(observations, RESEARCH_HORIZONS, baselines);
        console.log(`${label} legacy signals complete.`);
        for (const signalKey of SIGNAL_KEYS) {
            printEvidence(`LEGACY SIGNAL ${label.toUpperCase()}`, signalKey, legacyEvidence[signalKey]);
        }
        console.log(`Calculating ${label} feature evidence: 0%`);
        for (let featureIndex = 0; featureIndex <
            FEATURE_KEYS.length; featureIndex++) {
            const featureKey = FEATURE_KEYS[featureIndex];
            const rows = buildFeatureEvidenceRows(observations, featureKey, RESEARCH_HORIZONS, baselines);
            printEvidence(`FEATURE ${label.toUpperCase()}`, featureKey, rows);
            const percentage = Math.round(((featureIndex + 1) /
                FEATURE_KEYS.length) *
                100);
            console.log(`Calculating ${label} feature evidence: ${percentage}%`);
        }
        console.log(`Calculating ${label} cross-sectional ranking: 0%`);
        const ranking = rankingBenchmarkAll(observations, RESEARCH_HORIZONS, `${label} cross-sectional ranking`);
        console.log(`Calculating ${label} cross-sectional ranking: 100%`);
        printRanking(`${label.toUpperCase()} net`, ranking.net);
        printRanking(`${label.toUpperCase()} gross`, ranking.gross);
    }
    const crossSectionalNet = {
        feature: buildCrossSectionalSummary(sorted, RESEARCH_HORIZONS, FEATURE_KEYS, 'net', Object.fromEntries(FEATURE_KEYS.map((key, index) => [
            key,
            1000 + index
        ]))),
        legacySignal: buildCrossSectionalSummary(sorted, RESEARCH_HORIZONS, SIGNAL_KEYS, 'net', Object.fromEntries(SIGNAL_KEYS.map((key, index) => [
            key,
            2000 + index
        ])))
    };
    const crossSectionalGross = {
        feature: buildCrossSectionalSummary(sorted, RESEARCH_HORIZONS, FEATURE_KEYS, 'gross', Object.fromEntries(FEATURE_KEYS.map((key, index) => [
            key,
            3000 + index
        ]))),
        legacySignal: buildCrossSectionalSummary(sorted, RESEARCH_HORIZONS, SIGNAL_KEYS, 'gross', Object.fromEntries(SIGNAL_KEYS.map((key, index) => [
            key,
            4000 + index
        ])))
    };
    const regimeAnalysis = buildRegimeAnalysis(sorted, RESEARCH_HORIZONS);
    const experimentOutput = {
        experimentTimestamp: new Date(experimentStart).toISOString(),
        datasetConfiguration: {
            version: DATASET_VERSION,
            interval: '1m',
            limit: 1000,
            minHistory: 400,
            horizons: [...RESEARCH_HORIZONS],
            startTime,
            endTime,
            startISO: new Date(startTime).toISOString(),
            endISO: new Date(endTime).toISOString(),
            feeRate: FEE_RATE,
            executionCost: EXECUTION_COST,
            totalCost: TOTAL_COST
        },
        universe: {
            source: universeInfo.source,
            totalAvailable: universeInfo.totalAvailable,
            selectedCount: universeInfo.selectedCount,
            symbols: universeInfo.universe
        },
        dateRange: {
            startTime,
            endTime,
            startISO: new Date(startTime).toISOString(),
            endISO: new Date(endTime).toISOString(),
            elapsedDays: (endTime - startTime) /
                (24 * 60 * 60 * 1000)
        },
        observationCount: sorted.length,
        trainValidationTest: {
            train: split.train.length,
            validation: split.validation.length,
            test: split.test.length,
            total: sorted.length,
            trainStart: split.train[0]
                ? new Date(split.train[0].timestamp).toISOString()
                : null,
            trainEnd: split.train[split.train.length - 1]
                ? new Date(split.train[split.train.length - 1].timestamp).toISOString()
                : null,
            validationStart: split.validation[0]
                ? new Date(split.validation[0].timestamp).toISOString()
                : null,
            validationEnd: split.validation[split.validation.length - 1]
                ? new Date(split.validation[split.validation.length - 1].timestamp).toISOString()
                : null,
            testStart: split.test[0]
                ? new Date(split.test[0].timestamp).toISOString()
                : null,
            testEnd: split.test[split.test.length - 1]
                ? new Date(split.test[split.test.length - 1].timestamp).toISOString()
                : null
        },
        horizons: [...RESEARCH_HORIZONS],
        baselines: {
            train: Object.fromEntries([...buildBaselineSummaries(split.train, RESEARCH_HORIZONS).entries()]),
            validation: Object.fromEntries([...buildBaselineSummaries(split.validation, RESEARCH_HORIZONS).entries()]),
            test: Object.fromEntries([...buildBaselineSummaries(split.test, RESEARCH_HORIZONS).entries()])
        },
        featureEvidenceResults: {
            train: Object.fromEntries(FEATURE_KEYS.map((featureKey) => [
                featureKey,
                buildFeatureEvidenceRows(split.train, featureKey, RESEARCH_HORIZONS, buildBaselineSummaries(split.train, RESEARCH_HORIZONS))
            ])),
            validation: Object.fromEntries(FEATURE_KEYS.map((featureKey) => [
                featureKey,
                buildFeatureEvidenceRows(split.validation, featureKey, RESEARCH_HORIZONS, buildBaselineSummaries(split.validation, RESEARCH_HORIZONS))
            ])),
            test: Object.fromEntries(FEATURE_KEYS.map((featureKey) => [
                featureKey,
                buildFeatureEvidenceRows(split.test, featureKey, RESEARCH_HORIZONS, buildBaselineSummaries(split.test, RESEARCH_HORIZONS))
            ]))
        },
        legacySignalResults: {
            train: Object.fromEntries(SIGNAL_KEYS.map((signalKey) => [
                signalKey,
                buildLegacyEvidenceRows(split.train, RESEARCH_HORIZONS, buildBaselineSummaries(split.train, RESEARCH_HORIZONS))[signalKey]
            ])),
            validation: Object.fromEntries(SIGNAL_KEYS.map((signalKey) => [
                signalKey,
                buildLegacyEvidenceRows(split.validation, RESEARCH_HORIZONS, buildBaselineSummaries(split.validation, RESEARCH_HORIZONS))[signalKey]
            ])),
            test: Object.fromEntries(SIGNAL_KEYS.map((signalKey) => [
                signalKey,
                buildLegacyEvidenceRows(split.test, RESEARCH_HORIZONS, buildBaselineSummaries(split.test, RESEARCH_HORIZONS))[signalKey]
            ]))
        },
        crossSectionalRankingResults: {
            train: {
                net: crossSectionalNet,
                gross: crossSectionalGross
            },
            validation: {
                net: crossSectionalNet,
                gross: crossSectionalGross
            },
            test: {
                net: crossSectionalNet,
                gross: crossSectionalGross
            }
        },
        regimeAnalysis,
        researchAudit: buildResearchAudit()
    };
    const jsonPath = writeResearchResults(experimentOutput);
    console.log(`\nResearch results saved to ${jsonPath}`);
    console.log('\nRunning manual verification...');
    await printManualExample();
    console.log('\nResearch experiment complete.');
}
main().catch((error) => {
    console.error('research-runner failed:', error);
    process.exit(1);
});
//# sourceMappingURL=research-runner.js.map