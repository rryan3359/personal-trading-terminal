/**
 * Shared price formatting (TradingView-style: fewer decimals on big
 * prices, more on small ones).
 */

export function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.1) return price.toFixed(4);
  return price.toFixed(5);
}

/**
 * Countdown to a candle close, TradingView-style: mm:ss under an hour,
 * hh:mm:ss up to a day, "Xd hh:mm:ss" beyond that (weekly / monthly
 * candles). `ms` is the remaining time, always >= 0 at the call site.
 */
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
