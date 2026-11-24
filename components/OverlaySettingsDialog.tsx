'use client';

/**
 * OverlaySettingsDialog.tsx — TradingView-style settings dialog for one
 * drawing (Phase 2). Four tabs (樣式 / 文字 / 座標 / 可見性); the
 * fields switch by tool type. The dialog edits a draft and only writes
 * back on 確認 (Chart.tsx applies it with one overrideOverlay / one
 * history step). The bottom 範本 dropdown is UI-only for now —
 * template save/load lands in Phase 3.
 */

import { useEffect, useState } from 'react';
import ColorPicker from '@/components/ColorPicker';
import { FIB_LEVELS } from '@/lib/chart-theme';
import {
  LINE_STYLE_OPTIONS,
  TOOL_LABELS_BY_NAME,
  lineFamilyOf,
  type ExtendId,
  type LineFamily,
  type LineStyleId,
} from '@/lib/chart-config';
import { DEFAULT_OVERLAY_TEXT, type OverlayText } from '@/lib/store';
import { INTERVALS, INTERVAL_LABELS } from '@/lib/types';

export type DialogTab = 'style' | 'text' | 'coords' | 'visibility';

/** Complete editable state for one drawing. Built by Chart.tsx from the
 *  selected overlay; returned unchanged except for the user's edits. */
export interface OverlayDialogDraft {
  color: string;
  opacity: number;
  size: number;
  style: LineStyleId;
  extend: ExtendId;
  priceLabel: boolean;
  /** Rectangle: border / middle line / fill. */
  rectBorder: boolean;
  rectMiddleLine: boolean;
  rectFill: boolean;
  fillOpacity: number;
  /** Fibonacci: trend line, per-level colours, level extend, background. */
  fibTrendline: boolean;
  fibLevelColors: string[];
  fibExtend: 'left' | 'right' | 'both';
  fibBackground: boolean;
  /** Fibonacci: show the level price labels. */
  fibLevelText: boolean;
  /** Attached text. null = no text. */
  text: OverlayText | null;
  points: Array<{ timestamp: number; value: number }>;
  /** undefined = shown on every interval. */
  visibleIntervals: string[] | undefined;
}

export interface OverlaySettingsDialogProps {
  /** Overlay name at open (e.g. 'segment', 'rectangle'). */
  toolName: string;
  initial: OverlayDialogDraft;
  /** Loaded candles (for the coordinates tab: bar number -> date). */
  bars: Array<{ timestamp: number }>;
  initialTab?: DialogTab;
  onConfirm: (draft: OverlayDialogDraft) => void;
  onClose: () => void;
}

const TABS: Array<{ id: DialogTab; label: string }> = [
  { id: 'style', label: '樣式' },
  { id: 'text', label: '文字' },
  { id: 'coords', label: '座標' },
  { id: 'visibility', label: '可見性' },
];

const TEXT_SIZES = [10, 12, 14, 16, 18, 20, 24];

function formatBarDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FIELD_LABEL = 'mb-1 block text-xs text-[#b2b5be]';
const INPUT =
  'w-full rounded border border-[#2a2e39] bg-[#131722] px-2 py-1.5 text-sm text-[#d1d4dc] outline-none focus:border-[#2962ff]';
const SELECT = `${INPUT} cursor-pointer`;
const CHECK_ROW = 'flex cursor-pointer items-center gap-2 text-sm';

/** One endpoint row in the coordinates tab: price + bar number inputs
 *  with the bar's date shown for cross-checking. Inputs commit on blur
 *  (typing an intermediate value never moves the point). */
function CoordRow({
  label,
  point,
  bars,
  onPointChange,
}: {
  label: string;
  point: { timestamp: number; value: number };
  bars: Array<{ timestamp: number }>;
  // Partial patch: the parent merges it into the CURRENT draft point
  // (functional setState), so two rapid blurs — e.g. price then bar
  // number in the same tick — cannot clobber each other through a
  // stale point/draft closure.
  onPointChange: (patch: Partial<{ timestamp: number; value: number }>) => void;
}) {
  const index = bars.findIndex((b) => b.timestamp === point.timestamp);
  const [priceText, setPriceText] = useState(String(point.value));
  const [indexText, setIndexText] = useState(index >= 0 ? String(index) : '');
  const dateText =
    index >= 0
      ? formatBarDate(bars[index].timestamp)
      : `${formatBarDate(point.timestamp)}（未載入）`;
  return (
    <div className="rounded border border-[#2a2e39] p-2">
      <div className="mb-2 text-sm font-semibold text-white">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={FIELD_LABEL}>價格</label>
          <input
            type="number"
            step="any"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            onBlur={() => {
              const v = Number(priceText);
              if (!Number.isNaN(v) && Number.isFinite(v)) {
                onPointChange({ value: v });
                setPriceText(String(v));
              } else {
                setPriceText(String(point.value));
              }
            }}
            className={INPUT}
          />
        </div>
        <div>
          <label className={FIELD_LABEL}>
            K 棒編號（0–{Math.max(0, bars.length - 1)}）
          </label>
          <input
            type="number"
            min={0}
            max={Math.max(0, bars.length - 1)}
            step={1}
            value={indexText}
            onChange={(e) => setIndexText(e.target.value)}
            onBlur={() => {
              const n = Number(indexText);
              if (
                Number.isInteger(n) &&
                n >= 0 &&
                n < bars.length
              ) {
                onPointChange({ timestamp: bars[n].timestamp });
                setIndexText(String(n));
              } else {
                setIndexText(index >= 0 ? String(index) : '');
              }
            }}
            className={INPUT}
          />
        </div>
      </div>
      <div className="mt-1 text-xs text-[#787b86]">該 K 棒：{dateText}</div>
    </div>
  );
}

export default function OverlaySettingsDialog({
  toolName,
  initial,
  bars,
  initialTab = 'style',
  onConfirm,
  onClose,
}: OverlaySettingsDialogProps) {
  const [tab, setTab] = useState<DialogTab>(initialTab);
  const [draft, setDraft] = useState<OverlayDialogDraft>(initial);
  const family: LineFamily | null = lineFamilyOf(toolName);
  const isFib = toolName === 'fibonacciRetracement';
  const isRect = toolName === 'rectangle';
  /** Freehand strokes have too many points for per-point editing. */
  const isBrush = toolName === 'brush';
  /** A standalone text annotation has no line to style. */
  const isTextTool = toolName === 'textAnnotation';
  /** Its own Y-axis tag already shows the price. */
  const isSimpleTag = toolName === 'simpleTag';
  const isPriceLine = toolName === 'priceLine';
  const title = TOOL_LABELS_BY_NAME[toolName] ?? toolName;

  // Escape closes the dialog even when focus is outside it (e.g. on the
  // chart after a double-click opened it — such a keydown never bubbles
  // through the dialog root). The chart's own window handler is a no-op
  // while the dialog is open, so there is no double handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (p: Partial<OverlayDialogDraft>) =>
    setDraft((d) => ({ ...d, ...p }));
  const patchText = (p: Partial<OverlayText>) =>
    setDraft((d) => ({
      ...d,
      text: d.text ? { ...d.text, ...p } : { ...DEFAULT_OVERLAY_TEXT, ...p },
    }));

  /** Root key handling: Escape closes; Delete/Backspace/Ctrl+Z must not
   *  reach the chart's global shortcuts while the dialog is open.
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

  const extendOptions: Array<{ id: ExtendId; label: string }> =
    family === 'vertical'
      ? [
          { id: 'none', label: '不要延長' },
          { id: 'up', label: '向上' },
          { id: 'down', label: '向下' },
          { id: 'both', label: '雙向' },
        ]
      : [
          { id: 'none', label: '不要延長' },
          { id: 'left', label: '向左' },
          { id: 'right', label: '向右' },
          { id: 'both', label: '雙向' },
        ];

  const toggleInterval = (iv: string) => {
    const current = draft.visibleIntervals ?? [...INTERVALS];
    const next = current.includes(iv)
      ? current.filter((x) => x !== iv)
      : [...current, iv];
    if (next.length === 0) return; // keep at least one interval
    patch({
      visibleIntervals:
        next.length === INTERVALS.length ? undefined : next,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${title}設定`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#2a2e39] bg-[#131722] text-sm text-[#d1d4dc] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#2a2e39] px-4 py-3">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            {title}
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" />
            </svg>
          </div>
          <button
            onClick={onClose}
            aria-label="關閉"
            className="rounded px-2 py-0.5 text-lg leading-none text-[#b2b5be] hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex border-b border-[#2a2e39] px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm ${
                tab === t.id
                  ? 'border-b-2 border-[#2962ff] font-semibold text-white'
                  : 'text-[#b2b5be] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 px-4 py-4">
          {tab === 'style' && (
            <>
              {isTextTool ? (
                <p className="text-xs leading-relaxed text-[#787b86]">
                  文字標註沒有線條樣式，文字的顏色、字號與對齊請到「文字」頁籤設定。
                </p>
              ) : (
                <>
              <div>
                <span className={FIELD_LABEL}>顏色 / 不透明度</span>
                <ColorPicker
                  color={draft.color}
                  opacity={draft.opacity}
                  onColorChange={(c) => patch({ color: c })}
                  onOpacityChange={(op) => patch({ opacity: op })}
                />
              </div>
              <div>
                <span className={FIELD_LABEL}>粗細</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((w) => (
                    <button
                      key={w}
                      title={`線寬 ${w}`}
                      onClick={() => patch({ size: w })}
                      className={`flex h-7 flex-1 items-center justify-center rounded border ${
                        draft.size === w
                          ? 'border-[#2962ff] bg-[#2962ff]/20 text-white'
                          : 'border-[#2a2e39] hover:bg-white/5'
                      }`}
                    >
                      <span
                        className="block rounded-full bg-current"
                        style={{ height: Math.min(w, 3), width: 20 }}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={FIELD_LABEL}>線形</span>
                <div className="flex gap-1">
                  {LINE_STYLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => patch({ style: opt.id })}
                      className={`flex flex-1 items-center justify-center gap-2 rounded border px-2 py-1.5 ${
                        draft.style === opt.id
                          ? 'border-[#2962ff] bg-[#2962ff]/20 text-white'
                          : 'border-[#2a2e39] hover:bg-white/5'
                      }`}
                    >
                      <span
                        className="block w-8 border-t-2"
                        style={{
                          borderTopColor: '#d1d4dc',
                          borderTopStyle:
                            opt.id === 'solid'
                              ? 'solid'
                              : opt.id === 'dashed'
                                ? 'dashed'
                                : 'dotted',
                        }}
                      />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {family !== null && (
                <div>
                  <label className={FIELD_LABEL}>延伸</label>
                  <select
                    value={draft.extend}
                    onChange={(e) =>
                      patch({ extend: e.target.value as ExtendId })
                    }
                    className={SELECT}
                  >
                    {extendOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(family !== null || isRect || isFib || isPriceLine) &&
                !isSimpleTag && (
                <label className={CHECK_ROW}>
                  <input
                    type="checkbox"
                    checked={draft.priceLabel}
                    onChange={(e) => patch({ priceLabel: e.target.checked })}
                    className="accent-[#2962ff]"
                  />
                  價格標籤（在右側價格軸顯示）
                </label>
              )}
              {isRect && (
                <div className="space-y-2 rounded border border-[#2a2e39] p-2">
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={draft.rectBorder}
                      onChange={(e) =>
                        patch({ rectBorder: e.target.checked })
                      }
                      className="accent-[#2962ff]"
                    />
                    邊框
                  </label>
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={draft.rectMiddleLine}
                      onChange={(e) =>
                        patch({ rectMiddleLine: e.target.checked })
                      }
                      className="accent-[#2962ff]"
                    />
                    中線
                  </label>
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={draft.rectFill}
                      onChange={(e) => patch({ rectFill: e.target.checked })}
                      className="accent-[#2962ff]"
                    />
                    填色
                  </label>
                  {draft.rectFill && (
                    <div>
                      <label className={FIELD_LABEL}>
                        填色不透明度 {Math.round(draft.fillOpacity * 100)}%
                      </label>
                      <input
                        type="range"
                        min={0.05}
                        max={0.4}
                        step={0.05}
                        value={draft.fillOpacity}
                        onChange={(e) =>
                          patch({ fillOpacity: Number(e.target.value) })
                        }
                        className="w-full accent-[#2962ff]"
                      />
                    </div>
                  )}
                </div>
              )}
              {isFib && (
                <div className="space-y-3 rounded border border-[#2a2e39] p-2">
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={draft.fibTrendline}
                      onChange={(e) =>
                        patch({ fibTrendline: e.target.checked })
                      }
                      className="accent-[#2962ff]"
                    />
                    趨勢線（連接兩端點的斜線）
                  </label>
                  <div>
                    <span className={FIELD_LABEL}>各層級線色</span>
                    <div className="space-y-1">
                      {FIB_LEVELS.map((level, i) => (
                        <div
                          key={level}
                          className="flex items-center gap-2"
                        >
                          <span className="w-16 text-xs text-[#b2b5be]">
                            {(level * 100).toFixed(1)}%
                          </span>
                          <input
                            type="color"
                            value={draft.fibLevelColors[i] ?? '#787b86'}
                            onChange={(e) => {
                              const next = [...draft.fibLevelColors];
                              next[i] = e.target.value;
                              patch({ fibLevelColors: next });
                            }}
                            className="h-6 w-8 cursor-pointer bg-transparent p-0"
                          />
                          <span className="font-mono text-xs uppercase">
                            {draft.fibLevelColors[i] ?? '#787b86'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={FIELD_LABEL}>層級線延伸</label>
                    <select
                      value={draft.fibExtend}
                      onChange={(e) =>
                        patch({
                          fibExtend: e.target.value as
                            | 'left'
                            | 'right'
                            | 'both',
                        })
                      }
                      className={SELECT}
                    >
                      <option value="left">向左</option>
                      <option value="right">向右</option>
                      <option value="both">雙向</option>
                    </select>
                  </div>
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={draft.fibBackground}
                      onChange={(e) =>
                        patch({ fibBackground: e.target.checked })
                      }
                      className="accent-[#2962ff]"
                    />
                    背景填色（0–100% 區間）
                  </label>
                </div>
              )}
                </>
              )}
            </>
          )}

          {tab === 'text' && !isFib && (
            <>
              <label className={CHECK_ROW}>
                <input
                  type="checkbox"
                  checked={draft.text !== null}
                  onChange={(e) =>
                    patch({
                      text: e.target.checked
                        ? (draft.text ?? { ...DEFAULT_OVERLAY_TEXT })
                        : null,
                    })
                  }
                  className="accent-[#2962ff]"
                />
                顯示文字
              </label>
              <div className="flex items-end gap-2">
                <div>
                  <label className={FIELD_LABEL}>文字顏色</label>
                  <input
                    type="color"
                    value={draft.text?.color ?? '#d1d4dc'}
                    disabled={draft.text === null}
                    onChange={(e) => patchText({ color: e.target.value })}
                    className="h-8 w-10 cursor-pointer bg-transparent p-0 disabled:opacity-30"
                  />
                </div>
                <div>
                  <label className={FIELD_LABEL}>字號</label>
                  <select
                    value={draft.text?.size ?? 12}
                    disabled={draft.text === null}
                    onChange={(e) =>
                      patchText({ size: Number(e.target.value) })
                    }
                    className={SELECT}
                  >
                    {TEXT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  title="粗體"
                  aria-label="粗體"
                  disabled={draft.text === null}
                  onClick={() =>
                    patchText({ bold: !(draft.text?.bold ?? false) })
                  }
                  className={`flex h-8 w-8 items-center justify-center rounded border text-base font-bold ${
                    draft.text?.bold
                      ? 'border-[#2962ff] bg-[#2962ff]/20 text-white'
                      : 'border-[#2a2e39] hover:bg-white/5'
                  } disabled:opacity-30`}
                >
                  B
                </button>
                <button
                  title="斜體"
                  aria-label="斜體"
                  disabled={draft.text === null}
                  onClick={() =>
                    patchText({ italic: !(draft.text?.italic ?? false) })
                  }
                  className={`flex h-8 w-8 items-center justify-center rounded border text-base italic ${
                    draft.text?.italic
                      ? 'border-[#2962ff] bg-[#2962ff]/20 text-white'
                      : 'border-[#2a2e39] hover:bg-white/5'
                  } disabled:opacity-30`}
                >
                  I
                </button>
              </div>
              <div>
                <label className={FIELD_LABEL}>文字內容</label>
                <textarea
                  rows={3}
                  value={draft.text?.content ?? ''}
                  disabled={draft.text === null}
                  placeholder="新增文字"
                  onChange={(e) => patchText({ content: e.target.value })}
                  className={`${INPUT} resize-y disabled:opacity-30`}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={FIELD_LABEL}>文字對齊（垂直）</label>
                  <select
                    value={draft.text?.alignV ?? 'middle'}
                    disabled={draft.text === null}
                    onChange={(e) =>
                      patchText({
                        alignV: e.target.value as
                          | 'top'
                          | 'middle'
                          | 'bottom',
                      })
                    }
                    className={SELECT}
                  >
                    <option value="top">頂部</option>
                    <option value="middle">中間</option>
                    <option value="bottom">底部</option>
                  </select>
                </div>
                <div>
                  <label className={FIELD_LABEL}>文字對齊（水平）</label>
                  <select
                    value={draft.text?.alignH ?? 'center'}
                    disabled={draft.text === null}
                    onChange={(e) =>
                      patchText({
                        alignH: e.target.value as
                          | 'left'
                          | 'center'
                          | 'right',
                      })
                    }
                    className={SELECT}
                  >
                    <option value="left">左</option>
                    <option value="center">中心</option>
                    <option value="right">右</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {tab === 'text' && isFib && (
            <>
              <label className={CHECK_ROW}>
                <input
                  type="checkbox"
                  checked={draft.fibLevelText}
                  onChange={(e) =>
                    patch({ fibLevelText: e.target.checked })
                  }
                  className="accent-[#2962ff]"
                />
                顯示層級文字（各層級的價格與百分比）
              </label>
              <p className="text-xs leading-relaxed text-[#787b86]">
                斐波那契的文字即各層級標籤；自由文字請用趨勢線等線型工具。
              </p>
            </>
          )}

          {tab === 'coords' && (
            <>
              {isBrush ? (
                <p className="text-xs leading-relaxed text-[#787b86]">
                  徒手畫線由多個點組成，不支援逐點編輯；拖曳整條線可移動它。
                </p>
              ) : (
                <>
              <p className="text-xs leading-relaxed text-[#787b86]">
                K 棒編號為已載入 K 線的順序（0＝最舊一根）；修改後端點會
                移到該 K 棒的開盤時間與輸入的價格。
              </p>
              {draft.points.map((p, i) => (
                <CoordRow
                  key={i}
                  label={
                    isRect
                      ? `#${i + 1}（角 ${i + 1}）`
                      : `#${i + 1}（價格，K棒）`
                  }
                  point={p}
                  bars={bars}
                  onPointChange={(patchPt) => {
                    setDraft((d) => ({
                      ...d,
                      points: d.points.map((q, j) =>
                        j === i ? { ...q, ...patchPt } : q,
                      ),
                    }));
                  }}
                />
              ))}
                </>
              )}
            </>
          )}

          {tab === 'visibility' && (
            <>
              <p className="text-xs leading-relaxed text-[#787b86]">
                勾選此畫線要顯示的週期；未勾選的週期不會顯示（至少保留一個）。
              </p>
              <div className="grid grid-cols-4 gap-2">
                {INTERVALS.map((iv) => {
                  const checked =
                    draft.visibleIntervals === undefined ||
                    draft.visibleIntervals.includes(iv);
                  return (
                    <label
                      key={iv}
                      className={`flex cursor-pointer items-center justify-center gap-1 rounded border px-2 py-2 ${
                        checked
                          ? 'border-[#2962ff] bg-[#2962ff]/20 text-white'
                          : 'border-[#2a2e39] hover:bg-white/5'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInterval(iv)}
                        className="accent-[#2962ff]"
                      />
                      {INTERVAL_LABELS[iv]}
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#2a2e39] px-4 py-3">
          <select
            title="範本（Phase 3 提供存取）"
            aria-label="範本"
            value="default"
            onChange={() => {
              /* UI-only for now; template save/load lands in Phase 3. */
            }}
            className="w-32 cursor-pointer rounded border border-[#2a2e39] bg-[#131722] px-2 py-1.5 text-sm text-[#d1d4dc] outline-none"
          >
            <option value="default">範本</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-[#2a2e39] px-4 py-1.5 text-sm hover:bg-white/5"
            >
              取消
            </button>
            <button
              onClick={() => onConfirm(draft)}
              className="rounded-md bg-[#2962ff] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#1e5bf0]"
            >
              確認
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
