'use client';

/**
 * Watchlist.tsx — right watchlist panel.
 *
 * Presentational: the page owns the list (persisted in localStorage).
 * Click a row to switch symbol; × removes it; type a Binance symbol
 * (e.g. SOLUSDT) and press Enter / 新增 to add it.
 *
 * Mobile (<md): a slide-over drawer from the right, opened from the
 * toolbar (☰ 自選).
 */

import { useState } from 'react';

export interface WatchlistProps {
  symbols: string[];
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  /** Mobile only: whether the slide-over drawer is open. */
  mobileOpen?: boolean;
  /** Mobile only: close the drawer. */
  onCloseMobile?: () => void;
}

export default function Watchlist({
  symbols,
  activeSymbol,
  onSelect,
  onAdd,
  onRemove,
  mobileOpen = false,
  onCloseMobile,
}: WatchlistProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const symbol = input.trim().toUpperCase();
    if (!symbol) return;
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
      setError('代號格式不正確');
      return;
    }
    setError('');
    setInput('');
    onAdd(symbol);
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={`flex h-full w-60 shrink-0 flex-col border-l border-[#2a2e39] bg-[#131722] transition-transform duration-200 ${
          mobileOpen
            ? 'max-md:translate-x-0'
            : 'max-md:translate-x-full'
        } max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-72 max-md:shadow-2xl`}
      >
      <div className="border-b border-[#2a2e39] p-2">
        <div className="flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="新增代號，如 SOLUSDT"
            className="min-w-0 flex-1 rounded bg-[#1e222d] px-2 py-1.5 text-xs text-[#d1d4dc] outline-none placeholder:text-[#5d606b] focus:ring-1 focus:ring-[#2962ff]"
          />
          <button
            onClick={submit}
            className="shrink-0 rounded bg-[#2962ff] px-2.5 text-xs font-medium text-white hover:bg-[#1e53e5]"
          >
            新增
          </button>
          <button
            aria-label="關閉自選清單"
            onClick={onCloseMobile}
            className="shrink-0 rounded px-2 text-base leading-none text-[#b2b5be] hover:bg-[#1e222d] hover:text-white md:hidden"
          >
            ×
          </button>
        </div>
        {error && <p className="mt-1 text-[11px] text-[#ef5350]">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {symbols.length === 0 && (
          <p className="p-3 text-xs text-[#787b86]">自選清單是空的</p>
        )}
        {symbols.map((symbol) => {
          const active = symbol === activeSymbol;
          return (
            <div
              key={symbol}
              onClick={() => onSelect(symbol)}
              className={`group flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${
                active
                  ? 'bg-[#1e222d] font-medium text-white'
                  : 'text-[#b2b5be] hover:bg-[#1a1e29]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? 'bg-[#2962ff]' : 'bg-transparent group-hover:bg-[#3a3f4d]'
                  }`}
                />
                {symbol}
              </span>
              <button
                aria-label={`移除 ${symbol}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(symbol);
                }}
                className="rounded px-1 text-[#5d606b] opacity-0 hover:bg-[#2a2e39] hover:text-white group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <p className="border-t border-[#2a2e39] px-3 py-2 text-[11px] leading-relaxed text-[#5d606b]">
        資料來源：Binance
        <br />
        加密貨幣即時行情
      </p>
      </aside>
    </>
  );
}
