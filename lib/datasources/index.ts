/**
 * Datasource dispatcher.
 *
 * Phase 1 implements only Binance. Bybit / Hyperliquid / Yahoo plug in here
 * later by adding a case — the route handler and the frontend never change.
 */

import type { DataSourceId, Interval, Kline } from '../types';
import { fetchBinanceKlines } from './binance';

export interface FetchKlinesParams {
  source: DataSourceId;
  symbol: string;
  interval: Interval;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export async function fetchKlines({
  source,
  symbol,
  interval,
  limit,
  startTime,
  endTime,
}: FetchKlinesParams): Promise<Kline[]> {
  switch (source) {
    case 'binance':
      return fetchBinanceKlines({ symbol, interval, limit, startTime, endTime });
    case 'bybit':
    case 'hyperliquid':
    case 'yahoo':
      // Not implemented yet (Phase 2+). Keep the 400 at the route layer.
      throw new Error(`source not implemented yet: ${source}`);
    default:
      throw new Error(`unknown source: ${source as string}`);
  }
}
