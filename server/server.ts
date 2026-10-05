import { Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatNumber, position, market, indexedFrame } from '@magic-money-tree/shared'
import { accelerationThreshold, local, LONG_SLOPE, MAX_CONCURRENT_POSITIONS, MINIMUM_POSITION_NOTIONAL, POSITION_PERCENTAGE, SHORT_SLOPE, slopeThreshold, stopLossThreshold, targets } from './config.js';
import { state } from './state.js'
import { pullFromDatabase, saveState, setUpDB } from './database.js';
import { Log, rawFrame, transaction } from './shared.types.js';
import { fetchPrice, fetchSingleHistory, fetchSymbols } from './binance.js';
import { logEntry } from './utils/logging.js';
import { getCashBalance, timeNow } from './shared.functions.js';
import { tick } from './tradingLoop.js';
import { configureApi } from './api.js';
import dotenv from 'dotenv';

dotenv.config();

// Server

export const app = express();

app.use(express.json());
app.use(local ? cors({ origin: 'http://localhost:3000' }) : cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!local) app.use(express.static(path.join(__dirname, "../../client/build")));

configureApi(app);

const port = process.env.PORT || 5000;

app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
});

async function run() {
  logEntry(`Running at ${timeNow()}`);
  logEntry(`Server is ${process.env.ENVIRONMENT}`);
  logEntry(`
    Strategy: slope/acceleration portfolio | 
    ${MAX_CONCURRENT_POSITIONS} positions | 
    ${POSITION_PERCENTAGE * 100}% available cash per position | 
    $${MINIMUM_POSITION_NOTIONAL} minimum
  `);

  try {
    logEntry('Setting up database ...');    
    await setUpDB();
    logEntry('Fetching market data ...');
    state.viableSymbols = await fetchSymbols() as string[];   
    await pullFromDatabase();



    logEntry(
      
      `Loaded simulated wallet: $${formatNumber(getCashBalance(state.wallet), 2)} cash, ${state.wallet.data.positions.length} open positions`
    );

    state.trading = true;
    tick();

  } catch (error: any) {
    console.log(error.message);
  }
}

run();

export {}