/**
 * Shared types for the Personal Trading Terminal.
 *
 * Every data source (Binance now; Bybit / Hyperliquid / Yahoo later) must
 * produce the unified `Kline` shape below. The frontend only ever consumes
 * this one format.
 */

/** One OHLCV candle. `timestamp` is the candle OPEN time, in milliseconds. */
export interface Kline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Data source ids. Only `binance` is implemented in Phase 1. */
export type DataSourceId = 'binance' | 'bybit' | 'hyperliquid' | 'yahoo';

/** Sources actually available right now. */
export const AVAILABLE_SOURCES: DataSourceId[] = ['binance'];

/** Chart timeframes supported by the terminal. */
export type Interval = '15m' | '1h' | '4h' | '1d' | '1w';

export const INTERVALS: Interval[] = ['15m', '1h', '4h', '1d', '1w'];

export const INTERVAL_LABELS: Record<Interval, string> = {
  '15m': '15m',
  '1h': '1h',
  '4h': '4H',
  '1d': '1D',
  '1w': '1w',
};

export function isInterval(value: string): value is Interval {
  return (INTERVALS as string[]).includes(value);
}

/** Response shape of GET /api/klines. */
export interface KlinesResponse {
  source: DataSourceId;
  symbol: string;
  interval: Interval;
  klines: Kline[];
}
