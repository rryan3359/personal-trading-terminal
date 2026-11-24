'use client';

/**
 * DrawingBar.tsx — left vertical drawing toolbar (TradingView-style).
 *
 * Top: cursor/select tool (active when no drawing tool is armed;
 * clicking it exits drawing mode). Then one icon per tool GROUP
 * (trend lines, horizontal lines / channels, shapes, geometry,
 * freehand/annotation, Fibonacci, Pitchfork, Gann, patterns,
 * measure — 10 groups, 44 tools): each group shows its last-used
 * first tool if none used yet), with a small chevron. Clicking a
 * group opens a flyout panel to the right of the bar listing that
 * group's tools (icon + Chinese label); picking one arms it, closes
 * the panel and updates the group icon. Clicking the armed tool in
 * the panel disarms it. Double-click (or Shift+click) arms in
 * continuous mode. Clicking outside the panel or pressing Esc closes
 * it. Single-tool groups (rectangle, measure) render as a plain
 * button with no flyout. Bottom: magnet (click cycles off -> weak ->
 * strong, current strength shown under the icon) and clear.
 *
 * The vertical-line tools (verticalStraightLine, verticalSegment,
 * verticalRayLine) are deliberately NOT in any group: the group was
 * removed 2026-11-25, but the tools stay registered in
 * lib/chart-config.ts / lib/chart-theme.ts / Chart.tsx so drawings
 * saved earlier still render and stay editable.
 *
 * The flyout is rendered through a portal to document.body with
 * fixed positioning, so it is not clipped by the aside's vertical
 * scroll. Undo / redo live in the top Toolbar now (TradingView puts
 * them there).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DRAWING_TOOLS, type DrawingTool } from '@/lib/chart-config';
import { getMagnetMode, saveMagnetMode, type MagnetMode } from '@/lib/store';

/** Logical groups for the toolbar, in display order. */
const TOOL_GROUPS: Array<{ title: string; ids: DrawingTool[] }> = [
  { title: '趨勢線', ids: ['segment', 'straightLine', 'rayLine'] },
  { title: '水平線／通道', ids: ['horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'priceLine', 'simpleTag', 'parallelStraightLine', 'priceChannelLine'] },
  { title: '圖形', ids: ['rectangle'] },
  { title: '幾何', ids: ['ellipse', 'triangle', 'arc', 'curve', 'arrow', 'path', 'pen'] },
  { title: '徒手畫／標註', ids: ['brush', 'textAnnotation'] },
  { title: '斐波那契', ids: ['fibonacciRetracement', 'fibChannel', 'fibTimeZones', 'fibFan', 'fibArc', 'fibSpiral', 'fibWedge'] },
  { title: 'Pitchfork', ids: ['pitchfork', 'schiffPitchfork', 'modifiedSchiffPitchfork', 'insidePitchfork'] },
  { title: 'Gann', ids: ['gannFan', 'gannSquare', 'gannBox'] },
  { title: '形態', ids: ['headShoulders', 'elliottImpulse', 'elliottCorrection', 'abcdPattern', 'xabcdPattern', 'threeDrives'] },
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
    case 'pitchfork':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="17" y2="5" />
          <line x1="4" y1="16" x2="17" y2="10" />
          <line x1="4" y1="16" x2="17" y2="15" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'schiffPitchfork':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="17" y2="6" />
          <line x1="4" y1="16" x2="17" y2="14" />
          <line x1="10.5" y1="11" x2="17" y2="10" strokeWidth="2" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'modifiedSchiffPitchfork':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="17" y2="6" />
          <line x1="4" y1="16" x2="17" y2="14" />
          <line x1="7" y1="13.5" x2="17" y2="10" strokeWidth="2" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'insidePitchfork':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="17" y2="6" />
          <line x1="4" y1="16" x2="17" y2="14" />
          <line x1="11" y1="10" x2="17" y2="10" strokeWidth="2" />
          <circle cx="10.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'gannFan':
      return (
        <svg {...ICON_PROPS}>
          <line x1="4" y1="16" x2="17" y2="16" />
          <line x1="4" y1="16" x2="17" y2="11" opacity="0.8" />
          <line x1="4" y1="16" x2="17" y2="6" opacity="0.65" />
          <line x1="4" y1="16" x2="17" y2="3.5" />
          <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'gannSquare':
      return (
        <svg {...ICON_PROPS}>
          <rect x="3.5" y="3.5" width="13" height="13" />
          <line x1="10" y1="3.5" x2="10" y2="16.5" opacity="0.7" />
          <line x1="3.5" y1="10" x2="16.5" y2="10" opacity="0.7" />
          <line x1="3.5" y1="3.5" x2="16.5" y2="16.5" opacity="0.5" />
        </svg>
      );
    case 'gannBox':
      return (
        <svg {...ICON_PROPS}>
          <rect x="3.5" y="5" width="13" height="10" />
          <line x1="10" y1="5" x2="10" y2="15" opacity="0.7" />
          <line x1="3.5" y1="10" x2="16.5" y2="10" opacity="0.7" />
          <line x1="3.5" y1="5" x2="16.5" y2="15" opacity="0.5" />
          <line x1="3.5" y1="15" x2="16.5" y2="5" opacity="0.5" />
        </svg>
      );
    case 'headShoulders':
      return (
        <svg {...ICON_PROPS}>
          <polyline points="3,11 7,5 11,12 15,7 17,10" />
          <line x1="3" y1="15.5" x2="17" y2="15.5" strokeDasharray="2 2" opacity="0.6" />
        </svg>
      );
    case 'elliottImpulse':
      return (
        <svg {...ICON_PROPS}>
          <polyline points="3,15 6,10 8.5,12 11.5,7 14,9 17,4" />
        </svg>
      );
    case 'elliottCorrection':
      return (
        <svg {...ICON_PROPS}>
          <polyline points="3,5 8,12 11,8 17,14" />
        </svg>
      );
    case 'abcdPattern':
      return (
        <svg {...ICON_PROPS}>
          <polyline points="3,15 8,6 11,11 17,4" />
        </svg>
      );
    case 'xabcdPattern':
      return (
        <svg {...ICON_PROPS}>
          <polyline points="3,5 7,13 10,8 13,12 17,5" />
        </svg>
      );
    case 'threeDrives':
      return (
        <svg {...ICON_PROPS}>
          <polyline points="3,14 5.5,8 8,11 10.5,6 13,9 17,4" />
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

/** Small chevron marking a group button that opens a flyout. */
function FlyoutChevron() {
  return (
    <span
      className="pointer-events-none absolute bottom-[2px] right-[2px] text-[#787b86]"
      aria-hidden="true"
    >
      <svg width="7" height="7" viewBox="0 0 7 7" fill="currentColor">
        <path d="M1.2 1.2 L6 3.5 L1.2 5.8 Z" />
      </svg>
    </span>
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

interface FlyoutAnchor {
  top: number;
  right: number;
}

/**
 * Flyout panel for one tool group, portalled to document.body so the
 * aside's vertical scroll never clips it. Positioned fixed, to the
 * right of the group button, clamped inside the viewport.
 */
function GroupFlyout({
  group,
  anchor,
  activeTool,
  onSelect,
  onClose,
}: {
  group: { title: string; ids: DrawingTool[] };
  anchor: FlyoutAnchor;
  activeTool: DrawingTool | null;
  onSelect: (tool: DrawingTool, continuous: boolean) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top);

  // Clamp the panel inside the viewport once its height is known.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const maxTop = window.innerHeight - h - 8;
    setTop(Math.max(8, Math.min(anchor.top, maxTop)));
  }, [anchor.top]);

  return (
    <>
      {/* Transparent backdrop: any click outside the panel closes it. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label={group.title}
        className="fixed z-50 w-44 overflow-hidden rounded-md border border-[#2a2e39] bg-[#1e222d] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        style={{ left: anchor.right + 6, top }}
      >
        <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-[#787b86]">
          {group.title}
        </div>
        {group.ids.map((id) => {
          const tool = TOOL_BY_ID.get(id);
          if (!tool) return null;
          const active = activeTool === id;
          return (
            <button
              key={id}
              role="menuitem"
              title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
              onClick={(e) => onSelect(id, e.shiftKey)}
              onDoubleClick={() => onSelect(id, true)}
              className={`relative flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-[#2a2e39] hover:text-white max-md:py-3 ${
                active ? 'bg-[#2a2e39] text-[#2962ff]' : 'text-[#d1d4dc]'
              }`}
            >
              {active && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[#2962ff]"
                  aria-hidden="true"
                />
              )}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <ToolIcon tool={id} />
              </span>
              {tool.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function DrawingBar({
  activeTool,
  onToolChange,
  onClear,
}: DrawingBarProps) {
  const [magnet, setMagnet] = useState<MagnetMode>(() => getMagnetMode());
  /** Title of the group whose flyout is open, or null. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  /** Last tool picked per group (drives the group icon). */
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({});
  const [anchor, setAnchor] = useState<FlyoutAnchor | null>(null);
  const groupBtnRefs = useRef(new Map<string, HTMLButtonElement>());

  const cycleMagnet = () => {
    const next =
      MAGNET_ORDER[(MAGNET_ORDER.indexOf(magnet) + 1) % MAGNET_ORDER.length];
    setMagnet(next);
    saveMagnetMode(next);
  };

  // Esc / resize / any scroll closes the open flyout (its anchor moves).
  useEffect(() => {
    if (!openGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    const onMove = () => setOpenGroup(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [openGroup]);

  const openFlyout = (title: string) => {
    const el = groupBtnRefs.current.get(title);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ top: r.top, right: r.right });
    setOpenGroup(title);
  };

  /** Icon shown for a group: the armed tool if it is in this group,
   *  else the last tool picked from the group, else its first tool. */
  const displayedToolFor = (group: (typeof TOOL_GROUPS)[number]) => {
    if (activeTool && group.ids.includes(activeTool)) return activeTool;
    return lastUsed[group.title] ?? group.ids[0];
  };

  const handleSelect = (
    groupTitle: string,
    id: DrawingTool,
    continuous: boolean,
  ) => {
    setLastUsed((prev) => ({ ...prev, [groupTitle]: id }));
    setOpenGroup(null);
    if (!continuous && activeTool === id) {
      onToolChange(null, false);
    } else {
      onToolChange(id, continuous);
    }
  };

  const openGroupDef = openGroup
    ? TOOL_GROUPS.find((g) => g.title === openGroup) ?? null
    : null;

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

      {TOOL_GROUPS.map((group, gi) => {
        const displayed = displayedToolFor(group);
        const groupActive =
          activeTool !== null && group.ids.includes(activeTool);
        const isOpen = openGroup === group.title;
        // Single-tool groups need no flyout: plain button, old behaviour.
        if (group.ids.length === 1) {
          const id = group.ids[0];
          const tool = TOOL_BY_ID.get(id);
          if (!tool) return null;
          return (
            <div
              key={group.title}
              className="flex flex-col items-center gap-0.5"
              role="group"
              aria-label={group.title}
            >
              <button
                title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
                onClick={(e) =>
                  onToolChange(groupActive ? null : id, e.shiftKey)
                }
                onDoubleClick={() => onToolChange(id, true)}
                className={`${BUTTON_BASE} ${
                  groupActive ? 'bg-[#2a2e39] text-[#2962ff]' : ''
                }`}
              >
                {groupActive && <ActiveBar />}
                <ToolIcon tool={id} />
              </button>
              {gi < TOOL_GROUPS.length - 1 && (
                <span className="my-1 h-px w-7 shrink-0 bg-[#2a2e39]" />
              )}
            </div>
          );
        }
        return (
          <div
            key={group.title}
            className="flex flex-col items-center gap-0.5"
            role="group"
            aria-label={group.title}
          >
            <button
              ref={(el) => {
                if (el) groupBtnRefs.current.set(group.title, el);
                else groupBtnRefs.current.delete(group.title);
              }}
              title={`${group.title}（點擊展開工具選單）`}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => {
                if (isOpen) setOpenGroup(null);
                else openFlyout(group.title);
              }}
              onDoubleClick={() => {
                setOpenGroup(null);
                handleSelect(group.title, displayed, true);
              }}
              className={`${BUTTON_BASE} ${
                groupActive || isOpen ? 'bg-[#2a2e39] text-[#2962ff]' : ''
              }`}
            >
              {groupActive && <ActiveBar />}
              <ToolIcon tool={displayed} />
              <FlyoutChevron />
            </button>
            {gi < TOOL_GROUPS.length - 1 && (
              <span className="my-1 h-px w-7 shrink-0 bg-[#2a2e39]" />
            )}
          </div>
        );
      })}

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

      {openGroupDef && anchor &&
        createPortal(
          <GroupFlyout
            group={openGroupDef}
            anchor={anchor}
            activeTool={activeTool}
            onSelect={(id, continuous) =>
              handleSelect(openGroupDef.title, id, continuous)
            }
            onClose={() => setOpenGroup(null)}
          />,
          document.body,
        )}
    </aside>
  );
}
