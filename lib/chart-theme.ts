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
 *   textAnnotation       -> one point, text label from extendData.text;
 *                           as a companion (id `${mainId}:text`) it is
 *                           never persisted and its label uses the
 *                           "textNoHit" figure so clicks pass through to
 *                           the main line; as a standalone drawing tool
 *                           it IS persisted and gets a point figure.
 *   simpleTag            -> re-registration of the built-in: same
 *                           full-width line + Y-axis tag, but the tag
 *                           reads extendData.tagText (else the price)
 *                           instead of the raw extendData object, and
 *                           the point figure is on so it is selectable.
 *   Geometry batch (TV-only tools, no klinecharts built-ins):
 *   ellipse              -> 2 points (bounding-box corners), polygon-
 *                           sampled ellipse, optional fill
 *   triangle             -> 3 points, polygon, optional fill
 *   arc                  -> 3 points (start, end, on-arc), circumcircle
 *                           arc figure, straight-line fallback when
 *                           the points are collinear
 *   curve                -> 3 points (start, control, end), quadratic
 *                           bezier sampled into a line figure
 *   path                 -> up to 50 points, polyline; double-click
 *                           (or Esc, see Chart.tsx) finishes
 *   pen                  -> like path but the line figure smooths
 *                           through the points
 *   arrow                -> 2 points, line + filled triangular head
 */

import {
  registerFigure,
  registerOverlay,
  type DeepPartial,
  type Overlay,
  type Styles,
  type TextAttrs,
  type TextStyle,
} from 'klinecharts';
import { MULTI_POINT_MAX_POINTS } from '@/lib/chart-config';

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
 * `hittable` uses the built-in "text" figure (clickable); otherwise
 * the "textNoHit" figure (purely visual). Standalone text annotations
 * need a hittable label — it is their only figure — while companion
 * labels must stay non-hittable so clicks reach the main line, and
 * rectangle labels likewise (the rect border is the hit target).
 */
function textFigures(
  content: string,
  x: number,
  y: number,
  t: OverlayTextLike,
  hittable = false,
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
    type: hittable ? 'text' : 'textNoHit',
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
      // Standalone annotations (groupId === own id) render a hittable
      // label: it is their only figure, so clicking the text is how
      // the annotation gets selected. Companions (groupId = main
      // line's id) keep the non-hittable label so clicks reach the
      // main line underneath.
      const hittable = overlay.groupId === overlay.id;
      return textFigures(text.content, anchor.x, anchor.y, text, hittable) as never;
    },
  });
}

let simpleTagRegistered = false;

/**
 * Register the custom "simpleTag" overlay once per page load. This
 * REPLACES the klinecharts built-in of the same name (registerOverlay
 * is a plain map assignment, so a later registration wins).
 *
 * Two built-in defects, both verified against the installed bundle:
 * 1. Its createYAxisFigures reads `overlay.extendData` as the tag
 *    text — a raw string or a function returning one. This app always
 *    persists extendData as an OBJECT (visibleIntervals, text, ...),
 *    so the built-in tag would render "[object Object]". The custom
 *    version reads an optional `extendData.tagText` string and falls
 *    back to the point's price.
 * 2. It sets no needDefaultPointFigure, and the OverlayImp default is
 *    false, so the built-in tag has no control point: it can never be
 *    selected, dragged, edited or deleted. The custom version turns
 *    the point figure on and leaves the line hittable (the built-in
 *    line is ignoreEvent, so the tag could never be hovered at all).
 *    Default point figures only render once an overlay is already
 *    hovered/selected, so a hittable line figure is what makes the
 *    tag reachable in the first place.
 */
export function registerSimpleTagOverlay(): void {
  if (simpleTagRegistered) return;
  simpleTagRegistered = true;

  registerOverlay({
    name: 'simpleTag',
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    styles: {
      line: { style: 'dashed' },
    },
    createPointFigures: ({ bounding, coordinates }) => {
      if (coordinates.length < 1) return [];
      // The line stays hittable (no ignoreEvent): hovering it is how
      // the tag gets selected — its only other figure is the Y-axis
      // tag, and the default point figure only renders once the
      // overlay is already hovered/selected.
      return [
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: 0, y: coordinates[0].y },
              { x: bounding.width, y: coordinates[0].y },
            ],
          },
        },
      ] as never;
    },
    createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => {
      const isFromZero = yAxis?.isFromZero() ?? false;
      const textAlign = isFromZero ? 'left' : 'right';
      const x = isFromZero ? 0 : bounding.width;
      const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
      const tagText =
        typeof ext.tagText === 'string' && ext.tagText.length > 0
          ? ext.tagText
          : null;
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const value = overlay.points[0]?.value;
      const text =
        tagText ??
        (typeof value === 'number' ? value.toFixed(precision) : '');
      return {
        type: 'text',
        attrs: {
          x,
          y: coordinates[0].y,
          text,
          align: textAlign,
          baseline: 'middle',
        },
      } as never;
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

// ---- geometry batch (TV-only tools) -------------------------------------

type GeomLineStyle = {
  color: string;
  size: number;
  style: 'solid' | 'dashed';
  dashedValue?: number[];
};

/** Border/line style of one geometry drawing, from the overlay itself
 *  (stylesForOverlay in Chart.tsx already folded opacity into the
 *  rgba line colour). */
function geomLineStyle(overlay: Overlay): GeomLineStyle {
  const line = overlay.styles?.line;
  return {
    color: line?.color ?? '#2962ff',
    size: line?.size ?? 1,
    style: line?.style === 'dashed' ? 'dashed' : 'solid',
    dashedValue: Array.isArray(line?.dashedValue)
      ? (line.dashedValue as number[])
      : undefined,
  };
}

/** Fill switch + opacity for the closed shapes (ellipse, triangle),
 *  from extendData. Default: border only, like the rectangle. */
function geomFillOf(overlay: {
  extendData?: unknown;
}): { fill: boolean; fillOpacity: number } {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  return {
    fill: ext.fill === true,
    fillOpacity:
      typeof ext.fillOpacity === 'number' ? ext.fillOpacity : 0.08,
  };
}

/** 'line' figure styles for one geometry drawing. */
function geomLineFigureStyles(
  line: GeomLineStyle,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    color: line.color,
    size: line.size,
    style: line.style,
    ...(line.dashedValue ? { dashedValue: line.dashedValue } : {}),
    ...extra,
  };
}

/** 'polygon' figure for a closed shape: border from the line style,
 *  optional fill at extendData.fillOpacity. */
function geomPolygonFigure(
  coordinates: Array<{ x: number; y: number }>,
  overlay: Overlay,
): Record<string, unknown> {
  const line = geomLineStyle(overlay);
  const { fill, fillOpacity } = geomFillOf(overlay);
  return {
    type: 'polygon',
    attrs: { coordinates },
    styles: {
      style: fill ? 'stroke_fill' : 'stroke',
      color: hexToRgba(line.color, fillOpacity),
      borderColor: line.color,
      borderSize: line.size,
      borderStyle: line.style,
      ...(line.dashedValue
        ? { borderDashedValue: line.dashedValue }
        : {}),
    },
  };
}

/** Ellipse outline sampled as a polygon (no ellipse figure exists in
 *  klinecharts 10.1.1). 48 segments are indistinguishable from a true
 *  ellipse at chart scale, and the polygon's point-in-polygon hit test
 *  makes the whole shape clickable, like the rectangle. */
function sampleEllipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

/** Circumcircle of three points, or null when they are collinear
 *  (determinant ~0). Pixel space — the arc figure works in pixels. */
function circumcircle(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): { x: number; y: number; r: number } | null {
  const d =
    2 *
    (p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y));
  if (Math.abs(d) < 1e-9) return null;
  const sq0 = p0.x * p0.x + p0.y * p0.y;
  const sq1 = p1.x * p1.x + p1.y * p1.y;
  const sq2 = p2.x * p2.x + p2.y * p2.y;
  const x =
    (sq0 * (p1.y - p2.y) + sq1 * (p2.y - p0.y) + sq2 * (p0.y - p1.y)) / d;
  const y =
    (sq0 * (p2.x - p1.x) + sq1 * (p0.x - p2.x) + sq2 * (p1.x - p0.x)) / d;
  const r = Math.hypot(p0.x - x, p0.y - y);
  if (!Number.isFinite(r) || r <= 0) return null;
  return { x, y, r };
}

/**
 * Arc angles for a 3-point arc (start p0, end p1, on-arc p2).
 * ctx.arc strokes with increasing angle, so the returned sweep is
 * always startAngle -> startAngle + sweep (sweep in (0, 2π)), chosen
 * so the arc passes through p2. Matches the built-in arc figure's
 * hit test (checkCoordinateOnArc uses the same sweep convention).
 */
function arcAngles(
  c: { x: number; y: number },
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): { startAngle: number; endAngle: number } | null {
  const twoPi = Math.PI * 2;
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  const am = Math.atan2(p2.y - c.y, p2.x - c.x);
  const norm = (a: number) => ((a % twoPi) + twoPi) % twoPi;
  const cw = norm(a1 - a0); // increasing-angle sweep p0 -> p1
  if (cw <= 1e-9 || cw >= twoPi - 1e-9) return null;
  if (norm(am - a0) <= cw) return { startAngle: a0, endAngle: a0 + cw };
  const ccw = norm(a0 - a1); // increasing-angle sweep p1 -> p0
  return { startAngle: a1, endAngle: a1 + ccw };
}

/** Quadratic bezier p0 -> p2 with control p1, sampled (pixel space). */
function sampleQuadraticPoints(
  p0: { x: number; y: number },
  c: { x: number; y: number },
  p1: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    });
  }
  return pts;
}

let geometryRegistered = false;

/**
 * Register the 7 geometry overlays once per page load (see the file
 * header for the per-tool notes). All are step-mode: ellipse/arrow
 * take 2 clicks (totalStep 3), triangle/arc/curve 3 clicks
 * (totalStep 4); path/pen take up to MULTI_POINT_MAX_POINTS clicks
 * (totalStep = max + 1) and finish on double-click — the library
 * force-completes an in-progress overlay on double-click — or at the
 * point cap. Esc finishes path/pen too (Chart.tsx drives the same
 * force-complete through the guarded internal store API).
 */
export function registerGeometryOverlays(): void {
  if (geometryRegistered) return;
  geometryRegistered = true;

  registerOverlay({
    name: 'ellipse',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      if (rx < 1 || ry < 1) return [];
      return [
        geomPolygonFigure(
          sampleEllipsePoints((a.x + b.x) / 2, (a.y + b.y) / 2, rx, ry),
          overlay,
        ),
      ] as never;
    },
  });

  registerOverlay({
    name: 'triangle',
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 3) return [];
      return [geomPolygonFigure(coordinates.slice(0, 3), overlay)] as never;
    },
  });

  registerOverlay({
    name: 'arc',
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 3) return [];
      const [p0, p1, p2] = coordinates;
      const line = geomLineStyle(overlay);
      const lineFigure = {
        type: 'line',
        attrs: { coordinates: [p0, p1] },
        styles: geomLineFigureStyles(line),
      };
      const c = circumcircle(p0, p1, p2);
      const angles = c ? arcAngles(c, p0, p1, p2) : null;
      if (!c || !angles) return [lineFigure] as never;
      return [
        {
          type: 'arc',
          attrs: {
            x: c.x,
            y: c.y,
            r: c.r,
            startAngle: angles.startAngle,
            endAngle: angles.endAngle,
          },
          styles: geomLineFigureStyles(line),
        },
      ] as never;
    },
  });

  registerOverlay({
    name: 'curve',
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 3) return [];
      const [p0, c, p1] = coordinates;
      const line = geomLineStyle(overlay);
      return [
        {
          type: 'line',
          attrs: { coordinates: sampleQuadraticPoints(p0, c, p1) },
          styles: geomLineFigureStyles(line),
        },
      ] as never;
    },
  });

  registerOverlay({
    name: 'path',
    totalStep: MULTI_POINT_MAX_POINTS + 1,
    needDefaultPointFigure: true,
    // A 50-point path would put a marker per point on both axes.
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const line = geomLineStyle(overlay);
      return [
        {
          type: 'line',
          attrs: { coordinates },
          styles: geomLineFigureStyles(line, {
            lineCap: 'round',
            lineJoin: 'round',
          }),
        },
      ] as never;
    },
  });

  registerOverlay({
    name: 'pen',
    totalStep: MULTI_POINT_MAX_POINTS + 1,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const line = geomLineStyle(overlay);
      // The built-in line figure smooths through the points
      // (styles.smooth -> bezier via midpoints); the vertices stay
      // draggable control points. Distinct from brush (freehand drag)
      // and from path (straight segments).
      return [
        {
          type: 'line',
          attrs: { coordinates },
          styles: geomLineFigureStyles(line, { smooth: true }),
        },
      ] as never;
    },
  });

  registerOverlay({
    name: 'arrow',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [p0, p1] = coordinates;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 2) return [];
      const line = geomLineStyle(overlay);
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const headLen = 14;
      const headHalf = 5.5;
      const bx = p1.x - ux * headLen;
      const by = p1.y - uy * headLen;
      return [
        {
          type: 'line',
          attrs: { coordinates: [p0, p1] },
          styles: geomLineFigureStyles(line),
        },
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: p1.x, y: p1.y },
              { x: bx + nx * headHalf, y: by + ny * headHalf },
              { x: bx - nx * headHalf, y: by - ny * headHalf },
            ],
          },
          styles: { style: 'fill', color: line.color },
        },
      ] as never;
    },
  });
}
