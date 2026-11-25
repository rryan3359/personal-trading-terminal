'use client';

/**
 * Terminal home page — dark layout, no login, no database.
 *
 *   ┌───────────────────────────────────────────────────┐
 *   │ Toolbar (symbol · timeframe · chart type ·        │
 *   │   indicators · undo/redo · live)                  │
 *   ├──────┬──────────────────────────────┬─────────────┤
 *   │ Draw │ Chart (fills the rest)       │ Watchlist   │
 *   │ ing  │                              │ (right)     │
 *   │ Bar  │                              │             │
 *   ├──────┴──────────────────────────────┴─────────────┤
 *   │ RangeBar (1天 5天 1月 3月 6月 YTD 1年 全部)       │
 *   │ StatusBar (商品 · 交易所 · 週期 | 時區 + 時鐘 |   │
 *   │   Binance WS 連線狀態 + 最後 tick)                │
 *   └───────────────────────────────────────────────────┘
 *
 * Mobile (<md): the drawing bar stays on the left, the watchlist
 * becomes a slide-over drawer from the right opened from the toolbar
 * (☰ 自選), and the chart takes the remaining width. The root uses
 * h-dvh so the mobile browser chrome does not cut the layout off.
 *
 * Symbol, interval, watchlist and indicator settings are persisted in
 * localStorage and restored on the next visit. Drawings are persisted by
 * the Chart component, keyed by symbol (scope 'symbol' by default, shown
 * on every interval; scope 'interval' limits one to its own interval).
 * The restored watchlist is validated against the Binance symbol list
 * once it loads: symbols that are not on Binance (e.g. NVDA, added
 * before validation existed) are dropped, so a stale chart can never
 * show another symbol's prices under the wrong ticker.
 * The stock watchlist is a separate local-only list of TW/US tickers
 * with no quotes yet (no Yahoo source — Phase 2 is halted); it never
 * touches the chart.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Toolbar from '@/components/Toolbar';
import DrawingBar from '@/components/DrawingBar';
import Watchlist from '@/components/Watchlist';
import RangeBar from '@/components/RangeBar';
import StatusBar from '@/components/StatusBar';
import type { ChartHandle } from '@/components/Chart';
import {
  DEFAULT_CHART_TYPE,
  DEFAULT_INDICATORS,
  type ChartType,
  type DrawingTool,
  type RangeId,
} from '@/lib/chart-config';

// Chart touches `window` at import time (klinecharts), so it must only
// load in the browser. The page itself still prerenders (toolbar +
// watchlist); the chart mounts on hydration.
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });
import { STORAGE_KEYS, loadJSON, loadString, saveJSON, saveString } from '@/lib/store';
import { fetchSymbolList, isKnownSymbol, type SymbolInfo } from '@/lib/symbols';
import type { Interval } from '@/lib/types';
import { isInterval } from '@/lib/types';
import type { BinanceSocketStatus } from '@/lib/ws/binance';

const DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_INTERVAL: Interval = '15m';

export default function Home() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [interval, setInterval] = useState<Interval>(DEFAULT_INTERVAL);
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  /** TW/US tickers on the stock watchlist (local-only, no quotes yet). */
  const [stockWatchlist, setStockWatchlist] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingTool | null>(null);
  const [drawContinuous, setDrawContinuous] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [indicators, setIndicators] = useState<string[]>(DEFAULT_INDICATORS);
  const [chartType, setChartType] = useState<ChartType>(DEFAULT_CHART_TYPE);
  const [activeRange, setActiveRange] = useState<RangeId | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<BinanceSocketStatus>('closed');
  /** Wall-clock ms of the last live tick (status bar), or null yet. */
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false);
  /** Binance spot symbols, or null while still loading. */
  const [symbolList, setSymbolList] = useState<SymbolInfo[] | null>(null);
  const chartRef = useRef<ChartHandle | null>(null);

  // Load persisted state once on the client (localStorage is not available
  // during server rendering).
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount sync
     from localStorage (an external system); lazy initializers would read
     localStorage during SSR and mismatch hydration. */
  useEffect(() => {
    setSymbol(loadString(STORAGE_KEYS.lastSymbol, DEFAULT_SYMBOL));
    const savedInterval = loadString(STORAGE_KEYS.lastInterval, DEFAULT_INTERVAL);
    setInterval(isInterval(savedInterval) ? savedInterval : DEFAULT_INTERVAL);
    const savedWatchlist = loadJSON<string[]>(STORAGE_KEYS.watchlist, []);
    setWatchlist(
      savedWatchlist.length > 0 ? savedWatchlist : DEFAULT_WATCHLIST,
    );
    setStockWatchlist(
      loadJSON<string[]>(STORAGE_KEYS.stockWatchlist, []),
    );
    const savedIndicators = loadJSON<string[]>(STORAGE_KEYS.indicators, []);
    setIndicators(
      savedIndicators.length > 0 ? savedIndicators : DEFAULT_INDICATORS,
    );
    const savedChartType = loadString(
      STORAGE_KEYS.chartType,
      DEFAULT_CHART_TYPE,
    );
    setChartType(
      savedChartType === 'ohlc' || savedChartType === 'area'
        ? savedChartType
        : DEFAULT_CHART_TYPE,
    );
    setHydrated(true);
    // Validate the restored list against the real Binance universe once
    // it loads. A failed fetch leaves the stored list untouched.
    let cancelled = false;
    fetchSymbolList().then((list) => {
      if (cancelled) return;
      setSymbolList(list);
      if (list.length === 0) return;
      setWatchlist((prev) => {
        const kept = prev.filter((s) => isKnownSymbol(list, s));
        return kept.length > 0 ? kept : DEFAULT_WATCHLIST;
      });
      setSymbol((prev) =>
        isKnownSymbol(list, prev) ? prev : DEFAULT_SYMBOL,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist state changes (skip until the first load has run).
  useEffect(() => {
    if (!hydrated) return;
    saveString(STORAGE_KEYS.lastSymbol, symbol);
  }, [symbol, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveString(STORAGE_KEYS.lastInterval, interval);
  }, [interval, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(STORAGE_KEYS.watchlist, watchlist);
  }, [watchlist, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(STORAGE_KEYS.stockWatchlist, stockWatchlist);
  }, [stockWatchlist, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(STORAGE_KEYS.indicators, indicators);
  }, [indicators, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveString(STORAGE_KEYS.chartType, chartType);
  }, [chartType, hydrated]);

  // A symbol / interval change reloads the chart, so any range fit
  // from before no longer applies. Reset in the change handlers
  // (not an effect) to avoid a cascading render.

  const selectSymbol = useCallback((next: string) => {
    setSymbol(next);
    setActiveTool(null);
    setActiveRange(null);
  }, []);

  const addSymbol = useCallback(
    (next: string) => {
      // Defence in depth: the Watchlist already validates, but never let
      // an unknown symbol reach the chart (a stale chart under a wrong
      // ticker shows the previous symbol's prices).
      if (
        symbolList !== null &&
        symbolList.length > 0 &&
        !isKnownSymbol(symbolList, next)
      ) {
        return;
      }
      setWatchlist((prev) =>
        prev.includes(next) ? prev : [...prev, next],
      );
      setSymbol(next);
      setActiveTool(null);
      setActiveRange(null);
    },
    [symbolList],
  );

  const removeSymbol = useCallback(
    (target: string) => {
      const remaining = watchlist.filter((s) => s !== target);
      if (remaining.length === 0) return; // Never remove the last symbol.
      setWatchlist(remaining);
      if (target === symbol) setSymbol(remaining[0]);
      setActiveRange(null);
    },
    [symbol, watchlist],
  );

  // Stock watchlist: local-only list, no quotes, never touches the chart.
  const addStock = useCallback((ticker: string) => {
    setStockWatchlist((prev) =>
      prev.includes(ticker) ? prev : [...prev, ticker],
    );
  }, []);

  const removeStock = useCallback((ticker: string) => {
    setStockWatchlist((prev) => prev.filter((t) => t !== ticker));
  }, []);

  const toggleIndicator = useCallback((name: string) => {
    setIndicators((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const handleToolChange = useCallback(
    (tool: DrawingTool | null, continuous: boolean) => {
      setActiveTool(tool);
      setDrawContinuous(tool === null ? false : continuous);
    },
    [],
  );

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u);
    setCanRedo(r);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-[#0b0e11] text-[#d1d4dc]">
      <Toolbar
        symbol={symbol}
        interval={interval}
        onIntervalChange={(tf) => {
          setInterval(tf);
          setActiveTool(null);
          setActiveRange(null);
        }}
        indicators={indicators}
        onToggleIndicator={toggleIndicator}
        connectionStatus={connectionStatus}
        onOpenWatchlist={() => setMobileWatchlistOpen(true)}
        symbolList={symbolList}
        onSelectSymbol={selectSymbol}
        chartType={chartType}
        onChartTypeChange={setChartType}
        onUndo={() => chartRef.current?.undo()}
        onRedo={() => chartRef.current?.redo()}
        canUndo={canUndo}
        canRedo={canRedo}
      />
      <div className="flex min-h-0 flex-1">
        <DrawingBar
          activeTool={activeTool}
          onToolChange={handleToolChange}
          onClear={() => chartRef.current?.clearDrawings()}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Chart
              ref={chartRef}
              symbol={symbol}
              interval={interval}
              activeTool={activeTool}
              onToolDone={() => setActiveTool(null)}
              indicators={indicators}
              chartType={chartType}
              onConnectionStatus={setConnectionStatus}
              onLastTick={setLastTickAt}
              continuousDraw={drawContinuous}
              onHistoryChange={handleHistoryChange}
            />
          </div>
          <RangeBar
            activeRange={activeRange}
            onRange={(range) => {
              chartRef.current?.setRange(range);
              setActiveRange(range);
            }}
          />
          <StatusBar
            symbol={symbol}
            interval={interval}
            connectionStatus={connectionStatus}
            lastTickAt={lastTickAt}
          />
        </main>
        <Watchlist
          symbols={watchlist}
          activeSymbol={symbol}
          symbolList={symbolList}
          stockSymbols={stockWatchlist}
          onAddStock={addStock}
          onRemoveStock={removeStock}
          onSelect={(next) => {
            selectSymbol(next);
            setMobileWatchlistOpen(false);
          }}
          onAdd={(next) => {
            addSymbol(next);
            setMobileWatchlistOpen(false);
          }}
          onRemove={removeSymbol}
          mobileOpen={mobileWatchlistOpen}
          onCloseMobile={() => setMobileWatchlistOpen(false)}
        />
      </div>
    </div>
  );
}
