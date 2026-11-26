/**
 * Binance datasource (Phase 1 — the only source implemented so far).
 *
 * REST base: https://data-api.binance.vision
 * This is Binance's official public market-data host. It serves the exact
 * same /api/v3 endpoints as api.binance.com, needs no API key, and — unlike
 * api.binance.com — is reachable from regions where api.binance.com returns
 * HTTP 451 "Service unavailable from a restricted location".
 *
 * WebSocket base lives in lib/ws/binance.ts (wss://stream.binance.com:9443).
 */

import type { Interval, Kline } from '../types';

export const BINANCE_REST_BASE = 'https://data-api.binance.vision';

/** Binance interval strings are identical to our Interval type. */
const BINANCE_INTERVAL: Record<Interval, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '12h': '12h',
  '1d': '1d',
  '3d': '3d',
  '1w': '1w',
  '1M': '1M',
};

export interface FetchBinanceKlinesParams {
  /** e.g. "BTCUSDT" (case-insensitive, normalised to upper case). */
  symbol: string;
  interval: Interval;
  /** 1..1000. Binance default is 500. */
  limit?: number;
  /** Inclusive lower bound (ms). Used for loading newer bars. */
  startTime?: number;
  /** Inclusive upper bound (ms). Used for loading older history. */
  endTime?: number;
}

/**
 * Fetch historical klines from Binance and return them in unified format.
 * Binance returns an array of arrays:
 * [ openTime, open, high, low, close, volume, closeTime,
 *   quoteAssetVolume, trades, takerBuyBase, takerBuyQuote, ignore ]
 */
export async function fetchBinanceKlines({
  symbol,
  interval,
  limit = 500,
  startTime,
  endTime,
}: FetchBinanceKlinesParams): Promise<Kline[]> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(normalizedSymbol)) {
    throw new Error(`invalid symbol: ${symbol}`);
  }

  const url = new URL(`${BINANCE_REST_BASE}/api/v3/klines`);
  url.searchParams.set('symbol', normalizedSymbol);
  url.searchParams.set('interval', BINANCE_INTERVAL[interval]);
  url.searchParams.set('limit', String(limit));
  if (startTime !== undefined) {
    url.searchParams.set('startTime', String(startTime));
  }
  if (endTime !== undefined) {
    url.searchParams.set('endTime', String(endTime));
  }

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Binance klines request failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error('Binance klines response was not an array');
  }

  const klines: Kline[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    klines.push({
      timestamp: Number(row[0]),
      open: parseFloat(row[1]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
      close: parseFloat(row[4]),
      volume: parseFloat(row[5]),
    });
  }
  return klines;
}
