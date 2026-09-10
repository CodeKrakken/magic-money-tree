import fs from 'fs';
import path from 'path';
import { fetchBroadResearchUniverse, fetchKlinesInRange } from './research';
import { fileURLToPath } from 'url';


export async function fetchAndSaveResearchData(): Promise<string> {
  const startTime = Date.now();
  const endTime = Date.now();
  const historyStartTime =
    endTime - 30 * 24 * 60 * 60 * 1000;

  console.log(
    `Fetching research data from ${new Date(
      historyStartTime
    ).toISOString()} to ${new Date(
      endTime
    ).toISOString()}`
  );

  const universeInfo = await fetchBroadResearchUniverse({
    maxSymbols: 60,
  });

  console.log(
    `Research universe: ${universeInfo.selectedCount} markets`
  );

  const markets = [];

  for (const symbol of universeInfo.universe) {
    console.log(`Fetching ${symbol}...`);

    try {
      const klines = await fetchKlinesInRange(
        symbol,
        '1m',
        historyStartTime,
        endTime,
        1000
      );

      markets.push({
        symbol,
        candles: klines.map((kline) => ({
          openTime: kline.openTime,
          closeTime: kline.closeTime,
          open: kline.open,
          high: kline.high,
          low: kline.low,
          close: kline.close,
          volume: kline.volume,
        })),
      });

      console.log(
        `${symbol}: ${klines.length} candles`
      );
    } catch (error) {
      console.error(
        `Failed to fetch ${symbol}:`,
        error
      );
    }
  }

  const outputDirectory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'research-output'
  );

  fs.mkdirSync(outputDirectory, {
    recursive: true,
  });

  const outputPath = path.join(
    outputDirectory,
    `ema-data-${startTime}.json`
  );

  const dataset = {
    version: 1,
    interval: '1m',
    startTime: historyStartTime,
    endTime,
    markets,
  };

  fs.writeFileSync(
    outputPath,
    JSON.stringify(dataset),
    'utf8'
  );

  console.log(
    `Research data saved to ${outputPath}`
  );

  console.log(
    `Markets saved: ${markets.length}`
  );

  console.log(
    `Total candles saved: ${markets.reduce(
      (total, market) =>
        total + market.candles.length,
      0
    )}`
  );

  return outputPath;
}

fetchAndSaveResearchData()
  .then((outputPath) => {
    console.log(`Done: ${outputPath}`);
  })
  .catch((error) => {
    console.error('Research data fetch failed:', error);
    process.exit(1);
  });
