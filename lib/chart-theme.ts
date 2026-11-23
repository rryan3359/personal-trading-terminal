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
 * - Built-in overlays: straightLine, horizontalStraightLine, rayLine,
 *   fibonacciLine, segment, priceLine, … — but NO rectangle.
 * - Figures available for custom overlays include "rect" with attrs
 *   { x, y, width, height } and styles { style, color, borderSize,
 *   borderColor, borderStyle, borderRadius, borderDashedValue }.
 *
 * So the rectangle tool is registered here as a custom overlay named
 * "rectangle" (two points: opposite corners). The other four drawing
 * tools map 1:1 to built-ins:
 *   trend line      -> straightLine
 *   horizontal line -> horizontalStraightLine
 *   ray             -> rayLine
 *   fibonacci       -> fibonacciLine
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

let rectangleRegistered = false;

/**
 * Register the custom "rectangle" overlay once per page load.
 * Two points (opposite corners) -> one filled + stroked rect figure.
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
    mode: 'weak_magnet',
    createPointFigures: ({ coordinates }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      if (width < 1 || height < 1) return [];
      return {
        type: 'rect',
        attrs: { x, y, width, height },
        styles: {
          style: 'stroke_fill',
          color: 'rgba(41, 98, 255, 0.08)',
          borderColor: '#2962ff',
          borderSize: 1,
        },
      };
    },
  });
}
