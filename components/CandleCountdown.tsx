'use client';

/**
 * components/CandleCountdown.tsx — candle-close countdown (Phase 1
 * step 2c, moved here from components/ChartLegend.tsx in MASTER TASK
 * Phase 3 Step 8; it lived in ChartLegend since Step 2, where it
 * moved from Chart.tsx to break the Chart <-> ChartLegend circular
 * import). Props and the internal 1-second tick are unchanged.
 */
import { memo, useEffect, useState } from 'react';
import { formatCountdown } from '@/lib/format';

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
