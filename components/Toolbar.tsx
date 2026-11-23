'use client';

/**
 * Toolbar.tsx — top toolbar.
 *
 * Left: timeframe switcher (15m / 1h / 4H / 1D / 1w).
 * Middle: drawing tools (trend / horizontal / ray / Fibonacci / rectangle),
 *         click again to disarm; "清除畫線" removes all drawings on the
 *         current symbol + timeframe.
 * Right: indicator toggles (MA / EMA / BOLL / VOL / RSI / MACD) and the
 *         live-connection status dot.
 */

import { INTERVALS, INTERVAL_LABELS, type Interval } from '@/lib/types';
import { DRAWING_TOOLS, INDICATOR_OPTIONS, type DrawingTool } from '@/lib/chart-config';
import type { BinanceSocketStatus } from '@/lib/ws/binance';

export interface ToolbarProps {
  symbol: string;
  interval: Interval;
  onIntervalChange: (interval: Interval) => void;
  activeTool: DrawingTool | null;
  onToolChange: (tool: DrawingTool | null) => void;
  indicators: string[];
  onToggleIndicator: (name: string) => void;
  onClearDrawings: () => void;
  connectionStatus: BinanceSocketStatus;
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
  activeTool,
  onToolChange,
  indicators,
  onToggleIndicator,
  onClearDrawings,
  connectionStatus,
}: ToolbarProps) {
  const status = STATUS_META[connectionStatus];

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#2a2e39] bg-[#131722] px-3">
      <span className="text-sm font-semibold tracking-wide text-white">
        {symbol}
      </span>

      <div className="flex items-center gap-0.5 rounded bg-[#1e222d] p-0.5">
        {INTERVALS.map((tf) => (
          <button
            key={tf}
            onClick={() => onIntervalChange(tf)}
            className={`rounded px-2 py-1 text-xs ${
              tf === interval
                ? 'bg-[#2962ff] font-medium text-white'
                : 'text-[#b2b5be] hover:text-white'
            }`}
          >
            {INTERVAL_LABELS[tf]}
          </button>
        ))}
      </div>

      <span className="h-5 w-px bg-[#2a2e39]" />

      <div className="flex items-center gap-0.5">
        {DRAWING_TOOLS.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            onClick={() => onToolChange(activeTool === tool.id ? null : tool.id)}
            className={`rounded px-2 py-1 text-xs ${
              activeTool === tool.id
                ? 'bg-[#2962ff] font-medium text-white'
                : 'text-[#b2b5be] hover:bg-[#1e222d] hover:text-white'
            }`}
          >
            {tool.label}
          </button>
        ))}
        <button
          onClick={onClearDrawings}
          title="清除目前商品與週期的所有畫線"
          className="rounded px-2 py-1 text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-[#ef5350]"
        >
          清除畫線
        </button>
      </div>

      <span className="h-5 w-px bg-[#2a2e39]" />

      <div className="flex items-center gap-0.5">
        {INDICATOR_OPTIONS.map((ind) => {
          const on = indicators.includes(ind.id);
          return (
            <button
              key={ind.id}
              onClick={() => onToggleIndicator(ind.id)}
              className={`rounded px-2 py-1 text-xs ${
                on
                  ? 'bg-[#2962ff] font-medium text-white'
                  : 'text-[#b2b5be] hover:bg-[#1e222d] hover:text-white'
              }`}
            >
              {ind.label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-1.5 text-xs text-[#787b86]">
        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
        {status.text}
      </div>
    </header>
  );
}
