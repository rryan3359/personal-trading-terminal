'use client';

/**
 * ChartLegend.tsx — top-left legend (OHLC + indicator values + candle
 * countdown), moved verbatim from components/Chart.tsx in MASTER TASK
 * Phase 3 Step 1 (origin: Phase 1 step 2b). It owns the hover state:
 * the crosshair throttle publishes to it through `subscribeHover`, so
 * a hover update re-renders only this small subtree — never the whole
 * Chart. It re-renders only when its props change (symbol / interval /
 * indicators / lastKline / loadError) or the hover target changes.
 *
 * NOTE: CandleCountdown moved here from components/Chart.tsx in
 * Phase 3 Step 2 (pre-step, breaking the Chart <-> ChartLegend
 * circular import); Step 8 moves it to its own file.
 */
import { memo, useEffect, useState } from 'react';
import type { Chart, KLineData } from 'klinecharts';
import type { Interval } from '@/lib/types';
import { INTERVAL_LABELS } from '@/lib/types';
import { INTERVAL_MS } from '@/lib/chart-config';
import { formatCountdown, formatPrice } from '@/lib/format';
import type { HoverTarget } from '@/lib/chart-crosshair';

interface CandleCountdownProps {
  /** Close time of the last candle (ms), or null when no data. */
  lastCloseMs: number | null;
  /** Open time of the last candle (ms), or null when no data. */
  candleOpenMs: number | null;
}

/**
 * Candle-close countdown (Phase 1 step 2c). Owns its own 1-second
 * tick in local state: the tick re-renders only this tiny span, never
 * Chart or the legend. The countdown is always about the LAST candle
 * closing, never the hovered one.
 */
export const CandleCountdown = memo(function CandleCountdown({
  lastCloseMs,
  candleOpenMs,
}: CandleCountdownProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const countdownRemainingMs =
    lastCloseMs !== null ? lastCloseMs - nowMs : null;
  // Stale when the close already passed (socket down, no live tick) or
  // the clock sits before the candle opened: show '—', never a bogus time.
  const countdownText =
    countdownRemainingMs !== null &&
    lastCloseMs !== null &&
    candleOpenMs !== null &&
    countdownRemainingMs > 0 &&
    countdownRemainingMs <= lastCloseMs - candleOpenMs
      ? formatCountdown(countdownRemainingMs)
      : '—';
  return (
    <span
      className="ml-2 font-normal tabular-nums text-[#ffa726]"
      data-testid="candle-countdown"
    >
      收線 {countdownText}
    </span>
  );
});

interface ChartLegendProps {
  symbol: string;
  interval: Interval;
  /** Indicator names currently enabled, e.g. ["MA", "VOL"]. */
  indicators: string[];
  /** Last loaded / live candle (legend fallback when not hovering). */
  lastKline: KLineData | null;
  loadError: string | null;
  /** Stable accessor for the chart instance (reads Chart's own ref
   * inside the callback, never a ref read during Legend's render). */
  getChart: () => Chart | null;
  subscribeHover: (fn: (t: HoverTarget) => void) => () => void;
  /** Candle up/down colours (follow the appearance settings). */
  upColor?: string;
  downColor?: string;
  /** Muted label colour (axis text colour). */
  labelColor?: string;
}

/**
 * Top-left legend (OHLC + indicator values + candle countdown),
 * extracted from Chart in Phase 1 step 2b as an independent memoized
 * component. It owns the hover state: the crosshair throttle publishes
 * to it through `subscribeHover`, so a hover update re-renders only
 * this small subtree — never the whole Chart. It re-renders only when
 * its props change (symbol / interval / indicators / lastKline /
 * loadError) or the hover target changes.
 */
const ChartLegend = memo(function ChartLegend({
  symbol,
  interval,
  indicators,
  lastKline,
  loadError,
  getChart,
  subscribeHover,
  upColor = '#26a69a',
  downColor = '#ef5350',
  labelColor = '#787b86',
}: ChartLegendProps) {
  // Hover starts empty: no crosshair event can precede this mount,
  // and symbol switches clear it through the subscription below.
  const [hover, setHover] = useState<HoverTarget>({
    kline: null,
    index: null,
  });
  useEffect(() => subscribeHover(setHover), [subscribeHover]);

  // Legend candle: the hovered candle while the crosshair is on the
  // chart, otherwise the last candle. Its change is vs its own open.
  const legendKline = hover.kline ?? lastKline;
  const legendChangePct =
    legendKline !== null && legendKline.open !== 0
      ? ((legendKline.close - legendKline.open) / legendKline.open) * 100
      : 0;

  // ---- candle countdown (TradingView-style) -------------------------
  // Always for the LAST candle, not the hovered one: the countdown is
  // about the live bar closing. Close of the candle's interval: 1M is
  // the 1st of next month UTC (INTERVAL_MS['1M'] is only a 30-day
  // approximation); every other interval is open + its fixed span.
  // The ticking text itself lives in CandleCountdown (step 2c), so the
  // 1-second tick never re-renders this legend or Chart.
  const lastCloseMs =
    lastKline !== null
      ? interval === '1M'
        ? Date.UTC(
            new Date(lastKline.timestamp).getUTCFullYear(),
            new Date(lastKline.timestamp).getUTCMonth() + 1,
            1,
          )
        : lastKline.timestamp + (INTERVAL_MS[interval] ?? 0)
      : null;

  // ---- legend indicator values ---------------------------------------
  // Read straight from klinecharts' own computed results (never
  // re-computed here, so the numbers always match the drawn lines).
  // result[i] holds the indicator's values for dataList[i]; each
  // figure is one line keyed into that row. Line colours come from
  // the theme (styles.indicator.lines[i], verified at runtime); the
  // volume bar takes the candle's up/down colour, like the drawn bar.
  const legendChart = getChart();
  const legendIndex =
    hover.index ??
    (legendChart ? legendChart.getDataList().length - 1 : -1);
  const legendIndicators: Array<{
    name: string;
    values: Array<{ label: string; text: string; color: string }>;
  }> = (() => {
    const chart = legendChart;
    if (!chart || legendIndex < 0) return [];
    const list = chart.getDataList();
    if (legendIndex >= list.length) return [];
    const lineColors = chart.getStyles().indicator?.lines ?? [];
    const rows: Array<{
      name: string;
      values: Array<{ label: string; text: string; color: string }>;
    }> = [];
    for (const ind of chart.getIndicators()) {
      if (!indicators.includes(ind.name)) continue;
      const row = ind.result?.[legendIndex] as
        | Record<string, unknown>
        | undefined;
      if (!row) continue;
      const values: Array<{ label: string; text: string; color: string }> =
        [];
      for (let fi = 0; fi < ind.figures.length; fi += 1) {
        const fig = ind.figures[fi];
        const v = row[fig.key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        let text: string;
        if (ind.shouldFormatBigNumber) {
          // klinecharts' formatBigNumber only compacts >= 1000 (1.23K);
          // below that it returns the raw float, so format small
          // volumes to 2 decimals ourselves.
          text =
            Math.abs(v) >= 1000
              ? chart.getFormatter().formatBigNumber(v)
              : v.toFixed(2);
        } else if (ind.series === 'price') {
          text = formatPrice(v);
        } else {
          text = v.toFixed(2);
        }
        const color =
          fig.type === 'bar'
            ? legendChangePct >= 0
              ? upColor
              : downColor
            : (lineColors[fi]?.color ?? '#b2b5be');
        values.push({
          label: (fig.title ?? fig.key).replace(/:\s*$/, ''),
          text,
          color,
        });
      }
      if (values.length > 0) {
        rows.push({ name: ind.shortName || ind.name, values });
      }
    }
    return rows;
  })();

  if (legendKline === null || loadError !== null) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-14 z-10 leading-relaxed md:top-2">
      <div className="text-xs font-semibold text-white">
        {symbol} · {INTERVAL_LABELS[interval]} · Binance
        <CandleCountdown
          lastCloseMs={lastCloseMs}
          candleOpenMs={lastKline?.timestamp ?? null}
        />
      </div>
      <div className="text-[11px] text-[#b2b5be]">
        開 {formatPrice(legendKline.open)} 高 {formatPrice(legendKline.high)}{' '}
        低 {formatPrice(legendKline.low)} 收{' '}
        <span
          style={{ color: legendChangePct >= 0 ? upColor : downColor }}
        >
          {formatPrice(legendKline.close)}{' '}
          {legendChangePct >= 0 ? '+' : ''}
          {legendChangePct.toFixed(2)}%
        </span>
      </div>
      {legendIndicators.map((row) => (
        <div
          key={row.name}
          // Mobile: hide the VOL row — it collides with the canvas
          // volume labels, and the volume pane below already shows
          // the VOL values. Desktop keeps it.
          className={`text-[11px]${row.name === 'VOL' ? ' hidden md:block' : ''}`}
          data-testid={`legend-indicator-${row.name}`}
        >
          <span style={{ color: labelColor }}>{row.name} </span>
          {row.values.map((v) => (
            <span
              key={v.label}
              className="tabular-nums"
              style={{ color: v.color }}
            >
              {v.label} {v.text}{' '}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
});

export default ChartLegend;
