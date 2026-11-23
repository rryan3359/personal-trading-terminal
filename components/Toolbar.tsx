'use client';

/**
 * Toolbar.tsx — top bar (TradingView-style, h-10).
 *
 * Left: symbol name, timeframe buttons as plain text (active =
 * text #2962ff, no pill container), "ƒx 指標" dropdown listing
 * INDICATOR_OPTIONS with checkmarks.
 * Right: connection status dot, and a mobile-only "自選" button that
 * opens the watchlist drawer.
 *
 * Drawing tools, magnet, undo/redo and clear live in the left
 * vertical DrawingBar now.
 */

import { useState } from 'react';
import { INTERVALS, INTERVAL_LABELS, type Interval } from '@/lib/types';
import { INDICATOR_OPTIONS } from '@/lib/chart-config';
import type { BinanceSocketStatus } from '@/lib/ws/binance';

export interface ToolbarProps {
  symbol: string;
  interval: Interval;
  onIntervalChange: (interval: Interval) => void;
  indicators: string[];
  onToggleIndicator: (name: string) => void;
  connectionStatus: BinanceSocketStatus;
  /** Mobile only: open the watchlist drawer. */
  onOpenWatchlist: () => void;
}

const STATUS_META: Record<BinanceSocketStatus, { dot: string; text: string }> = {
  connecting: { dot: 'bg-yellow-400', text: '連線中' },
  live: { dot: 'bg-[#26a69a]', text: '即時' },
  reconnecting: { dot: 'bg-yellow-400', text: '重連中' },
  closed: { dot: 'bg-[#5d606b]', text: '未連線' },
};

export default function Toolbar({
  symbol,
  interval,
  onIntervalChange,
  indicators,
  onToggleIndicator,
  connectionStatus,
  onOpenWatchlist,
}: ToolbarProps) {
  const status = STATUS_META[connectionStatus];
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[#2a2e39] bg-[#131722] px-3">
      <button
        onClick={onOpenWatchlist}
        className="shrink-0 rounded px-2 py-1 text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-white md:hidden"
      >
        ☰ 自選
      </button>

      <span className="shrink-0 text-sm font-semibold tracking-wide text-white">
        {symbol}
      </span>

      <div className="flex shrink-0 items-center gap-2.5">
        {INTERVALS.map((tf) => (
          <button
            key={tf}
            onClick={() => onIntervalChange(tf)}
            className={`text-xs ${
              tf === interval
                ? 'font-medium text-[#2962ff]'
                : 'text-[#b2b5be] hover:text-white'
            }`}
          >
            {INTERVAL_LABELS[tf]}
          </button>
        ))}
      </div>

      <div className="relative shrink-0">
        <button
          onClick={() => setIndicatorsOpen((open) => !open)}
          className="text-xs text-[#b2b5be] hover:text-white"
        >
          ƒx 指標
        </button>
        {indicatorsOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIndicatorsOpen(false)}
            />
            <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded border border-[#2a2e39] bg-[#1e222d] py-1 shadow-lg">
              {INDICATOR_OPTIONS.map((ind) => {
                const on = indicators.includes(ind.id);
                return (
                  <button
                    key={ind.id}
                    onClick={() => onToggleIndicator(ind.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#d1d4dc] hover:bg-[#2a2e39]"
                  >
                    <span className="w-3 shrink-0 text-[#2962ff]">
                      {on ? '✓' : ''}
                    </span>
                    {ind.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div
        className="ml-auto flex shrink-0 items-center gap-1.5"
        title={status.text}
      >
        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
      </div>
    </header>
  );
}
