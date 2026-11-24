/**
 * GET /api/symbols
 *
 * Proxies Binance exchangeInfo and returns the compact list of TRADING
 * spot symbols the watchlist search validates against:
 *   { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }, ...] }
 *
 * Server-side cache (1h) so the list is fetched from Binance once, not
 * on every page load.
 * Errors: 502 when the upstream source fails.
 */

import { NextRequest, NextResponse } from 'next/server';
import { BINANCE_REST_BASE } from '@/lib/datasources/binance';
import type { SymbolInfo } from '@/lib/symbols';

// No `dynamic` export: with `cacheComponents` enabled (next.config.ts),
// a handler that reads request search params runs at request time by
// default (same as the klines route). `force-dynamic` is incompatible
// with cacheComponents and fails the build.

const CACHE_TTL_MS = 60 * 60 * 1000;

let cached: { at: number; symbols: SymbolInfo[] } | null = null;

interface ExchangeInfoSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed: boolean;
}

export async function GET(request: NextRequest) {
  // Reading search params keeps this handler dynamic under
  // cacheComponents; `refresh=1` bypasses the server-side cache.
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const now = Date.now();
  if (!refresh && cached && now - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ symbols: cached.symbols });
  }
  try {
    const res = await fetch(`${BINANCE_REST_BASE}/api/v3/exchangeInfo`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`Binance exchangeInfo request failed (${res.status})`);
    }
    const json = (await res.json()) as { symbols?: ExchangeInfoSymbol[] };
    const raw = Array.isArray(json.symbols) ? json.symbols : [];
    const symbols: SymbolInfo[] = [];
    for (const s of raw) {
      if (s.status !== 'TRADING' || s.isSpotTradingAllowed !== true) continue;
      if (
        typeof s.symbol !== 'string' ||
        typeof s.baseAsset !== 'string' ||
        typeof s.quoteAsset !== 'string'
      ) {
        continue;
      }
      symbols.push({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
      });
    }
    cached = { at: now, symbols };
    return NextResponse.json({ symbols });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'upstream request failed';
    return NextResponse.json(
      { error: 'upstream error', message: message.slice(0, 200) },
      { status: 502 },
    );
  }
}
