'use client';

/**
 * Watchlist.tsx — right watchlist panel.
 *
 * Two tabs: 加密貨幣 (Binance spot, live prices) and 股票 (a local-only
 * list of TW/US tickers — no quotes yet, no data source, so rows are not
 * clickable and show「尚未支援報價」; adding a stock ticker only stores
 * it in localStorage).
 *
 * Crypto tab: the search box searches the Binance spot symbol list
 * (GET /api/symbols, passed in as `symbolList`): typing filters matches
 * into a dropdown (keyboard: ↑/↓ + Enter, Esc closes), and
 * "找不到相關標的" is shown explicitly when nothing matches. A symbol
 * that is not on Binance (e.g. NVDA) can never be added, so the chart
 * can never show another symbol's prices under its ticker. When the
 * symbol list failed to load (`symbolList` is []), the box falls back
 * to the old behaviour: format check only.
 *
 * Click a crypto row to switch symbol; × removes it.
 *
 * Mobile (<md): a slide-over drawer from the right, opened from the
 * toolbar (☰ 自選).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isKnownSymbol,
  searchSymbols,
  type SymbolInfo,
} from '@/lib/symbols';
import { formatPrice } from '@/lib/format';

export interface WatchlistProps {
  symbols: string[];
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  /** TW/US tickers on the stock watchlist (local-only, no quotes yet). */
  stockSymbols: string[];
  onAddStock: (ticker: string) => void;
  onRemoveStock: (ticker: string) => void;
  /** Binance spot symbols, or null while still loading. */
  symbolList?: SymbolInfo[] | null;
  /** Mobile only: whether the slide-over drawer is open. */
  mobileOpen?: boolean;
  /** Mobile only: close the drawer. */
  onCloseMobile?: () => void;
}

const MAX_SUGGESTIONS = 8;

/** 24h ticker refresh interval for the price / change columns. */
const TICKER_POLL_MS = 5000;

interface TickerPrice {
  price: number;
  change: number;
}

export default function Watchlist({
  symbols,
  activeSymbol,
  onSelect,
  onAdd,
  onRemove,
  stockSymbols,
  onAddStock,
  onRemoveStock,
  symbolList = null,
  mobileOpen = false,
  onCloseMobile,
}: WatchlistProps) {
  const [tab, setTab] = useState<'crypto' | 'stock'>('crypto');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [stockInput, setStockInput] = useState('');
  const [stockError, setStockError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Last-known 24h ticker per symbol (kept on fetch failure). */
  const [prices, setPrices] = useState<Record<string, TickerPrice>>({});

  // Poll the 24h ticker for the listed symbols so the price / change
  // columns stay live (same Binance public host as /api/klines).
  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/tickers?symbols=${symbols.join(',')}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          tickers?: Array<{
            symbol: string;
            lastPrice: number;
            priceChangePercent: number;
          }>;
        };
        if (cancelled || !Array.isArray(json.tickers)) return;
        setPrices((prev) => {
          const next = { ...prev };
          for (const t of json.tickers ?? []) {
            next[t.symbol] = {
              price: t.lastPrice,
              change: t.priceChangePercent,
            };
          }
          return next;
        });
      } catch {
        // Keep the last-known prices; the next poll retries.
      }
    };
    load();
    const id = setInterval(load, TICKER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbols]);

  // The list is authoritative only when it actually loaded; an empty
  // array means the fetch failed and the box falls back to format-only.
  const listReady = symbolList !== null && symbolList.length > 0;

  const results = useMemo(() => {
    if (!listReady || !input.trim()) return [];
    return searchSymbols(symbolList, input, MAX_SUGGESTIONS);
  }, [listReady, symbolList, input]);

  const pick = (symbol: string) => {
    setError('');
    setInput('');
    setOpen(false);
    onAdd(symbol);
    inputRef.current?.blur();
  };

  const submit = () => {
    const symbol = input.trim().toUpperCase();
    if (!symbol) return;
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
      setError('代號格式不正確');
      return;
    }
    if (listReady) {
      if (isKnownSymbol(symbolList, symbol)) {
        pick(symbol);
        return;
      }
      // Known list, unknown symbol: say so explicitly and add nothing.
      setError(`Binance 沒有 ${symbol} 這個標的`);
      setOpen(true);
      return;
    }
    // Symbol list unavailable: keep the old format-only behaviour.
    pick(symbol);
  };

  /** Stock tab: format check only — no data source to validate against. */
  const submitStock = () => {
    const ticker = stockInput.trim().toUpperCase().replace(/\s+/g, '');
    if (!ticker) return;
    if (!/^[A-Z0-9]+(\.[A-Z]+)?$/.test(ticker) || ticker.length > 12) {
      setStockError('代號格式不正確（例：NVDA、2330、2330.TW）');
      return;
    }
    if (stockSymbols.includes(ticker)) {
      setStockError(`${ticker} 已經在清單裡`);
      return;
    }
    setStockError('');
    setStockInput('');
    onAddStock(ticker);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && open && results.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp' && open && results.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      if (open && results.length > 0 && highlight < results.length) {
        e.preventDefault();
        pick(results[highlight].symbol);
      } else {
        submit();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
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
        className={`flex h-full w-64 shrink-0 flex-col border-l border-[#2a2e39] bg-[#131722] transition-transform duration-200 ${
          mobileOpen
            ? 'max-md:translate-x-0'
            : 'max-md:translate-x-full'
        } max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-72 max-md:shadow-2xl`}
      >
      <div className="flex shrink-0 border-b border-[#2a2e39]">
        <button
          onClick={() => setTab('crypto')}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === 'crypto'
              ? 'border-b-2 border-[#2962ff] text-white'
              : 'text-[#787b86] hover:text-[#b2b5be]'
          }`}
        >
          加密貨幣
        </button>
        <button
          onClick={() => setTab('stock')}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === 'stock'
              ? 'border-b-2 border-[#2962ff] text-white'
              : 'text-[#787b86] hover:text-[#b2b5be]'
          }`}
        >
          股票
        </button>
      </div>
      {tab === 'crypto' && (
      <>
      <div className="relative border-b border-[#2a2e39] p-2">
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError('');
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => {
              if (input.trim()) setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder="搜尋標的，如 BTC 或 SOLUSDT"
            autoComplete="off"
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
        {open && input.trim() !== '' && (
          <div className="absolute left-2 right-2 top-full z-30 mt-1 overflow-hidden rounded-md border border-[#2a2e39] bg-[#1e222d] shadow-xl">
            {symbolList === null && (
              <p className="px-3 py-2 text-xs text-[#787b86]">載入標的中…</p>
            )}
            {listReady && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-[#787b86]">
                找不到相關標的
                <span className="block text-[11px] text-[#5d606b]">
                  Binance 沒有符合的加密貨幣
                </span>
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
                  pick(info.symbol);
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
            {results.length > 0 &&
              !results.some(
                (r) => r.symbol === input.trim().toUpperCase(),
              ) && (
                <p className="border-t border-[#2a2e39] px-3 py-1.5 text-[11px] text-[#5d606b]">
                  沒有完全符合 {input.trim().toUpperCase()} 的標的
                </p>
              )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center border-b border-[#2a2e39] px-3 py-1.5 text-[11px] text-[#787b86]">
        <span className="min-w-0 flex-1">商品</span>
        <span className="w-20 shrink-0 text-right">最新價</span>
        <span className="w-14 shrink-0 text-right">漲跌%</span>
        <span className="w-4 shrink-0" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {symbols.length === 0 && (
          <p className="p-3 text-xs text-[#787b86]">自選清單是空的</p>
        )}
        {symbols.map((symbol) => {
          const active = symbol === activeSymbol;
          const tick = prices[symbol];
          const up = (tick?.change ?? 0) >= 0;
          const changeColor = tick
            ? up
              ? 'text-[#26a69a]'
              : 'text-[#ef5350]'
            : 'text-[#787b86]';
          return (
            <div
              key={symbol}
              onClick={() => onSelect(symbol)}
              className={`group flex cursor-pointer items-center px-3 py-2 text-sm ${
                active
                  ? 'bg-[#1e222d] font-medium text-white'
                  : 'text-[#b2b5be] hover:bg-[#1a1e29]'
              }`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? 'bg-[#2962ff]' : 'bg-transparent group-hover:bg-[#3a3f4d]'
                  }`}
                />
                <span className="truncate">{symbol}</span>
              </span>
              <span
                className={`w-20 shrink-0 text-right tabular-nums ${changeColor}`}
              >
                {tick ? formatPrice(tick.price) : '—'}
              </span>
              <span
                className={`w-14 shrink-0 text-right tabular-nums ${changeColor}`}
              >
                {tick
                  ? `${up ? '+' : ''}${tick.change.toFixed(2)}%`
                  : '—'}
              </span>
              <button
                aria-label={`移除 ${symbol}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(symbol);
                }}
                className="w-4 shrink-0 rounded px-1 text-[#5d606b] opacity-0 hover:bg-[#2a2e39] hover:text-white group-hover:opacity-100"
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
      </>
      )}
      {tab === 'stock' && (
      <>
      <div className="border-b border-[#2a2e39] p-2">
        <div className="flex gap-1.5">
          <input
            value={stockInput}
            onChange={(e) => {
              setStockInput(e.target.value);
              setStockError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitStock();
            }}
            placeholder="輸入股票代號，如 NVDA 或 2330"
            autoComplete="off"
            className="min-w-0 flex-1 rounded bg-[#1e222d] px-2 py-1.5 text-xs text-[#d1d4dc] outline-none placeholder:text-[#5d606b] focus:ring-1 focus:ring-[#2962ff]"
          />
          <button
            onClick={submitStock}
            className="shrink-0 rounded bg-[#2962ff] px-2.5 text-xs font-medium text-white hover:bg-[#1e53e5]"
          >
            新增
          </button>
        </div>
        {stockError && (
          <p className="mt-1 text-[11px] text-[#ef5350]">{stockError}</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {stockSymbols.length === 0 && (
          <p className="p-3 text-xs leading-relaxed text-[#787b86]">
            股票觀察清單是空的。輸入代號加入，例如 NVDA、AAPL、2330。
          </p>
        )}
        {stockSymbols.map((ticker) => (
          <div
            key={ticker}
            className="group flex items-center px-3 py-2 text-sm text-[#b2b5be] hover:bg-[#1a1e29]"
          >
            <span className="min-w-0 flex-1 truncate">{ticker}</span>
            <span className="shrink-0 text-[11px] text-[#5d606b]">
              尚未支援報價
            </span>
            <button
              aria-label={`移除 ${ticker}`}
              onClick={() => onRemoveStock(ticker)}
              className="ml-2 w-4 shrink-0 rounded px-1 text-[#5d606b] opacity-0 hover:bg-[#2a2e39] hover:text-white group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <p className="border-t border-[#2a2e39] px-3 py-2 text-[11px] leading-relaxed text-[#5d606b]">
        台股美股報價尚未接入
        <br />
        點選不會切換圖表
      </p>
      </>
      )}
      </aside>
    </>
  );
}
