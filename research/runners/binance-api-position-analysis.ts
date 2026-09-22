import fs from 'node:fs'
import path from 'node:path'

interface JsonObject {
  [key: string]: unknown
}

interface BinanceSymbol extends JsonObject {
  symbol: string
}

interface ExchangeInfoResponse {
  symbols: BinanceSymbol[]
  [key: string]: unknown
}

interface StrategyMarket extends JsonObject {
  symbol: string
  netProfit?: number
  returnPct?: number
}

interface StrategyFile extends JsonObject {
  sample: {
    markets: StrategyMarket[]
  }
  outOfSample: {
    markets: StrategyMarket[]
  }
}

interface OutputRow {
  symbol: string
  datasetGroup: 'Sample' | 'OOS'
  apiPosition: number
  profitability: number | null
  returnPct: number | null
  [key: string]: unknown
}

interface NumericPositionResult {
  field: string
  count: number
  uniqueValues: number
  pearsonWithApiPosition: number | null
  spearmanWithApiPosition: number | null
  adjacentMonotonicity: number | null
  direction: 'increasing' | 'decreasing' | 'none'
  rankBands: Array<{
    band: string
    count: number
    mean: number | null
    median: number | null
  }>
}

const INPUT =
  process.env.INPUT ??
  'research/output/market-strategy-ranking-independent-1789232701426.json'

const OUTPUT_DIR =
  process.env.OUTPUT_DIR ??
  'research/output'

const BINANCE_ENDPOINT =
  'https://api.binance.com/api/v3/exchangeInfo'

function readJson(filePath: string): StrategyFile {
  return JSON.parse(
    fs.readFileSync(filePath, 'utf8'),
  ) as StrategyFile
}

async function fetchExchangeInfo(): Promise<{
  data: ExchangeInfoResponse
  fetchedAt: string
}> {
  const fetchedAt = new Date().toISOString()

  console.log(
    `Fetching Binance exchangeInfo at ${fetchedAt}...`,
  )

  const response = await fetch(BINANCE_ENDPOINT)

  if (!response.ok) {
    throw new Error(
      `Binance exchangeInfo failed: ${response.status} ${response.statusText}`,
    )
  }

  const data =
    (await response.json()) as ExchangeInfoResponse

  return {
    data,
    fetchedAt,
  }
}

function writeRawSnapshot(
  exchangeInfo: ExchangeInfoResponse,
  fetchedAt: string,
  outputDir: string,
): string {
  const timestamp =
    fetchedAt
      .replaceAll(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')

  const fileName =
    `binance-exchange-info-${timestamp}.json`

  const filePath =
    path.resolve(outputDir, fileName)

  /*
   * Do not overwrite an existing snapshot.
   *
   * This is intentional: every analysis run must have an
   * immutable record of exactly which Binance response it used.
   */
  if (fs.existsSync(filePath)) {
    throw new Error(
      `Refusing to overwrite existing Binance snapshot: ${filePath}`,
    )
  }

  fs.mkdirSync(outputDir, {
    recursive: true,
  })

  fs.writeFileSync(
    filePath,
    `${JSON.stringify(exchangeInfo, null, 2)}\n`,
  )

  return filePath
}

function csvEscape(value: unknown): string {
  if (
    value === null ||
    value === undefined
  ) {
    return ''
  }

  let text: string

  if (typeof value === 'string') {
    text = value
  } else {
    const serialised =
      JSON.stringify(value)

    text =
      serialised === undefined
        ? ''
        : serialised
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

function flattenObject(
  value: JsonObject,
  prefix: string,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (
    const [key, child] of Object.entries(value)
  ) {
    const name = `${prefix}.${key}`

    if (Array.isArray(child)) {
      output[name] =
        JSON.stringify(child)

      continue
    }

    if (
      child &&
      typeof child === 'object'
    ) {
      Object.assign(
        output,
        flattenObject(
          child as JsonObject,
          name,
        ),
      )

      continue
    }

    output[name] = child
  }

  return output
}

function flattenBinance(
  binance: BinanceSymbol,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (
    const [key, value] of Object.entries(binance)
  ) {
    if (
      key === 'filters' &&
      Array.isArray(value)
    ) {
      for (const filter of value) {
        if (
          !filter ||
          typeof filter !== 'object'
        ) {
          continue
        }

        const filterObject =
          filter as JsonObject

        const filterType =
          String(
            filterObject.filterType ??
              'UNKNOWN',
          )

        for (
          const [
            filterKey,
            filterValue,
          ] of Object.entries(
            filterObject,
          )
        ) {
          if (
            filterKey === 'filterType'
          ) {
            continue
          }

          output[
            `filters.${filterType}.${filterKey}`
          ] = filterValue
        }
      }

      /*
       * Preserve the complete filters array as well.
       * This means the CSV contains both:
       *
       *   filters.LOT_SIZE.maxQty
       *
       * and:
       *
       *   filters
       */
      output.filters =
        JSON.stringify(value)

      continue
    }

    if (Array.isArray(value)) {
      output[key] =
        JSON.stringify(value)

      continue
    }

    if (
      value &&
      typeof value === 'object'
    ) {
      Object.assign(
        output,
        flattenObject(
          value as JsonObject,
          key,
        ),
      )

      continue
    }

    output[key] = value
  }

  return output
}

function rank(
  values: number[],
): number[] {
  const indexed = values
    .map((value, index) => ({
      value,
      index,
    }))
    .sort(
      (a, b) =>
        a.value - b.value,
    )

  const ranks =
    new Array<number>(
      values.length,
    )

  let start = 0

  while (
    start < indexed.length
  ) {
    let end = start + 1

    while (
      end < indexed.length &&
      indexed[end].value ===
        indexed[start].value
    ) {
      end++
    }

    const averageRank =
      (start + 1 + end) / 2

    for (
      let i = start;
      i < end;
      i++
    ) {
      ranks[
        indexed[i].index
      ] = averageRank
    }

    start = end
  }

  return ranks
}

function pearson(
  x: number[],
  y: number[],
): number | null {
  if (
    x.length < 2 ||
    x.length !== y.length
  ) {
    return null
  }

  const meanX =
    x.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / x.length

  const meanY =
    y.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / y.length

  let numerator = 0
  let denominatorX = 0
  let denominatorY = 0

  for (
    let i = 0;
    i < x.length;
    i++
  ) {
    const dx =
      x[i] - meanX

    const dy =
      y[i] - meanY

    numerator += dx * dy
    denominatorX +=
      dx * dx
    denominatorY +=
      dy * dy
  }

  if (
    denominatorX === 0 ||
    denominatorY === 0
  ) {
    return null
  }

  return (
    numerator /
    Math.sqrt(
      denominatorX *
        denominatorY,
    )
  )
}

function spearman(
  x: number[],
  y: number[],
): number | null {
  if (
    x.length < 2 ||
    x.length !== y.length
  ) {
    return null
  }

  return pearson(
    rank(x),
    rank(y),
  )
}

function numericValues(
  rows: OutputRow[],
  field: string,
): Array<{
  position: number
  value: number
}> {
  const values: Array<{
    position: number
    value: number
  }> = []

  for (const row of rows) {
    const raw =
      row[field]

    if (
      typeof raw === 'number' &&
      Number.isFinite(raw)
    ) {
      values.push({
        position:
          row.apiPosition,
        value: raw,
      })

      continue
    }

    if (
      typeof raw === 'string' &&
      raw.trim() !== ''
    ) {
      const parsed =
        Number(raw)

      if (
        Number.isFinite(parsed)
      ) {
        values.push({
          position:
            row.apiPosition,
          value: parsed,
        })
      }
    }
  }

  return values
}

function adjacentMonotonicity(
  values: Array<{
    position: number
    value: number
  }>,
): {
  score: number | null
  direction:
    | 'increasing'
    | 'decreasing'
    | 'none'
} {
  if (values.length < 2) {
    return {
      score: null,
      direction: 'none',
    }
  }

  const ordered =
    [...values].sort(
      (a, b) =>
        a.position -
        b.position,
    )

  let direction: 1 | -1 | 0 = 0

  for (
    let i = 1;
    i < ordered.length;
    i++
  ) {
    const delta =
      ordered[i].value -
      ordered[i - 1].value

    if (delta !== 0) {
      direction =
        delta > 0 ? 1 : -1

      break
    }
  }

  if (direction === 0) {
    return {
      score: 1,
      direction: 'none',
    }
  }

  let comparable = 0
  let matching = 0

  for (
    let i = 1;
    i < ordered.length;
    i++
  ) {
    const delta =
      ordered[i].value -
      ordered[i - 1].value

    if (delta === 0) {
      continue
    }

    comparable++

    const stepDirection =
      delta > 0 ? 1 : -1

    if (
      stepDirection ===
      direction
    ) {
      matching++
    }
  }

  return {
    score:
      comparable === 0
        ? null
        : matching /
          comparable,

    direction:
      direction === 1
        ? 'increasing'
        : 'decreasing',
  }
}

function median(
  values: number[],
): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted =
    [...values].sort(
      (a, b) =>
        a - b,
    )

  const middle =
    Math.floor(
      sorted.length / 2,
    )

  if (
    sorted.length % 2 ===
    1
  ) {
    return sorted[middle]
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2
}

function rankBands(
  rows: OutputRow[],
  field: string,
): Array<{
  band: string
  count: number
  mean: number | null
  median: number | null
}> {
  const bands = [
    [1, 20],
    [21, 40],
    [41, 60],
    [61, 80],
    [81, 100],
    [101, 120],
  ]

  return bands.map(
    ([minimum, maximum]) => {
      const values =
        numericValues(
          rows.filter(
            row =>
              row.apiPosition >=
                minimum &&
              row.apiPosition <=
                maximum,
          ),
          field,
        ).map(
          item => item.value,
        )

      return {
        band:
          `${minimum}-${maximum}`,

        count:
          values.length,

        mean:
          values.length === 0
            ? null
            : values.reduce(
                (
                  sum,
                  value,
                ) =>
                  sum + value,
                0,
              ) /
              values.length,

        median:
          median(values),
      }
    },
  )
}

function getAllFields(
  rows: OutputRow[],
): string[] {
  const excluded =
    new Set([
      'symbol',
      'datasetGroup',
      'apiPosition',
      'profitability',
      'returnPct',
    ])

  return [
    ...new Set(
      rows.flatMap(
        row =>
          Object.keys(row),
      ),
    ),
  ]
    .filter(
      field =>
        !excluded.has(field),
    )
    .sort()
}

function buildRows(
  strategy: StrategyFile,
  exchangeInfo: ExchangeInfoResponse,
): OutputRow[] {
  const profitability =
    new Map<
      string,
      {
        datasetGroup:
          | 'Sample'
          | 'OOS'
        netProfit:
          | number
          | null
        returnPct:
          | number
          | null
      }
    >()

  for (
    const market of
      strategy.sample.markets
  ) {
    profitability.set(
      market.symbol,
      {
        datasetGroup:
          'Sample',

        netProfit:
          typeof market.netProfit ===
          'number'
            ? market.netProfit
            : null,

        returnPct:
          typeof market.returnPct ===
          'number'
            ? market.returnPct
            : null,
      },
    )
  }

  for (
    const market of
      strategy.outOfSample.markets
  ) {
    profitability.set(
      market.symbol,
      {
        datasetGroup:
          'OOS',

        netProfit:
          typeof market.netProfit ===
          'number'
            ? market.netProfit
            : null,

        returnPct:
          typeof market.returnPct ===
          'number'
            ? market.returnPct
            : null,
      },
    )
  }

  const rows: OutputRow[] = []

  for (
    let index = 0;
    index <
    exchangeInfo.symbols.length;
    index++
  ) {
    const symbol =
      exchangeInfo.symbols[
        index
      ]

    const result =
      profitability.get(
        symbol.symbol,
      )

    if (!result) {
      continue
    }

    rows.push({
      symbol:
        symbol.symbol,

      datasetGroup:
        result.datasetGroup,

      apiPosition:
        index + 1,

      profitability:
        result.netProfit,

      returnPct:
        result.returnPct,

      ...flattenBinance(
        symbol,
      ),
    })
  }

  const expectedSymbols =
    profitability.size

  if (
    rows.length !==
    expectedSymbols
  ) {
    const found =
      new Set(
        rows.map(
          row => row.symbol,
        ),
      )

    const missing = [
      ...profitability.keys(),
    ].filter(
      symbol =>
        !found.has(symbol),
    )

    throw new Error(
      [
        `Only found ${rows.length}/${expectedSymbols} strategy markets in current Binance exchangeInfo.`,
        `Missing: ${missing.join(', ')}`,
      ].join(' '),
    )
  }

  return rows
}

function writeCsv(
  rows: OutputRow[],
  filePath: string,
): void {
  const fields =
    getAllFields(rows)

  const headers = [
    'symbol',
    'datasetGroup',
    'apiPosition',
    'profitability',
    'returnPct',
    ...fields,
  ]

  const lines = [
    headers
      .map(csvEscape)
      .join(','),
  ]

  for (const row of rows) {
    lines.push(
      headers
        .map(header =>
          csvEscape(
            row[header],
          ),
        )
        .join(','),
    )
  }

  fs.mkdirSync(
    path.dirname(filePath),
    { recursive: true },
  )

  fs.writeFileSync(
    filePath,
    `${lines.join('\n')}\n`,
  )
}

function analyseNumericFields(
  rows: OutputRow[],
): NumericPositionResult[] {
  const fields =
    getAllFields(rows)

  return fields
    .map(field => {
      const values =
        numericValues(
          rows,
          field,
        )

      const numbers =
        values.map(
          item => item.value,
        )

      const positions =
        values.map(
          item =>
            item.position,
        )

      const uniqueValues =
        new Set(numbers).size

      const monotonic =
        adjacentMonotonicity(
          values,
        )

      return {
        field,

        count:
          values.length,

        uniqueValues,

        pearsonWithApiPosition:
          pearson(
            positions,
            numbers,
          ),

        spearmanWithApiPosition:
          spearman(
            positions,
            numbers,
          ),

        adjacentMonotonicity:
          monotonic.score,

        direction:
          monotonic.direction,

        rankBands:
          rankBands(
            rows,
            field,
          ),
      }
    })
    .filter(
      result =>
        result.count >= 10 &&
        result.uniqueValues >= 2,
    )
    .sort(
      (a, b) =>
        Math.abs(
          b.spearmanWithApiPosition ??
            0,
        ) -
        Math.abs(
          a.spearmanWithApiPosition ??
            0,
        ),
    )
}

function analyseCategoricalFields(
  rows: OutputRow[],
): Array<{
  field: string
  count: number
  uniqueValues: number
  values: Array<{
    value: string
    count: number
    meanApiPosition: number
  }>
}> {
  return getAllFields(rows)
    .map(field => {
      const groups =
        new Map<
          string,
          number[]
        >()

      for (const row of rows) {
        const value =
          row[field]

        if (
          value ===
            undefined ||
          value === null ||
          value === ''
        ) {
          continue
        }

        const key =
          String(value)

        const existing =
          groups.get(key) ??
          []

        existing.push(
          row.apiPosition,
        )

        groups.set(
          key,
          existing,
        )
      }

      return {
        field,

        count: [
          ...groups.values(),
        ].reduce(
          (
            sum,
            positions,
          ) =>
            sum +
            positions.length,
          0,
        ),

        uniqueValues:
          groups.size,

        values: [
          ...groups.entries(),
        ]
          .map(
            ([
              value,
              positions,
            ]) => ({
              value,
              count:
                positions.length,

              meanApiPosition:
                positions.reduce(
                  (
                    sum,
                    position,
                  ) =>
                    sum +
                    position,
                  0,
                ) /
                positions.length,
            }),
          )
          .sort(
            (a, b) =>
              b.count -
              a.count,
          ),
      }
    })
    .filter(
      result =>
        result.count >= 10 &&
        result.uniqueValues <=
          20,
    )
}

function analysePositionProfitability(
  rows: OutputRow[],
): {
  pearson: number | null
  spearman: number | null
} {
  const valid =
    rows.filter(
      row =>
        row.profitability !==
        null,
    )

  const positions =
    valid.map(
      row =>
        row.apiPosition,
    )

  const profits =
    valid.map(
      row =>
        row.profitability as number,
    )

  return {
    pearson:
      pearson(
        positions,
        profits,
      ),

    spearman:
      spearman(
        positions,
        profits,
      ),
  }
}

function timestampForFileName(
  date: Date,
): string {
  return date
    .toISOString()
    .replaceAll(
      /[-:]/g,
      '',
    )
    .replace(
      /\.\d{3}Z$/,
      'Z',
    )
}

async function main(): Promise<void> {
  console.log(
    '============================================================',
  )
  console.log(
    'Binance API field vs exchangeInfo array position analysis',
  )
  console.log(
    '============================================================',
  )

  console.log(
    `Strategy input: ${INPUT}`,
  )

  console.log(
    `Binance endpoint: ${BINANCE_ENDPOINT}`,
  )

  const strategy =
    readJson(
      path.resolve(INPUT),
    )

  /*
   * This is the ONLY live Binance request made by this runner.
   *
   * No candle data, klines, trades, prices or market history
   * are fetched.
   */
  const {
    data: exchangeInfo,
    fetchedAt,
  } =
    await fetchExchangeInfo()

  console.log(
    `Binance returned ${exchangeInfo.symbols.length} symbols.`,
  )

  /*
   * Save the raw response BEFORE analysis.
   *
   * This snapshot is the authoritative record for this run.
   */
  const snapshotPath =
    writeRawSnapshot(
      exchangeInfo,
      fetchedAt,
      OUTPUT_DIR,
    )

  console.log(
    `Raw Binance snapshot: ${snapshotPath}`,
  )

  const rows =
    buildRows(
      strategy,
      exchangeInfo,
    )

  console.log(
    `Matched ${rows.length} strategy markets.`,
  )

  const timestamp =
    timestampForFileName(
      new Date(fetchedAt),
    )

  const csvPath =
    path.resolve(
      OUTPUT_DIR,
      `binance-api-position-analysis-120-${timestamp}.csv`,
    )

  const jsonPath =
    path.resolve(
      OUTPUT_DIR,
      `binance-api-position-analysis-120-${timestamp}.json`,
    )

  writeCsv(
    rows,
    csvPath,
  )

  const numericFields =
    analyseNumericFields(
      rows,
    )

  const categoricalFields =
    analyseCategoricalFields(
      rows,
    )

  const positionProfitability =
    analysePositionProfitability(
      rows,
    )

  const output = {
    generatedAt:
      new Date().toISOString(),

    exchangeInfoSnapshot: {
      fetchedAt,

      endpoint:
        BINANCE_ENDPOINT,

      symbolCount:
        exchangeInfo.symbols.length,

      rawSnapshot:
        path.relative(
          process.cwd(),
          snapshotPath,
        ),
    },

    source: {
      strategyFile:
        INPUT,

      matchedMarketCount:
        rows.length,
    },

    definition: {
      apiPosition:
        '1-based position in the exact Binance exchangeInfo.symbols[] response saved in exchangeInfoSnapshot.rawSnapshot.',

      profitability:
        'Strategy market netProfit from the frozen independent 60 + 60 market analysis.',

      spearman:
        'Monotonic relationship between API array position and a numeric Binance field.',

      pearson:
        'Linear relationship between API array position and a numeric Binance field.',

      adjacentMonotonicity:
        'Fraction of non-equal adjacent values moving consistently in the dominant direction.',
    },

    positionVsProfitability:
      positionProfitability,

    numericFields,

    categoricalFields,

    csv:
      path.relative(
        process.cwd(),
        csvPath,
      ),
  }

  fs.mkdirSync(
    path.dirname(jsonPath),
    { recursive: true },
  )

  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(output, null, 2)}\n`,
  )

  console.log('')
  console.log(
    '============================================================',
  )
  console.log(
    'RESULTS',
  )
  console.log(
    '============================================================',
  )

  console.log(
    `Raw snapshot : ${snapshotPath}`,
  )

  console.log(
    `CSV          : ${csvPath}`,
  )

  console.log(
    `Analysis JSON: ${jsonPath}`,
  )

  console.log('')
  console.log(
    'Position vs profitability:',
  )

  console.log(
    `  Pearson : ${positionProfitability.pearson}`,
  )

  console.log(
    `  Spearman: ${positionProfitability.spearman}`,
  )

  console.log('')
  console.log(
    'Top Binance API fields by absolute Spearman:',
  )

  for (
    const result of
      numericFields.slice(
        0,
        25,
      )
  ) {
    console.log(
      [
        result.field.padEnd(
          60,
        ),

        `Spearman=${result.spearmanWithApiPosition?.toFixed(4) ?? 'null'}`,

        `Pearson=${result.pearsonWithApiPosition?.toFixed(4) ?? 'null'}`,

        `Monotonic=${result.adjacentMonotonicity?.toFixed(3) ?? 'null'}`,

        `Direction=${result.direction}`,

        `Unique=${result.uniqueValues}`,
      ].join('  '),
    )
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})