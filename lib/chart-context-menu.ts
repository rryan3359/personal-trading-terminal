/**
 * lib/chart-context-menu.ts — ContextMenuController (MASTER TASK Phase 3 Step 4).
 *
 * Owns the chart context menu that used to live inline in
 * components/Chart.tsx (origin: Phase 1 step 4, Phase 0 §6.2 / §7.1):
 * the menu ref, the menu state, open / close / copyPriceAt /
 * runMenuAction / select / handleContainerContextMenu, and the
 * document pointerdown outside-close listener. Pure TypeScript, no
 * React: Chart holds a single instance in a ref; the menu state is
 * mirrored to Chart's React state through onStateChange for
 * components/ChartContextMenu.tsx (pure presentation, untouched) to
 * render. Actions only issue requests through the injected `actions`
 * — the controller never operates the chart itself, except for the
 * scroll/zoom enable-disable that brackets the open menu.
 *
 * Behaviour is unchanged from the inline version:
 * - Opening / closing goes through the ContextMenu overlay state
 *   (onModeEnter records previousMode; onModeExit restores it, never
 *   assuming Idle). While the menu is open every chart interaction
 *   pauses (see Chart's backdrop / keyboard handling).
 * - Open returns early (no menu, no mode change) while the settings
 *   dialog is open and mid-drag (Moving / Resizing). Right-clicking
 *   while the menu is already open repositions it instead of nesting
 *   states.
 * - copyPriceAt is best-effort and silent on failure by design
 *   (Phase 0 §6.2 [待驗證]); the copied text is the displayed price
 *   without thousands separators.
 * - runMenuAction closes the menu first, then runs the action in the
 *   restored mode: Editing opens from Selected (never nested inside
 *   ContextMenu), delete deselects back to Idle, a new line
 *   auto-selects.
 * - chart-settings opens the appearance dialog (outer appearance
 *   track, 2026-11-26); the controller only forwards the request.
 * - G-18 is preserved: right-clicking an overlay never deletes it —
 *   the menu only offers actions, and `delete` goes through the
 *   normal deleteSelected path.
 *
 * Deps notes (additions vs the plan's Step 4 list, all read-only
 * getters — mode ownership stays in Chart until Step 6):
 * - `getLastKline`: the last-candle fallback for price / timestamp
 *   when convertFromPixel yields nothing (was the `lastKline` state).
 * - `isDialogOpen` / `isDragging` / `isOpen`: the open guard
 *   (dialog open, Moving / Resizing) and the close guard
 *   (mode === 'ContextMenu') that used to read refs directly.
 * - `actions.openAppearanceSettings`: the chart-settings item
 *   (the plan's list predates the appearance track changing that
 *   item from disabled to opening the dialog).
 * - `actions.openDialogFor` takes only the overlay id here; Chart
 *   binds the 'style' tab (DialogTab lives in Chart).
 */
import { formatPrice } from '@/lib/format';
import type { Chart, KLineData } from 'klinecharts';

/** Snapshot taken when the menu opens (anchor + price/time + selection). */
export interface ContextMenuState {
  /** Anchor in wrapper-relative px (the menu flips inside the wrapper). */
  x: number;
  y: number;
  /** Wrapper client size at open time, for the menu's edge flip. */
  bounds: { width: number; height: number };
  /** Price-axis value at the click; null when no data is loaded. */
  price: number | null;
  /** Candle timestamp at the click; null when no data is loaded. */
  timestamp: number | null;
  /** Selected overlay id at open time; null = chart-only menu. */
  selectedId: string | null;
  locked: boolean;
  visible: boolean;
}

/** The selection fields the menu snapshot needs (subset of Chart's SelectedOverlayState). */
export interface ContextMenuSelection {
  id: string;
  lock: boolean;
  visible: boolean;
}

/** Action requests the controller issues; Chart binds each to its own implementation. */
export interface ContextMenuActions {
  armHorizontalAt: (timestamp: number, price: number) => void;
  armVerticalAt: (timestamp: number, price: number) => void;
  deleteSelected: () => void;
  copySelected: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  toggleLock: (locked: boolean) => void;
  toggleVisible: (visible: boolean) => void;
  openDialogFor: (id: string) => void;
  openAppearanceSettings: () => void;
  resetView: () => void;
}

export interface ContextMenuControllerDeps {
  getChart: () => Chart | null;
  getContainer: () => HTMLDivElement | null;
  getWrapper: () => HTMLDivElement | null;
  getSelected: () => ContextMenuSelection | null;
  getLastKline: () => KLineData | null;
  /** True while the settings dialog is open (open guard). */
  isDialogOpen: () => boolean;
  /** True while a drag is in progress, i.e. mode Moving / Resizing (open guard). */
  isDragging: () => boolean;
  /** True while the menu is open, i.e. mode === 'ContextMenu' (close guard). */
  isOpen: () => boolean;
  /** Enter the ContextMenu overlay state; false = refused, do not open. */
  onModeEnter: () => boolean;
  /** Exit the ContextMenu overlay state back to previousMode. */
  onModeExit: () => boolean;
  /** Mirror the menu state to Chart's React state for rendering. */
  onStateChange: (menu: ContextMenuState | null) => void;
  actions: ContextMenuActions;
}

export interface ContextMenuController {
  /** Menu root element (outside-pointerdown close check). */
  menuRef: { current: HTMLDivElement | null };
  /** Current menu snapshot, or null when closed (source of truth). */
  getMenu: () => ContextMenuState | null;
  /** Open the menu at a viewport point (guards apply, see header). */
  open: (clientX: number, clientY: number) => void;
  /** Close the menu and restore the previous mode. No-op when closed. */
  close: () => void;
  /** Dispatch one menu item id (see ChartContextMenu sections). */
  select: (id: string) => void;
  /** Container right-click: suppress the browser menu and open ours. */
  handleContainerContextMenu: (e: {
    preventDefault: () => void;
    clientX: number;
    clientY: number;
  }) => void;
  /**
   * Register the document pointerdown outside-close listener.
   * Returns its cleanup. Chart calls this from an effect that runs
   * only while the menu is open.
   */
  attachOutsideClose: () => () => void;
}

export function createContextMenuController(
  deps: ContextMenuControllerDeps,
): ContextMenuController {
  let menu: ContextMenuState | null = null;
  const menuRef: { current: HTMLDivElement | null } = { current: null };

  const setMenu = (next: ContextMenuState | null) => {
    menu = next;
    deps.onStateChange(next);
  };

  /** Single funnel for closing the menu: restore pan/zoom, exit the
   *  overlay state back to previousMode. No-op when no menu is open,
   *  so the backdrop and the document listener can both call it for
   *  the same press without logging a rejected transition. */
  const close = () => {
    if (!deps.isOpen()) return;
    setMenu(null);
    const chart = deps.getChart();
    if (chart) {
      chart.setScrollEnabled(true);
      chart.setZoomEnabled(true);
    }
    deps.onModeExit();
  };

  /** Open the menu at a viewport point. Returns early (no menu, no
   *  mode change) while the settings dialog is open — the dialog owns
   *  focus, same rule as the chart keyboard shortcuts — and mid-drag,
   *  where the drag owns the pointer. Right-clicking while the menu
   *  is already open repositions it instead of nesting states. */
  const open = (clientX: number, clientY: number) => {
    if (deps.isDialogOpen()) return;
    if (deps.isDragging()) return;
    const chart = deps.getChart();
    const container = deps.getContainer();
    const wrapper = deps.getWrapper();
    if (!chart || !container || !wrapper) return;
    const rect = container.getBoundingClientRect();
    const wrapRect = wrapper.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    // Price + time at the click. convertFromPixel returns
    // { dataIndex, timestamp, value }; fall back to the hovered
    // candle's close, then the last candle. No data at all: the menu
    // still opens, but the price actions are disabled.
    let price: number | null = null;
    let timestamp: number | null = null;
    try {
      const raw = chart.convertFromPixel([{ x: px, y: py }]);
      const p = Array.isArray(raw) ? raw[0] : raw;
      if (p && typeof p.value === 'number' && Number.isFinite(p.value)) {
        price = p.value;
      }
      if (
        p &&
        typeof p.timestamp === 'number' &&
        Number.isFinite(p.timestamp)
      ) {
        timestamp = p.timestamp;
      }
      if (price === null && p && typeof p.dataIndex === 'number') {
        const list = chart.getDataList();
        const k =
          p.dataIndex >= 0 && p.dataIndex < list.length
            ? list[p.dataIndex]
            : undefined;
        if (k) {
          price = k.close;
          timestamp = k.timestamp;
        }
      }
    } catch {
      // Conversion failed: fall through to the last-candle fallback.
    }
    const lastKline = deps.getLastKline();
    if (price === null && lastKline) price = lastKline.close;
    if (timestamp === null && lastKline) timestamp = lastKline.timestamp;
    const sel = deps.getSelected();
    const anchor: ContextMenuState = {
      x: clientX - wrapRect.left,
      y: clientY - wrapRect.top,
      bounds: { width: wrapper.clientWidth, height: wrapper.clientHeight },
      price,
      timestamp,
      selectedId: sel?.id ?? null,
      locked: sel?.lock ?? false,
      visible: sel?.visible ?? true,
    };
    if (deps.isOpen()) {
      setMenu(anchor);
      return;
    }
    if (!deps.onModeEnter()) return;
    chart.setScrollEnabled(false);
    chart.setZoomEnabled(false);
    setMenu(anchor);
  };

  /** Copy the clicked price to the clipboard. Best-effort and
   *  silent on failure by design (Phase 0 §6.2 [待驗證]): clipboard
   *  permission depends on the browser. The copied text is the
   *  displayed price without thousands separators, so it pastes
   *  cleanly into a numeric field. */
  const copyPriceAt = (price: number) => {
    const text = formatPrice(price).replace(/,/g, '');
    if (process.env.NODE_ENV !== 'production') {
      (
        window as unknown as { __pttCopiedPrice?: string }
      ).__pttCopiedPrice = text;
    }
    try {
      const done = navigator.clipboard?.writeText(text);
      if (done && typeof done.catch === 'function') done.catch(() => {});
    } catch {
      // Silent: a failed copy must never surface an error.
    }
    try {
      if (!navigator.clipboard) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      // Silent (see above).
    }
  };

  /** Close the menu first, then run the action in the restored mode:
   *  Editing opens from Selected (never nested inside ContextMenu),
   *  delete deselects back to Idle, a new line auto-selects. */
  const runMenuAction = (fn: () => void) => {
    close();
    fn();
  };

  /** Dispatch one menu item. All branches reuse injected actions;
   *  nothing here re-implements an edit, copy, lock, hide, reorder
   *  or delete. */
  const select = (id: string) => {
    const current = menu;
    if (!current) return;
    switch (id) {
      case 'copy-price':
        if (current.price !== null) {
          const price = current.price;
          runMenuAction(() => copyPriceAt(price));
        } else {
          close();
        }
        break;
      case 'add-hline':
        if (current.price !== null) {
          // horizontalStraightLine is a 1-point overlay (totalStep 2,
          // bundle-verified): one point at the clicked price draws
          // the full-width line.
          const price = current.price;
          const timestamp = current.timestamp ?? Date.now();
          runMenuAction(() =>
            deps.actions.armHorizontalAt(timestamp, price),
          );
        } else {
          close();
        }
        break;
      case 'add-vline':
        if (current.timestamp !== null) {
          // verticalStraightLine is likewise 1-point: one point at
          // the clicked time (value = clicked price, unused by the
          // figure) draws the full-height line.
          const timestamp = current.timestamp;
          const value = current.price ?? 0;
          runMenuAction(() => deps.actions.armVerticalAt(timestamp, value));
        } else {
          close();
        }
        break;
      case 'reset-view':
        runMenuAction(() => deps.actions.resetView());
        break;
      case 'chart-settings':
        runMenuAction(() => deps.actions.openAppearanceSettings());
        break;
      case 'edit':
        if (current.selectedId) {
          const selectedId = current.selectedId;
          runMenuAction(() => deps.actions.openDialogFor(selectedId));
        } else {
          close();
        }
        break;
      case 'copy':
        runMenuAction(() => deps.actions.copySelected());
        break;
      case 'lock':
        runMenuAction(() => deps.actions.toggleLock(!current.locked));
        break;
      case 'hide':
        runMenuAction(() => deps.actions.toggleVisible(!current.visible));
        break;
      case 'front':
        runMenuAction(() => deps.actions.bringToFront());
        break;
      case 'back':
        runMenuAction(() => deps.actions.sendToBack());
        break;
      case 'delete':
        runMenuAction(() => deps.actions.deleteSelected());
        break;
      default:
        close();
        break;
    }
  };

  /** Container right-click: suppress the browser menu and open ours.
   *  The dialog-open and mid-drag guards live in open. */
  const handleContainerContextMenu = (e: {
    preventDefault: () => void;
    clientX: number;
    clientY: number;
  }) => {
    e.preventDefault();
    open(e.clientX, e.clientY);
  };

  /** Close the menu on any pointer press outside it (same pattern as
   *  the floating-bar popover effect). Presses on the chart itself
   *  land on the backdrop first; this covers the toolbar, watchlist
   *  and range bar. */
  const attachOutsideClose = () => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  };

  return {
    menuRef,
    getMenu: () => menu,
    open,
    close,
    select,
    handleContainerContextMenu,
    attachOutsideClose,
  };
}
