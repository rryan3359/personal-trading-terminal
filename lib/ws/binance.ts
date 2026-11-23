/**
 * Browser-side Binance WebSocket client for live kline updates.
 *
 * Connects directly from the browser to Binance's public stream
 * (wss://stream.binance.com:9443) — no backend involved, because Vercel
 * cannot hold long-lived connections. No API key is needed for public
 * market-data streams.
 *
 * Behaviour:
 * - Subscribes to `<symbol>@kline_<interval>` (lower-case symbol).
 * - Delivers each incoming candle as a unified Kline plus `isClosed`
 *   (true once the candle's interval has ended and it becomes history).
 * - Reconnects automatically with exponential backoff (1s → 30s cap)
 *   when the socket drops for any reason other than an explicit disconnect.
 * - Only ever holds one socket: connecting again first disconnects.
 */

import type { Interval, Kline } from '../types';

export const BINANCE_WS_BASE =
  process.env.NEXT_PUBLIC_BINANCE_WS_BASE ?? 'wss://stream.binance.com:9443';

export type BinanceSocketStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'closed';

export type LiveKlineCallback = (kline: Kline, isClosed: boolean) => void;
export type SocketStatusCallback = (
  status: BinanceSocketStatus,
  attempt: number,
) => void;

const MAX_BACKOFF_MS = 30_000;

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  // Small jitter so a fleet of clients does not reconnect in lockstep.
  return base + Math.floor(Math.random() * 500);
}

export class BinanceKlineSocket {
  private ws: WebSocket | null = null;
  private symbol = '';
  private interval: Interval = '15m';
  private onKline: LiveKlineCallback | null = null;
  private onStatus: SocketStatusCallback | null = null;
  private manualClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(
    symbol: string,
    interval: Interval,
    onKline: LiveKlineCallback,
    onStatus?: SocketStatusCallback,
  ): void {
    this.disconnect();
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
    this.onKline = onKline;
    this.onStatus = onStatus ?? null;
    this.manualClose = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null) {
      try {
        this.ws.close();
      } catch {
        // Socket already closed — ignore.
      }
      this.ws = null;
    }
    this.onStatus?.('closed', 0);
  }

  private openSocket(): void {
    const url = `${BINANCE_WS_BASE}/ws/${this.symbol}@kline_${this.interval}`;
    this.onStatus?.(
      this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting',
      this.reconnectAttempt,
    );

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (event: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return; // Ignore malformed frames.
      }
      const k = (data as { k?: Record<string, unknown> }).k;
      if (!k || typeof k !== 'object') return;

      const kline: Kline = {
        timestamp: Number(k.t),
        open: parseFloat(String(k.o)),
        high: parseFloat(String(k.h)),
        low: parseFloat(String(k.l)),
        close: parseFloat(String(k.c)),
        volume: parseFloat(String(k.v)),
      };
      if (Number.isFinite(kline.timestamp) && Number.isFinite(kline.close)) {
        this.onKline?.(kline, k.x === true);
      }
    };

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.onStatus?.('live', 0);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.manualClose) return;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows an error; the reconnect is scheduled there.
      try {
        ws.close();
      } catch {
        // Already closing — ignore.
      }
    };
  }

  private scheduleReconnect(): void {
    const delay = backoffMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.onStatus?.('reconnecting', this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualClose) this.openSocket();
    }, delay);
  }
}
