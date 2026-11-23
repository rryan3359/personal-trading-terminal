/**
 * chart-config.ts — pure constants for the chart UI.
 *
 * Deliberately has NO klinecharts import: page.tsx and Toolbar.tsx are
 * server-rendered, and the klinecharts bundle touches `window` at import
 * time. Anything that imports klinecharts (chart-theme.ts, Chart.tsx) is
 * loaded client-only.
 */

/** Drawing tool ids. Values are klinecharts overlay names. */
export type DrawingTool =
  | 'straightLine'
  | 'horizontalStraightLine'
  | 'rayLine'
  | 'fibonacciLine'
  | 'rectangle';

export const DRAWING_TOOLS: Array<{ id: DrawingTool; label: string }> = [
  { id: 'straightLine', label: '趨勢線' },
  { id: 'horizontalStraightLine', label: '水平線' },
  { id: 'rayLine', label: '射線' },
  { id: 'fibonacciLine', label: '斐波那契' },
  { id: 'rectangle', label: '矩形' },
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
