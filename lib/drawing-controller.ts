/**
 * lib/drawing-controller.ts — DrawingController (MASTER TASK Phase 3 Step 7).
 *
 * Owns the drawing core that used to live inline in
 * components/Chart.tsx: overlayCreate / armOverlay / restoreDrawings,
 * selection (refreshSelected / applyEdit / deleteSelected /
 * copySelected / bringToFront / sendToBack), text annotations
 * (syncTextAnnotation / syncAllTextAnnotations), deselect /
 * resetChartClickOverlay / finishDrawing / currentOverlayMode, the
 * settings-dialog handlers (dialogDraftFromSelected / openDialogFor /
 * closeDialog / applyDialog) and the object-list handlers
 * (refreshObjectList / toggleListCheck / handleListRowClick /
 * patchStoredOverlay / toggleListVisible / toggleListLock /
 * deleteListOverlay / batchListAction / toggleObjectList).
 * Pure TypeScript, no React: Chart holds a single instance in a ref.
 *
 * Behaviour is unchanged from the inline version:
 * - Selection lives in a controller ref and is mirrored to Chart's
 *   React state through onSelectionChange (floating bar / dialog
 *   rendering only); the mode follow on deselect (Selected -> Idle)
 *   runs here, next to the selection it observes.
 * - The dialog draft state stays in Chart: openDialogFor hands the
 *   built draft to onDialogOpen, closeDialog reports through
 *   onDialogClose; the pending-text id (a just-drawn standalone text
 *   annotation removed when its dialog closes empty) lives here.
 * - The object list is a projection of readMergedList, mirrored to
 *   Chart through onObjectListChange; the checked set lives here and
 *   is pruned by refreshObjectList. The panel open state stays in
 *   Chart (read / written through getObjectListOpen /
 *   setObjectListOpen).
 * - The style helpers (parseLineColor / logicalLineStyle /
 *   stylesForOverlay / defaultPriceLabel / isHorizontalTool) move
 *   here from Chart (Step 3 left them for Step 7); parseLineColor
 *   and logicalLineStyle are exported for Chart's lineParsers
 *   injection into the persistence layer. SelectedOverlayState moves
 *   here too; Chart re-exports it.
 * - Persist results reach Chart through onSaveWarning (same rule as
 *   Chart's persistDrawings wrapper: a skipped write leaves the
 *   banner untouched).
 * - History notifications still come from the DrawingHistoryManager
 *   itself (its onChange callback, wired by Chart); there is no
 *   separate onHistoryChange dep here.
 */

import type {
  Chart,
  DeepPartial,
  Overlay,
  OverlayCreate,
  OverlayMode,
  OverlayStyle,
} from 'klinecharts';
import {
  DRAWING_TOOLS,
  INTERVAL_MS,
  extendForOverlay,
  lineFamilyOf,
  orderPointsForExtend,
  overlayNameForExtend,
  type DrawingTool,
  type ExtendId,
  type LineFamily,
  type LineStyleId,
} from '@/lib/chart-config';
import {
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
} from '@/lib/chart-theme';
import type { InteractionModeController } from '@/lib/chart-interaction-mode';
import type { DrawingHistoryManager } from '@/lib/drawing-history';
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
import type { DrawingPersistence } from '@/lib/drawing-persistence';
import {
  DEFAULT_OVERLAY_STYLE,
  DEFAULT_OVERLAY_TEXT,
  loadDrawingsStore,
  newOverlayId,
  saveDrawingsStore,
  saveLastOverlayStyle,
  type LastOverlayStyle,
  type MagnetMode,
  type OverlayStylePatch,
  type OverlayText,
  type SavedOverlay,
} from '@/lib/store';
import { INTERVAL_LABELS, type Interval } from '@/lib/types';
import type {
  ObjectListBatchAction,
  ObjectListItem,
} from '@/components/ObjectList';
import type {
  DialogTab,
  OverlayDialogDraft,
} from '@/components/OverlaySettingsDialog';

/** Snapshot of one selected overlay for the floating edit bar and the
 *  settings dialog. Points/text/visibility/extend are read from the
 *  live overlay (extend is derived from the overlay name + point order). */
export interface SelectedOverlayState {
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
export function parseLineColor(
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
export function logicalLineStyle(
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

/** Line parsers for toSavedOverlay (see lib/drawing-model.ts). */
const lineParsers: OverlayLineParsers = {
  parseLineColor,
  logicalLineStyle,
};

/** Deterministic id of a main line's accompanying text annotation. */
const textAnnotationId = (mainId: string): string => `${mainId}:text`;

/**
 * Compat-click suppression window after a draw ends and auto-selects
 * (B10, third timer). The tap that ended a draw produces a browser
 * compatibility click which lands on the freshly rendered floating
 * bar; time is the only discriminator. Set only by the Drawing ->
 * Selected transition (draw end with auto-select).
 */
const BAR_COMPAT_CLICK_SUPPRESS_MS = 300;

/** Dependencies injected by Chart (all read at call time, never captured). */
export interface DrawingControllerDeps {
  getChart: () => Chart | null;
  getSymbol: () => string;
  getInterval: () => string;
  getActiveTool: () => DrawingTool | null;
  getContinuousDraw: () => boolean;
  onToolDone: () => void;
  getMagnetMode: () => MagnetMode;
  isModifierHeld: () => boolean;
  getLastOverlayStyle: () => LastOverlayStyle;
  mode: InteractionModeController;
  history: DrawingHistoryManager;
  persistence: DrawingPersistence;
  suppressSaveRef: { current: boolean };
  restoringRef: { current: boolean };
  lastRestoredKeyRef: { current: string | null };
  barIgnoreClicksUntilRef: { current: number };
  measureJustDrawnRef: { current: boolean };
  getObjectListOpen: () => boolean;
  setObjectListOpen: (open: boolean) => void;
  onSelectionChange: (selected: SelectedOverlayState | null) => void;
  onDialogOpen: (
    draft: OverlayDialogDraft,
    tab: DialogTab,
    bars: Array<{ timestamp: number }>,
  ) => void;
  onDialogClose: () => void;
  onObjectListChange: (items: ObjectListItem[], checked: string[]) => void;
  onSaveWarning: (warning: string | null) => void;
}

export interface DrawingController {
  overlayCreate: (saved: SavedOverlay) => OverlayCreate;
  armOverlay: (
    tool: DrawingTool,
    presetPoints?: Array<{ timestamp: number; value: number }>,
  ) => void;
  restoreDrawings: () => void;
  refreshSelected: (
    id: string | null,
    opts?: { fromDrawEnd?: boolean },
  ) => void;
  applyEdit: (
    patch: Partial<Omit<SelectedOverlayState, 'id' | 'name' | 'isRect'>>,
    pushHist?: boolean,
  ) => void;
  deleteSelected: () => void;
  copySelected: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  syncTextAnnotation: (mainId: string) => void;
  syncAllTextAnnotations: () => void;
  deselect: () => void;
  clearSelection: () => void;
  resetChartClickOverlay: () => void;
  finishDrawing: (id: string) => boolean;
  currentOverlayMode: () => OverlayMode;
  getSelected: () => SelectedOverlayState | null;
  getDrawingId: () => string | null;
  clearDrawingId: () => void;
  cancelDrawing: () => boolean;
  cancelPendingArmPush: () => void;
  openDialogFor: (
    id: string,
    tab: DialogTab,
    opts?: { fromDrawEnd?: boolean },
  ) => void;
  closeDialog: () => void;
  applyDialog: (draft: OverlayDialogDraft) => void;
  refreshObjectList: () => void;
  toggleListCheck: (id: string) => void;
  handleListRowClick: (id: string) => void;
  toggleListVisible: (id: string) => void;
  toggleListLock: (id: string) => void;
  deleteListOverlay: (id: string) => void;
  batchListAction: (action: ObjectListBatchAction) => void;
  toggleObjectList: () => void;
  toggleAllChecked: () => void;
}

export function createDrawingController(
  deps: DrawingControllerDeps,
): DrawingController {
  const selectedRef: { current: SelectedOverlayState | null } = {
    current: null,
  };
  const drawingIdRef: { current: string | null } = { current: null };
  /**
   * Id of a just-drawn standalone text annotation whose dialog is
   * open. If the user closes it without typing any text, the empty
   * annotation is removed (it would otherwise be invisible and
   * unselectable forever).
   */
  const pendingTextIdRef: { current: string | null } = { current: null };
  /** Object-list projection mirror (see refreshObjectList). */
  const objectListItemsRef: { current: ObjectListItem[] } = { current: [] };
  /** Object-list checked ids (pruned by refreshObjectList). */
  const objectListCheckedRef: { current: string[] } = { current: [] };

  const setSelected = (s: SelectedOverlayState | null) => {
    selectedRef.current = s;
    deps.onSelectionChange(s);
    if (s === null) {
      // Deselected: the bar goes away (its open popover closes
      // with it — the toolbar clears openPanel on selected=null).
      // Mode follows the selection, but only out of Selected: a drag
      // or an overlay state owns the mode until it exits (their exit
      // restores it themselves), and a draw in progress is unaffected
      // by a selection change behind it.
      if (deps.mode.modeRef.current === 'Selected') {
        deps.mode.transitionMode('Idle', 'deselect');
      }
    }
  };

  // ---- magnet ----------------------------------------------------------

  // ---- magnet ----------------------------------------------------------

  const currentOverlayMode = (): OverlayMode => {
    const magnet = deps.getMagnetMode();
    const invert = deps.isModifierHeld();
    if (magnet === 'off') return invert ? 'weak_magnet' : 'normal';
    if (magnet === 'weak') return invert ? 'normal' : 'weak_magnet';
    return invert ? 'normal' : 'strong_magnet';
  };

  // ---- drawing persistence -------------------------------------------
  // Thin wrappers over the DrawingPersistence instance: every
  // internal call site keeps calling these names. persist returns a
  // PersistResult; `warning: undefined` means the write was skipped,
  // so the saveWarning banner is left untouched (as the old inline
  // early returns did); null clears it.

  const readMergedList = (
    symbol: string,
    interval: string,
  ): SavedOverlay[] => deps.persistence.readMergedList(symbol, interval);

  const persistDrawings = (symbol: string, interval: string) => {
    const result = deps.persistence.persist(symbol, interval, {
      suppressSave: deps.suppressSaveRef.current,
      lastRestoredKey: deps.lastRestoredKeyRef.current,
    });
    if (result.warning !== undefined) deps.onSaveWarning(result.warning);
  };

  // ---- text annotation ---------------------------------------------

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
    const chart = deps.getChart();
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
    const chart = deps.getChart();
    if (!chart) return;
    for (const o of chart.getOverlays()) {
      if (o.name === TEXT_ANNOTATION_NAME || o.name === MEASURE_NAME) {
        continue;
      }
      syncTextAnnotation(o.id);
    }
  };

  // ---- undo / redo (thin wrappers over the history manager) ------

  const pushHistory = () => {
    deps.history.push(
      readMergedList(deps.getSymbol(), deps.getInterval()),
    );
  };

  /**
   * G-11: pop back the pre-draw history push for the arm in progress.
   * Called wherever an unfinished draw is discarded (Esc, disarm,
   * tool switch, clear-all); a no-op once the draw has ended.
   */
  const cancelPendingArmPush = () => {
    deps.history.cancelPendingArmPush();
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
    const chart = deps.getChart();
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
    const chart = deps.getChart();
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
    setSelected(null);
    resetChartClickOverlay();
  };

  // ---- overlay creation --------------------------------------------

  const overlayCreate = (saved: SavedOverlay): OverlayCreate => {
    const style = saved.styles ?? deps.getLastOverlayStyle();
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
          : deps.getLastOverlayStyle().fillOpacity;
      ext.rectBorder = ext.rectBorder !== false;
      ext.rectMiddleLine = ext.rectMiddleLine === true;
      ext.rectFill = ext.rectFill === true;
    }
    if (isShape) {
      ext.fillOpacity =
        typeof ext.fillOpacity === 'number'
          ? ext.fillOpacity
          : deps.getLastOverlayStyle().fillOpacity;
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
      ext.intervalMs = INTERVAL_MS[deps.getInterval()] ?? 0;
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
        if (deps.restoringRef.current) return;
        drawingIdRef.current = e.overlay.id;
      },
      onDrawEnd: (e) => {
        if (deps.restoringRef.current) return;
        // G-11: the draw succeeded, so the arm's pre-draw history
        // push stays (a later cancel must not pop it back).
        deps.history.confirmArmPush();
        persistDrawings(deps.getSymbol(), deps.getInterval());
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
          deps.onToolDone();
          return;
        }
        const activeTool = deps.getActiveTool();
        if (deps.getContinuousDraw() && activeTool) {
          armOverlay(activeTool);
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
            deps.barIgnoreClicksUntilRef.current =
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
              deps.measureJustDrawnRef.current = true;
            }
            deps.mode.transitionMode(
              selectedRef.current ? 'Selected' : 'Idle',
              'draw-end:transient',
              { fromDrawEnd: true },
            );
          }
          deps.onToolDone();
        }
      },
      onRemoved: () => {
        if (deps.restoringRef.current || deps.suppressSaveRef.current) return;
        persistDrawings(deps.getSymbol(), deps.getInterval());
      },
      onPressedMoveStart: (e) => {
        if (deps.restoringRef.current) return;
        if (saved.name === MEASURE_NAME) return;
        // Record the pre-move snapshot; history is pushed at move end
        // only if the overlay actually moved. A plain click on a
        // drawing starts a press but moves nothing — pushing there
        // would silently consume one undo step.
        deps.history.setMoveStartSnapshot(
          readMergedList(deps.getSymbol(), deps.getInterval()),
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
        if (deps.mode.modeRef.current === 'Idle') {
          deps.mode.transitionMode('Selected', 'press:implicit-select');
        }
        deps.mode.transitionMode(
          isControlPoint ? 'Resizing' : 'Moving',
          isControlPoint ? 'press:resize-start' : 'press:move-start',
        );
      },
      onPressedMoveEnd: (e) => {
        if (deps.restoringRef.current || deps.suppressSaveRef.current) return;
        const snapshot = deps.history.takeMoveStartSnapshot();
        if (snapshot) {
          const before = snapshot.find((o) => o.id === e.overlay.id);
          const after = toSavedOverlay(e.overlay, lineParsers);
          if (
            before !== undefined &&
            after !== null &&
            JSON.stringify(before.points) !== JSON.stringify(after.points)
          ) {
            deps.history.push(snapshot);
          }
        }
        syncTextAnnotation(e.overlay.id);
        persistDrawings(deps.getSymbol(), deps.getInterval());
        refreshObjectList();
        // Mode: a drag always returns to Selected (its entry required
        // it). The measure overlay never enters Moving/Resizing (see
        // onPressedMoveStart), so it never returns from one either.
        if (saved.name !== MEASURE_NAME) {
          deps.mode.transitionMode('Selected', 'press:move-end');
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
        if (deps.restoringRef.current) return;
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
        if (deps.restoringRef.current) return;
        if (e.overlay.name === MEASURE_NAME) return;
        // The library creates no figure events while a draw is in
        // progress (isDrawing), so this cannot fire with mode Drawing;
        // guard anyway so a stray select never yanks the mode out of
        // a draw (Drawing -> Selected is only legal via draw end).
        if (deps.mode.modeRef.current === 'Drawing') return;
        refreshSelected(e.overlay.id);
      },
      onDeselected: (e) => {
        if (deps.restoringRef.current) return;
        if (selectedRef.current?.id === e.overlay.id) setSelected(null);
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
    const chart = deps.getChart();
    if (!chart) return;
    if (!presetPoints) {
      // Mode first: arming starts a draw (Idle or Selected — a selection
      // predating the draw is preserved and the draw-end path returns to
      // it via selectedRef). If the transition is refused (a drag or an
      // overlay state owns the mode), do not arm: a draw with the wrong
      // mode would leave the machine inconsistent.
      if (!deps.mode.transitionMode('Drawing', `arm:${tool}`, { viaArm: true })) return;
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
      deps.history.markArmPushPending();
    }
    const style = deps.getLastOverlayStyle();
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
      persistDrawings(deps.getSymbol(), deps.getInterval());
      refreshObjectList();
    } else {
      drawingIdRef.current = id;
    }
  };

  const restoreDrawings = () => {
    const chart = deps.getChart();
    if (!chart) return;
    const symbol = deps.getSymbol();
    const interval = deps.getInterval();
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
    deps.restoringRef.current = true;
    deps.suppressSaveRef.current = true;
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
      deps.suppressSaveRef.current = false;
      deps.restoringRef.current = false;
    }
    // G-19: this view has restored; persists for it are allowed now.
    deps.lastRestoredKeyRef.current = `${symbol}:${interval}`;
    refreshObjectList();
  };

  // ---- selection + edit bar ----------------------------------------

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
      setSelected(null);
      return;
    }
    const chart = deps.getChart();
    const o = chart?.getOverlays({ id })[0];
    if (!o) {
      setSelected(null);
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
    setSelected({
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
    const m = deps.mode.modeRef.current;
    if (m === 'Idle' || m === 'Selected') {
      deps.mode.transitionMode('Selected', 'select:refresh');
    } else if (m === 'Drawing' && opts?.fromDrawEnd) {
      deps.mode.transitionMode('Selected', 'draw-end:auto-select', {
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
    const chart = deps.getChart();
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
    persistDrawings(deps.getSymbol(), deps.getInterval());
    if (
      next.visibleIntervals !== undefined &&
      !next.visibleIntervals.includes(deps.getInterval())
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
    const chart = deps.getChart();
    if (!chart) return;
    pushHistory();
    // groupId removes the main line and its text annotation together.
    chart.removeOverlay({ groupId: cur.id });
    deselect();
    persistDrawings(deps.getSymbol(), deps.getInterval());
    refreshObjectList();
  };

  const copySelected = () => {
    const cur = selectedRef.current;
    if (!cur) return;
    const chart = deps.getChart();
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
    persistDrawings(deps.getSymbol(), deps.getInterval());
    refreshObjectList();
  };

  /** Move the selected overlay above every other overlay. */
  const bringToFront = () => {
    const chart = deps.getChart();
    if (!chart || !selectedRef.current) return;
    const max = chart
      .getOverlays()
      .reduce((m, o) => Math.max(m, o.zLevel ?? 0), 0);
    applyEdit({ zLevel: max + 1 });
  };

  /** Move the selected overlay below every other overlay. */
  const sendToBack = () => {
    const chart = deps.getChart();
    if (!chart || !selectedRef.current) return;
    const min = chart
      .getOverlays()
      .reduce((m, o) => Math.min(m, o.zLevel ?? 0), 0);
    applyEdit({ zLevel: min - 1 });
  };

  // ---- object list (Phase 2 Step 5, G-07/G-08) --------------------

  /** Re-read the list projection. Prunes checked ids that no longer exist. */
  const refreshObjectList = () => {
    const list = readMergedList(deps.getSymbol(), deps.getInterval());
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
      inView: isInView(o, deps.getInterval()),
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
    objectListItemsRef.current = items;
    const ids = new Set(items.map((it) => it.id));
    objectListCheckedRef.current = objectListCheckedRef.current.filter(
      (id) => ids.has(id),
    );
    deps.onObjectListChange(items, objectListCheckedRef.current);
  };

  /** Toggle one id in the multi-select set. */
  const toggleListCheck = (id: string) => {
    objectListCheckedRef.current = objectListCheckedRef.current.includes(id)
      ? objectListCheckedRef.current.filter((x) => x !== id)
      : [...objectListCheckedRef.current, id];
    deps.onObjectListChange(
      objectListItemsRef.current,
      objectListCheckedRef.current,
    );
  };

  /** Row click: in-view rows canvas-select (floating bar appears);
   *  out-of-view rows cannot be selected — their overlay is not in
   *  the chart — so the click toggles their multi-select checkbox. */
  const handleListRowClick = (id: string) => {
    const item = objectListItemsRef.current.find((it) => it.id === id);
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
    const list = store[deps.getSymbol()] ?? [];
    const idx = list.findIndex((o) => o.id === id);
    if (idx < 0) return false;
    const next = patch(list[idx]);
    const out = [...list];
    if (next === null) out.splice(idx, 1);
    else out[idx] = next;
    store[deps.getSymbol()] = out;
    saveDrawingsStore(store);
    return true;
  };

  /** List row: toggle visible. Selected overlays go through
   *  applyEdit so the floating bar stays in sync; other live
   *  overlays are overridden directly; out-of-view overlays are
   *  patched in the store. */
  const toggleListVisible = (id: string) => {
    const chart = deps.getChart();
    if (!chart) return;
    const live = chart.getOverlays({ id })[0];
    if (live) {
      if (selectedRef.current?.id === id) {
        applyEdit({ visible: !selectedRef.current.visible });
      } else {
        pushHistory();
        chart.overrideOverlay({ id, visible: !live.visible });
        syncTextAnnotation(id);
        persistDrawings(deps.getSymbol(), deps.getInterval());
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
    const chart = deps.getChart();
    if (!chart) return;
    const live = chart.getOverlays({ id })[0];
    if (live) {
      if (selectedRef.current?.id === id) {
        applyEdit({ lock: !selectedRef.current.lock });
      } else {
        pushHistory();
        chart.overrideOverlay({ id, lock: !live.lock });
        persistDrawings(deps.getSymbol(), deps.getInterval());
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
    const chart = deps.getChart();
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
    persistDrawings(deps.getSymbol(), deps.getInterval());
    refreshObjectList();
  };

  /** Batch hide/show/lock/unlock/delete over the checked ids (G-08).
   *  One history step for the whole batch. Live overlays are
   *  overridden/removed directly; stored-only overlays are patched
   *  in a single store write. */
  const batchListAction = (action: ObjectListBatchAction) => {
    const chart = deps.getChart();
    if (!chart || objectListCheckedRef.current.length === 0) return;
    const ids = [...objectListCheckedRef.current];
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
      const cur = store[deps.getSymbol()] ?? [];
      if (action === 'delete') {
        store[deps.getSymbol()] = cur.filter(
          (o) => !storedIds.includes(o.id),
        );
      } else {
        store[deps.getSymbol()] = cur.map((o) =>
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
    persistDrawings(deps.getSymbol(), deps.getInterval());
    refreshObjectList();
  };

  /** Open/close the list panel; opening always re-reads the list. */
  const toggleObjectList = () => {
    if (!deps.getObjectListOpen()) refreshObjectList();
    deps.setObjectListOpen(!deps.getObjectListOpen());
  };

  // ---- settings dialog (Phase 2) -----------------------------------

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
    const bars = deps.getChart()?.getDataList() ?? [];
    const draft = dialogDraftFromSelected(cur);
    // A fresh standalone text annotation has no text yet: pre-fill the
    // default so the 文字 tab's inputs are enabled immediately.
    if (cur.name === TEXT_ANNOTATION_NAME && draft.text === null) {
      draft.text = { ...DEFAULT_OVERLAY_TEXT };
    }
    deps.onDialogOpen(draft, tab, bars);
    // Overlay state: closeDialog restores the mode from before the
    // dialog opened (Selected in the normal path — never assume Idle).
    deps.mode.enterOverlayMode('Editing', 'dialog:open');
  };

  const closeDialog = () => {
    const pendingId = pendingTextIdRef.current;
    pendingTextIdRef.current = null;
    if (pendingId) {
      const chart = deps.getChart();
      const o = chart?.getOverlays({ id: pendingId })[0];
      const ext = (o?.extendData ?? {}) as Record<string, unknown>;
      if (o && parseOverlayText(ext.text) === null) {
        chart?.removeOverlay({ id: pendingId });
        if (selectedRef.current?.id === pendingId) deselect();
        persistDrawings(deps.getSymbol(), deps.getInterval());
        refreshObjectList();
      }
    }
    deps.onDialogClose();
    deps.mode.exitOverlayMode('dialog:close');
    // The dialog can delete or hide its own selection (empty text
    // annotation removed above; applyDialog's hidden-interval path):
    // a restored Selected with nothing selected is inconsistent, so
    // fall back to Idle.
    if (deps.mode.modeRef.current === 'Selected' && selectedRef.current === null) {
      deps.mode.transitionMode('Idle', 'dialog:close:no-selection');
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
    const chart = deps.getChart();
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
      persistDrawings(deps.getSymbol(), deps.getInterval());
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
      deps.suppressSaveRef.current = true;
      chart.removeOverlay({ groupId: cur.id });
      deps.suppressSaveRef.current = false;
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
    persistDrawings(deps.getSymbol(), deps.getInterval());
    if (
      draft.visibleIntervals !== undefined &&
      !draft.visibleIntervals.includes(deps.getInterval())
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

  // ---- selection / draw accessors (for Chart's remaining call sites) ---

  const getSelected = (): SelectedOverlayState | null =>
    selectedRef.current;

  /** Clear the React selection (mode follows out of Selected). */
  const clearSelection = (): void => {
    setSelected(null);
  };

  const getDrawingId = (): string | null => drawingIdRef.current;

  const clearDrawingId = (): void => {
    drawingIdRef.current = null;
  };

  /**
   * Discard the unfinished overlay (Esc, disarm, tool switch) and
   * pop back its G-11 pre-draw history push. Returns false when no
   * draw is in progress.
   */
  const cancelDrawing = (): boolean => {
    const id = drawingIdRef.current;
    if (!id) return false;
    deps.getChart()?.removeOverlay({ id });
    drawingIdRef.current = null;
    deps.history.cancelPendingArmPush();
    return true;
  };

  /** Toggle-all for the object list (checked set lives here). */
  const toggleAllChecked = (): void => {
    const items = objectListItemsRef.current;
    objectListCheckedRef.current =
      objectListCheckedRef.current.length === items.length &&
      items.length > 0
        ? []
        : items.map((it) => it.id);
    deps.onObjectListChange(items, objectListCheckedRef.current);
  };

  return {
    overlayCreate,
    armOverlay,
    restoreDrawings,
    refreshSelected,
    applyEdit,
    deleteSelected,
    copySelected,
    bringToFront,
    sendToBack,
    syncTextAnnotation,
    syncAllTextAnnotations,
    deselect,
    clearSelection,
    resetChartClickOverlay,
    finishDrawing,
    currentOverlayMode,
    getSelected,
    getDrawingId,
    clearDrawingId,
    cancelDrawing,
    cancelPendingArmPush,
    openDialogFor,
    closeDialog,
    applyDialog,
    refreshObjectList,
    toggleListCheck,
    handleListRowClick,
    toggleListVisible,
    toggleListLock,
    deleteListOverlay,
    batchListAction,
    toggleObjectList,
    toggleAllChecked,
  };
}
