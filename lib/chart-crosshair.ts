/**
 * lib/chart-crosshair.ts — CrosshairController (MASTER TASK Phase 3 Step 1).
 *
 * Owns the crosshair hover state that used to live inline in
 * components/Chart.tsx (origin: Phase 1 step 2a/2b). Pure TypeScript,
 * no React: Chart holds a single instance in a ref and the init effect
 * forwards klinecharts' onCrosshairChange action to it; ChartLegend
 * subscribes to hover updates through it. A hover update therefore
 * re-renders only the legend subtree, never Chart.
 *
 * Behaviour is unchanged from the inline version:
 * - `publish` pushes to listeners only when the target actually
 *   changed (same candle + same OHLCV values = no-op).
 * - `schedule` coalesces bursts to at most one publish per animation
 *   frame.
 * - `clear` drops any pending publish and publishes an empty target.
 * - `handleCrosshairChange` resolves the hovered candle through
 *   convertFromPixel -> dataIndex into the loaded list (the action
 *   payload is only { x, y, paneId }, no kLineData).
 */
import type { Chart, Crosshair, KLineData } from 'klinecharts';

/**
 * Hover target published by the crosshair throttle (Phase 1 step 2a):
 * the candle under the crosshair, or null when the mouse is off the
 * chart. The index is into the chart's current data list.
 */
export interface HoverTarget {
  kline: KLineData | null;
  index: number | null;
}

export interface CrosshairController {
  /** Subscribe a hover listener; returns an unsubscribe function. */
  subscribe: (fn: (t: HoverTarget) => void) => () => void;
  /** Publish a hover target to listeners (deduped, see below). */
  publish: (target: HoverTarget) => void;
  /** Coalesce a hover target to at most one publish per animation frame. */
  schedule: (target: HoverTarget) => void;
  /** Drop any pending publish and publish an empty hover target. */
  clear: () => void;
  /**
   * klinecharts onCrosshairChange handler: resolve the hovered candle
   * and schedule it; clear when the crosshair leaves the chart.
   */
  handleCrosshairChange: (data?: unknown) => void;
  /** Current hover target (source of truth). */
  getHover: () => HoverTarget;
  /**
   * Cancel any pending rAF publish without publishing (unmount
   * cleanup). Never publishes, unlike `clear`.
   */
  dispose: () => void;
}

/**
 * Phase 1 step 2a — crosshair throttling. The hover target lives in
 * `hover` (source of truth); `publish` pushes it to the legend
 * listeners only when the target actually changed (same candle + same
 * OHLCV values = no-op), and `schedule` coalesces bursts to at most
 * one publish per animation frame. The init effect's
 * onCrosshairChange and the container's onMouseLeave are the only
 * callers.
 */
export function createCrosshairController(
  getChart: () => Chart | null,
): CrosshairController {
  let hover: HoverTarget = { kline: null, index: null };
  /** Pending hover target awaiting the next rAF publish. */
  let pendingHover: HoverTarget | null = null;
  /** In-flight rAF id for hover publishing (0 = none scheduled). */
  let hoverRaf = 0;
  /** Legend hover listeners (ChartLegend subscribes). */
  const listeners = new Set<(t: HoverTarget) => void>();

  const publish: CrosshairController['publish'] = (target) => {
    const prev = hover;
    if (
      target.index === prev.index &&
      target.kline?.timestamp === prev.kline?.timestamp &&
      target.kline?.open === prev.kline?.open &&
      target.kline?.high === prev.kline?.high &&
      target.kline?.low === prev.kline?.low &&
      target.kline?.close === prev.kline?.close &&
      target.kline?.volume === prev.kline?.volume
    ) {
      return;
    }
    hover = target;
    listeners.forEach((fn) => fn(target));
  };

  const schedule: CrosshairController['schedule'] = (target) => {
    pendingHover = target;
    if (hoverRaf !== 0) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const pending = pendingHover;
      pendingHover = null;
      if (pending) publish(pending);
    });
  };

  /** Mouse left the chart: drop any pending publish and clear hover. */
  const clear: CrosshairController['clear'] = () => {
    if (hoverRaf !== 0) {
      cancelAnimationFrame(hoverRaf);
      hoverRaf = 0;
    }
    pendingHover = null;
    publish({ kline: null, index: null });
  };

  const handleCrosshairChange: CrosshairController['handleCrosshairChange'] = (
    data?: unknown,
  ) => {
    const chart = getChart();
    const cross = data as Crosshair | undefined;
    if (cross?.x === undefined || chart === null) {
      clear();
      return;
    }
    const point = chart.convertFromPixel(
      [{ x: cross.x, y: cross.y ?? 0 }],
      cross.paneId ? { paneId: cross.paneId } : undefined,
    );
    const p = Array.isArray(point) ? point[0] : point;
    const list = chart.getDataList();
    const idx = p?.dataIndex;
    const valid = idx !== undefined && idx >= 0 && idx < list.length;
    schedule({
      kline: valid ? list[idx] : null,
      index: valid ? idx : null,
    });
  };

  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    publish,
    schedule,
    clear,
    handleCrosshairChange,
    getHover: () => hover,
    dispose: () => {
      if (hoverRaf !== 0) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = 0;
      }
      pendingHover = null;
    },
  };
}
