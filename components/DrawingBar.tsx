'use client';

/**
 * DrawingBar.tsx — drawing toolbar (TradingView-style).
 *
 * Desktop (>=md) and mobile (<md) each get the same draggable
 * floating favorites bar (Ryan 2026-11-26 mobile, 2026-11-28
 * desktop): narrow 40px, dark, icon-only, grip on top; only the
 * starred tools show (defaults when nothing is starred yet); drag
 * by the grip handle, position persists in localStorage — mobile
 * under `ptt:mobile-tools-pos`, desktop under its own key
 * `ptt:floating-tools-pos-desktop` (viewports differ, so the keys
 * must not be shared). The cursor button exits drawing mode; ⋯
 * opens the full tool list (mobile: bottom sheet; desktop:
 * frosted panel anchored to the bar's right). A round undo button
 * sits below the bar (TV f_001), wired by page.tsx via
 * onUndo/canUndo. Desktop keeps magnet + clear on the bar (they
 * lived on the old fixed rail).
 *
 * Favorites (`ptt:favorite-tools`) and per-group last-used tools
 * (`ptt:last-used-tools`) persist in localStorage; both keys are
 * defined here in DrawingBar.tsx only, never in lib/store.ts.
 * The favorites list is shared between the desktop and mobile
 * bars (one state); both bars show them in group order.
 *
 * The full tool list (both surfaces) has 7 tabs covering all 11
 * groups (41 tools; the 3 vertical-line tools are hidden per
 * Ryan's decision, see below), each tool with a star to toggle
 * favorite; picking one arms it and closes the panel/sheet.
 * Double-click (or Shift+click) arms in continuous mode.
 *
 * Vertical lines (verticalStraightLine, verticalSegment,
 * verticalRayLine) are NOT on this toolbar: removed 2026-11-25 by
 * Ryan's decision, reaffirmed 2026-11-26. The tools stay registered
 * in lib/chart-config.ts / lib/chart-theme.ts / Chart.tsx, so
 * drawings saved earlier still render and stay editable, and the
 * context menu "加入垂直線" still creates them. Stored favorites /
 * last-used entries naming them are filtered out on load (the
 * stored values are left untouched until the next save).
 *
 * Undo / redo live in the top Toolbar now (TradingView puts them
 * there).
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

/** Floating tools bar position (desktop), persisted in localStorage
 *  under its own key (Ryan 2026-11-28: desktop gets the same
 *  draggable favorites bar as mobile). Never shared with the
 *  mobile key: the viewports differ, so a stored mobile position
 *  would park the desktop bar in the wrong place. */
const DESK_FLOATING_TOOLS_POS_KEY = 'ptt:floating-tools-pos-desktop';

function loadDeskFloatingToolsPos(): { x: number; y: number } | null {
  try {
    const raw = window.localStorage.getItem(DESK_FLOATING_TOOLS_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

function saveDeskFloatingToolsPos(p: { x: number; y: number }): void {
  try {
    window.localStorage.setItem(DESK_FLOATING_TOOLS_POS_KEY, JSON.stringify(p));
  } catch {
    // Storage full / unavailable — non-fatal.
  }
}

/** Clamp a desktop floating-bar position into the viewport, keeping
 *  the whole bar visible: y stays below the top toolbar (44px) and
 *  above the bottom bars (RangeBar + StatusBar), using the bar's
 *  measured height (400px estimate before the first render, when
 *  the height is still unknown). Returns the same object when nothing
 *  changed, so re-clamp effects never loop. */
function clampDeskFloatPos(
  p: { x: number; y: number },
  barH: number,
): { x: number; y: number } {
  const h = barH > 0 ? barH : 400;
  const nx = Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - FLOAT_W));
  const ny = Math.min(
    Math.max(44, p.y),
    Math.max(44, window.innerHeight - h - 8),
  );
  return nx === p.x && ny === p.y ? p : { x: nx, y: ny };
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

/**
 * Desktop full tool list panel (Ryan 2026-11-28: the desktop
 * floating bar's ⋯ opens this instead of the mobile bottom sheet).
 * Same tabs / search / star toggles as FullToolsSheet (reuses
 * SHEET_TAB_DEFS + sheetTabToolIds), but a desktop frosted panel
 * anchored to the right of the floating bar (like GroupFlyout was):
 * fixed, 380px wide, max 72vh, scrollable grid. Closes on the
 * backdrop press, Esc, resize, or a tool pick (via onSelect).
 */
function DesktopToolsPanel({
  favorites,
  activeTool,
  onSelect,
  onToggleFavorite,
  onClose,
  anchorLeft,
  anchorTop,
}: {
  favorites: DrawingTool[];
  activeTool: DrawingTool | null;
  onSelect: (tool: DrawingTool, continuous: boolean) => void;
  onToggleFavorite: (tool: DrawingTool) => void;
  onClose: () => void;
  anchorLeft: number;
  anchorTop: number;
}) {
  const [tabId, setTabId] = useState<string>(() =>
    favorites.length > 0 ? 'favorites' : 'trend',
  );
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchorTop);

  // Clamp the panel inside the viewport once its height is known
  // (same pattern as GroupFlyout).
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const maxTop = window.innerHeight - h - 8;
    setTop(Math.max(8, Math.min(anchorTop, maxTop)));
  }, [anchorTop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onResize = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
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
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        data-desktop-tools-panel
        role="dialog"
        aria-label="繪圖"
        data-testid="desktop-tools-panel"
        className="fixed z-50 flex w-[380px] max-w-[calc(100vw-16px)] flex-col rounded-md border border-tv-border bg-tv-panel/80 shadow-tv-menu backdrop-blur-xl"
        style={{ left: anchorLeft, top, maxHeight: '72vh' }}
      >
        <div className="relative flex shrink-0 items-center justify-between px-3 pb-1 pt-2.5">
          <span className="text-[13px] font-medium text-tv-text-strong">繪圖</span>
          <button
            onClick={onClose}
            aria-label="關閉"
            data-testid="desktop-tools-panel-close"
            className="flex h-7 w-7 items-center justify-center rounded text-tv-muted hover:bg-tv-elevated hover:text-tv-text-strong"
          >
            ✕
          </button>
        </div>
        <div className="relative mx-3 mb-2 shrink-0">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tv-muted"
            aria-hidden="true"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
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
            data-testid="desktop-tools-panel-search"
            className="h-8 w-full rounded-md border border-tv-border bg-tv-workspace pl-9 pr-3 text-[13px] text-tv-text placeholder-tv-muted outline-none focus:border-tv-accent"
          />
        </div>
        <div
          role="tablist"
          aria-label="繪圖工具分類"
          className="mb-2 flex shrink-0 gap-1 overflow-x-auto px-3"
          style={{ scrollbarWidth: 'none' }}
        >
          {SHEET_TAB_DEFS.map((tab) => {
            const active = q === '' && tabId === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                data-testid={`desktop-tools-panel-tab-${tab.id}`}
                onClick={() => {
                  setTabId(tab.id);
                  setQuery('');
                }}
                className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] ${
                  active
                    ? 'bg-tv-active font-medium text-tv-text-strong'
                    : 'text-tv-muted hover:text-tv-text'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {visibleIds.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-tv-muted">
              {q !== ''
                ? `找不到符合「${query.trim()}」的工具`
                : tabId === 'favorites'
                  ? '尚未收藏，點卡片右上角的星號收藏'
                  : '此分類沒有工具'}
            </div>
          ) : (
            <div
              className="grid grid-cols-3 gap-2"
              data-testid="desktop-tools-panel-grid"
            >
              {visibleIds.map((id) => {
                const tool = TOOL_BY_ID.get(id);
                if (!tool) return null;
                const active = activeTool === id;
                const isFavorite = favorites.includes(id);
                return (
                  <div
                    key={id}
                    className={`relative rounded-md border ${
                      active
                        ? 'border-tv-accent bg-tv-active'
                        : 'border-tv-border bg-tv-workspace'
                    }`}
                  >
                    <button
                      onClick={(e) => onSelect(id, e.shiftKey)}
                      onDoubleClick={() => onSelect(id, true)}
                      data-testid={`desktop-tools-panel-card-${id}`}
                      aria-label={tool.label}
                      title={`${tool.label}（雙擊或 Shift+點選：連續繪製）`}
                      className="flex w-full flex-col items-center gap-1.5 px-1 py-3 text-tv-text"
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
                      data-testid={`desktop-tools-panel-star-${id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(id);
                      }}
                      className={`absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded hover:bg-tv-elevated ${
                        isFavorite
                          ? 'text-tv-star'
                          : 'text-tv-muted hover:text-tv-text-strong'
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
    </>,
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

/** Narrow (40px) variant for the mobile floating bar (TV f_001). */
const FLOAT_BUTTON_BASE =
  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b2b5be]';

/** Left accent bar marking the active tool / cursor. */
function ActiveBar() {
  return (
    <span
      className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-tv-accent"
      aria-hidden="true"
    />
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
  /** Starred tool ids, in starred order (persisted, ptt:favorite-tools). */
  const [favorites, setFavorites] = useState<DrawingTool[]>(() => loadFavoriteTools());
  /** Last tool picked per group (persisted, ptt:last-used-tools).
   *  Write-only since the fixed rail went away (nothing reads it
   *  now); the stored values are kept for a future use. */
  const [, setLastUsed] = useState<Record<string, DrawingTool>>(() => loadLastUsedTools());
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

  /** Desktop floating tools bar (Ryan 2026-11-28: the desktop rail
   *  is replaced by the same draggable favorites bar as mobile).
   *  Own position state + storage key (ptt:floating-tools-pos-desktop),
   *  own drag refs; the mobile bar above is untouched. Null until
   *  mounted (same one-time mount-sync pattern as the mobile bar). */
  const [deskFloatPos, setDeskFloatPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const deskFloatPosRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const deskFloatDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const deskFloatBarRef = useRef<HTMLDivElement | null>(null);
  /** Desktop full tool list panel (DesktopToolsPanel) open. */
  const [deskPanelOpen, setDeskPanelOpen] = useState(false);

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

  // Desktop floating bar: position on mount (saved position, else
  // the LEFT-edge default at ~35% down, same as mobile), clamped
  // into the viewport; keep it inside on resize / rotation. Left
  // edge by default because the price axis occupies the right edge.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount
     sync from localStorage + viewport size (external systems); a
     lazy initializer would read window during SSR and mismatch
     hydration (same as the mobile bar). */
  useEffect(() => {
    const initial = clampDeskFloatPos(
      loadDeskFloatingToolsPos() ?? {
        x: 8,
        y: Math.round(window.innerHeight * 0.35),
      },
      0,
    );
    deskFloatPosRef.current = initial;
    setDeskFloatPos(initial);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep the desktop floating bar inside the viewport on resize /
  // rotation; a resize also closes the full-list panel (its anchor
  // moves with the bar).
  useEffect(() => {
    const onResize = () => {
      setDeskFloatPos((prev) =>
        prev
          ? clampDeskFloatPos(prev, deskFloatBarRef.current?.offsetHeight ?? 0)
          : prev,
      );
      setDeskPanelOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Re-clamp the desktop bar once its height is known (after the
  // first render) and whenever the favorites change (the bar grows
  // / shrinks with the tool count). clampDeskFloatPos returns the
  // same object when nothing changed, so this never loops.
  useEffect(() => {
    setDeskFloatPos((prev) =>
      prev
        ? clampDeskFloatPos(prev, deskFloatBarRef.current?.offsetHeight ?? 0)
        : prev,
    );
  }, [deskFloatPos, favorites.length]);

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

  /** Desktop grip drag: same Pointer Events + setPointerCapture
   *  pattern as the mobile bar, own refs / storage key. Starting a
   *  drag closes the full-list panel (its anchor moves with the bar).
   *  Position persists on release. */
  const onDeskFloatHandlePointerDown = (e: React.PointerEvent) => {
    const el = deskFloatBarRef.current;
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone; the drag still tracks by pointerId.
    }
    setDeskPanelOpen(false);
    deskFloatDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: deskFloatPosRef.current.x,
      origY: deskFloatPosRef.current.y,
    };
  };
  const onDeskFloatHandlePointerMove = (e: React.PointerEvent) => {
    const d = deskFloatDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const next = clampDeskFloatPos(
      {
        x: d.origX + e.clientX - d.startX,
        y: d.origY + e.clientY - d.startY,
      },
      deskFloatBarRef.current?.offsetHeight ?? 0,
    );
    deskFloatPosRef.current = next;
    setDeskFloatPos(next);
  };
  const onDeskFloatHandlePointerUp = (e: React.PointerEvent) => {
    const d = deskFloatDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    deskFloatDragRef.current = null;
    saveDeskFloatingToolsPos(deskFloatPosRef.current);
  };
  /** Mobile compact bar: starred tools in group order, or the 3
   *  defaults when nothing is starred yet. */
  const compactTools =
    favorites.length > 0
      ? sortToolsByGroup(favorites)
      : DEFAULT_COMPACT_TOOLS;
  const cycleMagnet = () => {
    const next =
      MAGNET_ORDER[(MAGNET_ORDER.indexOf(magnet) + 1) % MAGNET_ORDER.length];
    setMagnet(next);
    saveMagnetMode(next);
  };

  /** Record a pick as the owning group's last-used tool (persisted
   *  to ptt:last-used-tools). Nothing reads it since the fixed rail
   *  went away, but the stored values are kept for a future use. */
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

  const handleSelect = (id: DrawingTool, continuous: boolean) => {
    recordLastUsed(id);
    if (!continuous && activeTool === id) {
      onToolChange(null, false);
    } else {
      onToolChange(id, continuous);
    }
  };

  return (
    <>
    {/* Desktop (>=md): floating draggable favorites bar (Ryan
        2026-11-28 — the fixed left rail is replaced by the same
        draggable favorites bar as mobile). Narrow 40px, dark,
        icon-only, grip on top; only the starred tools show
        (defaults when nothing is starred yet); drag by the grip
        handle, position persists in localStorage under its own key
        (ptt:floating-tools-pos-desktop). The cursor button exits
        drawing mode; magnet / clear stay on the bar (they lived on
        the old rail); ⋯ opens the desktop full tool list panel.
        A round undo button sits below the bar (TV f_001); it is
        wired by page.tsx via onUndo/canUndo and disabled until then.
        Rendered only after mount (deskFloatPos null on the server). */}
    {deskFloatPos !== null && (
    <div
      data-drawing-bar
      data-testid="desktop-floating-tools"
      className="fixed z-30 hidden w-10 flex-col items-center md:flex"
      style={{ left: deskFloatPos.x, top: deskFloatPos.y, touchAction: 'none' }}
    >
      <div
        ref={deskFloatBarRef}
        className="flex w-10 flex-col items-center gap-0.5 rounded-xl border border-[#2a2e39] bg-[#1e222d]/75 py-1 shadow-2xl backdrop-blur-xl"
        onPointerMove={onDeskFloatHandlePointerMove}
        onPointerUp={onDeskFloatHandlePointerUp}
        onPointerCancel={onDeskFloatHandlePointerUp}
      >
        <div
          data-testid="desktop-floating-handle"
          role="button"
          aria-label="拖動工具列"
          title="拖動工具列"
          className="flex h-5 w-full cursor-grab touch-none items-center justify-center text-[#787b86] active:cursor-grabbing"
          onPointerDown={onDeskFloatHandlePointerDown}
        >
          <GripIcon />
        </div>
        <button
          title="游標／選取（退出繪製模式）"
          aria-label="游標／選取"
          onClick={() => onToolChange(null, false)}
          className={`${FLOAT_BUTTON_BASE} ${
            activeTool === null ? 'bg-tv-active text-tv-accent' : ''
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
              data-testid={`desktop-floating-tool-${id}`}
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
          onClick={cycleMagnet}
          title={`磁吸：${MAGNET_LABELS[magnet]}（點擊切換，關 → 弱 → 強）`}
          aria-label={`磁吸：${MAGNET_LABELS[magnet]}`}
          aria-pressed={magnet !== 'off'}
          data-testid="desktop-floating-magnet"
          className={`${FLOAT_BUTTON_BASE} ${
            magnet !== 'off' ? 'bg-[#2a2e39] text-[#2962ff]' : ''
          }`}
        >
          <MagnetIcon />
        </button>
        <button
          onClick={onClear}
          title="清除目前商品的所有畫線"
          aria-label="清除目前商品的所有畫線"
          data-testid="desktop-floating-clear"
          className={`${FLOAT_BUTTON_BASE} hover:text-[#ef5350]`}
        >
          <ClearIcon />
        </button>
        <span className="my-0.5 h-px w-6 shrink-0 bg-[#2a2e39]" />
        <button
          onClick={() => setDeskPanelOpen(true)}
          title="全部畫線工具"
          aria-label="全部畫線工具"
          data-testid="desktop-floating-all-tools"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2a2e39] bg-[#262b38] text-[#b2b5be] hover:text-white"
        >
          <DotsIcon />
        </button>
      </div>
      {/* Round undo button below the bar (TV f_001, same as mobile).
          Disabled until page.tsx wires onUndo + canUndo. */}
      <button
        onClick={() => onUndo?.()}
        disabled={!canUndo}
        title="復原"
        aria-label="復原"
        data-testid="desktop-floating-undo"
        className="mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2a2e39] bg-[#1e222d]/75 text-[#b2b5be] shadow-2xl backdrop-blur-xl hover:text-white disabled:opacity-30 disabled:hover:text-[#b2b5be]"
      >
        <UndoIcon />
      </button>
    </div>
    )}
    {deskPanelOpen && deskFloatPos && (
      <DesktopToolsPanel
        favorites={favorites}
        activeTool={activeTool}
        onSelect={(id, continuous) => {
          setDeskPanelOpen(false);
          handleSelect(id, continuous);
        }}
        onToggleFavorite={toggleFavorite}
        onClose={() => setDeskPanelOpen(false)}
        anchorLeft={deskFloatPos.x + FLOAT_W + 6}
        anchorTop={deskFloatPos.y}
      />
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
            activeTool === null ? 'bg-tv-active text-tv-accent' : ''
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
