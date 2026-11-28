/**
 * localStorage persistence for the terminal.
 *
 * No login, no database — the watchlist, drawings, indicator settings and
 * last-viewed symbol/interval all live in the browser's localStorage.
 * Every helper is defensive: a corrupt or unavailable storage must never
 * crash the app, it just falls back to the default.
 */

import {
  normalizeAppearance,
  type AppearanceSettings,
} from '@/lib/chart-appearance';
import {
  DEFAULT_POSITION_SETTINGS,
  readPositionSettings,
  type PositionSettings,
} from '@/lib/position-calc';
import type { ChartType } from '@/lib/chart-config';
import { isInterval, type Interval } from '@/lib/types';

export const STORAGE_KEYS = {
  watchlist: 'ptt:watchlist',
  /** TW/US tickers on the stock watchlist (local-only list, no quotes). */
  stockWatchlist: 'ptt:stock-watchlist',
  drawings: 'ptt:drawings',
  drawingsVersion: 'ptt:drawings-version',
  indicators: 'ptt:indicators',
  lastSymbol: 'ptt:last-symbol',
  lastInterval: 'ptt:last-interval',
  magnet: 'ptt:magnet',
  lastOverlayStyle: 'ptt:last-overlay-style',
  /** Last-used position settings (account / risk / leverage / lot /
   *  qty precision + zone colours / text size / stats options), reused
   *  for the next new long/short position. */
  lastPositionInputs: 'ptt:last-position-inputs',
  chartType: 'ptt:chart-type',
  /** Chart appearance (colors, grid, axis font size) — see lib/chart-appearance.ts. */
  chartAppearance: 'ptt:chart-appearance',
  /** Saved chart layouts (analysis centre 儲存／開啟, TV-style). */
  layouts: 'ptt:layouts',
  /** TV Stay-in-drawing-mode (Keep drawing) — Phase A P1. */
  keepDrawing: 'ptt:keep-drawing',
} as const;

/** Current drawings-store format version. v1 was keyed `${symbol}:${interval}`. v2 keyed bare symbols with scope/interval. v3 replaces scope/interval with visibleIntervals + text. */
export const DRAWINGS_VERSION = '3';

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

/** Chart appearance (colors, grid, axis font size). Missing / corrupt
 *  fields fall back to DEFAULT_APPEARANCE, so old users upgrade with
 *  no visible change. */
export function getChartAppearance(): AppearanceSettings {
  return normalizeAppearance(
    loadJSON<Partial<AppearanceSettings>>(STORAGE_KEYS.chartAppearance, {}),
  );
}

export function saveChartAppearance(s: AppearanceSettings): void {
  saveJSON(STORAGE_KEYS.chartAppearance, s);
}

/**
 * Saved chart layouts (analysis centre 儲存／開啟). A layout is a
 * snapshot of the current view — symbol, interval, indicators, chart
 * type, appearance — stored under `ptt:layouts`. Drawings are NOT in
 * the snapshot: they already persist per symbol in `ptt:drawings`
 * and come back with the symbol. Validation is defensive: a corrupt
 * entry is dropped, never trusted.
 */
export interface SavedLayout {
  id: string;
  name: string;
  createdAt: number;
  symbol: string;
  interval: Interval;
  indicators: string[];
  chartType: ChartType;
  appearance: AppearanceSettings;
}

export function loadLayouts(): SavedLayout[] {
  const raw = loadJSON<unknown[]>(STORAGE_KEYS.layouts, []);
  if (!Array.isArray(raw)) return [];
  const out: SavedLayout[] = [];
  for (const v of raw) {
    if (typeof v !== 'object' || v === null) continue;
    const o = v as Record<string, unknown>;
    if (
      typeof o.id !== 'string' ||
      typeof o.name !== 'string' ||
      typeof o.symbol !== 'string' ||
      typeof o.interval !== 'string' ||
      !isInterval(o.interval) ||
      !Array.isArray(o.indicators) ||
      !o.indicators.every((i) => typeof i === 'string') ||
      (o.chartType !== 'candle_solid' && o.chartType !== 'area') ||
      typeof o.appearance !== 'object' ||
      o.appearance === null
    ) {
      continue;
    }
    out.push({
      id: o.id,
      name: o.name,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
      symbol: o.symbol,
      interval: o.interval,
      indicators: o.indicators as string[],
      chartType: o.chartType === 'area' ? 'area' : 'candle_solid',
      appearance: normalizeAppearance(
        o.appearance as Partial<AppearanceSettings>,
      ),
    });
  }
  return out;
}

export function saveLayouts(layouts: SavedLayout[]): void {
  saveJSON(STORAGE_KEYS.layouts, layouts);
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

/** Keep drawing (TV Stay-in-drawing-mode): when on, finishing any
 *  drawing re-arms the tool instead of disarming (page.tsx ORs it
 *  into `continuousDraw`). Stored as '1' / '0'. */
export function getKeepDrawing(): boolean {
  return loadString(STORAGE_KEYS.keepDrawing, '0') === '1';
}

export function saveKeepDrawing(on: boolean): void {
  saveString(STORAGE_KEYS.keepDrawing, on ? '1' : '0');
}

/** Last-used drawing style, reused for the next new drawing. */
export interface LastOverlayStyle {
  color: string;
  size: number;
  style: 'solid' | 'dashed' | 'dotted';
  /** Line opacity (0–1). The line color is stored as hex + this opacity. */
  opacity: number;
  /** Rectangle fill opacity (0.05–0.4). */
  fillOpacity: number;
}

export const DEFAULT_OVERLAY_STYLE: LastOverlayStyle = {
  color: '#2962ff',
  size: 1,
  style: 'solid',
  opacity: 1,
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

/**
 * Last-used position settings, reused for the next new long/short
 * position (same pattern as the last overlay style). The values are
 * neutral defaults (account 10,000 USDT / risk 1% / leverage 1) —
 * not Ryan's actual account; he sets his own in the dialog.
 */
export function getLastPositionInputs(): PositionSettings {
  const saved = loadJSON<Partial<PositionSettings>>(
    STORAGE_KEYS.lastPositionInputs,
    {},
  );
  return readPositionSettings({
    ...DEFAULT_POSITION_SETTINGS,
    ...saved,
  });
}

export function saveLastPositionInputs(settings: PositionSettings): void {
  saveJSON(STORAGE_KEYS.lastPositionInputs, settings);
}

export type OverlayScope = 'symbol' | 'interval';

/** Text attached to a drawing (Phase 2). Rendered by an accompanying
 *  textAnnotation overlay (line tools), an in-box label (rectangle), or
 *  the level labels (fibonacci). `italic` renders via the canvas font
 *  string weight slot ('italic' / 'italic bold') — klinecharts has no
 *  separate italic style. */
export interface OverlayText {
  content: string;
  color: string;
  /** Font size in px. */
  size: number;
  bold: boolean;
  italic: boolean;
  alignV: 'top' | 'middle' | 'bottom';
  alignH: 'left' | 'center' | 'right';
}

export const DEFAULT_OVERLAY_TEXT: OverlayText = {
  content: '',
  color: '#d1d4dc',
  size: 12,
  bold: false,
  italic: false,
  alignV: 'middle',
  alignH: 'center',
};

/** Line/border style of one drawing. */
export interface OverlayStylePatch {
  /** Main line / border color (hex). */
  color: string;
  /** Line width in px (1–4). */
  size: number;
  /** Line type. 'dotted' renders as dashed + dashedValue [1, 4]. */
  style: 'solid' | 'dashed' | 'dotted';
  /** Line opacity (0–1). Defaults to 1 when missing (old saves). */
  opacity?: number;
}

/**
 * One saved drawing (v3). New fields are all optional so v1 data
 * ({name, points} only) still loads: missing id is generated, missing
 * styles fall back to the last-used style, missing visibleIntervals
 * means 'shown on every interval'.
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
  /**
   * Intervals this overlay is shown on. undefined = every interval.
   * Replaces the v2 scope/interval pair (migrated on load).
   */
  visibleIntervals?: string[];
  /** Attached text (Phase 2). Absent / empty content = no text. */
  text?: OverlayText;
  /**
   * @deprecated v2 only. Read by the v2 -> v3 migration, then deleted.
   * 'symbol' (default): shown on every interval. 'interval': only on `interval`.
   */
  scope?: OverlayScope;
  /** @deprecated v2 only, see `scope`. */
  interval?: string;
  /**
   * Draw level (klinecharts zLevel). Missing = 0 (old saves). Bring to
   * front / send to back move this above the current max / below the min.
   */
  zLevel?: number;
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
 * Convert one v2 (or v1-shaped) overlay to v3 in place: scope/interval
 * become visibleIntervals, then the legacy fields are deleted. Already-v3
 * overlays pass through unchanged, so the migration is idempotent and
 * safe to retry. Returns null for entries that are not drawings.
 */
function migrateOverlayToV3(
  o: Record<string, unknown>,
): SavedOverlay | null {
  if (typeof o?.name !== 'string' || !Array.isArray(o?.points)) return null;
  const next: SavedOverlay = {
    ...(o as unknown as SavedOverlay),
    name:
      o.name === 'fibonacciLine' ? 'fibonacciRetracement' : o.name,
  };
  if (next.visibleIntervals === undefined) {
    if (next.scope === 'interval' && typeof next.interval === 'string') {
      next.visibleIntervals = [next.interval];
    }
    // scope 'symbol' or missing -> undefined (shown on every interval).
  }
  delete next.scope;
  delete next.interval;
  return next;
}

/**
 * One-time v1/v2 -> v3 migration. v1 keys were `${symbol}:${interval}`
 * with {name, points} overlays; v2 keys are bare symbols with scope /
 * interval per overlay; v3 replaces scope/interval with
 * visibleIntervals. Identical v1 overlays (same symbol/name/points) are
 * deduped by JSON fingerprint. Runs once: the version marker stops
 * repeat runs, and the old ':' keys are removed so a half-done
 * migration is safe to retry. Drawings are never dropped by the
 * migration itself — only entries without a name/points are skipped.
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
        // Already v2/v3 format (bare symbol key) — convert each overlay.
        merged[key] = (list as Array<Record<string, unknown>>)
          .map(migrateOverlayToV3)
          .filter((o): o is SavedOverlay => o !== null);
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
        target.push({
          id: newOverlayId(),
          name,
          points,
          visibleIntervals: [interval],
        });
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
