/**
 * Binance symbol universe for the watchlist search (Phase 1: Binance only).
 *
 * The list comes from GET /api/symbols (the server proxies Binance
 * exchangeInfo and caches it for an hour). The client keeps one in-flight
 * request and one cached copy per page load, so the search box, the
 * watchlist and the page sanitizer all share a single fetch.
 */

export interface SymbolInfo {
  /** Full pair, e.g. "BTCUSDT". */
  symbol: string;
  /** Base asset, e.g. "BTC". */
  baseAsset: string;
  /** Quote asset, e.g. "USDT". */
  quoteAsset: string;
}

export interface SymbolsResponse {
  symbols: SymbolInfo[];
}

let cachedList: SymbolInfo[] | null = null;
let inflight: Promise<SymbolInfo[]> | null = null;

/**
 * Fetch the Binance spot symbol list once per page load.
 * Returns [] on failure — callers fall back to format-only validation
 * instead of blocking the user when the list is unavailable.
 */
export function fetchSymbolList(): Promise<SymbolInfo[]> {
  if (cachedList !== null) return Promise.resolve(cachedList);
  if (inflight !== null) return inflight;
  inflight = fetch('/api/symbols')
    .then(async (res) => {
      if (!res.ok) throw new Error(`symbols API ${res.status}`);
      const json = (await res.json()) as SymbolsResponse;
      const list = Array.isArray(json.symbols) ? json.symbols : [];
      cachedList = list;
      return list;
    })
    .catch(() => [] as SymbolInfo[])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const QUOTE_PRIORITY: Record<string, number> = {
  USDT: 0,
  USDC: 1,
  FDUSD: 2,
  TUSD: 3,
  BTC: 4,
  ETH: 5,
  BNB: 6,
};

/**
 * Rank matches for a typed query: exact symbol / base asset first, then
 * starts-with, then contains. USDT pairs first within a rank.
 */
export function searchSymbols(
  list: SymbolInfo[],
  query: string,
  limit = 8,
): SymbolInfo[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const scored: Array<{ info: SymbolInfo; score: number }> = [];
  for (const info of list) {
    let score = -1;
    if (info.symbol === q) score = 0;
    else if (info.baseAsset === q) score = 1;
    else if (info.symbol.startsWith(q)) score = 2;
    else if (info.baseAsset.startsWith(q)) score = 3;
    else if (info.symbol.includes(q)) score = 4;
    else if (info.baseAsset.includes(q)) score = 5;
    if (score < 0) continue;
    scored.push({ info, score });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const qa = QUOTE_PRIORITY[a.info.quoteAsset] ?? 99;
    const qb = QUOTE_PRIORITY[b.info.quoteAsset] ?? 99;
    if (qa !== qb) return qa - qb;
    return a.info.symbol.localeCompare(b.info.symbol);
  });
  return scored.slice(0, limit).map((s) => s.info);
}

export function isKnownSymbol(list: SymbolInfo[], symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  return list.some((info) => info.symbol === s);
}
