'use client';

/**
 * ChartContextMenu.tsx — chart-aware right-click menu (Phase 1 step 4,
 * Phase 0 §6.2). Presentational only: Chart.tsx owns the state, the
 * ContextMenu mode and every action; this component only renders the
 * items, flips near the edge so it never overflows the chart wrapper,
 * and reports the chosen item id. It never executes an action and
 * never touches the chart, the store or localStorage.
 *
 * Sections are rendered with a divider between them (chart actions,
 * then object actions when something is selected). A disabled item
 * (e.g. 圖表設定 [待確認]) is shown but cannot be chosen.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}

interface ChartContextMenuProps {
  /** Ref attached to the menu root (Chart.tsx uses it for the
   *  outside-pointerdown close check). */
  menuRef: RefObject<HTMLDivElement | null>;
  /** Anchor in wrapper-relative px (right-click point). */
  x: number;
  y: number;
  /** Wrapper client size, measured when the menu opened; the menu
   *  flips/clamps inside it. */
  bounds: { width: number; height: number };
  sections: ContextMenuItem[][];
  onSelect: (id: string) => void;
}

export default function ChartContextMenu({
  menuRef,
  x,
  y,
  bounds,
  sections,
  onSelect,
}: ChartContextMenuProps) {
  const [pos, setPos] = useState({ x, y });
  // Flip near the right / bottom edge so the menu never overflows
  // the wrapper; clamp to a 4px margin on the top / left as well.
  // Runs after mount (menu size is only known once rendered).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      x: Math.max(4, Math.min(x, bounds.width - w - 4)),
      y: Math.max(4, Math.min(y, bounds.height - h - 4)),
    });
  }, [x, y, bounds, menuRef]);

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="chart-context-menu"
      onContextMenu={(e) => e.preventDefault()}
      className="absolute z-40 w-56 rounded-md border border-[#2a2e39] bg-[#1e222d]/80 p-1 text-xs text-[#d1d4dc] shadow-xl backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {sections.map((section, si) => (
        <div key={si}>
          {si > 0 && (
            <div className="mx-1 my-1 h-px bg-[#2a2e39]" role="separator" />
          )}
          {section.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              data-menu-item={item.id}
              disabled={item.disabled}
              onClick={() => onSelect(item.id)}
              className={`block w-full rounded-sm px-2 py-1.5 text-left hover:bg-white/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
                item.danger ? 'text-[#ef5350]' : ''
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
