'use client';

/**
 * Terminal home page — dark layout, no login, no database.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Toolbar (symbol · timeframe · tools · inds)  │
 *   ├──────────────┬───────────────────────────────┤
 *   │ Watchlist    │ Chart (fills the rest)        │
 *   └──────────────┴───────────────────────────────┘
 *
 * Mobile (<md): the toolbar wraps into rows, the watchlist becomes a
 * slide-over drawer opened from the toolbar (☰ 自選), and the chart
 * takes the full width. The root uses h-dvh so the mobile browser
 * chrome does not cut the layout off.
 *
 * Symbol, interval, watchlist and indicator settings are persisted in
 * localStorage and restored on the next visit. Drawings are persisted by
 * the Chart component, keyed by symbol + interval.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Toolbar from '@/components/Toolbar';
import Watchlist from '@/components/Watchlist';
import type { ChartHandle } from '@/components/Chart';
import { DEFAULT_INDICATORS, type DrawingTool } from '@/lib/chart-config';

// Chart touches `window` at import time (klinecharts), so it must only
// load in the browser. The page itself still prerenders (toolbar +
// watchlist); the chart mounts on hydration.
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });
import { STORAGE_KEYS, loadJSON, loadString, saveJSON, saveString } from '@/lib/store';
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
  const [activeTool, setActiveTool] = useState<DrawingTool | null>(null);
  const [indicators, setIndicators] = useState<string[]>(DEFAULT_INDICATORS);
  const [connectionStatus, setConnectionStatus] =
    useState<BinanceSocketStatus>('closed');
  const [hydrated, setHydrated] = useState(false);
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false);
  const chartRef = useRef<ChartHandle | null>(null);

  // Load persisted state once on the client (localStorage is not available
  // during server rendering).
  useEffect(() => {
    setSymbol(loadString(STORAGE_KEYS.lastSymbol, DEFAULT_SYMBOL));
    const savedInterval = loadString(STORAGE_KEYS.lastInterval, DEFAULT_INTERVAL);
    setInterval(isInterval(savedInterval) ? savedInterval : DEFAULT_INTERVAL);
    const savedWatchlist = loadJSON<string[]>(STORAGE_KEYS.watchlist, []);
    setWatchlist(
      savedWatchlist.length > 0 ? savedWatchlist : DEFAULT_WATCHLIST,
    );
    const savedIndicators = loadJSON<string[]>(STORAGE_KEYS.indicators, []);
    setIndicators(
      savedIndicators.length > 0 ? savedIndicators : DEFAULT_INDICATORS,
    );
    setHydrated(true);
  }, []);

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
    saveJSON(STORAGE_KEYS.indicators, indicators);
  }, [indicators, hydrated]);

  const selectSymbol = useCallback((next: string) => {
    setSymbol(next);
    setActiveTool(null);
  }, []);

  const addSymbol = useCallback((next: string) => {
    setWatchlist((prev) =>
      prev.includes(next) ? prev : [...prev, next],
    );
    setSymbol(next);
    setActiveTool(null);
  }, []);

  const removeSymbol = useCallback(
    (target: string) => {
      const remaining = watchlist.filter((s) => s !== target);
      if (remaining.length === 0) return; // Never remove the last symbol.
      setWatchlist(remaining);
      if (target === symbol) setSymbol(remaining[0]);
    },
    [symbol, watchlist],
  );

  const toggleIndicator = useCallback((name: string) => {
    setIndicators((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-[#0b0e11] text-[#d1d4dc]">
      <Toolbar
        symbol={symbol}
        interval={interval}
        onIntervalChange={(tf) => {
          setInterval(tf);
          setActiveTool(null);
        }}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        indicators={indicators}
        onToggleIndicator={toggleIndicator}
        onClearDrawings={() => chartRef.current?.clearDrawings()}
        connectionStatus={connectionStatus}
        onOpenWatchlist={() => setMobileWatchlistOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <Watchlist
          symbols={watchlist}
          activeSymbol={symbol}
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
        <main className="min-w-0 flex-1">
          <Chart
            ref={chartRef}
            symbol={symbol}
            interval={interval}
            activeTool={activeTool}
            onToolDone={() => setActiveTool(null)}
            indicators={indicators}
            onConnectionStatus={setConnectionStatus}
          />
        </main>
      </div>
    </div>
  );
}
