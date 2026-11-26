/**
 * chart-config.ts — pure constants for the chart UI.
 *
 * Deliberately has NO klinecharts import: page.tsx and Toolbar.tsx are
 * server-rendered, and the klinecharts bundle touches `window` at import
 * time. Anything that imports klinecharts (chart-theme.ts, Chart.tsx) is
 * loaded client-only.
 */

/**
 * Drawing tool ids. Values are klinecharts 10.1.1 overlay names, verified
 * against the installed bundle (node_modules/klinecharts/dist/index.esm.js):
 * segment, straightLine, rayLine, horizontalStraightLine,
 * horizontalRayLine, verticalStraightLine, parallelStraightLine,
 * horizontalSegment, verticalSegment, verticalRayLine, priceLine,
 * priceChannelLine, brush and simpleTag are all built-ins.
 * `rectangle`, `fibonacciRetracement` and `measure` are custom overlays
 * registered in lib/chart-theme.ts; `textAnnotation` is the custom
 * text overlay (Phase 2), and `simpleTag` is a custom re-registration
 * of the built-in (its Y-axis tag reads extendData as a raw string,
 * which collides with the object extendData this app persists).
 * Geometry batch (custom overlays, klinecharts has no built-ins for
 * them): `ellipse`, `triangle`, `arc`, `curve`, `path`, `pen`,
 * `arrow` — also registered in lib/chart-theme.ts.
 * Fibonacci batch (custom overlays, TV-only): `fibChannel`,
 * `fibTimeZones`, `fibFan`, `fibArc`, `fibSpiral`, `fibWedge` —
 * also registered in lib/chart-theme.ts; they share the fib level
 * options (levels / levelColors / fibExtend / fibLevelText) with
 * `fibonacciRetracement` in extendData.
 * Pitchfork batch (custom overlays, TV-only): `pitchfork`,
 * `schiffPitchfork`, `modifiedSchiffPitchfork`, `insidePitchfork` —
 * also registered in lib/chart-theme.ts; options in extendData are
 * pitchExtend ('none' | 'right' | 'both'), showMedian, showOuter,
 * medianBold.
 * Gann batch (custom overlays, TV-only): `gannFan`, `gannSquare`,
 * `gannBox` — also registered in lib/chart-theme.ts; options in
 * extendData are gannExtend ('none' | 'right' | 'both', fan only),
 * gannAnglesEnabled, gannMainBold, gannAngleText, gannGrid,
 * gannShowDiagonal, gannShowMidlines, gannShowLabels.
 * Pattern batch (custom overlays, TV-only): `headShoulders`,
 * `elliottImpulse`, `elliottCorrection`, `abcdPattern`,
 * `xabcdPattern`, `threeDrives` — also registered in
 * lib/chart-theme.ts; options in extendData are patternShowLabels,
 * patternShowNeckline, patternShowDashed, patternShowRatios.
 */
export type DrawingTool =
  | 'segment'
  | 'straightLine'
  | 'rayLine'
  | 'horizontalStraightLine'
  | 'horizontalRayLine'
  | 'verticalStraightLine'
  | 'parallelStraightLine'
  | 'horizontalSegment'
  | 'verticalSegment'
  | 'verticalRayLine'
  | 'priceLine'
  | 'priceChannelLine'
  | 'brush'
  | 'simpleTag'
  | 'textAnnotation'
  | 'fibonacciRetracement'
  | 'fibChannel'
  | 'fibTimeZones'
  | 'fibFan'
  | 'fibArc'
  | 'fibSpiral'
  | 'fibWedge'
  | 'pitchfork'
  | 'schiffPitchfork'
  | 'modifiedSchiffPitchfork'
  | 'insidePitchfork'
  | 'gannFan'
  | 'gannSquare'
  | 'gannBox'
  | 'headShoulders'
  | 'elliottImpulse'
  | 'elliottCorrection'
  | 'abcdPattern'
  | 'xabcdPattern'
  | 'threeDrives'
  | 'rectangle'
  | 'measure'
  | 'ellipse'
  | 'triangle'
  | 'arc'
  | 'curve'
  | 'path'
  | 'pen'
  | 'arrow';

/** Custom overlays (registered in lib/chart-theme.ts, not klinecharts built-ins). */
export const CUSTOM_OVERLAYS: ReadonlySet<string> = new Set([
  'fibonacciRetracement',
  'fibChannel',
  'fibTimeZones',
  'fibFan',
  'fibArc',
  'fibSpiral',
  'fibWedge',
  'pitchfork',
  'schiffPitchfork',
  'modifiedSchiffPitchfork',
  'insidePitchfork',
  'gannFan',
  'gannSquare',
  'gannBox',
  'headShoulders',
  'elliottImpulse',
  'elliottCorrection',
  'abcdPattern',
  'xabcdPattern',
  'threeDrives',
  'rectangle',
  'measure',
  'textAnnotation',
  'simpleTag',
  'ellipse',
  'triangle',
  'arc',
  'curve',
  'path',
  'pen',
  'arrow',
]);

/**
 * Max points for the multi-point step-mode tools (path, pen). Their
 * totalStep is this + 1, so a drawing auto-finishes at the cap; the
 * normal finish gesture is a double-click (the library force-
 * completes an in-progress overlay on double-click).
 */
export const MULTI_POINT_MAX_POINTS = 50;

export const DRAWING_TOOLS: Array<{ id: DrawingTool; label: string }> = [
  { id: 'segment', label: '趨勢線' },
  { id: 'straightLine', label: '延伸線' },
  { id: 'rayLine', label: '射線' },
  { id: 'horizontalStraightLine', label: '水平線' },
  { id: 'horizontalRayLine', label: '水平射線' },
  { id: 'verticalStraightLine', label: '垂直線' },
  { id: 'parallelStraightLine', label: '平行通道' },
  { id: 'horizontalSegment', label: '水平線段' },
  { id: 'verticalSegment', label: '垂直線段' },
  { id: 'verticalRayLine', label: '垂直射線' },
  { id: 'priceLine', label: '價位線' },
  { id: 'priceChannelLine', label: '價位通道' },
  { id: 'brush', label: '徒手畫' },
  { id: 'simpleTag', label: '價位標籤' },
  { id: 'textAnnotation', label: '文字標註' },
  { id: 'fibonacciRetracement', label: '斐波那契' },
  { id: 'fibChannel', label: '斐波那契通道' },
  { id: 'fibTimeZones', label: '斐波那契時間週期' },
  { id: 'fibFan', label: '斐波那契扇形' },
  { id: 'fibArc', label: '斐波那契弧線' },
  { id: 'fibSpiral', label: '斐波那契螺旋' },
  { id: 'fibWedge', label: '斐波那契楔形' },
  { id: 'pitchfork', label: 'Pitchfork' },
  { id: 'schiffPitchfork', label: 'Schiff Pitchfork' },
  { id: 'modifiedSchiffPitchfork', label: '修正 Schiff Pitchfork' },
  { id: 'insidePitchfork', label: '內部 Pitchfork' },
  { id: 'gannFan', label: 'Gann 扇形' },
  { id: 'gannSquare', label: 'Gann 方形' },
  { id: 'gannBox', label: 'Gann 箱體' },
  { id: 'headShoulders', label: '頭肩形態' },
  { id: 'elliottImpulse', label: '艾略特推動浪' },
  { id: 'elliottCorrection', label: '艾略特修正浪' },
  { id: 'abcdPattern', label: 'ABCD 形態' },
  { id: 'xabcdPattern', label: 'XABCD 諧波形態' },
  { id: 'threeDrives', label: '三驅動形態' },
  { id: 'rectangle', label: '矩形' },
  { id: 'measure', label: '量測' },
  { id: 'ellipse', label: '橢圓' },
  { id: 'triangle', label: '三角形' },
  { id: 'arc', label: '弧線' },
  { id: 'curve', label: '曲線' },
  { id: 'arrow', label: '箭頭' },
  { id: 'path', label: '路徑' },
  { id: 'pen', label: '鋼筆' },
];

/** Line style ids. 'dotted' renders as dashed + dashedValue [1, 4]
 *  (klinecharts LineType is solid|dashed). */
export type LineStyleId = 'solid' | 'dashed' | 'dotted';

export const LINE_STYLE_OPTIONS: Array<{ id: LineStyleId; label: string }> = [
  { id: 'solid', label: '實線' },
  { id: 'dashed', label: '短虛線' },
  { id: 'dotted', label: '點虛線' },
];

/**
 * Extend direction for line overlays. 'up'/'down' are the vertical
 * family's options (a vertical ray extends up or down); the diagonal
 * and horizontal families use 'left'/'right'.
 */
export type ExtendId = 'none' | 'left' | 'right' | 'up' | 'down' | 'both';

/** Line families that support the extend option. */
export type LineFamily = 'line' | 'horizontal' | 'vertical';

export function lineFamilyOf(name: string): LineFamily | null {
  if (name === 'segment' || name === 'straightLine' || name === 'rayLine')
    return 'line';
  if (name.startsWith('horizontal')) return 'horizontal';
  if (name.startsWith('vertical')) return 'vertical';
  return null;
}

/** Overlay name for a line family + extend option. */
export function overlayNameForExtend(
  family: LineFamily,
  extend: ExtendId,
): string {
  switch (family) {
    case 'line':
      return extend === 'none'
        ? 'segment'
        : extend === 'both'
          ? 'straightLine'
          : 'rayLine';
    case 'horizontal':
      return extend === 'none'
        ? 'horizontalSegment'
        : extend === 'both'
          ? 'horizontalStraightLine'
          : 'horizontalRayLine';
    case 'vertical':
      return extend === 'none'
        ? 'verticalSegment'
        : extend === 'both'
          ? 'verticalStraightLine'
          : 'verticalRayLine';
  }
}

/**
 * Derive the extend option from an overlay name + point order. A ray
 * runs from p0 toward p1, so the direction follows the point order.
 */
export function extendForOverlay(
  name: string,
  points: Array<{ timestamp: number; value: number }>,
): ExtendId {
  const family = lineFamilyOf(name);
  if (!family) return 'none';
  if (
    name === 'segment' ||
    name === 'horizontalSegment' ||
    name === 'verticalSegment'
  )
    return 'none';
  if (
    name === 'straightLine' ||
    name === 'horizontalStraightLine' ||
    name === 'verticalStraightLine'
  )
    return 'both';
  if (points.length < 2) return 'right';
  const [p0, p1] = points;
  if (family === 'vertical') return p1.value > p0.value ? 'up' : 'down';
  return p1.timestamp > p0.timestamp ? 'right' : 'left';
}

/**
 * Order the two points for an extend option. Ray direction follows
 * p0 -> p1, so 'left' puts the later point first (ray extends left),
 * 'right' the earlier first; vertical 'up' puts the lower value first
 * (ray extends up), 'down' the higher first. 'none'/'both' normalise
 * to earlier-first.
 */
export function orderPointsForExtend(
  points: Array<{ timestamp: number; value: number }>,
  extend: ExtendId,
  family: LineFamily,
): Array<{ timestamp: number; value: number }> {
  if (points.length < 2) return points;
  const [a, b] = points;
  if (family === 'vertical') {
    if (extend === 'up') return a.value <= b.value ? [a, b] : [b, a];
    if (extend === 'down') return a.value >= b.value ? [a, b] : [b, a];
    return a.timestamp <= b.timestamp ? [a, b] : [b, a];
  }
  if (extend === 'left') return a.timestamp >= b.timestamp ? [a, b] : [b, a];
  return a.timestamp <= b.timestamp ? [a, b] : [b, a];
}

/** Settings-dialog titles by overlay name (covers the segment variants
 *  too, which are not toolbar tools). */
export const TOOL_LABELS_BY_NAME: Record<string, string> = {
  segment: '趨勢線',
  straightLine: '延伸線',
  rayLine: '射線',
  horizontalStraightLine: '水平線',
  horizontalRayLine: '水平射線',
  horizontalSegment: '水平線段',
  verticalStraightLine: '垂直線',
  verticalRayLine: '垂直射線',
  verticalSegment: '垂直線段',
  parallelStraightLine: '平行通道',
  priceLine: '價位線',
  priceChannelLine: '價位通道',
  brush: '徒手畫',
  simpleTag: '價位標籤',
  textAnnotation: '文字標註',
  fibonacciRetracement: '斐波那契',
  fibChannel: '斐波那契通道',
  fibTimeZones: '斐波那契時間週期',
  fibFan: '斐波那契扇形',
  fibArc: '斐波那契弧線',
  fibSpiral: '斐波那契螺旋',
  fibWedge: '斐波那契楔形',
  pitchfork: 'Pitchfork',
  schiffPitchfork: 'Schiff Pitchfork',
  modifiedSchiffPitchfork: '修正 Schiff Pitchfork',
  insidePitchfork: '內部 Pitchfork',
  gannFan: 'Gann 扇形',
  gannSquare: 'Gann 方形',
  gannBox: 'Gann 箱體',
  headShoulders: '頭肩形態',
  elliottImpulse: '艾略特推動浪',
  elliottCorrection: '艾略特修正浪',
  abcdPattern: 'ABCD 形態',
  xabcdPattern: 'XABCD 諧波形態',
  threeDrives: '三驅動形態',
  rectangle: '矩形',
  measure: '量測',
  ellipse: '橢圓',
  triangle: '三角形',
  arc: '弧線',
  curve: '曲線',
  arrow: '箭頭',
  path: '路徑',
  pen: '鋼筆',
};

/** Indicators offered in the toolbar (all are klinecharts built-ins). */
export const INDICATOR_OPTIONS: Array<{ id: string; label: string; mainPane: boolean }> = [
  { id: 'MA', label: 'MA', mainPane: true },
  { id: 'EMA', label: 'EMA', mainPane: true },
  { id: 'BOLL', label: 'BOLL', mainPane: true },
  { id: 'VOL', label: '成交量', mainPane: true },
  { id: 'RSI', label: 'RSI', mainPane: false },
  { id: 'MACD', label: 'MACD', mainPane: false },
];

/** Indicators enabled on first visit. */
export const DEFAULT_INDICATORS = ['MA', 'VOL'];

/** Milliseconds per candle for each timeframe (measure tool, copy offset,
 *  range bar). '1M' is approximate (30 days) — only used for counts. */
export const INTERVAL_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

/** Candle render styles (klinecharts CandleType, verified 10.1.1).
 * Only two for now (Ryan 2026-11-26): K線 (candles) and 線形圖 (line,
 * implemented as klinecharts 'area' with a transparent fill). 美國線
 * (ohlc) removed — the chart always shows K線 unless 線形圖 is picked.
 * 平均K線 (Heikin Ashi) needs a data transform in Chart.tsx and comes
 * after Phase 3. */
export type ChartType = 'candle_solid' | 'area';

export const CHART_TYPES: Array<{ id: ChartType; label: string }> = [
  { id: 'candle_solid', label: 'K線' },
  { id: 'area', label: '線形圖' },
];

export const DEFAULT_CHART_TYPE: ChartType = 'candle_solid';

/**
 * Bottom range presets (TradingView-style: 1天 5天 1月 3月 6月 YTD 1年
 * 全部). `ms` is the calendar span the preset covers; the chart shows
 * that span capped by the candles actually loaded (500 per init load,
 * more on scroll), pinned to the latest candle.
 */
export type RangeId = '1d' | '5d' | '1M' | '3M' | '6M' | 'ytd' | '1y' | 'all';

export const RANGES: Array<{
  id: RangeId;
  label: string;
  /** Calendar span in ms; 'ytd' and 'all' are computed, not fixed. */
  ms: number | null;
}> = [
  { id: '1d', label: '1天', ms: 24 * 60 * 60 * 1000 },
  { id: '5d', label: '5天', ms: 5 * 24 * 60 * 60 * 1000 },
  { id: '1M', label: '1月', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '3M', label: '3月', ms: 90 * 24 * 60 * 60 * 1000 },
  { id: '6M', label: '6月', ms: 180 * 24 * 60 * 60 * 1000 },
  { id: 'ytd', label: 'YTD', ms: null },
  { id: '1y', label: '1年', ms: 365 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: '全部', ms: null },
];

/**
 * Drawing color palette (TradingView-style, 10 columns x 8 rows).
 * Row 0 is grayscale, rows 1–7 are hues from light to dark. Used by
 * components/ColorPicker.tsx (floating edit bar, and the Phase 2
 * settings dialog later).
 */
export const COLOR_PALETTE_GRID: string[] = [
  // Grayscale
  '#ffffff', '#f5f5f5', '#e0e0e0', '#bdbdbd', '#9e9e9e',
  '#757575', '#616161', '#424242', '#212121', '#000000',
  // Reds
  '#ffebee', '#ffcdd2', '#ef9a9a', '#e57373', '#ef5350',
  '#f44336', '#e53935', '#d32f2f', '#c62828', '#b71c1c',
  // Oranges
  '#fff3e0', '#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726',
  '#ff9800', '#fb8c00', '#f57c00', '#ef6c00', '#e65100',
  // Yellows
  '#fffde7', '#fff9c4', '#fff59d', '#fff176', '#ffee58',
  '#ffeb3b', '#fdd835', '#fbc02d', '#f9a825', '#f57f17',
  // Greens
  '#e8f5e9', '#c8e6c9', '#a5d6a7', '#81c784', '#66bb6a',
  '#4caf50', '#43a047', '#388e3c', '#2e7d32', '#1b5e20',
  // Teals
  '#e0f2f1', '#b2dfdb', '#80cbc4', '#4db6ac', '#26a69a',
  '#009688', '#00897b', '#00796b', '#00695c', '#004d40',
  // Blues
  '#e3f2fd', '#bbdefb', '#90caf9', '#64b5f6', '#42a5f5',
  '#2196f3', '#1e88e5', '#1976d2', '#1565c0', '#0d47a1',
  // Pinks / purples
  '#fce4ec', '#f8bbd0', '#f48fb1', '#f06292', '#ec407a',
  '#e91e63', '#d81b60', '#c2185b', '#ad1457', '#880e4f',
];
