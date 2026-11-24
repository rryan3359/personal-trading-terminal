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
 * Drawings are persisted per symbol in localStorage (v2 store, see
 * lib/store.ts) and restored after each init load, so they survive
 * symbol/timeframe switches. Overlays default to scope 'symbol'
 * (shown on every interval); scope 'interval' limits one to its own
 * interval. Crosshair, wheel zoom and drag pan are klinecharts
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
  hexToRgba,
  registerFibonacciRetracementOverlay,
  registerMeasureOverlay,
  registerRectangleOverlay,
} from '@/lib/chart-theme';
import {
  DRAWING_TOOLS,
  INDICATOR_OPTIONS,
  INTERVAL_MS,
  RANGES,
  type ChartType,
  type DrawingTool,
  type RangeId,
} from '@/lib/chart-config';
import {
  DEFAULT_OVERLAY_STYLE,
  getLastOverlayStyle,
  getMagnetMode,
  loadDrawingsStore,
  newOverlayId,
  saveDrawingsStore,
  saveLastOverlayStyle,
  type OverlayScope,
  type OverlayStylePatch,
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
const COLOR_PALETTE = [
  '#2962ff',
  '#26a69a',
  '#ef5350',
  '#ff9800',
  '#ab47bc',
  '#f5f5f5',
];
const LINE_WIDTHS = [1, 2, 3, 4];

/** Snapshot of one selected overlay for the floating edit bar. */
interface SelectedOverlayState {
  id: string;
  name: string;
  color: string;
  size: number;
  style: 'solid' | 'dashed';
  lock: boolean;
  visible: boolean;
  scope: OverlayScope;
  fillOpacity: number;
  isRect: boolean;
}

/** Horizontal tools show their price on the right Y axis. */
function isHorizontalTool(name: string): boolean {
  return name === 'horizontalStraightLine' || name === 'horizontalRayLine';
}

/** klinecharts overlay styles for one drawing. */
function stylesForOverlay(
  style: OverlayStylePatch,
  fillOpacity?: number,
): DeepPartial<OverlayStyle> {
  const line = {
    color: style.color,
    size: style.size,
    style: style.style,
    ...(style.style === 'dashed' ? { dashedValue: [6, 4] } : {}),
  };
  return {
    line,
    rect: {
      style: 'stroke_fill',
      color: hexToRgba(
        style.color,
        fillOpacity ?? DEFAULT_OVERLAY_STYLE.fillOpacity,
      ),
      borderColor: style.color,
      borderSize: style.size,
      borderStyle: style.style,
    },
  };
}

/** Whether a saved overlay belongs on the given interval's chart. */
function isInView(o: SavedOverlay, interval: string): boolean {
  return o.scope !== 'interval' || o.interval === interval;
}

/** Only fully-drawn overlays (every point has timestamp + value) are saved. */
function toSavedOverlay(o: Overlay): SavedOverlay | null {
  if (o.name === MEASURE_NAME) return null;
  if (o.points.length === 0) return null;
  const points: SavedOverlay['points'] = [];
  for (const p of o.points) {
    if (p.timestamp === undefined || p.value === undefined) return null;
    points.push({ timestamp: p.timestamp, value: p.value });
  }
  const line = o.styles?.line;
  const ext = (o.extendData ?? {}) as Record<string, unknown>;
  const scope = ext.scope === 'interval' ? 'interval' : 'symbol';
  const restEntries = Object.entries(ext).filter(
    ([k]) => k !== 'scope' && k !== 'interval',
  );
  return {
    id: o.id,
    // Old saves used the built-in name; the custom overlay replaces it.
    name: o.name === 'fibonacciLine' ? 'fibonacciRetracement' : o.name,
    points,
    styles:
      line?.color !== undefined
        ? {
            color: line.color,
            size: line.size ?? 1,
            style: line.style ?? 'solid',
          }
        : undefined,
    lock: o.lock || undefined,
    visible: o.visible === false ? false : undefined,
    extendData: restEntries.length > 0 ? Object.fromEntries(restEntries) : undefined,
    scope,
    interval: typeof ext.interval === 'string' ? ext.interval : undefined,
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
  /** Shown when the current symbol's init load delivered no bars. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Last loaded / live candle, shown in the top-left legend overlay. */
  const [lastKline, setLastKline] = useState<KLineData | null>(null);
  /** Whether the last init load delivered data (gates the live socket). */
  const initOkRef = useRef(true);
  const setSelectedState = (s: SelectedOverlayState | null) => {
    selectedRef.current = s;
    setSelected(s);
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
   * (other intervals' scope='interval' overlays) + the live overlays on
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

  // ---- undo / redo -----------------------------------------------------

  const undoStackRef = useRef<SavedOverlay[][]>([]);
  const redoStackRef = useRef<SavedOverlay[][]>([]);

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
    ext.scope = saved.scope ?? 'symbol';
    if (ext.scope === 'interval' && saved.interval) {
      ext.interval = saved.interval;
    }
    if (saved.name === 'rectangle') {
      ext.fillOpacity =
        typeof ext.fillOpacity === 'number'
          ? ext.fillOpacity
          : getLastOverlayStyle().fillOpacity;
    }
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
      ...(isHorizontalTool(saved.name)
        ? { needDefaultYAxisFigure: true }
        : {}),
      styles: stylesForOverlay(
        style,
        typeof ext.fillOpacity === 'number' ? ext.fillOpacity : undefined,
      ),
      lock: saved.lock ?? false,
      visible: saved.visible ?? true,
      extendData: ext,
      onDrawStart: (e) => {
        if (restoringRef.current) return;
        drawingIdRef.current = e.overlay.id;
      },
      onDrawEnd: () => {
        if (restoringRef.current) return;
        persistDrawings(symbolRef.current, intervalRef.current);
        drawingIdRef.current = null;
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
        pushHistory();
      },
      onPressedMoveEnd: () => {
        if (restoringRef.current || suppressSaveRef.current) return;
        persistDrawings(symbolRef.current, intervalRef.current);
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
      styles: { color: style.color, size: style.size, style: style.style },
      scope: 'symbol',
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
    setSelectedState({
      id: o.id,
      name: o.name,
      color: line?.color ?? DEFAULT_OVERLAY_STYLE.color,
      size: line?.size ?? 1,
      style: line?.style ?? 'solid',
      lock: o.lock,
      visible: o.visible,
      scope: ext.scope === 'interval' ? 'interval' : 'symbol',
      fillOpacity:
        typeof ext.fillOpacity === 'number'
          ? ext.fillOpacity
          : DEFAULT_OVERLAY_STYLE.fillOpacity,
      isRect: o.name === 'rectangle',
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
      setSelectedState(null);
      return;
    }
    if (pushHist) pushHistory();
    const next = { ...cur, ...patch };
    const ext: Record<string, unknown> = {
      ...((o.extendData ?? {}) as Record<string, unknown>),
      scope: next.scope,
    };
    if (next.scope === 'interval') ext.interval = intervalRef.current;
    else delete ext.interval;
    if (next.isRect) ext.fillOpacity = next.fillOpacity;
    chart.overrideOverlay({
      id: cur.id,
      styles: stylesForOverlay(
        { color: next.color, size: next.size, style: next.style },
        next.fillOpacity,
      ),
      lock: next.lock,
      visible: next.visible,
      extendData: ext,
    });
    if (
      patch.color !== undefined ||
      patch.size !== undefined ||
      patch.style !== undefined ||
      patch.fillOpacity !== undefined
    ) {
      saveLastOverlayStyle({
        color: next.color,
        size: next.size,
        style: next.style,
        fillOpacity: next.fillOpacity,
      });
    }
    persistDrawings(symbolRef.current, intervalRef.current);
    refreshSelected(cur.id);
  };

  const deleteSelected = () => {
    const cur = selectedRef.current;
    if (!cur) return;
    const chart = chartRef.current;
    if (!chart) return;
    pushHistory();
    chart.removeOverlay({ id: cur.id });
    setSelectedState(null);
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
    const shiftMs = 3 * (INTERVAL_MS[intervalRef.current] ?? 0);
    const copy: SavedOverlay = {
      ...saved,
      id: newOverlayId(),
      lock: false,
      points: saved.points.map((p) => ({
        timestamp: p.timestamp + shiftMs,
        value: p.value,
      })),
    };
    const id = chart.createOverlay(overlayCreate(copy));
    if (typeof id === 'string') refreshSelected(id);
    persistDrawings(symbolRef.current, intervalRef.current);
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
      setSelectedState(null);
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
    registerMeasureOverlay();

    const chart = init(container, { styles: DARK_STYLES });
    if (!chart) return;
    chartRef.current = chart;

    // The top-left legend (Chart.tsx) already shows the last candle's
    // OHLC, so the built-in tooltip would print the same line on top of
    // it. Show the tooltip only while the crosshair is active (hover /
    // tap / drag), on every screen size — it then reads the hovered
    // candle instead of duplicating the legend.
    chart.setStyles({ candle: { tooltip: { showRule: 'follow_cross' } } });

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
    // and legend.
    setLoadError(null);
    setLastKline(null);
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
      setSelectedState(null);
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
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (drawingIdRef.current) {
          // Cancel the overlay being drawn, then disarm the tool.
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
          setSelectedState(null);
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

  // Legend: change of the last candle vs its open.
  const legendChangePct =
    lastKline !== null && lastKline.open !== 0
      ? ((lastKline.close - lastKline.open) / lastKline.open) * 100
      : 0;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        className="h-full w-full bg-[#131722]"
        data-testid="chart-container"
      />
      {lastKline !== null && loadError === null && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 leading-relaxed">
          <div className="text-xs font-semibold text-white">
            {symbol} · {INTERVAL_LABELS[interval]} · Binance
          </div>
          <div className="text-[11px] text-[#b2b5be]">
            開 {formatPrice(lastKline.open)} 高 {formatPrice(lastKline.high)}{' '}
            低 {formatPrice(lastKline.low)} 收{' '}
            <span
              className={
                legendChangePct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
              }
            >
              {formatPrice(lastKline.close)}{' '}
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
        <div className="absolute left-1/2 top-2 z-20 flex max-w-full -translate-x-1/2 flex-wrap items-center gap-1 rounded-md border border-[#2a2e39] bg-[#1e222d]/95 px-2 py-1.5 text-xs text-[#d1d4dc] shadow-lg">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              title={c}
              aria-label={`顏色 ${c}`}
              onClick={() => applyEdit({ color: c })}
              className={`h-5 w-5 rounded-sm border ${selected.color === c ? 'border-white ring-1 ring-white' : 'border-white/20'}`}
              style={{ backgroundColor: c }}
            />
          ))}
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
            onClick={() =>
              applyEdit({ style: selected.style === 'solid' ? 'dashed' : 'solid' })
            }
            className="rounded-sm px-1.5 py-0.5 hover:bg-white/10"
          >
            {selected.style === 'solid' ? '實線' : '虛線'}
          </button>
          <span className="mx-1 h-4 w-px bg-[#2a2e39]" />
          {selected.isRect && (
            <label className="flex items-center gap-1">
              填色
              <input
                type="range"
                min={0.05}
                max={0.4}
                step={0.05}
                value={selected.fillOpacity}
                onPointerDown={() => {
                  if (!sliderHistoryPushedRef.current) {
                    sliderHistoryPushedRef.current = true;
                    pushHistory();
                  }
                }}
                onFocus={() => {
                  if (!sliderHistoryPushedRef.current) {
                    sliderHistoryPushedRef.current = true;
                    pushHistory();
                  }
                }}
                onChange={(e) =>
                  applyEdit({ fillOpacity: Number(e.target.value) }, false)
                }
                onPointerUp={() => {
                  sliderHistoryPushedRef.current = false;
                }}
                onBlur={() => {
                  sliderHistoryPushedRef.current = false;
                }}
                className="w-16 accent-[#2962ff]"
              />
              <span className="w-8 text-right">
                {Math.round(selected.fillOpacity * 100)}%
              </span>
            </label>
          )}
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={selected.scope === 'interval'}
              onChange={(e) =>
                applyEdit({ scope: e.target.checked ? 'interval' : 'symbol' })
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
            onClick={() => applyEdit({ visible: !selected.visible })}
            className="rounded-sm px-1.5 py-0.5 hover:bg-white/10"
          >
            {selected.visible ? '👁 隱藏' : '隱藏中'}
          </button>
          <button
            onClick={copySelected}
            className="rounded-sm px-1.5 py-0.5 hover:bg-white/10"
          >
            複製
          </button>
          <button
            onClick={deleteSelected}
            className="rounded-sm px-1.5 py-0.5 text-[#ef5350] hover:bg-white/10"
          >
            刪除
          </button>
          <button
            onClick={() => setSelectedState(null)}
            className="rounded-sm px-1 hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
});

export default Chart;
export { DRAWING_TOOLS };
