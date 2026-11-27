/**
 * crypto-icons.ts — real coin logos for the watchlist / mobile pickers.
 *
 * Two sources, tried in order. First the public cryptocurrency-icons
 * CDN (jsDelivr mirror of atomiclabs/cryptocurrency-icons): no
 * dependency, no API key, no hard-coded coin list — the base asset is
 * derived from the symbol the same way Watchlist already splits quote
 * assets, so any coin Ryan adds later gets its logo automatically.
 * That library is from ~2021, so newer coins 404 there; the second
 * source is CoinGecko's image CDN, an explicit override map for the
 * coins the first library lacks (each URL curl-verified 200 on
 * 2026-11-28). A coin in neither source simply falls back to the
 * letter circle in the CryptoIcon component.
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

/**
 * Second source for coins the first library does not have. Keys are
 * lowercase base assets; every URL below was curl-verified 200 on
 * 2026-11-28. RENDER is listed as RENDER on Binance (renamed from
 * RNDR); `rndr` is kept as an alias to the same image. FET has been
 * renamed ASI — the image is the ASI logo, which is correct.
 */
const COIN_ICON_OVERRIDES: Record<string, string> = {
  hype: 'https://coin-images.coingecko.com/coins/images/50882/large/hyperliquid.jpg',
  sui: 'https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png',
  tao: 'https://coin-images.coingecko.com/coins/images/28452/large/ARUsPeNQ_400x400.jpeg',
  pepe: 'https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg',
  wif: 'https://coin-images.coingecko.com/coins/images/33566/large/dogwifhat.jpg',
  ondo: 'https://coin-images.coingecko.com/coins/images/26580/large/ONDO.png',
  near: 'https://coin-images.coingecko.com/coins/images/10365/large/near.jpg',
  apt: 'https://coin-images.coingecko.com/coins/images/26455/large/Aptos-Network-Profile-Picture_%281%29.png',
  arb: 'https://coin-images.coingecko.com/coins/images/16547/large/arb.jpg',
  op: 'https://coin-images.coingecko.com/coins/images/25244/large/Token.png',
  inj: 'https://coin-images.coingecko.com/coins/images/12882/large/Other_200x200.png',
  sei: 'https://coin-images.coingecko.com/coins/images/28205/large/SEI_2x.png',
  render: 'https://coin-images.coingecko.com/coins/images/11636/large/rndr.png',
  rndr: 'https://coin-images.coingecko.com/coins/images/11636/large/rndr.png',
  fet: 'https://coin-images.coingecko.com/coins/images/5681/large/ASI.png',
  kas: 'https://coin-images.coingecko.com/coins/images/25751/large/kaspa-icon-exchanges.png',
  hbar: 'https://coin-images.coingecko.com/coins/images/3688/large/hbar.png',
};

/**
 * Candidate icon URLs for a coin, in order: the cryptocurrency-icons
 * CDN first, then the CoinGecko override (if one exists). The
 * component tries each in turn and falls back to the letter only when
 * every candidate fails.
 */
export function cryptoIconCandidates(baseAsset: string): string[] {
  const list = [cryptoIconUrl(baseAsset)];
  const override = COIN_ICON_OVERRIDES[baseAsset.toLowerCase()];
  if (override) list.push(override);
  return list;
}
