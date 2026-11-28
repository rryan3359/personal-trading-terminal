'use client';

/**
 * StatusBar.tsx — bottom status bar (TradingView-style), below the
 * range bar. Three sections:
 *
 *   Left:   symbol · exchange · interval (e.g. BTCUSDT · Binance · 15分)
 *   Middle: browser timezone + local clock, and a UTC clock
 *   Right:  data source + Binance WS status + last tick time
 *
 * The clock here is the single clock of the bottom area: the old
 * RangeBar clock was removed and merged into this bar (one interval,
 * one `now` driving both the local and the UTC readouts). On narrow
 * screens the secondary items hide instead of overflowing: the UTC
 * readout below lg, the last-tick time below sm, the whole middle
 * section below md.
 */

import { useEffect, useState } from 'react';
import { INTERVAL_LABELS, type Interval } from '@/lib/types';
import { STATUS_META } from '@/components/Toolbar';
import type { BinanceSocketStatus } from '@/lib/ws/binance';

export interface StatusBarProps {
  symbol: string;
  interval: Interval;
  connectionStatus: BinanceSocketStatus;
  /** Wall-clock ms of the last live tick, or null before the first tick. */
  lastTickAt: number | null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatHMS(d: Date, utc: boolean): string {
  return utc
    ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function StatusBar({
  symbol,
  interval,
  connectionStatus,
  lastTickAt,
}: StatusBarProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [timeZone, setTimeZone] = useState('');
  /* eslint-disable react-hooks/set-state-in-effect -- one-time mount sync
     from the clock and the browser timezone (external systems); the
     initial render shows a placeholder. */
  useEffect(() => {
    setNow(new Date());
    setTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local',
    );
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const status = STATUS_META[connectionStatus];
  const lastTickText =
    lastTickAt !== null ? formatHMS(new Date(lastTickAt), false) : '—';

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-tv-border bg-tv-workspace px-2 text-[11px] text-tv-muted">
      <span className="min-w-0 shrink truncate" data-testid="status-symbol">
        {symbol} · Binance · {INTERVAL_LABELS[interval]}
      </span>
      <span className="hidden h-3 w-px shrink-0 bg-tv-border md:block" aria-hidden="true" />
      <span className="hidden shrink-0 font-mono tabular-nums md:block" data-testid="status-clock">
        {timeZone && timeZone !== 'UTC' ? `${timeZone} ` : ''}
        {now ? formatHMS(now, false) : '--:--:--'}
        {timeZone && timeZone !== 'UTC' && (
          <span className="hidden lg:inline">
            {' '}· UTC {now ? formatHMS(now, true) : '--:--:--'}
          </span>
        )}
        {timeZone === 'UTC' && <span> UTC</span>}
      </span>
      <span
        className="ml-auto flex shrink-0 items-center gap-1.5"
        data-testid="status-connection"
      >
        <span>Binance WS</span>
        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
        <span>{status.text}</span>
        <span className="hidden font-mono tabular-nums sm:inline">最後 tick {lastTickText}</span>
      </span>
    </div>
  );
}
