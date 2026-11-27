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
 * ChartEngine (lib/chart-engine.ts, Phase 3 Step 8) owns the
 * klinecharts instance, data loading, the live socket, indicators,
 * chart type and range fitting; this file is the composition root
 * (controllers + React state + JSX + wiring).
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
import { type KLineData } from 'klinecharts';
import type { Interval } from '@/lib/types';
import { INTERVAL_LABELS } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import type { BinanceSocketStatus } from '@/lib/ws/binance';
import ChartContextMenu, {
  type ContextMenuItem,
} from '@/components/ChartContextMenu';
import ChartLegend from '@/components/ChartLegend';
import DrawingSelectionToolbar, {
  BarGearIcon,
  type DrawingSelectionToolbarHandle,
} from '@/components/DrawingSelectionToolbar';
import ObjectList, {
  type ObjectListItem,
} from '@/components/ObjectList';
import OverlaySettingsDialog, {
  type DialogTab,
  type OverlayDialogDraft,
} from '@/components/OverlaySettingsDialog';
import {
  DRAWING_TOOLS,
  type ChartType,
  type DrawingTool,
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
  createChartEngine,
  type ChartEngine,
} from '@/lib/chart-engine';
import {
  createInteractionModeController,
  type InteractionModeController,
} from '@/lib/chart-interaction-mode';
import {
  buildAppearanceStyles,
  type AppearanceSettings,
} from '@/lib/chart-appearance';
import { DrawingHistoryManager } from '@/lib/drawing-history';
import {
  isInView,
  MEASURE_NAME,
  normalizeZLevels,
  type OverlayLineParsers,
} from '@/lib/drawing-model';
import {
  createDrawingPersistence,
  type DrawingPersistence,
  type OverlayTemplates,
} from '@/lib/drawing-persistence';
import {
  createDrawingController,
  logicalLineStyle,
  parseLineColor,
  type DrawingController,
  type SelectedOverlayState,
} from '@/lib/drawing-controller';
import {
  getLastOverlayStyle,
  getLastPositionInputs,
  getMagnetMode,
  loadDrawingsStore,
  saveDrawingsStore,
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

/**
 * InteractionMode lives in lib/chart-interaction-mode.ts (Phase 3
 * Step 6); re-exported here so existing importers keep working.
 */
export type { InteractionMode } from '@/lib/chart-interaction-mode';
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
 * SelectedOverlayState lives in lib/drawing-controller.ts (Phase 3
 * Step 7); re-exported here so existing importers keep working.
 */
export type { SelectedOverlayState };

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
  /**
   * ChartEngine (Phase 3 Step 8): owns the klinecharts instance,
   * data loading, the live socket, indicators, chart type and range
   * fitting (lib/chart-engine.ts). Chart holds a single instance in
   * this ref; it is created by the init effect below.
   */
  const engineRef = useRef<ChartEngine | null>(null);

  // Refs mirror the latest props so DataLoader closures (registered once)
  // always fetch/subscribe for the current symbol + interval.
  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);
  const chartTypeRef = useRef(chartType);
  const indicatorsRef = useRef(indicators);
  const onToolDoneRef = useRef(onToolDone);
  const onConnectionStatusRef = useRef(onConnectionStatus);
  const onLastTickRef = useRef(onLastTick);
  const activeToolRef = useRef(activeTool);
  const continuousDrawRef = useRef(continuousDraw);
  const onHistoryChangeRef = useRef(onHistoryChange);
  const onOpenAppearanceSettingsRef = useRef(onOpenAppearanceSettings);
  symbolRef.current = symbol;
  intervalRef.current = interval;
  chartTypeRef.current = chartType;
  indicatorsRef.current = indicators;
  onToolDoneRef.current = onToolDone;
  onConnectionStatusRef.current = onConnectionStatus;
  onLastTickRef.current = onLastTick;
  activeToolRef.current = activeTool;
  continuousDrawRef.current = continuousDraw;
  onHistoryChangeRef.current = onHistoryChange;
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
      () => engineRef.current?.getChart() ?? null,
      lineParsers,
    );
  }
  const persistence = persistenceRef.current;
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
  // §7.1), owned by the InteractionModeController in
  // lib/chart-interaction-mode.ts (Phase 3 Step 6). Refs only: a mode
  // change must never re-render Chart (step 2 moved high-frequency
  // updates out of React state; this must not move back). Every mode
  // change goes through transitionMode / enterOverlayMode /
  // exitOverlayMode below. Chart holds a single controller instance
  // in a ref; the aliases keep every existing call site's name.
  // The callbacks inject the two Selected side effects — the touch
  // fallback timer and the floating-bar compat-click guard both stay
  // refs in Chart (the guard is only read by the toolbar, Step 5).
  const interactionModeRef = useRef<InteractionModeController | null>(null);
  if (interactionModeRef.current === null) {
    interactionModeRef.current = createInteractionModeController({
      onEnterSelected: () => {
        if (touchFallbackTimerRef.current) {
          clearTimeout(touchFallbackTimerRef.current);
          touchFallbackTimerRef.current = null;
        }
      },
      onLeaveSelected: () => {
        barIgnoreClicksUntilRef.current = 0;
      },
    });
  }
  const interactionMode = interactionModeRef.current;
  const modeRef = interactionMode.modeRef;
  const measureJustDrawnRef = interactionMode.measureJustDrawnRef;
  const transitionMode = interactionMode.transitionMode;
  const enterOverlayMode = interactionMode.enterOverlayMode;
  const exitOverlayMode = interactionMode.exitOverlayMode;
  const [selected, setSelected] = useState<SelectedOverlayState | null>(null);
  /**
   * Overlay style templates, grouped by overlay name (tool type).
   * Mirror only: the DrawingSelectionToolbar owns the templates
   * state (Step 5); Chart keeps this copy for the settings dialog,
   * updated via onTemplatesChange.
   */
  const [templates, setTemplates] =
    useState<OverlayTemplates>(() => persistence.loadTemplates());
  /**
   * Object list (Phase 2 Step 5, G-07/G-08): panel open state, the
   * current projection (refreshed from readMergedList after every
   * mutation — never a second source of truth), and the ids checked
   * for batch actions. The panel itself is ObjectList.tsx.
   */
  const [objectListOpen, setObjectListOpen] = useState(false);
  /** Ref mirror of objectListOpen for the drawing controller's getter. */
  const objectListOpenRef = useRef(objectListOpen);
  objectListOpenRef.current = objectListOpen;
  const [objectListItems, setObjectListItems] = useState<ObjectListItem[]>(
    [],
  );
  const [objectListChecked, setObjectListChecked] = useState<string[]>([]);
  /** Outer chart wrapper (the floating bar's offset parent). */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  /** Floating bar element (used for click-outside popover detection). */
  const barRef = useRef<HTMLDivElement | null>(null);
  /** Imperative handle of the floating bar (template apply for the dialog). */
  const toolbarRef = useRef<DrawingSelectionToolbarHandle | null>(null);
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
      () => engineRef.current?.getChart() ?? null,
    );
  }
  const crosshair = crosshairRef.current;
  /**
   * Drawing undo/redo state (Phase 3 Step 2): owned by the
   * DrawingHistoryManager in lib/drawing-history.ts. Chart holds a
   * single instance in a ref; the thin wrappers below (pushHistory /
   * undo / redo) delegate to it, and applySnapshot stays here (it
   * needs drawingController.overlayCreate + the store + mode + the
   * object list).
   */
  const historyManagerRef = useRef<DrawingHistoryManager | null>(null);
  if (historyManagerRef.current === null) {
    historyManagerRef.current = new DrawingHistoryManager(
      (canUndo, canRedo) => onHistoryChangeRef.current?.(canUndo, canRedo),
    );
  }
  const historyManager = historyManagerRef.current;
  /** Stable chart accessor for the legend (step 2b). */
  const getChart = useCallback(() => engineRef.current?.getChart() ?? null, []);
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

  // ---- undo / redo -----------------------------------------------------
  // Stacks, the pending-arm flag and the pre-move snapshot live in
  // the DrawingHistoryManager (lib/drawing-history.ts); these are
  // thin wrappers over it. applySnapshot stays here (see below).

  const pushHistory = () => {
    historyManager.push(
      readMergedList(symbolRef.current, intervalRef.current),
    );
  };

  const applySnapshot = (snapshotIn: SavedOverlay[]) => {
    const chart = engineRef.current?.getChart() ?? null;
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
        chart.createOverlay(drawingController.overlayCreate(o));
      }
      drawingController.syncAllTextAnnotations();
      drawingController.resetChartClickOverlay();
    } finally {
      suppressSaveRef.current = false;
      restoringRef.current = false;
    }
    drawingController.clearSelection();
    // The rebuild wiped every overlay including an in-progress one
    // (undo/redo mid-draw), so no draw is in progress any more.
    drawingController.refreshObjectList();
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



  // ---- drawing controller (Phase 3 Step 7) --------------------------
  //
  // Owns overlay CRUD, selection, text annotations, the settings
  // dialog handlers and the object-list handlers in
  // lib/drawing-controller.ts (origin: inline in this file). Chart
  // holds a single instance in a ref; selection is mirrored to React
  // state through onSelectionChange for the floating bar / dialog,
  // the dialog draft state stays here and is driven through
  // onDialogOpen / onDialogClose, and the object list is mirrored
  // through onObjectListChange. The context-menu controller below
  // binds its actions to this controller.
  const drawingControllerRef = useRef<DrawingController | null>(null);
  if (drawingControllerRef.current === null) {
    drawingControllerRef.current = createDrawingController({
      getChart: () => engineRef.current?.getChart() ?? null,
      getSymbol: () => symbolRef.current,
      getInterval: () => intervalRef.current,
      getActiveTool: () => activeToolRef.current,
      getContinuousDraw: () => continuousDrawRef.current,
      onToolDone: () => onToolDoneRef.current(),
      getMagnetMode,
      isModifierHeld: () => modifierRef.current,
      getLastOverlayStyle,
      getLastPositionInputs,
      mode: interactionMode,
      history: historyManager,
      persistence,
      suppressSaveRef,
      restoringRef,
      lastRestoredKeyRef,
      barIgnoreClicksUntilRef,
      measureJustDrawnRef,
      getObjectListOpen: () => objectListOpenRef.current,
      setObjectListOpen,
      onSelectionChange: setSelected,
      onDialogOpen: (draft, tab, bars) => {
        setDialogBars(bars);
        setDialogTab(tab);
        setDialogDraft(draft);
        dialogOpenRef.current = true;
      },
      onDialogClose: () => {
        setDialogDraft(null);
        dialogOpenRef.current = false;
      },
      onObjectListChange: (items, checked) => {
        setObjectListItems(items);
        setObjectListChecked(checked);
      },
      onSaveWarning: setSaveWarning,
    });
  }
  const drawingController = drawingControllerRef.current;

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
      getChart: () => engineRef.current?.getChart() ?? null,
      getContainer: () => containerRef.current,
      getWrapper: () => wrapperRef.current,
      getSelected: () => drawingController.getSelected(),
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
          drawingController.armOverlay('horizontalStraightLine', [
            { timestamp, value: price },
          ]),
        armVerticalAt: (timestamp, price) =>
          drawingController.armOverlay('verticalStraightLine', [
            { timestamp, value: price },
          ]),
        deleteSelected: () => drawingController.deleteSelected(),
        copySelected: () => drawingController.copySelected(),
        bringToFront: () => drawingController.bringToFront(),
        sendToBack: () => drawingController.sendToBack(),
        toggleLock: (locked) => drawingController.applyEdit({ lock: locked }),
        toggleVisible: (visible) =>
          drawingController.applyEdit({ visible }),
        openDialogFor: (id) => drawingController.openDialogFor(id, 'style'),
        openAppearanceSettings: () =>
          onOpenAppearanceSettingsRef.current?.(),
        resetView: () => engineRef.current?.resetView(),
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
      const chart = engineRef.current?.getChart() ?? null;
      if (!chart) return;
      // G-11: an in-progress draw is wiped too; its pending push goes back.
      drawingController.cancelPendingArmPush();
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
      drawingController.deselect();
      drawingController.refreshObjectList();
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
      engineRef.current?.applyRange(range);
    },
    resetView() {
      engineRef.current?.resetView();
    },
    openObjectList() {
      drawingController.refreshObjectList();
      setObjectListOpen(true);
    },
  }));

  // ---- chart engine (Phase 3 Step 8) ------------------------------
  //
  // Owns the klinecharts instance, data loading, the live socket,
  // indicators, chart type and range fitting in lib/chart-engine.ts
  // (origin: inline in this file, verbatim). Chart holds a single
  // instance in a ref; the effects below forward prop changes to it
  // (symbol/interval, chart type, indicators), and the appearance
  // effect still applies appearance through engine.getChart().
  // The engine is created once, on mount; dispose runs on unmount.

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createChartEngine(container, {
      getSymbol: () => symbolRef.current,
      getInterval: () => intervalRef.current,
      getChartType: () => chartTypeRef.current,
      getIndicators: () => indicatorsRef.current,
      getInteractionMode: () => modeRef.current,
      initialAppearance: appearance,
      crosshair,
      onLastTick: (atMs) => onLastTickRef.current?.(atMs),
      onConnectionStatus: (status) => onConnectionStatusRef.current?.(status),
      onLoadError: setLoadError,
      onLastKline: setLastKline,
      onInitLoad: () => drawingController.restoreDrawings(),
      onSymbolIntervalChange: (prev) => {
        // Save the old chart's drawings before wiping them.
        persistDrawings(prev.symbol, prev.interval);
        // History is per view — a snapshot from another symbol/interval
        // must not be applied here.
        historyManager.clear();
        drawingController.deselect();
        // An unfinished drawing cannot survive the switch: cancel it.
        drawingController.clearDrawingId();
        if (modeRef.current === 'Drawing') {
          transitionMode('Idle', 'symbol-change');
        }
        if (activeToolRef.current) onToolDoneRef.current();
      },
      onIndicatorTick: () => setIndicatorTick((t) => t + 1),
      suppressSaveRef,
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- symbol / interval switch ----------------------------------------

  // Tracks the last applied symbol/interval. The first run is skipped:
  // the init effect above already called setSymbol + setPeriod once, and
  // calling them again would trigger a second, wasteful init load.
  // (The engine owns the tracker and the switch itself; see
  // lib/chart-engine.ts setSymbolInterval.)

  useEffect(() => {
    engineRef.current?.setSymbolInterval();
  }, [symbol, interval]);

  // ---- drawing tool arming ---------------------------------------------

  useEffect(() => {
    const chart = engineRef.current?.getChart() ?? null;
    if (!chart) return;
    if (!activeTool) {
      // Disarming (or Esc) removes any unfinished overlay instead of
      // leaving it on the chart.
      // Discard any unfinished overlay (and its G-11 pre-draw push).
      drawingController.cancelDrawing();
      // A draw that ends by disarming (Esc cancel, tool switch)
      // returns to whatever the selection says.
      if (modeRef.current === 'Drawing') {
        transitionMode(
          drawingController.getSelected() ? 'Selected' : 'Idle',
          'disarm',
          { fromDrawEnd: true },
        );
      }
      return;
    }
    drawingController.armOverlay(activeTool);
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
        const drawingId = drawingController.getDrawingId();
        if (drawingId) {
          // A path/pen with at least 2 points finishes on Esc
          // (TradingView behaviour); anything else — including a
          // path/pen with fewer than 2 points — is cancelled.
          if (drawingController.finishDrawing(drawingId)) return;
          drawingController.cancelDrawing();
          onToolDoneRef.current();
          return;
        }
        const measure = engineRef.current?.getChart()?.getOverlays({
          name: MEASURE_NAME,
        })[0];
        if (measure) {
          engineRef.current?.getChart()?.removeOverlay({ id: measure.id });
          return;
        }
        if (drawingController.getSelected()) {
          drawingController.deselect();
          return;
        }
        if (activeToolRef.current) onToolDoneRef.current();
        return;
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        drawingController.getSelected()
      ) {
        e.preventDefault();
        drawingController.deleteSelected();
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
      const id = drawingController.getDrawingId();
      if (id) {
        engineRef.current?.getChart()?.overrideOverlay({ id, mode: drawingController.currentOverlayMode() });
      }
    };
    const onBlur = () => {
      if (!modifierRef.current) return;
      modifierRef.current = false;
      const id = drawingController.getDrawingId();
      if (id) {
        engineRef.current?.getChart()?.overrideOverlay({ id, mode: drawingController.currentOverlayMode() });
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
    engineRef.current?.setChartType();
  }, [chartType]);

  // ---- appearance -----------------------------------------------------
  // setStyles is a recursive deep merge (klinecharts bundle merge()),
  // so this never clobbers the candle type or the tooltip showRule
  // set above. The background colour is not a Styles field — it lives
  // on the container div (see the render below).
  useEffect(() => {
    const chart = engineRef.current?.getChart() ?? null;
    if (!chart) return;
    chart.setStyles(buildAppearanceStyles(appearance));
  }, [appearance]);

  // ---- indicators -------------------------------------------------------

  /** Bumps after the indicators effect (re)creates indicators, so the
   *  legend re-renders with the new calc results (see indicatorTick
   *  on ChartLegend). The effect itself depends on [indicators] only,
   *  so this bump cannot loop. */
  const [indicatorTick, setIndicatorTick] = useState(0);
  useEffect(() => {
    engineRef.current?.setIndicators();
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
    const chart = engineRef.current?.getChart() ?? null;
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
    const chart = engineRef.current?.getChart() ?? null;
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
    if (activeToolRef.current || drawingController.getDrawingId()) return;
    const tap = { x: e.clientX, y: e.clientY, time: Date.now() };
    const prev = lastTouchTapRef.current;
    lastTouchTapRef.current = tap;
    // Double-tap on the selected overlay opens its settings dialog
    // (touch equivalent of double-click). Armed tools / in-progress
    // drawings are already excluded above.
    const selectedNow = drawingController.getSelected();
    if (
      prev &&
      selectedNow &&
      tap.time - prev.time <= 300 &&
      Math.hypot(tap.x - prev.x, tap.y - prev.y) <= 20
    ) {
      const near = nearestOverlayAt(tap.x, tap.y, 24);
      if (near && near.id === selectedNow.id) {
        if (touchFallbackTimerRef.current) {
          clearTimeout(touchFallbackTimerRef.current);
          touchFallbackTimerRef.current = null;
        }
        drawingController.openDialogFor(selectedNow.id, 'style');
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
        if (near.id !== drawingController.getSelected()?.id)
          drawingController.refreshSelected(near.id);
      } else if (drawingController.getSelected() !== null) {
        drawingController.deselect();
      }
    }, TOUCH_FALLBACK_WAIT_MS);
  };

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

  // Legend (OHLC + indicators + countdown) lives in the memoized
  // ChartLegend component (components/ChartLegend.tsx): hover updates
  // re-render only that subtree, never this whole component
  // (Phase 1 step 2b).

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
        indicatorTick={indicatorTick}
      />
      {/* Top-right corner: chart settings gear + object list toggle
          (Phase 2 Step 5, G-07/G-08). The legend owns the top-left
          and the floating bar the bottom centre, so this corner is
          free on desktop and mobile. The gear is the always-visible
          appearance entry — the toolbar gear sits at the far right of
          a horizontally scrolling bar, so it needs a scroll to reach
          on phones. Desktop-only since 2026-11-27: on mobile the
          entries live in the 分析中心, and this row would collide
          with the MobileTopBar's collapse chevron at the same
          corner. */}
      <div className="absolute right-2 top-2 z-20 hidden items-center gap-1.5 md:flex">
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
          onClick={() => drawingController.toggleObjectList()}
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
            onRowClick={drawingController.handleListRowClick}
            onToggleCheck={drawingController.toggleListCheck}
            onToggleAll={() => drawingController.toggleAllChecked()}
            onToggleVisible={drawingController.toggleListVisible}
            onToggleLock={drawingController.toggleListLock}
            onDelete={drawingController.deleteListOverlay}
            onBatch={drawingController.batchListAction}
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
      <DrawingSelectionToolbar
        ref={toolbarRef}
        selected={selected}
        barRef={barRef}
        barIgnoreClicksUntilRef={barIgnoreClicksUntilRef}
        onApplyEdit={drawingController.applyEdit}
        onDelete={drawingController.deleteSelected}
        onDeselect={drawingController.deselect}
        onOpenDialog={drawingController.openDialogFor}
        onOpacitySliderStart={() => {
          if (!sliderHistoryPushedRef.current) {
            sliderHistoryPushedRef.current = true;
            pushHistory();
          }
        }}
        onOpacitySliderEnd={() => {
          sliderHistoryPushedRef.current = false;
        }}
        loadTemplates={() => persistence.loadTemplates()}
        saveTemplates={(next) => persistence.saveTemplates(next)}
        loadTemplateDefaults={() => persistence.loadTemplateDefaults()}
        saveTemplateDefaults={(next) =>
          persistence.saveTemplateDefaults(next)
        }
        onTemplatesChange={setTemplates}
      />
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
          onConfirm={drawingController.applyDialog}
          onClose={drawingController.closeDialog}
          onCopy={() => {
            drawingController.copySelected();
            drawingController.closeDialog();
          }}
          onBringToFront={() => {
            drawingController.bringToFront();
            drawingController.closeDialog();
          }}
          onSendToBack={() => {
            drawingController.sendToBack();
            drawingController.closeDialog();
          }}
          templates={templates[selected.name] ?? []}
          onApplyTemplate={(name) => {
            const tpl = (templates[selected.name] ?? []).find(
              (t) => t.name === name,
            );
            if (!tpl) return;
            toolbarRef.current?.applyTemplate(tpl);
            drawingController.closeDialog();
          }}
        />
      )}
    </div>
  );
});

export default Chart;
export { DRAWING_TOOLS };
