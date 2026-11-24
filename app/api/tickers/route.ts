/**
 * GET /api/tickers
 *
 * Query params:
 *   symbols — comma-separated list, e.g. "BTCUSDT,ETHUSDT" (max 50)
 *
 * Returns: { tickers: [{ symbol, lastPrice, priceChangePercent }] }
 * (Binance 24h ticker, same public host as /api/klines, no API key.)
 * Errors: 400 on bad params, 502 when the upstream source fails.
 */

import { NextRequest, NextResponse } from 'next/server';
import { BINANCE_REST_BASE } from '@/lib/datasources/binance';

// No `dynamic` export: with `cacheComponents` enabled (next.config.ts),
// a handler that reads request search params runs at request time by
// default. Ticker prices must never be statically cached.

const MAX_SYMBOLS = 50;

export interface Ticker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const raw = (params.get('symbols') ?? '').trim().toUpperCase();
  if (!raw) {
    return NextResponse.json({ error: 'missing param: symbols' }, { status: 400 });
  }
  const symbols = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0 || symbols.length > MAX_SYMBOLS) {
    return NextResponse.json(
      { error: `invalid symbols: 1..${MAX_SYMBOLS} symbols required` },
      { status: 400 },
    );
  }
  for (const s of symbols) {
    if (!/^[A-Z0-9]{2,20}$/.test(s)) {
      return NextResponse.json({ error: `invalid symbol: ${s}` }, { status: 400 });
    }
  }

  const url = new URL(`${BINANCE_REST_BASE}/api/v3/ticker/24hr`);
  url.searchParams.set('symbols', JSON.stringify(symbols));

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Binance ticker request failed (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const data: unknown = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Binance ticker response was not an array');
    }
    const tickers: Ticker[] = [];
    for (const row of data) {
      const r = row as Record<string, unknown>;
      if (typeof r.symbol !== 'string') continue;
      const lastPrice = Number(r.lastPrice);
      const priceChangePercent = Number(r.priceChangePercent);
      if (!Number.isFinite(lastPrice) || !Number.isFinite(priceChangePercent)) {
        continue;
      }
      tickers.push({ symbol: r.symbol, lastPrice, priceChangePercent });
    }
    return NextResponse.json({ tickers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream request failed';
    return NextResponse.json(
      { error: 'upstream error', message: message.slice(0, 300) },
      { status: 502 },
    );
  }
}
