/**
 * GET /api/klines
 *
 * Query params:
 *   source    — data source id, e.g. "binance" (Phase 1: only binance)
 *   symbol    — e.g. "BTCUSDT"
 *   interval  — one of 15m | 1h | 4h | 1d | 1w
 *   limit     — 1..1000, default 500
 *   startTime — optional, ms timestamp (inclusive lower bound, for newer bars)
 *   endTime   — optional, ms timestamp (inclusive upper bound, for history)
 *
 * Returns: { source, symbol, interval, klines: Kline[] }
 * Errors: 400 on bad params, 502 when the upstream source fails.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchKlines } from '@/lib/datasources';
import { isInterval, type DataSourceId, type Interval } from '@/lib/types';

// No `dynamic` export: with `cacheComponents` enabled (next.config.ts),
// a handler that reads request search params runs at request time by
// default. The klines endpoint must never be statically cached.

const SUPPORTED_SOURCES: DataSourceId[] = ['binance'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const source = (params.get('source') ?? '').toLowerCase();
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase();
  const interval = params.get('interval') ?? '';
  const limitRaw = params.get('limit');
  const startTimeRaw = params.get('startTime');
  const endTimeRaw = params.get('endTime');

  if (!source) {
    return NextResponse.json({ error: 'missing param: source' }, { status: 400 });
  }
  if (!SUPPORTED_SOURCES.includes(source as DataSourceId)) {
    return NextResponse.json(
      { error: `unsupported source: ${source}`, supported: SUPPORTED_SOURCES },
      { status: 400 },
    );
  }
  if (!symbol) {
    return NextResponse.json({ error: 'missing param: symbol' }, { status: 400 });
  }
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
    return NextResponse.json({ error: `invalid symbol: ${symbol}` }, { status: 400 });
  }
  if (!isInterval(interval)) {
    return NextResponse.json(
      { error: `invalid interval: ${interval}`, supported: ['15m', '1h', '4h', '1d', '1w'] },
      { status: 400 },
    );
  }

  let limit = 500;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return NextResponse.json(
        { error: `invalid limit: ${limitRaw} (must be an integer 1..1000)` },
        { status: 400 },
      );
    }
  }

  let startTime: number | undefined;
  if (startTimeRaw !== null) {
    startTime = Number(startTimeRaw);
    if (!Number.isFinite(startTime) || startTime < 0) {
      return NextResponse.json(
        { error: `invalid startTime: ${startTimeRaw}` },
        { status: 400 },
      );
    }
  }

  let endTime: number | undefined;
  if (endTimeRaw !== null) {
    endTime = Number(endTimeRaw);
    if (!Number.isFinite(endTime) || endTime < 0) {
      return NextResponse.json(
        { error: `invalid endTime: ${endTimeRaw}` },
        { status: 400 },
      );
    }
  }

  try {
    const klines = await fetchKlines({
      source: source as DataSourceId,
      symbol,
      interval: interval as Interval,
      limit,
      startTime,
      endTime,
    });
    return NextResponse.json({ source, symbol, interval, klines });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream request failed';
    return NextResponse.json(
      { error: 'upstream error', message: message.slice(0, 300) },
      { status: 502 },
    );
  }
}
