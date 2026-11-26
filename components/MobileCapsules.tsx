'use client';

/**
 * MobileCapsules.tsx — mobile-only (<md) overlays on the chart.
 *
 * Mirrors the clean black watch-app reference: no top toolbar, no
 * range/status bars on mobile — just three floating capsules over a
 * full-bleed chart.
 *
 *   Top-left pill:  [symbol] [interval]. Tap the symbol to open the
 *   watchlist drawer; tap the interval to open the interval sheet.
 *   Bottom-left capsule: [symbol | interval]. Vertical swipe on the
 *   symbol zone cycles the watchlist (wraps); vertical swipe on the
 *   interval zone cycles SWIPE_INTERVALS (wraps). A swipe is a
 *   vertical move >= 30px (and more vertical than horizontal); a
 *   move < 10px is a tap. The capsule is an HTML overlay, so touches
 *   on it never reach the chart canvas (no pan/zoom interference).
 *   Bottom-right capsule: indicators (ƒx) + chart settings (gear)
 *   shortcuts, plus "⋯" opening a sheet with chart type, object
 *   list, redo, reset view, and the watchlist.
 *
 * All sheets are bottom sheets (backdrop + drag handle), mobile-only
 * (`md:hidden`). Nothing here renders on desktop.
 */

import { useEffect, useRef, useState } from 'react';
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
 * Touch handlers for a vertical-swipe zone. Swipe up calls onUp,
 * swipe down calls onDown; a short move (< 10px) is a tap and the
 * click goes through untouched. A swipe's synthetic click is
 * swallowed in the capture phase so a swipe never also taps.
 */
function useVerticalSwipe({
  onSwipeUp,
  onSwipeDown,
}: {
  onSwipeUp: () => void;
  onSwipeDown: () => void;
}) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastSwipeAt = useRef(0);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = startRef.current;
      startRef.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (
        Math.abs(dy) >= SWIPE_MIN_DY &&
        Math.abs(dy) > Math.abs(dx)
      ) {
        lastSwipeAt.current = Date.now();
        if (dy < 0) onSwipeUp();
        else onSwipeDown();
      }
      // < TAP_MAX_MOVE total movement = a tap: the click proceeds.
      void TAP_MAX_MOVE;
    },
    /** Capture-phase click guard: eat the synthetic click that
     *  follows a swipe. */
    onClickCapture: (e: React.MouseEvent) => {
      if (Date.now() - lastSwipeAt.current < SWIPE_CLICK_GUARD_MS) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}

const CAPSULE_BG = 'border border-[#2a2e39] bg-[#131722]/90 shadow-lg backdrop-blur';

export default function MobileCapsules({
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
}: MobileCapsulesProps) {
  const [sheet, setSheet] = useState<'interval' | 'indicators' | 'more' | null>(null);

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

  const symbolSwipe = useVerticalSwipe({
    onSwipeUp: () => cycleSymbol(1),
    onSwipeDown: () => cycleSymbol(-1),
  });
  const intervalSwipe = useVerticalSwipe({
    onSwipeUp: () => cycleInterval(1),
    onSwipeDown: () => cycleInterval(-1),
  });

  const closeSheet = () => setSheet(null);

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20 md:hidden">
        {/* Top-left pill: symbol + interval. */}
        <div
          className={`pointer-events-auto absolute left-2 top-2 flex items-center gap-2 rounded-full px-2.5 py-1.5 ${CAPSULE_BG}`}
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
            onClick={() => setSheet('interval')}
            aria-label={`切換週期，目前 ${INTERVAL_LABELS[interval]}`}
            data-testid="mobile-top-interval"
            className="text-sm font-medium text-[#2962ff]"
          >
            {INTERVAL_LABELS[interval]}
          </button>
        </div>

        {/* Bottom-left capsule: symbol | interval, both swipeable. */}
        <div
          className={`pointer-events-auto absolute bottom-2 left-2 flex items-stretch overflow-hidden rounded-full ${CAPSULE_BG}`}
          data-testid="mobile-bottom-capsule"
        >
          <div
            {...symbolSwipe}
            style={{ touchAction: 'none' }}
            className="flex items-center"
            data-testid="mobile-symbol-zone"
          >
            <button
              onClick={onOpenWatchlist}
              aria-label={`切換標的，目前 ${symbol}（上下滑動切換）`}
              className="px-3 py-2.5 text-sm font-semibold text-white"
            >
              {symbol}
            </button>
          </div>
          <span className="w-px bg-[#2a2e39]" aria-hidden="true" />
          <div
            {...intervalSwipe}
            style={{ touchAction: 'none' }}
            className="flex items-center"
            data-testid="mobile-interval-zone"
          >
            <button
              onClick={() => setSheet('interval')}
              aria-label={`切換週期，目前 ${INTERVAL_LABELS[interval]}（上下滑動切換）`}
              className="px-3 py-2.5 text-sm font-medium text-white"
            >
              {INTERVAL_LABELS[interval]}
            </button>
          </div>
        </div>

        {/* Bottom-right capsule: indicators + chart settings + more. */}
        <div
          className={`pointer-events-auto absolute bottom-2 right-2 flex items-center gap-0.5 rounded-full px-1.5 py-1.5 ${CAPSULE_BG}`}
          data-testid="mobile-actions-capsule"
        >
          <button
            onClick={() => setSheet('indicators')}
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
            onClick={() => setSheet('more')}
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
