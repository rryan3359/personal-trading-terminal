'use client';

/**
 * DrawingBar.tsx — left vertical drawing toolbar (TradingView-style).
 *
 * Top: cursor/select tool (active when no drawing tool is armed;
 * clicking it exits drawing mode). Then the 31 DRAWING_TOOLS grouped
 * by logic — trend lines, horizontal lines, vertical lines, shapes,
 * geometry, freehand/annotation, Fibonacci, measure — with a divider
 * between groups. Bottom: magnet (click cycles off -> weak -> strong,
 * current strength shown under the icon) and clear. Single click arms
 * a tool (click again to disarm); double-click or Shift+click keeps it
 * armed for continuous drawing. Active tool: bg #2a2e39, text #2962ff,
 * plus a left accent bar.
 *
 * Undo / redo live in the top Toolbar now (TradingView puts them there).
 */

import { useState } from 'react';
import { DRAWING_TOOLS, type DrawingTool } from '@/lib/chart-config';
import { getMagnetMode, saveMagnetMode, type MagnetMode } from '@/lib/store';

/** Logical groups for the toolbar, in display order. */
const TOOL_GROUPS: Array<{ title: string; ids: DrawingTool[] }> = [
  { title: '趨勢線', ids: ['segment', 'straightLine', 'rayLine', 'parallelStraightLine', 'priceChannelLine'] },
  { title: '水平線', ids: ['horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'priceLine', 'simpleTag'] },
  { title: '垂直線', ids: ['verticalStraightLine', 'verticalSegment', 'verticalRayLine'] },
  { title: '圖形', ids: ['rectangle'] },
  { title: '幾何', ids: ['ellipse', 'triangle', 'arc', 'curve', 'arrow', 'path', 'pen'] },
  { title: '徒手畫／標註', ids: ['brush', 'textAnnotation'] },
  { title: '斐波那契', ids: ['fibonacciRetracement', 'fibChannel', 'fibTimeZones', 'fibFan', 'fibArc', 'fibSpiral', 'fibWedge'] },
  { title: '測量', ids: ['measure'] },
];
const TOOL_BY_ID = new Map(DRAWING_TOOLS.map((t) => [t.id, t]));

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
    case 'horizontalSegment':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="10" x2="16" y2="10" />
          <circle cx="4" cy="10" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="16" cy="10" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'verticalSegment':
      return (
        <svg {...ICON_PROPS}>
          <line x1="10" y1="4" x2="10" y2="16" />
          <circle cx="10" cy="4" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="10" cy="16" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'verticalRayLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="10" y1="4" x2="10" y2="17" />
          <path d="M10 17l-.9-3.2M10 17l.9-3.2" />
          <circle cx="10" cy="4" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'priceLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="2" y1="10" x2="13" y2="10" />
          <rect x="13" y="6.5" width="5" height="7" rx="1" />
        </svg>
      );
    case 'priceChannelLine':
      return (
        <svg {...ICON_PROPS}>
          <line x1="3" y1="15" x2="11" y2="7" />
          <line x1="9" y1="13" x2="17" y2="5" />
          <circle cx="11" cy="7" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'brush':
      return (
        <svg {...ICON_PROPS}>
          <path d="M3.5 15.5c2.5-6 4 2.5 6.5-3.5s3.5-4 6.5-1.5" />
        </svg>
      );
    case 'simpleTag':
      return (
        <svg {...ICON_PROPS}>
          <line
            x1="2"
            y1="10"
            x2="12"
            y2="10"
            strokeDasharray="2.5 2.5"
          />
          <path d="M12 6.5h5.5v7H12l-2.5-3.5 2.5-3.5z" />
        </svg>
      );
    case 'textAnnotation':
      return (
        <svg {...ICON_PROPS}>
          <text
            x="10"
            y="14.5"
            textAnchor="middle"
            fontSize="13"
            fontWeight="600"
            fill="currentColor"
            stroke="none"
          >
            T
          </text>
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
    case 'fibChannel':
      return (
        <svg {...ICON_PROPS}>
          <line x1="3" y1="16" x2="17" y2="4" />
          <line x1="3" y1="12.5" x2="17" y2="0.5" opacity="0.65" />
          <line x1="3" y1="19.5" x2="14" y2="10.5" opacity="0.65" />
        </svg>
      );
    case 'fibTimeZones':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="4" x2="4" y2="16" />
          <line x1="8" y1="4" x2="8" y2="16" opacity="0.85" />
          <line x1="12.5" y1="4" x2="12.5" y2="16" opacity="0.7" />
          <line x1="17" y1="4" x2="17" y2="16" opacity="0.55" />
        </svg>
      );
    case 'fibFan':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="17" y2="16" />
          <line x1="4" y1="16" x2="17" y2="10" opacity="0.8" />
          <line x1="4" y1="16" x2="17" y2="4" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'fibArc':
      return (
        <svg {...ICON_PROPS}>
          <path d="M4 16 A 6 6 0 0 1 16 16" />
          <path d="M6.5 16 A 3.5 3.5 0 0 1 13.5 16" opacity="0.7" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'fibSpiral':
      return (
        <svg {...ICON_PROPS}>
          <path d="M10 10 m-1.5 0 a1.5 1.5 0 1 1 3 0 a3 3 0 1 1 -6 0 a5 5 0 1 1 10 0 a7 7 0 1 1 -13 2.5" />
        </svg>
      );
    case 'fibWedge':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="17" y2="6" />
          <line x1="4" y1="16" x2="17" y2="15" />
          <line x1="4" y1="16" x2="17" y2="10.5" opacity="0.6" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
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
    case 'ellipse':
      return (
        <svg {...ICON_PROPS}>
          <ellipse cx="10" cy="10" rx="7" ry="5" />
        </svg>
      );
    case 'triangle':
      return (
        <svg {...ICON_PROPS}>
          <path d="M10 4.5 L16.5 15.5 L3.5 15.5 Z" />
        </svg>
      );
    case 'arc':
      return (
        <svg {...ICON_PROPS}>
          <path d="M3.5 14.5 A 7.5 7.5 0 0 1 16.5 14.5" />
          <circle cx="3.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'curve':
      return (
        <svg {...ICON_PROPS}>
          <path d="M3 16 Q 10 3 17 14" />
          <circle cx="3" cy="16" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="17" cy="14" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="15" y2="5" />
          <path d="M15 5 L11 5.8 M15 5 L14.2 9" />
        </svg>
      );
    case 'path':
      return (
        <svg {...ICON_PROPS}>
          <path d="M3.5 16 L8 7.5 L12 12.5 L16.5 5" />
          <circle cx="3.5" cy="16" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="8" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="5" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pen':
      return (
        <svg {...ICON_PROPS}>
          <path d="M3 16 C 7 5, 13 17, 17 6" />
        </svg>
      );
  }
}

function CursorIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5.5 3.5 L15.5 12 L11.3 12.8 L13.4 18 L11 19 L8.9 13.8 L5.5 17.2 Z" />
    </svg>
  );
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
  'relative flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b2b5be]';

/** Magnet button: taller, icon + current strength label underneath. */
const MAGNET_BUTTON_BASE =
  'relative flex h-11 w-9 shrink-0 flex-col items-center justify-center gap-px rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white';

/** Left accent bar marking the active tool / cursor. */
function ActiveBar() {
  return (
    <span
      className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[#2962ff]"
      aria-hidden="true"
    />
  );
}

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
      <button
        title="游標／選取（退出繪製模式）"
        onClick={() => onToolChange(null, false)}
        className={`${BUTTON_BASE} ${
          activeTool === null ? 'bg-[#2a2e39] text-[#2962ff]' : ''
        }`}
      >
        {activeTool === null && <ActiveBar />}
        <CursorIcon />
      </button>

      <span className="my-1 h-px w-7 shrink-0 bg-[#2a2e39]" />

      {TOOL_GROUPS.map((group, gi) => (
        <div
          key={group.title}
          className="flex flex-col items-center gap-0.5"
          role="group"
          aria-label={group.title}
        >
          {group.ids.map((id) => {
            const tool = TOOL_BY_ID.get(id);
            if (!tool) return null;
            const active = activeTool === id;
            return (
              <button
                key={id}
                title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
                onClick={(e) =>
                  onToolChange(active ? null : id, e.shiftKey)
                }
                onDoubleClick={() => onToolChange(id, true)}
                className={`${BUTTON_BASE} ${
                  active ? 'bg-[#2a2e39] text-[#2962ff]' : ''
                }`}
              >
                {active && <ActiveBar />}
                <ToolIcon tool={id} />
              </button>
            );
          })}
          {gi < TOOL_GROUPS.length - 1 && (
            <span className="my-1 h-px w-7 shrink-0 bg-[#2a2e39]" />
          )}
        </div>
      ))}

      <span className="my-1 h-px w-7 shrink-0 bg-[#2a2e39]" />

      <button
        onClick={cycleMagnet}
        title={`磁吸：${MAGNET_LABELS[magnet]}（點擊切換，關 → 弱 → 強）`}
        className={`${MAGNET_BUTTON_BASE} ${
          magnet !== 'off' ? 'bg-[#2a2e39] text-[#2962ff]' : ''
        }`}
      >
        <MagnetIcon />
        <span className="text-[8px] leading-none">
          {MAGNET_LABELS[magnet]}
        </span>
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
