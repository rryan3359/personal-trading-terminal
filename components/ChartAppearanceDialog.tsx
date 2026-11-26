'use client';

/**
 * ChartAppearanceDialog.tsx — TradingView-style chart appearance
 * settings (K 棒顏色、背景、字體大小與顏色).
 *
 * Same shell as OverlaySettingsDialog (desktop centred dialog, mobile
 * bottom sheet 85vh): fixed backdrop, Escape closes, Delete /
 * Backspace / Ctrl+Z never reach the chart's global shortcuts.
 *
 * Unlike the overlay dialog this one applies LIVE: every change calls
 * onChange immediately, so the chart updates while the dialog is
 * open (TV behaviour). Closing keeps the changes; 重設為預設值
 * restores DEFAULT_APPEARANCE at once. No light-theme preset — the
 * rest of the page UI is dark, a light chart would clash.
 */

import { useEffect, useRef, useState } from 'react';
import ColorPicker from '@/components/ColorPicker';
import {
  APPEARANCE_FONT_SIZES,
  DEFAULT_APPEARANCE,
  type AppearanceSettings,
} from '@/lib/chart-appearance';

export interface ChartAppearanceDialogProps {
  /** Appearance at open (the dialog edits a draft of this). */
  initial: AppearanceSettings;
  /** Called on every change (live apply). The parent persists it. */
  onChange: (next: AppearanceSettings) => void;
  onClose: () => void;
}

const FIELD_LABEL = 'mb-1 block text-xs text-[#b2b5be]';
const SELECT =
  'w-full rounded border border-[#2a2e39] bg-[#131722] px-2 py-1.5 text-sm text-[#d1d4dc] outline-none focus:border-[#2962ff] cursor-pointer';
const CHECK_ROW = 'flex cursor-pointer items-center gap-2 text-sm';

/** One colour row: label + swatch button; tapping the swatch opens
 *  the palette inline (same as the overlay dialog's style tab — the
 *  dialog content scrolls, so no popover clipping to manage). */
function ColorRow({
  label,
  testId,
  value,
  open,
  onToggle,
  onChange,
}: {
  label: string;
  testId: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onChange: (hex: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#d1d4dc]">{label}</span>
        <button
          type="button"
          data-testid={testId}
          onClick={onToggle}
          aria-label={`${label}：${value}`}
          aria-expanded={open}
          className={`flex items-center gap-2 rounded border px-2 py-1 ${
            open
              ? 'border-[#2962ff] bg-[#2962ff]/20'
              : 'border-[#2a2e39] hover:bg-white/5'
          }`}
        >
          <span
            className="block h-5 w-5 rounded-[3px] border border-white/20"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-xs uppercase">{value}</span>
        </button>
      </div>
      {open && (
        <div className="mt-2">
          <ColorPicker
            color={value}
            showOpacity={false}
            onColorChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-[#2a2e39] p-3">
      <div className="mb-2 text-sm font-semibold text-white">{title}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export default function ChartAppearanceDialog({
  initial,
  onChange,
  onClose,
}: ChartAppearanceDialogProps) {
  const [draft, setDraft] = useState<AppearanceSettings>(initial);
  const draftRef = useRef(draft);
  /** Which colour row's palette is open (one at a time). */
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  // Escape closes the dialog even when focus is outside it. The
  // chart's own window handler is a no-op while the dialog is open,
  // so there is no double handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Root key handling: Escape closes; Delete/Backspace/Ctrl+Z must
   *  not reach the chart's global shortcuts while the dialog is open.
   *  Events from editable targets are left alone (typing must work). */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const editable =
      !!t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable);
    if (editable) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (
      e.key === 'Delete' ||
      e.key === 'Backspace' ||
      ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z'))
    ) {
      e.stopPropagation();
    }
  };

  // Live apply: every patch updates the draft AND notifies the parent
  // at once, so the chart repaints while the dialog stays open.
  const patch = (p: Partial<AppearanceSettings>) => {
    const next = { ...draftRef.current, ...p };
    draftRef.current = next;
    setDraft(next);
    onChange(next);
  };

  const colorRow = (
    key: keyof AppearanceSettings,
    label: string,
  ) => (
    <ColorRow
      key={key}
      label={label}
      testId={`appearance-color-${key}`}
      value={draft[key] as string}
      open={openPicker === key}
      onToggle={() =>
        setOpenPicker((cur) => (cur === key ? null : (key as string)))
      }
      onChange={(hex) => patch({ [key]: hex } as Partial<AppearanceSettings>)}
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 max-md:items-end max-md:p-0"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="圖表設定"
        data-testid="appearance-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#2a2e39] bg-[#131722] text-sm text-[#d1d4dc] shadow-2xl max-md:max-w-none max-md:rounded-b-none max-md:rounded-t-2xl"
      >
        {/* Bottom-sheet drag handle (mobile only). */}
        <div
          aria-hidden="true"
          className="sticky top-2 z-10 mx-auto mt-2 hidden h-1 w-10 shrink-0 rounded-full bg-white/25 max-md:block"
        />
        <div className="flex items-center justify-between border-b border-[#2a2e39] px-4 py-3">
          <div className="text-base font-semibold text-white">圖表設定</div>
          <button
            onClick={onClose}
            aria-label="關閉"
            className="rounded px-2 py-0.5 text-lg leading-none text-[#b2b5be] hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <p className="text-xs leading-relaxed text-[#787b86]">
            修改即時套用在圖表上，關閉後保留；手機與桌機共用同一設定。
          </p>

          <Section title="背景">
            {colorRow('background', '背景色')}
            <label className={CHECK_ROW}>
              <input
                type="checkbox"
                checked={draft.gridShow}
                onChange={(e) => patch({ gridShow: e.target.checked })}
                className="accent-[#2962ff]"
              />
              顯示格線
            </label>
            {draft.gridShow && colorRow('gridColor', '格線顏色')}
          </Section>

          <Section title="K線">
            {colorRow('candleUpColor', '漲色')}
            {colorRow('candleDownColor', '跌色')}
            {colorRow('candleUpWickColor', '漲影線')}
            {colorRow('candleDownWickColor', '跌影線')}
            {colorRow('candleUpBorderColor', '漲邊框')}
            {colorRow('candleDownBorderColor', '跌邊框')}
            {colorRow('areaLineColor', '線形圖線色')}
          </Section>

          <Section title="文字">
            {colorRow('axisTextColor', '座標軸文字顏色')}
            <div>
              <label className={FIELD_LABEL}>座標軸字體大小</label>
              <select
                value={draft.axisTextSize}
                data-testid="appearance-font-size"
                onChange={(e) =>
                  patch({ axisTextSize: Number(e.target.value) })
                }
                className={SELECT}
              >
                {APPEARANCE_FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}px
                  </option>
                ))}
              </select>
            </div>
          </Section>

          <Section title="線條">
            {colorRow('crosshairColor', '十字線顏色')}
            {colorRow('axisLineColor', '座標軸線顏色')}
            {colorRow('separatorColor', '分隔線顏色')}
          </Section>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#2a2e39] px-4 py-3">
          <button
            type="button"
            data-testid="appearance-reset"
            onClick={() => patch({ ...DEFAULT_APPEARANCE })}
            className="rounded border border-[#2a2e39] px-3 py-2 text-sm hover:bg-white/5"
          >
            重設為預設值
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-[#2962ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e88e5]"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
