/**
 * localStorage persistence for the terminal.
 *
 * No login, no database — the watchlist, drawings, indicator settings and
 * last-viewed symbol/interval all live in the browser's localStorage.
 * Every helper is defensive: a corrupt or unavailable storage must never
 * crash the app, it just falls back to the default.
 */

export const STORAGE_KEYS = {
  watchlist: 'ptt:watchlist',
  drawings: 'ptt:drawings',
  indicators: 'ptt:indicators',
  lastSymbol: 'ptt:last-symbol',
  lastInterval: 'ptt:last-interval',
} as const;

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / unavailable (private mode) — non-fatal.
  }
}

export function loadString(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Non-fatal.
  }
}

/** One saved drawing. Points are (candle open time, price) pairs. */
export interface SavedOverlay {
  /** klinecharts overlay name, e.g. "straightLine", "rectangle". */
  name: string;
  points: Array<{ timestamp: number; value: number }>;
}

/**
 * All drawings, keyed by `${symbol}:${interval}` so switching symbol or
 * timeframe restores exactly that chart's drawings.
 */
export type DrawingsStore = Record<string, SavedOverlay[]>;

export function drawingsKey(symbol: string, interval: string): string {
  return `${symbol}:${interval}`;
}
