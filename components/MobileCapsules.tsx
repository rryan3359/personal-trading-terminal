'use client';

/**
 * MobileCapsules.tsx — mobile-only (<md) capsules.
 *
 * Two pieces, split so the bottom capsules no longer overlay the
 * chart (Ryan's real-iPhone report 2026-11-26: they covered the
 * volume pane + time axis, could not be swiped, and the left rail's
 * bottom buttons were clipped by them):
 *
 *   MobileTopBar — TV-style top bar, an absolute overlay across
 *   the chart's top: left [icon symbol | green dot interval
 *   badge], right circular chevron to collapse / expand it.
 *   MobileBottomBar (default export) — a real flex row BELOW the
 *   chart row (page.tsx renders it under the chart, above the
 *   home-indicator safe area): a TV-proportioned [symbol |
 *   interval] capsule on the left (symbol wider, interval in its
 *   own centred zone) plus three separate circular buttons
 *   (brush / indicators / ⋯). Because it is a normal flex child,
 *   not an overlay, the chart's volume pane and time axis are
 *   fully visible. (The fixed left rail is gone on mobile since
 *   2026-11-26 — the drawing tools float instead, see
 *   DrawingBar.)
 *
 * Overlays (all mobile-only, `md:hidden`, portalled to
 * document.body):
 *   Centre lists — tapping a capsule zone (or the top bar) floats
 *   a rounded list over the chart centre (TV-style, f_001/f_002):
 *   symbol list (watchlist + stock watchlist) and interval list
 *   (favourite intervals only, with a 管理收藏週期 mode that
 *   stars all 14). Selected row = light-grey pill.
 *   Bottom sheets — indicators list and the 分析中心 (was 更多):
 *   a TV-style grid (版面設定 / 管理 ICT / 圖表設定 / 新 / 儲存
 *   / 開啟, then a 工具 section). Cells that map to an existing
 *   feature open it; unbuilt ones (比較 / 快訊 / K線重播 / 版面
 *   設定 / 管理 ICT / 新） show a 尚未支援 toast instead of
 *   faking the feature. 儲存／開啟 use the localStorage layouts
 *   in lib/store.ts (ptt:layouts); no broker button anywhere,
 *   no TV logo anywhere.
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
 * Overlays are mobile-only (`md:hidden`), portalled to
 * document.body. Nothing here renders on desktop.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  INDICATOR_OPTIONS,
  type ChartType,
} from '@/lib/chart-config';
import {
  INTERVAL_LABELS,
  SWIPE_INTERVALS,
  type Interval,
} from '@/lib/types';
import type { SavedLayout } from '@/lib/store';
import CryptoIcon from '@/components/CryptoIcon';
import { baseAssetOf } from '@/lib/crypto-icons';

/** Vertical swipe threshold (px) and tap threshold (px). 30px:
 *  Ryan 2026-11-27 asked for lower sensitivity — the swipe was
 *  too twitchy (a short drag flew through several values). */
const SWIPE_MIN_DY = 30;
const TAP_MAX_MOVE = 10;
/** Swipe preview: the first step needs the swipe threshold
 *  (30px), each further step 50px more of drag. 100px of drag is
 *  now ~2 steps, where 20px/30px used to give ~3. */
const MAG_STEP_PX = 50;
/** Finger-follow cap (px): the capsule text translates 1:1 with the
 *  drag while swiping, clamped so it never slides fully out of the
 *  48px capsule — the swipe preview list carries the value. */
const FOLLOW_MAX_PX = 26;
/** Smoother switch easing (easeOutQuint-ish): the old plain
 *  ease-out 200ms felt abrupt/janky (Ryan 2026-11-27). */
const SMOOTH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Default favourite intervals (Ryan 2026-11-27): swiping the
 *  interval zone only walks these; the full 14 stay in the sheet. */
const DEFAULT_FAVORITE_INTERVALS: Interval[] = ['15m', '1h', '4h', '1d'];
const FAVORITE_INTERVALS_KEY = 'ptt:favorite-intervals';
/** Stored favourites, or null when the key was never written (use
 *  the defaults). An explicitly stored empty list is returned as
 *  [] — the caller falls back to the full list then. */
function loadFavoriteIntervals(): Interval[] | null {
  try {
    const raw = window.localStorage.getItem(FAVORITE_INTERVALS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (v): v is Interval =>
        typeof v === 'string' &&
        (SWIPE_INTERVALS as string[]).includes(v),
    );
  } catch {
    return null;
  }
}
/** Value `steps` away from `current` in a wrapping list (the
 *  magnifier preview cycles the watchlist / interval list). */
function cycleValue<T>(list: readonly T[], current: T, steps: number): T {
  const n = list.length;
  if (n === 0) return current;
  const i = list.indexOf(current);
  return list[(((i < 0 ? 0 : i) + steps) % n + n) % n];
}
/** Persist the favourite intervals (empty array is a real value:
 *  swiping then falls back to the full list). */
function saveFavoriteIntervals(ids: Interval[]): void {
  try {
    window.localStorage.setItem(
      FAVORITE_INTERVALS_KEY,
      JSON.stringify(ids),
    );
  } catch {
    // Storage full / unavailable (private mode) — non-fatal.
  }
}
/** A click arriving this soon after a swipe is the swipe's own
 *  synthetic click — swallow it so a swipe never also taps. */
const SWIPE_CLICK_GUARD_MS = 400;

/** Which overlay is open (owned by page.tsx, shared by the top bar
 *  and the bottom bar). 'symbol' / 'interval' are the TV-style
 *  centre-floating lists; 'indicators' is the bottom sheet;
 *  'analysis' is the TV-style 分析中心 bottom sheet (was 'more'). */
export type MobileSheetKind =
  | 'symbol'
  | 'interval'
  | 'indicators'
  | 'analysis';

export interface MobileCapsulesProps {
  symbol: string;
  interval: Interval;
  watchlist: string[];
  /** TW/US tickers on the stock watchlist (shown in the symbol list
   *  with 尚未支援報價 — they never touch the chart). */
  stockWatchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onIntervalChange: (interval: Interval) => void;
  /** Open the watchlist drawer (full list with search / add). */
  onOpenWatchlist: () => void;
  /** Open the drawing sheet (DrawingBar, TV-style). */
  onOpenDrawingSheet: () => void;
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
  /** Saved chart layouts (analysis centre 儲存／開啟). */
  layouts: SavedLayout[];
  /** Save the current view as a layout; returns the saved name. */
  onSaveLayout: () => string;
  /** Apply a saved layout (symbol / interval / indicators / chart
   *  type / appearance). */
  onOpenLayout: (id: string) => void;
  /** Delete a saved layout. */
  onDeleteLayout: (id: string) => void;
  /** Open bottom sheet / centre list, or null when none is open. */
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
/** Diagonal pencil (drawing-sheet trigger, TV-style brush button). */
function BrushIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.8 3.2a2.1 2.1 0 013 3L8.5 14.5 4 15.5l1-4.5 8.8-7.8z" />
      <path d="M11.5 5.5l3 3" />
    </svg>
  );
}

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
      <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-[#2a2e39] bg-[#131722]/80 px-4 pb-6 pt-2 backdrop-blur-xl">
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

/** Orange favourite star (same colour as the drawing-sheet stars). */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 20 20"
      fill={filled ? '#f79009' : 'none'}
      stroke={filled ? '#f79009' : '#787b86'}
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 1.8l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L10 14.4l-5.1 2.8 1.1-5.6L1.8 7.7l5.7-.7L10 1.8z" />
    </svg>
  );
}

/**
 * Centre-floating list (TV-style, f_001/f_002): a rounded dark card
 * floating over the chart centre, the selected row a light-grey
 * pill. No dim backdrop — the chart stays visible around it.
 * Backdrop tap or Esc closes. Portalled to document.body.
 */
function CenterList({
  testId,
  label,
  onClose,
  children,
}: {
  testId: string;
  label: string;
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
      className="fixed inset-0 z-50 flex items-center justify-center md:hidden"
      role="dialog"
      aria-label={label}
      data-testid={testId}
    >
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative max-h-[62vh] w-[300px] -translate-y-8 overflow-y-auto rounded-[20px] border border-[#2a2e39] bg-[#1e222d]/80 px-2 py-2 shadow-2xl backdrop-blur-xl">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** One row of a centre list: selected = light-grey pill (f_001). */
function CenterListRow({
  selected,
  onClick,
  testId,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] ${
        selected
          ? 'bg-[#3a3f4a] font-semibold text-white'
          : 'font-normal text-[#d1d4dc]'
      }`}
    >
      {children}
    </button>
  );
}

/** Swipe-preview timing (ms). Enter ~190ms, exit ~180ms — all
 *  SMOOTH_EASING, same as the capsule text. */
const MAG_ENTER_MS = 190;
const MAG_EXIT_MS = 180;

/** One gear detent: a single haptic tick per preview step, so a
 *  drag feels like a ratchet (Ryan 2026-11-27). Android Chrome:
 *  navigator.vibrate(10). iPhone Safari has no Vibration API, so
 *  it falls back to a very short, very quiet WebAudio tick
 *  (sine blip, ~35ms, gain 0.06) — created/resumed inside the
 *  drag gesture, so it stays allowed; any failure is swallowed
 *  silently and never blocks the drag. */
function fireGearTick(audioCtxRef: { current: AudioContext | null }): void {
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      navigator.vibrate(10);
      return;
    }
  } catch {
    // vibrate threw (or is not really there) — fall through to audio.
  }
  try {
    let ctx = audioCtxRef.current;
    if (ctx === null) {
      const AC =
        window.AudioContext ??
        (
          window as unknown as {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1800;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  } catch {
    // Audio unavailable / blocked — the drag still works.
  }
}

/** Swipe preview row height (px): rows are h-11. The wheel maps
 *  one row to MAG_STEP_PX of drag, so the list follows the finger
 *  1:1 scaled by ROW_PX / MAG_STEP_PX (44px per 50px of drag). */
const ROW_PX = 44;

/** Cubic-bezier easing solver: returns y for a given x on the
 *  curve (x1,y1,x2,y2). Newton–Raphson with a bisection fallback
 *  (the standard WebKit algorithm, trimmed). */
function cubicBezierEasing(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveX(x));
  };
}
const SMOOTH_EASE_FN = cubicBezierEasing(0.22, 1, 0.36, 1);

/** Momentum (fling) tuning for the swipe wheel (Ryan 2026-11-27:
 *  the drag is 1:1 now, but it stops dead on release — it needs
 *  to glide like a real picker). The release velocity is taken
 *  from the finger's motion over the last ~100ms, mapped to list
 *  px/ms (× ROW_PX / MAG_STEP_PX); the glide decays
 *  exponentially with time constant TAU, and snaps to the nearest
 *  row once it is slow enough. */
const MOMENTUM_TAU_MS = 120;
const MOMENTUM_MIN_VEL = 0.18; // list px/ms — below this, snap only
const MOMENTUM_MAX_VEL = 2.5; // list px/ms — cap on the fling speed
const MOMENTUM_STOP_VEL = 0.08; // list px/ms — glide ends, snap starts
const MOMENTUM_MAX_MS = 1200; // safety cap on one glide
const VELOCITY_WINDOW_MS = 100; // recent-motion window for the release velocity
const VELOCITY_MAX_AGE_MS = 150; // drop older samples
const VELOCITY_MIN_DT_MS = 30; // need at least this much time for a stable estimate
const VELOCITY_CAP_FINGER = 4; // px/ms — cap on the raw finger speed

/** True modulo (JS % keeps the sign). */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Finger velocity (px/ms) from recent move samples: the slope
 *  over the last ~100ms (falling back to the oldest sample if
 *  the window is too short for a stable estimate). Only moving
 *  samples are recorded (see gearVelRef), so a stationary lift
 *  cannot dilute it. */
function fingerVelocity(samples: Array<{ t: number; dy: number }>): number {
  if (samples.length < 2) return 0;
  const now = samples[samples.length - 1].t;
  let i = samples.length - 1;
  while (i > 0 && now - samples[i - 1].t <= VELOCITY_WINDOW_MS) {
    i--;
  }
  const a = samples[i];
  const b = samples[samples.length - 1];
  if (b.t - a.t >= VELOCITY_MIN_DT_MS) {
    return (b.dy - a.dy) / (b.t - a.t);
  }
  const a0 = samples[0];
  if (b.t - a0.t >= VELOCITY_MIN_DT_MS) {
    return (b.dy - a0.dy) / (b.t - a0.t);
  }
  return 0;
}

/** Map a virtual wheel position to a physical scrollTop.
 *  v is unbounded: virtual row 0 centres at midBase, one row is
 *  ROW_PX. The list renders 3 copies of the items (see
 *  SwipePreviewList); the middle copy is canonical. The centred
 *  row is round((v - midBase) / ROW_PX); its item is that row
 *  mod N, and frac is the offset within the row band — so the
 *  list scrolls continuously through the wrap: at a wrap
 *  boundary the physical scrollTop jumps by exactly one copy
 *  (±44N px), which lands on identical content and is invisible
 *  (the viewport never touches the spacers there). */
function wheelScrollTop(v: number, midBase: number, n: number): number {
  const rowFloat = (v - midBase) / ROW_PX;
  const rowRound = Math.round(rowFloat);
  const frac = rowFloat - rowRound;
  return midBase + ROW_PX * mod(rowRound, n) + frac * ROW_PX;
}

/** Tween a virtual wheel position from `fromV` to `toV` over
 *  durationMs with the smooth easing, calling `apply` every
 *  frame. Returns a cancel function. A no-op distance applies
 *  instantly. Used for the release snap (and the end of a
 *  momentum glide): the snap is at most half a row, but it may
 *  cross a wrap boundary, so it must tween in virtual space —
 *  tweening the physical scrollTop linearly would scroll
 *  backwards through the whole list. */
function tweenWheelValue(
  fromV: number,
  toV: number,
  durationMs: number,
  apply: (v: number) => void,
  done?: () => void,
): () => void {
  if (Math.abs(toV - fromV) < 0.5 || durationMs <= 0) {
    apply(toV);
    done?.();
    return () => {};
  }
  let raf = 0;
  let cancelled = false;
  const start = performance.now();
  const tick = (now: number) => {
    if (cancelled) return;
    const p = Math.min(1, (now - start) / durationMs);
    apply(fromV + (toV - fromV) * SMOOTH_EASE_FN(p));
    if (p < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      done?.();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/** Swipe preview list (Ryan 2026-11-27): dragging a capsule zone
 *  now floats the whole list over the chart centre — the same
 *  300px / -translate-y-8 / #1e222d card as CenterList. It is a
 *  real picker wheel: a fixed pill band (#3a3f4a) is parked at
 *  the card's vertical centre and the rows slide under it; the
 *  row nearest the centre is the preview (white/bold text). The
 *  parent drives the scroll container's scrollTop directly from
 *  the finger (1:1, one row per MAG_STEP_PX of drag) — never a
 *  per-step smooth scrollTo, which lagged behind the finger and
 *  restarted on every step (the jank Ryan felt on 2026-11-27).
 *  This replaces the 3-row MagnifierBubble mini wheel.
 *  pointer-events-none throughout, so it can never eat a touch.
 *  Enter: fade + scale 0.92→1. Release: fade + scale →0.95,
 *  then unmount — the unmount is delayed so the exit fade is
 *  seen instead of a pop. A fresh drag during the exit cancels
 *  it and re-enters. */
function SwipePreviewList({
  view,
  scrollRef,
}: {
  view: {
    zone: 'symbol' | 'interval';
    previewId: string;
    /** Absolute centred row (unbounded — wraps past the ends);
     *  the highlighted row is the one whose absolute index
     *  matches, not just the id, so only one of the three copies
     *  is ever highlighted. */
    previewAbs: number;
    items: Array<{ id: string; label: string; icon?: string; iconBase?: string }>;
  } | null;
  /** The scroll container, owned by the parent: during a drag the
   *  parent sets its scrollTop directly from the drag distance,
   *  so the list follows the finger instead of jumping per step. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<typeof view>(null);
  const shownRef = useRef<typeof view>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterPendingRef = useRef(false);
  const prevPreviewRef = useRef<string | null>(null);

  // Stage mount lifetime from the parent's view prop: mount on a
  // fresh appearance, keep mounted through the exit fade.
  useEffect(() => {
    if (view !== null) {
      const wasLeaving = leaveTimerRef.current !== null;
      if (leaveTimerRef.current !== null) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      const cur = shownRef.current;
      if (wasLeaving) {
        // A fresh drag during the exit: cancel the fade-out and
        // re-enter on the mounted card right away (the post-render
        // effect only runs on a shown change, which may not come
        // if the new preview equals the old one).
        const card = cardRef.current;
        card?.getAnimations().forEach((a) => a.cancel());
        card?.animate(
          [
            { opacity: 0, transform: 'scale(0.92)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          {
            duration: MAG_ENTER_MS,
            easing: SMOOTH_EASING,
            fill: 'backwards',
          },
        );
      } else if (cur === null) {
        // Fresh mount: the card doesn't exist yet, so the enter
        // runs in the post-render effect below.
        enterPendingRef.current = true;
      }
      // view is a fresh object every parent render: only push a
      // real content change, so unrelated renders (e.g. price
      // ticks) don't re-render the list or restart animations.
      if (
        cur === null ||
        cur.zone !== view.zone ||
        cur.previewId !== view.previewId ||
        cur.previewAbs !== view.previewAbs
      ) {
        shownRef.current = view;
        setShown(view);
      }
      return;
    }
    // Only start the exit once per disappearance: the parent
    // re-renders on price ticks, and re-running this would restart
    // the fade and reset the unmount timer forever.
    if (shownRef.current !== null && leaveTimerRef.current === null) {
      const card = cardRef.current;
      card?.getAnimations().forEach((a) => a.cancel());
      card?.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.95)' },
        ],
        {
          duration: MAG_EXIT_MS,
          easing: SMOOTH_EASING,
          fill: 'forwards',
        },
      );
      leaveTimerRef.current = setTimeout(() => {
        shownRef.current = null;
        prevPreviewRef.current = null;
        setShown(null);
        leaveTimerRef.current = null;
      }, MAG_EXIT_MS + 10);
    }
  }, [view]);

  useEffect(
    () => () => {
      if (leaveTimerRef.current !== null) {
        clearTimeout(leaveTimerRef.current);
      }
    },
    [],
  );

  // Enter on mount; centre the preview row instantly on first
  // appearance only. During a drag the parent drives the scroll
  // container's scrollTop directly from the finger (1:1 wheel),
  // so this effect must never scroll afterwards: the old
  // per-step smooth scrollTo lagged behind the finger and was
  // restarted by every step change, which is what felt janky
  // (Ryan 2026-11-27).
  useEffect(() => {
    if (shown === null) return;
    const card = cardRef.current;
    if (enterPendingRef.current) {
      enterPendingRef.current = false;
      card?.getAnimations().forEach((a) => a.cancel());
      card?.animate(
        [
          { opacity: 0, transform: 'scale(0.92)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        {
          duration: MAG_ENTER_MS,
          easing: SMOOTH_EASING,
          fill: 'backwards',
        },
      );
    }
    const first = prevPreviewRef.current === null;
    prevPreviewRef.current = shown.previewId;
    if (!first) return;
    const list = scrollRef.current;
    const row = list?.querySelector(
      `[data-gear-row="${shown.previewId}"][data-copy="1"]`,
    ) as HTMLElement | null;
    if (!list || !row) return;
    // Centre the preview row — unless a drag has already driven
    // the list there: this effect is passive, so it can run a
    // frame after the drag's scrollTop write, and overwriting it
    // would yank the list back by up to half a row for one
    // frame. Within half a row of the target, the drag owns the
    // position and this stays out of the way.
    const target =
      row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    if (Math.abs(list.scrollTop - target) > ROW_PX / 2) {
      list.scrollTop = target;
    }
  }, [shown, scrollRef]);

  if (shown === null) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center md:hidden">
      <div
        ref={cardRef}
        className="pointer-events-none relative h-[324px] max-h-[62vh] w-[300px] -translate-y-8 overflow-hidden rounded-[20px] border border-[#2a2e39] bg-[#1e222d]/80 shadow-2xl backdrop-blur-xl"
        data-testid="capsule-magnifier"
      >
        {/* Fixed highlight band: parked at the card's vertical
            centre — the pill never moves, the rows slide under
            it. Rows are transparent so the band shows through
            behind them; the centred row's text goes white/bold. */}
        <div
          className="pointer-events-none absolute left-2 right-2 top-1/2 z-0 h-11 -translate-y-1/2 rounded-2xl bg-[#3a3f4a]"
          aria-hidden="true"
        />
        <div
          ref={scrollRef}
          className="pointer-events-none relative z-10 h-full w-full overflow-y-auto px-2 py-2"
          data-testid="capsule-magnifier-list"
        >
        {/* Top/bottom spacers (half the viewport minus half a
            row) so even the first/last row can scroll to the
            card's vertical centre. */}
        <div className="h-[140px] shrink-0" aria-hidden="true" />
        {/* Three copies of the items (Ryan 2026-11-27: the wheel
            wraps — dragging past the last row continues onto the
            first). The middle copy is canonical; the parent maps
            the virtual wheel position onto it (see
            wheelScrollTop), so scrolling through the wrap lands
            on identical content instead of stopping at the end.
            Rows are highlighted by absolute index, so only one
            of the three copies is ever white/bold. */}
        {[0, 1, 2].flatMap((copy) =>
          shown.items.map((item, i) => {
            const abs = copy * shown.items.length + i;
            const selected = abs === shown.previewAbs;
            return (
              <div
                key={`${copy}-${item.id}`}
                data-gear-row={item.id}
                data-copy={copy}
                data-abs={abs}
                data-testid={`gear-row-${item.id}`}
                className={`flex h-11 w-full shrink-0 items-center gap-3 rounded-2xl px-3 text-[15px] ${
                  selected
                    ? 'font-semibold text-white'
                    : 'font-normal text-[#787b86]'
                }`}
              >
                {item.icon !== undefined &&
                  (item.iconBase !== undefined ? (
                    <CryptoIcon
                      baseAsset={item.iconBase}
                      letter={item.icon}
                      sizeClass="h-7 w-7"
                      textClass="text-xs"
                      bgColor="#2a2e39"
                    />
                  ) : (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2a2e39] text-xs font-bold text-white"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                  ))}
                <span className="truncate">{item.label}</span>
              </div>
            );
          }),
        )}
        <div className="h-[140px] shrink-0" aria-hidden="true" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One analysis-centre grid cell: icon + label (+ optional sub). */
function AnalysisCell({
  label,
  sub,
  onClick,
  disabled,
  testId,
  icon,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-[#2a2e39] bg-[#1e222d] px-2 py-3.5 text-[#d1d4dc] disabled:opacity-30"
    >
      <span className="text-[#b2b5be]">{icon}</span>
      <span className="text-[13px] leading-tight">{label}</span>
      {sub ? (
        <span className="text-[11px] leading-tight text-[#787b86]">
          {sub}
        </span>
      ) : null}
    </button>
  );
}

/** Small stroke icons for the analysis-centre cells (TV-style). */
function AnalysisIcon({ kind }: { kind: string }) {
  const p = {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'layout':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="14" height="12" rx="1.5" />
          <line x1="8" y1="4" x2="8" y2="16" />
        </svg>
      );
    case 'ict':
      return (
        <svg {...p}>
          <path d="M3 3h7l7 7-7 7-7-7V3z" />
          <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
      );
    case 'new':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="14" height="12" rx="1.5" />
          <path d="M10 8v4M8 10h4" />
        </svg>
      );
    case 'save':
      return (
        <svg {...p}>
          <path d="M10 12V4M6.5 7.5L10 4l3.5 3.5" />
          <path d="M4 15.5h12" />
        </svg>
      );
    case 'open':
      return (
        <svg {...p}>
          <path d="M3 5.5A1.5 1.5 0 014.5 4h3l1.5 2h6.5A1.5 1.5 0 0117 7.5V15a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15V5.5z" />
        </svg>
      );
    case 'indicators':
      return (
        <svg {...p}>
          <path d="M3 16.5h14" />
          <path d="M6 16.5v-5M11 16.5V6M16 16.5v-8" />
        </svg>
      );
    case 'compare':
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 7v6M7 10h6" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6.5V10l3 2" />
        </svg>
      );
    case 'replay':
      return (
        <svg {...p}>
          <path d="M10 5L4 10l6 5V5z" />
          <path d="M16 5l-6 5 6 5V5z" />
        </svg>
      );
    case 'chartType':
      return (
        <svg {...p}>
          <path d="M7 3.5V5M7 15v1.5M13 2v2M13 16v2" />
          <rect x="5" y="5" width="4" height="10" rx="0.5" />
          <rect x="11" y="4" width="4" height="12" rx="0.5" />
        </svg>
      );
    case 'objects':
      return (
        <svg {...p}>
          <path d="M8 6h9M8 10h9M8 14h9" />
          <circle cx="4" cy="6" r="1.2" />
          <circle cx="4" cy="10" r="1.2" />
          <circle cx="4" cy="14" r="1.2" />
        </svg>
      );
    case 'reset':
      return (
        <svg {...p}>
          <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
        </svg>
      );
    case 'undo':
      return (
        <svg {...p}>
          <path d="M8 5L3 10l5 5" />
          <path d="M3 10h10a5 5 0 015 5" />
        </svg>
      );
    case 'redo':
      return (
        <svg {...p}>
          <path d="M12 5l5 5-5 5" />
          <path d="M17 10H7a5 5 0 00-5 5" />
        </svg>
      );
    default:
      return null;
  }
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

const CAPSULE_BG = 'border border-[#2a2e39] bg-[#131722]/75 shadow-lg backdrop-blur-xl';

/**
 * Animate a capsule's text when its value changes. Swipe up slides
 * the new value in from below, swipe down from above (~250ms,
 * easeOutQuint-ish easing — the old 200ms plain ease-out felt
 * abrupt/janky, Ryan 2026-11-27); a change with no swipe direction
 * (tap, bottom sheet) fades in (~180ms). Web Animations API,
 * applied imperatively: the swipe handler records the direction in
 * a ref before the parent state update lands, and the effect
 * consumes it — no remount/class juggling, so a later re-render can
 * never replay the animation. Any running animation (e.g. a
 * snap-back glide from the previous drag) is cancelled first so
 * the new one starts clean. The element needs `inline-block` for
 * the translate to apply.
 */
function animateCapsuleText(
  el: HTMLElement | null,
  dir: 'up' | 'down' | null,
) {
  if (!el) return;
  el.getAnimations().forEach((a) => a.cancel());
  if (dir === null) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      easing: SMOOTH_EASING,
    });
    return;
  }
  const from = dir === 'up' ? '100%' : '-100%';
  el.animate(
    [
      { transform: `translateY(${from})`, opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    { duration: 250, easing: SMOOTH_EASING },
  );
}

/**
 * Top-left pill: [symbol | interval], an absolute overlay at the
 * chart's top-left. Tap the symbol to open the watchlist drawer;
 * tap the interval to open the interval sheet. Rendered inside the
 * chart container by page.tsx; unchanged position.
 */
/** Top-bar collapse persistence (mount-sync: read in an effect so
 *  SSR never touches window). */
const TOPBAR_COLLAPSED_KEY = 'ptt:topbar-collapsed';

/**
 * Mobile top bar (TV-style, f_001): a full-width bar over the
 * chart's top — left [icon symbol | green dot interval badge],
 * right circular chevron that collapses / expands the bar. No TV
 * logo. Tapping the symbol opens the centre symbol list; tapping
 * the interval opens the centre interval list. Collapsed state
 * persists in localStorage.
 */
export function MobileTopBar({
  symbol,
  interval,
  onOpenSymbolList,
  onOpenIntervalSheet,
}: {
  symbol: string;
  interval: Interval;
  onOpenSymbolList: () => void;
  onOpenIntervalSheet: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount
     sync from localStorage (an external system); a lazy initializer
     would read window during SSR and mismatch hydration. */
  useEffect(() => {
    try {
      setCollapsed(
        window.localStorage.getItem(TOPBAR_COLLAPSED_KEY) === '1',
      );
    } catch {
      // Non-fatal.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          TOPBAR_COLLAPSED_KEY,
          next ? '1' : '0',
        );
      } catch {
        // Non-fatal.
      }
      return next;
    });
  };
  return (
    <div
      className="absolute left-0 right-0 top-0 z-20 flex items-start justify-between px-2 pt-2 md:hidden"
      data-testid="mobile-top-bar"
    >
      {!collapsed && (
        <div
          className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 ${CAPSULE_BG}`}
          data-testid="mobile-top-pill"
        >
          <button
            onClick={onOpenSymbolList}
            aria-label={`切換標的，目前 ${symbol}`}
            data-testid="mobile-top-symbol"
            className="flex items-center gap-1.5"
          >
            <CryptoIcon
              baseAsset={baseAssetOf(symbol)}
              letter={symbol.charAt(0)}
              sizeClass="h-5 w-5"
              textClass="text-[11px]"
              bgColor="#2a2e39"
            />
            <span className="text-sm font-semibold text-white">
              {symbol}
            </span>
          </button>
          <span className="h-4 w-px bg-[#2a2e39]" aria-hidden="true" />
          <button
            onClick={onOpenIntervalSheet}
            aria-label={`切換週期，目前 ${INTERVAL_LABELS[interval]}`}
            data-testid="mobile-top-interval"
            className="flex items-center gap-1.5 text-sm font-medium text-white"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-[#26a69a]"
              aria-hidden="true"
            />
            {INTERVAL_LABELS[interval]}
          </button>
        </div>
      )}
      <button
        onClick={toggleCollapsed}
        aria-label={collapsed ? '展開頂欄' : '收起頂欄'}
        data-testid="mobile-top-collapse"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2a2e39] bg-[#131722]/90 text-[#b2b5be] shadow-lg backdrop-blur hover:text-white ${
          collapsed ? 'ml-auto' : ''
        }`}
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={collapsed ? 'rotate-180' : ''}
        >
          <path d="M3 6l5 5 5-5" />
        </svg>
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
  stockWatchlist,
  onSelectSymbol,
  onIntervalChange,
  onOpenWatchlist,
  onOpenDrawingSheet,
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
  layouts,
  onSaveLayout,
  onOpenLayout,
  onDeleteLayout,
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
  // Favourite intervals (Ryan 2026-11-27): swiping the interval
  // zone — and the magnifier preview — only walks these. Defaults
  // 15分/1h/4h/1d; an explicitly emptied list falls back to all 14
  // so swiping never dead-ends. Managed in the centre interval
  // list (管理收藏週期 → star per row). State inits to the
  // defaults (the list opens on tap, after the mount load below
  // has corrected it); the localStorage read is effect-only so SSR
  // never touches window.
  const [favoriteIntervals, setFavoriteIntervals] =
    useState<Interval[]>(DEFAULT_FAVORITE_INTERVALS);
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount
     sync from localStorage (an external system); a lazy initializer
     would read window during SSR and mismatch hydration. */
  useEffect(() => {
    const stored = loadFavoriteIntervals();
    if (stored !== null) setFavoriteIntervals(stored);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const toggleFavoriteInterval = (iv: Interval) => {
    setFavoriteIntervals((prev) => {
      const next = prev.includes(iv)
        ? prev.filter((x) => x !== iv)
        : [...prev, iv];
      saveFavoriteIntervals(next);
      return next;
    });
  };
  const swipeIntervals =
    favoriteIntervals.length > 0 ? favoriteIntervals : SWIPE_INTERVALS;
  const cycleInterval = (dir: 1 | -1) => {
    const i = swipeIntervals.indexOf(interval);
    const next =
      swipeIntervals[
        (((i < 0 ? 0 : i) + dir) % swipeIntervals.length +
          swipeIntervals.length) %
        swipeIntervals.length
      ];
    if (next !== interval) {
      intervalDirRef.current = dir === 1 ? 'up' : 'down';
      onIntervalChange(next);
    }
  };

  /** Swipe preview while a capsule zone is being dragged (Ryan
   *  2026-11-26: the finger covers the capsule, so the value is
   *  invisible mid-swipe; 2026-11-27: the preview is now the whole
   *  list, pill-highlighted and centred — see SwipePreviewList).
   *  The preview is what a release commits, so what he sees is
   *  what he gets. State drives the list; the ref is what the
   *  swipe commit reads (it is set synchronously on every drag
   *  move). */
  const [magnifier, setMagnifier] = useState<{
    zone: 'symbol' | 'interval';
    previewId: string;
    step: number;
    /** Absolute centred row (unbounded — wraps past the ends);
     *  the list highlights the row whose absolute index matches. */
    absRow: number;
  } | null>(null);
  const magRef = useRef<{
    zone: 'symbol' | 'interval';
    previewId: string;
    step: number;
    absRow: number;
  } | null>(null);
  /** Lazily created WebAudio context for the gear tick on iPhones
   *  (no Vibration API there) — see fireGearTick. */
  const gearAudioRef = useRef<AudioContext | null>(null);
  /** The swipe preview list's scroll container (owned by
   *  SwipePreviewList): the drag handler sets its scrollTop
   *  directly from the finger. */
  const gearCardRef = useRef<HTMLDivElement | null>(null);
  /** Wheel anchor for the active drag: the scrollTop that centres
   *  the current value's row (middle copy), that row's index,
   *  and the virtual wheel position. The virtual position v is
   *  unbounded — row 0 centres at midBase, one row is ROW_PX —
   *  and the physical scrollTop is wheelScrollTop(v), so the
   *  list wraps through the ends instead of stopping. `samples`
   *  is the recent finger motion for the release velocity;
   *  `willFling` is set on every move once the gesture is a real
   *  swipe with enough speed to glide on release. Reset on every
   *  drag end (or when a momentum glide takes over). */
  const gearDragRef = useRef<{
    baseScrollTop: number;
    baseIndex: number;
    midBase: number;
    zone: 'symbol' | 'interval';
    v: number;
    releaseVel: number;
    willFling: boolean;
  } | null>(null);
  /** Cancel for the release snap tween (a fresh drag cancels it). */
  const gearSnapRef = useRef<(() => void) | null>(null);
  /** Cancel for a running momentum glide (a fresh drag, or the
   *  glide finishing, clears it). The glide's settle commit is
   *  skipped when it is cancelled. */
  const gearMomentumRef = useRef<(() => void) | null>(null);
  /** Recent finger motion for the release velocity, sampled on
   *  every drag move — including the pre-mount ones: the list
   *  mounts a move or two into a fast flick (React batches
   *  continuous-event updates), so sampling only once the list
   *  exists would miss the flick's early motion and report no
   *  speed at all. Only moving samples are kept (a repeated dy
   *  is the stationary lift, not motion). Reset on every fresh
   *  drag. */
  const gearVelRef = useRef<{
    samples: Array<{ t: number; dy: number }>;
    lastDy: number | null;
  }>({ samples: [], lastDy: null });

  /** Minimal toast (no toast system in the app): a dark pill above
   *  the bottom bar, auto-dismissed. Used for 尚未支援 / 儲存確認 /
   *  stock rows tapped in the symbol list. */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1600);
  };
  /** Interval centre list: manage mode lists all 14 intervals with
   *  a star per row. Resets whenever the list closes. */
  const [intervalManage, setIntervalManage] = useState(false);
  /** Analysis centre inner view: main grid or the saved-layout list. */
  const [analysisView, setAnalysisView] = useState<'main' | 'layouts'>(
    'main',
  );

  /** Preview value for a drag offset — pre-mount fallback only.
   *  The wheel path in onZoneDrag reads the preview off the
   *  list's scroll position once the list exists; this is only
   *  used for the first move, before the list has mounted. No
   *  step until the swipe threshold, then one step per 50px of
   *  drag. Null while the drag is still a tap (<= 10px). */
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
        : cycleValue(swipeIntervals, interval, step);
    return { previewId, step };
  };

  /** Drive the wheel to virtual position v: set the physical
   *  scrollTop (wrap-aware, see wheelScrollTop), read the centred
   *  row off it, and update the preview + fire one gear tick per
   *  centre-row change. Shared by the drag handler (1:1 with the
   *  finger) and the momentum glide (rAF-driven). Also records
   *  the unbounded centred row on the list element
   *  (data-wheel-row) so tests can count rows crossed through
   *  wraps. */
  const applyWheelV = (
    v: number,
    drag: {
      baseIndex: number;
      midBase: number;
      zone: 'symbol' | 'interval';
    },
    items: Array<string>,
  ) => {
    const card = gearCardRef.current;
    if (card === null) return;
    const n = items.length;
    if (n === 0) return;
    const maxScroll = Math.max(0, card.scrollHeight - card.clientHeight);
    card.scrollTop = Math.max(
      0,
      Math.min(maxScroll, wheelScrollTop(v, drag.midBase, n)),
    );
    const rowRound = Math.round((v - drag.midBase) / ROW_PX);
    const deltaRows = rowRound - drag.baseIndex;
    const previewId = items[mod(rowRound, n)];
    card.dataset.wheelRow = String(rowRound);
    const prev = magRef.current;
    if (
      prev === null ||
      prev.zone !== drag.zone ||
      prev.previewId !== previewId ||
      prev.absRow !== rowRound
    ) {
      // One tick per centre-row change; the first appearance on
      // the current row is not a step.
      if (prev !== null || deltaRows !== 0) {
        fireGearTick(gearAudioRef);
      }
      const m = {
        zone: drag.zone,
        previewId,
        step: deltaRows,
        absRow: rowRound,
      };
      magRef.current = m;
      setMagnifier(m);
    }
  };

  const onZoneDrag =
    /* eslint-disable react-hooks/refs -- onZoneDrag is only ever
       invoked from the native pointer handlers in usePointerSwipe
       (via its cbRef), never during render. The ref is the
       synchronous channel between the drag preview and the swipe
       commit: the final onDrag and the swipe run inside one
       pointerup handler, so state would still be stale there. */
    (zone: 'symbol' | 'interval') => (dy: number) => {
      // A fresh drag cancels a running momentum glide (and its
      // deferred commit): the finger is in charge again.
      if (gearMomentumRef.current !== null) {
        gearMomentumRef.current();
        gearMomentumRef.current = null;
      }
      const next = previewFor(zone, dy);
      const prev = magRef.current;
      // Finger-follow (Ryan 2026-11-27): while swiping, the capsule
      // text translates 1:1 with the finger (clamped) instead of
      // sitting still until release. The first swipe move cancels
      // any running text animation (slide-in / glide-back) so the
      // follow starts from the live position.
      const textEl =
        zone === 'symbol' ? symbolTextRef.current : intervalTextRef.current;
      if (next === null) {
        if (textEl) textEl.style.transform = '';
        if (prev !== null) {
          magRef.current = null;
          setMagnifier(null);
        }
        gearDragRef.current = null;
        return;
      }
      if (prev === null) {
        textEl?.getAnimations().forEach((a) => a.cancel());
        // A fresh drag cancels any release snap still running.
        gearSnapRef.current?.();
        gearSnapRef.current = null;
        // Fresh drag: restart the velocity history (see
        // gearVelRef).
        gearVelRef.current = { samples: [], lastDy: null };
      }
      // Record this move's finger position for the release
      // velocity (both paths — the list may not be mounted yet).
      // A repeated dy is the stationary lift, not motion.
      if (dy !== gearVelRef.current.lastDy) {
        gearVelRef.current.lastDy = dy;
        const now = performance.now();
        gearVelRef.current.samples.push({ t: now, dy });
        while (
          gearVelRef.current.samples.length > 0 &&
          now - gearVelRef.current.samples[0].t > VELOCITY_MAX_AGE_MS
        ) {
          gearVelRef.current.samples.shift();
        }
      }
      if (textEl) {
        const clamped = Math.max(
          -FOLLOW_MAX_PX,
          Math.min(FOLLOW_MAX_PX, dy),
        );
        textEl.style.transform = `translateY(${clamped}px)`;
      }
      // Wheel (Ryan 2026-11-27): once the preview list is
      // mounted, drive its scrollTop directly from the finger —
      // 1:1, one row per MAG_STEP_PX of drag — and read the
      // preview off the row nearest the fixed centre band. The
      // discrete previewFor path below is only the pre-mount
      // fallback (the first move, before the list exists).
      const card = gearCardRef.current;
      if (card !== null) {
        const items =
          zone === 'symbol' ? watchlist : swipeIntervals;
        const currentId = zone === 'symbol' ? symbol : interval;
        let drag = gearDragRef.current;
        if (drag === null || drag.zone !== zone) {
          // Anchor from geometry (robust even if the mount
          // effect has not centred the list yet): the scrollTop
          // that puts the current row (middle copy) on the
          // centre band.
          const row = card.querySelector(
            `[data-gear-row="${currentId}"][data-copy="1"]`,
          ) as HTMLElement | null;
          const baseScrollTop = row
            ? row.offsetTop -
              (card.clientHeight - row.offsetHeight) / 2
            : card.scrollTop;
          const baseIndex = Math.max(0, items.indexOf(currentId));
          drag = {
            baseScrollTop,
            baseIndex,
            midBase: baseScrollTop - baseIndex * ROW_PX,
            zone,
            v: baseScrollTop,
            releaseVel: 0,
            willFling: false,
          };
          gearDragRef.current = drag;
        }
        // Virtual position: 1:1 with the finger, one row per
        // MAG_STEP_PX of drag. The list wraps (see
        // wheelScrollTop), so there is no clamp at the ends.
        const v = drag.baseScrollTop - dy * (ROW_PX / MAG_STEP_PX);
        drag.v = v;
        // Release velocity from the finger's recent motion (see
        // gearVelRef — sampled on every move, including the
        // pre-mount ones): the fling on release glides from this
        // speed. A slow tail before release means no fling.
        const velFinger = Math.max(
          -VELOCITY_CAP_FINGER,
          Math.min(
            VELOCITY_CAP_FINGER,
            fingerVelocity(gearVelRef.current.samples),
          ),
        );
        drag.releaseVel = Math.max(
          -MOMENTUM_MAX_VEL,
          Math.min(
            MOMENTUM_MAX_VEL,
            -velFinger * (ROW_PX / MAG_STEP_PX),
          ),
        );
        drag.willFling =
          Math.abs(dy) >= SWIPE_MIN_DY &&
          Math.abs(drag.releaseVel) >= MOMENTUM_MIN_VEL;
        applyWheelV(v, drag, items);
        return;
      }
      if (
        prev === null ||
        prev.zone !== zone ||
        prev.previewId !== next.previewId
      ) {
        // Gear detent (Ryan 2026-11-27): one tick per step
        // change. A first appearance with step 0 is not a step
        // (the drag is still inside the dead zone), so no tick.
        if (prev !== null || next.step !== 0) {
          fireGearTick(gearAudioRef);
        }
        // Absolute row of the middle copy, so the highlight
        // lands on the copy the mount effect centres.
        const items = zone === 'symbol' ? watchlist : swipeIntervals;
        const m = {
          zone,
          previewId: next.previewId,
          step: next.step,
          absRow:
            items.length + Math.max(0, items.indexOf(next.previewId)),
        };
        magRef.current = m;
        setMagnifier(m);
      }
    };
  /* eslint-enable react-hooks/refs */
  /** Momentum glide after a fling release (Ryan 2026-11-27).
   *  The list keeps sliding in the release direction on a rAF
   *  loop, velocity decaying exponentially (friction), one gear
   *  tick per row crossed — the glide is what makes the wheel
   *  feel like it has frame rate, instead of stopping dead the
   *  instant the finger lifts. When the speed drops below the
   *  threshold it snaps to the nearest row (virtual space, so a
   *  snap across the wrap goes the short way), then commits the
   *  settled preview and hides the list. A fresh drag cancels
   *  the glide (and the deferred commit). */
  const startMomentum = (
    drag: {
      baseIndex: number;
      midBase: number;
      zone: 'symbol' | 'interval';
      v: number;
      releaseVel: number;
    },
    card: HTMLDivElement,
  ) => {
    const items = drag.zone === 'symbol' ? watchlist : swipeIntervals;
    const n = items.length;
    if (n === 0) return;
    const maxScroll = Math.max(0, card.scrollHeight - card.clientHeight);
    // ScrollTop only — the centred row cannot change during a
    // snap (at most half a row), so no preview update is needed.
    const setScroll = (vv: number) => {
      card.scrollTop = Math.max(
        0,
        Math.min(maxScroll, wheelScrollTop(vv, drag.midBase, n)),
      );
    };
    let v = drag.v;
    let vel = drag.releaseVel;
    // First rAF timestamp initialises the clock (performance.now
    // is impure, so it must not be called here in the component
    // body — the loop's first frame supplies it).
    let last = 0;
    let start = 0;
    let raf = 0;
    let snapCancel: (() => void) | null = null;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      snapCancel?.();
      gearMomentumRef.current = null;
    };
    gearMomentumRef.current = cancel;
    const settle = () => {
      // Snap to the nearest row, then commit the settled
      // preview and hide the list. The snap runs under the
      // exit fade, as before.
      const vSnap =
        drag.midBase + ROW_PX * Math.round((v - drag.midBase) / ROW_PX);
      snapCancel = tweenWheelValue(v, vSnap, 180, setScroll, () => {
        if (cancelled) return;
        gearMomentumRef.current = null;
        const committed =
          drag.zone === 'symbol'
            ? commitSymbolPreview()
            : commitIntervalPreview();
        magRef.current = null;
        setMagnifier(null);
        const textEl =
          drag.zone === 'symbol'
            ? symbolTextRef.current
            : intervalTextRef.current;
        if (committed && textEl) {
          // The value-change slide-in takes over: clear the
          // follow offset so it starts clean.
          textEl.style.transform = '';
        }
      });
    };
    const step = (now: number) => {
      if (cancelled) return;
      if (last === 0) {
        last = now;
        start = now;
      }
      const dt = Math.min(50, now - last);
      last = now;
      vel *= Math.exp(-dt / MOMENTUM_TAU_MS);
      v += vel * dt;
      if (!card.isConnected) {
        gearMomentumRef.current = null;
        return;
      }
      applyWheelV(v, drag, items);
      if (
        Math.abs(vel) < MOMENTUM_STOP_VEL ||
        now - start > MOMENTUM_MAX_MS
      ) {
        settle();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  const onZoneEnd = () => {
    const m = magRef.current;
    const card = gearCardRef.current;
    const drag = gearDragRef.current;
    // Fling release (Ryan 2026-11-27): keep the list mounted and
    // let the momentum glide carry it; the value commits when
    // the glide settles (see startMomentum). The swipe that
    // already fired for this gesture was swallowed (commit*
    // Preview return true while willFling is set), so nothing
    // has committed yet. The capsule text still glides back to
    // rest now — the finger is gone — and the value slide-in
    // (if any) runs at settle.
    if (drag !== null && drag.willFling && m !== null && card !== null) {
      gearDragRef.current = null;
      startMomentum(drag, card);
      const textEl =
        m.zone === 'symbol' ? symbolTextRef.current : intervalTextRef.current;
      if (textEl) {
        const current = textEl.style.transform;
        textEl.style.transform = '';
        if (current) {
          textEl.animate(
            [{ transform: current }, { transform: 'translateY(0px)' }],
            { duration: 180, easing: SMOOTH_EASING },
          );
        }
      }
      return;
    }
    // Did this gesture commit a new value? (Checked before the
    // magnifier is cleared; the values are still the pre-commit
    // ones — the commit's state update has not rendered yet.)
    const committed =
      m !== null &&
      ((m.zone === 'symbol' && m.previewId !== symbol) ||
        (m.zone === 'interval' && m.previewId !== interval));
    magRef.current = null;
    setMagnifier(null);
    // Release snap (Ryan 2026-11-27): the wheel may stop
    // between rows — tween to the nearest row over ~180ms with
    // the smooth easing, so it lands on a row instead of
    // floating mid-row. Runs under the exit fade. The snap
    // tweens in virtual space (see tweenWheelValue), so a snap
    // across the wrap goes the short way.
    gearDragRef.current = null;
    if (card !== null && drag !== null) {
      const n = drag.zone === 'symbol' ? watchlist.length : swipeIntervals.length;
      const maxScroll = Math.max(0, card.scrollHeight - card.clientHeight);
      const vSnap =
        drag.midBase + ROW_PX * Math.round((drag.v - drag.midBase) / ROW_PX);
      gearSnapRef.current = tweenWheelValue(drag.v, vSnap, 180, (vv) => {
        card.scrollTop = Math.max(
          0,
          Math.min(maxScroll, wheelScrollTop(vv, drag.midBase, n)),
        );
      });
    }
    if (m === null) return;
    const textEl =
      m.zone === 'symbol' ? symbolTextRef.current : intervalTextRef.current;
    if (!textEl) return;
    if (committed) {
      // The value-change slide-in takes over: clear the follow
      // offset so it starts clean.
      textEl.style.transform = '';
      return;
    }
    // No commit (tap-range drag or a same-step release): glide the
    // text back to rest instead of snapping. The animation runs
    // from the current inline offset, so clear the inline style
    // first — the running animation overrides it until it ends.
    const current = textEl.style.transform;
    if (!current) return;
    textEl.style.transform = '';
    textEl.animate(
      [{ transform: current }, { transform: 'translateY(0px)' }],
      { duration: 180, easing: SMOOTH_EASING },
    );
  };

  /** Commit the magnifier preview on swipe release (true when it
   *  committed — the caller then skips the single-step cycle). The
   *  slide animation direction follows the preview's step sign. */
  const commitSymbolPreview = (): boolean => {
    // A fling is pending for this zone: the swipe already fired
    // for this gesture, but the value is not final until the
    // momentum glide settles — swallow it (returning true also
    // skips the single-step cycle fallback) and let the glide
    // commit at settle.
    const drag = gearDragRef.current;
    if (drag !== null && drag.zone === 'symbol' && drag.willFling) {
      return true;
    }
    const m = magRef.current;
    if (m && m.zone === 'symbol' && m.previewId !== symbol) {
      symbolDirRef.current = m.step >= 0 ? 'up' : 'down';
      onSelectSymbol(m.previewId);
      return true;
    }
    return false;
  };
  const commitIntervalPreview = (): boolean => {
    const drag = gearDragRef.current;
    if (drag !== null && drag.zone === 'interval' && drag.willFling) {
      return true;
    }
    const m = magRef.current;
    if (m && m.zone === 'interval' && m.previewId !== interval) {
      intervalDirRef.current = m.step >= 0 ? 'up' : 'down';
      onIntervalChange(m.previewId as Interval);
      return true;
    }
    return false;
  };

  // The list the swipe walks, with the preview row highlighted.
  // Symbol zone: the watchlist (icon + code rows); interval
  // zone: the favourite intervals (plain label rows).
  const gearView =
    magnifier === null
      ? null
      : {
          zone: magnifier.zone,
          previewId: magnifier.previewId,
          // The highlighted row is the middle copy of the centred
          // item (absRow itself is unbounded — it counts wraps).
          previewAbs:
            (magnifier.zone === 'symbol'
              ? watchlist.length
              : swipeIntervals.length) +
            mod(
              magnifier.absRow,
              magnifier.zone === 'symbol'
                ? watchlist.length
                : swipeIntervals.length,
            ),
          items:
            magnifier.zone === 'symbol'
              ? watchlist.map((s) => ({
                  id: s,
                  label: s,
                  icon: s.charAt(0),
                  iconBase: baseAssetOf(s),
                }))
              : swipeIntervals.map((iv) => ({
                  id: iv,
                  label: INTERVAL_LABELS[iv],
                })),
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

  const closeSheet = () => {
    setIntervalManage(false);
    setAnalysisView('main');
    onSheetChange(null);
  };

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
      {/* TV-style bottom bar (Ryan 2026-11-27): one [symbol |
          interval] capsule + three separate circular buttons
          (brush / indicators / ⋯). The capsule is TV-proportioned
          — symbol wider, interval in its own centred zone, divider
          between, no dead space (the hard 50/50 split from the
          morning is gone). The gear left the bar — 圖表設定 lives
          in the analysis centre now. Bottom padding is the safe
          area PLUS a margin (Ryan 2026-11-27: raised higher,
          safe-area + 1.25rem). pt-2.5 keeps the bar off the chart
          above. The capsule and the buttons are h-12 (48px) so
          their tops and bottoms align. */}
      <div
        className="relative flex shrink-0 items-center gap-2 pl-2 pr-2 pt-2.5 md:hidden"
        style={{
          paddingBottom:
            'max(1.5rem, calc(env(safe-area-inset-bottom) + 1.25rem))',
        }}
        data-testid="mobile-bottom-bar"
      >
        {toast !== null &&
          createPortal(
            <div
              className="pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 whitespace-nowrap rounded-full border border-[#2a2e39] bg-[#1e222d]/80 px-4 py-2 text-sm text-white shadow-2xl backdrop-blur-xl md:hidden"
              data-testid="mobile-toast"
              role="status"
            >
              {toast}
            </div>,
            document.body,
          )}
        {/* Capsule wrapper: the swipe preview list is portalled
            to the screen centre (see SwipePreviewList), so this
            wrapper no longer positions it. */}
        <div className="relative min-w-0 flex-1">
          <SwipePreviewList view={gearView} scrollRef={gearCardRef} />
          {/* Bottom capsule: symbol | interval, both swipeable.
              Symbol flexes (left-aligned), interval is a fixed
              76px centred zone. */}
          <div
            className={`flex h-12 min-w-0 flex-1 items-center overflow-hidden rounded-full ${CAPSULE_BG}`}
            data-testid="mobile-bottom-capsule"
          >
            <div
              ref={symbolZoneRef}
              style={{ touchAction: 'none' }}
              onClick={() => onSheetChange('symbol')}
              className="flex h-full min-w-0 flex-1 items-center"
              data-testid="mobile-symbol-zone"
            >
              <button
                onClick={() => onSheetChange('symbol')}
                aria-label={`切換標的，目前 ${symbol}（上下滑動切換）`}
                style={{ touchAction: 'none' }}
                className="flex h-full w-full items-center px-4 text-sm font-semibold text-white"
              >
                <span
                  ref={symbolTextRef}
                  className="inline-block truncate"
                >
                  {symbol}
                </span>
              </button>
            </div>
            <span className="h-6 w-px shrink-0 bg-[#2a2e39]" aria-hidden="true" />
            <div
              ref={intervalZoneRef}
              style={{ touchAction: 'none' }}
              onClick={() => onSheetChange('interval')}
              className="flex h-full w-[76px] shrink-0 items-center justify-center"
              data-testid="mobile-interval-zone"
            >
              <button
                onClick={() => onSheetChange('interval')}
                aria-label={`切換週期，目前 ${INTERVAL_LABELS[interval]}（上下滑動切換）`}
                style={{ touchAction: 'none' }}
                className="flex h-full w-full items-center justify-center text-sm font-medium text-white"
              >
                <span ref={intervalTextRef} className="inline-block text-center">
                  {INTERVAL_LABELS[interval]}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* TV-style action buttons: three separate circles. */}
        <button
          onClick={onOpenDrawingSheet}
          title="繪圖"
          aria-label="繪圖"
          data-testid="mobile-draw-btn"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[#b2b5be] hover:text-white ${CAPSULE_BG}`}
        >
          <BrushIcon />
        </button>
        <button
          onClick={() => onSheetChange('indicators')}
          title="指標"
          aria-label="指標"
          data-testid="mobile-indicators-btn"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold italic text-[#b2b5be] hover:text-white ${CAPSULE_BG}`}
        >
          ƒx
        </button>
        <button
          onClick={() => onSheetChange('analysis')}
          title="分析中心"
          aria-label="分析中心"
          data-testid="mobile-more-btn"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[#b2b5be] hover:text-white ${CAPSULE_BG}`}
        >
          <DotsIcon />
        </button>
      </div>

      {debugTouch && <TouchDebugOverlay />}

      {sheet === 'symbol' && (
        <CenterList
          testId="mobile-symbol-list"
          label="選擇標的"
          onClose={closeSheet}
        >
          {watchlist.map((s) => (
            <CenterListRow
              key={s}
              selected={s === symbol}
              onClick={() => {
                onSelectSymbol(s);
                closeSheet();
              }}
              testId={`symbol-option-${s}`}
            >
              <CryptoIcon
                baseAsset={baseAssetOf(s)}
                letter={s.charAt(0)}
                sizeClass="h-7 w-7"
                textClass="text-xs"
                bgColor="#2a2e39"
              />
              <span className="truncate">{s}</span>
            </CenterListRow>
          ))}
          {stockWatchlist.map((t) => (
            <CenterListRow
              key={`stock-${t}`}
              selected={false}
              onClick={() => showToast('尚未支援報價')}
              testId={`symbol-option-stock-${t}`}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2a2e39] text-xs font-bold text-white"
                aria-hidden="true"
              >
                {t.charAt(0)}
              </span>
              <span className="truncate">{t}</span>
              <span className="ml-auto shrink-0 text-xs text-[#787b86]">
                尚未支援報價
              </span>
            </CenterListRow>
          ))}
          {watchlist.length === 0 && stockWatchlist.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-[#787b86]">
              自選清單是空的
            </div>
          )}
          <button
            onClick={() => {
              onOpenWatchlist();
              closeSheet();
            }}
            data-testid="symbol-list-open-watchlist"
            className="mt-1 flex w-full items-center justify-center rounded-2xl border border-[#2a2e39] px-3 py-2.5 text-sm text-[#b2b5be]"
          >
            開啟完整自選清單
          </button>
        </CenterList>
      )}

      {sheet === 'interval' && (
        <CenterList
          testId="mobile-interval-list"
          label="選擇週期"
          onClose={closeSheet}
        >
          {!intervalManage ? (
            <>
              {swipeIntervals.map((iv) => (
                <CenterListRow
                  key={iv}
                  selected={iv === interval}
                  onClick={() => {
                    onIntervalChange(iv);
                    closeSheet();
                  }}
                  testId={`interval-option-${iv}`}
                >
                  {INTERVAL_LABELS[iv]}
                </CenterListRow>
              ))}
              <button
                onClick={() => setIntervalManage(true)}
                data-testid="interval-manage-btn"
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#2a2e39] px-3 py-2.5 text-sm text-[#b2b5be]"
              >
                <StarIcon filled={false} />
                管理收藏週期
              </button>
            </>
          ) : (
            <>
              <div className="px-3 pb-1 pt-1 text-xs text-[#787b86]">
                點星號收藏／取消收藏；滑動與放大鏡只走收藏的週期
              </div>
              {SWIPE_INTERVALS.map((iv) => {
                const fav = favoriteIntervals.includes(iv);
                return (
                  <div
                    key={iv}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-1.5"
                  >
                    <button
                      onClick={() => {
                        onIntervalChange(iv);
                        closeSheet();
                      }}
                      data-testid={`interval-option-${iv}`}
                      className={`flex-1 py-1 text-left text-[15px] ${
                        iv === interval
                          ? 'font-semibold text-white'
                          : 'text-[#d1d4dc]'
                      }`}
                    >
                      {INTERVAL_LABELS[iv]}
                    </button>
                    <button
                      onClick={() => toggleFavoriteInterval(iv)}
                      aria-label={
                        fav
                          ? `取消收藏 ${INTERVAL_LABELS[iv]}`
                          : `收藏 ${INTERVAL_LABELS[iv]}`
                      }
                      data-testid={`interval-star-${iv}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full"
                    >
                      <StarIcon filled={fav} />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={() => setIntervalManage(false)}
                data-testid="interval-manage-done"
                className="mt-1 flex w-full items-center justify-center rounded-2xl border border-[#2a2e39] px-3 py-2.5 text-sm text-[#b2b5be]"
              >
                完成
              </button>
            </>
          )}
        </CenterList>
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

      {sheet === 'analysis' && (
        <MobileSheet
          title="分析中心"
          testId="mobile-analysis-sheet"
          onClose={closeSheet}
        >
          {analysisView === 'layouts' ? (
            <>
              <button
                onClick={() => setAnalysisView('main')}
                data-testid="layouts-back"
                className="mb-1 text-sm font-medium text-[#2962ff]"
              >
                ‹ 返回分析中心
              </button>
              {layouts.length === 0 ? (
                <div className="px-1 py-4 text-center text-sm text-[#787b86]">
                  尚未儲存版面，點「儲存」把目前的畫面存起來
                </div>
              ) : (
                layouts.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2 border-b border-[#2a2e39] py-2 last:border-b-0"
                  >
                    <button
                      onClick={() => {
                        onOpenLayout(l.id);
                        closeSheet();
                      }}
                      data-testid={`layout-open-${l.id}`}
                      className="flex-1 text-left"
                    >
                      <div className="text-sm font-medium text-white">
                        {l.name}
                      </div>
                      <div className="text-xs text-[#787b86]">
                        {l.symbol} · {INTERVAL_LABELS[l.interval]} ·{' '}
                        {l.chartType === 'area' ? '線形圖' : 'K線'}
                      </div>
                    </button>
                    <button
                      onClick={() => onDeleteLayout(l.id)}
                      aria-label={`刪除 ${l.name}`}
                      data-testid={`layout-delete-${l.id}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[#787b86]"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <AnalysisCell
                  label="版面設定"
                  testId="analysis-layout-settings"
                  icon={<AnalysisIcon kind="layout" />}
                  onClick={() => showToast('尚未支援')}
                />
                <AnalysisCell
                  label="管理 ICT"
                  testId="analysis-ict"
                  icon={<AnalysisIcon kind="ict" />}
                  onClick={() => showToast('尚未支援')}
                />
                <AnalysisCell
                  label="圖表設定"
                  testId="analysis-chart-settings"
                  icon={<GearIcon />}
                  onClick={() => {
                    onOpenAppearanceSettings();
                    closeSheet();
                  }}
                />
                <AnalysisCell
                  label="新"
                  testId="analysis-new"
                  icon={<AnalysisIcon kind="new" />}
                  onClick={() => showToast('尚未支援')}
                />
                <AnalysisCell
                  label="儲存"
                  testId="analysis-save"
                  icon={<AnalysisIcon kind="save" />}
                  onClick={() => {
                    const name = onSaveLayout();
                    showToast(`已儲存「${name}」`);
                  }}
                />
                <AnalysisCell
                  label="開啟"
                  sub={
                    layouts.length > 0
                      ? `${layouts.length} 個版面`
                      : undefined
                  }
                  testId="analysis-open"
                  icon={<AnalysisIcon kind="open" />}
                  onClick={() => setAnalysisView('layouts')}
                />
              </div>
              <div className="mb-2 mt-4 text-xs font-medium text-[#787b86]">
                工具
              </div>
              <div className="grid grid-cols-2 gap-2">
                <AnalysisCell
                  label="指標"
                  testId="analysis-indicators"
                  icon={<AnalysisIcon kind="indicators" />}
                  onClick={() => onSheetChange('indicators')}
                />
                <AnalysisCell
                  label="比較"
                  testId="analysis-compare"
                  icon={<AnalysisIcon kind="compare" />}
                  onClick={() => showToast('尚未支援')}
                />
                <AnalysisCell
                  label="快訊"
                  testId="analysis-alerts"
                  icon={<AnalysisIcon kind="alert" />}
                  onClick={() => showToast('尚未支援')}
                />
                <AnalysisCell
                  label="K線重播"
                  testId="analysis-replay"
                  icon={<AnalysisIcon kind="replay" />}
                  onClick={() => showToast('尚未支援')}
                />
                <AnalysisCell
                  label="圖表類型"
                  sub={chartType === 'area' ? '線形圖' : 'K線'}
                  testId="analysis-chart-type"
                  icon={<AnalysisIcon kind="chartType" />}
                  onClick={() =>
                    onChartTypeChange(
                      chartType === 'area' ? 'candle_solid' : 'area',
                    )
                  }
                />
                <AnalysisCell
                  label="物件樹"
                  testId="analysis-objects"
                  icon={<AnalysisIcon kind="objects" />}
                  onClick={() => {
                    onOpenObjectList();
                    closeSheet();
                  }}
                />
                <AnalysisCell
                  label="自選清單"
                  testId="analysis-watchlist"
                  icon={<StarIcon filled={false} />}
                  onClick={() => {
                    onOpenWatchlist();
                    closeSheet();
                  }}
                />
                <AnalysisCell
                  label="重設檢視"
                  testId="analysis-reset"
                  icon={<AnalysisIcon kind="reset" />}
                  onClick={() => {
                    onResetView();
                    closeSheet();
                  }}
                />
                <AnalysisCell
                  label="復原"
                  testId="analysis-undo"
                  icon={<AnalysisIcon kind="undo" />}
                  disabled={!canUndo}
                  onClick={() => {
                    onUndo();
                    closeSheet();
                  }}
                />
                <AnalysisCell
                  label="重做"
                  testId="analysis-redo"
                  icon={<AnalysisIcon kind="redo" />}
                  disabled={!canRedo}
                  onClick={() => {
                    onRedo();
                    closeSheet();
                  }}
                />
              </div>
            </>
          )}
        </MobileSheet>
      )}
    </>
  );
}
