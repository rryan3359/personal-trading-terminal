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
 * horizontalRayLine, verticalStraightLine, parallelStraightLine and
 * fibonacciLine are all built-ins. `rectangle`, `fibonacciRetracement`
 * and `measure` are custom overlays registered in lib/chart-theme.ts.
 */
export type DrawingTool =
  | 'segment'
  | 'straightLine'
  | 'rayLine'
  | 'horizontalStraightLine'
  | 'horizontalRayLine'
  | 'verticalStraightLine'
  | 'parallelStraightLine'
  | 'fibonacciRetracement'
  | 'rectangle'
  | 'measure';

/** Custom overlays (registered in lib/chart-theme.ts, not klinecharts built-ins). */
export const CUSTOM_OVERLAYS: ReadonlySet<string> = new Set([
  'fibonacciRetracement',
  'rectangle',
  'measure',
]);

export const DRAWING_TOOLS: Array<{ id: DrawingTool; label: string }> = [
  { id: 'segment', label: '趨勢線' },
  { id: 'straightLine', label: '延伸線' },
  { id: 'rayLine', label: '射線' },
  { id: 'horizontalStraightLine', label: '水平線' },
  { id: 'horizontalRayLine', label: '水平射線' },
  { id: 'verticalStraightLine', label: '垂直線' },
  { id: 'parallelStraightLine', label: '平行通道' },
  { id: 'fibonacciRetracement', label: '斐波那契' },
  { id: 'rectangle', label: '矩形' },
  { id: 'measure', label: '量測' },
];

/** Indicators offered in the toolbar (all are klinecharts built-ins). */
export const INDICATOR_OPTIONS: Array<{ id: string; label: string; mainPane: boolean }> = [
  { id: 'MA', label: 'MA', mainPane: true },
  { id: 'EMA', label: 'EMA', mainPane: true },
  { id: 'BOLL', label: 'BOLL', mainPane: true },
  { id: 'VOL', label: '成交量', mainPane: false },
  { id: 'RSI', label: 'RSI', mainPane: false },
  { id: 'MACD', label: 'MACD', mainPane: false },
];

/** Indicators enabled on first visit. */
export const DEFAULT_INDICATORS = ['MA', 'VOL'];

/** Milliseconds per candle for each timeframe (measure tool, copy offset,
 *  range bar). '1M' is approximate (30 days) — only used for counts. */
export const INTERVAL_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

/** Candle render styles (klinecharts CandleType, verified 10.1.1). */
export type ChartType = 'candle_solid' | 'ohlc' | 'area';

export const CHART_TYPES: Array<{ id: ChartType; label: string }> = [
  { id: 'candle_solid', label: '蠟燭圖' },
  { id: 'ohlc', label: '美國線' },
  { id: 'area', label: '面積圖' },
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
