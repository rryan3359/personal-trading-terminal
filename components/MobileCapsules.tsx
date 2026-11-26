'use client';

/**
 * MobileCapsules.tsx — mobile-only (<md) capsules.
 *
 * Two pieces, split so the bottom capsules no longer overlay the
 * chart (Ryan's real-iPhone report 2026-11-26: they covered the
 * volume pane + time axis, could not be swiped, and the left rail's
 * bottom buttons were clipped by them):
 *
 *   MobileTopPill — the [symbol | interval] pill, an absolute
 *   overlay at the chart's top-left (unchanged position).
 *   MobileBottomBar (default export) — a real flex row BELOW the
 *   chart row (page.tsx renders it under the chart, above the
 *   home-indicator safe area): a flexible [symbol | interval]
 *   capsule on the left and a compact [ƒx | gear | ⋯] capsule on
 *   the right. Because it is a normal flex child, not an overlay,
 *   the chart's volume pane and time axis are fully visible. (The
 *   fixed left rail is gone on mobile since 2026-11-26 — the
 *   drawing tools float instead, see DrawingBar.)
 *
 * Swipe — round 1 (native non-passive touch + preventDefault +
 * touchcancel completes the swipe) passed CDP but STILL failed on
 * Ryan's real iPhone (16:42 screenshot: new layout live, swipe
 * dead). Re-diagnosis, 2026-11-26 round 2:
 *   1. Prime suspect — no `viewport-fit=cover` (layout.tsx had no
 *      viewport export): env(safe-area-inset-bottom) is 0 without
 *      it, so the bar's safe-area padding collapsed to 8px; and
 *      h-dvh can exceed the safe viewport, leaving the page
 *      scrollable by ~one safe-area height. Result: capsules half
 *      under the home indicator ("hanging outside the window") AND
 *      a scrollable page gives Safari a scroll gesture to claim.
 *      Fixed in layout.tsx (viewportFit: 'cover') + globals.css
 *      (overscroll-behavior: none) + a larger bottom margin here.
 *   2. Mechanism hardened anyway: Pointer Events + setPointerCapture
 *      + touch-action: none, threshold 30px -> 20px. Pointer events
 *      do not depend on the touch passive/preventDefault dance at
 *      all, and capture keeps the drag on the zone even when the
 *      finger slides off the 48px-tall capsule.
 *   3. Ground truth: ?debug-touch=1 shows a live overlay (window
 *      vs zone event counts, last dy, swipe count, scrollHeight vs
 *      innerHeight) — if it still fails on the real phone, Ryan's
 *      screenshot of the overlay tells us exactly where the gesture
 *      dies instead of another round of guessing.
 *
 * Swipe animation (2026-11-26, Ryan's real-iPhone report): the
 * swipe itself works (chart redraws), but the capsule value jumps
 * instantly, so he cannot see what he swiped to. The capsule text
 * now animates in the swipe direction on every value change
 * (Web Animations API in an effect — see animateCapsuleText):
 * swipe up slides the new value in from below, swipe down from
 * above, ~200ms; tap/sheet changes fade in ~150ms instead.
 *
 * All sheets are bottom sheets (backdrop + drag handle), mobile-only
 * (`md:hidden`), portalled to document.body. Nothing here renders on
 * desktop.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  CHART_TYPES,
  INDICATOR_OPTIONS,
  type ChartType,
} from '@/lib/chart-config';
import {
  INTERVAL_LABELS,
  SWIPE_INTERVALS,
  type Interval,
} from '@/lib/types';

/** Vertical swipe threshold (px) and tap threshold (px). 20px: the
 *  capsules are only 48px tall, so a natural flick on one is short;
 *  30px (round 1) could silently swallow real swipes. */
const SWIPE_MIN_DY = 20;
const TAP_MAX_MOVE = 10;
/** Magnifier preview: the first step needs the swipe threshold
 *  (20px), each further step 30px more of drag. */
const MAG_STEP_PX = 30;
/** Value `steps` away from `current` in a wrapping list (the
 *  magnifier preview cycles the watchlist / interval list). */
function cycleValue<T>(list: readonly T[], current: T, steps: number): T {
  const n = list.length;
  if (n === 0) return current;
  const i = list.indexOf(current);
  return list[(((i < 0 ? 0 : i) + steps) % n + n) % n];
}
/** A click arriving this soon after a swipe is the swipe's own
 *  synthetic click — swallow it so a swipe never also taps. */
const SWIPE_CLICK_GUARD_MS = 400;

/** Which bottom sheet is open (owned by page.tsx, shared by the
 *  pill and the bottom bar). */
export type MobileSheetKind = 'interval' | 'indicators' | 'more';

export interface MobileCapsulesProps {
  symbol: string;
  interval: Interval;
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onIntervalChange: (interval: Interval) => void;
  /** Open the watchlist drawer. */
  onOpenWatchlist: () => void;
  indicators: string[];
  onToggleIndicator: (name: string) => void;
  /** Open the chart appearance (chart settings) dialog. */
  onOpenAppearanceSettings: () => void;
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  /** Open the chart's object list panel. */
  onOpenObjectList: () => void;
  /** Undo the last drawing change (moved here from the removed
   *  mobile rail, Ryan 2026-11-26). */
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
  /** Restore the default chart view. */
  onResetView: () => void;
  /** Open bottom sheet, or null when none is open. */
  sheet: MobileSheetKind | null;
  onSheetChange: (sheet: MobileSheetKind | null) => void;
}

/** Proper cog: toothed ring + centre hole (same as Toolbar's
 *  GearIcon — a circle-and-spokes reads as a sun on phones). */
function GearIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="6" />
      <circle cx="10" cy="10" r="2.6" />
      <g fill="currentColor" stroke="none">
        <rect x="8.8" y="2" width="2.4" height="2.8" rx="0.6" />
        <rect x="8.8" y="15.2" width="2.4" height="2.8" rx="0.6" />
        <rect x="2" y="8.8" width="2.8" height="2.4" rx="0.6" />
        <rect x="15.2" y="8.8" width="2.8" height="2.4" rx="0.6" />
        <rect x="13.4" y="4.2" width="2.4" height="2.4" rx="0.6" transform="rotate(45 14.6 5.4)" />
        <rect x="4.2" y="4.2" width="2.4" height="2.4" rx="0.6" transform="rotate(45 5.4 5.4)" />
        <rect x="4.2" y="13.4" width="2.4" height="2.4" rx="0.6" transform="rotate(45 5.4 14.6)" />
        <rect x="13.4" y="13.4" width="2.4" height="2.4" rx="0.6" transform="rotate(45 14.6 14.6)" />
      </g>
    </svg>
  );
}

/** Horizontal "⋯". */
function DotsIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="4" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="16" cy="10" r="1.6" />
    </svg>
  );
}

/**
 * Bottom sheet (mobile). Backdrop tap or ✕ closes; Esc closes too.
 * Portalled to document.body so no ancestor clips it.
 */
function MobileSheet({
  title,
  testId,
  onClose,
  children,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-label={title}
      data-testid={testId}
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-[#2a2e39] bg-[#131722] px-4 pb-6 pt-2">
        <div
          className="mx-auto mb-1 h-1 w-10 rounded-full bg-[#2a2e39]"
          aria-hidden="true"
        />
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-white">{title}</span>
          <button
            onClick={onClose}
            aria-label="關閉"
            className="flex h-8 w-8 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Touch/pointer diagnostic (?debug-touch=1). A module-level store so
 * the native listeners (which live outside React) can record into it
 * and the overlay can read it via useSyncExternalStore. Counters are
 * cheap integers, recorded always; the overlay only renders when the
 * URL param is present, so normal use is unaffected.
 *
 * Reading it on a real phone answers, in order:
 *   win T/P counts stay 0 while swiping  -> the gesture never reaches
 *     the page at all (browser/OS level).
 *   win counts rise, zone P counts stay 0 -> the zone is not the
 *     touch target (something covers it / wrong element).
 *   zone P counts rise, swipes stay 0    -> threshold / direction
 *     logic, or pointercancel before pointerup.
 *   scrollH > innerH or scrollY > 0      -> the page scrolls, and
 *     Safari has a scroll gesture to claim.
 */
interface ZoneDebug {
  /** pointerdown / move / up / cancel on this zone. */
  pd: number;
  pm: number;
  pu: number;
  pc: number;
  /** Last move dy (px, signed), whether the drag was claimed. */
  lastDy: number | null;
  claimed: boolean;
  /** Swipes actually fired, and the last direction. */
  swipes: number;
  lastSwipe: string;
  /** Tag of the last pointerdown target. */
  lastTarget: string;
}
interface TouchDebugState {
  win: {
    ts: number;
    tm: number;
    te: number;
    tc: number;
    pd: number;
    pm: number;
    pu: number;
    pc: number;
    lastTarget: string;
  };
  symbol: ZoneDebug;
  interval: ZoneDebug;
  scroll: { events: number; maxY: number };
  geo: {
    scrollH: number;
    innerH: number;
    visualH: number;
    scrollY: number;
    barPadBottom: string;
  };
}
const zeroZone = (): ZoneDebug => ({
  pd: 0,
  pm: 0,
  pu: 0,
  pc: 0,
  lastDy: null,
  claimed: false,
  swipes: 0,
  lastSwipe: '-',
  lastTarget: '-',
});
const touchDebugState: TouchDebugState = {
  win: {
    ts: 0,
    tm: 0,
    te: 0,
    tc: 0,
    pd: 0,
    pm: 0,
    pu: 0,
    pc: 0,
    lastTarget: '-',
  },
  symbol: zeroZone(),
  interval: zeroZone(),
  scroll: { events: 0, maxY: 0 },
  geo: { scrollH: 0, innerH: 0, visualH: 0, scrollY: 0, barPadBottom: '-' },
};
let touchDebugVersion = 0;
const touchDebugListeners = new Set<() => void>();
function touchDebugEmit() {
  touchDebugVersion += 1;
  touchDebugListeners.forEach((fn) => fn());
}
function touchDebugSubscribe(fn: () => void) {
  touchDebugListeners.add(fn);
  return () => {
    touchDebugListeners.delete(fn);
  };
}
function touchDebugSnapshot() {
  return touchDebugVersion;
}
function targetLabel(t: EventTarget | null): string {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return 'none';
  const tid =
    typeof el.getAttribute === 'function'
      ? el.getAttribute('data-testid')
      : null;
  return el.tagName.toLowerCase() + (tid ? `#${tid}` : '');
}

/**
 * Live diagnostic overlay (gated by ?debug-touch=1, mobile only).
 * pointer-events-none so it can never eat a touch itself.
 */
function TouchDebugOverlay() {
  useSyncExternalStore(touchDebugSubscribe, touchDebugSnapshot);
  const s = touchDebugState;
  return (
    <div
      className="pointer-events-none fixed left-2 top-16 z-[60] max-w-[calc(100vw-1rem)] rounded-lg bg-black/85 p-2 font-mono text-[10px] leading-relaxed text-[#7ee787] md:hidden"
      data-testid="touch-debug-overlay"
    >
      <div className="font-bold text-white">touch-debug ?debug-touch=1</div>
      <div>
        win T {s.win.ts}/{s.win.tm}/{s.win.te}/{s.win.tc} P{' '}
        {s.win.pd}/{s.win.pm}/{s.win.pu}/{s.win.pc}
      </div>
      <div>win target: {s.win.lastTarget}</div>
      <div>
        sym P {s.symbol.pd}/{s.symbol.pm}/{s.symbol.pu}/{s.symbol.pc} dy=
        {s.symbol.lastDy ?? '-'} claim={s.symbol.claimed ? 'Y' : 'n'} sw=
        {s.symbol.swipes} {s.symbol.lastSwipe}
      </div>
      <div>
        int P {s.interval.pd}/{s.interval.pm}/{s.interval.pu}/{s.interval.pc}{' '}
        dy={s.interval.lastDy ?? '-'} claim={s.interval.claimed ? 'Y' : 'n'}{' '}
        sw={s.interval.swipes} {s.interval.lastSwipe}
      </div>
      <div>
        scrollH {s.geo.scrollH} innerH {s.geo.innerH} visH {s.geo.visualH}{' '}
        scrollY {s.geo.scrollY} scrollEv {s.scroll.events} maxY{' '}
        {s.scroll.maxY}
      </div>
      <div>bar padB {s.geo.barPadBottom}</div>
    </div>
  );
}

/**
 * Pointer-events vertical swipe for one zone. Swipe up calls onUp,
 * swipe down calls onDown; a short move (< 10px) is a tap and the
 * click goes through untouched. A swipe's synthetic click is
 * swallowed in the capture phase so a swipe never also taps.
 *
 * Why pointer events (round 2): they do not depend on the touch
 * passive/preventDefault dance at all. With touch-action: none on
 * the zone and the inner button, the browser takes no default
 * gesture; setPointerCapture keeps the drag on the zone even when
 * the finger slides off the 48px-tall capsule; pointercancel
 * completes the swipe from the last move position instead of
 * dropping it. Native listeners (not React synthetic ones): React
 * attaches touch handlers as passive at the root, and pointer
 * handlers attached here run on the element itself.
 */
function usePointerSwipe(
  ref: React.RefObject<HTMLDivElement | null>,
  debugKey: 'symbol' | 'interval',
  {
    onSwipeUp,
    onSwipeDown,
    onDrag,
    onEnd,
  }: {
    onSwipeUp: () => void;
    onSwipeDown: () => void;
    /** Live drag offset (px, signed) while the finger is down —
     *  drives the magnifier preview. */
    onDrag?: (dy: number) => void;
    /** Always fired when the gesture ends (release or cancel) —
     *  hides the magnifier. */
    onEnd?: () => void;
  },
) {
  const lastSwipeAt = useRef(0);
  // Latest callbacks for the once-attached native listeners.
  const cbRef = useRef({ onSwipeUp, onSwipeDown, onDrag, onEnd });
  useEffect(() => {
    cbRef.current = { onSwipeUp, onSwipeDown, onDrag, onEnd };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dbg = touchDebugState[debugKey];
    let start: { x: number; y: number; id: number } | null = null;
    let claimed = false;
    const onPointerDown = (e: PointerEvent) => {
      if (start) return; // one finger at a time
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already gone; the drag still tracks by pointerId.
      }
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      claimed = false;
      dbg.pd += 1;
      dbg.lastTarget = targetLabel(e.target);
      touchDebugEmit();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      dbg.pm += 1;
      dbg.lastDy = Math.round(dy);
      if (
        !claimed &&
        Math.abs(dy) > TAP_MAX_MOVE &&
        Math.abs(dy) > Math.abs(dx)
      ) {
        claimed = true;
      }
      dbg.claimed = claimed;
      cbRef.current.onDrag?.(dy);
      touchDebugEmit();
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      const s = start;
      start = null;
      if (cancelled) dbg.pc += 1;
      else dbg.pu += 1;
      if (!s) {
        touchDebugEmit();
        return;
      }
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      // Final position first: the magnifier preview matches the
      // release point, so what he sees is what the swipe commits.
      cbRef.current.onDrag?.(dy);
      if (Math.abs(dy) >= SWIPE_MIN_DY && Math.abs(dy) > Math.abs(dx)) {
        lastSwipeAt.current = Date.now();
        dbg.swipes += 1;
        dbg.lastSwipe = dy < 0 ? 'up' : 'down';
        if (dy < 0) cbRef.current.onSwipeUp();
        else cbRef.current.onSwipeDown();
      }
      // < TAP_MAX_MOVE total movement = a tap: the click proceeds.
      cbRef.current.onEnd?.();
      touchDebugEmit();
    };
    const onPointerUp = (e: PointerEvent) => finish(e, false);
    // pointercancel (browser taking the gesture, an alert, …) still
    // completes the swipe from the last move position instead of
    // silently dropping it.
    const onPointerCancel = (e: PointerEvent) => finish(e, true);
    // Capture-phase click guard: eat the synthetic click that
    // follows a swipe, so a swipe never also taps.
    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() - lastSwipeAt.current < SWIPE_CLICK_GUARD_MS) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('click', onClickCapture, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('click', onClickCapture, { capture: true });
    };
  }, [ref, debugKey]);
}

const CAPSULE_BG = 'border border-[#2a2e39] bg-[#131722]/90 shadow-lg backdrop-blur';

/**
 * Animate a capsule's text when its value changes. Swipe up slides
 * the new value in from below, swipe down from above (~200ms,
 * ease-out); a change with no swipe direction (tap, bottom sheet)
 * fades in (~150ms). Web Animations API, applied imperatively:
 * the swipe handler records the direction in a ref before the
 * parent state update lands, and the effect consumes it — no
 * remount/class juggling, so a later re-render can never replay
 * the animation. The element needs `inline-block` for the
 * translate to apply.
 */
function animateCapsuleText(
  el: HTMLElement | null,
  dir: 'up' | 'down' | null,
) {
  if (!el) return;
  if (dir === null) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 150,
      easing: 'ease-out',
    });
    return;
  }
  const from = dir === 'up' ? '100%' : '-100%';
  el.animate(
    [
      { transform: `translateY(${from})`, opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    { duration: 200, easing: 'ease-out' },
  );
}

/**
 * Top-left pill: [symbol | interval], an absolute overlay at the
 * chart's top-left. Tap the symbol to open the watchlist drawer;
 * tap the interval to open the interval sheet. Rendered inside the
 * chart container by page.tsx; unchanged position.
 */
export function MobileTopPill({
  symbol,
  interval,
  onOpenWatchlist,
  onOpenIntervalSheet,
}: {
  symbol: string;
  interval: Interval;
  onOpenWatchlist: () => void;
  onOpenIntervalSheet: () => void;
}) {
  return (
    <div
      className={`absolute left-2 top-2 z-20 flex items-center gap-2 rounded-full px-2.5 py-1.5 md:hidden ${CAPSULE_BG}`}
      data-testid="mobile-top-pill"
    >
      <button
        onClick={onOpenWatchlist}
        aria-label={`切換標的，目前 ${symbol}`}
        data-testid="mobile-top-symbol"
        className="flex items-center gap-1.5"
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2a2e39] text-[11px] font-bold text-white"
          aria-hidden="true"
        >
          {symbol.charAt(0)}
        </span>
        <span className="text-sm font-semibold text-white">{symbol}</span>
      </button>
      <span className="h-4 w-px bg-[#2a2e39]" aria-hidden="true" />
      <button
        onClick={onOpenIntervalSheet}
        aria-label={`切換週期，目前 ${INTERVAL_LABELS[interval]}`}
        data-testid="mobile-top-interval"
        className="text-sm font-medium text-[#2962ff]"
      >
        {INTERVAL_LABELS[interval]}
      </button>
    </div>
  );
}

/**
 * Mobile bottom bar: a real flex row below the chart (page.tsx
 * renders it under the chart row). Left capsule [symbol | interval]
 * is flexible width, both zones vertically swipeable; right capsule
 * [ƒx | gear | ⋯] is compact. The bar's bottom padding is the
 * home-indicator safe area plus a margin (viewport-fit=cover makes
 * the env() real), so the capsules sit fully inside the visible
 * area, never under the home indicator. Hidden on desktop (md:hidden).
 */
export default function MobileBottomBar({
  symbol,
  interval,
  watchlist,
  onSelectSymbol,
  onIntervalChange,
  onOpenWatchlist,
  indicators,
  onToggleIndicator,
  onOpenAppearanceSettings,
  chartType,
  onChartTypeChange,
  onOpenObjectList,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onResetView,
  sheet,
  onSheetChange,
}: MobileCapsulesProps) {
  // Swipe direction for the capsule-text animation, captured by
  // cycleSymbol/cycleInterval when the value actually changes and
  // consumed by the effects below. Refs, not state: the animation
  // must fire exactly once per value change, never on re-render.
  const symbolDirRef = useRef<'up' | 'down' | null>(null);
  const intervalDirRef = useRef<'up' | 'down' | null>(null);
  const symbolTextRef = useRef<HTMLSpanElement | null>(null);
  const intervalTextRef = useRef<HTMLSpanElement | null>(null);
  // Skip the mount commit: the capsule must not fade in on load.
  const symbolMountedRef = useRef(false);
  const intervalMountedRef = useRef(false);

  const cycleSymbol = (dir: 1 | -1) => {
    if (watchlist.length === 0) return;
    const i = watchlist.indexOf(symbol);
    const next =
      watchlist[
        (((i < 0 ? 0 : i) + dir) % watchlist.length + watchlist.length) %
        watchlist.length
      ];
    if (next !== symbol) {
      symbolDirRef.current = dir === 1 ? 'up' : 'down';
      onSelectSymbol(next);
    }
  };
  const cycleInterval = (dir: 1 | -1) => {
    const i = SWIPE_INTERVALS.indexOf(interval);
    const next =
      SWIPE_INTERVALS[
        (((i < 0 ? 0 : i) + dir) % SWIPE_INTERVALS.length +
          SWIPE_INTERVALS.length) %
        SWIPE_INTERVALS.length
      ];
    if (next !== interval) {
      intervalDirRef.current = dir === 1 ? 'up' : 'down';
      onIntervalChange(next);
    }
  };

  /** Magnifier preview while a capsule zone is being dragged (Ryan
   *  2026-11-26: the finger covers the capsule, so the value is
   *  invisible mid-swipe). The bubble floats above the bar with a
   *  3-row mini wheel — previous / preview / next, preview large —
   *  like TradingView's old vertical interval picker. The preview
   *  is what a release commits, so what he sees is what he gets.
   *  State drives the bubble; the ref is what the swipe commit
   *  reads (it is set synchronously on every drag move). */
  const [magnifier, setMagnifier] = useState<{
    zone: 'symbol' | 'interval';
    previewId: string;
    step: number;
  } | null>(null);
  const magRef = useRef<{
    zone: 'symbol' | 'interval';
    previewId: string;
    step: number;
  } | null>(null);

  /** Preview value for a drag offset: no step until the swipe
   *  threshold, then one step per 30px of drag. Null while the
   *  drag is still a tap (<= 10px). */
  const previewFor = (
    zone: 'symbol' | 'interval',
    dy: number,
  ): { previewId: string; step: number } | null => {
    if (Math.abs(dy) <= TAP_MAX_MOVE) return null;
    const step =
      dy <= -SWIPE_MIN_DY
        ? 1 + Math.floor((-dy - SWIPE_MIN_DY) / MAG_STEP_PX)
        : dy >= SWIPE_MIN_DY
          ? -(1 + Math.floor((dy - SWIPE_MIN_DY) / MAG_STEP_PX))
          : 0;
    const previewId =
      zone === 'symbol'
        ? cycleValue(watchlist, symbol, step)
        : cycleValue(SWIPE_INTERVALS, interval, step);
    return { previewId, step };
  };

  const onZoneDrag =
    /* eslint-disable react-hooks/refs -- onZoneDrag is only ever
       invoked from the native pointer handlers in usePointerSwipe
       (via its cbRef), never during render. The ref is the
       synchronous channel between the drag preview and the swipe
       commit: the final onDrag and the swipe run inside one
       pointerup handler, so state would still be stale there. */
    (zone: 'symbol' | 'interval') => (dy: number) => {
      const next = previewFor(zone, dy);
      const prev = magRef.current;
      if (next === null) {
        if (prev !== null) {
          magRef.current = null;
          setMagnifier(null);
        }
        return;
      }
      if (
        prev === null ||
        prev.zone !== zone ||
        prev.previewId !== next.previewId
      ) {
        const m = { zone, previewId: next.previewId, step: next.step };
        magRef.current = m;
        setMagnifier(m);
      }
    };
  /* eslint-enable react-hooks/refs */
  const onZoneEnd = () => {
    if (magRef.current !== null) {
      magRef.current = null;
      setMagnifier(null);
    }
  };

  /** Commit the magnifier preview on swipe release (true when it
   *  committed — the caller then skips the single-step cycle). The
   *  slide animation direction follows the preview's step sign. */
  const commitSymbolPreview = (): boolean => {
    const m = magRef.current;
    if (m && m.zone === 'symbol' && m.previewId !== symbol) {
      symbolDirRef.current = m.step >= 0 ? 'up' : 'down';
      onSelectSymbol(m.previewId);
      return true;
    }
    return false;
  };
  const commitIntervalPreview = (): boolean => {
    const m = magRef.current;
    if (m && m.zone === 'interval' && m.previewId !== interval) {
      intervalDirRef.current = m.step >= 0 ? 'up' : 'down';
      onIntervalChange(m.previewId as Interval);
      return true;
    }
    return false;
  };

  // 3-row mini wheel for the bubble: neighbours of the preview.
  const magView =
    magnifier === null
      ? null
      : magnifier.zone === 'symbol'
        ? {
            label: '標的',
            prev: cycleValue(watchlist, magnifier.previewId, -1),
            current: magnifier.previewId,
            next: cycleValue(watchlist, magnifier.previewId, 1),
          }
        : {
            label: '週期',
            prev: INTERVAL_LABELS[
              cycleValue(
                SWIPE_INTERVALS,
                magnifier.previewId as Interval,
                -1,
              )
            ],
            current:
              INTERVAL_LABELS[magnifier.previewId as Interval],
            next: INTERVAL_LABELS[
              cycleValue(
                SWIPE_INTERVALS,
                magnifier.previewId as Interval,
                1,
              )
            ],
          };

  // Animate the capsule text on value change (direction from the
  // swipe that caused it, fade when it came from a tap/sheet).
  useEffect(() => {
    if (!symbolMountedRef.current) {
      symbolMountedRef.current = true;
      return;
    }
    const dir = symbolDirRef.current;
    symbolDirRef.current = null;
    animateCapsuleText(symbolTextRef.current, dir);
  }, [symbol]);
  useEffect(() => {
    if (!intervalMountedRef.current) {
      intervalMountedRef.current = true;
      return;
    }
    const dir = intervalDirRef.current;
    intervalDirRef.current = null;
    animateCapsuleText(intervalTextRef.current, dir);
  }, [interval]);

  const closeSheet = () => onSheetChange(null);

  const symbolZoneRef = useRef<HTMLDivElement | null>(null);
  const intervalZoneRef = useRef<HTMLDivElement | null>(null);
  usePointerSwipe(symbolZoneRef, 'symbol', {
    onSwipeUp: () => {
      if (!commitSymbolPreview()) cycleSymbol(1);
    },
    onSwipeDown: () => {
      if (!commitSymbolPreview()) cycleSymbol(-1);
    },
    onDrag: onZoneDrag('symbol'),
    onEnd: onZoneEnd,
  });
  usePointerSwipe(intervalZoneRef, 'interval', {
    onSwipeUp: () => {
      if (!commitIntervalPreview()) cycleInterval(1);
    },
    onSwipeDown: () => {
      if (!commitIntervalPreview()) cycleInterval(-1);
    },
    onDrag: onZoneDrag('interval'),
    onEnd: onZoneEnd,
  });

  // Touch diagnostic overlay, gated by ?debug-touch=1 (read once on
  // mount, client-only — useSearchParams would need a Suspense
  // boundary). Off by default: nothing renders, nothing listens.
  const [debugTouch, setDebugTouch] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount
     sync from the URL query string (an external system); a lazy
     initializer would read window during SSR and mismatch hydration. */
  useEffect(() => {
    setDebugTouch(
      new URLSearchParams(window.location.search).get('debug-touch') ===
        '1',
    );
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Window-level counters + scroll/page-geometry sampling while the
  // overlay is on (all listeners passive; they only observe).
  useEffect(() => {
    if (!debugTouch) return;
    const w = touchDebugState.win;
    const onTs = (e: TouchEvent) => {
      w.ts += 1;
      w.lastTarget = targetLabel(e.target);
      touchDebugEmit();
    };
    const onTm = () => {
      w.tm += 1;
      touchDebugEmit();
    };
    const onTe = () => {
      w.te += 1;
      touchDebugEmit();
    };
    const onTc = () => {
      w.tc += 1;
      touchDebugEmit();
    };
    const onPd = (e: PointerEvent) => {
      w.pd += 1;
      w.lastTarget = targetLabel(e.target);
      touchDebugEmit();
    };
    const onPm = () => {
      w.pm += 1;
      touchDebugEmit();
    };
    const onPu = () => {
      w.pu += 1;
      touchDebugEmit();
    };
    const onPc = () => {
      w.pc += 1;
      touchDebugEmit();
    };
    const onScroll = () => {
      touchDebugState.scroll.events += 1;
      touchDebugState.scroll.maxY = Math.max(
        touchDebugState.scroll.maxY,
        window.scrollY,
      );
      touchDebugEmit();
    };
    const sampleGeo = () => {
      const bar = document.querySelector(
        '[data-testid="mobile-bottom-bar"]',
      );
      touchDebugState.geo = {
        scrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
        visualH: window.visualViewport
          ? Math.round(window.visualViewport.height)
          : 0,
        scrollY: Math.round(window.scrollY),
        barPadBottom: bar ? getComputedStyle(bar).paddingBottom : '-',
      };
    };
    sampleGeo();
    const geoTimer = window.setInterval(() => {
      sampleGeo();
      touchDebugEmit();
    }, 500);
    window.addEventListener('touchstart', onTs, { passive: true });
    window.addEventListener('touchmove', onTm, { passive: true });
    window.addEventListener('touchend', onTe, { passive: true });
    window.addEventListener('touchcancel', onTc, { passive: true });
    window.addEventListener('pointerdown', onPd, { passive: true });
    window.addEventListener('pointermove', onPm, { passive: true });
    window.addEventListener('pointerup', onPu, { passive: true });
    window.addEventListener('pointercancel', onPc, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearInterval(geoTimer);
      window.removeEventListener('touchstart', onTs);
      window.removeEventListener('touchmove', onTm);
      window.removeEventListener('touchend', onTe);
      window.removeEventListener('touchcancel', onTc);
      window.removeEventListener('pointerdown', onPd);
      window.removeEventListener('pointermove', onPm);
      window.removeEventListener('pointerup', onPu);
      window.removeEventListener('pointercancel', onPc);
      window.removeEventListener('scroll', onScroll);
    };
  }, [debugTouch]);

  return (
    <>
      {/* The fixed left rail is gone on mobile (Ryan 2026-11-26 —
          the drawing tools float instead), so the bar spans the full
          width. Bottom padding is the safe area PLUS a margin: with
          viewport-fit=cover the env() is real (34px on Face ID
          iPhones), and the extra 0.75rem keeps the capsules visibly
          inside the viewport — round 1's 8px left them hugging the
          bottom edge, half under the home indicator. pt-2.5 keeps
          them off the chart above. Both capsules are h-12 (48px) so
          their tops and bottoms align; round 1 had 42px vs 50px. */}
      <div
        className="relative flex shrink-0 items-center gap-2 pl-2 pr-2 pt-2.5 md:hidden"
        style={{
          paddingBottom:
            'max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))',
        }}
        data-testid="mobile-bottom-bar"
      >
        {/* Magnifier: floats above the bar while a capsule zone is
            being dragged (the finger covers the capsule itself).
            pointer-events-none so it can never eat a touch. */}
        {magView && (
          <div
            className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 -translate-x-1/2 rounded-2xl border border-[#2a2e39] bg-[#131722]/95 px-4 py-2 text-center shadow-2xl backdrop-blur"
            data-testid="capsule-magnifier"
          >
            <div className="text-[10px] font-medium tracking-wide text-[#787b86]">
              {magView.label}
            </div>
            <div className="text-xs leading-5 text-[#787b86]">
              {magView.prev}
            </div>
            <div className="text-xl font-bold leading-7 text-white">
              {magView.current}
            </div>
            <div className="text-xs leading-5 text-[#787b86]">
              {magView.next}
            </div>
          </div>
        )}
        {/* Bottom-left capsule: symbol | interval, both swipeable. */}
        <div
          className={`flex h-12 min-w-0 flex-1 items-stretch overflow-hidden rounded-full ${CAPSULE_BG}`}
          data-testid="mobile-bottom-capsule"
        >
          <div
            ref={symbolZoneRef}
            style={{ touchAction: 'none' }}
            className="flex h-full min-w-0 flex-1 items-center"
            data-testid="mobile-symbol-zone"
          >
            <button
              onClick={onOpenWatchlist}
              aria-label={`切換標的，目前 ${symbol}（上下滑動切換）`}
              style={{ touchAction: 'none' }}
              className="flex h-full w-full items-center px-3 text-sm font-semibold text-white"
            >
              <span
                ref={symbolTextRef}
                className="inline-block truncate"
              >
                {symbol}
              </span>
            </button>
          </div>
          <span className="w-px shrink-0 bg-[#2a2e39]" aria-hidden="true" />
          <div
            ref={intervalZoneRef}
            style={{ touchAction: 'none' }}
            className="flex h-full shrink-0 items-center"
            data-testid="mobile-interval-zone"
          >
            <button
              onClick={() => onSheetChange('interval')}
              aria-label={`切換週期，目前 ${INTERVAL_LABELS[interval]}（上下滑動切換）`}
              style={{ touchAction: 'none' }}
              className="flex h-full items-center px-3 text-sm font-medium text-white"
            >
              <span ref={intervalTextRef} className="inline-block">
                {INTERVAL_LABELS[interval]}
              </span>
            </button>
          </div>
        </div>

        {/* Bottom-right capsule: indicators + chart settings + more. */}
        <div
          className={`flex h-12 shrink-0 items-center gap-0.5 rounded-full px-1.5 ${CAPSULE_BG}`}
          data-testid="mobile-actions-capsule"
        >
          <button
            onClick={() => onSheetChange('indicators')}
            title="指標"
            aria-label="指標"
            data-testid="mobile-indicators-btn"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-semibold italic text-[#b2b5be] hover:bg-[#1e222d] hover:text-white"
          >
            ƒx
          </button>
          <button
            onClick={onOpenAppearanceSettings}
            title="圖表設定"
            aria-label="圖表設定"
            data-testid="mobile-appearance-btn"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#b2b5be] hover:bg-[#1e222d] hover:text-white"
          >
            <GearIcon />
          </button>
          <button
            onClick={() => onSheetChange('more')}
            title="更多"
            aria-label="更多"
            data-testid="mobile-more-btn"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#b2b5be] hover:bg-[#1e222d] hover:text-white"
          >
            <DotsIcon />
          </button>
        </div>
      </div>

      {debugTouch && <TouchDebugOverlay />}

      {sheet === 'interval' && (
        <MobileSheet
          title="週期"
          testId="mobile-interval-sheet"
          onClose={closeSheet}
        >
          <div className="grid grid-cols-5 gap-1.5">
            {SWIPE_INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => {
                  onIntervalChange(iv);
                  closeSheet();
                }}
                data-testid={`interval-option-${iv}`}
                className={`rounded-md border py-2.5 text-sm ${
                  iv === interval
                    ? 'border-[#2962ff]/50 bg-[#2962ff]/20 font-semibold text-[#2962ff]'
                    : 'border-[#2a2e39] bg-[#1e222d] text-[#d1d4dc]'
                }`}
              >
                {INTERVAL_LABELS[iv]}
              </button>
            ))}
          </div>
        </MobileSheet>
      )}

      {sheet === 'indicators' && (
        <MobileSheet
          title="指標"
          testId="mobile-indicators-sheet"
          onClose={closeSheet}
        >
          {INDICATOR_OPTIONS.map((ind) => {
            const on = indicators.includes(ind.id);
            return (
              <button
                key={ind.id}
                onClick={() => onToggleIndicator(ind.id)}
                data-testid={`indicator-option-${ind.id}`}
                className="flex w-full items-center gap-2 border-b border-[#2a2e39] px-1 py-3 text-left text-sm text-[#d1d4dc] last:border-b-0"
              >
                <span className="w-4 shrink-0 text-[#2962ff]">
                  {on ? '✓' : ''}
                </span>
                {ind.label}
              </button>
            );
          })}
        </MobileSheet>
      )}

      {sheet === 'more' && (
        <MobileSheet title="更多" testId="mobile-more-sheet" onClose={closeSheet}>
          <div className="mb-1 text-[11px] font-medium text-[#787b86]">
            圖表類型
          </div>
          <div className="mb-3 flex gap-1.5">
            {CHART_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onChartTypeChange(t.id);
                  closeSheet();
                }}
                data-testid={`chart-type-option-${t.id}`}
                className={`flex-1 rounded-md border py-2.5 text-sm ${
                  t.id === chartType
                    ? 'border-[#2962ff]/50 bg-[#2962ff]/20 font-semibold text-[#2962ff]'
                    : 'border-[#2a2e39] bg-[#1e222d] text-[#d1d4dc]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {[
            {
              id: 'object-list',
              label: '物件清單',
              disabled: false,
              action: () => {
                onOpenObjectList();
                closeSheet();
              },
            },
            {
              id: 'undo',
              label: '復原',
              disabled: !canUndo,
              action: () => {
                onUndo();
                closeSheet();
              },
            },
            {
              id: 'redo',
              label: '重做',
              disabled: !canRedo,
              action: () => {
                onRedo();
                closeSheet();
              },
            },
            {
              id: 'reset-view',
              label: '重設檢視',
              disabled: false,
              action: () => {
                onResetView();
                closeSheet();
              },
            },
            {
              id: 'watchlist',
              label: '自選清單',
              disabled: false,
              action: () => {
                onOpenWatchlist();
                closeSheet();
              },
            },
          ].map((row) => (
            <button
              key={row.id}
              onClick={row.action}
              disabled={row.disabled}
              data-testid={`more-${row.id}`}
              className="flex w-full items-center border-b border-[#2a2e39] px-1 py-3 text-left text-sm text-[#d1d4dc] last:border-b-0 disabled:opacity-30"
            >
              {row.label}
            </button>
          ))}
        </MobileSheet>
      )}
    </>
  );
}
