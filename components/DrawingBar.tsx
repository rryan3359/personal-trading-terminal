'use client';

/**
 * DrawingBar.tsx — left vertical drawing toolbar (TradingView-style).
 *
 * Top: cursor/select tool (active when no drawing tool is armed;
 * clicking it exits drawing mode). Then a favorites button (star;
 * opens a flyout of starred tools, empty until something is
 * starred), then one icon per tool GROUP — 10 groups, 41 tools
 * (44 registered; the 3 vertical-line tools are hidden from the
 * toolbar per Ryan's decision, see below), per MASTER TASK §4.2
 * (trend lines, horizontal lines, channels, Fibonacci, Gann,
 * Pitchfork, geometric shapes, patterns,
 * text & annotations, measurement): each group shows its last-used
 * tool (armed > last-used > first), with a small chevron. Clicking
 * a group opens a flyout panel to the right of the bar listing that
 * group's tools (icon + Chinese label + star to toggle favorite);
 * picking one arms it, closes the panel and updates the group icon.
 * Clicking the armed tool in the panel disarms it. Double-click
 * (or Shift+click) arms in continuous mode. Clicking outside the
 * panel or pressing Esc closes it — the panel has no backdrop div
 * (a full-screen backdrop would swallow the second click of a
 * double-click on the group button, so closing is done by a
 * document-level pointerdown listener in capture phase instead:
 * a press whose target is outside both the panel
 * [data-flyout-panel] and the sidebar [data-drawing-bar] closes
 * the flyout). Single-tool groups (measure) render as a plain
 * button with no flyout, plus a small star button underneath to
 * toggle its favorite (same star style as the flyout items).
 * An outside press that closes the flyout is swallowed: it only
 * closes the flyout, exactly like the old backdrop did — nothing
 * underneath runs (no drawing point on the chart, no toolbar /
 * watchlist action). Two halves, both in the pointerdown branch:
 * stopPropagation + preventDefault on the capture-phase pointerdown
 * keeps the press from the canvas (and suppresses the
 * compatibility mousedown/mouseup), plus a one-shot capture
 * `click` listener, because Chrome still fires the click for the
 * same press even when pointerdown is canceled (verified with a
 * minimal CDP probe, verify/probe-pointer-swallow.mjs: all four
 * variants — pointerdown stop+prevent, prevent-only, mousedown
 * stop+prevent, stop-only — still delivered the click). Only the
 * primary button produces a click, so only it arms the
 * click-swallow; a right/middle press just closes. Presses on the
 * sidebar itself are NOT swallowed: the second press of a real
 * double-click on a group button must still reach that button,
 * or the click-toggle would break (React flushes the pointerdown
 * state update before the click handler reads isOpen).
 * Bottom: magnet (click cycles off -> weak -> strong, current
 * strength shown under the icon) and clear.
 *
 * Vertical lines (verticalStraightLine, verticalSegment,
 * verticalRayLine) are NOT on this toolbar: removed 2026-11-25 by
 * Ryan's decision, reaffirmed 2026-11-26 (the MASTER TASK §4.2
 * group-3 listing does not override it). The tools stay registered
 * in lib/chart-config.ts / lib/chart-theme.ts / Chart.tsx, so
 * drawings saved earlier still render and stay editable, and the
 * context menu "加入垂直線" still creates them. Stored favorites /
 * last-used entries naming them are filtered out on load (the
 * stored values are left untouched until the next save).
 *
 * Favorites (`ptt:favorite-tools`) and per-group last-used tools
 * (`ptt:last-used-tools`) persist in localStorage; both keys are
 * defined here in DrawingBar.tsx only, never in lib/store.ts.
 * Group tooltips show "Group — 最近使用：X" when a last-used tool
 * is recorded, otherwise just the group name. Single-clicking a
 * group still only opens its flyout (it does NOT arm the last-used
 * tool — that is the TradingView behaviour, pending Ryan's ruling).
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

/** Logical groups for the toolbar, in display order (MASTER TASK §4.2).
 *  Cursor & selection is the separate cursor button above, not a
 *  TOOL_GROUPS entry — so cursor + these 11 groups = 12 groups.
 *  43 of the 46 tools are in exactly one group; the 3 vertical-line
 *  tools (see TOOLBAR_HIDDEN_TOOLS) are registered but hidden from
 *  the toolbar per Ryan's decision, so they are in no group. Tool
 *  ids and registration are untouched. */
const TOOL_GROUPS: Array<{ title: string; ids: DrawingTool[] }> = [
  { title: '趨勢線', ids: ['segment', 'straightLine', 'rayLine'] },
  { title: '水平線', ids: ['horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'priceLine'] },
  { title: '通道', ids: ['parallelStraightLine', 'priceChannelLine', 'fibChannel'] },
  { title: '斐波那契', ids: ['fibonacciRetracement', 'fibTimeZones', 'fibFan', 'fibArc', 'fibSpiral', 'fibWedge'] },
  { title: 'Gann', ids: ['gannFan', 'gannSquare', 'gannBox'] },
  { title: 'Pitchfork', ids: ['pitchfork', 'schiffPitchfork', 'modifiedSchiffPitchfork', 'insidePitchfork'] },
  { title: '幾何圖形', ids: ['rectangle', 'ellipse', 'triangle', 'arc', 'curve', 'arrow', 'path', 'pen'] },
  { title: '形態', ids: ['headShoulders', 'elliottImpulse', 'elliottCorrection', 'abcdPattern', 'xabcdPattern', 'threeDrives'] },
  { title: '文字與註解', ids: ['brush', 'textAnnotation', 'simpleTag'] },
  { title: '日期範圍', ids: ['measure'] },
  { title: '部位', ids: ['longPosition', 'shortPosition'] },
];
const TOOL_BY_ID = new Map(DRAWING_TOOLS.map((t) => [t.id, t]));

/** Tools registered but hidden from the toolbar per Ryan's decision
 *  (removed 2026-11-25, reaffirmed 2026-11-26). They stay in
 *  DRAWING_TOOLS / chart-theme / Chart.tsx, so saved drawings still
 *  render and the context menu "加入垂直線" still creates them.
 *  Stored favorites / last-used entries naming them are filtered out
 *  on load below; the stored values themselves are left untouched
 *  until the next save. */
const TOOLBAR_HIDDEN_TOOLS: ReadonlySet<DrawingTool> = new Set([
  'verticalStraightLine',
  'verticalSegment',
  'verticalRayLine',
]);

/** Phase 2 Step 2 localStorage keys — defined here only, never in
 *  lib/store.ts. Favorites: array of tool ids, in starred order.
 *  Last-used: group title -> last-picked tool id in that group. */
const FAVORITE_TOOLS_KEY = 'ptt:favorite-tools';
const LAST_USED_TOOLS_KEY = 'ptt:last-used-tools';

function loadFavoriteTools(): DrawingTool[] {
  try {
    const raw = window.localStorage.getItem(FAVORITE_TOOLS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(DRAWING_TOOLS.map((t) => t.id));
    const out: DrawingTool[] = [];
    for (const v of parsed) {
      if (typeof v === 'string' && known.has(v as DrawingTool) && !TOOLBAR_HIDDEN_TOOLS.has(v as DrawingTool) && !out.includes(v as DrawingTool)) {
        out.push(v as DrawingTool);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function saveFavoriteTools(ids: DrawingTool[]): void {
  try {
    window.localStorage.setItem(FAVORITE_TOOLS_KEY, JSON.stringify(ids));
  } catch {
    // Storage full / unavailable (private mode) — non-fatal.
  }
}

function loadLastUsedTools(): Record<string, DrawingTool> {
  try {
    const raw = window.localStorage.getItem(LAST_USED_TOOLS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const known = new Set(DRAWING_TOOLS.map((t) => t.id));
    const out: Record<string, DrawingTool> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && known.has(v as DrawingTool) && !TOOLBAR_HIDDEN_TOOLS.has(v as DrawingTool)) {
        out[k] = v as DrawingTool;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveLastUsedTools(map: Record<string, DrawingTool>): void {
  try {
    window.localStorage.setItem(LAST_USED_TOOLS_KEY, JSON.stringify(map));
  } catch {
    // Storage full / unavailable (private mode) — non-fatal.
  }
}

export interface DrawingBarProps {
  activeTool: DrawingTool | null;
  /** Second arg: keep the tool armed after each drawing (double-click / Shift-click). */
  onToolChange: (tool: DrawingTool | null, continuous: boolean) => void;
  /** Remove all drawings on the current symbol. */
  onClear: () => void;
  /** Mobile full-tools sheet, controlled mode: when given, the sheet
   *  opens/closes from this value (page.tsx wires the bottom-bar
   *  pen button to it); when omitted, the internal state below is
   *  used (floating bar's ⋯ button still opens it). */
  sheetOpen?: boolean;
  /** Notified whenever the sheet opens/closes (internal button, X,
   *  backdrop, Esc, or a tool pick). Always called, controlled or not. */
  onSheetOpenChange?: (open: boolean) => void;
  /** Mobile floating bar's round undo button (TV f_001, below the
   *  bar). Wired by page.tsx to chart undo; when omitted the button
   *  renders disabled and does nothing. */
  onUndo?: () => void;
  /** Whether undo has anything to undo; drives the round undo
   *  button's disabled state. */
  canUndo?: boolean;
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
    case 'longPosition':
      return (
        <svg {...ICON_PROPS}>
          <rect x="4" y="4" width="12" height="12" rx="1" />
          <line x1="10" y1="13.5" x2="10" y2="7" />
          <path d="M10 7 L7.5 9.5 M10 7 L12.5 9.5" />
        </svg>
      );
    case 'shortPosition':
      return (
        <svg {...ICON_PROPS}>
          <rect x="4" y="4" width="12" height="12" rx="1" />
          <line x1="10" y1="6.5" x2="10" y2="13" />
          <path d="M10 13 L7.5 10.5 M10 13 L12.5 10.5" />
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

/** Curved undo arrow (mobile floating bar's round button, TV f_001). */
function UndoIcon() {
  return (
    <svg {...ICON_PROPS} width={18} height={18}>
      <path d="M7.5 4.5 L3.5 8.5 L7.5 12.5" />
      <path d="M3.5 8.5 H12 a4.5 4.5 0 0 1 0 9 H9" />
    </svg>
  );
}

/** Horizontal "⋯" (opens the full tool list on mobile). */
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

/** 6-dot grip handle (drags the floating tools bar on mobile). */
function GripIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="13" cy="5" r="1.5" />
      <circle cx="7" cy="10" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <circle cx="7" cy="15" r="1.5" />
      <circle cx="13" cy="15" r="1.5" />
    </svg>
  );
}

/** Mobile compact bar: tools shown when nothing is starred yet. */
const DEFAULT_COMPACT_TOOLS: DrawingTool[] = [
  'segment',
  'horizontalStraightLine',
  'rectangle',
];

/** Floating tools bar position (mobile), persisted in localStorage. */
const FLOATING_TOOLS_POS_KEY = 'ptt:mobile-tools-pos';
/** Bar width (px) and the bottom clearance (px) the drag clamp keeps
 *  free so the bar can never cover the bottom capsules. */
const FLOAT_W = 40;
const FLOAT_BOTTOM_CLEAR = 140;

function loadFloatingToolsPos(): { x: number; y: number } | null {
  try {
    const raw = window.localStorage.getItem(FLOATING_TOOLS_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

function saveFloatingToolsPos(p: { x: number; y: number }): void {
  try {
    window.localStorage.setItem(FLOATING_TOOLS_POS_KEY, JSON.stringify(p));
  } catch {
    // Storage full / unavailable — non-fatal.
  }
}

/** Clamp a floating-bar position into the viewport (keeps the bar
 *  fully visible and clear of the bottom capsules). */
function clampFloatPos(p: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - FLOAT_W)),
    y: Math.min(
      Math.max(0, p.y),
      Math.max(0, window.innerHeight - FLOAT_BOTTOM_CLEAR),
    ),
  };
}

/** Display order for compact-bar favorites: group order, then tool
 *  order within the group (not starred order). */
function sortToolsByGroup(ids: DrawingTool[]): DrawingTool[] {
  const order = new Map<DrawingTool, [number, number]>();
  TOOL_GROUPS.forEach((g, gi) =>
    g.ids.forEach((id, ii) => order.set(id, [gi, ii])),
  );
  return [...ids].sort((a, b) => {
    const [ga, ia] = order.get(a) ?? [999, 999];
    const [gb, ib] = order.get(b) ?? [999, 999];
    return ga - gb || ia - ib;
  });
}

/**
 * Mobile bottom sheet with the full tool list (all 10 groups), each
 * tool with its favorite star — same state and toggles as the desktop
 * flyouts. Picking a tool arms it and closes the sheet.
 */
/** TV-style sheet tabs (f_003 / f_004): 7 tabs, ids derived from
 *  TOOL_GROUPS by title so the mapping can never drift from the
 *  toolbar groups. TOOL_GROUPS itself is untouched. */
const SHEET_TAB_DEFS: Array<{ id: string; label: string; titles: string[] }> = [
  { id: 'favorites', label: '收藏', titles: [] },
  { id: 'trend', label: '趨勢線工具', titles: ['趨勢線', '水平線', '通道', 'Pitchfork'] },
  { id: 'fib-gann', label: '江恩和斐波那契', titles: ['斐波那契', 'Gann'] },
  { id: 'patterns', label: '形態', titles: ['形態'] },
  { id: 'forecast', label: '預測和測量', titles: ['日期範圍', '部位'] },
  { id: 'geometry', label: '幾何圖形', titles: ['幾何圖形'] },
  { id: 'annotation', label: '註解', titles: ['文字與註解'] },
];

function sheetTabToolIds(tabId: string, favorites: DrawingTool[]): DrawingTool[] {
  if (tabId === 'favorites') return favorites;
  const def = SHEET_TAB_DEFS.find((t) => t.id === tabId);
  if (!def) return [];
  return TOOL_GROUPS.filter((g) => def.titles.includes(g.title)).flatMap((g) => g.ids);
}

/**
 * Mobile bottom sheet with the full tool list, TV-style (f_003):
 * centered 「繪圖」 title + round X, search bar, horizontally
 * scrollable category tabs, 3-column grid of dark cards (icon +
 * label, orange star top-right when starred). Picking a card arms
 * the tool and closes the sheet; the star only toggles favorite
 * (writes ptt:favorite-tools, never arms a tool).
 */
function FullToolsSheet({
  favorites,
  activeTool,
  onSelect,
  onToggleFavorite,
  onClose,
}: {
  favorites: DrawingTool[];
  activeTool: DrawingTool | null;
  onSelect: (tool: DrawingTool, continuous: boolean) => void;
  onToggleFavorite: (tool: DrawingTool) => void;
  onClose: () => void;
}) {
  const [tabId, setTabId] = useState<string>(() =>
    favorites.length > 0 ? 'favorites' : 'trend',
  );
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const q = query.trim().toLowerCase();
  // Searching overrides the active tab: match label or tool id.
  const visibleIds: DrawingTool[] =
    q === ''
      ? sheetTabToolIds(tabId, favorites)
      : DRAWING_TOOLS.filter(
          (t) =>
            !TOOLBAR_HIDDEN_TOOLS.has(t.id) &&
            (t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)),
        ).map((t) => t.id);
  return createPortal(
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-label="繪圖"
      data-testid="drawing-sheet"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute bottom-0 left-0 right-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-[#2a2e39] bg-[#131722]/80 px-4 pb-6 pt-2 backdrop-blur-xl">
        <div className="relative flex shrink-0 items-center justify-center py-2">
          <span className="text-[15px] font-semibold text-white">繪圖</span>
          <button
            onClick={onClose}
            aria-label="關閉"
            data-testid="drawing-sheet-close"
            className="absolute right-0 flex h-8 w-8 items-center justify-center rounded-full bg-[#2a2e39] text-[#b2b5be] hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="relative mb-2 shrink-0">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#787b86]"
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="9" cy="9" r="5.5" />
              <line x1="13.5" y1="13.5" x2="17" y2="17" />
            </svg>
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋"
            aria-label="搜尋繪圖工具"
            data-testid="drawing-sheet-search"
            className="h-10 w-full rounded-full border border-[#2a2e39] bg-[#1e222d] pl-9 pr-3 text-[14px] text-white placeholder-[#787b86] outline-none focus:border-[#2962ff]"
          />
        </div>
        <div
          role="tablist"
          aria-label="繪圖工具分類"
          className="mb-3 flex shrink-0 gap-1 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {SHEET_TAB_DEFS.map((tab) => {
            const active = q === '' && tabId === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                data-testid={`drawing-sheet-tab-${tab.id}`}
                onClick={() => {
                  setTabId(tab.id);
                  setQuery('');
                }}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] ${
                  active
                    ? 'bg-[#2a2e39] font-medium text-white'
                    : 'text-[#787b86] hover:text-[#d1d4dc]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleIds.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[#787b86]">
              {q !== ''
                ? `找不到符合「${query.trim()}」的工具`
                : tabId === 'favorites'
                  ? '尚未收藏，點卡片右上角的星號收藏'
                  : '此分類沒有工具'}
            </div>
          ) : (
            <div
              className="grid grid-cols-3 gap-2"
              data-testid="drawing-sheet-grid"
            >
              {visibleIds.map((id) => {
                const tool = TOOL_BY_ID.get(id);
                if (!tool) return null;
                const active = activeTool === id;
                const isFavorite = favorites.includes(id);
                return (
                  <div
                    key={id}
                    className={`relative rounded-lg border ${
                      active
                        ? 'border-[#2962ff] bg-[#2a2e39]'
                        : 'border-[#2a2e39] bg-[#1e222d]'
                    }`}
                  >
                    <button
                      onClick={() => onSelect(id, false)}
                      data-testid={`drawing-sheet-card-${id}`}
                      aria-label={tool.label}
                      className="flex w-full flex-col items-center gap-1.5 px-1 py-3 text-[#d1d4dc]"
                    >
                      <span className="flex h-6 w-6 items-center justify-center">
                        <ToolIcon tool={id} />
                      </span>
                      <span className="text-center text-[12px] leading-tight">
                        {tool.label}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={
                        isFavorite
                          ? `取消收藏 ${tool.label}`
                          : `收藏 ${tool.label}`
                      }
                      aria-pressed={isFavorite}
                      title={
                        isFavorite
                          ? `取消收藏 ${tool.label}`
                          : `收藏 ${tool.label}`
                      }
                      data-testid={`drawing-sheet-star-${id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(id);
                      }}
                      className={`absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded hover:bg-[#2a2e39] ${
                        isFavorite
                          ? 'text-[#ff9800]'
                          : 'text-[#787b86] hover:text-white'
                      }`}
                    >
                      <StarIcon filled={isFavorite} size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Star for the favorites button / flyout favorite toggles. */
function StarIcon({ filled, size = 14 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 2.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 15.9l-5.2 2.7 1-5.8L1.5 8.7l5.9-.9z" />
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

/** Narrow (40px) variant for the mobile floating bar (TV f_001). */
const FLOAT_BUTTON_BASE =
  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b2b5be]';

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
  favorites,
  onSelect,
  onToggleFavorite,
}: {
  group: { title: string; ids: DrawingTool[] };
  anchor: FlyoutAnchor;
  activeTool: DrawingTool | null;
  favorites: DrawingTool[];
  onSelect: (tool: DrawingTool, continuous: boolean) => void;
  onToggleFavorite: (tool: DrawingTool) => void;
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

  // No backdrop div here on purpose: a full-screen backdrop sits
  // above the sidebar button, so the second press of a real
  // double-click on a group button would land on the backdrop and
  // close the flyout instead of reaching the button (no dblclick
  // ever fires). Outside-press closing lives in DrawingBar's
  // document-level pointerdown listener; the panel is marked with
  // data-flyout-panel so that listener can tell it apart.
  return (
    <div
      ref={panelRef}
      data-flyout-panel
      role="menu"
      aria-label={group.title}
      className="fixed z-50 w-44 overflow-hidden rounded-md border border-[#2a2e39] bg-[#1e222d]/80 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      style={{ left: anchor.right + 6, top }}
    >
        <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-[#787b86]">
          {group.title}
        </div>
        {group.ids.length === 0 && (
          <div className="px-3 py-2 text-[13px] text-[#787b86]">
            尚未收藏工具
          </div>
        )}
        {group.ids.map((id) => {
          const tool = TOOL_BY_ID.get(id);
          if (!tool) return null;
          const active = activeTool === id;
          const isFavorite = favorites.includes(id);
          return (
            <div
              key={id}
              className={`relative flex w-full items-center hover:bg-[#2a2e39] hover:text-white ${
                active ? 'bg-[#2a2e39] text-[#2962ff]' : 'text-[#d1d4dc]'
              }`}
            >
              {active && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[#2962ff]"
                  aria-hidden="true"
                />
              )}
              <button
                role="menuitem"
                title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
                onClick={(e) => onSelect(id, e.shiftKey)}
                onDoubleClick={() => onSelect(id, true)}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13px] max-md:py-3"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <ToolIcon tool={id} />
                </span>
                {tool.label}
              </button>
              <button
                type="button"
                aria-label={isFavorite ? `取消收藏 ${tool.label}` : `收藏 ${tool.label}`}
                aria-pressed={isFavorite}
                title={isFavorite ? `取消收藏 ${tool.label}` : `收藏 ${tool.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(id);
                }}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-[#2a2e39] ${
                  isFavorite ? 'text-[#ff9800]' : 'text-[#787b86] hover:text-white'
                }`}
              >
                <StarIcon filled={isFavorite} />
              </button>
            </div>
          );
        })}
    </div>
  );
}

export default function DrawingBar({
  activeTool,
  onToolChange,
  onClear,
  sheetOpen: sheetOpenProp,
  onSheetOpenChange,
  onUndo,
  canUndo,
}: DrawingBarProps) {
  const [magnet, setMagnet] = useState<MagnetMode>(() => getMagnetMode());
  /** Title of the group whose flyout is open, or null. '收藏' is the
   *  favorites flyout (not a TOOL_GROUPS entry). */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  /** Starred tool ids, in starred order (persisted, ptt:favorite-tools). */
  const [favorites, setFavorites] = useState<DrawingTool[]>(() => loadFavoriteTools());
  /** Last tool picked per group (drives the group icon + tooltip).
   *  Persisted (ptt:last-used-tools); was session-only useState. */
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>(() => loadLastUsedTools());
  const [anchor, setAnchor] = useState<FlyoutAnchor | null>(null);
  /** Mobile: full tool list bottom sheet open. Controlled when
   *  sheetOpen is passed (page.tsx), uncontrolled otherwise. */
  const [internalSheetOpen, setInternalSheetOpen] = useState(false);
  const fullSheetOpen = sheetOpenProp ?? internalSheetOpen;
  const setFullSheetOpen = (open: boolean) => {
    if (sheetOpenProp === undefined) setInternalSheetOpen(open);
    onSheetOpenChange?.(open);
  };
  /** Mobile floating tools bar position (viewport px). Null until
   *  mounted: the default (right edge, ~35% down) needs the
   *  viewport size, and the page is prerendered — a window read
   *  during render breaks the build and would hydrate-mismatch.
   *  Same one-time mount-sync pattern as the debug-touch overlay. */
  const [floatPos, setFloatPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const floatPosRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const floatDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const floatBarRef = useRef<HTMLDivElement | null>(null);

  // Position the floating bar on mount (saved position, else the
  // LEFT-edge default), clamped into the viewport; keep it inside
  // on resize / rotation. Left edge by default because the price
  // axis occupies the right edge — a bar parked over the axis
  // intercepts axis drags (item 7 cause 1: the bar covered the
  // middle of the axis). A stored position is still honoured.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount
     sync from localStorage + viewport size (external systems); a
     lazy initializer would read window during SSR and mismatch
     hydration (same as the debug-touch overlay). */
  useEffect(() => {
    const initial = clampFloatPos(
      loadFloatingToolsPos() ?? {
        x: 8,
        y: Math.round(window.innerHeight * 0.35),
      },
    );
    floatPosRef.current = initial;
    setFloatPos(initial);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep the floating bar inside the viewport on resize / rotation.
  useEffect(() => {
    const onResize = () =>
      setFloatPos((prev) => (prev ? clampFloatPos(prev) : prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** Grip drag: Pointer Events + setPointerCapture, touch-action none
   *  on the handle, so the drag never becomes a page scroll. Position
   *  persists on release. */
  const onFloatHandlePointerDown = (e: React.PointerEvent) => {
    const el = floatBarRef.current;
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone; the drag still tracks by pointerId.
    }
    floatDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: floatPosRef.current.x,
      origY: floatPosRef.current.y,
    };
  };
  const onFloatHandlePointerMove = (e: React.PointerEvent) => {
    const d = floatDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const next = clampFloatPos({
      x: d.origX + e.clientX - d.startX,
      y: d.origY + e.clientY - d.startY,
    });
    floatPosRef.current = next;
    setFloatPos(next);
  };
  const onFloatHandlePointerUp = (e: React.PointerEvent) => {
    const d = floatDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    floatDragRef.current = null;
    saveFloatingToolsPos(floatPosRef.current);
  };
  /** Mobile compact bar: starred tools in group order, or the 3
   *  defaults when nothing is starred yet. */
  const compactTools =
    favorites.length > 0
      ? sortToolsByGroup(favorites)
      : DEFAULT_COMPACT_TOOLS;
  const groupBtnRefs = useRef(new Map<string, HTMLButtonElement>());

  const cycleMagnet = () => {
    const next =
      MAGNET_ORDER[(MAGNET_ORDER.indexOf(magnet) + 1) % MAGNET_ORDER.length];
    setMagnet(next);
    saveMagnetMode(next);
  };

  // Esc / resize / any scroll closes the open flyout (its anchor moves).
  // A press outside the panel AND outside the sidebar also closes it:
  // document-level pointerdown in capture phase (no backdrop div —
  // see GroupFlyout). That press is swallowed (see the handler: the
  // pointerdown half keeps it from the canvas, and a one-shot
  // capture click listener eats the click Chrome still fires for
  // the same press) — so it only closes the flyout, like the old
  // backdrop. Presses on the sidebar itself are left to the
  // sidebar buttons (toggle / switch flyout, arm a tool), so the
  // second press of a real double-click on a group button still
  // reaches that button.
  useEffect(() => {
    if (!openGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    const onMove = () => setOpenGroup(null);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-flyout-panel]')) return;
      if (target?.closest('[data-drawing-bar]')) return;
      // Swallow the press: it only closes the flyout (old backdrop
      // semantics). stopPropagation in capture keeps it from the
      // canvas (no drawing point / selection change / pan) and
      // preventDefault suppresses the compatibility mousedown /
      // mouseup — but Chrome still fires the click for the same
      // press, so the click is swallowed separately by a one-shot
      // capture listener added here (probe-verified: pointerdown
      // preventDefault alone does NOT stop the click).
      e.stopPropagation();
      e.preventDefault();
      setOpenGroup(null);
      // Only the primary button produces a click event; a right /
      // middle press just closes the flyout and arms nothing.
      if (e.button !== 0) return;
      const swallowClick = (ce: MouseEvent) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      const dropSwallow = () => {
        document.removeEventListener('click', swallowClick, true);
      };
      document.addEventListener('click', swallowClick, { capture: true, once: true });
      // The click for this press is dispatched in a LATER task than
      // pointerup (probe-verified: a microtask queued from pointerup
      // runs before the click and would drop the listener too early),
      // so the drop is a short timeout measured from pointerup;
      // pointercancel / window blur mean no click is coming, so the
      // one-shot listener is dropped there instead of lingering to
      // eat a later, unrelated click.
      document.addEventListener('pointerup', () => { window.setTimeout(dropSwallow, 100); }, { capture: true, once: true });
      document.addEventListener('pointercancel', dropSwallow, { capture: true, once: true });
      window.addEventListener('blur', dropSwallow, { once: true });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
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
    const last = lastUsed[group.title];
    // A stale last-used entry (e.g. recorded before the tool left the
    // toolbar) must never surface a hidden tool as the group icon.
    return last && group.ids.includes(last) ? last : group.ids[0];
  };

  /** Record a pick as the owning group's last-used tool (persisted).
   *  The owning group is derived from the tool id, so picks made from
   *  the favorites flyout still update the right group's icon. */
  const recordLastUsed = (id: DrawingTool) => {
    const owner = TOOL_GROUPS.find((g) => g.ids.includes(id));
    if (!owner) return;
    setLastUsed((prev) => {
      const next = { ...prev, [owner.title]: id };
      saveLastUsedTools(next);
      return next;
    });
  };

  const toggleFavorite = (id: DrawingTool) => {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((f) => f !== id)
        : [...prev, id];
      saveFavoriteTools(next);
      return next;
    });
  };

  /** Group-button tooltip: "Group — 最近使用：X", or just the group
   *  name when nothing has been picked from it yet. */
  const groupTitle = (group: (typeof TOOL_GROUPS)[number]) => {
    const last = lastUsed[group.title];
    if (!last || !group.ids.includes(last)) return group.title;
    const label = TOOL_BY_ID.get(last)?.label ?? last;
    return `${group.title} — 最近使用：${label}`;
  };

  const handleSelect = (id: DrawingTool, continuous: boolean) => {
    recordLastUsed(id);
    setOpenGroup(null);
    if (!continuous && activeTool === id) {
      onToolChange(null, false);
    } else {
      onToolChange(id, continuous);
    }
  };

  const openGroupDef =
    openGroup === '收藏'
      ? { title: '收藏', ids: favorites }
      : openGroup
        ? TOOL_GROUPS.find((g) => g.title === openGroup) ?? null
        : null;
  const favoritesActive =
    activeTool !== null && favorites.includes(activeTool);

  return (
    <>
    <aside
      data-drawing-bar
      className="hidden w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[#2a2e39] bg-[#131722] py-1 md:flex md:w-11"
    >
      {/* Desktop only: the fixed rail is gone on mobile (Ryan
          2026-11-26 — the tools float instead, see below). The
          `contents` keeps the children as direct flex items of the
          aside, exactly as before. */}
      <div className="hidden w-full flex-col items-center gap-0.5 md:contents">
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

      {/* Favorites: star button opening a flyout of starred tools. */}
      <div
        className="flex flex-col items-center gap-0.5"
        role="group"
        aria-label="收藏"
      >
        <button
          ref={(el) => {
            if (el) groupBtnRefs.current.set('收藏', el);
            else groupBtnRefs.current.delete('收藏');
          }}
          title={
            favorites.length > 0
              ? `收藏 — ${favorites.length} 個工具（點擊展開）`
              : '收藏（點擊展開已收藏工具）'
          }
          aria-haspopup="menu"
          aria-expanded={openGroup === '收藏'}
          onClick={() => {
            if (openGroup === '收藏') setOpenGroup(null);
            else openFlyout('收藏');
          }}
          className={`${BUTTON_BASE} ${
            favoritesActive || openGroup === '收藏'
              ? 'bg-[#2a2e39] text-[#ff9800]'
              : ''
          }`}
        >
          {favoritesActive && <ActiveBar />}
          <StarIcon filled={favorites.length > 0} size={20} />
          <FlyoutChevron />
        </button>
        <span className="my-1 h-px w-7 shrink-0 bg-[#2a2e39]" />
      </div>

      {TOOL_GROUPS.map((group, gi) => {
        const displayed = displayedToolFor(group);
        const groupActive =
          activeTool !== null && group.ids.includes(activeTool);
        const isOpen = openGroup === group.title;
        // Single-tool groups need no flyout: plain button, old behaviour,
        // plus a small star underneath to toggle its favorite (the
        // flyout-item star has no home here — this is the only group
        // without a flyout).
        if (group.ids.length === 1) {
          const id = group.ids[0];
          const tool = TOOL_BY_ID.get(id);
          if (!tool) return null;
          const isFavorite = favorites.includes(id);
          return (
            <div
              key={group.title}
              className="flex flex-col items-center gap-0.5"
              role="group"
              aria-label={group.title}
            >
              <button
                title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
                onClick={(e) => {
                  recordLastUsed(id);
                  onToolChange(groupActive ? null : id, e.shiftKey);
                }}
                onDoubleClick={() => {
                  recordLastUsed(id);
                  onToolChange(id, true);
                }}
                className={`${BUTTON_BASE} ${
                  groupActive ? 'bg-[#2a2e39] text-[#2962ff]' : ''
                }`}
              >
                {groupActive && <ActiveBar />}
                <ToolIcon tool={id} />
              </button>
              <button
                type="button"
                aria-label={isFavorite ? `取消收藏 ${tool.label}` : `收藏 ${tool.label}`}
                aria-pressed={isFavorite}
                title={isFavorite ? `取消收藏 ${tool.label}` : `收藏 ${tool.label}`}
                onClick={() => toggleFavorite(id)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[#2a2e39] ${
                  isFavorite ? 'text-[#ff9800]' : 'text-[#787b86] hover:text-white'
                }`}
              >
                <StarIcon filled={isFavorite} size={12} />
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
              title={groupTitle(group)}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => {
                if (isOpen) setOpenGroup(null);
                else openFlyout(group.title);
              }}
              onDoubleClick={() => {
                setOpenGroup(null);
                handleSelect(displayed, true);
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
      </div>

      {openGroupDef && anchor &&
        createPortal(
          <GroupFlyout
            group={openGroupDef}
            anchor={anchor}
            activeTool={activeTool}
            favorites={favorites}
            onSelect={(id, continuous) => handleSelect(id, continuous)}
            onToggleFavorite={toggleFavorite}
          />,
          document.body,
        )}
      {fullSheetOpen && (
        <FullToolsSheet
          favorites={favorites}
          activeTool={activeTool}
          onSelect={(id, continuous) => {
            setFullSheetOpen(false);
            handleSelect(id, continuous);
          }}
          onToggleFavorite={toggleFavorite}
          onClose={() => setFullSheetOpen(false)}
        />
      )}
    </aside>

    {/* Mobile (<md): floating draggable favorites bar (Ryan
        2026-11-26 — replaces the fixed left rail, like the
        TradingView mobile toolbar in his screenshot). Narrow 40px,
        dark, icon-only, grip on top; only the starred tools show
        (defaults when nothing is starred yet); drag by the grip
        handle, position persists in localStorage. The cursor button
        exits drawing mode; ⋯ opens the full tool sheet. A round
        undo button sits below the bar (TV f_001); it is wired by
        page.tsx via onUndo/canUndo and disabled until then. The
        ⋯ sheet's existing undo is untouched. */}
    {/* Rendered only after mount (floatPos null on the server). */}
    {floatPos !== null && (
    <div
      data-drawing-bar
      data-testid="mobile-floating-tools"
      className="fixed z-30 flex w-10 flex-col items-center md:hidden"
      style={{ left: floatPos.x, top: floatPos.y, touchAction: 'none' }}
    >
      <div
        ref={floatBarRef}
        className="flex w-10 flex-col items-center gap-0.5 rounded-xl border border-[#2a2e39] bg-[#1e222d]/75 py-1 shadow-2xl backdrop-blur-xl"
        onPointerMove={onFloatHandlePointerMove}
        onPointerUp={onFloatHandlePointerUp}
        onPointerCancel={onFloatHandlePointerUp}
      >
        <div
          data-testid="mobile-floating-handle"
          role="button"
          aria-label="拖動工具列"
          title="拖動工具列"
          className="flex h-5 w-full cursor-grab touch-none items-center justify-center text-[#787b86] active:cursor-grabbing"
          onPointerDown={onFloatHandlePointerDown}
        >
          <GripIcon />
        </div>
        <button
          title="游標／選取（退出繪製模式）"
          aria-label="游標／選取"
          onClick={() => onToolChange(null, false)}
          className={`${FLOAT_BUTTON_BASE} ${
            activeTool === null ? 'bg-[#2a2e39] text-[#2962ff]' : ''
          }`}
        >
          {activeTool === null && <ActiveBar />}
          <CursorIcon />
        </button>
        <span className="my-0.5 h-px w-6 shrink-0 bg-[#2a2e39]" />
        {compactTools.map((id) => {
          const tool = TOOL_BY_ID.get(id);
          if (!tool) return null;
          const active = activeTool === id;
          return (
            <button
              key={id}
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={active}
              data-testid={`floating-tool-${id}`}
              onClick={() => handleSelect(id, false)}
              className={`${FLOAT_BUTTON_BASE} ${
                active ? 'bg-[#2a2e39] text-[#2962ff]' : ''
              }`}
            >
              {active && <ActiveBar />}
              <ToolIcon tool={id} />
            </button>
          );
        })}
        <span className="my-0.5 h-px w-6 shrink-0 bg-[#2a2e39]" />
        <button
          onClick={() => setFullSheetOpen(true)}
          title="全部畫線工具"
          aria-label="全部畫線工具"
          data-testid="floating-all-tools"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2a2e39] bg-[#262b38] text-[#b2b5be] hover:text-white"
        >
          <DotsIcon />
        </button>
      </div>
      {/* Round undo button below the bar (TV f_001, bottom-left
          circle). Disabled until page.tsx wires onUndo + canUndo;
          the ⋯ sheet's existing undo is untouched. */}
      <button
        onClick={() => onUndo?.()}
        disabled={!canUndo}
        title="復原"
        aria-label="復原"
        data-testid="floating-undo"
        className="mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2a2e39] bg-[#1e222d]/75 text-[#b2b5be] shadow-2xl backdrop-blur-xl hover:text-white disabled:opacity-30 disabled:hover:text-[#b2b5be]"
      >
        <UndoIcon />
      </button>
    </div>
    )}
    </>
  );
}
