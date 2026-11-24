'use client';

/**
 * RangeBar.tsx — bottom time-range bar (TradingView-style).
 *
 * Left: range presets (1天 5天 1月 3月 6月 YTD 1年 全部). Clicking one
 * asks the chart (via onRange) to fit that calendar span into the
 * chart width, pinned to the latest candle; the span is capped by the
 * candles actually loaded. Right: live local clock with UTC offset,
 * like TradingView's bottom-right clock.
 *
 * The bar scrolls horizontally on narrow screens. It does not fetch
 * data itself and never changes the symbol or interval.
 */

import { useEffect, useState } from 'react';
import { RANGES, type RangeId } from '@/lib/chart-config';

export interface RangeBarProps {
  activeRange: RangeId | null;
  onRange: (range: RangeId) => void;
}

function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(offsetMin) / 60);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} UTC${sign}${hours}`;
}

export default function RangeBar({ activeRange, onRange }: RangeBarProps) {
  // Null until the first client-side tick: reading the clock during
  // prerender is an unstable value (cacheComponents blocks it), so the
  // initial render shows a placeholder and the effect starts the clock.
  const [now, setNow] = useState<Date | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount sync
     from the clock (an external system); the initial value cannot be
     read during prerender (cacheComponents blocks `new Date()`). */
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-[#2a2e39] bg-[#131722] px-2">
      <div className="flex shrink-0 items-center">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => onRange(r.id)}
            className={`rounded px-2 py-1 text-xs ${
              r.id === activeRange
                ? 'font-medium text-[#2962ff]'
                : 'text-[#b2b5be] hover:text-white'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <span className="ml-auto shrink-0 pl-3 text-xs tabular-nums text-[#787b86]">
        {now ? formatClock(now) : '--:--:--'}
      </span>
    </div>
  );
}
