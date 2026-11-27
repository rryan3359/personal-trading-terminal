/**
 * crypto-icons.ts — real coin logos for the watchlist / mobile pickers.
 *
 * The icons come from the public cryptocurrency-icons CDN (jsDelivr mirror
 * of atomiclabs/cryptocurrency-icons). No dependency, no API key, no
 * hard-coded coin list: the base asset is derived from the symbol the
 * same way Watchlist already splits quote assets, so any coin Ryan adds
 * later gets its logo automatically. Coins the library does not have
 * (e.g. HYPE — verified 404 on 2026-11-28) simply 404, and the
 * CryptoIcon component falls back to the existing letter circle.
 */

/** Quote assets a Binance spot symbol can end in — mirrors the list in
 *  Watchlist.quoteFor (fallback when the symbol list has not loaded). */
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BTC', 'ETH', 'BNB'];

/** Base asset for a symbol: prefer SymbolInfo when available, else strip
 *  the quote suffix from the symbol itself. */
export function baseAssetOf(
  symbol: string,
  info?: { baseAsset?: string },
): string {
  if (info?.baseAsset) return info.baseAsset;
  for (const q of QUOTE_SUFFIXES) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      return symbol.slice(0, -q.length);
    }
  }
  return symbol;
}

/** Public CDN URL for a coin's coloured SVG icon. */
export function cryptoIconUrl(baseAsset: string): string {
  return `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/${baseAsset.toLowerCase()}.svg`;
}
