/**
 * lib/drawing-persistence.ts — DrawingPersistence (MASTER TASK Phase 3 Step 3).
 *
 * Owns the drawing persistence that used to live inline in
 * components/Chart.tsx: readMergedList, persistDrawings (with its
 * guards: suppressSave, the G-19 first-restore guard, G-05 corrupt
 * suppression, the G-12 write-then-read-back verification +
 * setSaveWarning), and loadTemplates / saveTemplates (key stays
 * `ptt:overlay-templates`, NOT merged into lib/store.ts — G-17 stays
 * deferred to Phase 6). Pure TypeScript, no React: Chart holds a
 * single instance in a ref and calls it through thin wrappers
 * (readMergedList / persistDrawings); applySnapshot's direct store
 * writes stay in Chart (it writes through loadDrawingsStore /
 * saveDrawingsStore itself, and reads via this module's
 * readMergedList — unchanged).
 *
 * Behaviour is unchanged from the inline version:
 * - readMergedList: stored overlays outside the current view +
 *   the live overlays on this chart; live wins on id collisions.
 * - persist: skips while suppressSave is set, skips for any view
 *   whose first restore has not completed (G-19), suppresses the
 *   write when the stored JSON is corrupt (G-05) and warns once per
 *   session, and verifies the write landed by reading it back
 *   (G-12). The result tells Chart what to do with the saveWarning
 *   banner: `warning: null` clears it (verified write), a string
 *   sets it, `undefined` leaves it untouched (skipped writes).
 * - The "corrupt warned once" flag belongs to this instance
 *   (was drawingsStoreCorruptRef in Chart).
 */
import type { Chart } from 'klinecharts';
import {
  loadDrawingsStore,
  saveDrawingsStore,
  STORAGE_KEYS,
  type LastOverlayStyle,
  type SavedOverlay,
} from '@/lib/store';
import {
  isInView,
  toSavedOverlay,
  type OverlayLineParsers,
} from '@/lib/drawing-model';

/** Persist outcome. `warning: undefined` = skipped: Chart leaves the
 *  saveWarning banner untouched (as the inline early returns did). */
export type PersistStatus =
  | 'ok'
  | 'skipped-suppressed'
  | 'skipped-not-restored'
  | 'corrupt'
  | 'failed';

export interface PersistResult {
  status: PersistStatus;
  warning?: string | null;
}

/** Guards persist reads from Chart's refs at call time (per-call
 *  values, not captured refs — the instance never reads Chart state
 *  on its own). */
export interface PersistGuards {
  /** True while restoreDrawings / applySnapshot rebuilds overlays. */
  suppressSave: boolean;
  /** "symbol:interval" of the last view whose restore completed (G-19). */
  lastRestoredKey: string | null;
}

export interface DrawingPersistence {
  readMergedList(symbol: string, interval: string): SavedOverlay[];
  persist(
    symbol: string,
    interval: string,
    guards: PersistGuards,
  ): PersistResult;
  loadTemplates(): OverlayTemplates;
  saveTemplates(next: OverlayTemplates): void;
}

/**
 * Overlay style templates, grouped by overlay name (tool type), so a
 * template saved from a trend line only lists for trend lines. A
 * saved template is a style snapshot (colour / opacity / line width /
 * line style / fill opacity) — extend is NOT stored: extend is
 * derived from the overlay name + point order and changing it needs
 * delete + recreate. Stored in localStorage; lib/store.ts is untouched.
 */
const TEMPLATE_STORAGE_KEY = 'ptt:overlay-templates';

export interface OverlayTemplate {
  name: string;
  style: LastOverlayStyle;
}

export type OverlayTemplates = Record<string, OverlayTemplate[]>;

export function createDrawingPersistence(
  getChart: () => Chart | null,
  lineParsers: OverlayLineParsers,
): DrawingPersistence {
  /**
   * G-05: true once the stored drawings JSON was found corrupt, so
   * the console warning is logged once per session (the write itself
   * stays suppressed until the raw value parses again).
   */
  let corruptWarned = false;

  /**
   * Full symbol-level list: stored overlays outside the current view
   * (overlays not visible on this interval) + the live overlays on
   * this chart. Live overlays win on id collisions.
   */
  const readMergedList = (
    symbol: string,
    interval: string,
  ): SavedOverlay[] => {
    const store = loadDrawingsStore();
    const stored = store[symbol] ?? [];
    const others = stored.filter((o) => !isInView(o, interval));
    const chart = getChart();
    if (!chart) return stored;
    const live = chart
      .getOverlays()
      .map((o) => toSavedOverlay(o, lineParsers))
      .filter((o): o is SavedOverlay => o !== null);
    const liveIds = new Set(live.map((o) => o.id));
    return [...others.filter((o) => !liveIds.has(o.id)), ...live];
  };

  const persist = (
    symbol: string,
    interval: string,
    guards: PersistGuards,
  ): PersistResult => {
    if (guards.suppressSave) return { status: 'skipped-suppressed' };
    // G-19: never persist for a view whose first restore has not
    // completed — the live list is still empty then, and writing it
    // would wipe the stored drawings for the symbol.
    if (guards.lastRestoredKey !== `${symbol}:${interval}`) {
      return { status: 'skipped-not-restored' };
    }
    // G-05: a corrupt stored JSON must never be overwritten with the
    // (fallback-empty) store. Suppress the write and warn once.
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEYS.drawings);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('drawings store is not an object');
        }
      }
    } catch {
      if (raw !== null) {
        if (!corruptWarned) {
          corruptWarned = true;
          console.warn(
            '[ptt] drawings store corrupt, persist suppressed to avoid overwriting it',
          );
        }
        return {
          status: 'corrupt',
          warning: '畫線存檔損毀，已暫停自動儲存以免覆蓋舊資料。',
        };
      }
      // getItem itself threw (storage unavailable): fall through to
      // the write attempt; the read-back check below reports it.
    }
    const store = loadDrawingsStore();
    store[symbol] = readMergedList(symbol, interval);
    const intended = JSON.stringify(store);
    saveDrawingsStore(store);
    // G-12: verify the write landed — a silent quota / private-mode
    // failure used to look like a successful save.
    let written: string | null = null;
    try {
      written = window.localStorage.getItem(STORAGE_KEYS.drawings);
    } catch {
      written = null;
    }
    if (written !== intended) {
      return {
        status: 'failed',
        warning:
          '畫線儲存失敗（瀏覽器儲存空間已滿或處於私密模式），重整後畫線可能消失。',
      };
    }
    return { status: 'ok', warning: null };
  };

  const loadTemplates = (): OverlayTemplates => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};
      const out: OverlayTemplates = {};
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (!Array.isArray(value)) continue;
        const list = value.filter(
          (t): t is OverlayTemplate =>
            t !== null &&
            typeof t === 'object' &&
            typeof (t as OverlayTemplate).name === 'string' &&
            (t as OverlayTemplate).style !== null &&
            typeof (t as OverlayTemplate).style === 'object',
        );
        if (list.length > 0) out[key] = list;
      }
      return out;
    } catch {
      return {};
    }
  };

  const saveTemplates = (next: OverlayTemplates): void => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full / private mode: templates stay in memory only.
    }
  };

  return { readMergedList, persist, loadTemplates, saveTemplates };
}
