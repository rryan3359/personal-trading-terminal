/**
 * lib/chart-engine.ts — ChartEngine (MASTER TASK Phase 3 Step 8).
 *
 * Owns the klinecharts instance and everything that drives it: init /
 * dispose, overlay registration, styles, symbol / period, the
 * DataLoader (getBars / subscribeBar / unsubscribeBar), the Binance
 * live socket, crosshair subscription forwarding, ResizeObserver,
 * symbol / interval switching, chart type, indicators (including the
 * VOL overlay axis) and range fitting. Origin: inline in
 * components/Chart.tsx, moved verbatim except for the mechanical
 * identifier swaps listed below (Chart-owned state is reached only
 * through opts).
 *
 * Chart stays the composition root: it creates one engine in a ref
 * (init effect), forwards prop changes (setSymbolInterval /
 * setChartType / setIndicators), and owns everything the engine
 * reports back through opts callbacks — the load-error banner, the
 * last candle, drawing restore on init load, the old view's persist
 * + reset on symbol / interval change, and the legend indicator
 * tick. The engine never touches React state, controllers or the
 * store directly.
 *
 * Identifier swaps vs the inline original (mechanical, behaviour
 * unchanged):
 * - chartRef / socketRef / liveCallbackRef / initOkRef /
 *   loadEpochRef / lastTickReportRef -> engine-local variables.
 * - symbolRef / intervalRef -> opts.getSymbol() / opts.getInterval()
 *   (read live, so DataLoader closures always see the current view).
 * - chartType / indicators props -> opts.getChartType() /
 *   opts.getIndicators() (read by the no-arg setters).
 * - appearanceRef -> opts.initialAppearance (read once, at init).
 * - setLoadError / setLastKline -> opts.onLoadError / opts.onLastKline.
 * - drawingController.restoreDrawings() -> opts.onInitLoad().
 * - persistDrawings + history clear + deselect + clearDrawingId +
 *   mode exit + tool disarm -> opts.onSymbolIntervalChange(prev, next).
 * - setIndicatorTick bump -> opts.onIndicatorTick().
 * - suppressSaveRef -> opts.suppressSaveRef (the same ref object).
 * - onLastTickRef / onConnectionStatusRef -> opts.onLastTick /
 *   opts.onConnectionStatus.
 *
 * Deliberately NOT moved (stays in Chart, with its owner):
 * - useImperativeHandle's clearDrawings / undo / redo /
 *   openObjectList: drawing / history concerns owned by
 *   DrawingController / DrawingHistoryManager; only setRange /
 *   resetView delegate here (applyRange / resetView).
 * - The appearance effect: appearance is owned by the page and
 *   applied through engine.getChart().setStyles(...).
 * - onHistoryChange: no engine path reports a history change (the
 *   HistoryManager notifies Chart directly), so it is not an opt.
 */

import {
  dispose,
  init,
  type AxisCreateRangeCallback,
  type AxisRange,
  type Chart,
  type DataLoader,
  type KLineData,
  type Period,
  type YAxis,
} from 'klinecharts';
import type { Interval, Kline } from '@/lib/types';
import { BinanceKlineSocket, type BinanceSocketStatus } from '@/lib/ws/binance';
import {
  DARK_STYLES,
  registerFibonacciRetracementOverlay,
  registerFibonacciToolsOverlays,
  registerGannOverlays,
  registerGeometryOverlays,
  registerMeasureOverlay,
  registerPatternOverlays,
  registerPitchforkOverlays,
  registerPositionOverlays,
  registerRectangleOverlay,
  registerSimpleTagOverlay,
  registerTextAnnotationOverlay,
} from '@/lib/chart-theme';
import {
  INDICATOR_OPTIONS,
  INTERVAL_MS,
  RANGES,
  type ChartType,
  type RangeId,
} from '@/lib/chart-config';
import {
  buildAppearanceStyles,
  type AppearanceSettings,
} from '@/lib/chart-appearance';
import type { CrosshairController } from '@/lib/chart-crosshair';

export interface ChartEngineOptions {
  getSymbol: () => string;
  getInterval: () => Interval;
  getChartType: () => ChartType;
  getIndicators: () => string[];
  /** Appearance for the one-time init styles; later changes go through Chart's appearance effect. */
  initialAppearance: AppearanceSettings;
  crosshair: CrosshairController;
  onLastTick?: (atMs: number) => void;
  onConnectionStatus?: (status: BinanceSocketStatus) => void;
  /** Report an init-load failure (null clears it). Chart owns the banner state. */
  onLoadError: (message: string | null) => void;
  /** Last loaded / live candle for the legend. */
  onLastKline: (kline: KLineData | null) => void;
  /** Called after a successful init load: restore the view's drawings. */
  onInitLoad: () => void;
  /**
   * Called when symbol/interval actually changes, before the new load:
   * persist the old view, clear per-view history, deselect, cancel any
   * in-progress draw, leave Drawing mode and disarm the tool.
   */
  onSymbolIntervalChange: (
    prev: { symbol: string; interval: Interval },
    next: { symbol: string; interval: Interval },
  ) => void;
  /** Bumps after setIndicators (re)creates indicators (legend memo). */
  onIndicatorTick: () => void;
  /**
   * Suppress-save guard owned by Chart (persist guards); the engine
   * sets it around removeOverlay in the symbol/interval switch.
   */
  suppressSaveRef: { current: boolean };
}

export interface ChartEngine {
  getChart: () => Chart | null;
  /** Apply a symbol/interval switch (first call only records the view). */
  setSymbolInterval: () => void;
  setChartType: () => void;
  setIndicators: () => void;
  applyRange: (range: RangeId) => void;
  resetView: () => void;
  dispose: () => void;
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
 * VOL overlay axis. A bare `{ name: 'VOL', paneId: 'candle_pane' }`
 * does NOT work: the indicator shares the pane's default y-axis,
 * whose range is computed from the candles AND the indicator's
 * values — VOL's minValue 0 drags the range to [0, maxPrice] and
 * crushes the candles into a thin band at the top (verified by
 * screenshot 2026-11-26). So VOL gets its own y-axis in the candle
 * pane (no widget: no extra ticks on the right), with a stretched
 * range: the default range is [0, maxVisibleVolume] and scaling `to`
 * by VOL_AXIS_SCALE leaves bars + volume MAs in the bottom
 * 1/VOL_AXIS_SCALE of the pane, TradingView-style. gap is 0 on this
 * axis so the scale is exact (the default gap adds top 20% /
 * bottom 10% on top of the range). The axis is created/removed
 * together with the VOL indicator in the indicators effect below.
 */
const VOL_AXIS_ID = 'vol-axis';
const VOL_AXIS_SCALE = 5;
const volAxisCreateRange: AxisCreateRangeCallback = ({
  defaultRange,
}) => {
  const from = defaultRange.from;
  const to = defaultRange.to * VOL_AXIS_SCALE;
  return {
    from,
    to,
    range: to - from,
    realFrom: from,
    realTo: to,
    realRange: to - from,
    displayFrom: from,
    displayTo: to,
    displayRange: to - from,
  };
};

/**
 * Anchored price-axis drag zoom (Ryan 2026-11-27, item 7: "拉右邊價格
 * 軸的地方縮放 K 線會跑掉、怪怪的"). Two causes, both verified by CDP
 * probe (probe-axis-clean.mjs, 390px):
 *
 * 1. Hit area: the mobile floating drawing bar sits at the right edge
 *    (rect x∈[342,382], y∈[295,553]) over the price-axis widget
 *    (x∈[326,390], 64px wide), so a finger on the axis usually grabs
 *    the bar instead — the bar drags, the axis never sees the gesture.
 *    Fixed separately by moving the bar's default position to the
 *    left edge (TV-style, DrawingBar.tsx).
 *
 * 2. Zoom math: klinecharts' built-in axis drag
 *    (_processYAxisScalingEvent, index.esm.js) computes
 *    `scaleFactor = event.pageY / startPageY` — an absolute-coordinate
 *    ratio, not a drag distance — and `_zoomYAxis` scales the range
 *    symmetrically around the visible range CENTRE. Measured: the
 *    same 100px drag shrank the range to 68.75% at y=320→220 but only
 *    83.33% at y=600→500, and the price under the finger moved
 *    (60583.29 → 60555.40). The candle under the finger jumps away:
 *    that is the "runs away".
 *
 * Fix (public API only, no klinecharts internals): the engine turns
 * off the built-in axis scaling for the price axis
 * (`scrollZoomEnabled: false`) and installs its own `createRange`
 * callback, which returns a held manual range when one exists and
 * the auto-fit defaultRange otherwise. Axis drags (mouse + touch)
 * and wheel events starting on the axis widget are intercepted on
 * `window` in the capture phase — before klinecharts' own container
 * listeners — and drive an ANCHORED zoom: the price under the
 * finger stays at the same pixel, and the scale factor depends only
 * on the drag distance (`exp(dy / 300)`), never on the absolute
 * screen position. Double-clicking the axis clears the manual range
 * (auto-fit resumes, TV behaviour); so do symbol/interval switches
 * and 重設檢視. Main-pane pinch (time zoom) is untouched — only
 * gestures starting on the axis are intercepted, and only when the
 * event target is a canvas inside the chart container (overlay
 * buttons / sheets are siblings, never intercepted).
 *
 * The price axis id is generated per chart creation
 * (`yAxis_<ts>_1`, verified by probe-axis-id.mjs), so it is
 * discovered at runtime via getYAxes (the axis that is not the VOL
 * axis), never hardcoded. `overrideYAxis` without a `name` change
 * does not recreate the axis widget (createOrOverrideYAxis only
 * recreates when the name changes), it just merges + lays out —
 * safe to call once per animation frame during a drag.
 */
const AXIS_DRAG_SCALE_PX = 300; // e-fold drag distance: 300px = ~2.72x
const AXIS_WHEEL_SCALE_PX = 600; // one 120-deltaY wheel notch = ~1.22x
const AXIS_SCALE_MIN = 0.05;
const AXIS_SCALE_MAX = 20;

/**
 * Range the context menu's 重設圖表檢視 restores. No default-range
 * constant exists in the codebase (page starts with activeRange null
 * and never calls setRange on mount); 1M is the middle preset —
 * change this one line to retarget the reset.
 */
const DEFAULT_RESET_RANGE: RangeId = '1M';

/** Engine with no chart (init failed): every method is a no-op, exactly
 *  as the old init effect's early return left Chart (chartRef null, no
 *  cleanup registered, every later effect guarding on a null chart). */
const NULL_ENGINE: ChartEngine = {
  getChart: () => null,
  setSymbolInterval: () => {},
  setChartType: () => {},
  setIndicators: () => {},
  applyRange: () => {},
  resetView: () => {},
  dispose: () => {},
};

export function createChartEngine(
  container: HTMLDivElement,
  opts: ChartEngineOptions,
): ChartEngine {
  /** Live socket for the current view (null while unsubscribed). */
  let socket: BinanceKlineSocket | null = null;
  let liveCallback: ((data: KLineData) => void) | null = null;
  /** Whether the last init load delivered data (gates the live socket). */
  let initOk = true;
  /**
   * Data-load generation. Incremented once per symbol/interval switch
   * (and once at first load); each getBars captures the epoch at fetch
   * start and drops its response if a newer generation has begun, so a
   * late response from the old symbol/interval can never overwrite the
   * new one. F3 fix.
   */
  let loadEpoch = 0;
  /** Last time onLastTick was reported (throttle: at most once a second). */
  let lastTickReport = 0;
  /** Last applied symbol/interval (first setSymbolInterval call only records it). */
  let prevSymbolInterval: { symbol: string; interval: Interval } | null = null;
  let disposed = false;
  let resizeObserver: ResizeObserver | null = null;
  /**
   * Anchored price-axis zoom (item 7): manual price range held by the
   * price axis' createRange callback (null = auto-fit). Written by
   * axis drags / wheel, cleared by symbol/interval switches,
   * double-click on the axis and resetView.
   */
  let manualPriceRange: AxisRange | null = null;
  /** In-flight anchored axis drag, or null. */
  let axisDrag: {
    startY: number;
    anchorPrice: number;
    baseRange: AxisRange;
    paneHeight: number;
    containerTop: number;
    moved: boolean;
  } | null = null;
  /** Pending rAF for the per-frame price-axis layout during a drag. */
  let axisDragApplyRaf = 0;

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
  registerPositionOverlays();

  // Appearance styles layer on top of DARK_STYLES: the overlay
  // styles (point/line/rect) still come from DARK_STYLES, the rest
  // from the user's appearance (defaults = the DARK_STYLES look).
  let chart: Chart | null = init(container, {
    styles: {
      ...DARK_STYLES,
      ...buildAppearanceStyles(opts.initialAppearance),
    },
  });
  if (!chart) return NULL_ENGINE;

  // The top-left legend is the only OHLC readout: the built-in
  // tooltip draws its own line at the same spot and the two overlap
  // (screenshot 2026-11-24). Hide it entirely; the legend follows
  // the crosshair instead (subscribed below).
  chart.setStyles({ candle: { tooltip: { showRule: 'none' } } });
  // Same for indicator tooltips: the HTML legend already shows
  // every indicator's values (read from the same computed results,
  // following the crosshair), while the built-in tooltips duplicate
  // them at each pane's top-left and overlap the legend — e.g. the
  // MA60 value ghosting over the OHLC row (Ryan's screenshots
  // 2026-11-26). This also covers the VOL tooltip, which would
  // otherwise land in the candle pane now that VOL is overlaid
  // there. Sub-pane (RSI/MACD) values stay visible via the legend.
  chart.setStyles({ indicator: { tooltip: { showRule: 'none' } } });

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
    opts.crosshair.handleCrosshairChange,
  );

  // Debug handle for browser-console inspection
  // (e.g. __pttChart.getOverlays(), __pttChart.getVisibleRange()).
  (window as unknown as { __pttChart?: Chart }).__pttChart = chart;

  chart.setZoomEnabled(true);
  chart.setScrollEnabled(true);

  // ---- Anchored price-axis drag zoom (item 7) ----
  /** The price axis: every y-axis in the candle pane except VOL. */
  const getPriceAxis = (): YAxis | null => {
    if (!chart) return null;
    return (
      chart
        .getYAxes({ paneId: CANDLE_PANE_ID })
        .find((a) => a.id !== VOL_AXIS_ID) ?? null
    );
  };
  /** Price-axis range override: manual range when one is held, else auto-fit.
   *  NOTE: createRangeImp expands whatever this returns by the axis
   *  gap (default top 20% / bottom 10% of the range, index.esm.js),
   *  so a held manual range is deflated by (1 + top + bottom) here —
   *  otherwise the gap would re-expand it on every layout and the
   *  anchor price would drift (verified by probe-axis-install.mjs:
   *  a 1145.9 range came back as 1489.69 = ×1.3). Auto-fit
   *  (manualPriceRange null) returns defaultRange untouched, so the
   *  default view keeps its gap exactly as before. */
  const priceAxisCreateRange: AxisCreateRangeCallback = ({
    defaultRange,
  }) => {
    if (manualPriceRange === null) return defaultRange;
    const axis = getPriceAxis();
    // The public YAxis type does not declare `gap`; the runtime
    // axis carries it (YAxisImp.override merges it). Fall back to
    // the measured defaults (top 0.2 / bottom 0.1) if unreadable.
    const gap = (
      axis as unknown as {
        gap?: { top?: number; bottom?: number };
      } | null
    )?.gap;
    const H = chart?.getSize(CANDLE_PANE_ID)?.height ?? 0;
    let topRate = gap?.top ?? 0.2;
    let bottomRate = gap?.bottom ?? 0.1;
    if (topRate >= 1 && H > 0) topRate /= H;
    if (bottomRate >= 1 && H > 0) bottomRate /= H;
    const R = manualPriceRange.realTo - manualPriceRange.realFrom;
    const Rret = R / (1 + topRate + bottomRate);
    const realToRet = manualPriceRange.realTo - topRate * Rret;
    const realFromRet = realToRet - Rret;
    const from = axis
      ? axis.realValueToValue(realFromRet, { range: manualPriceRange })
      : realFromRet;
    const to = axis
      ? axis.realValueToValue(realToRet, { range: manualPriceRange })
      : realToRet;
    const displayFrom = axis
      ? axis.realValueToDisplayValue(realFromRet, {
          range: manualPriceRange,
        })
      : realFromRet;
    const displayTo = axis
      ? axis.realValueToDisplayValue(realToRet, { range: manualPriceRange })
      : realToRet;
    return {
      from,
      to,
      range: to - from,
      realFrom: realFromRet,
      realTo: realToRet,
      realRange: Rret,
      displayFrom,
      displayTo,
      displayRange: displayTo - displayFrom,
    };
  };
  /** Push the held (or cleared) manual range through a layout. */
  const applyPriceAxisRange = () => {
    if (!chart) return;
    const axis = getPriceAxis();
    if (!axis || !axis.id) return;
    chart.overrideYAxis({
      id: axis.id,
      paneId: CANDLE_PANE_ID,
      createRange: priceAxisCreateRange,
    });
  };
  /** rAF-throttled apply: a 60-120 Hz pointer must not re-layout per event. */
  const schedulePriceAxisApply = () => {
    if (axisDragApplyRaf !== 0) return;
    axisDragApplyRaf = requestAnimationFrame(() => {
      axisDragApplyRaf = 0;
      applyPriceAxisRange();
    });
  };
  /**
   * Anchored range: same total range as klinecharts' zoom (base.range
   * × scale) but centred so `anchor` stays at pixel `anchorY`
   * (pane-relative) instead of around the range centre. Built the
   * same way `_zoomYAxis` builds its range (value → real → display
   * conversions with the base range as params).
   */
  const anchoredRangeFrom = (
    axis: YAxis,
    base: AxisRange,
    anchor: number,
    anchorY: number,
    paneHeight: number,
    scale: number,
  ): AxisRange | null => {
    const s = Math.min(
      AXIS_SCALE_MAX,
      Math.max(AXIS_SCALE_MIN, scale),
    );
    const R = base.range * s;
    if (!Number.isFinite(R) || R <= 0 || paneHeight <= 0) return null;
    const toPrime = anchor + (anchorY / paneHeight) * R;
    const fromPrime = toPrime - R;
    const realFrom = axis.valueToRealValue(fromPrime, { range: base });
    const realTo = axis.valueToRealValue(toPrime, { range: base });
    const displayFrom = axis.realValueToDisplayValue(realFrom, {
      range: base,
    });
    const displayTo = axis.realValueToDisplayValue(realTo, {
      range: base,
    });
    return {
      from: fromPrime,
      to: toPrime,
      range: R,
      realFrom,
      realTo,
      realRange: realTo - realFrom,
      displayFrom,
      displayTo,
      displayRange: displayTo - displayFrom,
    };
  };
  /** Left edge (CSS px, viewport) of the price-axis widget. */
  const axisStartX = (): number => {
    const rect = container.getBoundingClientRect();
    const w = getPriceAxis()?.getAutoSize() || 64;
    return rect.left + rect.width - w;
  };
  /** Only gestures whose target is a canvas inside the chart container
   *  are axis gestures: overlay buttons / sheets live outside it. */
  const isAxisEventTarget = (e: Event): boolean => {
    const t = e.target;
    return t instanceof HTMLCanvasElement && container.contains(t);
  };
  const pointerClient = (
    e: MouseEvent | TouchEvent,
  ): { x: number; y: number } | null => {
    if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
    const t = e.touches[0] ?? e.changedTouches[0];
    return t ? { x: t.clientX, y: t.clientY } : null;
  };
  /** Price at a pane-relative y (any x inside the main pane works). */
  const priceAtY = (y: number): number => {
    if (!chart) return NaN;
    const conv = chart.convertFromPixel([{ x: 100, y }]);
    const pt = Array.isArray(conv) ? conv[0] : conv;
    return typeof pt?.value === 'number' ? pt.value : NaN;
  };
  const onAxisPointerDown = (e: MouseEvent | TouchEvent) => {
    if (disposed || !chart) return;
    const p = pointerClient(e);
    if (!p || !isAxisEventTarget(e) || p.x < axisStartX()) return;
    // Axis region: take over from klinecharts before its container
    // listeners run (window capture beats them). Its drag would scale
    // around the range centre with scaleFactor = pageY/startPageY.
    e.stopPropagation();
    e.preventDefault();
    const axis = getPriceAxis();
    if (!axis) return;
    const rect = container.getBoundingClientRect();
    const y = p.y - rect.top;
    const H = chart.getSize(CANDLE_PANE_ID)?.height ?? rect.height;
    if (y < 0 || y > H) return; // below the candle pane (x-axis strip)
    const anchorPrice = priceAtY(y);
    if (!Number.isFinite(anchorPrice)) return;
    axisDrag = {
      startY: y,
      anchorPrice,
      baseRange: { ...axis.getRange() },
      paneHeight: H,
      containerTop: rect.top,
      moved: false,
    };
    if (e instanceof MouseEvent) {
      window.addEventListener('mousemove', onAxisPointerMove);
      window.addEventListener('mouseup', onAxisPointerUp, { once: true });
    } else {
      window.addEventListener('touchmove', onAxisPointerMove, {
        passive: false,
      });
      window.addEventListener('touchend', onAxisPointerUp, { once: true });
      window.addEventListener('touchcancel', onAxisPointerUp, {
        once: true,
      });
    }
  };
  const onAxisPointerMove = (e: MouseEvent | TouchEvent) => {
    if (!axisDrag || disposed || !chart) return;
    const p = pointerClient(e);
    if (!p) return;
    e.preventDefault();
    const axis = getPriceAxis();
    if (!axis) return;
    axisDrag.moved = true;
    const y = p.y - axisDrag.containerTop;
    const next = anchoredRangeFrom(
      axis,
      axisDrag.baseRange,
      axisDrag.anchorPrice,
      axisDrag.startY,
      axisDrag.paneHeight,
      Math.exp((y - axisDrag.startY) / AXIS_DRAG_SCALE_PX),
    );
    if (!next) return;
    manualPriceRange = next;
    schedulePriceAxisApply();
  };
  const onAxisPointerUp = () => {
    if (axisDragApplyRaf !== 0) {
      cancelAnimationFrame(axisDragApplyRaf);
      axisDragApplyRaf = 0;
    }
    window.removeEventListener('mousemove', onAxisPointerMove);
    window.removeEventListener('touchmove', onAxisPointerMove);
    // The mouseup/touchend/touchcancel listeners were { once: true }.
    if (axisDrag?.moved) applyPriceAxisRange();
    axisDrag = null;
  };
  const onAxisWheel = (e: WheelEvent) => {
    if (disposed || !chart) return;
    if (!isAxisEventTarget(e) || e.clientX < axisStartX()) return;
    e.stopPropagation();
    e.preventDefault();
    const axis = getPriceAxis();
    if (!axis) return;
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const H = chart.getSize(CANDLE_PANE_ID)?.height ?? rect.height;
    if (y < 0 || y > H) return;
    const anchorPrice = priceAtY(y);
    if (!Number.isFinite(anchorPrice)) return;
    const next = anchoredRangeFrom(
      axis,
      { ...axis.getRange() },
      anchorPrice,
      y,
      H,
      Math.exp(e.deltaY / AXIS_WHEEL_SCALE_PX),
    );
    if (!next) return;
    manualPriceRange = next;
    applyPriceAxisRange();
  };
  const onAxisDblClick = (e: MouseEvent) => {
    if (disposed || !chart) return;
    if (manualPriceRange === null) return;
    if (!isAxisEventTarget(e) || e.clientX < axisStartX()) return;
    // Double-click the axis resets the price scale to auto-fit.
    // klinecharts' own reset only fires when an axis is manual
    // (autoCalc false); ours rides on createRange with autoCalc
    // still true, so the reset is taken here.
    e.stopPropagation();
    e.preventDefault();
    manualPriceRange = null;
    applyPriceAxisRange();
  };
  // Install: turn off klinecharts' built-in axis scaling (drag /
  // wheel / pinch on the price axis) and hand the range to the
  // createRange callback above; window capture listeners take the
  // gestures over. Listeners are removed in disposeEngine.
  {
    const axis = getPriceAxis();
    if (axis?.id) {
      chart.overrideYAxis({
        id: axis.id,
        paneId: CANDLE_PANE_ID,
        scrollZoomEnabled: false,
        createRange: priceAxisCreateRange,
      });
    }
  }
  window.addEventListener('mousedown', onAxisPointerDown, true);
  window.addEventListener('touchstart', onAxisPointerDown, {
    capture: true,
    passive: false,
  });
  window.addEventListener('wheel', onAxisWheel, {
    capture: true,
    passive: false,
  });
  window.addEventListener('dblclick', onAxisDblClick, true);

  // First load generation (see loadEpoch).
  loadEpoch += 1;
  chart.setSymbol({ ticker: opts.getSymbol(), pricePrecision: 2, volumePrecision: 0 });
  chart.setPeriod(periodFor(opts.getInterval()));

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
      const epoch = loadEpoch;
      try {
        const params = new URLSearchParams({
          source: 'binance',
          symbol: opts.getSymbol(),
          interval: opts.getInterval(),
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
        if (epoch !== loadEpoch) return;
        if (type === 'init') {
          // No newer bars exist beyond the latest (live updates arrive
          // via the WebSocket); older history does exist.
          if (klines.length === 0) {
            // Empty init: the chart callback clears the old candles,
            // so say so instead of leaving a blank chart unexplained,
            // and do not restore drawings onto a symbol with no data.
            initOk = false;
            opts.onLoadError(
              `無法載入 ${opts.getSymbol()} 的 K 線資料，請檢查標的或稍後再試。`,
            );
            opts.onLastKline(null);
            callback(klines, { backward: false, forward: false });
            return;
          }
          initOk = true;
          opts.onLoadError(null);
          opts.onLastKline(klines[klines.length - 1]);
          callback(klines, { backward: false, forward: hasMore });
          opts.onInitLoad();
        } else if (type === 'forward') {
          callback(klines, { forward: hasMore });
        } else {
          // 'backward': more newer bars only exist if a full page came back.
          callback(klines, { backward: hasMore });
        }
      } catch {
        // Stale generation: same drop — not even an error state, the
        // newer generation's own load reports its own outcome.
        if (epoch !== loadEpoch) return;
        if (type === 'init') {
          initOk = false;
          opts.onLoadError(
            `無法載入 ${opts.getSymbol()} 的 K 線資料，請檢查標的或稍後再試。`,
          );
        }
        callback([], { backward: false, forward: false });
      }
    },
    subscribeBar: ({ callback }) => {
      liveCallback = callback;
      socket?.disconnect();
      // The last init load delivered no data (unknown/delisted symbol):
      // do not open a socket that can never receive candles.
      if (!initOk) {
        opts.onConnectionStatus?.('closed');
        return;
      }
      const newSocket = new BinanceKlineSocket();
      socket = newSocket;
      newSocket.connect(
        opts.getSymbol(),
        opts.getInterval(),
        (kline) => {
          liveCallback?.(kline as KLineData);
          opts.onLastKline(kline as KLineData);
          // Last-tick time for the status bar, throttled to once a
          // second (the display only has second precision).
          const now = Date.now();
          if (now - lastTickReport >= 1000) {
            lastTickReport = now;
            opts.onLastTick?.(now);
          }
        },
        (status) => opts.onConnectionStatus?.(status),
      );
    },
    unsubscribeBar: () => {
      liveCallback = null;
      socket?.disconnect();
      socket = null;
    },
  };
  chart.setDataLoader(dataLoader);

  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(container);

  const getChart = () => chart;

  const setSymbolInterval = () => {
    const symbol = opts.getSymbol();
    const interval = opts.getInterval();
    if (!chart) return;
    // A new symbol/interval is about to load: drop any stale error
    // and legend (including a hovered candle from the old symbol).
    opts.onLoadError(null);
    opts.onLastKline(null);
    opts.crosshair.clear();
    const prev = prevSymbolInterval;
    if (prev === null) {
      prevSymbolInterval = { symbol, interval };
      return;
    }
    if (prev.symbol !== symbol || prev.interval !== interval) {
      // New symbol/interval = new price scale: drop any manual
      // axis-zoom range so the next load auto-fits (item 7).
      manualPriceRange = null;
      // The old view's drawings / history / selection / draw state
      // belong to Chart (DrawingController / HistoryManager / mode
      // machine): Chart persists the old view and resets them before
      // the new load starts (see onSymbolIntervalChange in Chart.tsx).
      opts.onSymbolIntervalChange(prev, { symbol, interval });
      // New load generation: the setSymbol/setPeriod below (each firing
      // its own getBars("init")) belong to this one generation. This must
      // sit inside the change branch — setSymbolInterval also re-runs without a
      // change (dev double-invoke), and incrementing there would orphan
      // the in-flight load with no replacement load issued.
      loadEpoch += 1;
    }
    prevSymbolInterval = { symbol, interval };
    opts.suppressSaveRef.current = true;
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
      opts.suppressSaveRef.current = false;
    }
    // getBars("init") fires from setSymbol/setPeriod and restores drawings.
  };

  const setChartType = () => {
    if (!chart) return;
    chart.setStyles({ candle: { type: opts.getChartType() } });
  };

  const setIndicators = () => {
    if (!chart) return;
    const indicators = opts.getIndicators();
    const desired = new Set(indicators);
    for (const ind of chart.getIndicators()) {
      const shouldBeMain = isMainPaneIndicator(ind.name);
      const isMain = ind.paneId === CANDLE_PANE_ID;
      // Remove when undesired OR in the wrong pane: flipping an
      // indicator's mainPane flag (e.g. VOL moving from its own pane
      // into the candle pane) otherwise leaves the existing instance
      // in its old pane forever — the creation loop below only adds
      // names that are absent. Removing an indicator also drops its
      // now-empty pane.
      if (!desired.has(ind.name) || shouldBeMain !== isMain) {
        chart.removeIndicator({ name: ind.name });
      }
    }
    const current = new Set(chart.getIndicators().map((i) => i.name));
    // VOL needs its own y-axis in the candle pane (see VOL_AXIS_ID
    // above): create it before the VOL indicator, drop it when VOL
    // is off. getYAxes filters by pane + id; createYAxis with an
    // existing id would just re-override it, so the existence check
    // keeps this a no-op on every other indicators change.
    const wantVol = desired.has('VOL');
    const volAxisExists = chart
      .getYAxes({ paneId: CANDLE_PANE_ID })
      .some((a) => a.id === VOL_AXIS_ID);
    if (wantVol && !volAxisExists) {
      chart.createYAxis({
        id: VOL_AXIS_ID,
        paneId: CANDLE_PANE_ID,
        position: 'right',
        inside: true,
        needWidget: false,
        gap: { top: 0, bottom: 0 },
        createRange: volAxisCreateRange,
      });
    } else if (!wantVol && volAxisExists) {
      chart.removeYAxis({ id: VOL_AXIS_ID });
    }
    for (const name of indicators) {
      if (!current.has(name)) {
        if (name === 'VOL') {
          // Own y-axis (see above): without it VOL shares the price
          // axis and crushes the candles.
          chart.createIndicator(
            { name, paneId: CANDLE_PANE_ID, yAxisId: VOL_AXIS_ID },
            true,
          );
        } else {
          // isStack=true is required for main-pane indicators: addIndicator
          // clears the other indicators in the pane when isStack is false,
          // so MA/EMA/BOLL sharing candle_pane would delete each other.
          chart.createIndicator(
            isMainPaneIndicator(name)
              ? { name, paneId: CANDLE_PANE_ID }
              : name,
            isMainPaneIndicator(name),
          );
        }
      }
    }
    // Re-render the legend after (re)creating indicators: their calc
    // results only exist now, and the render carrying the new
    // `indicators` prop ran before this effect (see indicatorTick).
    // (the bump goes through onIndicatorTick; the Chart effect that
    // calls setIndicators depends on [indicators] only, so this
    // cannot loop.)
    opts.onIndicatorTick();
  };

  /**
   * Fit a calendar range into the chart width, pinned to the latest
   * candle. The span is capped by the candles actually loaded (500 per
   * init load, more on scroll), so wide ranges on short intervals show
   * the widest available window.
   */
  const applyRange = (range: RangeId) => {
    if (!chart) return;
    const data = chart.getDataList();
    if (data.length === 0) return;
    const intervalMs = INTERVAL_MS[opts.getInterval()] ?? 0;
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

  /** Restore the default view (DEFAULT_RESET_RANGE, see above). */
  const resetView = () => {
    // 重設檢視 also restores the auto-fit price scale (item 7).
    manualPriceRange = null;
    applyPriceAxisRange();
    applyRange(DEFAULT_RESET_RANGE);
  };

  const disposeEngine = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('mousedown', onAxisPointerDown, true);
    window.removeEventListener('touchstart', onAxisPointerDown, true);
    window.removeEventListener('wheel', onAxisWheel, true);
    window.removeEventListener('dblclick', onAxisDblClick, true);
    window.removeEventListener('mousemove', onAxisPointerMove);
    window.removeEventListener('touchmove', onAxisPointerMove);
    if (axisDragApplyRaf !== 0) {
      cancelAnimationFrame(axisDragApplyRaf);
      axisDragApplyRaf = 0;
    }
    axisDrag = null;
    resizeObserver?.disconnect();
    opts.crosshair.dispose();
    chart?.unsubscribeAction(
      'onCrosshairChange',
      opts.crosshair.handleCrosshairChange,
    );
    socket?.disconnect();
    socket = null;
    liveCallback = null;
    chart = null;
    dispose(container);
  };

  return {
    getChart,
    setSymbolInterval,
    setChartType,
    setIndicators,
    applyRange,
    resetView,
    dispose: disposeEngine,
  };
}
