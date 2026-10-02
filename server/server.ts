import dotenv from 'dotenv';
import { Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatNumber, position, market, indexedFrame } from '@magic-money-tree/shared'
import { accelerationThreshold, local, LONG_SLOPE, MAX_CONCURRENT_POSITIONS, MINIMUM_POSITION_NOTIONAL, POSITION_PERCENTAGE, SHORT_SLOPE, slopeThreshold, stopLossThreshold, targets } from './config';
import { state } from './state'
import { pullFromDatabase, saveState, setUpDB } from './database';
import { Log, rawFrame, transaction } from './shared.types';
import { fetchPrice, fetchSingleHistory, fetchSymbols } from './binance';
import { logEntry } from './utils/logging';
import { getCashBalance, timeNow } from './shared.functions';
import { tick } from './tradingLoop';
import { configureApi } from './api';

dotenv.config();

const {  
  markets,  
  portfolioHistory,
  log
} = state

let {
  currentTask,
  wallet,
  marketList,
  tradingMode,
  viableSymbols,
  trading,
  symbolIndex,
} = state

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
    viableSymbols = await fetchSymbols() as string[];   
    await pullFromDatabase(wallet, log, viableSymbols);

    logEntry(
      
      `Loaded simulated wallet: $${formatNumber(getCashBalance(wallet), 2)} cash, ${wallet.data.positions.length} open positions`
    );

    trading = true;
    tick();

  } catch (error: any) {
    console.log(error.message);
  }
}

run();

export {}