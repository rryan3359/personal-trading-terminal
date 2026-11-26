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

/** Chart timeframes supported by the terminal. Labels match TradingView's
 *  toolbar (1分 5分 15分 1h 4h D W 月). The full set covers every
 *  Binance kline interval the mobile swipe cycle uses; the desktop
 *  toolbar shows only INTERVALS (below). */
export type Interval =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M';

export const INTERVALS: Interval[] = [
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
  '1w',
  '1M',
];

/** Full interval list, in swipe order (mobile capsule swipe +
 *  interval sheet). The desktop toolbar keeps INTERVALS above. */
export const SWIPE_INTERVALS: Interval[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
];

export const INTERVAL_LABELS: Record<Interval, string> = {
  '1m': '1分',
  '3m': '3分',
  '5m': '5分',
  '15m': '15分',
  '30m': '30分',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '12h': '12h',
  '1d': 'D',
  '3d': '3d',
  '1w': 'W',
  '1M': '月',
};

export function isInterval(value: string): value is Interval {
  return (SWIPE_INTERVALS as string[]).includes(value);
}

/** Response shape of GET /api/klines. */
export interface KlinesResponse {
  source: DataSourceId;
  symbol: string;
  interval: Interval;
  klines: Kline[];
}
