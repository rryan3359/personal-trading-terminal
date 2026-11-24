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
 *   textAnnotation       -> one point, text label from extendData.text,
 *                           never persisted; its label uses the "textNoHit"
 *                           figure (built-in text draw, never hit-tested)
 *                           so clicks pass through to the main line.
 */

import {
  registerFigure,
  registerOverlay,
  type DeepPartial,
  type Styles,
  type TextAttrs,
  type TextStyle,
} from 'klinecharts';

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
 * extendData options (Phase 2 dialog): rectBorder (default true),
 * rectFill (default true), rectMiddleLine (default false), text
 * (OverlayText-like, rendered as an in-box label).
 */
export function registerRectangleOverlay(): void {
  if (rectangleRegistered) return;
  rectangleRegistered = true;
  registerTextNoHitFigure();

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
      const showBorder = ext.rectBorder !== false;
      const showFill = ext.rectFill !== false;
      const showMiddleLine = ext.rectMiddleLine === true;
      const figures: Array<Record<string, unknown>> = [];
      if (showBorder || showFill) {
        figures.push({
          type: 'rect',
          attrs: { x, y, width, height },
          styles: {
            style:
              showBorder && showFill
                ? 'stroke_fill'
                : showBorder
                  ? 'stroke'
                  : 'fill',
            color: hexToRgba(border, fillOpacity),
            borderColor: border,
            borderSize: size,
            borderStyle,
          },
        });
      }
      if (showMiddleLine) {
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [
              { x, y: y + height / 2 },
              { x: x + width, y: y + height / 2 },
            ],
          },
          styles: { color: border, size: 1, style: borderStyle },
        });
      }
      const text = ext.text as OverlayTextLike | undefined;
      if (text && typeof text.content === 'string' && text.content.length > 0) {
        const tx =
          text.alignH === 'left'
            ? x + 6
            : text.alignH === 'right'
              ? x + width - 6
              : x + width / 2;
        const ty =
          text.alignV === 'top'
            ? y + 6
            : text.alignV === 'bottom'
              ? y + height - 6
              : y + height / 2;
        figures.push(...textFigures(text.content, tx, ty, text));
      }
      return figures as never;
    },
  });
}

/** Default Fibonacci retracement levels (0–1). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** One colour per level, in FIB_LEVELS order. */
export const FIB_LEVEL_COLORS = [
  '#787b86',
  '#26a69a',
  '#2962ff',
  '#ff9800',
  '#ab47bc',
  '#ef5350',
  '#787b86',
];

type OverlayTextLike = {
  content: string;
  color?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  alignV?: string;
  alignH?: string;
};

/**
 * Canvas font weight slot for a text style. klinecharts builds the font
 * as `${weight} ${size}px ${family}` with no italic slot, so italic is
 * expressed through the weight string itself ('italic' / 'italic bold'
 * are valid CSS font shorthands).
 */
function textWeightOf(t: OverlayTextLike): string {
  if (t.bold && t.italic) return 'italic bold';
  if (t.bold) return 'bold';
  if (t.italic) return 'italic';
  return 'normal';
}

/**
 * Text figures for one (possibly multi-line) label, anchored at (x, y).
 * alignH/alignV place the whole block relative to the anchor: top puts
 * the block's top at y, middle centers it on y, bottom puts its bottom
 * at y. Lines stack downward at 1.4x the font size.
 */
function textFigures(
  content: string,
  x: number,
  y: number,
  t: OverlayTextLike,
): Array<Record<string, unknown>> {
  const lines = content.split('\n');
  const size = typeof t.size === 'number' && t.size > 0 ? t.size : 12;
  const lh = Math.round(size * 1.4);
  const blockH = lines.length * lh;
  const topY =
    t.alignV === 'top'
      ? y
      : t.alignV === 'bottom'
        ? y - blockH
        : y - blockH / 2;
  const align =
    t.alignH === 'left' || t.alignH === 'right' ? t.alignH : 'center';
  const styles = {
    color: typeof t.color === 'string' ? t.color : '#d1d4dc',
    size,
    weight: textWeightOf(t),
  };
  return lines.map((line, i) => ({
    type: 'textNoHit',
    attrs: { x, y: topY + i * lh, text: line, align, baseline: 'top' },
    styles,
  }));
}

/**
 * "textNoHit": the built-in "text" figure, but never hit-testable.
 *
 * Why: v10.1.1's figure event system ignores `isCheckEvent: false`
 * (it only gates on `figure.ignoreEvent`, and even that does not stop
 * setClickOverlayInfo from selecting the overlay). A text annotation's
 * label sits on its main line's midpoint, so a hittable label steals
 * the main line's clicks: a single click deselects the main line and a
 * double-click never reaches the main line's onDoubleClick (verified
 * with a headless probe: click at the midpoint hid the floating bar,
 * click at 1/4 along the line kept it). checkEventOn: () => false
 * makes the label purely visual — clicks pass through to the drawing
 * underneath. draw is a faithful copy of the built-in text draw
 * (drawText / getTextRect / createFont / calcTextWidth in the
 * installed bundle); only the hit test differs.
 */
let textNoHitRegistered = false;

function textNoHitFont(
  size: number,
  weight: string | number,
  family?: string,
): string {
  return `${weight ?? 'normal'} ${size ?? 12}px ${family ?? 'Helvetica Neue'}`;
}

let textNoHitMeasureCtx: CanvasRenderingContext2D | null = null;

function textNoHitWidth(
  text: string,
  size: number,
  weight: string | number,
  family?: string,
): number {
  if (textNoHitMeasureCtx === null) {
    const canvas = document.createElement('canvas');
    textNoHitMeasureCtx = canvas.getContext('2d');
  }
  if (textNoHitMeasureCtx === null) return text.length * size * 0.6;
  textNoHitMeasureCtx.font = textNoHitFont(size, weight, family);
  return Math.round(textNoHitMeasureCtx.measureText(text).width);
}

function textNoHitRect(
  attrs: TextAttrs,
  styles: Partial<TextStyle>,
): { x: number; y: number; width: number; height: number } {
  const size = styles.size ?? 12;
  const weight = styles.weight ?? 'normal';
  const paddingLeft = styles.paddingLeft ?? 0;
  const paddingTop = styles.paddingTop ?? 0;
  const paddingRight = styles.paddingRight ?? 0;
  const paddingBottom = styles.paddingBottom ?? 0;
  const width =
    attrs.width ??
    paddingLeft +
      textNoHitWidth(attrs.text, size, weight, styles.family) +
      paddingRight;
  const height = attrs.height ?? paddingTop + size + paddingBottom;
  let startX = attrs.x;
  if (attrs.align === 'right' || attrs.align === 'end') {
    startX = attrs.x - width;
  } else if (attrs.align !== 'left' && attrs.align !== 'start') {
    startX = attrs.x - width / 2;
  }
  let startY = attrs.y;
  if (
    attrs.baseline === 'bottom' ||
    attrs.baseline === 'ideographic' ||
    attrs.baseline === 'alphabetic'
  ) {
    startY = attrs.y - height;
  } else if (attrs.baseline !== 'top' && attrs.baseline !== 'hanging') {
    startY = attrs.y - height / 2;
  }
  return { x: startX, y: startY, width, height };
}

export function registerTextNoHitFigure(): void {
  if (textNoHitRegistered) return;
  textNoHitRegistered = true;
  registerFigure<TextAttrs | TextAttrs[], Partial<TextStyle>>({
    name: 'textNoHit',
    checkEventOn: () => false,
    draw: (ctx, attrs, styles) => {
      const texts = Array.isArray(attrs) ? attrs : [attrs];
      const size = styles.size ?? 12;
      const weight = styles.weight ?? 'normal';
      const color = styles.color ?? 'currentColor';
      const paddingLeft = styles.paddingLeft ?? 0;
      const paddingTop = styles.paddingTop ?? 0;
      const paddingRight = styles.paddingRight ?? 0;
      const rects = texts.map((t) => textNoHitRect(t, styles));
      if (styles.backgroundColor !== undefined) {
        ctx.fillStyle = styles.backgroundColor;
        rects.forEach((r) => ctx.fillRect(r.x, r.y, r.width, r.height));
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = textNoHitFont(size, weight, styles.family);
      ctx.fillStyle = color;
      texts.forEach((text, i) => {
        const rect = rects[i];
        ctx.fillText(
          text.text,
          rect.x + paddingLeft,
          rect.y + paddingTop,
          rect.width - paddingLeft - paddingRight,
        );
      });
    },
  });
}

let textAnnotationRegistered = false;

/**
 * Register the custom "textAnnotation" overlay once per page load.
 * One point (the anchor) + a text label from extendData.text
 * ({content, color, size, bold, italic, alignV, alignH}). The label is
 * passive: no control points, no axis figures, and its text figure
 * ignores pointer events, so it can never be grabbed or selected.
 * The built-in simpleAnnotation cannot do this — it hardcodes a 50px
 * arrow + centered text above the point with no size/bold/italic/
 * alignment control — so the dialog's text rendering uses this custom
 * overlay instead, with the same lifecycle (same groupId as its main
 * line, rebuilt from the main line's text, never persisted on its own).
 */
export function registerTextAnnotationOverlay(): void {
  if (textAnnotationRegistered) return;
  textAnnotationRegistered = true;
  registerTextNoHitFigure();

  registerOverlay({
    name: 'textAnnotation',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 1) return [];
      const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
      const text = ext.text as OverlayTextLike | undefined;
      if (!text || typeof text.content !== 'string' || text.content.length === 0)
        return [];
      const anchor = coordinates[0];
      return textFigures(text.content, anchor.x, anchor.y, text) as never;
    },
  });
}

let fibonacciRegistered = false;

/**
 * Register the custom "fibonacciRetracement" overlay once per page load.
 * Same levels and "price (xx.x%)" labels as the built-in fibonacciLine,
 * but each level is its own line figure with its own colour. Levels come
 * from extendData.levels when present, otherwise FIB_LEVELS.
 * Phase 2 dialog options (all in extendData, defaults preserve the old
 * look): levelColors (per-level colours), fibExtend ('left' | 'right' |
 * 'both', default 'both' = full width), fibBackground (fill the 0–100%
 * range, default false), showTrendline (diagonal p0 -> p1, default
 * false), fibLevelText (show the level labels, default true).
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
      const levelColors = Array.isArray(ext.levelColors)
        ? (ext.levelColors as unknown[])
        : [];
      const lineSize = overlay.styles?.line?.size ?? 1;
      const lineStyle = overlay.styles?.line?.style ?? 'solid';
      const lineColor = overlay.styles?.line?.color ?? '#2962ff';
      const yDif = coordinates[0].y - coordinates[1].y;
      const v0 = p0.value;
      const v1 = p1.value;
      const valueDif = v0 - v1;
      const minX = Math.min(coordinates[0].x, coordinates[1].x);
      const maxX = Math.max(coordinates[0].x, coordinates[1].x);
      const fibExtend = ext.fibExtend === 'left' ? 'left' : ext.fibExtend === 'right' ? 'right' : 'both';
      const xStart = fibExtend === 'right' ? minX : 0;
      const xEnd = fibExtend === 'left' ? maxX : bounding.width;
      const figures: Array<Record<string, unknown>> = [];
      if (ext.fibBackground === true) {
        const fillOpacity =
          typeof ext.fillOpacity === 'number' ? ext.fillOpacity : 0.08;
        figures.push({
          type: 'rect',
          attrs: {
            x: xStart,
            y: Math.min(coordinates[0].y, coordinates[1].y),
            width: Math.max(1, xEnd - xStart),
            height: Math.abs(coordinates[0].y - coordinates[1].y),
          },
          styles: {
            style: 'fill',
            color: hexToRgba(lineColor, fillOpacity),
          },
        });
      }
      if (ext.showTrendline === true) {
        figures.push({
          type: 'line',
          attrs: [{ coordinates: [coordinates[0], coordinates[1]] }],
          styles: { color: lineColor, size: lineSize, style: lineStyle },
        });
      }
      const showLevelText = ext.fibLevelText !== false;
      levels.forEach((percent, i) => {
        const y = coordinates[1].y + yDif * percent;
        const value = v1 + valueDif * percent;
        const color =
          typeof levelColors[i] === 'string'
            ? (levelColors[i] as string)
            : FIB_LEVEL_COLORS[i % FIB_LEVEL_COLORS.length];
        figures.push({
          type: 'line',
          attrs: [
            {
              coordinates: [
                { x: xStart, y },
                { x: xEnd, y },
              ],
            },
          ],
          styles: { color, size: lineSize, style: lineStyle },
        });
        if (showLevelText) {
          figures.push({
            type: 'text',
            isCheckEvent: false,
            attrs: [
              {
                x: xStart,
                y,
                text: `${value.toFixed(precision)} (${(percent * 100).toFixed(1)}%)`,
                baseline: 'bottom',
              },
            ],
            styles: { color },
          });
        }
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
