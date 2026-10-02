import dotenv from 'dotenv';
import 'dotenv/config';
dotenv.config();

export type TradingMode = 'simulation' | 'test' | 'live';

export const local =
  process.env.ENVIRONMENT === 'local';

export const POSITION_PERCENTAGE =
  Number(process.env.POSITION_PERCENTAGE);

export const MINIMUM_POSITION_NOTIONAL = 10;

export const MAX_CONCURRENT_POSITIONS =
  Number(process.env.MAX_CONCURRENT_POSITIONS);

export const stopLossThreshold =
  Number(process.env.STOP_LOSS_THRESHOLD);

export const slopeThreshold =
  Number(process.env.SLOPE_THRESHOLD);

export const accelerationThreshold =
  Number(process.env.ACCELERATION_THRESHOLD);

export const SHORT_SLOPE =
  Number(process.env.SHORT_SLOPE);

export const LONG_SLOPE =
  Number(process.env.LONG_SLOPE);

export const binanceApiKey =
  process.env.BINANCE_API_KEY ?? '';

export const binanceSecretKey =
  process.env.BINANCE_SECRET_KEY ?? '';

export const username =
  process.env.MONGODB_USERNAME ?? '';

export const password =
  process.env.MONGODB_PASSWORD ?? '';

export const collectionName =
  process.env.COLLECTION ?? '';

export const dbName = 'magic-money-tree';

export const targets = [
  {
    name: '12% target',
    returnPct: 0.12,
    fraction: 1
  }
];

export function resolveTradingMode(
  value: string | undefined
): TradingMode {
  if (value === 'test') return 'test';
  if (value === 'live') return 'live';

  return 'simulation';
}