'use client';

/**
 * DrawingSelectionToolbar.tsx — floating edit bar for the selected
 * overlay (MASTER TASK Phase 3 Step 5).
 *
 * Moved out of components/Chart.tsx verbatim (behaviour unchanged):
 * the floating-bar JSX, the openPanel state, the template state
 * (templates / templateName) + applyTemplate / saveTemplate /
 * deleteTemplate, the bar popovers (colour / line style / template),
 * and the small Bar* icons. The bar is docked at the bottom centre
 * of the chart on every screen width; it has no drag handling — the
 * "bar drag" named in the Step 5 plan does not exist in the current
 * code (position is fixed: left 50%, bottom 8). barRef is owned by
 * Chart (its object-list outside-click effect reads it) and passed
 * in; barIgnoreClicksUntilRef is read-only here — the compat-click
 * guard is owned by the Drawing -> Selected transition (Phase 1
 * state-step3 §3), which sets and clears it.
 *
 * Templates live here; Chart keeps a mirror (onTemplatesChange) for
 * the settings dialog, which also applies templates — it reaches
 * this component's applyTemplate through the imperative handle.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  type RefObject,
} from 'react';
import ColorPicker from '@/components/ColorPicker';
import type { DialogTab } from '@/components/OverlaySettingsDialog';
import { LINE_STYLE_OPTIONS } from '@/lib/chart-config';
import { hexToRgba } from '@/lib/chart-theme';
import { TEXT_ANNOTATION_NAME } from '@/lib/drawing-model';
import type {
  OverlayTemplate,
  OverlayTemplates,
} from '@/lib/drawing-persistence';
import type { LastOverlayStyle } from '@/lib/store';
import type { SelectedOverlayState } from './Chart';

/** Patch shape accepted by Chart's applyEdit (same as there). */
export type SelectionEditPatch = Partial<
  Omit<SelectedOverlayState, 'id' | 'name' | 'isRect'>
>;

/** Imperative handle: the settings dialog applies templates through it. */
export interface DrawingSelectionToolbarHandle {
  /** Apply a saved template's style to the selected overlay. */
  applyTemplate: (tpl: OverlayTemplate) => void;
}

export interface DrawingSelectionToolbarProps {
  selected: SelectedOverlayState | null;
  /** Chart-owned ref, attached to the bar element (also read by the
   *  object-list outside-click effect in Chart). */
  barRef: RefObject<HTMLDivElement | null>;
  /** Read-only compat-click guard (owned by Drawing -> Selected). */
  barIgnoreClicksUntilRef: RefObject<number>;
  onApplyEdit: (patch: SelectionEditPatch, pushHistory?: boolean) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onOpenDialog: (id: string, tab: DialogTab) => void;
  /** Opacity-slider history guard (one push per drag, owned by Chart). */
  onOpacitySliderStart: () => void;
  onOpacitySliderEnd: () => void;
  /** Template persistence (Step 3), via Chart's instance. */
  loadTemplates: () => OverlayTemplates;
  saveTemplates: (next: OverlayTemplates) => void;
  /** Default template per tool type, via Chart's instance. */
  loadTemplateDefaults: () => Record<string, string>;
  saveTemplateDefaults: (next: Record<string, string>) => void;
  /** Mirror notification so Chart's dialog sees template changes. */
  onTemplatesChange: (next: OverlayTemplates) => void;
}

/** Small 20px stroke icons for the floating bar (icon-only). */
const BAR_ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function BarLockIcon({ locked }: { locked: boolean }) {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      {locked ? (
        <path d="M6.5 9V7a3.5 3.5 0 0 1 7 0v2" />
      ) : (
        <path d="M6.5 9V7a3.5 3.5 0 0 1 6.9-.8" />
      )}
    </svg>
  );
}

function BarEyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
      <circle cx="10" cy="10" r="2.5" />
      {hidden && <line x1="3.5" y1="3.5" x2="16.5" y2="16.5" />}
    </svg>
  );
}

/** Proper cog: toothed ring + centre hole. The old circle-and-spokes
 *  read as a sun on phones. Also used by Chart's top-right
 *  appearance button, so it is exported. */
export function BarGearIcon() {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <circle cx="10" cy="10" r="6" />
      <circle cx="10" cy="10" r="2.6" />
      <g fill="currentColor" stroke="none">
        <rect x="8.8" y="2" width="2.4" height="2.8" rx="0.6" />
        <rect x="8.8" y="15.2" width="2.4" height="2.8" rx="0.6" />
        <rect x="2" y="8.8" width="2.8" height="2.4" rx="0.6" />
        <rect x="15.2" y="8.8" width="2.8" height="2.4" rx="0.6" />
        <rect
          x="13.4"
          y="4.2"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 14.6 5.4)"
        />
        <rect
          x="4.2"
          y="4.2"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 5.4 5.4)"
        />
        <rect
          x="4.2"
          y="13.4"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 5.4 14.6)"
        />
        <rect
          x="13.4"
          y="13.4"
          width="2.4"
          height="2.4"
          rx="0.6"
          transform="rotate(45 14.6 14.6)"
        />
      </g>
    </svg>
  );
}

/** Pencil icon, matching TV's floating-bar colour button: the
 *  pencil opens the colour picker; the bar under it (rendered by
 *  the button, not the icon) shows the current line colour. */
function BarPencilIcon() {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" />
    </svg>
  );
}

/** Template icon: 2×2 rounded grid (田), matching TV's template button. */
function BarTemplateIcon() {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="3.5" width="6" height="6" rx="1.5" />
      <rect x="3.5" y="10.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function BarTrashIcon() {
  return (
    <svg {...BAR_ICON_PROPS} aria-hidden="true">
      <path d="M4 5.5h12M8 5.5V4h4v1.5M6.5 5.5l.8 10.5h5.4l.8-10.5M10 8.5v5" />
    </svg>
  );
}

// Floating-bar position: one compact icon bar, docked at the
// bottom centre of the chart on every screen width (desktop now
// matches mobile). It covers the bottom ~50px of the chart while
// open; popovers open upward from it.

const DrawingSelectionToolbar = forwardRef<
  DrawingSelectionToolbarHandle,
  DrawingSelectionToolbarProps
>(function DrawingSelectionToolbar(
  {
    selected,
    barRef,
    barIgnoreClicksUntilRef,
    onApplyEdit,
    onDelete,
    onDeselect,
    onOpenDialog,
    onOpacitySliderStart,
    onOpacitySliderEnd,
    loadTemplates,
    saveTemplates,
    loadTemplateDefaults,
    saveTemplateDefaults,
    onTemplatesChange,
  }: DrawingSelectionToolbarProps,
  ref,
) {
  /** Which floating-bar popover is open, if any. */
  const [openPanel, setOpenPanel] = useState<
    'color' | 'lineStyle' | 'template' | null
  >(null);
  /** Overlay style templates, grouped by overlay name (tool type). */
  const [templates, setTemplates] =
    useState<OverlayTemplates>(() => loadTemplates());
  /** Default template per tool type (tool name -> template name). */
  const [templateDefaults, setTemplateDefaults] = useState<
    Record<string, string>
  >(() => loadTemplateDefaults());
  /** Name typed for "save current style as template". */
  const [templateName, setTemplateName] = useState('');
  /** The save-as name row only shows after "儲存繪圖模板為...". */
  const [showSaveAs, setShowSaveAs] = useState(false);

  /** Deselect closes any open popover (was setOpenPanel(null) in
   *  Chart's setSelectedState; the bar unmounts with the selection,
   *  so the panel must not linger for the next selection).
   *  Render-time adjustment (React docs "Adjusting state when a
   *  prop changes"): no effect, so no cascading render after
   *  commit. Covers every path that makes selected null, because
   *  it keys off the rendered prop, not a call site. The guard
   *  prevents a loop: once null, the next render skips the call. */
  if (selected === null && openPanel !== null) {
    setOpenPanel(null);
  }

  /** Close any open floating-bar popover when clicking outside the bar. */
  useEffect(() => {
    if (openPanel === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel, barRef]);

  const togglePanel = (panel: 'color' | 'lineStyle' | 'template') => {
    setOpenPanel((cur) => (cur === panel ? null : panel));
    // The save-as name row only lives inside the template menu:
    // switching panels (or closing) hides it.
    setShowSaveAs(false);
  };

  /** Apply a saved template's style to the selected overlay.
   *  Memoised so the imperative handle's dependency is stable
   *  (otherwise useImperativeHandle would re-run every render). */
  const applyTemplate = useCallback(
    (tpl: OverlayTemplate) => {
      onApplyEdit({
        color: tpl.style.color,
        opacity: tpl.style.opacity,
        size: tpl.style.size,
        style: tpl.style.style,
        fillOpacity: tpl.style.fillOpacity,
      });
      setOpenPanel(null);
      setShowSaveAs(false);
    },
    [onApplyEdit],
  );

  useImperativeHandle(ref, () => ({ applyTemplate }), [applyTemplate]);

  /** Save the selected overlay's current style as a template. A
   *  duplicate name overwrites the existing template in place. */
  const saveTemplate = () => {
    const cur = selected;
    if (!cur) return;
    const name = templateName.trim();
    if (!name) return;
    const style: LastOverlayStyle = {
      color: cur.color,
      opacity: cur.opacity,
      size: cur.size,
      style: cur.style,
      fillOpacity: cur.fillOpacity,
    };
    setTemplates((prev) => {
      const group = prev[cur.name] ?? [];
      const idx = group.findIndex((t) => t.name === name);
      const nextGroup =
        idx >= 0
          ? group.map((t, i) => (i === idx ? { name, style } : t))
          : [...group, { name, style }];
      const next = { ...prev, [cur.name]: nextGroup };
      saveTemplates(next);
      onTemplatesChange(next);
      return next;
    });
    setTemplateName('');
    setShowSaveAs(false);
  };

  /** Delete a saved template from the selected overlay's group. A
   *  deleted default stops being the default for that tool type. */
  const deleteTemplate = (name: string) => {
    const cur = selected;
    if (!cur) return;
    if (templateDefaults[cur.name] === name) {
      setTemplateDefaults((prev) => {
        const next = { ...prev };
        delete next[cur.name];
        saveTemplateDefaults(next);
        return next;
      });
    }
    setTemplates((prev) => {
      const group = (prev[cur.name] ?? []).filter((t) => t.name !== name);
      const next = { ...prev };
      if (group.length > 0) next[cur.name] = group;
      else delete next[cur.name];
      saveTemplates(next);
      onTemplatesChange(next);
      return next;
    });
  };

  /** Set (or clear, with null) the default template for the
   *  selected overlay's tool type. The default applies to new
   *  drawings of that type (armOverlay) and to "套用預設繪圖範本". */
  const setDefaultTemplate = (name: string | null) => {
    const cur = selected;
    if (!cur) return;
    setTemplateDefaults((prev) => {
      const next = { ...prev };
      if (name === null) delete next[cur.name];
      else next[cur.name] = name;
      saveTemplateDefaults(next);
      return next;
    });
  };

  /** Apply the default template for the selected overlay's tool type. */
  const applyDefaultTemplate = () => {
    const cur = selected;
    if (!cur) return;
    const name = templateDefaults[cur.name];
    if (!name) return;
    const tpl = (templates[cur.name] ?? []).find((t) => t.name === name);
    if (tpl) applyTemplate(tpl);
  };

  if (selected === null) return null;

  return (
    <div
      ref={barRef}
      data-testid="floating-bar"
      onClickCapture={(e) => {
        // Swallow the compatibility click from the tap that ended
        // the draw (see barIgnoreClicksUntilRef, owned by the
        // Drawing -> Selected transition): the bar renders under
        // the finger before that click lands.
        if (Date.now() < barIgnoreClicksUntilRef.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      className="absolute z-20 flex max-w-full flex-nowrap items-center gap-1 rounded-md border border-[#2a2e39] bg-[#1e222d]/95 px-2 py-1.5 text-xs text-[#d1d4dc] shadow-lg"
      style={{ left: '50%', bottom: 8, transform: 'translateX(-50%)' }}
    >
      {/* A standalone text annotation has no line to style: hide
          the colour / line-style controls for it. */}
      {selected.name !== TEXT_ANNOTATION_NAME && (
        <>
          {/* Template button (first, icon-only). A text
              annotation has no line to style, so it gets no
              template button either (same as the colour /
              line-style controls). */}
          <button
            title="範本"
            aria-label="範本"
            onClick={() => togglePanel('template')}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10 ${
              openPanel === 'template' ? 'bg-white/10' : ''
            }`}
          >
            <BarTemplateIcon />
          </button>
          {/* TV-style colour button: pencil + current-colour bar. */}
          <button
            title={`顏色 ${selected.color}（不透明度 ${Math.round(selected.opacity * 100)}%）`}
            aria-label="顏色"
            onClick={() => togglePanel('color')}
            className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-[3px] rounded-sm hover:bg-white/10 ${
              openPanel === 'color' ? 'bg-white/10' : ''
            }`}
          >
            <BarPencilIcon />
            <span
              className="block h-[3px] w-5 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          </button>
          {/* Icon-only line style (no label, no widths). */}
          <button
            title="線形"
            aria-label="線形"
            onClick={() => togglePanel('lineStyle')}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10 ${
              openPanel === 'lineStyle' ? 'bg-white/10' : ''
            }`}
          >
            <span
              className="block w-6 border-t-2"
              style={{
                borderTopColor: hexToRgba(
                  selected.color,
                  selected.opacity,
                ),
                borderTopStyle:
                  selected.style === 'solid'
                    ? 'solid'
                    : selected.style === 'dashed'
                      ? 'dashed'
                      : 'dotted',
              }}
            />
          </button>
        </>
      )}
      {/* Icon-only lock / hide / settings / delete. */}
      <button
        title={selected.lock ? '已鎖定（點按解鎖）' : '鎖定（點按鎖定）'}
        aria-label={selected.lock ? '已鎖定' : '鎖定'}
        onClick={() => onApplyEdit({ lock: !selected.lock })}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
      >
        <BarLockIcon locked={selected.lock} />
      </button>
      <button
        title={selected.visible ? '隱藏' : '顯示'}
        aria-label={selected.visible ? '隱藏' : '顯示'}
        onClick={() => onApplyEdit({ visible: !selected.visible })}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
      >
        <BarEyeIcon hidden={!selected.visible} />
      </button>
      <button
        title="設定"
        aria-label="設定"
        onClick={() =>
          onOpenDialog(
            selected.id,
            selected.name === TEXT_ANNOTATION_NAME ? 'text' : 'style',
          )
        }
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
      >
        <BarGearIcon />
      </button>
      <button
        title="刪除"
        aria-label="刪除"
        onClick={onDelete}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-[#ef5350] hover:bg-white/10"
      >
        <BarTrashIcon />
      </button>
      <button
        onClick={onDeselect}
        aria-label="取消選取"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
      >
        ✕
      </button>
      {openPanel === 'color' && (
        <div className="absolute bottom-full left-0 z-40 mb-1">
          <ColorPicker
            color={selected.color}
            opacity={selected.opacity}
            // Picking a color closes the panel (same as the line-style
            // panel): leaving it open covers the chart and swallows
            // the next click on the canvas.
            onColorChange={(c) => {
              onApplyEdit({ color: c });
              setOpenPanel(null);
            }}
            onOpacityChange={(op) => onApplyEdit({ opacity: op }, false)}
            onOpacityStart={onOpacitySliderStart}
            onOpacityEnd={onOpacitySliderEnd}
          />
        </div>
      )}
      {openPanel === 'lineStyle' && (
        <div className="absolute bottom-full left-0 z-40 mb-1 w-44 rounded-md border border-[#2a2e39] bg-[#1e222d] p-1 shadow-xl">
          {LINE_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                onApplyEdit({ style: opt.id });
                setOpenPanel(null);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-white/10 max-md:py-2.5"
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
              <span>{opt.label}</span>
              {selected.style === opt.id && (
                <span className="ml-auto text-[#2962ff]">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
      {openPanel === 'template' && (
        <div className="absolute bottom-full left-0 z-40 mb-1 w-60 rounded-md border border-[#2a2e39] bg-[#1e222d] p-1 shadow-xl">
          {/* TV-style menu: save-as + apply default first. */}
          <button
            onClick={() => setShowSaveAs((v) => !v)}
            className="flex w-full items-center rounded-sm px-2 py-2 text-left text-sm hover:bg-white/10 max-md:py-2.5"
          >
            儲存繪圖模板為...
          </button>
          <button
            onClick={applyDefaultTemplate}
            disabled={templateDefaults[selected.name] === undefined}
            title={
              templateDefaults[selected.name] === undefined
                ? '尚未設定預設範本（在範本旁按 ☆ 設為預設）'
                : `套用預設範本 ${templateDefaults[selected.name]}`
            }
            className="flex w-full items-center rounded-sm px-2 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-40 max-md:py-2.5"
          >
            套用預設繪圖範本
            {templateDefaults[selected.name] !== undefined && (
              <span className="ml-auto text-xs text-[#80858f]">
                {templateDefaults[selected.name]}
              </span>
            )}
          </button>
          {showSaveAs && (
            <div className="flex items-center gap-1 border-t border-[#2a2e39] px-1 pb-1 pt-2">
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTemplate();
                }}
                placeholder="範本名稱"
                aria-label="範本名稱"
                autoFocus
                className="min-w-0 flex-1 rounded-sm border border-white/20 bg-transparent px-2 py-1.5 text-xs text-[#d1d4dc] placeholder:text-[#80858f] focus:border-[#2962ff] focus:outline-none"
              />
              <button
                onClick={saveTemplate}
                disabled={templateName.trim() === ''}
                className="shrink-0 rounded-sm bg-[#2962ff] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                儲存
              </button>
            </div>
          )}
          {(templates[selected.name] ?? []).length > 0 && (
            <div className="max-h-48 overflow-y-auto border-t border-[#2a2e39] pt-1">
              {(templates[selected.name] ?? []).map((tpl) => {
                const isDefault =
                  templateDefaults[selected.name] === tpl.name;
                return (
                  <div
                    key={tpl.name}
                    className="flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-white/10"
                  >
                    <button
                      onClick={() => applyTemplate(tpl)}
                      title={`套用範本 ${tpl.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left"
                    >
                      <span
                        className="block h-4 w-4 shrink-0 rounded-[2px]"
                        style={{
                          backgroundColor: hexToRgba(
                            tpl.style.color,
                            tpl.style.opacity,
                          ),
                        }}
                      />
                      <span className="truncate text-xs">{tpl.name}</span>
                      {isDefault && (
                        <span className="shrink-0 rounded bg-[#2962ff]/20 px-1 text-[10px] text-[#2962ff]">
                          預設
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() =>
                        setDefaultTemplate(isDefault ? null : tpl.name)
                      }
                      title={isDefault ? '取消預設範本' : '設為預設範本'}
                      aria-label={
                        isDefault
                          ? `取消預設範本 ${tpl.name}`
                          : `設為預設範本 ${tpl.name}`
                      }
                      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-sm hover:bg-white/10 ${
                        isDefault ? 'text-[#f0b90b]' : 'text-[#80858f]'
                      }`}
                    >
                      {isDefault ? '★' : '☆'}
                    </button>
                    <button
                      onClick={() => deleteTemplate(tpl.name)}
                      title={`刪除範本 ${tpl.name}`}
                      aria-label={`刪除範本 ${tpl.name}`}
                      className="shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-[#ef5350] hover:bg-white/10"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {(templates[selected.name] ?? []).length === 0 && !showSaveAs && (
            <div className="px-2 py-2 text-xs text-[#80858f]">
              尚未儲存範本
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default DrawingSelectionToolbar;
