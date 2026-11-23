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

/** Milliseconds per candle for each timeframe (measure tool, copy offset). */
export const INTERVAL_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};
