import type { Express, Request, Response } from 'express';
import { state } from './state.js';
import { local } from './config.js';
import path from 'path';

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

console.log('file laoded')

export function configureApi(
  app: Express
) {

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

  app.get('/api/portfolio-history', (_req, res) => {
    res.json(portfolioHistory);
  });

  if (!local) {
  app.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../../client/build/index.html"));
  });
}
}
