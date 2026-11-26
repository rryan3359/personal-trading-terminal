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
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  dispose,
  init,
  type Chart,
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
import ChartContextMenu, {
  type ContextMenuItem,
} from '@/components/ChartContextMenu';
import ChartLegend from '@/components/ChartLegend';
import ObjectList, {
  type ObjectListBatchAction,
  type ObjectListItem,
} from '@/components/ObjectList';
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
  createContextMenuController,
  type ContextMenuController,
  type ContextMenuState,
} from '@/lib/chart-context-menu';
import {
  createCrosshairController,
  type CrosshairController,
} from '@/lib/chart-crosshair';
import {
  buildAppearanceStyles,
  type AppearanceSettings,
} from '@/lib/chart-appearance';
import { DrawingHistoryManager } from '@/lib/drawing-history';
import {
  isInView,
  MEASURE_NAME,
  normalizeZLevels,
  parseOverlayText,
  parseVisibleIntervals,
  TEXT_ANNOTATION_NAME,
  toSavedOverlay,
  validateSavedOverlay,
  type OverlayLineParsers,
} from '@/lib/drawing-model';
import {
  createDrawingPersistence,
  type DrawingPersistence,
  type OverlayTemplate,
  type OverlayTemplates,
} from '@/lib/drawing-persistence';
import {
  DEFAULT_OVERLAY_STYLE,
  DEFAULT_OVERLAY_TEXT,
  getLastOverlayStyle,
  getMagnetMode,
  loadDrawingsStore,
  newOverlayId,
  saveDrawingsStore,
  saveLastOverlayStyle,
  type LastOverlayStyle,
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
  /** Restore the default view (same range as the context menu's 重設圖表檢視). */
  resetView: () => void;
  /** Open the object list panel. */
  openObjectList: () => void;
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
  /** User-customisable chart appearance (colors, grid, axis font
   *  size). Owned by the page (shared desktop + mobile, persisted
   *  in localStorage); applied via setStyles on change. */
  appearance: AppearanceSettings;
  /** Open the chart appearance dialog (toolbar gear, chart-corner
   *  gear, context menu). */
  onOpenAppearanceSettings?: () => void;
  onConnectionStatus?: (status: BinanceSocketStatus) => void;
  /**
   * Called when a live tick arrives (throttled to at most once per
   * second inside Chart): the page shows it as the last-tick time in
   * the status bar. Never called while the socket is down.
   */
  onLastTick?: (atMs: number) => void;
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
    case '3m':
      return { type: 'minute', span: 3 };
    case '5m':
      return { type: 'minute', span: 5 };
    case '15m':
      return { type: 'minute', span: 15 };
    case '30m':
      return { type: 'minute', span: 30 };
    case '1h':
      return { type: 'hour', span: 1 };
    case '2h':
      return { type: 'hour', span: 2 };
    case '4h':
      return { type: 'hour', span: 4 };
    case '6h':
      return { type: 'hour', span: 6 };
    case '12h':
      return { type: 'hour', span: 12 };
    case '1d':
      return { type: 'day', span: 1 };
    case '3d':
      return { type: 'day', span: 3 };
    case '1w':
      return { type: 'week', span: 1 };
    case '1M':
      return { type: 'month', span: 1 };
  }
}

function isMainPaneIndicator(name: string): boolean {
  return INDICATOR_OPTIONS.find((o) => o.id === name)?.mainPane ?? false;
}

// klinecharts 10.1.1 PaneIdConstants.CANDLE (index.esm.js:845).
// Main-pane indicators must be created with this paneId: createIndicator
// mints a fresh indicator_pane_* whenever paneId is absent
// (index.esm.js:15702), so a bare name always opens a new sub-pane.
const CANDLE_PANE_ID = 'candle_pane';

/**
 * Range the context menu's 重設圖表檢視 restores. No default-range
 * constant exists in the codebase (page starts with activeRange null
 * and never calls setRange on mount); 1M is the middle preset —
 * change this one line to retarget the reset.
 */
const DEFAULT_RESET_RANGE: RangeId = '1M';
/**
 * Phase 1 step 3 — explicit interaction mode (Phase 0 §7.1). Only the
 * seven states that actually exist are listed. Crosshair is NOT a mode:
 * it is always-on display behaviour (legend follows the crosshair) and
 * never enters the state machine. Selecting (marquee / multi-select)
 * is not listed either: selection is a single `selected`, with no
 * marquee or Shift-add (Phase 0 §3.4).
 */
export type InteractionMode =
  | 'Idle'
  | 'Drawing'
  | 'Selected'
  | 'Moving'
  | 'Resizing'
  | 'ContextMenu'
  | 'Editing';
/**
 * Wait for the library's own touch->click synthesis to select first
 * (B10, second timer). The library synthesises its tap handling after
 * touchend — no compatibility click reaches the container (measured:
 * probe-event-order.mjs, clicksDelta 0; the library's own synthesis
 * selects at ~40ms) — so the fallback cannot decide synchronously in
 * onPointerUp; it waits this long and then lets the mode decide.
 * Named constant owned by the state machine (see onContainerPointerUp).
 */
const TOUCH_FALLBACK_WAIT_MS = 150;
/**
 * Compat-click suppression window after a draw ends and auto-selects
 * (B10, third timer). The tap that ends a draw produces a browser
 * compatibility click which lands on the freshly rendered floating
 * bar; time is the only discriminator (a compat click also produces
 * a pointerdown, so a one-shot flag cannot tell it from a deliberate
 * tap). Named constant owned by the Drawing -> Selected transition:
 * set only there, cleared when mode leaves Selected.
 */
const BAR_COMPAT_CLICK_SUPPRESS_MS = 300;
/** Checkerboard behind translucent color swatches (shows opacity). */
const CHECKER_BG = {
  backgroundImage:
    'linear-gradient(45deg, #9e9e9e 25%, transparent 25%), linear-gradient(-45deg, #9e9e9e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9e9e9e 75%), linear-gradient(-45deg, transparent 75%, #9e9e9e 75%)',
  backgroundSize: '6px 6px',
  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
  backgroundColor: '#f5f5f5',
};

/** Small 20px stroke icons for the floating bar (icon-only). */
const BAR_ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function BarLockIcon({ locked }: { locked: boolean }) {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      {locked ? (
        <path d="M6.5 9V7a3.5 3.5 0 0 1 7 0v2" />
      ) : (
        <path d="M6.5 9V7a3.5 3.5 0 0 1 6.9-.8" />
      )}
    </svg>
  );
}

function BarEyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
      <circle cx="10" cy="10" r="2.5" />
      {hidden && <line x1="3.5" y1="3.5" x2="16.5" y2="16.5" />}
    </svg>
  );
}

/** Proper cog: toothed ring + centre hole. The old circle-and-spokes
 *  read as a sun on phones. */
function BarGearIcon() {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <circle cx="10" cy="10" r="6" />
      <circle cx="10" cy="10" r="2.6" />
      <g fill="currentColor" stroke="none">
        <rect x="8.8" y="2" width="2.4" height="2.8" rx="0.6" />
        <rect x="8.8" y="15.2" width="2.4" height="2.8" rx="0.6" />
        <rect x="2" y="8.8" width="2.8" height="2.4" rx="0.6" />
        <rect x="15.2" y="8.8" width="2.8" height="2.4" rx="0.6" />
        <rect
          x="13.4"
          y="4.2"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 14.6 5.4)"
        />
        <rect
          x="4.2"
          y="4.2"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 5.4 5.4)"
        />
        <rect
          x="4.2"
          y="13.4"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 5.4 14.6)"
        />
        <rect
          x="13.4"
          y="13.4"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 14.6 14.6)"
        />
      </g>
    </svg>
  );
}

/** Template icon: 2×2 rounded grid (田), matching TV's template button. */
function BarTemplateIcon() {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="3.5" width="6" height="6" rx="1.5" />
      <rect x="3.5" y="10.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function BarTrashIcon() {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <path d="M4 5.5h12M8 5.5V4h4v1.5M6.5 5.5l.8 10.5h5.4l.8-10.5M10 8.5v5" />
    </svg>
  );
}


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
  /** simpleTag only: Y-axis tag text ('' = show the price). */
  tagText: string;
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


/** Distance from a point to the segment a–b (px). Touch tap fallback. */
function distToSegment(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Deterministic id of a main line's accompanying text annotation. */
const textAnnotationId = (mainId: string): string => `${mainId}:text`;






const Chart = forwardRef<ChartHandle, ChartProps>(function Chart(
  {
    symbol,
    interval,
    activeTool,
    onToolDone,
    indicators,
    chartType,
    appearance,
    onOpenAppearanceSettings,
    onConnectionStatus,
    onLastTick,
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
  const onLastTickRef = useRef(onLastTick);
  /** Last time onLastTick was reported (throttle: at most once a second). */
  const lastTickReportRef = useRef(0);
  const activeToolRef = useRef(activeTool);
  const continuousDrawRef = useRef(continuousDraw);
  const onHistoryChangeRef = useRef(onHistoryChange);
  /** Latest appearance for the one-time init (the init effect runs
   *  once; later changes go through the appearance effect below). */
  const appearanceRef = useRef(appearance);
  const onOpenAppearanceSettingsRef = useRef(onOpenAppearanceSettings);
  symbolRef.current = symbol;
  intervalRef.current = interval;
  onToolDoneRef.current = onToolDone;
  onConnectionStatusRef.current = onConnectionStatus;
  onLastTickRef.current = onLastTick;
  activeToolRef.current = activeTool;
  continuousDrawRef.current = continuousDraw;
  onHistoryChangeRef.current = onHistoryChange;
  appearanceRef.current = appearance;
  onOpenAppearanceSettingsRef.current = onOpenAppearanceSettings;

  const suppressSaveRef = useRef(false);
  /** True while restoreDrawings / applySnapshot rebuilds overlays. */
  const restoringRef = useRef(false);
  /**
   * G-19: "symbol:interval" of the last view whose restoreDrawings
   * completed. persistDrawings refuses to write for any other view,
   * so a persist racing the first restore can never overwrite the
   * stored drawings with an empty live list.
   */
  const lastRestoredKeyRef = useRef<string | null>(null);
  /**
   * Drawing persistence (Phase 3 Step 3): owns readMergedList /
   * persist / templates in lib/drawing-persistence.ts (origin:
   * inline in this file). Chart holds a single instance in a ref;
   * the thin wrappers below (readMergedList / persistDrawings)
   * delegate to it. The line parsers stay here (Step 7 style
   * helpers) and are injected; the G-05 corrupt-once flag lives in
   * the instance. Created before the templates state below, whose
   * lazy initializer reads through it.
   */
  const lineParsers: OverlayLineParsers = {
    parseLineColor,
    logicalLineStyle,
  };
  const persistenceRef = useRef<DrawingPersistence | null>(null);
  if (persistenceRef.current === null) {
    persistenceRef.current = createDrawingPersistence(
      () => chartRef.current,
      lineParsers,
    );
  }
  const persistence = persistenceRef.current;
  /** Id of the overlay currently being drawn, if any. */
  const drawingIdRef = useRef<string | null>(null);
  /** Whether Ctrl/Cmd is currently held (temporarily inverts magnet). */
  const modifierRef = useRef(false);
  /** Guards the fill-opacity slider against one history push per drag. */
  const sliderHistoryPushedRef = useRef(false);
  /** Touch tap-to-select fallback (mobile): the tap that started the
   *  current touch. The selection it started from is no longer stored
   *  here: the fallback decision is mode-based now (see
   *  onContainerPointerUp), not an id comparison. */
  const touchTapStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    time: number;
  } | null>(null);
  /** Pending fallback timer (one at most); cleared on unmount. */
  const touchFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Previous touch tap, for the double-tap-to-open-dialog gesture. */
  const lastTouchTapRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );
  // Timestamp until which clicks on the floating bar are ignored.
  // Set only by the Drawing -> Selected transition (draw end with
  // auto-select): the tap that ended the draw also produces a browser
  // compatibility click, which lands on the freshly rendered bar
  // (right under the finger) and would otherwise trigger whichever
  // button happens to be there (e.g. the line-style panel popping
  // open, or 刪除 deleting the just-drawn line). A deliberate tap on
  // a bar button always comes later — the user has to see the bar
  // first — so a 300ms window is safe. Cleared when mode leaves
  // Selected (see transitionMode), so a stale window can never
  // swallow a later selection's first bar click.
  const barIgnoreClicksUntilRef = useRef(0);

  // ---- interaction mode state machine (Phase 1 step 3) ---------------
  // Single source of truth for the chart interaction mode (Phase 0
  // §7.1). Refs only: a mode change must never re-render Chart
  // (step 2 moved high-frequency updates out of React state; this
  // must not move back). Every mode change goes through
  // transitionMode / enterOverlayMode / exitOverlayMode below.
  const modeRef = useRef<InteractionMode>('Idle');
  /** True only between a measure draw ending and the click event that
   *  follows it (set in onDrawEnd, consumed by handleContainerClick).
   *  The library completes a draw on pointerup — the click event
   *  arrives ~16ms later as a separate task — so the flag must survive
   *  across tasks until that click; a microtask clear would erase it
   *  too early (measured: probe-measure2.mjs, onDrawEnd ~1ms after
   *  pointerup, click ~16ms after). It is cleared instead by the next
   *  pointerdown on the container (see onContainerPointerDown): the
   *  completing click's own pointerdown predates the draw end, so it
   *  can never clear the flag early. A touch tap completes the draw
   *  with no container click at all, so the flag simply waits for the
   *  next real click — same as the old timestamp behaviour. */
  const measureJustDrawnRef = useRef(false);
  /** Mode before entering an overlay state (ContextMenu/Editing); the
   *  overlay state restores it on close instead of assuming Idle. */
  const previousModeRef = useRef<InteractionMode>('Idle');
  /**
   * Dev-only mode mirror for CDP verification (window.__pttMode /
   * window.__pttModeLog, same pattern as __pttChartRenders in step 2).
   * Production builds skip the window writes; the mode ref itself is
   * real logic and always runs. Rejected transitions are logged too
   * (ok: false) so a test run can assert the machine never refused a
   * transition on the happy path.
   */
  const recordModeTransition = (
    prev: InteractionMode,
    next: InteractionMode,
    reason: string,
    ok: boolean,
  ) => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as {
      __pttMode?: InteractionMode;
      __pttModeLog?: Array<{
        from: InteractionMode;
        to: InteractionMode;
        reason: string;
        t: number;
        ok: boolean;
      }>;
    };
    if (ok) w.__pttMode = next;
    const log = w.__pttModeLog ?? [];
    w.__pttModeLog = log;
    log.push({ from: prev, to: next, reason, t: performance.now(), ok });
    if (log.length > 200) log.splice(0, log.length - 200);
  };
  /**
   * The single way the interaction mode changes (except overlay-state
   * enter/exit, which have their own helpers for previousMode
   * bookkeeping). Guards (Phase 0 §7.1):
   * - Moving/Resizing only from Selected — or from Idle via the
   *   implicit select at press-start: the library fires onSelected on
   *   the click AFTER a drag, so a press that starts a drag is the
   *   mode-level select — and only back to Selected.
   * - Drawing <-> Selected never interconvert directly: the only
   *   bridge is a draw end (Drawing -> Selected, via onDrawEnd ->
   *   refreshSelected, fromDrawEnd) and an explicit tool arm
   *   (Selected -> Drawing, via armOverlay, viaArm). fromDrawEnd
   *   covers both draw completion and draw cancellation (Esc / disarm
   *   returning to a selection that predates the draw).
   * - Overlay states (ContextMenu/Editing) are entered/exited only
   *   through enterOverlayMode/exitOverlayMode.
   * A transition into Selected cancels a pending touch fallback timer:
   * the chart's own synthesis selected something, so the fallback is
   * moot. Leaving Selected clears the bar compat-click suppression.
   * Returns false when the transition is rejected (caller keeps the
   * old mode and must not proceed as if it had changed).
   */
  const transitionMode = (
    next: InteractionMode,
    reason: string,
    opts?: { fromDrawEnd?: boolean; viaArm?: boolean },
  ): boolean => {
    const prev = modeRef.current;
    if (prev === next) return true;
    let ok = true;
    if (next === 'ContextMenu' || next === 'Editing') ok = false;
    else if (prev === 'ContextMenu' || prev === 'Editing') ok = false;
    else if (
      (next === 'Moving' || next === 'Resizing') &&
      prev !== 'Selected' &&
      prev !== 'Idle'
    ) {
      ok = false;
    } else if (
      (prev === 'Moving' || prev === 'Resizing') &&
      next !== 'Selected'
    ) {
      ok = false;
    } else if (
      prev === 'Drawing' &&
      next === 'Selected' &&
      !opts?.fromDrawEnd
    ) {
      ok = false;
    } else if (
      prev === 'Selected' &&
      next === 'Drawing' &&
      !opts?.viaArm
    ) {
      ok = false;
    }
    recordModeTransition(prev, next, reason, ok);
    if (!ok) return false;
    if (next === 'Selected' && touchFallbackTimerRef.current) {
      clearTimeout(touchFallbackTimerRef.current);
      touchFallbackTimerRef.current = null;
    }
    if (prev === 'Selected' && next !== 'Selected') {
      barIgnoreClicksUntilRef.current = 0;
    }
    modeRef.current = next;
    return true;
  };
  /**
   * Enter an overlay state (ContextMenu in step 4, Editing for the
   * settings dialog). Records the mode we came from; exitOverlayMode
   * restores it instead of assuming Idle. No nesting: entering an
   * overlay state while already in one is rejected.
   */
  const enterOverlayMode = (
    next: 'ContextMenu' | 'Editing',
    reason: string,
  ): boolean => {
    const prev = modeRef.current;
    if (prev === 'ContextMenu' || prev === 'Editing') {
      recordModeTransition(prev, next, reason, false);
      return false;
    }
    previousModeRef.current = prev;
    modeRef.current = next;
    recordModeTransition(prev, next, reason, true);
    return true;
  };
  /**
   * Exit an overlay state, restoring the mode from before it opened.
   * The caller reconciles afterwards if the selection that mode
   * assumed is gone (see closeDialog: a dialog can delete or hide
   * its own selection).
   */
  const exitOverlayMode = (reason: string): boolean => {
    const prev = modeRef.current;
    if (prev !== 'ContextMenu' && prev !== 'Editing') {
      recordModeTransition(prev, prev, reason, false);
      return false;
    }
    const next = previousModeRef.current;
    previousModeRef.current = 'Idle';
    modeRef.current = next;
    recordModeTransition(prev, next, reason, true);
    return true;
  };

  const [selected, setSelected] = useState<SelectedOverlayState | null>(null);
  const selectedRef = useRef<SelectedOverlayState | null>(null);
  /** Which floating-bar popover is open, if any. */
  const [openPanel, setOpenPanel] = useState<
    'color' | 'lineStyle' | 'template' | null
  >(null);
  /** Overlay style templates, grouped by overlay name (tool type). */
  const [templates, setTemplates] =
    useState<OverlayTemplates>(() => persistence.loadTemplates());
  /** Name typed for "save current style as template". */
  const [templateName, setTemplateName] = useState('');
  /**
   * Object list (Phase 2 Step 5, G-07/G-08): panel open state, the
   * current projection (refreshed from readMergedList after every
   * mutation — never a second source of truth), and the ids checked
   * for batch actions. The panel itself is ObjectList.tsx.
   */
  const [objectListOpen, setObjectListOpen] = useState(false);
  const [objectListItems, setObjectListItems] = useState<ObjectListItem[]>(
    [],
  );
  const [objectListChecked, setObjectListChecked] = useState<string[]>([]);
  /** Outer chart wrapper (the floating bar's offset parent). */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  /** Floating bar element (used for click-outside popover detection). */
  const barRef = useRef<HTMLDivElement | null>(null);
  /** Object-list panel element (outside-click close). */
  const objectListPanelRef = useRef<HTMLDivElement | null>(null);
  /** Object-list toggle button (outside-click close excludes it). */
  const objectListToggleRef = useRef<HTMLButtonElement | null>(null);
  /** Shown when the current symbol's init load delivered no bars. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * G-12: user-visible save failure (corrupt store / failed write).
   * Shown once per failure in the same banner style as loadError,
   * cleared by the next verified successful persist.
   */
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  /** Last loaded / live candle, shown in the top-left legend overlay. */
  const [lastKline, setLastKline] = useState<KLineData | null>(null);
  /** Ref mirror so the once-created context-menu controller (Step 4)
   *  always reads the latest candle for its price/time fallback. */
  const lastKlineRef = useRef<KLineData | null>(null);
  lastKlineRef.current = lastKline;
  /**
   * Crosshair hover state (Phase 3 Step 1): owned by the
   * CrosshairController in lib/chart-crosshair.ts (origin: Phase 1
   * step 2a/2b). Chart holds a single instance in a ref; the legend
   * subscribes through it, so a hover update never re-renders Chart.
   * The init effect forwards onCrosshairChange to it; the container's
   * onMouseLeave and the symbol/interval switch clear through it.
   */
  const crosshairRef = useRef<CrosshairController | null>(null);
  if (crosshairRef.current === null) {
    crosshairRef.current = createCrosshairController(
      () => chartRef.current,
    );
  }
  const crosshair = crosshairRef.current;
  /**
   * Drawing undo/redo state (Phase 3 Step 2): owned by the
   * DrawingHistoryManager in lib/drawing-history.ts. Chart holds a
   * single instance in a ref; the thin wrappers below (pushHistory /
   * cancelPendingArmPush / undo / redo) delegate to it, and
   * applySnapshot stays here (it needs overlayCreate + the store +
   * mode + the object list).
   */
  const historyManagerRef = useRef<DrawingHistoryManager | null>(null);
  if (historyManagerRef.current === null) {
    historyManagerRef.current = new DrawingHistoryManager(
      (canUndo, canRedo) => onHistoryChangeRef.current?.(canUndo, canRedo),
    );
  }
  const historyManager = historyManagerRef.current;
  /** Stable chart accessor for the legend (step 2b). */
  const getChart = useCallback(() => chartRef.current, []);
  /**
   * Dev-only render counter for Phase 1 perf verification (CDP reads
   * window.__pttChartRenders). It runs after every commit of this
   * component, so its delta over a window is the whole-Chart render
   * rate. Production builds strip it entirely (NODE_ENV is replaced
   * statically at build time), so it costs nothing in the deployed
   * bundle and cannot affect behaviour.
   */
  const renderCountRef = useRef(0);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    renderCountRef.current += 1;
    (window as unknown as { __pttChartRenders?: number }).__pttChartRenders =
      renderCountRef.current;
  });
  // Clear any pending touch tap-fallback timer on unmount.
  useEffect(
    () => () => {
      if (touchFallbackTimerRef.current) {
        clearTimeout(touchFallbackTimerRef.current);
      }
    },
    [],
  );
  /** Whether the last init load delivered data (gates the live socket). */
  const initOkRef = useRef(true);
  /**
   * Data-load generation. Incremented once per symbol/interval switch
   * (and once at first load); each getBars captures the epoch at fetch
   * start and drops its response if a newer generation has begun, so a
   * late response from the old symbol/interval can never overwrite the
   * new one. F3 fix; moves with the DataLoader into ChartEngine (Step 8).
   */
  const loadEpochRef = useRef(0);
  const setSelectedState = (s: SelectedOverlayState | null) => {
    selectedRef.current = s;
    setSelected(s);
    if (s === null) {
      // Deselected: the bar goes away.
      setOpenPanel(null);
      // Mode follows the selection, but only out of Selected: a drag
      // or an overlay state owns the mode until it exits (their exit
      // restores it themselves), and a draw in progress is unaffected
      // by a selection change behind it.
      if (modeRef.current === 'Selected') {
        transitionMode('Idle', 'deselect');
      }
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
  // Thin wrappers over the DrawingPersistence instance (created
  // above): every existing call site keeps calling these names.
  // persist returns a PersistResult; `warning: undefined` means the
  // write was skipped, so the saveWarning banner is left untouched
  // (as the old inline early returns did); null clears it.

  const readMergedList = (
    symbol: string,
    interval: string,
  ): SavedOverlay[] => persistence.readMergedList(symbol, interval);

  const persistDrawings = (symbol: string, interval: string) => {
    const result = persistence.persist(symbol, interval, {
      suppressSave: suppressSaveRef.current,
      lastRestoredKey: lastRestoredKeyRef.current,
    });
    if (result.warning !== undefined) setSaveWarning(result.warning);
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
  // Stacks, the pending-arm flag and the pre-move snapshot live in
  // the DrawingHistoryManager (lib/drawing-history.ts); these are
  // thin wrappers over it. applySnapshot stays here (see below).

  const pushHistory = () => {
    historyManager.push(
      readMergedList(symbolRef.current, intervalRef.current),
    );
  };

  /**
   * G-11: pop back the pre-draw history push for the arm in progress.
   * Called wherever an unfinished draw is discarded (Esc, disarm,
   * tool switch, clear-all); a no-op once the draw has ended.
   */
  const cancelPendingArmPush = () => {
    historyManager.cancelPendingArmPush();
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

  const applySnapshot = (snapshotIn: SavedOverlay[]) => {
    const chart = chartRef.current;
    if (!chart) return;
    // G-16: renumber zLevels on undo/redo, order-preserving.
    const snapshot = normalizeZLevels(snapshotIn);
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
    // The rebuild wiped every overlay including an in-progress one
    // (undo/redo mid-draw), so no draw is in progress any more.
    refreshObjectList();
    if (modeRef.current === 'Drawing') {
      transitionMode('Idle', 'snapshot-rebuild');
    }
  };

  const undo = () => {
    const prev = historyManager.undo(
      readMergedList(symbolRef.current, intervalRef.current),
    );
    if (!prev) return;
    applySnapshot(prev);
  };

  const redo = () => {
    const next = historyManager.redo(
      readMergedList(symbolRef.current, intervalRef.current),
    );
    if (!next) return;
    applySnapshot(next);
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
        // G-11: the draw succeeded, so the arm's pre-draw history
        // push stays (a later cancel must not pop it back).
        historyManager.confirmArmPush();
        persistDrawings(symbolRef.current, intervalRef.current);
        refreshObjectList();
        drawingIdRef.current = null;
        // A freshly placed standalone text annotation has no text yet:
        // open the dialog on the 文字 tab so the user can type it.
        // (Companion annotations are never drawn interactively.)
        if (
          e.overlay.name === TEXT_ANNOTATION_NAME &&
          !e.overlay.id.endsWith(':text')
        ) {
          pendingTextIdRef.current = e.overlay.id;
          openDialogFor(e.overlay.id, 'text', { fromDrawEnd: true });
          onToolDoneRef.current();
          return;
        }
        if (continuousDrawRef.current && activeToolRef.current) {
          armOverlay(activeToolRef.current);
        } else {
          // Select the fresh drawing right away: on a phone a tap
          // almost never lands on a thin line (the chart's own hit
          // tolerance is ~±2px), so without this the user draws and
          // then cannot edit what they just drew. The floating edit
          // bar appears immediately, no second tap needed. The
          // measure overlay is transient (dismissed on the next
          // canvas click) and is never selectable, so it stays out.
          if (
            e.overlay.name !== MEASURE_NAME &&
            e.overlay.points.some(
              (p) => p.timestamp !== undefined && p.value !== undefined,
            )
          ) {
            // The only sanctioned Drawing -> Selected transition
            // (Phase 0 §7.1): draw end -> refreshSelected.
            refreshSelected(e.overlay.id, { fromDrawEnd: true });
            // The tap that ended this draw also fires a compatibility
            // click; the bar renders under the finger before it lands,
            // so swallow bar clicks briefly (see
            // barIgnoreClicksUntilRef / BAR_COMPAT_CLICK_SUPPRESS_MS).
            barIgnoreClicksUntilRef.current =
              Date.now() + BAR_COMPAT_CLICK_SUPPRESS_MS;
          } else {
            // Transient measure (or a draw with no usable points): no
            // new selection; mode returns to whatever the selection
            // says — a selection predating the draw survives it.
            if (e.overlay.name === MEASURE_NAME) {
              // The click completing this draw is also a container
              // click: mark it so handleContainerClick (which runs
              // when that click event arrives, after pointerup)
              // does not dismiss the measure it just created. The
              // next pointerdown on the container clears the mark
              // (see onContainerPointerDown).
              measureJustDrawnRef.current = true;
            }
            transitionMode(
              selectedRef.current ? 'Selected' : 'Idle',
              'draw-end:transient',
              { fromDrawEnd: true },
            );
          }
          onToolDoneRef.current();
        }
      },
      onRemoved: () => {
        if (restoringRef.current || suppressSaveRef.current) return;
        persistDrawings(symbolRef.current, intervalRef.current);
      },
      onPressedMoveStart: (e) => {
        if (restoringRef.current) return;
        if (saved.name === MEASURE_NAME) return;
        // Record the pre-move snapshot; history is pushed at move end
        // only if the overlay actually moved. A plain click on a
        // drawing starts a press but moves nothing — pushing there
        // would silently consume one undo step.
        historyManager.setMoveStartSnapshot(
          readMergedList(symbolRef.current, intervalRef.current),
        );
        // Mode: a press on an overlay starts a drag. The library
        // fires onSelected only on the click AFTER the drag (its
        // setClickOverlayInfo runs in the click handler), so
        // press-start is the mode-level select (Idle -> Selected via
        // transitionMode's implicit-select allowance), then Selected
        // -> Moving, or Resizing when the press grabbed a control
        // point: default point figures carry key
        // 'overlay_figure_point_*' (klinecharts 10.1.1 bundle,
        // OverlayView point-figure creation; custom overlays never
        // emit 'circle' figures of their own).
        const isControlPoint =
          typeof e.figure?.key === 'string' &&
          e.figure.key.startsWith('overlay_figure_point_');
        if (modeRef.current === 'Idle') {
          transitionMode('Selected', 'press:implicit-select');
        }
        transitionMode(
          isControlPoint ? 'Resizing' : 'Moving',
          isControlPoint ? 'press:resize-start' : 'press:move-start',
        );
      },
      onPressedMoveEnd: (e) => {
        if (restoringRef.current || suppressSaveRef.current) return;
        const snapshot = historyManager.takeMoveStartSnapshot();
        if (snapshot) {
          const before = snapshot.find((o) => o.id === e.overlay.id);
          const after = toSavedOverlay(e.overlay, lineParsers);
          if (
            before !== undefined &&
            after !== null &&
            JSON.stringify(before.points) !== JSON.stringify(after.points)
          ) {
            historyManager.push(snapshot);
          }
        }
        syncTextAnnotation(e.overlay.id);
        persistDrawings(symbolRef.current, intervalRef.current);
        refreshObjectList();
        // Mode: a drag always returns to Selected (its entry required
        // it). The measure overlay never enters Moving/Resizing (see
        // onPressedMoveStart), so it never returns from one either.
        if (saved.name !== MEASURE_NAME) {
          transitionMode('Selected', 'press:move-end');
        }
        // G-09: the React selection still holds the pre-drag points —
        // refresh it so the dialog's coordinates tab shows the dragged
        // position instead of writing the old one back on confirm.
        // Control-point drags (resize) end here too, so they are
        // covered by the same refresh.
        if (
          saved.name !== MEASURE_NAME &&
          selectedRef.current?.id === e.overlay.id
        ) {
          refreshSelected(e.overlay.id);
        }
      },
      onRightClick: (e) => {
        // G-18: without this the library deletes the overlay on
        // right-click (store removeOverlay, no undo). Custom overlays
        // also carry this handler in their chart-theme template;
        // built-in overlays have no template, so this instance
        // handler is what protects them.
        e.preventDefault?.();
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
        // The library creates no figure events while a draw is in
        // progress (isDrawing), so this cannot fire with mode Drawing;
        // guard anyway so a stray select never yanks the mode out of
        // a draw (Drawing -> Selected is only legal via draw end).
        if (modeRef.current === 'Drawing') return;
        refreshSelected(e.overlay.id);
      },
      onDeselected: (e) => {
        if (restoringRef.current) return;
        if (selectedRef.current?.id === e.overlay.id) setSelectedState(null);
      },
    };
  };

  /**
   * Arm one drawing: remove any unfinished overlay, then create a new one.
   * With `presetPoints` the creation is programmatic instead (context
   * menu "add line at this price"): it never enters the Drawing mode,
   * never touches an in-progress draw, and the library never fires
   * onDrawStart/onDrawEnd for it — a programmatic createOverlay with
   * complete points sets currentStep FINISHED (verified against the
   * klinecharts 10.1.1 bundle: addOverlays -> override sets
   * currentStep FINISHED when points are present, and onDrawEnd is
   * only invoked from the draw-flow mouse handlers). So the preset
   * path selects + persists explicitly, following copySelected, and
   * an Esc afterwards must not delete the line as "unfinished".
   */
  const armOverlay = (
    tool: DrawingTool,
    presetPoints?: Array<{ timestamp: number; value: number }>,
  ) => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!presetPoints) {
      // Mode first: arming starts a draw (Idle or Selected — a selection
      // predating the draw is preserved and the draw-end path returns to
      // it via selectedRef). If the transition is refused (a drag or an
      // overlay state owns the mode), do not arm: a draw with the wrong
      // mode would leave the machine inconsistent.
      if (!transitionMode('Drawing', `arm:${tool}`, { viaArm: true })) return;
      if (drawingIdRef.current) {
        // Tool switch mid-draw: discard the unfinished line AND the
        // history push its arm made (G-11).
        chart.removeOverlay({ id: drawingIdRef.current });
        drawingIdRef.current = null;
        cancelPendingArmPush();
      }
    }
    pushHistory();
    if (!presetPoints) {
      // G-11: this push belongs to the draw in progress; a cancel
      // pops it back. The preset path is a completed programmatic
      // create, so its push is never pending.
      historyManager.markArmPushPending();
    }
    const style = getLastOverlayStyle();
    const draft: SavedOverlay = {
      id: '',
      name: tool,
      points: presetPoints ?? [],
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
    if (typeof id !== 'string') {
      cancelPendingArmPush();
      return;
    }
    if (presetPoints) {
      // Complete on creation: select it (like draw-end auto-select)
      // and persist — copySelected's pattern, not the draw flow.
      refreshSelected(id);
      persistDrawings(symbolRef.current, intervalRef.current);
      refreshObjectList();
    } else {
      drawingIdRef.current = id;
    }
  };

  const restoreDrawings = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const symbol = symbolRef.current;
    const interval = intervalRef.current;
    // G-05: validate every stored entry (bad ones are skipped and
    // counted, never allowed to break the restore or the K-line
    // load). This function never throws: it is called from getBars'
    // try, and a restore failure must never trigger that catch's
    // callback([], ...) which clears the candles.
    let list: SavedOverlay[] = [];
    let skipped = 0;
    try {
      const stored = loadDrawingsStore()[symbol] ?? [];
      const seenIds = new Set<string>();
      for (const o of stored) {
        const valid = validateSavedOverlay(o, seenIds);
        if (valid === null) {
          skipped += 1;
          continue;
        }
        if (isInView(valid, interval)) list.push(valid);
      }
      // G-16: renumber zLevels to consecutive integers, order-preserving.
      list = normalizeZLevels(list);
    } catch (err) {
      console.warn(
        '[ptt] restoreDrawings: stored drawings unreadable, showing none',
        err,
      );
      list = [];
    }
    if (skipped > 0) {
      console.warn(
        `[ptt] restoreDrawings: skipped ${skipped} invalid stored overlay(s) for ${symbol}`,
      );
    }
    // Idempotent: getBars("init") can fire more than once per symbol/
    // timeframe change (setSymbol + setPeriod each trigger a load), so
    // always wipe first — otherwise every load duplicates the drawings.
    restoringRef.current = true;
    suppressSaveRef.current = true;
    try {
      chart.removeOverlay();
      for (const o of list) {
        try {
          chart.createOverlay(overlayCreate(o));
        } catch (err) {
          // One bad entry must not abort the rest of the restore.
          console.warn(
            '[ptt] restoreDrawings: createOverlay failed, skipped',
            o.id,
            o.name,
            err,
          );
        }
      }
      syncAllTextAnnotations();
      resetChartClickOverlay();
    } catch (err) {
      console.warn('[ptt] restoreDrawings: rebuild failed', err);
    } finally {
      suppressSaveRef.current = false;
      restoringRef.current = false;
    }
    // G-19: this view has restored; persists for it are allowed now.
    lastRestoredKeyRef.current = `${symbol}:${interval}`;
    refreshObjectList();
  };

  // ---- selection + edit bar --------------------------------------------

  /**
   * Re-read the live overlay into the React selection state, and move
   * the mode to Selected — except while a drag or an overlay state
   * owns the mode (their exit restores it themselves), and except
   * while a draw is in progress: Drawing -> Selected is only legal as
   * part of a draw end, so callers in that path pass fromDrawEnd.
   */
  const refreshSelected = (
    id: string | null,
    opts?: { fromDrawEnd?: boolean },
  ) => {
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
      tagText: typeof ext.tagText === 'string' ? ext.tagText : '',
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
    const m = modeRef.current;
    if (m === 'Idle' || m === 'Selected') {
      transitionMode('Selected', 'select:refresh');
    } else if (m === 'Drawing' && opts?.fromDrawEnd) {
      transitionMode('Selected', 'draw-end:auto-select', {
        fromDrawEnd: true,
      });
    }
    // Moving / Resizing / Editing / ContextMenu: the mode stays with
    // whoever owns it; the selection state above is still refreshed.
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
      refreshObjectList();
      return;
    }
    refreshSelected(cur.id);
    refreshObjectList();
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
    refreshObjectList();
  };

  const copySelected = () => {
    const cur = selectedRef.current;
    if (!cur) return;
    const chart = chartRef.current;
    if (!chart) return;
    const o = chart.getOverlays({ id: cur.id })[0];
    if (!o) return;
    const saved = toSavedOverlay(o, lineParsers);
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
    refreshObjectList();
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

  // ---- object list (Phase 2 Step 5, G-07/G-08) ------------------------
  //
  // The list is a projection of readMergedList (stored out-of-view
  // overlays + live in-view overlays), sorted topmost-first; it holds
  // no data of its own. refreshObjectList re-reads it after every
  // mutation (call sites: onDrawEnd, applyEdit, applyDialog,
  // deleteSelected, copySelected, applySnapshot, restoreDrawings,
  // clearDrawings, onPressedMoveEnd, preset-point arm, closeDialog's
  // empty-text removal, batch/per-id list actions, panel open).
  // Per-row visible/lock/delete and batch actions reuse the existing
  // paths for live overlays (overrideOverlay / removeOverlay +
  // pushHistory + persistDrawings); overlays not on the current
  // interval are not in the chart, so those actions patch the stored
  // copy directly (same loadDrawingsStore/saveDrawingsStore pattern
  // applySnapshot and clearDrawings already use) and persistDrawings
  // keeps the patched copy on the next write (readMergedList retains
  // stored out-of-view entries).

  /** Re-read the list projection. Prunes checked ids that no longer exist. */
  const refreshObjectList = () => {
    const list = readMergedList(symbolRef.current, intervalRef.current);
    const sorted = [...list].sort(
      (a, b) => (b.zLevel ?? 0) - (a.zLevel ?? 0),
    );
    const items: ObjectListItem[] = sorted.map((o, i) => ({
      id: o.id,
      name: o.name,
      label:
        DRAWING_TOOLS.find((t) => t.id === o.name)?.label ?? o.name,
      visible: o.visible !== false,
      lock: o.lock === true,
      order: i + 1,
      total: sorted.length,
      inView: isInView(o, intervalRef.current),
      intervalsLabel:
        o.visibleIntervals === undefined
          ? undefined
          : o.visibleIntervals
              .map(
                (iv) =>
                  INTERVAL_LABELS[iv as Interval] ?? iv,
              )
              .join('、'),
    }));
    setObjectListItems(items);
    const ids = new Set(items.map((it) => it.id));
    setObjectListChecked((prev) => prev.filter((id) => ids.has(id)));
  };

  /** Toggle one id in the multi-select set. */
  const toggleListCheck = (id: string) => {
    setObjectListChecked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  /** Row click: in-view rows canvas-select (floating bar appears);
   *  out-of-view rows cannot be selected — their overlay is not in
   *  the chart — so the click toggles their multi-select checkbox. */
  const handleListRowClick = (id: string) => {
    const item = objectListItems.find((it) => it.id === id);
    if (!item) return;
    if (item.inView) {
      // Same programmatic path as copy/preset-point selection (no
      // _clickOverlayInfo sync — V-04, deliberately not fixed here).
      refreshSelected(id);
    } else {
      toggleListCheck(id);
    }
  };

  /**
   * Patch one stored (out-of-view) overlay in place. patch returns
   * the replacement, or null to remove the entry. Returns false when
   * the id is not in the stored list for this symbol.
   */
  const patchStoredOverlay = (
    id: string,
    patch: (o: SavedOverlay) => SavedOverlay | null,
  ): boolean => {
    const store = loadDrawingsStore();
    const list = store[symbolRef.current] ?? [];
    const idx = list.findIndex((o) => o.id === id);
    if (idx < 0) return false;
    const next = patch(list[idx]);
    const out = [...list];
    if (next === null) out.splice(idx, 1);
    else out[idx] = next;
    store[symbolRef.current] = out;
    saveDrawingsStore(store);
    return true;
  };

  /** List row: toggle visible. Selected overlays go through
   *  applyEdit so the floating bar stays in sync; other live
   *  overlays are overridden directly; out-of-view overlays are
   *  patched in the store. */
  const toggleListVisible = (id: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    const live = chart.getOverlays({ id })[0];
    if (live) {
      if (selectedRef.current?.id === id) {
        applyEdit({ visible: !selectedRef.current.visible });
      } else {
        pushHistory();
        chart.overrideOverlay({ id, visible: !live.visible });
        syncTextAnnotation(id);
        persistDrawings(symbolRef.current, intervalRef.current);
      }
    } else {
      pushHistory();
      patchStoredOverlay(id, (o) => ({
        ...o,
        visible: o.visible === false ? undefined : false,
      }));
    }
    refreshObjectList();
  };

  /** List row: toggle lock (same live/stored split as visible). */
  const toggleListLock = (id: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    const live = chart.getOverlays({ id })[0];
    if (live) {
      if (selectedRef.current?.id === id) {
        applyEdit({ lock: !selectedRef.current.lock });
      } else {
        pushHistory();
        chart.overrideOverlay({ id, lock: !live.lock });
        persistDrawings(symbolRef.current, intervalRef.current);
      }
    } else {
      pushHistory();
      patchStoredOverlay(id, (o) => ({
        ...o,
        lock: o.lock === true ? undefined : true,
      }));
    }
    refreshObjectList();
  };

  /** List row: delete one overlay (live or stored). One history step. */
  const deleteListOverlay = (id: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    const live = chart.getOverlays({ id })[0];
    pushHistory();
    if (live) {
      // groupId removes the main line and its text annotation together.
      chart.removeOverlay({ groupId: id });
      if (selectedRef.current?.id === id) deselect();
    } else {
      patchStoredOverlay(id, () => null);
      if (selectedRef.current?.id === id) deselect();
    }
    persistDrawings(symbolRef.current, intervalRef.current);
    refreshObjectList();
  };

  /** Batch hide/show/lock/unlock/delete over the checked ids (G-08).
   *  One history step for the whole batch. Live overlays are
   *  overridden/removed directly; stored-only overlays are patched
   *  in a single store write. */
  const batchListAction = (action: ObjectListBatchAction) => {
    const chart = chartRef.current;
    if (!chart || objectListChecked.length === 0) return;
    const ids = [...objectListChecked];
    pushHistory();
    const storedIds = ids.filter(
      (id) => chart.getOverlays({ id })[0] === undefined,
    );
    for (const id of ids) {
      const live = chart.getOverlays({ id })[0];
      if (!live) continue;
      if (action === 'delete') {
        chart.removeOverlay({ groupId: id });
      } else if (action === 'hide') {
        chart.overrideOverlay({ id, visible: false });
        syncTextAnnotation(id);
      } else if (action === 'show') {
        chart.overrideOverlay({ id, visible: true });
        syncTextAnnotation(id);
      } else if (action === 'lock') {
        chart.overrideOverlay({ id, lock: true });
      } else if (action === 'unlock') {
        chart.overrideOverlay({ id, lock: false });
      }
    }
    if (storedIds.length > 0) {
      const store = loadDrawingsStore();
      const cur = store[symbolRef.current] ?? [];
      if (action === 'delete') {
        store[symbolRef.current] = cur.filter(
          (o) => !storedIds.includes(o.id),
        );
      } else {
        store[symbolRef.current] = cur.map((o) =>
          storedIds.includes(o.id)
            ? {
                ...o,
                ...(action === 'hide'
                  ? { visible: false }
                  : action === 'show'
                    ? { visible: undefined }
                    : action === 'lock'
                      ? { lock: true }
                      : { lock: undefined }),
              }
            : o,
        );
      }
      saveDrawingsStore(store);
    }
    const selectedDeleted =
      action === 'delete' &&
      selectedRef.current !== null &&
      ids.includes(selectedRef.current.id);
    if (selectedDeleted) {
      deselect();
    } else if (selectedRef.current !== null) {
      // Keep the floating bar in sync (e.g. lock icon after batch lock).
      refreshSelected(selectedRef.current.id);
    }
    persistDrawings(symbolRef.current, intervalRef.current);
    refreshObjectList();
  };

  /** Open/close the list panel; opening always re-reads the list. */
  const toggleObjectList = () => {
    if (!objectListOpen) refreshObjectList();
    setObjectListOpen(!objectListOpen);
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
    tagText: cur.tagText,
    points: cur.points.map((p) => ({ ...p })),
    visibleIntervals: cur.visibleIntervals
      ? [...cur.visibleIntervals]
      : undefined,
  });

  const openDialogFor = (
    id: string,
    tab: DialogTab,
    opts?: { fromDrawEnd?: boolean },
  ) => {
    refreshSelected(id, opts);
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
    // Overlay state: closeDialog restores the mode from before the
    // dialog opened (Selected in the normal path — never assume Idle).
    enterOverlayMode('Editing', 'dialog:open');
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
        refreshObjectList();
      }
    }
    setDialogDraft(null);
    dialogOpenRef.current = false;
    exitOverlayMode('dialog:close');
    // The dialog can delete or hide its own selection (empty text
    // annotation removed above; applyDialog's hidden-interval path):
    // a restored Selected with nothing selected is inconsistent, so
    // fall back to Idle.
    if (modeRef.current === 'Selected' && selectedRef.current === null) {
      transitionMode('Idle', 'dialog:close:no-selection');
    }
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
      refreshObjectList();
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
    if (o.name === 'simpleTag') {
      // The Y-axis tag reads extendData.tagText (chart-theme) and
      // falls back to the price when it is empty. Blank clears the
      // custom tag: assign undefined rather than deleting the key —
      // overrideOverlay deep-merges extendData, so a deleted key
      // would survive on the live overlay (see applyEdit).
      ext.tagText =
        draft.tagText.trim() === '' ? undefined : draft.tagText;
    }
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
      refreshObjectList();
      closeDialog();
      return;
    }
    refreshSelected(cur.id);
    refreshObjectList();
    closeDialog();
  };

  // ---- range fit (shared by the ChartHandle and the menu reset) ----

  /**
   * Fit a calendar range into the chart width, pinned to the latest
   * candle. The span is capped by the candles actually loaded (500 per
   * init load, more on scroll), so wide ranges on short intervals show
   * the widest available window.
   */
  const applyRange = (range: RangeId) => {
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
      const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
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
  };

  // ---- context menu (Phase 3 Step 4, Phase 0 §6.2 / §7.1) -----------
  //
  // Owned by the ContextMenuController in lib/chart-context-menu.ts
  // (was inline here since Phase 1 step 4). Chart holds a single
  // instance in a ref; the menu state is mirrored to React state
  // through onStateChange for ChartContextMenu.tsx (pure
  // presentation, untouched) to render. The controller only issues
  // action requests through `actions` — it never operates the chart
  // itself, except for the scroll/zoom enable-disable that brackets
  // the open menu. G-18 holds: right-clicking an overlay never
  // deletes it; `delete` goes through the normal deleteSelected path.
  // chart-settings opens the appearance dialog (outer appearance
  // track); openDialogFor is bound to the 'style' tab here because
  // DialogTab lives in Chart.

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
    null,
  );
  const contextMenuControllerRef = useRef<ContextMenuController | null>(null);
  if (contextMenuControllerRef.current === null) {
    contextMenuControllerRef.current = createContextMenuController({
      getChart: () => chartRef.current,
      getContainer: () => containerRef.current,
      getWrapper: () => wrapperRef.current,
      getSelected: () => selectedRef.current,
      getLastKline: () => lastKlineRef.current,
      isDialogOpen: () => dialogOpenRef.current,
      isDragging: () =>
        modeRef.current === 'Moving' || modeRef.current === 'Resizing',
      isOpen: () => modeRef.current === 'ContextMenu',
      onModeEnter: () => enterOverlayMode('ContextMenu', 'contextmenu:open'),
      onModeExit: () => exitOverlayMode('contextmenu:close'),
      onStateChange: setContextMenu,
      actions: {
        armHorizontalAt: (timestamp, price) =>
          armOverlay('horizontalStraightLine', [{ timestamp, value: price }]),
        armVerticalAt: (timestamp, price) =>
          armOverlay('verticalStraightLine', [{ timestamp, value: price }]),
        deleteSelected: () => deleteSelected(),
        copySelected: () => copySelected(),
        bringToFront: () => bringToFront(),
        sendToBack: () => sendToBack(),
        toggleLock: (locked) => applyEdit({ lock: locked }),
        toggleVisible: (visible) => applyEdit({ visible }),
        openDialogFor: (id) => openDialogFor(id, 'style'),
        openAppearanceSettings: () =>
          onOpenAppearanceSettingsRef.current?.(),
        resetView: () => applyRange(DEFAULT_RESET_RANGE),
      },
    });
  }
  const contextMenuController = contextMenuControllerRef.current;

  /** Close the menu on any pointer press outside it (effect lives
   *  here because it is React state-driven; the listener itself is
   *  owned by the controller). Presses on the chart itself land on
   *  the backdrop first; this covers the toolbar, watchlist and
   *  range bar. */
  useEffect(() => {
    if (contextMenu === null) return;
    return contextMenuController.attachOutsideClose();
  }, [contextMenu, contextMenuController]);

  useImperativeHandle(ref, () => ({
    clearDrawings() {
      const chart = chartRef.current;
      if (!chart) return;
      // G-11: an in-progress draw is wiped too; its pending push goes back.
      cancelPendingArmPush();
      pushHistory();
      suppressSaveRef.current = true;
      chart.removeOverlay();
      suppressSaveRef.current = false;
      // G-19: same guard as persistDrawings — clearing before the
      // first restore completed would write [] over stored drawings.
      if (
        lastRestoredKeyRef.current ===
        `${symbolRef.current}:${intervalRef.current}`
      ) {
        const store = loadDrawingsStore();
        store[symbolRef.current] = [];
        saveDrawingsStore(store);
      }
      deselect();
      refreshObjectList();
      // removeOverlay() above wiped an in-progress draw too, if any.
      if (modeRef.current === 'Drawing') {
        transitionMode('Idle', 'clear-drawings');
      }
    },
    undo() {
      undo();
    },
    redo() {
      redo();
    },
    setRange(range: RangeId) {
      applyRange(range);
    },
    resetView() {
      applyRange(DEFAULT_RESET_RANGE);
    },
    openObjectList() {
      refreshObjectList();
      setObjectListOpen(true);
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

    // Appearance styles layer on top of DARK_STYLES: the overlay
    // styles (point/line/rect) still come from DARK_STYLES, the rest
    // from the user's appearance (defaults = the DARK_STYLES look).
    const chart = init(container, {
      styles: {
        ...DARK_STYLES,
        ...buildAppearanceStyles(appearanceRef.current),
      },
    });
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
    // convertFromPixel -> dataIndex into the loaded list. Publishing
    // is rAF-throttled with same-target dedup (see CrosshairController
    // in lib/chart-crosshair.ts): a 60-125 Hz mouse must not
    // re-render Chart once per event.
    chart.subscribeAction(
      'onCrosshairChange',
      crosshair.handleCrosshairChange,
    );

    // Debug handle for browser-console inspection
    // (e.g. __pttChart.getOverlays(), __pttChart.getVisibleRange()).
    (window as unknown as { __pttChart?: Chart }).__pttChart = chart;

    chart.setZoomEnabled(true);
    chart.setScrollEnabled(true);
    // First load generation (see loadEpochRef).
    loadEpochRef.current += 1;
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
        // Capture this load's generation; a response that arrives after
        // a newer generation began is dropped below (no callback — the
        // library is safe: setSymbol/setPeriod/setDataLoader all go
        // through resetData, which clears _loading and issues the new
        // generation's init load synchronously; verified against the
        // installed klinecharts 10.1.1 bundle, StoreImp.resetData).
        const epoch = loadEpochRef.current;
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
          // Stale generation: drop silently. No callback, no state
          // writes, no restoreDrawings — the newer generation owns the chart.
          if (epoch !== loadEpochRef.current) return;
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
          // Stale generation: same drop — not even an error state, the
          // newer generation's own load reports its own outcome.
          if (epoch !== loadEpochRef.current) return;
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
            // Last-tick time for the status bar, throttled to once a
            // second (the display only has second precision).
            const now = Date.now();
            if (now - lastTickReportRef.current >= 1000) {
              lastTickReportRef.current = now;
              onLastTickRef.current?.(now);
            }
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
      crosshair.dispose();
      chart.unsubscribeAction(
        'onCrosshairChange',
        crosshair.handleCrosshairChange,
      );
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
    crosshair.clear();
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
      historyManager.clear();
      deselect();
      // An unfinished drawing cannot survive the switch: cancel it.
      drawingIdRef.current = null;
      if (modeRef.current === 'Drawing') {
        transitionMode('Idle', 'symbol-change');
      }
      if (activeToolRef.current) onToolDoneRef.current();
      // New load generation: the setSymbol/setPeriod below (each firing
      // its own getBars("init")) belong to this one generation. This must
      // sit inside the change branch — the effect also re-runs without a
      // change (dev double-invoke), and incrementing there would orphan
      // the in-flight load with no replacement load issued.
      loadEpochRef.current += 1;
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
        // G-11: the cancelled draw's pre-draw history push goes back.
        cancelPendingArmPush();
      }
      // A draw that ends by disarming (Esc cancel, tool switch)
      // returns to whatever the selection says.
      if (modeRef.current === 'Drawing') {
        transitionMode(
          selectedRef.current ? 'Selected' : 'Idle',
          'disarm',
          { fromDrawEnd: true },
        );
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
      // While the context menu is open it owns the interaction: only
      // Escape closes it; every other chart shortcut stays paused
      // until the menu is gone (Phase 0 §7.1: all chart interaction
      // pauses while ContextMenu is open).
      if (modeRef.current === 'ContextMenu') {
        if (e.key === 'Escape') {
          e.preventDefault();
          contextMenuController.close();
        }
        return;
      }
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
          // G-11: the cancelled draw's pre-draw history push goes back.
          cancelPendingArmPush();
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

  // ---- appearance -----------------------------------------------------
  // setStyles is a recursive deep merge (klinecharts bundle merge()),
  // so this never clobbers the candle type or the tooltip showRule
  // set above. The background colour is not a Styles field — it lives
  // on the container div (see the render below).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setStyles(buildAppearanceStyles(appearance));
  }, [appearance]);

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
        // isStack=true is required for main-pane indicators: addIndicator
        // clears the other indicators in the pane when isStack is false,
        // so MA/EMA/BOLL sharing candle_pane would delete each other.
        chart.createIndicator(
          isMainPaneIndicator(name) ? { name, paneId: CANDLE_PANE_ID } : name,
          isMainPaneIndicator(name),
        );
      }
    }
  }, [indicators]);

  // Clicking empty chart space dismisses a finished measure overlay.
  // No timer is needed any more (Phase 1 step 3 removes the B10
  // setTimeout(0) + 100ms last-click guard): the library's
  // onSelected/onDeselected run synchronously inside the canvas click
  // handler — before this React onClick bubbles — so by the time this
  // runs, mode already reflects the click. Only a click on empty
  // space while Idle dismisses the measure: an overlay click leaves
  // mode Selected, and a click that places a draw point leaves mode
  // Drawing — both must keep the measure (the old 100ms guard's real
  // job was exactly this: the draw's own clicks fired the overlay's
  // onClick, which is what kept the measure alive while drawing).
  // One exception, handled by a same-event marker rather than a
  // timestamp: the click that completes a measure draw
  // (measureJustDrawnRef) must not dismiss the measure it just
  // created — at that moment mode is already Idle.
  const handleContainerClick = () => {
    if (measureJustDrawnRef.current) {
      measureJustDrawnRef.current = false;
      return;
    }
    if (modeRef.current !== 'Idle') return;
    const chart = chartRef.current;
    if (!chart) return;
    const measure = chart.getOverlays({ name: MEASURE_NAME })[0];
    if (measure) chart.removeOverlay({ id: measure.id });
  };

  /**
   * Closest visible overlay to a tap (client coords), within
   * `radiusPx`. Anchor polyline, segment distance; single-point
   * tools count as a point. Skipped: the transient measure overlay,
   * text-annotation companions (':text') and invisible overlays.
   * Locked overlays stay selectable, exactly like a mouse click
   * today. Only overlays on this interval's chart exist in the
   * chart, so the search is already interval-scoped. Anchor points
   * are converted with convertToPixel({ absolute: true }) — verified
   * against klinecharts 10.1.1 source: x is container-relative and
   * absolute y is the pane top + pane-relative y, i.e. also
   * container-relative.
   */
  const nearestOverlayAt = (
    clientX: number,
    clientY: number,
    radiusPx: number,
  ): { id: string; dist: number } | null => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return null;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { id: string; dist: number } | null = null;
    for (const o of chart.getOverlays()) {
      if (o.visible === false) continue;
      if (o.name === MEASURE_NAME) continue;
      if (o.id.endsWith(':text')) continue;
      const pts = o.points.filter(
        (p): p is { timestamp: number; value: number } =>
          p.timestamp !== undefined && p.value !== undefined,
      );
      if (pts.length === 0) continue;
      const raw = chart.convertToPixel(
        pts.map((p) => ({ timestamp: p.timestamp, value: p.value })),
        { absolute: true },
      );
      const coords = (Array.isArray(raw) ? raw : [raw]).filter(
        (c): c is { x: number; y: number } =>
          typeof c?.x === 'number' &&
          typeof c?.y === 'number' &&
          Number.isFinite(c.x) &&
          Number.isFinite(c.y),
      );
      if (coords.length === 0) continue;
      let d: number;
      if (coords.length === 1) {
        d = Math.hypot(x - coords[0].x, y - coords[0].y);
      } else {
        d = Infinity;
        for (let i = 0; i < coords.length - 1; i += 1) {
          d = Math.min(d, distToSegment(x, y, coords[i], coords[i + 1]));
        }
      }
      if (d <= radiusPx && (best === null || d < best.dist)) {
        best = { id: o.id, dist: d };
      }
    }
    return best;
  };

  /**
   * Touch tap-to-select fallback (mobile only — mouse/pen never take
   * this path; klinecharts only calls preventDefault, never
   * stopPropagation, so these React pointer handlers still fire).
   * A tap is pointerdown -> pointerup, <10px movement, <500ms, with
   * no tool armed and no drawing in progress. The chart's own click
   * handling gets TOUCH_FALLBACK_WAIT_MS to select something first
   * (its ±2px hit test wins when it lands); only then do we search
   * for the nearest overlay within 24 CSS px. The wait is
   * unavoidable — the library synthesises its tap handling after
   * touchend and no compat click reaches the container (measured) —
   * but the DECISION is mode-based now (Phase 1 step 3): a transition
   * into Selected cancels the timer (the chart's own synthesis won),
   * and the callback itself only skips while a drag or an overlay
   * state owns the interaction. A tap on empty space clears the
   * selection — the fallback never re-selects the overlay it just
   * cleared, because the search runs once per tap.
   */
  const onContainerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A new press on the chart ends the measure-just-drawn mark (see
    // measureJustDrawnRef): the completing click's own pointerdown
    // predates the draw end, so only a genuinely later press clears
    // it — the following click may then dismiss the measure.
    measureJustDrawnRef.current = false;
    if (e.pointerType !== 'touch') return;
    touchTapStartRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
    };
  };

  const onContainerPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = touchTapStartRef.current;
    touchTapStartRef.current = null;
    if (!start || e.pointerType !== 'touch' || e.pointerId !== start.pointerId)
      return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 10) return;
    if (Date.now() - start.time >= 500) return;
    // A tool is armed or a drawing is in progress: the tap belongs
    // to the drawing flow, not selection.
    if (activeToolRef.current || drawingIdRef.current) return;
    const tap = { x: e.clientX, y: e.clientY, time: Date.now() };
    const prev = lastTouchTapRef.current;
    lastTouchTapRef.current = tap;
    // Double-tap on the selected overlay opens its settings dialog
    // (touch equivalent of double-click). Armed tools / in-progress
    // drawings are already excluded above.
    if (
      prev &&
      selectedRef.current &&
      tap.time - prev.time <= 300 &&
      Math.hypot(tap.x - prev.x, tap.y - prev.y) <= 20
    ) {
      const near = nearestOverlayAt(tap.x, tap.y, 24);
      if (near && near.id === selectedRef.current.id) {
        if (touchFallbackTimerRef.current) {
          clearTimeout(touchFallbackTimerRef.current);
          touchFallbackTimerRef.current = null;
        }
        openDialogFor(selectedRef.current.id, 'style');
        return;
      }
    }
    if (touchFallbackTimerRef.current) {
      clearTimeout(touchFallbackTimerRef.current);
    }
    touchFallbackTimerRef.current = setTimeout(() => {
      touchFallbackTimerRef.current = null;
      // Mode is the arbiter now, but only for the cases the timer
      // cannot decide: a drag (Moving/Resizing) or an open dialog /
      // menu owns the interaction, so the fallback must not run. In
      // every other mode it runs: Idle (nothing selected), Drawing (a
      // tool was armed inside the window — the old behaviour also
      // selected then), and Selected. Selected matters: the library
      // only changes the selection via onSelected/onDeselected, and
      // a transition into Selected cancels this timer — so a timer
      // still pending with mode Selected means the library did NOT
      // select on this tap (e.g. the selection came from an earlier
      // fallback tap, which the library never hears about: its stored
      // click info is already null, so a later blank tap produces no
      // onDeselected and only this fallback can clear it).
      if (
        modeRef.current === 'Moving' ||
        modeRef.current === 'Resizing' ||
        modeRef.current === 'Editing' ||
        modeRef.current === 'ContextMenu'
      ) {
        return;
      }
      const near = nearestOverlayAt(tap.x, tap.y, 24);
      if (near) {
        if (near.id !== selectedRef.current?.id) refreshSelected(near.id);
      } else if (selectedRef.current !== null) {
        deselect();
      }
    }, TOUCH_FALLBACK_WAIT_MS);
  };

  // ---- floating edit bar: popovers --------------------------------

  /** Close any open floating-bar popover when clicking outside the bar. */
  useEffect(() => {
    if (openPanel === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel]);

  /** Close the object-list panel on a pointer press outside it
   *  (the toggle button itself is excluded: its click toggles).
   *  The floating bar is excluded too: it edits the selection the
   *  list shows, so closing the list on every bar click would force
   *  a reopen after each edit. Canvas / toolbar presses still close. */
  useEffect(() => {
    if (!objectListOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (objectListPanelRef.current?.contains(e.target as Node)) return;
      if (objectListToggleRef.current?.contains(e.target as Node)) return;
      if (barRef.current?.contains(e.target as Node)) return;
      setObjectListOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [objectListOpen]);

  const togglePanel = (
    panel: 'color' | 'lineStyle' | 'template',
  ) => {
    setOpenPanel((cur) => (cur === panel ? null : panel));
  };

  /** Apply a saved template's style to the selected overlay. */
  const applyTemplate = (tpl: OverlayTemplate) => {
    applyEdit({
      color: tpl.style.color,
      opacity: tpl.style.opacity,
      size: tpl.style.size,
      style: tpl.style.style,
      fillOpacity: tpl.style.fillOpacity,
    });
    setOpenPanel(null);
  };

  /** Save the selected overlay's current style as a template. A
   *  duplicate name overwrites the existing template in place. */
  const saveTemplate = () => {
    const cur = selectedRef.current;
    if (!cur) return;
    const name = templateName.trim();
    if (!name) return;
    const style: LastOverlayStyle = {
      color: cur.color,
      opacity: cur.opacity,
      size: cur.size,
      style: cur.style,
      fillOpacity: cur.fillOpacity,
    };
    setTemplates((prev) => {
      const group = prev[cur.name] ?? [];
      const idx = group.findIndex((t) => t.name === name);
      const nextGroup =
        idx >= 0
          ? group.map((t, i) => (i === idx ? { name, style } : t))
          : [...group, { name, style }];
      const next = { ...prev, [cur.name]: nextGroup };
      persistence.saveTemplates(next);
      return next;
    });
    setTemplateName('');
  };

  /** Delete a saved template from the selected overlay's group. */
  const deleteTemplate = (name: string) => {
    const cur = selectedRef.current;
    if (!cur) return;
    setTemplates((prev) => {
      const group = (prev[cur.name] ?? []).filter((t) => t.name !== name);
      const next = { ...prev };
      if (group.length > 0) next[cur.name] = group;
      else delete next[cur.name];
      persistence.saveTemplates(next);
      return next;
    });
  };

  // Legend (OHLC + indicators + countdown) lives in the memoized
  // ChartLegend component (components/ChartLegend.tsx): hover updates
  // re-render only that subtree, never this whole component
  // (Phase 1 step 2b).

  // Floating-bar position: one compact icon bar, docked at the
  // bottom centre of the chart on every screen width (desktop now
  // matches mobile). It covers the bottom ~50px of the chart while
  // open; popovers open upward from it.

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onContextMenu={contextMenuController.handleContainerContextMenu}
        onPointerDown={onContainerPointerDown}
        onPointerUp={onContainerPointerUp}
        onMouseLeave={() => {
          crosshair.clear();
        }}
        className="h-full w-full"
        // Chart background: klinecharts Styles has no background
        // field (the canvas is transparent), so it lives here.
        style={{ backgroundColor: appearance.background }}
        data-testid="chart-container"
      />
      <ChartLegend
        symbol={symbol}
        interval={interval}
        indicators={indicators}
        lastKline={lastKline}
        loadError={loadError}
        getChart={getChart}
        subscribeHover={crosshair.subscribe}
        upColor={appearance.candleUpColor}
        downColor={appearance.candleDownColor}
        labelColor={appearance.axisTextColor}
      />
      {/* Top-right corner: chart settings gear + object list toggle
          (Phase 2 Step 5, G-07/G-08). The legend owns the top-left
          and the floating bar the bottom centre, so this corner is
          free on desktop and mobile. The gear is the always-visible
          appearance entry — the toolbar gear sits at the far right of
          a horizontally scrolling bar, so it needs a scroll to reach
          on phones. */}
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5">
        <button
          data-testid="chart-appearance-settings"
          title="圖表設定"
          aria-label="圖表設定"
          onClick={() => onOpenAppearanceSettingsRef.current?.()}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2a2e39] bg-[#1e222d]/95 text-[#d1d4dc] shadow-lg hover:bg-[#262b38]"
        >
          <BarGearIcon />
        </button>
        <button
          ref={objectListToggleRef}
          data-testid="object-list-toggle"
          title="物件清單"
          aria-label="物件清單"
          aria-expanded={objectListOpen}
          onClick={toggleObjectList}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[#2a2e39] bg-[#1e222d]/95 px-2.5 text-xs text-[#d1d4dc] shadow-lg hover:bg-[#262b38]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="2" y1="3.5" x2="12" y2="3.5" />
            <line x1="2" y1="7" x2="12" y2="7" />
            <line x1="2" y1="10.5" x2="12" y2="10.5" />
          </svg>
          物件清單
          {objectListItems.length > 0 && (
            <span className="rounded-full bg-[#2962ff] px-1.5 py-px text-[10px] font-semibold text-white">
              {objectListItems.length}
            </span>
          )}
        </button>
      </div>
      {objectListOpen && (
        <div ref={objectListPanelRef}>
          <ObjectList
            items={objectListItems}
            currentIntervalLabel={INTERVAL_LABELS[interval]}
            selectedId={selected?.id ?? null}
            checkedIds={objectListChecked}
            onRowClick={handleListRowClick}
            onToggleCheck={toggleListCheck}
            onToggleAll={() =>
              setObjectListChecked(
                objectListChecked.length === objectListItems.length &&
                  objectListItems.length > 0
                  ? []
                  : objectListItems.map((it) => it.id),
              )
            }
            onToggleVisible={toggleListVisible}
            onToggleLock={toggleListLock}
            onDelete={deleteListOverlay}
            onBatch={batchListAction}
            onClose={() => setObjectListOpen(false)}
          />
        </div>
      )}
      {(loadError !== null || saveWarning !== null) && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex flex-col items-center gap-1 px-2">
          {loadError !== null && (
            <div className="rounded-md border border-[#ef5350]/50 bg-[#1e222d]/95 px-3 py-2 text-xs leading-relaxed text-[#f5c6c6] shadow-lg">
              {loadError}
            </div>
          )}
          {saveWarning !== null && (
            <div
              data-testid="save-warning"
              className="rounded-md border border-[#ffb300]/50 bg-[#1e222d]/95 px-3 py-2 text-xs leading-relaxed text-[#ffe082] shadow-lg"
            >
              {saveWarning}
            </div>
          )}
        </div>
      )}
      {selected !== null && (
        <div
          ref={barRef}
          data-testid="floating-bar"
          onClickCapture={(e) => {
            // Swallow the compatibility click from the tap that ended
            // the draw (see barIgnoreClicksUntilRef, owned by the
            // Drawing -> Selected transition): the bar renders under
            // the finger before that click lands.
            if (Date.now() < barIgnoreClicksUntilRef.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          className="absolute z-20 flex max-w-full flex-nowrap items-center gap-1 rounded-md border border-[#2a2e39] bg-[#1e222d]/95 px-2 py-1.5 text-xs text-[#d1d4dc] shadow-lg"
          style={{ left: '50%', bottom: 8, transform: 'translateX(-50%)' }}
        >
          {/* A standalone text annotation has no line to style: hide
              the colour / line-style controls for it. */}
          {selected.name !== TEXT_ANNOTATION_NAME && (
            <>
              {/* Template button (first, icon-only). A text
                  annotation has no line to style, so it gets no
                  template button either (same as the colour /
                  line-style controls). */}
              <button
                title="範本"
                aria-label="範本"
                onClick={() => togglePanel('template')}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10 ${
                  openPanel === 'template' ? 'bg-white/10' : ''
                }`}
              >
                <BarTemplateIcon />
              </button>
              <button
                title={`顏色 ${selected.color}（不透明度 ${Math.round(selected.opacity * 100)}%）`}
                aria-label="顏色"
                onClick={() => togglePanel('color')}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border hover:border-white/50 ${
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
              {/* Icon-only line style (no label, no widths). */}
              <button
                title="線形"
                aria-label="線形"
                onClick={() => togglePanel('lineStyle')}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10 ${
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
              </button>
            </>
          )}
          {/* Icon-only lock / hide / settings / delete. */}
          <button
            title={selected.lock ? '已鎖定（點按解鎖）' : '鎖定（點按鎖定）'}
            aria-label={selected.lock ? '已鎖定' : '鎖定'}
            onClick={() => applyEdit({ lock: !selected.lock })}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
          >
            <BarLockIcon locked={selected.lock} />
          </button>
          <button
            title={selected.visible ? '隱藏' : '顯示'}
            aria-label={selected.visible ? '隱藏' : '顯示'}
            onClick={() => applyEdit({ visible: !selected.visible })}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
          >
            <BarEyeIcon hidden={!selected.visible} />
          </button>
          <button
            title="設定"
            aria-label="設定"
            onClick={() =>
              openDialogFor(
                selected.id,
                selected.name === TEXT_ANNOTATION_NAME ? 'text' : 'style',
              )
            }
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
          >
            <BarGearIcon />
          </button>
          <button
            title="刪除"
            aria-label="刪除"
            onClick={deleteSelected}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-[#ef5350] hover:bg-white/10"
          >
            <BarTrashIcon />
          </button>
          <button
            onClick={deselect}
            aria-label="取消選取"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
          >
            ✕
          </button>
          {openPanel === 'color' && (
            <div className="absolute bottom-full left-0 z-40 mb-1">
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
            <div className="absolute bottom-full left-0 z-40 mb-1 w-44 rounded-md border border-[#2a2e39] bg-[#1e222d] p-1 shadow-xl">
              {LINE_STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    applyEdit({ style: opt.id });
                    setOpenPanel(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-white/10 max-md:py-2.5"
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
          {openPanel === 'template' && (
            <div className="absolute bottom-full left-0 z-40 mb-1 w-60 rounded-md border border-[#2a2e39] bg-[#1e222d] p-2 shadow-xl">
              <div className="mb-1 px-1 text-xs font-semibold text-[#d1d4dc]">
                範本
              </div>
              {(templates[selected.name] ?? []).length === 0 ? (
                <div className="px-1 py-2 text-xs text-[#80858f]">
                  尚未儲存範本
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {(templates[selected.name] ?? []).map((tpl) => (
                    <div
                      key={tpl.name}
                      className="flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-white/10"
                    >
                      <button
                        onClick={() => applyTemplate(tpl)}
                        title={`套用範本 ${tpl.name}`}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left"
                      >
                        <span
                          className="block h-4 w-4 shrink-0 rounded-[2px]"
                          style={{
                            backgroundColor: hexToRgba(
                              tpl.style.color,
                              tpl.style.opacity,
                            ),
                          }}
                        />
                        <span className="truncate text-xs">{tpl.name}</span>
                      </button>
                      <button
                        onClick={() => deleteTemplate(tpl.name)}
                        title={`刪除範本 ${tpl.name}`}
                        aria-label={`刪除範本 ${tpl.name}`}
                        className="shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-[#ef5350] hover:bg-white/10"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1 flex items-center gap-1 border-t border-[#2a2e39] pt-2">
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTemplate();
                  }}
                  placeholder="範本名稱"
                  aria-label="範本名稱"
                  className="min-w-0 flex-1 rounded-sm border border-white/20 bg-transparent px-2 py-1.5 text-xs text-[#d1d4dc] placeholder:text-[#80858f] focus:border-[#2962ff] focus:outline-none"
                />
                <button
                  onClick={saveTemplate}
                  disabled={templateName.trim() === ''}
                  className="shrink-0 rounded-sm bg-[#2962ff] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  儲存
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {contextMenu !== null && (
        <>
          {/* Transparent backdrop: swallows pointer/wheel events so
              the dismissing press can never pan the chart or select
              an overlay behind the menu. Right-clicking it repositions
              the menu instead of opening the browser menu. */}
          <div
            data-testid="chart-context-menu-backdrop"
            onPointerDown={() => contextMenuController.close()}
            onContextMenu={(e) => {
              e.preventDefault();
              contextMenuController.open(e.clientX, e.clientY);
            }}
            className="absolute inset-0 z-30"
            aria-hidden="true"
          />
          <ChartContextMenu
            menuRef={contextMenuController.menuRef}
            x={contextMenu.x}
            y={contextMenu.y}
            bounds={contextMenu.bounds}
            sections={[
              [
                {
                  id: 'copy-price',
                  label:
                    contextMenu.price !== null
                      ? `複製價格 ${formatPrice(contextMenu.price)}`
                      : '複製價格',
                  disabled: contextMenu.price === null,
                },
                {
                  id: 'add-hline',
                  label: '加入水平線',
                  disabled: contextMenu.price === null,
                },
                {
                  id: 'add-vline',
                  label: '加入垂直線',
                  disabled: contextMenu.timestamp === null,
                },
                { id: 'reset-view', label: '重設圖表檢視' },
                {
                  id: 'chart-settings',
                  label: '圖表設定',
                },
              ],
              ...(contextMenu.selectedId !== null
                ? [
                    [
                      { id: 'edit', label: '編輯…' },
                      { id: 'copy', label: '複製' },
                      {
                        id: 'lock',
                        label: contextMenu.locked ? '解鎖' : '鎖定',
                      },
                      {
                        id: 'hide',
                        label: contextMenu.visible ? '隱藏' : '顯示',
                      },
                      { id: 'front', label: '移到前面' },
                      { id: 'back', label: '移到後面' },
                      { id: 'delete', label: '刪除', danger: true },
                    ] satisfies ContextMenuItem[],
                  ]
                : []),
            ]}
            onSelect={contextMenuController.select}
          />
        </>
      )}
      {dialogDraft !== null && selected !== null && (
        <OverlaySettingsDialog
          toolName={selected.name}
          initial={dialogDraft}
          bars={dialogBars}
          initialTab={dialogTab}
          onConfirm={applyDialog}
          onClose={closeDialog}
          onCopy={() => {
            copySelected();
            closeDialog();
          }}
          onBringToFront={() => {
            bringToFront();
            closeDialog();
          }}
          onSendToBack={() => {
            sendToBack();
            closeDialog();
          }}
          templates={templates[selected.name] ?? []}
          onApplyTemplate={(name) => {
            const tpl = (templates[selected.name] ?? []).find(
              (t) => t.name === name,
            );
            if (!tpl) return;
            applyTemplate(tpl);
            closeDialog();
          }}
        />
      )}
    </div>
  );
});

export default Chart;
export { DRAWING_TOOLS };
