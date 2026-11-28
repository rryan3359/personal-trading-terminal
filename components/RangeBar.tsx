'use client';

/**
 * RangeBar.tsx — bottom time-range bar (TradingView-style).
 *
 * Range presets (1天 5天 1月 3月 6月 YTD 1年 全部). Clicking one
 * asks the chart (via onRange) to fit that calendar span into the
 * chart width, pinned to the latest candle; the span is capped by the
 * candles actually loaded. The live clock used to live here; it moved
 * to the StatusBar below so the bottom area has a single clock.
 *
 * The bar scrolls horizontally on narrow screens. It does not fetch
 * data itself and never changes the symbol or interval.
 */

import { RANGES, type RangeId } from '@/lib/chart-config';

export interface RangeBarProps {
  activeRange: RangeId | null;
  onRange: (range: RangeId) => void;
}

export default function RangeBar({ activeRange, onRange }: RangeBarProps) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-tv-border bg-tv-workspace px-2">
      <div className="flex shrink-0 items-center gap-0.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => onRange(r.id)}
            className={`rounded px-2 py-1 text-xs ${
              r.id === activeRange
                ? 'bg-tv-accent-soft font-medium text-tv-accent'
                : 'text-tv-text-2 hover:text-tv-text-strong'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
