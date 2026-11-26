'use client';

/**
 * Toolbar.tsx — top bar (TradingView-style, h-10).
 *
 * Left: symbol button (opens a symbol search dropdown, same ranking as
 * the watchlist search), timeframe buttons as plain text (active =
 * text #2962ff, no pill container), chart-type dropdown (蠟燭圖／美國線
 * ／面積圖), "ƒx 指標" dropdown listing INDICATOR_OPTIONS with
 * checkmarks, undo / redo (TradingView puts them in the top bar).
 * Right: connection status dot, and a mobile-only "自選" button that
 * opens the watchlist drawer.
 *
 * The bar scrolls horizontally on narrow screens instead of wrapping.
 * The three dropdown menus are fixed-positioned and anchored to their
 * buttons: the header's overflow-x-auto would clip absolutely positioned
 * menus that extend below the 40px bar (they opened in state but painted
 * zero pixels, so chart-type / indicators looked unclickable).
 * Magnet and clear live in the left vertical DrawingBar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INTERVALS, INTERVAL_LABELS, type Interval } from '@/lib/types';
import {
  CHART_TYPES,
  INDICATOR_OPTIONS,
  type ChartType,
} from '@/lib/chart-config';
import { searchSymbols, type SymbolInfo } from '@/lib/symbols';
import type { BinanceSocketStatus } from '@/lib/ws/binance';

export interface ToolbarProps {
  symbol: string;
  interval: Interval;
  onIntervalChange: (interval: Interval) => void;
  indicators: string[];
  onToggleIndicator: (name: string) => void;
  connectionStatus: BinanceSocketStatus;
  /** Mobile only: open the watchlist drawer. */
  onOpenWatchlist: () => void;
  /** Binance spot symbols, or null while still loading. */
  symbolList?: SymbolInfo[] | null;
  /** Switch chart symbol (from the symbol search dropdown). */
  onSelectSymbol: (symbol: string) => void;
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Shared with the StatusBar so both show the same dot + label. */
export const STATUS_META: Record<BinanceSocketStatus, { dot: string; text: string }> = {
  connecting: { dot: 'bg-yellow-400', text: '連線中' },
  live: { dot: 'bg-[#26a69a]', text: '即時' },
  reconnecting: { dot: 'bg-yellow-400', text: '重連中' },
  closed: { dot: 'bg-[#5d606b]', text: '未連線' },
};

const MAX_SUGGESTIONS = 8;

function UndoIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 5L3 10l5 5" />
      <path d="M3 10h10a4 4 0 0 1 0 8h-3" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5l5 5-5 5" />
      <path d="M17 10H7a4 4 0 0 0 0 8h3" />
    </svg>
  );
}

export default function Toolbar({
  symbol,
  interval,
  onIntervalChange,
  indicators,
  onToggleIndicator,
  connectionStatus,
  onOpenWatchlist,
  symbolList = null,
  onSelectSymbol,
  chartType,
  onChartTypeChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const status = STATUS_META[connectionStatus];
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [chartTypeOpen, setChartTypeOpen] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  // Fixed menu anchor: viewport position of the button that opened the
  // menu (clamped so the menu stays inside the viewport). Set together
  // with the open flag, cleared together with it.
  const symbolBtnRef = useRef<HTMLButtonElement | null>(null);
  const chartTypeBtnRef = useRef<HTMLButtonElement | null>(null);
  const indicatorsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ left: number; top: number } | null>(null);
  const closeAllMenus = useCallback(() => {
    setSymbolOpen(false);
    setChartTypeOpen(false);
    setIndicatorsOpen(false);
    setMenuAnchor(null);
  }, []);
  const openMenuAt = (btn: HTMLButtonElement | null, width: number) => {
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setMenuAnchor({ left, top: r.bottom + 4 });
  };
  useEffect(() => {
    if (!symbolOpen && !chartTypeOpen && !indicatorsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAllMenus();
    };
    const onResize = () => closeAllMenus();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [symbolOpen, chartTypeOpen, indicatorsOpen, closeAllMenus]);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const listReady = symbolList !== null && symbolList.length > 0;
  const results = useMemo(() => {
    if (!listReady || !query.trim()) return [];
    return searchSymbols(symbolList, query, MAX_SUGGESTIONS);
  }, [listReady, symbolList, query]);

  const pickSymbol = (next: string) => {
    setSymbolOpen(false);
    setMenuAnchor(null);
    setQuery('');
    setHighlight(0);
    onSelectSymbol(next);
  };

  const onSymbolKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      if (results.length > 0 && highlight < results.length) {
        e.preventDefault();
        pickSymbol(results[highlight].symbol);
      }
    } else if (e.key === 'Escape') {
      closeAllMenus();
    }
  };

  const chartTypeLabel =
    CHART_TYPES.find((t) => t.id === chartType)?.label ?? '蠟燭圖';

  return (
    <header onScroll={closeAllMenus} className="flex h-10 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-[#2a2e39] bg-[#131722] px-3">
      <button
        onClick={onOpenWatchlist}
        className="shrink-0 rounded px-2 py-1 text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-white md:hidden"
      >
        ☰ 自選
      </button>

      <div className="relative shrink-0">
        <button
          ref={symbolBtnRef}
          onClick={() => {
            if (symbolOpen) {
              closeAllMenus();
            } else {
              setChartTypeOpen(false);
              setIndicatorsOpen(false);
              openMenuAt(symbolBtnRef.current, 256);
              setSymbolOpen(true);
            }
            setQuery('');
            setHighlight(0);
            if (!symbolOpen) {
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          className="text-sm font-semibold tracking-wide text-white hover:text-[#2962ff]"
          title="切換商品"
        >
          {symbol} ▾
        </button>
        {symbolOpen && menuAnchor && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={closeAllMenus}
            />
            <div className="fixed z-50 w-64 rounded border border-[#2a2e39] bg-[#1e222d] py-1 shadow-lg" style={{ left: menuAnchor.left, top: menuAnchor.top }}>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onSymbolKeyDown}
                placeholder="搜尋標的，如 BTC 或 SOLUSDT"
                autoComplete="off"
                className="mx-2 mb-1 w-[calc(100%-16px)] rounded bg-[#131722] px-2 py-1.5 text-xs text-[#d1d4dc] outline-none placeholder:text-[#5d606b] focus:ring-1 focus:ring-[#2962ff]"
              />
              {symbolList === null && (
                <p className="px-3 py-2 text-xs text-[#787b86]">載入標的中…</p>
              )}
              {listReady && query.trim() !== '' && results.length === 0 && (
                <p className="px-3 py-2 text-xs text-[#787b86]">
                  找不到相關標的
                </p>
              )}
              {results.map((info, i) => (
                <div
                  key={info.symbol}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => {
                    // Fires before the input blur closes the dropdown.
                    e.preventDefault();
                    pickSymbol(info.symbol);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex cursor-pointer items-center justify-between px-3 py-2 text-xs ${
                    i === highlight
                      ? 'bg-[#2a2e39] text-white'
                      : 'text-[#b2b5be]'
                  }`}
                >
                  <span className="font-medium">{info.symbol}</span>
                  <span className="text-[#787b86]">
                    {info.baseAsset} / {info.quoteAsset}
                  </span>
                </div>
              ))}
              {query.trim() === '' && (
                <p className="px-3 py-2 text-[11px] text-[#5d606b]">
                  輸入代號或幣名搜尋 Binance 標的
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {INTERVALS.map((tf) => (
          <button
            key={tf}
            onClick={() => onIntervalChange(tf)}
            className={`text-xs ${
              tf === interval
                ? 'font-medium text-[#2962ff]'
                : 'text-[#b2b5be] hover:text-white'
            }`}
          >
            {INTERVAL_LABELS[tf]}
          </button>
        ))}
      </div>

      <div className="relative shrink-0">
        <button
          ref={chartTypeBtnRef}
          onClick={() => {
            if (chartTypeOpen) {
              closeAllMenus();
            } else {
              setSymbolOpen(false);
              setIndicatorsOpen(false);
              openMenuAt(chartTypeBtnRef.current, 112);
              setChartTypeOpen(true);
            }
          }}
          className="text-xs text-[#b2b5be] hover:text-white"
        >
          {chartTypeLabel} ▾
        </button>
        {chartTypeOpen && menuAnchor && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={closeAllMenus}
            />
            <div className="fixed z-50 w-28 rounded border border-[#2a2e39] bg-[#1e222d] py-1 shadow-lg" style={{ left: menuAnchor.left, top: menuAnchor.top }}>
              {CHART_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    onChartTypeChange(t.id);
                    closeAllMenus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#d1d4dc] hover:bg-[#2a2e39]"
                >
                  <span className="w-3 shrink-0 text-[#2962ff]">
                    {t.id === chartType ? '✓' : ''}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="relative shrink-0">
        <button
          ref={indicatorsBtnRef}
          onClick={() => {
            if (indicatorsOpen) {
              closeAllMenus();
            } else {
              setSymbolOpen(false);
              setChartTypeOpen(false);
              openMenuAt(indicatorsBtnRef.current, 144);
              setIndicatorsOpen(true);
            }
          }}
          className="text-xs text-[#b2b5be] hover:text-white"
        >
          ƒx 指標
        </button>
        {indicatorsOpen && menuAnchor && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={closeAllMenus}
            />
            <div className="fixed z-50 w-36 rounded border border-[#2a2e39] bg-[#1e222d] py-1 shadow-lg" style={{ left: menuAnchor.left, top: menuAnchor.top }}>
              {INDICATOR_OPTIONS.map((ind) => {
                const on = indicators.includes(ind.id);
                return (
                  <button
                    key={ind.id}
                    onClick={() => onToggleIndicator(ind.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#d1d4dc] hover:bg-[#2a2e39]"
                  >
                    <span className="w-3 shrink-0 text-[#2962ff]">
                      {on ? '✓' : ''}
                    </span>
                    {ind.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="復原 (Ctrl+Z)"
          className="flex h-7 w-7 items-center justify-center rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b2b5be]"
        >
          <UndoIcon />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (Ctrl+Shift+Z)"
          className="flex h-7 w-7 items-center justify-center rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b2b5be]"
        >
          <RedoIcon />
        </button>
      </div>

      <div
        className="ml-auto flex shrink-0 items-center gap-1.5"
        title={status.text}
      >
        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
      </div>
    </header>
  );
}
