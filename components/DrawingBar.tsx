'use client';

/**
 * DrawingBar.tsx — left vertical drawing toolbar (TradingView-style).
 *
 * Icon-only buttons (inline SVG) for the 10 DRAWING_TOOLS in the
 * existing order, a divider, then magnet (click cycles off -> weak ->
 * strong, highlighted when on) and clear. Single click arms a tool
 * (click again to disarm); double-click or Shift+click keeps it armed
 * for continuous drawing. Active tool: bg #2a2e39, text #2962ff.
 *
 * Undo / redo live in the top Toolbar now (TradingView puts them there).
 */

import { useState } from 'react';
import { DRAWING_TOOLS, type DrawingTool } from '@/lib/chart-config';
import { getMagnetMode, saveMagnetMode, type MagnetMode } from '@/lib/store';

export interface DrawingBarProps {
  activeTool: DrawingTool | null;
  /** Second arg: keep the tool armed after each drawing (double-click / Shift-click). */
  onToolChange: (tool: DrawingTool | null, continuous: boolean) => void;
  /** Remove all drawings on the current symbol. */
  onClear: () => void;
}

const MAGNET_ORDER: MagnetMode[] = ['off', 'weak', 'strong'];
const MAGNET_LABELS: Record<MagnetMode, string> = {
  off: '關',
  weak: '弱',
  strong: '強',
};

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 20x20 stroke icon, one per drawing tool. */
function ToolIcon({ tool }: { tool: DrawingTool }) {
  switch (tool) {
    case 'segment':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="16" y2="4" />
          <circle cx="4" cy="16" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="16" cy="4" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'straightLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="3.5" y1="16.5" x2="16.5" y2="3.5" />
          <path d="M3.5 16.5l3.2-.6M3.5 16.5l.6-3.2M16.5 3.5l-3.2.6M16.5 3.5l-.6 3.2" />
        </svg>
      );
    case 'rayLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="3.5" y1="16.5" x2="16.5" y2="3.5" />
          <path d="M16.5 3.5l-3.2.6M16.5 3.5l-.6 3.2" />
          <circle cx="3.5" cy="16.5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'horizontalStraightLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="3" y1="10" x2="17" y2="10" />
          <path d="M3 10l3.2-.9M3 10l3.2.9M17 10l-3.2-.9M17 10l-3.2.9" />
        </svg>
      );
    case 'horizontalRayLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="10" x2="17" y2="10" />
          <path d="M17 10l-3.2-.9M17 10l-3.2.9" />
          <circle cx="4" cy="10" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'verticalStraightLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="10" y1="3" x2="10" y2="17" />
          <path d="M10 3l-.9 3.2M10 3l.9 3.2M10 17l-.9-3.2M10 17l.9-3.2" />
        </svg>
      );
    case 'parallelStraightLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="3" y1="16" x2="12" y2="7" />
          <line x1="8" y1="13" x2="17" y2="4" />
        </svg>
      );
    case 'fibonacciRetracement':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="5" x2="16" y2="5" />
          <line x1="4" y1="10" x2="13" y2="10" />
          <line x1="4" y1="15" x2="10" y2="15" />
        </svg>
      );
    case 'rectangle':
      return (
        <svg {...ICON_PROPS}>
          <rect x="4" y="5" width="12" height="10" />
        </svg>
      );
    case 'measure':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="10" x2="16" y2="10" />
          <line x1="4" y1="7" x2="4" y2="13" />
          <line x1="16" y1="7" x2="16" y2="13" />
        </svg>
      );
  }
}

function MagnetIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 3h3v7a1 1 0 0 0 2 0V3h3v7a4 4 0 0 1-8 0V3z" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 6h12" />
      <path d="M8 6V4h4v2" />
      <path d="M6.5 6l.8 11h5.4l.8-11" />
      <path d="M10 9.5v4.5M13.5 9.5v4.5" />
    </svg>
  );
}

const BUTTON_BASE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b2b5be]';

export default function DrawingBar({
  activeTool,
  onToolChange,
  onClear,
}: DrawingBarProps) {
  const [magnet, setMagnet] = useState<MagnetMode>(() => getMagnetMode());

  const cycleMagnet = () => {
    const next =
      MAGNET_ORDER[(MAGNET_ORDER.indexOf(magnet) + 1) % MAGNET_ORDER.length];
    setMagnet(next);
    saveMagnetMode(next);
  };

  return (
    <aside className="flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[#2a2e39] bg-[#131722] py-1">
      {DRAWING_TOOLS.map((tool) => (
        <button
          key={tool.id}
          title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
          onClick={(e) =>
            onToolChange(activeTool === tool.id ? null : tool.id, e.shiftKey)
          }
          onDoubleClick={() => onToolChange(tool.id, true)}
          className={`${BUTTON_BASE} ${
            activeTool === tool.id ? 'bg-[#2a2e39] text-[#2962ff]' : ''
          }`}
        >
          <ToolIcon tool={tool.id} />
        </button>
      ))}

      <span className="my-1 h-px w-7 shrink-0 bg-[#2a2e39]" />

      <button
        onClick={cycleMagnet}
        title={`磁吸：${MAGNET_LABELS[magnet]}（點擊切換，關 → 弱 → 強）`}
        className={`${BUTTON_BASE} ${
          magnet !== 'off' ? 'bg-[#2a2e39] text-[#2962ff]' : ''
        }`}
      >
        <MagnetIcon />
      </button>
      <button
        onClick={onClear}
        title="清除目前商品的所有畫線"
        className={`${BUTTON_BASE} hover:text-[#ef5350]`}
      >
        <ClearIcon />
      </button>
    </aside>
  );
}
