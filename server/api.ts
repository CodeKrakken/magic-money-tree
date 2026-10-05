import type { Express, Request, Response } from 'express';
import { state } from './state.js';
import { local } from './config.js';
import path from 'path';


export function configureApi(
  app: Express
) {

  app.get("/data", (req: Request, res: Response) => {
    console.log('[Server] /data requested, currentTask:', state.currentTask);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const dataJSON = JSON.stringify({
      wallet: state.wallet,
      currentTask: state.currentTask,
      transactions: state.log.transactions,
      markets: state.marketList,
      currentMarket: state.markets[state.wallet.data.currentMarket.name] ?? null,
      tradingMode: state.tradingMode
    });

    res.setHeader('Content-Type', 'application/json');
    res.send(dataJSON);
  });

  app.get('/api/trading-mode', (req: Request, res: Response) => {
    const tradingMode = state.tradingMode
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
  
    state.tradingMode = nextMode;
    const tradingMode = state.tradingMode
    res.json({ tradingMode });
  });

  app.get('/api/portfolio-history', (_req, res) => {
    const portfolioHistory = state.portfolioHistory
    res.json(portfolioHistory);
  });

  if (!local) {
  app.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../../client/build/index.html"));
  });
}
}
