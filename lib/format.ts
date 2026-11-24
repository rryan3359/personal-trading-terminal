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
