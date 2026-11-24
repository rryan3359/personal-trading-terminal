'use client';

/**
 * ColorPicker.tsx — TradingView-style color picker.
 *
 * 10-column color grid (COLOR_PALETTE_GRID) + a custom color swatch
 * (input[type=color]) + an opacity slider with a percent input.
 * Controlled: the parent owns color (hex) and opacity (0–1) and applies
 * them. Shared by the floating edit bar (Phase 1) and the settings
 * dialog (Phase 2).
 */

import { COLOR_PALETTE_GRID } from '@/lib/chart-config';

export interface ColorPickerProps {
  /** Current line color, hex (#rrggbb). */
  color: string;
  /** Current line opacity, 0–1. */
  opacity: number;
  onColorChange: (hex: string) => void;
  onOpacityChange: (opacity: number) => void;
  /** Fired once at the start of an opacity drag / number focus. */
  onOpacityStart?: () => void;
  /** Fired when the opacity drag / number edit ends. */
  onOpacityEnd?: () => void;
}

export default function ColorPicker({
  color,
  opacity,
  onColorChange,
  onOpacityChange,
  onOpacityStart,
  onOpacityEnd,
}: ColorPickerProps) {
  const pct = Math.round(opacity * 100);
  const lower = color.toLowerCase();

  return (
    <div className="w-[228px] rounded-md border border-[#2a2e39] bg-[#1e222d] p-2 text-xs text-[#d1d4dc] shadow-xl">
      <div className="grid grid-cols-10 gap-1">
        {COLOR_PALETTE_GRID.map((c) => (
          <button
            key={c}
            title={c}
            aria-label={`顏色 ${c}`}
            onClick={() => onColorChange(c)}
            className={`h-[18px] w-[18px] rounded-[3px] border border-white/10 ${
              c.toLowerCase() === lower ? 'ring-2 ring-white' : ''
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          value={lower.startsWith('#') && lower.length === 7 ? lower : '#2962ff'}
          onChange={(e) => onColorChange(e.target.value)}
          title="自訂顏色"
          aria-label="自訂顏色"
          className="h-6 w-8 cursor-pointer bg-transparent p-0"
        />
        <span className="text-[#b2b5be]">自訂色</span>
        <span className="ml-auto font-mono uppercase">{lower}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-[#b2b5be]">不透明度</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label="不透明度"
          onPointerDown={onOpacityStart}
          onPointerUp={onOpacityEnd}
          onBlur={onOpacityEnd}
          onChange={(e) =>
            onOpacityChange(Math.max(0, Math.min(100, Number(e.target.value))) / 100)
          }
          className="min-w-0 flex-1 accent-[#2962ff]"
        />
        <input
          type="number"
          min={0}
          max={100}
          value={pct}
          aria-label="不透明度百分比"
          onFocus={onOpacityStart}
          onBlur={onOpacityEnd}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isNaN(v)) return;
            onOpacityChange(Math.max(0, Math.min(100, v)) / 100);
          }}
          className="w-14 rounded border border-[#2a2e39] bg-[#131722] px-1 py-0.5 text-right text-[#d1d4dc]"
        />
        <span className="text-[#b2b5be]">%</span>
      </div>
    </div>
  );
}
