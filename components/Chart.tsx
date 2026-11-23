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
 * Drawings are persisted per `${symbol}:${interval}` in localStorage and
 * restored after each init load, so they survive symbol/timeframe switches.
 * Crosshair, wheel zoom and drag pan are klinecharts defaults (explicitly
 * enabled here); the dark theme is applied via setStyles at init.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  dispose,
  init,
  type Chart,
  type DataLoader,
  type KLineData,
  type OverlayCreate,
  type Period,
} from 'klinecharts';
import type { Interval, Kline } from '@/lib/types';
import { BinanceKlineSocket, type BinanceSocketStatus } from '@/lib/ws/binance';
import {
  DARK_STYLES,
  registerRectangleOverlay,
} from '@/lib/chart-theme';
import {
  DRAWING_TOOLS,
  INDICATOR_OPTIONS,
  type DrawingTool,
} from '@/lib/chart-config';
import {
  STORAGE_KEYS,
  drawingsKey,
  loadJSON,
  saveJSON,
  type DrawingsStore,
  type SavedOverlay,
} from '@/lib/store';

export interface ChartHandle {
  /** Remove all drawings for the current symbol/interval (and their saved copy). */
  clearDrawings: () => void;
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
  onConnectionStatus?: (status: BinanceSocketStatus) => void;
}

const HISTORY_LIMIT = 500;

function periodFor(interval: Interval): Period {
  switch (interval) {
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
  }
}

function isMainPaneIndicator(name: string): boolean {
  return INDICATOR_OPTIONS.find((o) => o.id === name)?.mainPane ?? false;
}

/** Only fully-drawn overlays (every point has timestamp + value) are saved. */
function toSavedOverlay(o: {
  name: string;
  points: Array<Partial<{ timestamp: number; value: number }>>;
}): SavedOverlay | null {
  if (o.points.length === 0) return null;
  const points: SavedOverlay['points'] = [];
  for (const p of o.points) {
    if (p.timestamp === undefined || p.value === undefined) return null;
    points.push({ timestamp: p.timestamp, value: p.value });
  }
  return { name: o.name, points };
}

const Chart = forwardRef<ChartHandle, ChartProps>(function Chart(
  { symbol, interval, activeTool, onToolDone, indicators, onConnectionStatus },
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
  symbolRef.current = symbol;
  intervalRef.current = interval;
  onToolDoneRef.current = onToolDone;
  onConnectionStatusRef.current = onConnectionStatus;

  const suppressSaveRef = useRef(false);

  // ---- drawing persistence -------------------------------------------

  const persistDrawings = (key: string) => {
    if (suppressSaveRef.current) return;
    const chart = chartRef.current;
    if (!chart) return;
    const saved: SavedOverlay[] = [];
    const seen = new Set<string>();
    for (const overlay of chart.getOverlays()) {
      const s = toSavedOverlay(overlay);
      if (!s) continue;
      const fingerprint = JSON.stringify(s);
      if (seen.has(fingerprint)) continue; // never store the same drawing twice
      seen.add(fingerprint);
      saved.push(s);
    }
    const store = loadJSON<DrawingsStore>(STORAGE_KEYS.drawings, {});
    store[key] = saved;
    saveJSON(STORAGE_KEYS.drawings, store);
  };

  const restoreDrawings = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const key = drawingsKey(symbolRef.current, intervalRef.current);
    const saved = loadJSON<DrawingsStore>(STORAGE_KEYS.drawings, {})[key] ?? [];
    // Idempotent: getBars("init") can fire more than once per symbol/
    // timeframe change (setSymbol + setPeriod each trigger a load), so
    // always wipe first — otherwise every load duplicates the drawings.
    suppressSaveRef.current = true;
    try {
      chart.removeOverlay();
      for (const o of saved) {
        chart.createOverlay(overlayCreate(o.name as DrawingTool, o.points));
      }
    } finally {
      suppressSaveRef.current = false;
    }
  };

  const overlayCreate = (
    name: DrawingTool,
    points?: SavedOverlay['points'],
  ): OverlayCreate => ({
    name,
    ...(points
      ? { points: points.map((p) => ({ timestamp: p.timestamp, value: p.value })) }
      : {}),
    onDrawEnd: () => {
      persistDrawings(drawingsKey(symbolRef.current, intervalRef.current));
      onToolDoneRef.current();
    },
    onRemoved: () => {
      persistDrawings(drawingsKey(symbolRef.current, intervalRef.current));
    },
    onPressedMoveEnd: () => {
      persistDrawings(drawingsKey(symbolRef.current, intervalRef.current));
    },
  });

  useImperativeHandle(ref, () => ({
    clearDrawings() {
      const chart = chartRef.current;
      if (!chart) return;
      suppressSaveRef.current = true;
      chart.removeOverlay();
      suppressSaveRef.current = false;
      const store = loadJSON<DrawingsStore>(STORAGE_KEYS.drawings, {});
      store[drawingsKey(symbolRef.current, intervalRef.current)] = [];
      saveJSON(STORAGE_KEYS.drawings, store);
    },
  }));

  // ---- chart init (once) ----------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    registerRectangleOverlay();

    const chart = init(container, { styles: DARK_STYLES });
    if (!chart) return;
    chartRef.current = chart;

    // Narrow screens: the always-on OHLC line is wider than the chart
    // and gets clipped at the right edge, so only show it while the
    // crosshair is active (tap / drag). Desktop keeps it always on.
    if (window.innerWidth < 768) {
      chart.setStyles({ candle: { tooltip: { showRule: 'follow_cross' } } });
    }

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
            callback(klines, { backward: false, forward: hasMore });
            restoreDrawings();
          } else if (type === 'forward') {
            callback(klines, { forward: hasMore });
          } else {
            // 'backward': more newer bars only exist if a full page came back.
            callback(klines, { backward: hasMore });
          }
        } catch {
          callback([], { backward: false, forward: false });
        }
      },
      subscribeBar: ({ callback }) => {
        liveCallbackRef.current = callback;
        socketRef.current?.disconnect();
        const socket = new BinanceKlineSocket();
        socketRef.current = socket;
        socket.connect(
          symbolRef.current,
          intervalRef.current,
          (kline) => {
            liveCallbackRef.current?.(kline as KLineData);
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
    const prev = prevSymbolIntervalRef.current;
    if (prev === null) {
      prevSymbolIntervalRef.current = { symbol, interval };
      return;
    }
    const key = drawingsKey(symbol, interval);
    const prevKey = drawingsKey(prev.symbol, prev.interval);
    if (prevKey !== key) {
      // Save the old chart's drawings before wiping them.
      persistDrawings(prevKey);
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
    if (!chart || !activeTool) return;
    chart.createOverlay(overlayCreate(activeTool));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

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

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#131722]"
      data-testid="chart-container"
    />
  );
});

export default Chart;
export { DRAWING_TOOLS };
