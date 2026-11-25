'use client';

/**
 * ObjectList.tsx — 物件清單（MASTER TASK Phase 2 Step 5, G-07/G-08).
 *
 * Presentational only, same pattern as ChartContextMenu: Chart.tsx owns
 * the data, the selection and every action; this component only renders
 * the rows and reports clicks. It never touches the chart, the store
 * or localStorage, and holds no copy of the drawing data — Chart feeds
 * it a fresh projection (readMergedList) and refreshes it after every
 * mutation (draw end / edit / delete / undo / redo / restore).
 *
 * Rows cover the current symbol's whole list, including hidden objects
 * (visible=false, unclickable on the canvas) and objects not shown on
 * the current interval (visibleIntervals excludes it). An out-of-view
 * row cannot be canvas-selected — its overlay is not in the chart —
 * so clicking it toggles its multi-select checkbox instead; its
 * visible/lock/delete actions edit the stored copy.
 * Multi-select is checkbox-based (G-08); marquee stays a Phase 4
 * decision and is not built here.
 */

export interface ObjectListItem {
  id: string;
  name: string;
  /** Display name, e.g. 趨勢線 (from DRAWING_TOOLS). */
  label: string;
  visible: boolean;
  lock: boolean;
  /** 1 = topmost (highest zLevel). */
  order: number;
  total: number;
  /** False when visibleIntervals excludes the current interval. */
  inView: boolean;
  /** Intervals the object is shown on, when restricted (e.g. "1h、4h"). */
  intervalsLabel?: string;
}

export type ObjectListBatchAction =
  | 'hide'
  | 'show'
  | 'lock'
  | 'unlock'
  | 'delete';

interface ObjectListProps {
  items: ObjectListItem[];
  /** Label of the current interval, e.g. 15分. */
  currentIntervalLabel: string;
  /** Id of the canvas-selected overlay, if any. */
  selectedId: string | null;
  /** Ids checked for batch actions. */
  checkedIds: string[];
  onRowClick: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onToggleAll: () => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onBatch: (action: ObjectListBatchAction) => void;
  onClose: () => void;
}

export default function ObjectList({
  items,
  currentIntervalLabel,
  selectedId,
  checkedIds,
  onRowClick,
  onToggleCheck,
  onToggleAll,
  onToggleVisible,
  onToggleLock,
  onDelete,
  onBatch,
  onClose,
}: ObjectListProps) {
  const allChecked = items.length > 0 && checkedIds.length === items.length;
  return (
    <div
      data-testid="object-list-panel"
      role="dialog"
      aria-label="物件清單"
      className="absolute right-2 top-12 z-30 flex max-h-[70%] w-80 max-w-[calc(100%-16px)] flex-col overflow-hidden rounded-md border border-[#2a2e39] bg-[#1e222d] text-xs text-[#d1d4dc] shadow-xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[#2a2e39] px-2 py-2">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={onToggleAll}
          disabled={items.length === 0}
          aria-label="全選"
          title="全選"
          className="h-4 w-4 shrink-0 accent-[#2962ff]"
        />
        <span className="min-w-0 flex-1 truncate font-semibold">
          物件清單（{items.length}）
        </span>
        <span className="shrink-0 text-[#80858f]">目前：{currentIntervalLabel}</span>
        <button
          onClick={onClose}
          aria-label="關閉物件清單"
          title="關閉"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-4 text-[#80858f]">目前標的沒有物件</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.map((item) => {
            const checked = checkedIds.includes(item.id);
            const selected = item.id === selectedId;
            const status: string[] = [
              `順序 ${item.order}/${item.total}`,
              item.visible ? '可見' : '已隱藏',
            ];
            if (item.lock) status.push('已鎖定');
            if (!item.inView) {
              status.push(
                item.intervalsLabel
                  ? `不在目前週期（僅 ${item.intervalsLabel}）`
                  : '不在目前週期',
              );
            }
            return (
              <div
                key={item.id}
                data-testid="object-list-row"
                data-item-id={item.id}
                className={`flex items-center gap-1 border-b border-[#2a2e39]/60 px-2 py-1.5 ${
                  selected ? 'bg-[#2962ff]/20' : checked ? 'bg-white/5' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleCheck(item.id)}
                  aria-label={`選取 ${item.label}`}
                  title="多選（批次操作）"
                  data-testid="object-list-check"
                  className="h-4 w-4 shrink-0 accent-[#2962ff]"
                />
                <button
                  onClick={() => onRowClick(item.id)}
                  title={
                    item.inView
                      ? `選取 ${item.label}`
                      : '不在目前週期，切換週期後才能在圖上選取；點按改為多選'
                  }
                  className="min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left hover:bg-white/10"
                >
                  <span className="block truncate font-medium">
                    {item.label}
                  </span>
                  <span className="block truncate text-[11px] text-[#80858f]">
                    {status.join(' · ')}
                  </span>
                </button>
                <button
                  onClick={() => onToggleVisible(item.id)}
                  aria-label={item.visible ? '隱藏' : '顯示'}
                  title={item.visible ? '隱藏' : '顯示'}
                  data-testid="object-list-visible"
                  className="shrink-0 rounded-sm px-1.5 py-1 hover:bg-white/10"
                >
                  {item.visible ? '隱藏' : '顯示'}
                </button>
                <button
                  onClick={() => onToggleLock(item.id)}
                  aria-label={item.lock ? '已鎖定' : '鎖定'}
                  title={item.lock ? '解鎖' : '鎖定'}
                  data-testid="object-list-lock"
                  className="shrink-0 rounded-sm px-1.5 py-1 hover:bg-white/10"
                >
                  {item.lock ? '已鎖定' : '鎖定'}
                </button>
                <button
                  onClick={() => onDelete(item.id)}
                  aria-label="刪除"
                  title="刪除"
                  data-testid="object-list-delete"
                  className="shrink-0 rounded-sm px-1.5 py-1 text-[#ef5350] hover:bg-white/10"
                >
                  刪除
                </button>
              </div>
            );
          })}
        </div>
      )}
      {checkedIds.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-[#2a2e39] px-2 py-2">
          <span className="mr-1 text-[#80858f]">
            已選 {checkedIds.length} 個
          </span>
          <button
            onClick={() => onBatch('hide')}
            data-testid="object-list-batch-hide"
            className="rounded-sm px-2 py-1 hover:bg-white/10"
          >
            隱藏
          </button>
          <button
            onClick={() => onBatch('show')}
            data-testid="object-list-batch-show"
            className="rounded-sm px-2 py-1 hover:bg-white/10"
          >
            顯示
          </button>
          <button
            onClick={() => onBatch('lock')}
            data-testid="object-list-batch-lock"
            className="rounded-sm px-2 py-1 hover:bg-white/10"
          >
            鎖定
          </button>
          <button
            onClick={() => onBatch('unlock')}
            data-testid="object-list-batch-unlock"
            className="rounded-sm px-2 py-1 hover:bg-white/10"
          >
            解鎖
          </button>
          <button
            onClick={() => onBatch('delete')}
            data-testid="object-list-batch-delete"
            className="rounded-sm px-2 py-1 text-[#ef5350] hover:bg-white/10"
          >
            刪除
          </button>
        </div>
      )}
    </div>
  );
}
