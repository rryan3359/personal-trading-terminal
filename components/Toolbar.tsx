'use client';

/**
 * Toolbar.tsx — top toolbar.
 *
 * Left: timeframe switcher (15m / 1h / 4H / 1D / 1w).
 * Middle: drawing tools (趨勢線 / 延伸線 / 射線 / 水平線 / 水平射線 /
 *         垂直線 / 平行通道 / 斐波那契 / 矩形 / 量測), click again to
 *         disarm; double-click or Shift+click keeps the tool armed for
 *         continuous drawing. Undo/redo + magnet (關/弱/強) sit next to
 *         the tools; "清除畫線" removes all drawings on the current
 *         symbol.
 * Right: indicator toggles (MA / EMA / BOLL / VOL / RSI / MACD) and the
 *         live-connection status dot.
 */

import { useState } from 'react';
import { INTERVALS, INTERVAL_LABELS, type Interval } from '@/lib/types';
import { DRAWING_TOOLS, INDICATOR_OPTIONS, type DrawingTool } from '@/lib/chart-config';
import { getMagnetMode, saveMagnetMode, type MagnetMode } from '@/lib/store';
import type { BinanceSocketStatus } from '@/lib/ws/binance';

export interface ToolbarProps {
  symbol: string;
  interval: Interval;
  onIntervalChange: (interval: Interval) => void;
  activeTool: DrawingTool | null;
  /** Second arg: keep the tool armed after each drawing (double-click / Shift-click). */
  onToolChange: (tool: DrawingTool | null, continuous: boolean) => void;
  indicators: string[];
  onToggleIndicator: (name: string) => void;
  onClearDrawings: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  connectionStatus: BinanceSocketStatus;
  /** Mobile only: open the watchlist drawer. */
  onOpenWatchlist: () => void;
}

const MAGNET_LABELS: Array<{ id: MagnetMode; label: string }> = [
  { id: 'off', label: '關' },
  { id: 'weak', label: '弱' },
  { id: 'strong', label: '強' },
];

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
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  connectionStatus,
  onOpenWatchlist,
}: ToolbarProps) {
  const status = STATUS_META[connectionStatus];
  const [magnet, setMagnet] = useState<MagnetMode>(() => getMagnetMode());

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#2a2e39] bg-[#131722] px-3 py-1.5 md:h-12 md:flex-nowrap md:gap-3 md:py-0">
      <button
        onClick={onOpenWatchlist}
        className="rounded px-2 py-1 text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-white md:hidden"
      >
        ☰ 自選
      </button>

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

      <span className="hidden h-5 w-px bg-[#2a2e39] md:block" />

      <div className="flex items-center gap-0.5">
        {DRAWING_TOOLS.map((tool) => (
          <button
            key={tool.id}
            title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
            onClick={(e) =>
              onToolChange(
                activeTool === tool.id ? null : tool.id,
                e.shiftKey,
              )
            }
            onDoubleClick={() => onToolChange(tool.id, true)}
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
          onClick={onUndo}
          disabled={!canUndo}
          title="復原 (Ctrl+Z)"
          className="rounded px-2 py-1 text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30"
        >
          ↩ 復原
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (Ctrl+Shift+Z)"
          className="rounded px-2 py-1 text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30"
        >
          ↪ 重做
        </button>
        <span className="ml-1 flex items-center gap-0.5" title="磁吸：按住 Ctrl/Cmd 可暫時反轉">
          <span className="text-xs text-[#787b86]">磁吸</span>
          {MAGNET_LABELS.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMagnet(m.id);
                saveMagnetMode(m.id);
              }}
              className={`rounded px-1.5 py-1 text-xs ${
                magnet === m.id
                  ? 'bg-[#2962ff] font-medium text-white'
                  : 'text-[#b2b5be] hover:bg-[#1e222d] hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </span>
        <button
          onClick={onClearDrawings}
          title="清除目前商品的所有畫線"
          className="rounded px-2 py-1 text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-[#ef5350]"
        >
          清除畫線
        </button>
      </div>

      <span className="hidden h-5 w-px bg-[#2a2e39] md:block" />

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
