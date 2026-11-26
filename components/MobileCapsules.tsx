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
 *   the chart's volume pane and time axis are fully visible, and
 *   the left rail ends above it (its undo + "⋯" buttons can no
 *   longer be clipped by a capsule).
 *
 * Swipe — why the old one failed on a real iPhone:
 *   The old zones used React synthetic onTouchStart/onTouchEnd.
 *   React attaches touch listeners as PASSIVE at the root, and the
 *   code never handled touchmove at all — so nothing ever called
 *   preventDefault, and the touch target (the inner <button>) had
 *   touch-action: auto. On real iOS Safari a vertical drag starting
 *   on that button is claimed by Safari as a page scroll /
 *   overscroll (h-dvh + the collapsing URL bar make the page
 *   rubber-bandable), Safari fires touchcancel, and onTouchEnd
 *   never arrives — the swipe is silently dropped. Headless Chrome
 *   cannot reproduce it: the emulated page has no scrollable
 *   overflow and Chrome honours the wrapper's touch-action: none,
 *   so CDP swipes passed (verified: 3/3 swipes + tap, zero
 *   touchcancel, zero scroll) while the real phone did nothing.
 *   The fix is native, non-passive listeners: touchstart records
 *   the start, touchmove calls preventDefault once the drag is
 *   clearly vertical (claiming the gesture before Safari can),
 *   touchend fires the swipe, and touchcancel completes it from
 *   the last move position instead of dropping it. touch-action:
 *   none is set on the zone AND the inner button. Taps still work:
 *   a move < 10px never prevents anything, so the click proceeds;
 *   a swipe's synthetic click is still swallowed by the capture
 *   guard.
 *
 * All sheets are bottom sheets (backdrop + drag handle), mobile-only
 * (`md:hidden`), portalled to document.body. Nothing here renders on
 * desktop.
 */

import { useEffect, useRef } from 'react';
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

/** Vertical swipe threshold (px) and tap threshold (px). */
const SWIPE_MIN_DY = 30;
const TAP_MAX_MOVE = 10;
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
 * Native vertical-swipe handling for one zone. Swipe up calls
 * onUp, swipe down calls onDown; a short move (< 10px) is a tap
 * and the click goes through untouched. A swipe's synthetic click
 * is swallowed in the capture phase so a swipe never also taps.
 *
 * Native listeners (not React synthetic ones): React attaches
 * touch handlers as passive at the root, so a React onTouchMove
 * could never preventDefault — and iOS Safari claims an
 * un-prevented vertical drag as a page scroll, fires touchcancel,
 * and the swipe dies. The touchmove listener here is non-passive
 * and calls preventDefault once the drag is clearly vertical.
 * The hook returns nothing and attaches everything (including the
 * capture-phase click guard that swallows a swipe's synthetic
 * click) in an effect, so no ref-derived value is ever read
 * during render.
 */
function useVerticalSwipe(
  ref: React.RefObject<HTMLDivElement | null>,
  {
    onSwipeUp,
    onSwipeDown,
  }: {
    onSwipeUp: () => void;
    onSwipeDown: () => void;
  },
) {
  const lastSwipeAt = useRef(0);
  // Latest callbacks for the once-attached native listeners.
  const cbRef = useRef({ onSwipeUp, onSwipeDown });
  useEffect(() => {
    cbRef.current = { onSwipeUp, onSwipeDown };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let claimed = false;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      claimed = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (
        !claimed &&
        Math.abs(dy) > TAP_MAX_MOVE &&
        Math.abs(dy) > Math.abs(dx)
      ) {
        // Clearly a vertical drag: claim the gesture before Safari
        // can take it over as a page scroll.
        claimed = true;
      }
      if (claimed) e.preventDefault();
    };
    const finish = (e: TouchEvent) => {
      const s = start;
      start = null;
      claimed = false;
      if (!s) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dy) >= SWIPE_MIN_DY && Math.abs(dy) > Math.abs(dx)) {
        lastSwipeAt.current = Date.now();
        if (dy < 0) cbRef.current.onSwipeUp();
        else cbRef.current.onSwipeDown();
      }
      // < TAP_MAX_MOVE total movement = a tap: the click proceeds.
    };
    // Capture-phase click guard: eat the synthetic click that
    // follows a swipe, so a swipe never also taps.
    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() - lastSwipeAt.current < SWIPE_CLICK_GUARD_MS) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', finish, { passive: true });
    // touchcancel (Safari taking the gesture, an alert, …) still
    // completes the swipe from the last move position instead of
    // silently dropping it.
    el.addEventListener('touchcancel', finish, { passive: true });
    el.addEventListener('click', onClickCapture, { capture: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', finish);
      el.removeEventListener('click', onClickCapture, { capture: true });
    };
  }, [ref]);
}

const CAPSULE_BG = 'border border-[#2a2e39] bg-[#131722]/90 shadow-lg backdrop-blur';

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
 * home-indicator safe area, so the capsules never sit under it.
 * Hidden on desktop (md:hidden).
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
  onRedo,
  canRedo,
  onResetView,
  sheet,
  onSheetChange,
}: MobileCapsulesProps) {
  const cycleSymbol = (dir: 1 | -1) => {
    if (watchlist.length === 0) return;
    const i = watchlist.indexOf(symbol);
    const next =
      watchlist[
        (((i < 0 ? 0 : i) + dir) % watchlist.length + watchlist.length) %
        watchlist.length
      ];
    if (next !== symbol) onSelectSymbol(next);
  };
  const cycleInterval = (dir: 1 | -1) => {
    const i = SWIPE_INTERVALS.indexOf(interval);
    const next =
      SWIPE_INTERVALS[
        (((i < 0 ? 0 : i) + dir) % SWIPE_INTERVALS.length +
          SWIPE_INTERVALS.length) %
        SWIPE_INTERVALS.length
      ];
    onIntervalChange(next);
  };

  const closeSheet = () => onSheetChange(null);

  const symbolZoneRef = useRef<HTMLDivElement | null>(null);
  const intervalZoneRef = useRef<HTMLDivElement | null>(null);
  useVerticalSwipe(symbolZoneRef, {
    onSwipeUp: () => cycleSymbol(1),
    onSwipeDown: () => cycleSymbol(-1),
  });
  useVerticalSwipe(intervalZoneRef, {
    onSwipeUp: () => cycleInterval(1),
    onSwipeDown: () => cycleInterval(-1),
  });

  return (
    <>
      {/* pl-14 (56px) clears the 48px mobile rail + 8px gap, so the
          left capsule starts where the chart starts. */}
      <div
        className="flex shrink-0 items-center gap-2 py-2 pl-14 pr-2 md:hidden"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        data-testid="mobile-bottom-bar"
      >
        {/* Bottom-left capsule: symbol | interval, both swipeable. */}
        <div
          className={`flex min-w-0 flex-1 items-stretch overflow-hidden rounded-full ${CAPSULE_BG}`}
          data-testid="mobile-bottom-capsule"
        >
          <div
            ref={symbolZoneRef}
            style={{ touchAction: 'none' }}
            className="flex min-w-0 flex-1 items-center"
            data-testid="mobile-symbol-zone"
          >
            <button
              onClick={onOpenWatchlist}
              aria-label={`切換標的，目前 ${symbol}（上下滑動切換）`}
              style={{ touchAction: 'none' }}
              className="w-full truncate px-3 py-2.5 text-sm font-semibold text-white"
            >
              {symbol}
            </button>
          </div>
          <span className="w-px shrink-0 bg-[#2a2e39]" aria-hidden="true" />
          <div
            ref={intervalZoneRef}
            style={{ touchAction: 'none' }}
            className="flex shrink-0 items-center"
            data-testid="mobile-interval-zone"
          >
            <button
              onClick={() => onSheetChange('interval')}
              aria-label={`切換週期，目前 ${INTERVAL_LABELS[interval]}（上下滑動切換）`}
              style={{ touchAction: 'none' }}
              className="px-3 py-2.5 text-sm font-medium text-white"
            >
              {INTERVAL_LABELS[interval]}
            </button>
          </div>
        </div>

        {/* Bottom-right capsule: indicators + chart settings + more. */}
        <div
          className={`flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-1.5 ${CAPSULE_BG}`}
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
