/**
 * klinecharts dark theme + the custom rectangle overlay.
 *
 * CLIENT-ONLY module: importing klinecharts touches `window` at import
 * time, so this file must only be imported from client-only code
 * (Chart.tsx, loaded with ssr: false). Pure constants live in
 * lib/chart-config.ts instead.
 *
 * Verified against klinecharts 10.1.1 (installed):
 * - Built-in indicators: MA, EMA, SMA, RSI, MACD, BOLL, VOL, …
 * - Built-in overlays: straightLine, segment, rayLine,
 *   horizontalStraightLine, horizontalRayLine, verticalStraightLine,
 *   parallelStraightLine, fibonacciLine, … — but NO rectangle.
 * - The built-in fibonacciLine hardcodes levels [1, 0.786, 0.618, 0.5,
 *   0.382, 0.236, 0] and draws every level with one shared line style,
 *   so per-level colours need the custom `fibonacciRetracement` below.
 * - Figures available for custom overlays include "rect" with attrs
 *   { x, y, width, height } and styles { style, color, borderSize,
 *   borderColor, borderStyle, borderRadius, borderDashedValue }.
 *
 * Custom overlays registered here (two points unless noted):
 *   rectangle            -> opposite corners, styles read from the overlay
 *   fibonacciRetracement -> per-level colours, levels via extendData.levels
 *   measure              -> two points, stats text, never persisted
 */

import { registerOverlay, type DeepPartial, type Styles } from 'klinecharts';

export const DARK_STYLES: DeepPartial<Styles> = {
  grid: {
    show: true,
    horizontal: { color: '#1e222d' },
    vertical: { color: '#1e222d' },
  },
  candle: {
    bar: {
      upColor: '#26a69a',
      downColor: '#ef5350',
      noChangeColor: '#888888',
    },
    priceMark: {
      last: {
        upColor: '#26a69a',
        downColor: '#ef5350',
        noChangeColor: '#888888',
      },
    },
  },
  xAxis: {
    axisLine: { color: '#2a2e39' },
    tickLine: { color: '#2a2e39' },
    tickText: { color: '#787b86' },
  },
  yAxis: {
    axisLine: { color: '#2a2e39' },
    tickLine: { color: '#2a2e39' },
    tickText: { color: '#787b86' },
  },
  crosshair: {
    show: true,
    horizontal: { line: { color: '#758696' } },
    vertical: { line: { color: '#758696' } },
  },
  overlay: {
    point: {
      color: '#2962ff',
      borderColor: '#ffffff',
      activeColor: '#2962ff',
      activeBorderColor: '#ffffff',
    },
    line: { color: '#2962ff' },
    rect: {
      style: 'stroke_fill',
      color: 'rgba(41, 98, 255, 0.08)',
      borderColor: '#2962ff',
      borderSize: 1,
    },
  },
  separator: {
    color: '#2a2e39',
  },
};

/** Hex colour (#rrggbb) -> rgba() with the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} 分鐘`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    const mins = totalMinutes % 60;
    return mins === 0 ? `${hours} 小時` : `${hours} 小時 ${mins} 分鐘`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days} 天` : `${days} 天 ${remHours} 小時`;
}

let rectangleRegistered = false;

/**
 * Register the custom "rectangle" overlay once per page load.
 * Two points (opposite corners) -> one filled + stroked rect figure.
 * Colours come from the overlay itself (styles.line = border, fill =
 * border colour at extendData.fillOpacity), so the edit bar can change
 * them per overlay. Corner control points are the library's default
 * point figures (needDefaultPointFigure) — draggable while selected.
 */
export function registerRectangleOverlay(): void {
  if (rectangleRegistered) return;
  rectangleRegistered = true;

  registerOverlay({
    name: 'rectangle',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      if (width < 1 || height < 1) return [];
      const line = overlay.styles?.line;
      const border =
        line?.color ?? overlay.styles?.rect?.borderColor ?? '#2962ff';
      const size = line?.size ?? overlay.styles?.rect?.borderSize ?? 1;
      const borderStyle = line?.style ?? 'solid';
      const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
      const fillOpacity =
        typeof ext.fillOpacity === 'number' ? ext.fillOpacity : 0.08;
      return {
        type: 'rect',
        attrs: { x, y, width, height },
        styles: {
          style: 'stroke_fill',
          color: hexToRgba(border, fillOpacity),
          borderColor: border,
          borderSize: size,
          borderStyle,
        },
      };
    },
  });
}

/** Default Fibonacci retracement levels (0–1). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** One colour per level, in FIB_LEVELS order. */
const FIB_LEVEL_COLORS = [
  '#787b86',
  '#26a69a',
  '#2962ff',
  '#ff9800',
  '#ab47bc',
  '#ef5350',
  '#787b86',
];

let fibonacciRegistered = false;

/**
 * Register the custom "fibonacciRetracement" overlay once per page load.
 * Same levels and "price (xx.x%)" labels as the built-in fibonacciLine,
 * but each level is its own line figure with its own colour. Levels come
 * from extendData.levels when present, otherwise FIB_LEVELS.
 */
export function registerFibonacciRetracementOverlay(): void {
  if (fibonacciRegistered) return;
  fibonacciRegistered = true;

  registerOverlay({
    name: 'fibonacciRetracement',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ chart, coordinates, bounding, overlay }) => {
      const points = overlay.points;
      if (coordinates.length < 2) return [];
      const p0 = points[0];
      const p1 = points[1];
      if (p0?.value === undefined || p1?.value === undefined) return [];
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
      const levels =
        Array.isArray(ext.levels) &&
        (ext.levels as unknown[]).every((v) => typeof v === 'number')
          ? (ext.levels as number[])
          : FIB_LEVELS;
      const lineSize = overlay.styles?.line?.size ?? 1;
      const lineStyle = overlay.styles?.line?.style ?? 'solid';
      const yDif = coordinates[0].y - coordinates[1].y;
      const v0 = p0.value;
      const v1 = p1.value;
      const valueDif = v0 - v1;
      const figures: Array<Record<string, unknown>> = [];
      levels.forEach((percent, i) => {
        const y = coordinates[1].y + yDif * percent;
        const value = v1 + valueDif * percent;
        const color = FIB_LEVEL_COLORS[i % FIB_LEVEL_COLORS.length];
        figures.push({
          type: 'line',
          attrs: [
            {
              coordinates: [
                { x: 0, y },
                { x: bounding.width, y },
              ],
            },
          ],
          styles: { color, size: lineSize, style: lineStyle },
        });
        figures.push({
          type: 'text',
          isCheckEvent: false,
          attrs: [
            {
              x: 0,
              y,
              text: `${value.toFixed(precision)} (${(percent * 100).toFixed(1)}%)`,
              baseline: 'bottom',
            },
          ],
          styles: { color },
        });
      });
      return figures as never;
    },
  });
}

let measureRegistered = false;

/**
 * Register the custom "measure" overlay once per page load.
 * Two points -> one semi-transparent rect + a stats text block:
 * price difference, percentage, candle count and time span.
 * Rising is green, falling is red. Never persisted (Chart.tsx filters
 * it out of saves); Esc or clicking empty space removes it.
 * Candle count uses extendData.intervalMs (ms per candle).
 */
export function registerMeasureOverlay(): void {
  if (measureRegistered) return;
  measureRegistered = true;

  registerOverlay({
    name: 'measure',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ chart, coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const points = overlay.points;
      const p0 = points[0];
      const p1 = points[1];
      if (
        p0?.value === undefined ||
        p1?.value === undefined ||
        p0?.timestamp === undefined ||
        p1?.timestamp === undefined
      ) {
        return [];
      }
      const up = p1.value >= p0.value;
      const color = up ? '#26a69a' : '#ef5350';
      const [a, b] = coordinates;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      const diff = p1.value - p0.value;
      const pct = p0.value !== 0 ? (diff / p0.value) * 100 : 0;
      const sign = diff >= 0 ? '+' : '';
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
      const intervalMs =
        typeof ext.intervalMs === 'number' ? ext.intervalMs : 0;
      const bars =
        intervalMs > 0
          ? Math.round(
              Math.abs(p1.timestamp - p0.timestamp) / intervalMs,
            ) + 1
          : 0;
      const span = formatDuration(Math.abs(p1.timestamp - p0.timestamp));
      const textLines =
        bars > 0
          ? [
              `${sign}${diff.toFixed(precision)} (${sign}${pct.toFixed(2)}%)`,
              `${bars} 根 K 線 · ${span}`,
            ]
          : [`${sign}${diff.toFixed(precision)} (${sign}${pct.toFixed(2)}%)`, span];
      return [
        {
          type: 'rect',
          attrs: { x, y, width, height },
          styles: {
            style: 'stroke_fill',
            color: hexToRgba(color, 0.12),
            borderColor: color,
            borderSize: 1,
          },
        },
        {
          type: 'text',
          isCheckEvent: false,
          attrs: textLines.map((text, i) => ({
            x: x + 4,
            y: y + 4 + i * 14,
            text,
            baseline: 'top',
          })),
          styles: { color },
        },
      ] as never;
    },
  });
}
