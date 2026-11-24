'use client';

/**
 * Chart.tsx — klinecharts wrapper (klinecharts 10.1.1, verified API).
 *
 * v10 has no applyNewData / updateData. Data flows through the DataLoader:
 *   init -> setSymbol -> setPeriod -> setDataLoader({ getBars, subscribeBar, unsubscribeBar })
 * - getBars: history from /api/klines (type "init" = latest, "backward" = older, endTime = timestamp - 1)
 * - subscribeBar: live candles from the Binance WebSocket; the callback the
 *   chart hands us updates the last candle (same timestamp) or appends a new
 *   one (newer timestamp). No manual updateData call is needed.
 * - setSymbol / setPeriod re-trigger getBars("init") automatically.
 *
 * Drawings are persisted per symbol in localStorage (v3 store, see
 * lib/store.ts) and restored after each init load, so they survive
 * symbol/timeframe switches. Overlays default to every interval;
 * the settings dialog can limit one to a chosen set of intervals
 * (visibleIntervals). Crosshair, wheel zoom and drag pan are klinecharts
 * defaults (explicitly enabled here); the dark theme is applied via
 * setStyles at init.
 *
 * If an init load delivers no bars (unknown/delisted symbol, or the
 * request failed), the chart is left empty and an error banner is
 * shown instead of the previous symbol's candles — and no live socket
 * is opened for a symbol that has no data. Symbol validation in the
 * Watchlist normally prevents this path; the banner is the last line
 * of defence.
 *
 * Drawing system (all klinecharts 10.1.1 APIs verified against the
 * installed types): createOverlay returns the new overlay id;
 * overrideOverlay(Partial<OverlayCreate>) edits; removeOverlay({ id })
 * deletes; getOverlays() reads live state. Undo/redo snapshots the
 * persisted model (max 50 steps). Selection is tracked via the
 * onSelected/onDeselected overlay callbacks.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  dispose,
  init,
  type Chart,
  type Crosshair,
  type DataLoader,
  type DeepPartial,
  type KLineData,
  type Overlay,
  type OverlayCreate,
  type OverlayMode,
  type OverlayStyle,
  type Period,
} from 'klinecharts';
import type { Interval, Kline } from '@/lib/types';
import { INTERVAL_LABELS } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import { BinanceKlineSocket, type BinanceSocketStatus } from '@/lib/ws/binance';
import {
  DARK_STYLES,
  FIB_LEVEL_COLORS,
  GANN_FAN_ANGLES,
  fibExtendOf,
  fibLevelsOf,
  gannExtendOf,
  gannOptionsOf,
  hexToRgba,
  isFibTool,
  isGannTool,
  isPatternTool,
  isPitchforkTool,
  pitchExtendOf,
  pitchOptionsOf,
  patternOptionsOf,
  registerFibonacciRetracementOverlay,
  registerFibonacciToolsOverlays,
  registerGannOverlays,
  registerGeometryOverlays,
  registerMeasureOverlay,
  registerPatternOverlays,
  registerPitchforkOverlays,
  registerRectangleOverlay,
  registerSimpleTagOverlay,
  registerTextAnnotationOverlay,
} from '@/lib/chart-theme';
import ColorPicker from '@/components/ColorPicker';
import OverlaySettingsDialog, {
  type DialogTab,
  type OverlayDialogDraft,
} from '@/components/OverlaySettingsDialog';
import {
  DRAWING_TOOLS,
  INDICATOR_OPTIONS,
  INTERVAL_MS,
  LINE_STYLE_OPTIONS,
  RANGES,
  extendForOverlay,
  lineFamilyOf,
  orderPointsForExtend,
  overlayNameForExtend,
  type ChartType,
  type DrawingTool,
  type ExtendId,
  type LineFamily,
  type LineStyleId,
  type RangeId,
} from '@/lib/chart-config';
import {
  DEFAULT_OVERLAY_STYLE,
  DEFAULT_OVERLAY_TEXT,
  getLastOverlayStyle,
  getMagnetMode,
  loadDrawingsStore,
  newOverlayId,
  saveDrawingsStore,
  saveLastOverlayStyle,
  type OverlayStylePatch,
  type OverlayText,
  type SavedOverlay,
} from '@/lib/store';

export interface ChartHandle {
  /** Remove all drawings for the current symbol (and their saved copy). */
  clearDrawings: () => void;
  /** Undo the last drawing change. No-op when nothing to undo. */
  undo: () => void;
  /** Redo an undone drawing change. No-op when nothing to redo. */
  redo: () => void;
  /**
   * Fit a calendar range into the chart width, pinned to the latest
   * candle. The span is capped by the candles actually loaded (500 per
   * init load, more on scroll), so wide ranges on short intervals show
   * the widest available window.
   */
  setRange: (range: RangeId) => void;
}

export interface ChartProps {
  symbol: string;
  interval: Interval;
  /** Currently armed drawing tool, or null when none is armed. */
  activeTool: DrawingTool | null;
  /** Called when an interactive drawing finishes (so the toolbar can disarm). */
  onToolDone: () => void;
  /** Indicator names currently enabled, e.g. ["MA", "VOL"]. */
  indicators: string[];
  /** Candle render style: 蠟燭圖 / 美國線 / 面積圖. */
  chartType: ChartType;
  onConnectionStatus?: (status: BinanceSocketStatus) => void;
  /** Keep the tool armed after each drawing (double-click / Shift-click). */
  continuousDraw?: boolean;
  /** Called when undo/redo availability changes. */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
}

const HISTORY_LIMIT = 500;

function periodFor(interval: Interval): Period {
  switch (interval) {
    case '1m':
      return { type: 'minute', span: 1 };
    case '5m':
      return { type: 'minute', span: 5 };
    case '15m':
      return { type: 'minute', span: 15 };
    case '1h':
      return { type: 'hour', span: 1 };
    case '4h':
      return { type: 'hour', span: 4 };
    case '1d':
      return { type: 'day', span: 1 };
    case '1w':
      return { type: 'week', span: 1 };
    case '1M':
      return { type: 'month', span: 1 };
  }
}

function isMainPaneIndicator(name: string): boolean {
  return INDICATOR_OPTIONS.find((o) => o.id === name)?.mainPane ?? false;
}

const MAX_HISTORY = 50;
const MEASURE_NAME = 'measure';
const LINE_WIDTHS = [1, 2, 3, 4];
/** Custom overlay name for a drawing's attached text label. */
const TEXT_ANNOTATION_NAME = 'textAnnotation';

/** Checkerboard behind translucent color swatches (shows opacity). */
const CHECKER_BG = {
  backgroundImage:
    'linear-gradient(45deg, #9e9e9e 25%, transparent 25%), linear-gradient(-45deg, #9e9e9e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9e9e9e 75%), linear-gradient(-45deg, transparent 75%, #9e9e9e 75%)',
  backgroundSize: '6px 6px',
  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
  backgroundColor: '#f5f5f5',
};

/** Snapshot of one selected overlay for the floating edit bar and the
 *  settings dialog. Points/text/visibility/extend are read from the
 *  live overlay (extend is derived from the overlay name + point order). */
interface SelectedOverlayState {
  id: string;
  name: string;
  color: string;
  opacity: number;
  size: number;
  style: LineStyleId;
  lock: boolean;
  visible: boolean;
  /** undefined = shown on every interval. */
  visibleIntervals: string[] | undefined;
  fillOpacity: number;
  isRect: boolean;
  zLevel: number;
  points: Array<{ timestamp: number; value: number }>;
  /** Attached text. null = none. */
  text: OverlayText | null;
  extend: ExtendId;
  /** Show the price on the right Y axis (needDefaultYAxisFigure). */
  priceLabel: boolean;
  rectBorder: boolean;
  rectMiddleLine: boolean;
  rectFill: boolean;
  /** Closed geometry shapes (ellipse, triangle): fill on/off. */
  fill: boolean;
  fibTrendline: boolean;
  fibLevelColors: string[];
  fibExtend: 'left' | 'right' | 'both';
  fibBackground: boolean;
  fibLevelText: boolean;
  /** Fibonacci levels (ratios, or sequence numbers for time zones). */
  fibLevels: number[];
  /** Fibonacci: per-level on/off, parallel to fibLevels (missing = on). */
  fibLevelEnabled: boolean[];
  /** Pitchfork: line extension, median/outer visibility, median bold. */
  pitchExtend: 'none' | 'right' | 'both';
  showMedian: boolean;
  showOuter: boolean;
  medianBold: boolean;
  /** Gann fan: line extension, per-angle visibility, 1x1 bold, angle labels. */
  gannExtend: 'none' | 'right' | 'both';
  gannAnglesEnabled: boolean[];
  gannMainBold: boolean;
  gannAngleText: boolean;
  /** Gann square/box: grid divisions, diagonals, midlines, scale labels. */
  gannGrid: number;
  gannShowDiagonal: boolean;
  gannShowMidlines: boolean;
  gannShowLabels: boolean;
  /** Pattern tools: point labels, neckline, dashed AD/XD, ratios. */
  patternShowLabels: boolean;
  patternShowNeckline: boolean;
  patternShowDashed: boolean;
  patternShowRatios: boolean;
}

/** Horizontal tools show their price on the right Y axis. */
function isHorizontalTool(name: string): boolean {
  return (
    name === 'horizontalStraightLine' ||
    name === 'horizontalRayLine' ||
    name === 'horizontalSegment' ||
    name === 'priceLine'
  );
}

/**
 * Default for the Y-axis price label (needDefaultYAxisFigure).
 * simpleTag is the exception: its own Y-axis tag already shows the
 * price, so the default price mark would double up on the axis.
 */
function defaultPriceLabel(name: string): boolean {
  if (name === 'simpleTag') return false;
  return (
    isHorizontalTool(name) ||
    name === 'rectangle' ||
    isFibTool(name)
  );
}

/**
 * Parse a live line color back into hex + opacity. The chart stores the
 * line color as rgba (hex + opacity synthesized by stylesForOverlay);
 * old saves and plain hex colors read back as opacity 1.
 */
function parseLineColor(
  color: string | undefined,
): { color: string; opacity: number } {
  if (!color) return { color: DEFAULT_OVERLAY_STYLE.color, opacity: 1 };
  const m =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      color,
    );
  if (m) {
    const hex =
      '#' +
      [m[1], m[2], m[3]]
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('');
    return {
      color: hex,
      opacity: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  return { color, opacity: 1 };
}

/**
 * Map a live line style back to the floating bar's logical style.
 * 'dotted' is stored on the chart as dashed + dashedValue [1, 4];
 * plain dashed uses [6, 4].
 */
function logicalLineStyle(
  line: { style?: string; dashedValue?: number[] } | undefined,
): LineStyleId {
  if (line?.style !== 'dashed') return 'solid';
  const dv = line.dashedValue;
  return Array.isArray(dv) && dv[0] === 1 && dv[1] === 4
    ? 'dotted'
    : 'dashed';
}

/** klinecharts overlay styles for one drawing. */
function stylesForOverlay(
  style: OverlayStylePatch,
  fillOpacity?: number,
): DeepPartial<OverlayStyle> {
  const opacity = style.opacity ?? 1;
  const lineColor = hexToRgba(style.color, opacity);
  const dashed = style.style !== 'solid';
  const dashedValue = style.style === 'dotted' ? [1, 4] : [6, 4];
  const line = {
    color: lineColor,
    size: style.size,
    style: (dashed ? 'dashed' : 'solid') as 'solid' | 'dashed',
    ...(dashed ? { dashedValue } : {}),
  };
  return {
    line,
    rect: {
      style: 'stroke_fill',
      color: hexToRgba(
        style.color,
        fillOpacity ?? DEFAULT_OVERLAY_STYLE.fillOpacity,
      ),
      borderColor: lineColor,
      borderSize: style.size,
      borderStyle: (dashed ? 'dashed' : 'solid') as 'solid' | 'dashed',
      ...(dashed ? { borderDashedValue: dashedValue } : {}),
    },
  };
}

/** Whether a saved overlay belongs on the given interval's chart.
 *  undefined visibleIntervals = shown on every interval. */
function isInView(o: SavedOverlay, interval: string): boolean {
  return (
    o.visibleIntervals === undefined ||
    o.visibleIntervals.includes(interval)
  );
}

/** Deterministic id of a main line's accompanying text annotation. */
const textAnnotationId = (mainId: string): string => `${mainId}:text`;

/** Validate an extendData.text value into an OverlayText, or null. */
function parseOverlayText(v: unknown): OverlayText | null {
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
function parseVisibleIntervals(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is string => typeof x === 'string');
  return list.length > 0 ? list : [];
}

/** Only fully-drawn overlays (every point has timestamp + value) are saved.
 *  The measure tool is never saved. A text annotation is never saved
 *  when it is a companion (id `${mainId}:text`, rebuilt from its main
 *  line's text on restore); a STANDALONE text annotation (the 文字標註
 *  tool) is saved like any other drawing. */
function toSavedOverlay(o: Overlay): SavedOverlay | null {
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

const Chart = forwardRef<ChartHandle, ChartProps>(function Chart(
  {
    symbol,
    interval,
    activeTool,
    onToolDone,
    indicators,
    chartType,
    onConnectionStatus,
    continuousDraw = false,
    onHistoryChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const socketRef = useRef<BinanceKlineSocket | null>(null);
  const liveCallbackRef = useRef<((data: KLineData) => void) | null>(null);

  // Refs mirror the latest props so DataLoader closures (registered once)
  // always fetch/subscribe for the current symbol + interval.
  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);
  const onToolDoneRef = useRef(onToolDone);
  const onConnectionStatusRef = useRef(onConnectionStatus);
  const activeToolRef = useRef(activeTool);
  const continuousDrawRef = useRef(continuousDraw);
  const onHistoryChangeRef = useRef(onHistoryChange);
  symbolRef.current = symbol;
  intervalRef.current = interval;
  onToolDoneRef.current = onToolDone;
  onConnectionStatusRef.current = onConnectionStatus;
  activeToolRef.current = activeTool;
  continuousDrawRef.current = continuousDraw;
  onHistoryChangeRef.current = onHistoryChange;

  const suppressSaveRef = useRef(false);
  /** True while restoreDrawings / applySnapshot rebuilds overlays. */
  const restoringRef = useRef(false);
  /** Id of the overlay currently being drawn, if any. */
  const drawingIdRef = useRef<string | null>(null);
  /** Whether Ctrl/Cmd is currently held (temporarily inverts magnet). */
  const modifierRef = useRef(false);
  /** Timestamp of the last click that hit an overlay (measure dismiss). */
  const lastOverlayClickRef = useRef(0);
  /** Guards the fill-opacity slider against one history push per drag. */
  const sliderHistoryPushedRef = useRef(false);

  const [selected, setSelected] = useState<SelectedOverlayState | null>(null);
  const selectedRef = useRef<SelectedOverlayState | null>(null);
  /** Floating edit bar position (px, relative to the chart wrapper).
   *  null = default centered at the top. */
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  /** Which floating-bar popover is open, if any. */
  const [openPanel, setOpenPanel] = useState<
    'color' | 'lineStyle' | 'more' | null
  >(null);
  /** Outer chart wrapper (the floating bar's offset parent). */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  /** Floating bar element (measured while dragging). */
  const barRef = useRef<HTMLDivElement | null>(null);
  /** Active drag state for the floating bar grip. */
  const barDragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    barWidth: number;
    barHeight: number;
  } | null>(null);
  /** Shown when the current symbol's init load delivered no bars. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Last loaded / live candle, shown in the top-left legend overlay. */
  const [lastKline, setLastKline] = useState<KLineData | null>(null);
  /**
   * Candle under the crosshair, or null when the mouse is off the
   * chart. The legend shows this while hovering (TradingView-style)
   * and falls back to the last candle otherwise.
   */
  const [hoverKline, setHoverKline] = useState<KLineData | null>(null);
  /** Whether the last init load delivered data (gates the live socket). */
  const initOkRef = useRef(true);
  const setSelectedState = (s: SelectedOverlayState | null) => {
    selectedRef.current = s;
    setSelected(s);
    if (s === null) {
      // Deselected: the bar goes away, so its dragged position resets.
      setBarPos(null);
      setOpenPanel(null);
    }
  };

  // ---- magnet ----------------------------------------------------------

  const currentOverlayMode = (): OverlayMode => {
    const magnet = getMagnetMode();
    const invert = modifierRef.current;
    if (magnet === 'off') return invert ? 'weak_magnet' : 'normal';
    if (magnet === 'weak') return invert ? 'normal' : 'weak_magnet';
    return invert ? 'normal' : 'strong_magnet';
  };

  // ---- drawing persistence -------------------------------------------

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
    const chart = chartRef.current;
    if (!chart) return stored;
    const live = chart
      .getOverlays()
      .map(toSavedOverlay)
      .filter((o): o is SavedOverlay => o !== null);
    const liveIds = new Set(live.map((o) => o.id));
    return [...others.filter((o) => !liveIds.has(o.id)), ...live];
  };

  const persistDrawings = (symbol: string, interval: string) => {
    if (suppressSaveRef.current) return;
    const store = loadDrawingsStore();
    store[symbol] = readMergedList(symbol, interval);
    saveDrawingsStore(store);
  };

  // ---- text annotation (Phase 2) ---------------------------------------

  /** Midpoint of a two-point drawing — the text annotation's anchor.
   *  Single-point tools (priceLine, simpleTag, the standalone text
   *  annotation) anchor on their only point. */
  const annotationMidpoint = (
    points: Array<{ timestamp: number; value: number }>,
  ): { timestamp: number; value: number } | null => {
    if (points.length < 1) return null;
    const [a, b] = points;
    if (
      a.timestamp === undefined ||
      a.value === undefined
    ) {
      return null;
    }
    if (points.length < 2 || b === undefined) return a;
    if (
      b.timestamp === undefined ||
      b.value === undefined
    ) {
      return null;
    }
    return {
      timestamp: Math.round((a.timestamp + b.timestamp) / 2),
      value: (a.value + b.value) / 2,
    };
  };

  /**
   * Keep a main line's accompanying text annotation in sync: create it
   * when the line gains text, move it to the line's midpoint when the
   * line moves, match its visibility/zLevel, and delete it when the
   * line loses its text. No-op when nothing changed. The annotation is
   * never persisted on its own (toSavedOverlay excludes it) — it is
   * always rebuilt from the main line.
   */
  const syncTextAnnotation = (mainId: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    const main = chart.getOverlays({ id: mainId })[0];
    if (!main || main.name === TEXT_ANNOTATION_NAME) return;
    const ext = (main.extendData ?? {}) as Record<string, unknown>;
    const text = parseOverlayText(ext.text);
    const annId = textAnnotationId(mainId);
    const existing = chart.getOverlays({ id: annId })[0];
    if (!text) {
      if (existing) chart.removeOverlay({ id: annId });
      return;
    }
    const mid = annotationMidpoint(
      main.points as Array<{ timestamp: number; value: number }>,
    );
    if (!mid) return;
    const weight =
      text.bold && text.italic
        ? 'italic bold'
        : text.bold
          ? 'bold'
          : text.italic
            ? 'italic'
            : 'normal';
    if (existing) {
      const ep = existing.points[0];
      const samePoint =
        ep !== undefined &&
        ep.timestamp === mid.timestamp &&
        ep.value === mid.value;
      const sameVisible = existing.visible === main.visible;
      const sameZ = (existing.zLevel ?? 0) === (main.zLevel ?? 0);
      const sameText =
        JSON.stringify(
          (existing.extendData as Record<string, unknown> | undefined)?.text,
        ) === JSON.stringify(text);
      if (samePoint && sameVisible && sameZ && sameText) return;
      chart.overrideOverlay({
        id: annId,
        points: [mid],
        visible: main.visible,
        zLevel: main.zLevel ?? 0,
        fixedZLevel: true,
        styles: { text: { color: text.color, size: text.size, weight } },
        extendData: { text },
      });
      return;
    }
    chart.createOverlay({
      id: annId,
      groupId: main.groupId || mainId,
      name: TEXT_ANNOTATION_NAME,
      points: [mid],
      styles: { text: { color: text.color, size: text.size, weight } },
      lock: true,
      visible: main.visible,
      zLevel: main.zLevel ?? 0,
      fixedZLevel: true,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      extendData: { text },
    });
  };

  /** Rebuild every text annotation from its main line (after restore /
   *  undo / redo, which wipe and recreate the mains). */
  const syncAllTextAnnotations = () => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const o of chart.getOverlays()) {
      if (o.name === TEXT_ANNOTATION_NAME || o.name === MEASURE_NAME) {
        continue;
      }
      syncTextAnnotation(o.id);
    }
  };

  // ---- undo / redo -----------------------------------------------------

  const undoStackRef = useRef<SavedOverlay[][]>([]);
  const redoStackRef = useRef<SavedOverlay[][]>([]);
  /** Pre-move snapshot, taken at press start and pushed at move end
   *  only if the overlay actually moved (see onPressedMoveEnd). */
  const moveStartSnapshotRef = useRef<SavedOverlay[] | null>(null);

  const emitHistoryChange = () => {
    onHistoryChangeRef.current?.(
      undoStackRef.current.length > 0,
      redoStackRef.current.length > 0,
    );
  };

  const pushHistory = () => {
    undoStackRef.current.push(
      readMergedList(symbolRef.current, intervalRef.current),
    );
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    emitHistoryChange();
  };

  /**
   * Reset klinecharts' internal "clicked overlay" record after overlays
   * are removed and recreated with the same ids (undo/redo, restore).
   * Without this, the chart still believes the (removed) overlay is
   * the clicked one, so the next click on the recreated overlay fires
   * neither onSelected nor onDeselected — setClickOverlayInfo
   * short-circuits when id + figure match — and the line looks
   * unclickable until the user clicks empty space first (verified
   * with a headless probe). getChartStore is not in the public types
   * (10.1.1), so this is guarded: if a future klinecharts removes it,
   * the reset silently no-ops and selection still recovers after one
   * empty-space click.
   */
  const resetChartClickOverlay = () => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const store = (
        chart as unknown as {
          getChartStore?: () => {
            setClickOverlayInfo?: (
              info: {
                paneId: string;
                overlay: null;
                figureType: string;
                figureIndex: number;
                figure: null;
              },
              onSelected: () => boolean,
              onDeselected: () => boolean,
            ) => void;
          };
        }
      ).getChartStore?.();
      store?.setClickOverlayInfo?.(
        {
          paneId: 'candle_pane',
          overlay: null,
          figureType: 'none',
          figureIndex: -1,
          figure: null,
        },
        () => false,
        () => false,
      );
    } catch {
      // Internal API unavailable — see comment above.
    }
  };

  /**
   * Finish an in-progress multi-point drawing (path/pen) the way the
   * library's own double-click handler does: forceComplete the
   * overlay, complete the chart store's progress record, then run its
   * onDrawEnd (persist + disarm). Returns false when the overlay is
   * not a finishable in-progress path/pen (fewer than 2 points, or
   * the internal API is unavailable) — the caller then cancels it
   * instead. Guarded like resetChartClickOverlay: if a future
   * klinecharts removes these internals, the finish silently no-ops.
   */
  const finishDrawing = (id: string): boolean => {
    const chart = chartRef.current;
    if (!chart) return false;
    try {
      const overlay = chart.getOverlays({ id })[0];
      if (!overlay) return false;
      if (overlay.name !== 'path' && overlay.name !== 'pen') return false;
      const complete = overlay.points.filter(
        (p) => p.timestamp !== undefined && p.value !== undefined,
      );
      if (complete.length < 2) return false;
      const imp = overlay as unknown as {
        forceComplete?: () => void;
        onDrawEnd?: (e: { chart: Chart; overlay: Overlay }) => void;
      };
      const store = (
        chart as unknown as {
          getChartStore?: () => {
            progressOverlayComplete?: () => void;
            getProgressOverlayInfo?: () => unknown;
          };
        }
      ).getChartStore?.();
      if (
        typeof imp.forceComplete !== 'function' ||
        typeof store?.progressOverlayComplete !== 'function' ||
        store?.getProgressOverlayInfo?.() == null
      ) {
        return false;
      }
      imp.forceComplete();
      store.progressOverlayComplete();
      imp.onDrawEnd?.({ chart, overlay });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Programmatic deselect: clear the React selection AND the chart's
   * stored click-overlay record, so the next click on the same drawing
   * still fires onSelected — the store short-circuits when id +
   * figureType + figureIndex are unchanged (the Phase 2 undo case;
   * a drag + Escape leaves the same stale record behind).
   * Never call from the chart-initiated onDeselected path: the store
   * is mid-flight there and resetting would clobber the record the
   * in-progress click just stored.
   */
  const deselect = () => {
    setSelectedState(null);
    resetChartClickOverlay();
  };

  const applySnapshot = (snapshot: SavedOverlay[]) => {
    const chart = chartRef.current;
    if (!chart) return;
    const symbol = symbolRef.current;
    const interval = intervalRef.current;
    const store = loadDrawingsStore();
    store[symbol] = snapshot;
    saveDrawingsStore(store);
    restoringRef.current = true;
    suppressSaveRef.current = true;
    try {
      chart.removeOverlay();
      for (const o of snapshot.filter((o) => isInView(o, interval))) {
        chart.createOverlay(overlayCreate(o));
      }
      syncAllTextAnnotations();
      resetChartClickOverlay();
    } finally {
      suppressSaveRef.current = false;
      restoringRef.current = false;
    }
    setSelectedState(null);
  };

  const undo = () => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(
      readMergedList(symbolRef.current, intervalRef.current),
    );
    applySnapshot(prev);
    emitHistoryChange();
  };

  const redo = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(
      readMergedList(symbolRef.current, intervalRef.current),
    );
    applySnapshot(next);
    emitHistoryChange();
  };

  // ---- overlay creation -------------------------------------------------

  const overlayCreate = (saved: SavedOverlay): OverlayCreate => {
    const style = saved.styles ?? getLastOverlayStyle();
    const ext: Record<string, unknown> = { ...(saved.extendData ?? {}) };
    // Legacy v2 fields never go back into extendData.
    delete ext.scope;
    delete ext.interval;
    // Visibility + text are first-class SavedOverlay fields (v3).
    if (saved.visibleIntervals !== undefined) {
      ext.visibleIntervals = saved.visibleIntervals;
    } else {
      delete ext.visibleIntervals;
    }
    if (saved.text) {
      ext.text = saved.text;
    } else {
      delete ext.text;
    }
    const isRect = saved.name === 'rectangle';
    const isFib = isFibTool(saved.name);
    const isShape = saved.name === 'ellipse' || saved.name === 'triangle';
    if (isRect) {
      ext.fillOpacity =
        typeof ext.fillOpacity === 'number'
          ? ext.fillOpacity
          : getLastOverlayStyle().fillOpacity;
      ext.rectBorder = ext.rectBorder !== false;
      ext.rectMiddleLine = ext.rectMiddleLine === true;
      ext.rectFill = ext.rectFill === true;
    }
    if (isShape) {
      ext.fillOpacity =
        typeof ext.fillOpacity === 'number'
          ? ext.fillOpacity
          : getLastOverlayStyle().fillOpacity;
      ext.fill = ext.fill === true;
    }
    if (isFib) {
      // Levels: keep a valid saved list, else the tool's default
      // (spiral has no levels). Level colours likewise. Per-level
      // on/off: parallel to levels, missing entries mean enabled.
      if (saved.name !== 'fibSpiral') {
        ext.levels = fibLevelsOf({ extendData: ext }, saved.name);
        const levels = ext.levels as number[];
        const enabled = Array.isArray(ext.levelEnabled)
          ? (ext.levelEnabled as unknown[])
          : [];
        ext.levelEnabled = levels.map((_, i) => enabled[i] !== false);
      }
      ext.levelColors =
        Array.isArray(ext.levelColors) &&
        (ext.levelColors as unknown[]).every((v) => typeof v === 'string')
          ? ext.levelColors
          : FIB_LEVEL_COLORS;
      if (
        saved.name === 'fibonacciRetracement' ||
        saved.name === 'fibChannel' ||
        saved.name === 'fibFan'
      ) {
        ext.fibExtend = fibExtendOf({ extendData: ext }, saved.name);
      }
      if (saved.name === 'fibonacciRetracement') {
        ext.fibBackground = ext.fibBackground === true;
        ext.showTrendline = ext.showTrendline === true;
      }
      ext.fibLevelText = ext.fibLevelText !== false;
    }
    if (isPitchforkTool(saved.name)) {
      ext.pitchExtend = pitchExtendOf({ extendData: ext });
      const opts = pitchOptionsOf({ extendData: ext });
      ext.showMedian = opts.showMedian;
      ext.showOuter = opts.showOuter;
      ext.medianBold = opts.medianBold;
    }
    if (isGannTool(saved.name)) {
      ext.gannExtend = gannExtendOf({ extendData: ext });
      const opts = gannOptionsOf({ extendData: ext }, saved.name);
      ext.gannAnglesEnabled = opts.anglesEnabled;
      ext.gannMainBold = opts.mainBold;
      ext.gannAngleText = opts.angleText;
      ext.gannGrid = opts.grid;
      ext.gannShowDiagonal = opts.showDiagonal;
      ext.gannShowMidlines = opts.showMidlines;
      ext.gannShowLabels = opts.showLabels;
    }
    if (isPatternTool(saved.name)) {
      const opts = patternOptionsOf({ extendData: ext });
      ext.patternShowLabels = opts.showLabels;
      ext.patternShowNeckline = opts.showNeckline;
      ext.patternShowDashed = opts.showDashed;
      ext.patternShowRatios = opts.showRatios;
    }
    // Price label (needDefaultYAxisFigure). Horizontal tools, rectangles
    // and Fibonacci default to on; other line tools default to off;
    // simpleTag's own Y-axis tag already shows the price (see
    // defaultPriceLabel).
    const priceLabel =
      ext.priceLabel === false
        ? false
        : ext.priceLabel === true
          ? true
          : defaultPriceLabel(saved.name);
    ext.priceLabel = priceLabel;
    if (saved.name === MEASURE_NAME) {
      ext.intervalMs = INTERVAL_MS[intervalRef.current] ?? 0;
    }
    return {
      ...(saved.id ? { id: saved.id } : {}),
      name: saved.name,
      ...(saved.points.length > 0
        ? {
            points: saved.points.map((p) => ({
              timestamp: p.timestamp,
              value: p.value,
            })),
          }
        : {}),
      mode: currentOverlayMode(),
      needDefaultYAxisFigure: priceLabel,
      // simpleTag's built-in template has no point figure (OverlayImp
      // default false) and the text annotation's template turns it off
      // for companions — both need one as standalone drawings, or they
      // can never be selected again after placement.
      ...(saved.name === 'simpleTag' ||
      saved.name === TEXT_ANNOTATION_NAME
        ? { needDefaultPointFigure: true }
        : {}),
      styles: stylesForOverlay(
        style,
        typeof ext.fillOpacity === 'number' ? ext.fillOpacity : undefined,
      ),
      lock: saved.lock ?? false,
      visible: saved.visible ?? true,
      // Declared draw level; fixedZLevel keeps hover from temporarily
      // raising an overlay above the order the user chose.
      zLevel: saved.zLevel ?? 0,
      fixedZLevel: true,
      extendData: ext,
      onDrawStart: (e) => {
        if (restoringRef.current) return;
        drawingIdRef.current = e.overlay.id;
      },
      onDrawEnd: (e) => {
        if (restoringRef.current) return;
        persistDrawings(symbolRef.current, intervalRef.current);
        drawingIdRef.current = null;
        // A freshly placed standalone text annotation has no text yet:
        // open the dialog on the 文字 tab so the user can type it.
        // (Companion annotations are never drawn interactively.)
        if (
          e.overlay.name === TEXT_ANNOTATION_NAME &&
          !e.overlay.id.endsWith(':text')
        ) {
          pendingTextIdRef.current = e.overlay.id;
          openDialogFor(e.overlay.id, 'text');
          onToolDoneRef.current();
          return;
        }
        if (continuousDrawRef.current && activeToolRef.current) {
          armOverlay(activeToolRef.current);
        } else {
          onToolDoneRef.current();
        }
      },
      onRemoved: () => {
        if (restoringRef.current || suppressSaveRef.current) return;
        persistDrawings(symbolRef.current, intervalRef.current);
      },
      onPressedMoveStart: () => {
        if (restoringRef.current) return;
        if (saved.name === MEASURE_NAME) return;
        // Record the pre-move snapshot; history is pushed at move end
        // only if the overlay actually moved. A plain click on a
        // drawing starts a press but moves nothing — pushing there
        // would silently consume one undo step.
        moveStartSnapshotRef.current = readMergedList(
          symbolRef.current,
          intervalRef.current,
        );
      },
      onPressedMoveEnd: (e) => {
        if (restoringRef.current || suppressSaveRef.current) return;
        const snapshot = moveStartSnapshotRef.current;
        moveStartSnapshotRef.current = null;
        if (snapshot) {
          const before = snapshot.find((o) => o.id === e.overlay.id);
          const after = toSavedOverlay(e.overlay);
          if (
            before !== undefined &&
            after !== null &&
            JSON.stringify(before.points) !== JSON.stringify(after.points)
          ) {
            undoStackRef.current.push(snapshot);
            if (undoStackRef.current.length > MAX_HISTORY) {
              undoStackRef.current.shift();
            }
            redoStackRef.current = [];
            emitHistoryChange();
          }
        }
        syncTextAnnotation(e.overlay.id);
        persistDrawings(symbolRef.current, intervalRef.current);
      },
      onDoubleClick: (e) => {
        if (restoringRef.current) return;
        if (e.overlay.name === MEASURE_NAME) return;
        if (drawingIdRef.current === e.overlay.id) return;
        if (
          e.overlay.points.some(
            (p) => p.timestamp === undefined || p.value === undefined,
          )
        ) {
          return;
        }
        openDialogFor(e.overlay.id, 'style');
      },
      onSelected: (e) => {
        if (restoringRef.current) return;
        if (e.overlay.name === MEASURE_NAME) return;
        refreshSelected(e.overlay.id);
      },
      onDeselected: (e) => {
        if (restoringRef.current) return;
        if (selectedRef.current?.id === e.overlay.id) setSelectedState(null);
      },
      onClick: () => {
        lastOverlayClickRef.current = Date.now();
      },
    };
  };

  /** Arm one drawing: remove any unfinished overlay, then create a new one. */
  const armOverlay = (tool: DrawingTool) => {
    const chart = chartRef.current;
    if (!chart) return;
    if (drawingIdRef.current) {
      chart.removeOverlay({ id: drawingIdRef.current });
      drawingIdRef.current = null;
    }
    pushHistory();
    const style = getLastOverlayStyle();
    const draft: SavedOverlay = {
      id: '',
      name: tool,
      points: [],
      styles: {
        color: style.color,
        size: style.size,
        style: style.style,
        opacity: style.opacity,
      },
      extendData:
        tool === 'rectangle' ? { fillOpacity: style.fillOpacity } : undefined,
    };
    const id = chart.createOverlay(overlayCreate(draft));
    if (typeof id === 'string') drawingIdRef.current = id;
  };

  const restoreDrawings = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const symbol = symbolRef.current;
    const interval = intervalRef.current;
    const list = (loadDrawingsStore()[symbol] ?? []).filter((o) =>
      isInView(o, interval),
    );
    // Idempotent: getBars("init") can fire more than once per symbol/
    // timeframe change (setSymbol + setPeriod each trigger a load), so
    // always wipe first — otherwise every load duplicates the drawings.
    restoringRef.current = true;
    suppressSaveRef.current = true;
    try {
      chart.removeOverlay();
      for (const o of list) {
        const saved: SavedOverlay = {
          ...o,
          id: o.id || newOverlayId(),
          name:
            o.name === 'fibonacciLine' ? 'fibonacciRetracement' : o.name,
        };
        chart.createOverlay(overlayCreate(saved));
      }
      syncAllTextAnnotations();
      resetChartClickOverlay();
    } finally {
      suppressSaveRef.current = false;
      restoringRef.current = false;
    }
  };

  // ---- selection + edit bar --------------------------------------------

  const refreshSelected = (id: string | null) => {
    if (!id) {
      setSelectedState(null);
      return;
    }
    const chart = chartRef.current;
    const o = chart?.getOverlays({ id })[0];
    if (!o) {
      setSelectedState(null);
      return;
    }
    const line = o.styles?.line;
    const ext = (o.extendData ?? {}) as Record<string, unknown>;
    const { color, opacity } = parseLineColor(line?.color);
    const points = (
      o.points as Array<{ timestamp?: number; value?: number }>
    ).filter(
      (p): p is { timestamp: number; value: number } =>
        p.timestamp !== undefined && p.value !== undefined,
    );
    const fibLevelColors = Array.isArray(ext.levelColors)
      ? (ext.levelColors as unknown[]).map((c, i) =>
          typeof c === 'string'
            ? c
            : FIB_LEVEL_COLORS[i % FIB_LEVEL_COLORS.length],
        )
      : [...FIB_LEVEL_COLORS];
    const fibLevels = fibLevelsOf({ extendData: ext }, o.name);
    const fibLevelEnabled = fibLevels.map((_, i) => {
      const list = Array.isArray(ext.levelEnabled)
        ? (ext.levelEnabled as unknown[])
        : [];
      return list[i] !== false;
    });
    const pitchOpts = isPitchforkTool(o.name)
      ? pitchOptionsOf({ extendData: ext })
      : { showMedian: true, showOuter: true, medianBold: false };
    const gannOpts = isGannTool(o.name)
      ? gannOptionsOf({ extendData: ext }, o.name)
      : {
          anglesEnabled: GANN_FAN_ANGLES.map(() => true),
          mainBold: false,
          angleText: true,
          grid: 4,
          showDiagonal: true,
          showMidlines: false,
          showLabels: true,
        };
    const patternOpts = isPatternTool(o.name)
      ? patternOptionsOf({ extendData: ext })
      : {
          showLabels: true,
          showNeckline: true,
          showDashed: true,
          showRatios: true,
        };
    setSelectedState({
      id: o.id,
      name: o.name,
      color,
      opacity,
      size: line?.size ?? 1,
      style: logicalLineStyle(line),
      lock: o.lock,
      visible: o.visible,
      visibleIntervals: parseVisibleIntervals(ext.visibleIntervals),
      fillOpacity:
        typeof ext.fillOpacity === 'number'
          ? ext.fillOpacity
          : DEFAULT_OVERLAY_STYLE.fillOpacity,
      isRect: o.name === 'rectangle',
      zLevel: o.zLevel ?? 0,
      points,
      text: parseOverlayText(ext.text),
      extend: extendForOverlay(o.name, points),
      priceLabel:
        ext.priceLabel === false
          ? false
          : ext.priceLabel === true
            ? true
            : defaultPriceLabel(o.name),
      rectBorder: ext.rectBorder !== false,
      rectMiddleLine: ext.rectMiddleLine === true,
      rectFill: ext.rectFill === true,
      fill: ext.fill === true,
      fibTrendline: ext.showTrendline === true,
      fibLevelColors,
      fibExtend: fibExtendOf({ extendData: ext }, o.name),
      fibBackground: ext.fibBackground === true,
      fibLevelText: ext.fibLevelText !== false,
      fibLevels,
      fibLevelEnabled,
      pitchExtend: pitchExtendOf({ extendData: ext }),
      showMedian: pitchOpts.showMedian,
      showOuter: pitchOpts.showOuter,
      medianBold: pitchOpts.medianBold,
      gannExtend: gannExtendOf({ extendData: ext }),
      gannAnglesEnabled: gannOpts.anglesEnabled,
      gannMainBold: gannOpts.mainBold,
      gannAngleText: gannOpts.angleText,
      gannGrid: gannOpts.grid,
      gannShowDiagonal: gannOpts.showDiagonal,
      gannShowMidlines: gannOpts.showMidlines,
      gannShowLabels: gannOpts.showLabels,
      patternShowLabels: patternOpts.showLabels,
      patternShowNeckline: patternOpts.showNeckline,
      patternShowDashed: patternOpts.showDashed,
      patternShowRatios: patternOpts.showRatios,
    });
  };

  const applyEdit = (
    patch: Partial<Omit<SelectedOverlayState, 'id' | 'name' | 'isRect'>>,
    pushHist = true,
  ) => {
    const cur = selectedRef.current;
    if (!cur) return;
    const chart = chartRef.current;
    if (!chart) return;
    const o = chart.getOverlays({ id: cur.id })[0];
    if (!o) {
      deselect();
      return;
    }
    if (pushHist) pushHistory();
    const next = { ...cur, ...patch };
    const ext: Record<string, unknown> = {
      ...((o.extendData ?? {}) as Record<string, unknown>),
    };
    delete ext.scope;
    delete ext.interval;
    // overrideOverlay deep-merges extendData (klinecharts merge()),
    // so a deleted key would survive on the live overlay: clear a
    // field by assigning undefined, which the merge does copy over.
    if (next.visibleIntervals !== undefined) {
      ext.visibleIntervals = next.visibleIntervals;
    } else {
      ext.visibleIntervals = undefined;
    }
    if (next.text) ext.text = next.text;
    else ext.text = undefined;
    ext.priceLabel = next.priceLabel;
    if (next.isRect) {
      ext.rectBorder = next.rectBorder;
      ext.rectMiddleLine = next.rectMiddleLine;
      ext.rectFill = next.rectFill;
      ext.fillOpacity = next.fillOpacity;
    }
    if (next.name === 'ellipse' || next.name === 'triangle') {
      ext.fill = next.fill;
      ext.fillOpacity = next.fillOpacity;
    }
    if (isFibTool(next.name)) {
      if (next.name !== 'fibSpiral') {
        ext.levels = next.fibLevels;
        ext.levelEnabled = next.fibLevelEnabled;
      }
      // The floating-bar colour is the overlay's main colour, but the
      // level lines are drawn in per-level colours, so a colour pick
      // would otherwise change nothing visible on a fib tool. For the
      // new fib tools, sync the primary (first) level's colour with
      // the pick so the change shows on the chart. The spiral draws
      // its line in the main colour already, and the retracement keeps
      // its existing behaviour (its trend line is in the main colour).
      let levelColors = next.fibLevelColors;
      if (
        patch.color !== undefined &&
        next.name !== 'fibSpiral' &&
        next.name !== 'fibonacciRetracement' &&
        levelColors
      ) {
        levelColors = [...levelColors];
        levelColors[0] = next.color;
      }
      ext.levelColors = levelColors;
      if (
        next.name === 'fibonacciRetracement' ||
        next.name === 'fibChannel' ||
        next.name === 'fibFan'
      ) {
        ext.fibExtend = next.fibExtend;
      }
      if (next.name === 'fibonacciRetracement') {
        ext.fibBackground = next.fibBackground;
        ext.showTrendline = next.fibTrendline;
      }
      ext.fibLevelText = next.fibLevelText;
    }
    if (isPitchforkTool(next.name)) {
      ext.pitchExtend = next.pitchExtend;
      ext.showMedian = next.showMedian;
      ext.showOuter = next.showOuter;
      ext.medianBold = next.medianBold;
    }
    if (isGannTool(next.name)) {
      ext.gannExtend = next.gannExtend;
      ext.gannAnglesEnabled = next.gannAnglesEnabled;
      ext.gannMainBold = next.gannMainBold;
      ext.gannAngleText = next.gannAngleText;
      ext.gannGrid = next.gannGrid;
      ext.gannShowDiagonal = next.gannShowDiagonal;
      ext.gannShowMidlines = next.gannShowMidlines;
      ext.gannShowLabels = next.gannShowLabels;
    }
    if (isPatternTool(next.name)) {
      ext.patternShowLabels = next.patternShowLabels;
      ext.patternShowNeckline = next.patternShowNeckline;
      ext.patternShowDashed = next.patternShowDashed;
      ext.patternShowRatios = next.patternShowRatios;
    }
    chart.overrideOverlay({
      id: cur.id,
      styles: stylesForOverlay(
        {
          color: next.color,
          size: next.size,
          style: next.style,
          opacity: next.opacity,
        },
        next.fillOpacity,
      ),
      lock: next.lock,
      visible: next.visible,
      needDefaultYAxisFigure: next.priceLabel,
      extendData: ext,
      zLevel: next.zLevel,
      fixedZLevel: true,
    });
    if (
      patch.color !== undefined ||
      patch.size !== undefined ||
      patch.style !== undefined ||
      patch.fillOpacity !== undefined ||
      patch.opacity !== undefined
    ) {
      saveLastOverlayStyle({
        color: next.color,
        size: next.size,
        style: next.style,
        opacity: next.opacity,
        fillOpacity: next.fillOpacity,
      });
    }
    syncTextAnnotation(cur.id);
    // Persist BEFORE removing a now-hidden overlay: readMergedList can
    // only see the new visibleIntervals while it is still live; once
    // removed, the old stored copy (still in view) would drop it.
    persistDrawings(symbolRef.current, intervalRef.current);
    if (
      next.visibleIntervals !== undefined &&
      !next.visibleIntervals.includes(intervalRef.current)
    ) {
      chart.removeOverlay({ groupId: cur.id });
      deselect();
      return;
    }
    refreshSelected(cur.id);
  };

  const deleteSelected = () => {
    const cur = selectedRef.current;
    if (!cur) return;
    const chart = chartRef.current;
    if (!chart) return;
    pushHistory();
    // groupId removes the main line and its text annotation together.
    chart.removeOverlay({ groupId: cur.id });
    deselect();
    persistDrawings(symbolRef.current, intervalRef.current);
  };

  const copySelected = () => {
    const cur = selectedRef.current;
    if (!cur) return;
    const chart = chartRef.current;
    if (!chart) return;
    const o = chart.getOverlays({ id: cur.id })[0];
    if (!o) return;
    const saved = toSavedOverlay(o);
    if (!saved) return;
    pushHistory();
    // In-place copy: same points, on top of the original (max zLevel + 1)
    // so it can be grabbed and dragged away. It stays selected.
    const maxZ = chart
      .getOverlays()
      .reduce((m, ov) => Math.max(m, ov.zLevel ?? 0), 0);
    const copy: SavedOverlay = {
      ...saved,
      id: newOverlayId(),
      lock: false,
      zLevel: maxZ + 1,
    };
    const id = chart.createOverlay(overlayCreate(copy));
    if (typeof id === 'string') {
      syncTextAnnotation(id);
      refreshSelected(id);
    }
    persistDrawings(symbolRef.current, intervalRef.current);
  };

  /** Move the selected overlay above every other overlay. */
  const bringToFront = () => {
    const chart = chartRef.current;
    if (!chart || !selectedRef.current) return;
    const max = chart
      .getOverlays()
      .reduce((m, o) => Math.max(m, o.zLevel ?? 0), 0);
    applyEdit({ zLevel: max + 1 });
  };

  /** Move the selected overlay below every other overlay. */
  const sendToBack = () => {
    const chart = chartRef.current;
    if (!chart || !selectedRef.current) return;
    const min = chart
      .getOverlays()
      .reduce((m, o) => Math.min(m, o.zLevel ?? 0), 0);
    applyEdit({ zLevel: min - 1 });
  };

  // ---- settings dialog (Phase 2) --------------------------------------

  const [dialogDraft, setDialogDraft] = useState<OverlayDialogDraft | null>(
    null,
  );
  const [dialogTab, setDialogTab] = useState<DialogTab>('style');
  /** Loaded candles at dialog-open time (coordinates tab: bar -> date). */
  const [dialogBars, setDialogBars] = useState<Array<{ timestamp: number }>>(
    [],
  );
  const dialogOpenRef = useRef(false);
  /**
   * Id of a just-drawn standalone text annotation whose dialog is
   * open. If the user closes it without typing any text, the empty
   * annotation is removed (it would otherwise be invisible and
   * unselectable forever).
   */
  const pendingTextIdRef = useRef<string | null>(null);

  /** Build the dialog draft from the live overlay (same fields as
   *  refreshSelected, plus the current points for the coordinates tab). */
  const dialogDraftFromSelected = (
    cur: SelectedOverlayState,
  ): OverlayDialogDraft => ({
    color: cur.color,
    opacity: cur.opacity,
    size: cur.size,
    style: cur.style,
    extend: cur.extend,
    priceLabel: cur.priceLabel,
    rectBorder: cur.rectBorder,
    rectMiddleLine: cur.rectMiddleLine,
    rectFill: cur.rectFill,
    fill: cur.fill,
    fillOpacity: cur.fillOpacity,
    fibTrendline: cur.fibTrendline,
    fibLevelColors: [...cur.fibLevelColors],
    fibExtend: cur.fibExtend,
    fibBackground: cur.fibBackground,
    fibLevelText: cur.fibLevelText,
    fibLevels: [...cur.fibLevels],
    fibLevelEnabled: [...cur.fibLevelEnabled],
    pitchExtend: cur.pitchExtend,
    showMedian: cur.showMedian,
    showOuter: cur.showOuter,
    medianBold: cur.medianBold,
    gannExtend: cur.gannExtend,
    gannAnglesEnabled: [...cur.gannAnglesEnabled],
    gannMainBold: cur.gannMainBold,
    gannAngleText: cur.gannAngleText,
    gannGrid: cur.gannGrid,
    gannShowDiagonal: cur.gannShowDiagonal,
    gannShowMidlines: cur.gannShowMidlines,
    gannShowLabels: cur.gannShowLabels,
    patternShowLabels: cur.patternShowLabels,
    patternShowNeckline: cur.patternShowNeckline,
    patternShowDashed: cur.patternShowDashed,
    patternShowRatios: cur.patternShowRatios,
    text: cur.text ? { ...cur.text } : null,
    points: cur.points.map((p) => ({ ...p })),
    visibleIntervals: cur.visibleIntervals
      ? [...cur.visibleIntervals]
      : undefined,
  });

  const openDialogFor = (id: string, tab: DialogTab) => {
    refreshSelected(id);
    const cur = selectedRef.current;
    if (!cur || cur.id !== id) return;
    setDialogBars(chartRef.current?.getDataList() ?? []);
    setDialogTab(tab);
    const draft = dialogDraftFromSelected(cur);
    // A fresh standalone text annotation has no text yet: pre-fill the
    // default so the 文字 tab's inputs are enabled immediately.
    if (cur.name === TEXT_ANNOTATION_NAME && draft.text === null) {
      draft.text = { ...DEFAULT_OVERLAY_TEXT };
    }
    setDialogDraft(draft);
    dialogOpenRef.current = true;
  };

  const closeDialog = () => {
    const pendingId = pendingTextIdRef.current;
    pendingTextIdRef.current = null;
    if (pendingId) {
      const chart = chartRef.current;
      const o = chart?.getOverlays({ id: pendingId })[0];
      const ext = (o?.extendData ?? {}) as Record<string, unknown>;
      if (o && parseOverlayText(ext.text) === null) {
        chart?.removeOverlay({ id: pendingId });
        if (selectedRef.current?.id === pendingId) deselect();
        persistDrawings(symbolRef.current, intervalRef.current);
      }
    }
    setDialogDraft(null);
    dialogOpenRef.current = false;
  };

  /**
   * Apply a confirmed dialog draft as one history step: style/price
   * label/rect/fib options via overrideOverlay, coordinates via
   * overrideOverlay points, visibility via visibleIntervals, and an
   * extend change via delete + recreate (same id, points and styles,
   * new name). Persist BEFORE removing a now-hidden overlay (see
   * applyEdit).
   */
  const applyDialog = (draft: OverlayDialogDraft) => {
    const cur = selectedRef.current;
    if (!cur) return;
    const chart = chartRef.current;
    if (!chart) return;
    const o = chart.getOverlays({ id: cur.id })[0];
    if (!o) {
      deselect();
      return;
    }
    // A standalone text annotation confirmed with no text is invisible
    // and unselectable: remove it instead of saving an empty label.
    if (
      o.name === TEXT_ANNOTATION_NAME &&
      (!draft.text || draft.text.content.trim() === '')
    ) {
      pushHistory();
      chart.removeOverlay({ id: cur.id });
      deselect();
      persistDrawings(symbolRef.current, intervalRef.current);
      closeDialog();
      return;
    }
    pushHistory();
    const family: LineFamily | null = lineFamilyOf(o.name);
    const currentExtend = extendForOverlay(
      o.name,
      o.points as Array<{ timestamp: number; value: number }>,
    );
    const ext: Record<string, unknown> = {
      ...((o.extendData ?? {}) as Record<string, unknown>),
    };
    delete ext.scope;
    delete ext.interval;
    // overrideOverlay deep-merges extendData (see applyEdit).
    if (draft.visibleIntervals !== undefined) {
      ext.visibleIntervals = draft.visibleIntervals;
    } else {
      ext.visibleIntervals = undefined;
    }
    if (draft.text) ext.text = draft.text;
    else ext.text = undefined;
    ext.priceLabel = draft.priceLabel;
    if (o.name === 'rectangle') {
      ext.rectBorder = draft.rectBorder;
      ext.rectMiddleLine = draft.rectMiddleLine;
      ext.rectFill = draft.rectFill;
      ext.fillOpacity = draft.fillOpacity;
    }
    if (o.name === 'ellipse' || o.name === 'triangle') {
      ext.fill = draft.fill;
      ext.fillOpacity = draft.fillOpacity;
    }
    if (isFibTool(o.name)) {
      if (o.name !== 'fibSpiral') {
        ext.levels = draft.fibLevels;
        ext.levelEnabled = draft.fibLevelEnabled;
      }
      ext.levelColors = draft.fibLevelColors;
      if (
        o.name === 'fibonacciRetracement' ||
        o.name === 'fibChannel' ||
        o.name === 'fibFan'
      ) {
        ext.fibExtend = draft.fibExtend;
      }
      if (o.name === 'fibonacciRetracement') {
        ext.fibBackground = draft.fibBackground;
        ext.showTrendline = draft.fibTrendline;
      }
      ext.fibLevelText = draft.fibLevelText;
    }
    if (isPitchforkTool(o.name)) {
      ext.pitchExtend = draft.pitchExtend;
      ext.showMedian = draft.showMedian;
      ext.showOuter = draft.showOuter;
      ext.medianBold = draft.medianBold;
    }
    if (isGannTool(o.name)) {
      ext.gannExtend = draft.gannExtend;
      ext.gannAnglesEnabled = draft.gannAnglesEnabled;
      ext.gannMainBold = draft.gannMainBold;
      ext.gannAngleText = draft.gannAngleText;
      ext.gannGrid = draft.gannGrid;
      ext.gannShowDiagonal = draft.gannShowDiagonal;
      ext.gannShowMidlines = draft.gannShowMidlines;
      ext.gannShowLabels = draft.gannShowLabels;
    }
    if (isPatternTool(o.name)) {
      ext.patternShowLabels = draft.patternShowLabels;
      ext.patternShowNeckline = draft.patternShowNeckline;
      ext.patternShowDashed = draft.patternShowDashed;
      ext.patternShowRatios = draft.patternShowRatios;
    }
    const points = draft.points.map((p) => ({
      timestamp: p.timestamp,
      value: p.value,
    }));
    const styles = stylesForOverlay(
      {
        color: draft.color,
        size: draft.size,
        style: draft.style,
        opacity: draft.opacity,
      },
      draft.fillOpacity,
    );
    // klinecharts overrideOverlay deep-merges extendData arrays by
    // index (merge() recurses into arrays), so a SHORTER levels list
    // would keep the old tail (e.g. [0,0.5,1] over 9 levels leaves 6
    // stale entries). A levels change therefore recreates the overlay
    // (same id), like an extend change, so the new list replaces the
    // old one wholesale.
    const levelsChanged =
      isFibTool(o.name) &&
      o.name !== 'fibSpiral' &&
      JSON.stringify(fibLevelsOf(o, o.name)) !==
        JSON.stringify(draft.fibLevels);
    if (
      (family !== null && draft.extend !== currentExtend) ||
      levelsChanged
    ) {
      // Extend changes the overlay name: delete + recreate, keeping the
      // same id, points and styles, ordered so the ray still points
      // from p0 through p1. A levels change keeps the same name and
      // point order (fib tools have no extend family).
      const ordered =
        family !== null && draft.extend !== currentExtend
          ? orderPointsForExtend(points, draft.extend, family)
          : points;
      const newName =
        family !== null && draft.extend !== currentExtend
          ? overlayNameForExtend(family, draft.extend)
          : o.name;
      const recreate: SavedOverlay = {
        id: cur.id,
        name: newName,
        points: ordered,
        styles: {
          color: draft.color,
          size: draft.size,
          style: draft.style,
          opacity: draft.opacity,
        },
        lock: o.lock || undefined,
        visible: o.visible === false ? false : undefined,
        extendData: ext,
        visibleIntervals: draft.visibleIntervals
          ? [...draft.visibleIntervals]
          : undefined,
        text: draft.text ? { ...draft.text } : undefined,
        zLevel: o.zLevel ?? 0,
      };
      suppressSaveRef.current = true;
      chart.removeOverlay({ groupId: cur.id });
      suppressSaveRef.current = false;
      chart.createOverlay(overlayCreate(recreate));
      syncTextAnnotation(cur.id);
    } else {
      chart.overrideOverlay({
        id: cur.id,
        points,
        styles,
        lock: o.lock,
        visible: o.visible,
        needDefaultYAxisFigure: draft.priceLabel,
        extendData: ext,
        zLevel: o.zLevel ?? 0,
        fixedZLevel: true,
      });
      syncTextAnnotation(cur.id);
    }
    saveLastOverlayStyle({
      color: draft.color,
      size: draft.size,
      style: draft.style,
      opacity: draft.opacity,
      fillOpacity: draft.fillOpacity,
    });
    // Persist BEFORE removing a now-hidden overlay (see applyEdit).
    persistDrawings(symbolRef.current, intervalRef.current);
    if (
      draft.visibleIntervals !== undefined &&
      !draft.visibleIntervals.includes(intervalRef.current)
    ) {
      chart.removeOverlay({ groupId: cur.id });
      deselect();
      closeDialog();
      return;
    }
    refreshSelected(cur.id);
    closeDialog();
  };

  useImperativeHandle(ref, () => ({
    clearDrawings() {
      const chart = chartRef.current;
      if (!chart) return;
      pushHistory();
      suppressSaveRef.current = true;
      chart.removeOverlay();
      suppressSaveRef.current = false;
      const store = loadDrawingsStore();
      store[symbolRef.current] = [];
      saveDrawingsStore(store);
      deselect();
    },
    undo() {
      undo();
    },
    redo() {
      redo();
    },
    setRange(range: RangeId) {
      const chart = chartRef.current;
      const container = containerRef.current;
      if (!chart || !container) return;
      const data = chart.getDataList();
      if (data.length === 0) return;
      const intervalMs = INTERVAL_MS[intervalRef.current] ?? 0;
      if (intervalMs <= 0) return;
      const def = RANGES.find((r) => r.id === range);
      let count: number;
      if (range === 'all') {
        count = data.length;
      } else if (range === 'ytd') {
        const yearStart = new Date(
          new Date().getFullYear(),
          0,
          1,
        ).getTime();
        const inYear = data.filter((d) => d.timestamp >= yearStart).length;
        count = inYear > 0 ? inYear : data.length;
      } else if (def?.ms) {
        count = Math.min(
          data.length,
          Math.max(1, Math.ceil(def.ms / intervalMs)),
        );
      } else {
        count = data.length;
      }
      const width = container.clientWidth;
      if (width <= 0) return;
      const space = Math.min(50, Math.max(2, width / count));
      chart.setBarSpace(space);
      chart.scrollToRealTime();
    },
  }));

  // ---- chart init (once) ----------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    registerRectangleOverlay();
    registerFibonacciRetracementOverlay();
    registerFibonacciToolsOverlays();
    registerPitchforkOverlays();
    registerGannOverlays();
    registerPatternOverlays();
    registerMeasureOverlay();
    registerTextAnnotationOverlay();
    registerSimpleTagOverlay();
    registerGeometryOverlays();

    const chart = init(container, { styles: DARK_STYLES });
    if (!chart) return;
    chartRef.current = chart;

    // The top-left legend is the only OHLC readout: the built-in
    // tooltip draws its own line at the same spot and the two overlap
    // (screenshot 2026-11-24). Hide it entirely; the legend follows
    // the crosshair instead (subscribed below).
    chart.setStyles({ candle: { tooltip: { showRule: 'none' } } });

    // Legend follows the crosshair (TradingView behaviour): while the
    // mouse hovers a candle the legend shows that candle; when the
    // mouse leaves it falls back to the last candle. Note the action
    // payload is only { x, y, paneId } (no kLineData despite the
    // Crosshair type), so the hovered candle is resolved through
    // convertFromPixel -> dataIndex into the loaded list.
    const onCrosshairChange = (data?: unknown) => {
      const cross = data as Crosshair | undefined;
      if (cross?.x === undefined) {
        setHoverKline(null);
        return;
      }
      const point = chart.convertFromPixel(
        [{ x: cross.x, y: cross.y ?? 0 }],
        cross.paneId ? { paneId: cross.paneId } : undefined,
      );
      const p = Array.isArray(point) ? point[0] : point;
      const list = chart.getDataList();
      const idx = p?.dataIndex;
      setHoverKline(
        idx !== undefined && idx >= 0 && idx < list.length
          ? list[idx]
          : null,
      );
    };
    chart.subscribeAction('onCrosshairChange', onCrosshairChange);

    // Debug handle for browser-console inspection
    // (e.g. __pttChart.getOverlays(), __pttChart.getVisibleRange()).
    (window as unknown as { __pttChart?: Chart }).__pttChart = chart;

    chart.setZoomEnabled(true);
    chart.setScrollEnabled(true);
    chart.setSymbol({ ticker: symbolRef.current, pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod(periodFor(intervalRef.current));

    const dataLoader: DataLoader = {
      getBars: async ({ type, timestamp, callback }) => {
        // klinecharts v10 DataLoader semantics (verified against the
        // installed bundle's StoreImp._processDataLoad/_addData):
        // - 'init': replace all data. The chart passes timestamp=null.
        // - 'backward': load bars NEWER than `timestamp` (which is the
        //   NEWEST loaded bar); the chart appends the result. Triggered
        //   when the view sits at the right edge and more.backward is true.
        // - 'forward': load bars OLDER than `timestamp` (which is the
        //   OLDEST loaded bar); the chart prepends the result. Triggered
        //   when the view scrolls to the left edge and more.forward is true.
        // Getting this backwards duplicates the whole dataset on every
        // load (the chart concatenates, it does not dedupe).
        try {
          const params = new URLSearchParams({
            source: 'binance',
            symbol: symbolRef.current,
            interval: intervalRef.current,
            limit: String(HISTORY_LIMIT),
          });
          if (type === 'backward' && timestamp) {
            // Newer than the newest loaded bar. Binance startTime is
            // inclusive, so +1ms excludes the boundary bar itself.
            params.set('startTime', String(timestamp + 1));
          } else if (type === 'forward' && timestamp) {
            // Older than the oldest loaded bar. Binance endTime is
            // inclusive, so -1ms excludes the boundary bar itself.
            params.set('endTime', String(timestamp - 1));
          }
          const res = await fetch(`/api/klines?${params.toString()}`);
          if (!res.ok) throw new Error(`klines API ${res.status}`);
          const json = (await res.json()) as { klines: Kline[] };
          const klines = (json.klines ?? []) as KLineData[];
          const hasMore = klines.length >= HISTORY_LIMIT;
          if (type === 'init') {
            // No newer bars exist beyond the latest (live updates arrive
            // via the WebSocket); older history does exist.
            if (klines.length === 0) {
              // Empty init: the chart callback clears the old candles,
              // so say so instead of leaving a blank chart unexplained,
              // and do not restore drawings onto a symbol with no data.
              initOkRef.current = false;
              setLoadError(
                `無法載入 ${symbolRef.current} 的 K 線資料，請檢查標的或稍後再試。`,
              );
              setLastKline(null);
              callback(klines, { backward: false, forward: false });
              return;
            }
            initOkRef.current = true;
            setLoadError(null);
            setLastKline(klines[klines.length - 1]);
            callback(klines, { backward: false, forward: hasMore });
            restoreDrawings();
          } else if (type === 'forward') {
            callback(klines, { forward: hasMore });
          } else {
            // 'backward': more newer bars only exist if a full page came back.
            callback(klines, { backward: hasMore });
          }
        } catch {
          if (type === 'init') {
            initOkRef.current = false;
            setLoadError(
              `無法載入 ${symbolRef.current} 的 K 線資料，請檢查標的或稍後再試。`,
            );
          }
          callback([], { backward: false, forward: false });
        }
      },
      subscribeBar: ({ callback }) => {
        liveCallbackRef.current = callback;
        socketRef.current?.disconnect();
        // The last init load delivered no data (unknown/delisted symbol):
        // do not open a socket that can never receive candles.
        if (!initOkRef.current) {
          onConnectionStatusRef.current?.('closed');
          return;
        }
        const socket = new BinanceKlineSocket();
        socketRef.current = socket;
        socket.connect(
          symbolRef.current,
          intervalRef.current,
          (kline) => {
            liveCallbackRef.current?.(kline as KLineData);
            setLastKline(kline as KLineData);
          },
          (status) => onConnectionStatusRef.current?.(status),
        );
      },
      unsubscribeBar: () => {
        liveCallbackRef.current = null;
        socketRef.current?.disconnect();
        socketRef.current = null;
      },
    };
    chart.setDataLoader(dataLoader);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeAction('onCrosshairChange', onCrosshairChange);
      socketRef.current?.disconnect();
      socketRef.current = null;
      liveCallbackRef.current = null;
      chartRef.current = null;
      dispose(container);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- symbol / interval switch ----------------------------------------

  // Tracks the last applied symbol/interval. The first run is skipped:
  // the init effect above already called setSymbol + setPeriod once, and
  // calling them again would trigger a second, wasteful init load.
  const prevSymbolIntervalRef = useRef<{ symbol: string; interval: Interval } | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // A new symbol/interval is about to load: drop any stale error
    // and legend (including a hovered candle from the old symbol).
    setLoadError(null);
    setLastKline(null);
    setHoverKline(null);
    const prev = prevSymbolIntervalRef.current;
    if (prev === null) {
      prevSymbolIntervalRef.current = { symbol, interval };
      return;
    }
    if (prev.symbol !== symbol || prev.interval !== interval) {
      // Save the old chart's drawings before wiping them.
      persistDrawings(prev.symbol, prev.interval);
      // History is per view — a snapshot from another symbol/interval
      // must not be applied here.
      undoStackRef.current = [];
      redoStackRef.current = [];
      emitHistoryChange();
      deselect();
      // An unfinished drawing cannot survive the switch: cancel it.
      drawingIdRef.current = null;
      if (activeToolRef.current) onToolDoneRef.current();
    }
    prevSymbolIntervalRef.current = { symbol, interval };
    suppressSaveRef.current = true;
    try {
      chart.removeOverlay();
      // Call only the setter that actually changed: each one triggers
      // its own getBars("init") load.
      if (prev.symbol !== symbol) {
        chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
      }
      if (prev.interval !== interval) {
        chart.setPeriod(periodFor(interval));
      }
    } finally {
      suppressSaveRef.current = false;
    }
    // getBars("init") fires from setSymbol/setPeriod and restores drawings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  // ---- drawing tool arming ---------------------------------------------

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!activeTool) {
      // Disarming (or Esc) removes any unfinished overlay instead of
      // leaving it on the chart.
      if (drawingIdRef.current) {
        chart.removeOverlay({ id: drawingIdRef.current });
        drawingIdRef.current = null;
      }
      return;
    }
    armOverlay(activeTool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // ---- keyboard shortcuts -----------------------------------------------

  useEffect(() => {
    const isEditableTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) {
        return true;
      }
      if (el.tagName === 'INPUT') {
        // Checkbox/radio toggles hold focus after a label click but
        // take no text input: shortcuts (Delete, Ctrl+Z) must still
        // work while one is focused.
        const type = (el as HTMLInputElement).type;
        return type !== 'checkbox' && type !== 'radio';
      }
      return false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // While the settings dialog is open, its own key handling owns
      // Escape/Delete/Backspace/Ctrl+Z (the dialog root stops
      // propagation); never let a chart shortcut fire behind it.
      if (dialogOpenRef.current) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (drawingIdRef.current) {
          // A path/pen with at least 2 points finishes on Esc
          // (TradingView behaviour); anything else — including a
          // path/pen with fewer than 2 points — is cancelled.
          if (finishDrawing(drawingIdRef.current)) return;
          chartRef.current?.removeOverlay({ id: drawingIdRef.current });
          drawingIdRef.current = null;
          onToolDoneRef.current();
          return;
        }
        const measure = chartRef.current?.getOverlays({
          name: MEASURE_NAME,
        })[0];
        if (measure) {
          chartRef.current?.removeOverlay({ id: measure.id });
          return;
        }
        if (selectedRef.current) {
          deselect();
          return;
        }
        if (activeToolRef.current) onToolDoneRef.current();
        return;
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedRef.current
      ) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    // Ctrl/Cmd temporarily inverts the magnet mode while drawing.
    const onModifier = (e: KeyboardEvent) => {
      const held = e.ctrlKey || e.metaKey;
      if (held === modifierRef.current) return;
      modifierRef.current = held;
      const id = drawingIdRef.current;
      if (id) {
        chartRef.current?.overrideOverlay({ id, mode: currentOverlayMode() });
      }
    };
    const onBlur = () => {
      if (!modifierRef.current) return;
      modifierRef.current = false;
      const id = drawingIdRef.current;
      if (id) {
        chartRef.current?.overrideOverlay({ id, mode: currentOverlayMode() });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keydown', onModifier);
    window.addEventListener('keyup', onModifier);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keydown', onModifier);
      window.removeEventListener('keyup', onModifier);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- chart type -------------------------------------------------------

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setStyles({ candle: { type: chartType } });
  }, [chartType]);

  // ---- indicators -------------------------------------------------------

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const desired = new Set(indicators);
    for (const ind of chart.getIndicators()) {
      if (!desired.has(ind.name)) chart.removeIndicator({ name: ind.name });
    }
    const current = new Set(chart.getIndicators().map((i) => i.name));
    for (const name of indicators) {
      if (!current.has(name)) {
        chart.createIndicator(name, isMainPaneIndicator(name));
      }
    }
  }, [indicators]);

  // Clicking empty chart space dismisses a finished measure overlay.
  // Overlay clicks set lastOverlayClickRef first, so they are excluded.
  const handleContainerClick = () => {
    setTimeout(() => {
      const chart = chartRef.current;
      if (!chart) return;
      if (Date.now() - lastOverlayClickRef.current < 100) return;
      const measure = chart.getOverlays({ name: MEASURE_NAME })[0];
      if (measure) chart.removeOverlay({ id: measure.id });
    }, 0);
  };

  // ---- floating edit bar: drag + popovers -------------------------------

  /** Close any open floating-bar popover when clicking outside the bar. */
  useEffect(() => {
    if (openPanel === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel]);

  const togglePanel = (panel: 'color' | 'lineStyle' | 'more') => {
    setOpenPanel((cur) => (cur === panel ? null : panel));
  };

  /** Start dragging the floating bar from its grip. */
  const onBarGripPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const bar = barRef.current;
    const wrap = wrapperRef.current;
    if (!bar || !wrap) return;
    const barRect = bar.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    barDragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - barRect.left,
      offsetY: e.clientY - barRect.top,
      barWidth: barRect.width,
      barHeight: barRect.height,
    };
    if (!barPos) {
      setBarPos({
        x: barRect.left - wrapRect.left,
        y: barRect.top - wrapRect.top,
      });
    }
    const onMove = (ev: PointerEvent) => {
      const d = barDragRef.current;
      const w = wrapperRef.current;
      if (!d || !w || ev.pointerId !== d.pointerId) return;
      const r = w.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(ev.clientX - r.left - d.offsetX, r.width - d.barWidth),
      );
      const y = Math.max(
        0,
        Math.min(ev.clientY - r.top - d.offsetY, r.height - d.barHeight),
      );
      setBarPos({ x, y });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== barDragRef.current?.pointerId) return;
      barDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Legend candle: the hovered candle while the crosshair is on the
  // chart, otherwise the last candle. Its change is vs its own open.
  const legendKline = hoverKline ?? lastKline;
  const legendChangePct =
    legendKline !== null && legendKline.open !== 0
      ? ((legendKline.close - legendKline.open) / legendKline.open) * 100
      : 0;

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onMouseLeave={() => setHoverKline(null)}
        className="h-full w-full bg-[#131722]"
        data-testid="chart-container"
      />
      {legendKline !== null && loadError === null && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 leading-relaxed">
          <div className="text-xs font-semibold text-white">
            {symbol} · {INTERVAL_LABELS[interval]} · Binance
          </div>
          <div className="text-[11px] text-[#b2b5be]">
            開 {formatPrice(legendKline.open)} 高 {formatPrice(legendKline.high)}{' '}
            低 {formatPrice(legendKline.low)} 收{' '}
            <span
              className={
                legendChangePct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
              }
            >
              {formatPrice(legendKline.close)}{' '}
              {legendChangePct >= 0 ? '+' : ''}
              {legendChangePct.toFixed(2)}%
            </span>
          </div>
        </div>
      )}
      {loadError !== null && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-2">
          <div className="rounded-md border border-[#ef5350]/50 bg-[#1e222d]/95 px-3 py-2 text-xs leading-relaxed text-[#f5c6c6] shadow-lg">
            {loadError}
          </div>
        </div>
      )}
      {selected !== null && (
        <div
          ref={barRef}
          className="absolute z-20 flex max-w-full flex-wrap items-center gap-1 rounded-md border border-[#2a2e39] bg-[#1e222d]/95 px-2 py-1.5 text-xs text-[#d1d4dc] shadow-lg"
          style={
            barPos
              ? { left: barPos.x, top: barPos.y }
              : { left: '50%', top: 8, transform: 'translateX(-50%)' }
          }
        >
          <button
            title="拖曳移動"
            aria-label="拖曳移動浮動列"
            onPointerDown={onBarGripPointerDown}
            className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-[#80858f] hover:bg-white/10 hover:text-white active:cursor-grabbing"
          >
            <svg
              width="10"
              height="16"
              viewBox="0 0 10 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="2.5" cy="3" r="1.3" />
              <circle cx="7.5" cy="3" r="1.3" />
              <circle cx="2.5" cy="8" r="1.3" />
              <circle cx="7.5" cy="8" r="1.3" />
              <circle cx="2.5" cy="13" r="1.3" />
              <circle cx="7.5" cy="13" r="1.3" />
            </svg>
          </button>
          {/* A standalone text annotation has no line to style: hide
              the colour / width / line-style controls for it. */}
          {selected.name !== TEXT_ANNOTATION_NAME && (
            <>
              <button
                title={`顏色 ${selected.color}（不透明度 ${Math.round(selected.opacity * 100)}%）`}
                aria-label="顏色"
                onClick={() => togglePanel('color')}
                className={`flex h-6 w-8 shrink-0 items-center justify-center rounded-sm border px-1 hover:border-white/50 ${
                  openPanel === 'color'
                    ? 'border-white ring-1 ring-white'
                    : 'border-white/20'
                }`}
              >
                <span
                  className="block h-4 w-6 rounded-[2px]"
                  style={CHECKER_BG}
                >
                  <span
                    className="block h-full w-full rounded-[2px]"
                    style={{
                      backgroundColor: hexToRgba(
                        selected.color,
                        selected.opacity,
                      ),
                    }}
                  />
                </span>
              </button>
              <span className="mx-1 h-4 w-px bg-[#2a2e39]" />
              {LINE_WIDTHS.map((w) => (
                <button
                  key={w}
                  title={`線寬 ${w}`}
                  onClick={() => applyEdit({ size: w })}
                  className={`flex h-5 w-6 items-center justify-center rounded-sm ${selected.size === w ? 'bg-[#2962ff] text-white' : 'hover:bg-white/10'}`}
                >
                  <span
                    className="block rounded-full bg-current"
                    style={{ height: Math.min(w, 3), width: 14 }}
                  />
                </button>
              ))}
              <button
                title="線形"
                aria-label="線形"
                onClick={() => togglePanel('lineStyle')}
                className={`flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1.5 hover:bg-white/10 ${
                  openPanel === 'lineStyle' ? 'bg-white/10' : ''
                }`}
              >
                <span
                  className="block w-6 border-t-2"
                  style={{
                    borderTopColor: hexToRgba(
                      selected.color,
                      selected.opacity,
                    ),
                    borderTopStyle:
                      selected.style === 'solid'
                        ? 'solid'
                        : selected.style === 'dashed'
                          ? 'dashed'
                          : 'dotted',
                  }}
                />
                <span>
                  {LINE_STYLE_OPTIONS.find((o) => o.id === selected.style)?.label}
                </span>
              </button>
              <span className="mx-1 h-4 w-px bg-[#2a2e39]" />
            </>
          )}
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={
                selected.visibleIntervals !== undefined &&
                selected.visibleIntervals.length === 1 &&
                selected.visibleIntervals[0] === interval
              }
              onChange={(e) =>
                applyEdit({
                  visibleIntervals: e.target.checked ? [interval] : undefined,
                })
              }
              className="accent-[#2962ff]"
            />
            僅此週期
          </label>
          <span className="mx-1 h-4 w-px bg-[#2a2e39]" />
          <button
            onClick={() => applyEdit({ lock: !selected.lock })}
            className="rounded-sm px-1.5 py-0.5 hover:bg-white/10"
          >
            {selected.lock ? '🔒 已鎖定' : '🔓 鎖定'}
          </button>
          <button
            title="更多"
            aria-label="更多"
            onClick={() => togglePanel('more')}
            className={`rounded-sm px-1.5 py-0.5 hover:bg-white/10 ${
              openPanel === 'more' ? 'bg-white/10' : ''
            }`}
          >
            •••
          </button>
          <button
            title="設定"
            aria-label="設定"
            onClick={() => openDialogFor(selected.id, 'style')}
            className="rounded-sm px-1.5 py-0.5 hover:bg-white/10"
          >
            ✏️
          </button>
          <button
            title="文字"
            aria-label="文字"
            onClick={() => openDialogFor(selected.id, 'text')}
            className="rounded-sm px-1.5 py-0.5 font-semibold hover:bg-white/10"
          >
            T
          </button>
          <button
            onClick={deleteSelected}
            className="rounded-sm px-1.5 py-0.5 text-[#ef5350] hover:bg-white/10"
          >
            刪除
          </button>
          <button
            onClick={deselect}
            className="rounded-sm px-1 hover:bg-white/10"
          >
            ✕
          </button>
          {openPanel === 'color' && (
            <div className="absolute left-0 top-full z-40 mt-1">
              <ColorPicker
                color={selected.color}
                opacity={selected.opacity}
                // Picking a color closes the panel (same as the line-style
                // panel): leaving it open covers the chart and swallows
                // the next click on the canvas.
                onColorChange={(c) => {
                  applyEdit({ color: c });
                  setOpenPanel(null);
                }}
                onOpacityChange={(op) => applyEdit({ opacity: op }, false)}
                onOpacityStart={() => {
                  if (!sliderHistoryPushedRef.current) {
                    sliderHistoryPushedRef.current = true;
                    pushHistory();
                  }
                }}
                onOpacityEnd={() => {
                  sliderHistoryPushedRef.current = false;
                }}
              />
            </div>
          )}
          {openPanel === 'lineStyle' && (
            <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-md border border-[#2a2e39] bg-[#1e222d] p-1 shadow-xl">
              {LINE_STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    applyEdit({ style: opt.id });
                    setOpenPanel(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-white/10"
                >
                  <span
                    className="block w-8 border-t-2"
                    style={{
                      borderTopColor: '#d1d4dc',
                      borderTopStyle:
                        opt.id === 'solid'
                          ? 'solid'
                          : opt.id === 'dashed'
                            ? 'dashed'
                            : 'dotted',
                    }}
                  />
                  <span>{opt.label}</span>
                  {selected.style === opt.id && (
                    <span className="ml-auto text-[#2962ff]">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {openPanel === 'more' && (
            <div className="absolute right-0 top-full z-40 mt-1 w-36 rounded-md border border-[#2a2e39] bg-[#1e222d] p-1 shadow-xl">
              <button
                onClick={() => {
                  copySelected();
                  setOpenPanel(null);
                }}
                className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-white/10"
              >
                複製
              </button>
              <button
                onClick={() => {
                  bringToFront();
                  setOpenPanel(null);
                }}
                className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-white/10"
              >
                移到前面
              </button>
              <button
                onClick={() => {
                  sendToBack();
                  setOpenPanel(null);
                }}
                className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-white/10"
              >
                移到後面
              </button>
              <button
                onClick={() => {
                  applyEdit({ visible: !selected.visible });
                  setOpenPanel(null);
                }}
                className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-white/10"
              >
                {selected.visible ? '隱藏' : '顯示'}
              </button>
            </div>
          )}
        </div>
      )}
      {dialogDraft !== null && selected !== null && (
        <OverlaySettingsDialog
          toolName={selected.name}
          initial={dialogDraft}
          bars={dialogBars}
          initialTab={dialogTab}
          onConfirm={applyDialog}
          onClose={closeDialog}
        />
      )}
    </div>
  );
});

export default Chart;
export { DRAWING_TOOLS };
