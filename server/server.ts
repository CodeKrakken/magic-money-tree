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

const app = express();

app.use(express.json());
app.use(local ? cors({ origin: 'http://localhost:3000' }) : cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!local) app.use(express.static(path.join(__dirname, "../../client/build")));

app.get("/data", (req: Request, res: Response) => {
  console.log('[Server] /data requested, currentTask:', currentTask);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const dataJSON = JSON.stringify({
    wallet: wallet,
    currentTask: currentTask,
    transactions: log.transactions,
    markets: marketList,
    currentMarket: markets[wallet.data.currentMarket.name] ?? null,
    tradingMode
  });

  res.setHeader('Content-Type', 'application/json');
  res.send(dataJSON);
});

// Serve React app for all other routes

if (!local) {
  app.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../../client/build/index.html"));
  });
}

const port = process.env.PORT || 5000;

app.get('/api/trading-mode', (req: Request, res: Response) => {
  res.json({ tradingMode });
});

app.post('/api/trading-mode', (req: Request, res: Response) => {
  const nextMode = typeof req.body?.mode === 'string'
    ? req.body.mode.toLowerCase()
    : '';

  if (
    nextMode !== 'simulation' &&
    nextMode !== 'test' &&
    nextMode !== 'live'
  ) {
    res.status(400).json({ error: 'Invalid trading mode.' });
    return;
  }

  if (nextMode === 'live' && req.body?.confirm !== true) {
    res.status(400).json({ error: 'Live trading confirmation is required.' });
    return;
  }

  tradingMode = nextMode;
  res.json({ tradingMode });
});

app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
});

app.get('/api/portfolio-history', (_req, res) => {
  res.json(portfolioHistory);
});

/////////////////////////////////////////





// Functions



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