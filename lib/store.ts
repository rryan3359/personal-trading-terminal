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
  drawingsVersion: 'ptt:drawings-version',
  indicators: 'ptt:indicators',
  lastSymbol: 'ptt:last-symbol',
  lastInterval: 'ptt:last-interval',
  magnet: 'ptt:magnet',
  lastOverlayStyle: 'ptt:last-overlay-style',
  chartType: 'ptt:chart-type',
} as const;

/** Current drawings-store format version. v1 was keyed `${symbol}:${interval}`. */
export const DRAWINGS_VERSION = '2';

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

export function newOverlayId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ov-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
  }
}

/** Magnet (snap-to-price) mode for drawing tools. */
export type MagnetMode = 'off' | 'weak' | 'strong';

export function getMagnetMode(): MagnetMode {
  const v = loadString(STORAGE_KEYS.magnet, 'weak');
  return v === 'off' || v === 'weak' || v === 'strong' ? v : 'weak';
}

export function saveMagnetMode(mode: MagnetMode): void {
  saveString(STORAGE_KEYS.magnet, mode);
}

/** Last-used drawing style, reused for the next new drawing. */
export interface LastOverlayStyle {
  color: string;
  size: number;
  style: 'solid' | 'dashed';
  /** Rectangle fill opacity (0.05–0.4). */
  fillOpacity: number;
}

export const DEFAULT_OVERLAY_STYLE: LastOverlayStyle = {
  color: '#2962ff',
  size: 1,
  style: 'solid',
  fillOpacity: 0.08,
};

export function getLastOverlayStyle(): LastOverlayStyle {
  const saved = loadJSON<Partial<LastOverlayStyle>>(
    STORAGE_KEYS.lastOverlayStyle,
    {},
  );
  return { ...DEFAULT_OVERLAY_STYLE, ...saved };
}

export function saveLastOverlayStyle(style: LastOverlayStyle): void {
  saveJSON(STORAGE_KEYS.lastOverlayStyle, style);
}

export type OverlayScope = 'symbol' | 'interval';

/** Line/border style of one drawing. */
export interface OverlayStylePatch {
  /** Main line / border color (hex). */
  color: string;
  /** Line width in px (1–4). */
  size: number;
  /** Line type. */
  style: 'solid' | 'dashed';
}

/**
 * One saved drawing (v2). New fields are all optional so v1 data
 * ({name, points} only) still loads: missing id is generated, missing
 * styles fall back to the last-used style, missing scope means 'symbol'.
 */
export interface SavedOverlay {
  id: string;
  /** klinecharts overlay name, e.g. "segment", "rectangle". */
  name: string;
  points: Array<{ timestamp: number; value: number }>;
  styles?: OverlayStylePatch;
  lock?: boolean;
  visible?: boolean;
  /** Extras: rectangle fillOpacity, fibonacci levels, measure intervalMs. */
  extendData?: Record<string, unknown>;
  /** 'symbol' (default): shown on every interval. 'interval': only on `interval`. */
  scope?: OverlayScope;
  /** Interval this overlay belongs to when scope is 'interval'. */
  interval?: string;
}

/**
 * All drawings, keyed by symbol. Each overlay carries its own scope, so
 * one symbol-level list serves every timeframe.
 */
export type DrawingsStore = Record<string, SavedOverlay[]>;

export function loadDrawingsStore(): DrawingsStore {
  migrateDrawingsIfNeeded();
  return loadJSON<DrawingsStore>(STORAGE_KEYS.drawings, {});
}

export function saveDrawingsStore(store: DrawingsStore): void {
  saveJSON(STORAGE_KEYS.drawings, store);
}

/**
 * One-time v1 -> v2 migration. v1 keys were `${symbol}:${interval}` with
 * {name, points} overlays; v2 keys are bare symbols and each overlay keeps
 * scope 'interval' + its interval, so the old behaviour is preserved.
 * Identical overlays (same symbol/name/points) are deduped by JSON
 * fingerprint. Runs once: the version marker stops repeat runs, and the
 * old ':' keys are removed so a half-done migration is safe to retry.
 */
export function migrateDrawingsIfNeeded(): void {
  try {
    if (
      window.localStorage.getItem(STORAGE_KEYS.drawingsVersion) ===
      DRAWINGS_VERSION
    ) {
      return;
    }
    const raw = window.localStorage.getItem(STORAGE_KEYS.drawings);
    if (raw === null) {
      window.localStorage.setItem(
        STORAGE_KEYS.drawingsVersion,
        DRAWINGS_VERSION,
      );
      return;
    }
    const old = JSON.parse(raw) as Record<string, unknown>;
    if (typeof old !== 'object' || old === null || Array.isArray(old)) {
      window.localStorage.setItem(
        STORAGE_KEYS.drawingsVersion,
        DRAWINGS_VERSION,
      );
      return;
    }
    const merged: DrawingsStore = {};
    const seen = new Set<string>();
    for (const [key, list] of Object.entries(old)) {
      if (!Array.isArray(list)) continue;
      const sep = key.lastIndexOf(':');
      if (sep <= 0) {
        // Already v2 format (bare symbol key) — keep as-is.
        merged[key] = list as SavedOverlay[];
        continue;
      }
      const symbol = key.slice(0, sep);
      const interval = key.slice(sep + 1);
      const target = (merged[symbol] ??= []);
      for (const o of list as Array<Record<string, unknown>>) {
        if (typeof o?.name !== 'string' || !Array.isArray(o?.points)) continue;
        const name =
          o.name === 'fibonacciLine' ? 'fibonacciRetracement' : o.name;
        const points = o.points as SavedOverlay['points'];
        const fingerprint = JSON.stringify({ symbol, name, points });
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        target.push({ id: newOverlayId(), name, points, scope: 'interval', interval });
      }
    }
    window.localStorage.setItem(STORAGE_KEYS.drawings, JSON.stringify(merged));
    window.localStorage.setItem(
      STORAGE_KEYS.drawingsVersion,
      DRAWINGS_VERSION,
    );
  } catch {
    // Non-fatal: keep the old data; migration retries on the next load.
  }
}
