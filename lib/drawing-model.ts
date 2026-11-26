/**
 * lib/drawing-model.ts — pure drawing-model helpers (MASTER TASK Phase 3 Step 3).
 *
 * Moved verbatim from components/Chart.tsx (module scope): the
 * SavedOverlay serialisation / validation / normalisation helpers
 * that the persistence layer and (Step 7) the drawing controller
 * share. No React, no localStorage, no chart access: pure functions
 * over klinecharts Overlay / SavedOverlay.
 *
 * Ownership notes:
 * - parseLineColor / logicalLineStyle stay in Chart.tsx (Step 7 style
 *   helpers). toSavedOverlay needs them, so it takes them as an
 *   injected dependency (OverlayLineParsers) instead of importing
 *   from Chart — no Chart <-> model import cycle.
 * - MEASURE_NAME / TEXT_ANNOTATION_NAME move here with
 *   toSavedOverlay: they are model facts (which overlay names are
 *   never persisted). Chart imports them; every other use site in
 *   Chart is unchanged.
 * - DRAWING_TOOL_NAMES moves here with validateSavedOverlay (derived
 *   from DRAWING_TOOLS in lib/chart-config, the only place it is used).
 */
import type { Overlay } from 'klinecharts';
import {
  DRAWING_TOOLS,
  type LineStyleId,
} from '@/lib/chart-config';
import {
  DEFAULT_OVERLAY_TEXT,
  newOverlayId,
  type OverlayStylePatch,
  type OverlayText,
  type SavedOverlay,
} from '@/lib/store';

/** klinecharts overlay name of the measure tool (never persisted). */
export const MEASURE_NAME = 'measure';
/** Custom overlay name for a drawing's attached text label. */
export const TEXT_ANNOTATION_NAME = 'textAnnotation';

/**
 * Line parsers owned by Chart.tsx (Step 7 style helpers), injected
 * into toSavedOverlay so this module never imports from Chart.
 */
export interface OverlayLineParsers {
  parseLineColor: (
    color: string | undefined,
  ) => { color: string; opacity: number };
  logicalLineStyle: (
    line: { style?: string; dashedValue?: number[] } | undefined,
  ) => LineStyleId;
}

/** Whether a saved overlay belongs on the given interval's chart.
 *  undefined visibleIntervals = shown on every interval. */
export function isInView(o: SavedOverlay, interval: string): boolean {
  return (
    o.visibleIntervals === undefined ||
    o.visibleIntervals.includes(interval)
  );
}

/** Validate an extendData.text value into an OverlayText, or null. */
export function parseOverlayText(v: unknown): OverlayText | null {
  if (typeof v !== 'object' || v === null) return null;
  const t = v as Record<string, unknown>;
  if (typeof t.content !== 'string' || t.content.length === 0) return null;
  return {
    content: t.content,
    color:
      typeof t.color === 'string' ? t.color : DEFAULT_OVERLAY_TEXT.color,
    size:
      typeof t.size === 'number' && t.size > 0
        ? t.size
        : DEFAULT_OVERLAY_TEXT.size,
    bold: t.bold === true,
    italic: t.italic === true,
    alignV:
      t.alignV === 'top' || t.alignV === 'bottom' ? t.alignV : 'middle',
    alignH:
      t.alignH === 'left' || t.alignH === 'right' ? t.alignH : 'center',
  };
}

/** Validate an extendData.visibleIntervals value. */
export function parseVisibleIntervals(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is string => typeof x === 'string');
  return list.length > 0 ? list : [];
}

/** Only fully-drawn overlays (every point has timestamp + value) are saved.
 *  The measure tool is never saved. A text annotation is never saved
 *  when it is a companion (id `${mainId}:text`, rebuilt from its main
 *  line's text on restore); a STANDALONE text annotation (the 文字標註
 *  tool) is saved like any other drawing. */
export function toSavedOverlay(
  o: Overlay,
  lineParsers: OverlayLineParsers,
): SavedOverlay | null {
  const { parseLineColor, logicalLineStyle } = lineParsers;
  if (o.name === MEASURE_NAME) return null;
  if (o.name === TEXT_ANNOTATION_NAME && o.id.endsWith(':text')) {
    return null;
  }
  if (o.points.length === 0) return null;
  const points: SavedOverlay['points'] = [];
  for (const p of o.points) {
    if (p.timestamp === undefined || p.value === undefined) return null;
    points.push({ timestamp: p.timestamp, value: p.value });
  }
  const line = o.styles?.line;
  const ext = (o.extendData ?? {}) as Record<string, unknown>;
  // First-class fields live on SavedOverlay, not in extendData.
  const visibleIntervals = parseVisibleIntervals(ext.visibleIntervals);
  const legacyIntervals =
    visibleIntervals === undefined &&
    ext.scope === 'interval' &&
    typeof ext.interval === 'string'
      ? [ext.interval]
      : undefined;
  const restEntries = Object.entries(ext).filter(
    ([k]) =>
      k !== 'scope' &&
      k !== 'interval' &&
      k !== 'visibleIntervals' &&
      k !== 'text',
  );
  let styles: OverlayStylePatch | undefined;
  if (line?.color !== undefined) {
    const { color, opacity } = parseLineColor(line.color);
    styles = {
      color,
      size: line.size ?? 1,
      style: logicalLineStyle(line),
      ...(opacity < 1 ? { opacity } : {}),
    };
  }
  const text = parseOverlayText(ext.text);
  return {
    id: o.id,
    // Old saves used the built-in name; the custom overlay replaces it.
    name: o.name === 'fibonacciLine' ? 'fibonacciRetracement' : o.name,
    points,
    styles,
    lock: o.lock || undefined,
    visible: o.visible === false ? false : undefined,
    extendData: restEntries.length > 0 ? Object.fromEntries(restEntries) : undefined,
    visibleIntervals: visibleIntervals ?? legacyIntervals,
    text: text ?? undefined,
    ...(o.zLevel !== 0 ? { zLevel: o.zLevel } : {}),
  };
}

/** Names a restored overlay may carry (G-05 validation). */
const DRAWING_TOOL_NAMES: ReadonlySet<string> = new Set(
  DRAWING_TOOLS.map((t) => t.id),
);

/**
 * Validate one stored overlay before restore (G-05). Returns a
 * sanitised copy, or null when the entry is unusable and must be
 * skipped: unregistered name, non-finite point, duplicate id,
 * companion ':text' id (companions are never persisted), or no
 * points. Bad scalar fields (lock / visible / zLevel / styles /
 * extendData / visibleIntervals / text) are repaired to defaults
 * instead of dropping the drawing. Invalid entries are skipped at
 * restore and, like deleted overlays, are not re-written by the next
 * persist (readMergedList only keeps stored out-of-view entries plus
 * live ones) — the skip counts are console.warned and recorded in
 * the step report.
 */
export function validateSavedOverlay(
  raw: unknown,
  seenIds: Set<string>,
): SavedOverlay | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Partial<SavedOverlay> & Record<string, unknown>;
  const name =
    o.name === 'fibonacciLine' ? 'fibonacciRetracement' : o.name;
  if (typeof name !== 'string' || !DRAWING_TOOL_NAMES.has(name)) return null;
  const id =
    typeof o.id === 'string' && o.id.length > 0 ? o.id : newOverlayId();
  if (id.endsWith(':text')) return null;
  if (seenIds.has(id)) return null;
  seenIds.add(id);
  if (!Array.isArray(o.points) || o.points.length === 0) return null;
  const points: Array<{ timestamp: number; value: number }> = [];
  for (const p of o.points as Array<unknown>) {
    if (typeof p !== 'object' || p === null) return null;
    const pt = p as { timestamp?: unknown; value?: unknown };
    if (
      typeof pt.timestamp !== 'number' ||
      !Number.isFinite(pt.timestamp) ||
      typeof pt.value !== 'number' ||
      !Number.isFinite(pt.value)
    ) {
      return null;
    }
    points.push({ timestamp: pt.timestamp, value: pt.value });
  }
  const styles =
    typeof o.styles === 'object' && o.styles !== null
      ? (o.styles as OverlayStylePatch)
      : undefined;
  const extendData =
    typeof o.extendData === 'object' && o.extendData !== null
      ? (o.extendData as Record<string, unknown>)
      : undefined;
  return {
    id,
    name,
    points,
    styles,
    lock: o.lock === true,
    visible: o.visible !== false,
    extendData,
    visibleIntervals: parseVisibleIntervals(o.visibleIntervals),
    text: parseOverlayText(o.text) ?? undefined,
    zLevel:
      typeof o.zLevel === 'number' && Number.isFinite(o.zLevel)
        ? o.zLevel
        : 0,
  };
}

/**
 * Renumber zLevels to consecutive integers 0..n-1, preserving the
 * current order (stable for ties) — G-16. Applied on restore and on
 * undo/redo snapshots; copy / bring-to-front / send-to-back keep
 * their max+1 / min-1 behaviour and are normalised on the next
 * restore / undo instead.
 */
export function normalizeZLevels(list: SavedOverlay[]): SavedOverlay[] {
  const ranked = list
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (a.o.zLevel ?? 0) - (b.o.zLevel ?? 0) || a.i - b.i);
  const rank = new Map<string, number>();
  ranked.forEach(({ o }, r) => rank.set(o.id, r));
  return list.map((o) => ({ ...o, zLevel: rank.get(o.id) ?? 0 }));
}
