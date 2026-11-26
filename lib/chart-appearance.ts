/**
 * chart-appearance.ts — user-customisable chart appearance.
 *
 * AppearanceSettings is the single source of truth for chart colours,
 * grid visibility and axis font size (desktop and mobile share it —
 * it lives in page.tsx state and is persisted in localStorage).
 *
 * Pure data + a Styles builder. Only a TYPE import from klinecharts,
 * so this module is safe to import from server-rendered code
 * (page.tsx): the klinecharts bundle itself is never touched at
 * import time. The client-only work (init / setStyles) happens in
 * Chart.tsx.
 *
 * Verified against klinecharts 10.1.1 (installed):
 * - candle.bar has separate up/down/noChange border + wick colours
 *   (upBorderColor / downBorderColor / upWickColor / downWickColor);
 *   the library defaults each to its fill colour, so the defaults
 *   below match the current look exactly.
 * - xAxis / yAxis tickText has a `size` field (library default 12).
 * - Styles has NO chart background field: the chart canvas is
 *   transparent, so the background colour is applied to the chart
 *   container div (Chart.tsx) instead of through Styles.
 * - setStyles is a recursive deep merge (bundle merge()), so
 *   applying the appearance styles never clobbers the candle type
 *   or the tooltip showRule set elsewhere.
 */

import type { DeepPartial, Styles } from 'klinecharts';

export interface AppearanceSettings {
  /** Chart background (container div, klinecharts has no bg style). */
  background: string;
  /** Show the grid. */
  gridShow: boolean;
  /** Grid line colour (horizontal + vertical). */
  gridColor: string;
  /** Candle fill colour, up (close >= open). */
  candleUpColor: string;
  /** Candle fill colour, down. */
  candleDownColor: string;
  /** Candle border colour, up. */
  candleUpBorderColor: string;
  /** Candle border colour, down. */
  candleDownBorderColor: string;
  /** Candle wick colour, up. */
  candleUpWickColor: string;
  /** Candle wick colour, down. */
  candleDownWickColor: string;
  /** Line-chart (線形圖) line colour. */
  areaLineColor: string;
  /** Axis tick text colour (x + y). */
  axisTextColor: string;
  /** Axis tick text size in px (x + y). */
  axisTextSize: number;
  /** Axis line + tick line colour (x + y). */
  axisLineColor: string;
  /** Crosshair line colour (horizontal + vertical). */
  crosshairColor: string;
  /** Pane separator colour. */
  separatorColor: string;
}

/**
 * Defaults = the current DARK_STYLES look (lib/chart-theme.ts):
 * grid #1e222d, candles #26a69a / #ef5350, axis text #787b86,
 * crosshair #758696, separator/axis lines #2a2e39, container
 * background #131722, axis text size 12 (the library default).
 * An old user with no saved appearance sees no change at all.
 */
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  background: '#131722',
  gridShow: true,
  gridColor: '#1e222d',
  candleUpColor: '#26a69a',
  candleDownColor: '#ef5350',
  candleUpBorderColor: '#26a69a',
  candleDownBorderColor: '#ef5350',
  candleUpWickColor: '#26a69a',
  candleDownWickColor: '#ef5350',
  areaLineColor: '#2962ff',
  axisTextColor: '#787b86',
  axisTextSize: 12,
  axisLineColor: '#2a2e39',
  crosshairColor: '#758696',
  separatorColor: '#2a2e39',
};

/** Font sizes offered in the appearance dialog. */
export const APPEARANCE_FONT_SIZES = [10, 11, 12, 13, 14];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Clamp a loaded value to a valid appearance: bad hex falls back to
 *  the default, the font size is clamped to the offered range, and a
 *  non-boolean grid flag falls back to true. Unknown extra fields are
 *  dropped, so a future field never breaks an old save. */
export function normalizeAppearance(
  saved: Partial<AppearanceSettings>,
): AppearanceSettings {
  const color = (v: unknown, fallback: string): string =>
    typeof v === 'string' && HEX_RE.test(v.trim())
      ? v.trim().toLowerCase()
      : fallback;
  const size =
    typeof saved.axisTextSize === 'number' &&
    Number.isFinite(saved.axisTextSize)
      ? Math.max(
          APPEARANCE_FONT_SIZES[0],
          Math.min(
            APPEARANCE_FONT_SIZES[APPEARANCE_FONT_SIZES.length - 1],
            Math.round(saved.axisTextSize),
          ),
        )
      : DEFAULT_APPEARANCE.axisTextSize;
  return {
    background: color(saved.background, DEFAULT_APPEARANCE.background),
    gridShow:
      typeof saved.gridShow === 'boolean'
        ? saved.gridShow
        : DEFAULT_APPEARANCE.gridShow,
    gridColor: color(saved.gridColor, DEFAULT_APPEARANCE.gridColor),
    candleUpColor: color(
      saved.candleUpColor,
      DEFAULT_APPEARANCE.candleUpColor,
    ),
    candleDownColor: color(
      saved.candleDownColor,
      DEFAULT_APPEARANCE.candleDownColor,
    ),
    candleUpBorderColor: color(
      saved.candleUpBorderColor,
      DEFAULT_APPEARANCE.candleUpBorderColor,
    ),
    candleDownBorderColor: color(
      saved.candleDownBorderColor,
      DEFAULT_APPEARANCE.candleDownBorderColor,
    ),
    candleUpWickColor: color(
      saved.candleUpWickColor,
      DEFAULT_APPEARANCE.candleUpWickColor,
    ),
    candleDownWickColor: color(
      saved.candleDownWickColor,
      DEFAULT_APPEARANCE.candleDownWickColor,
    ),
    areaLineColor: color(
      saved.areaLineColor,
      DEFAULT_APPEARANCE.areaLineColor,
    ),
    axisTextColor: color(
      saved.axisTextColor,
      DEFAULT_APPEARANCE.axisTextColor,
    ),
    axisTextSize: size,
    axisLineColor: color(
      saved.axisLineColor,
      DEFAULT_APPEARANCE.axisLineColor,
    ),
    crosshairColor: color(
      saved.crosshairColor,
      DEFAULT_APPEARANCE.crosshairColor,
    ),
    separatorColor: color(
      saved.separatorColor,
      DEFAULT_APPEARANCE.separatorColor,
    ),
  };
}

/**
 * Appearance -> klinecharts Styles (DeepPartial). Covers grid, candle
 * bar/area/priceMark, both axes, crosshair and separator — every
 * field DARK_STYLES sets in those sections, plus border/wick colours
 * and the axis text size. Deliberately does NOT include candle.type
 * (the chart-type effect owns it) or the overlay styles (DARK_STYLES
 * owns them; init spreads both, setStyles deep-merges).
 * The background colour is NOT in Styles — Chart.tsx puts it on the
 * container div.
 */
export function buildAppearanceStyles(
  s: AppearanceSettings,
): DeepPartial<Styles> {
  // Two separate objects (not one shared reference): the library
  // holds the Styles object and must never see xAxis === yAxis.
  const axis = () => ({
    axisLine: { color: s.axisLineColor },
    tickLine: { color: s.axisLineColor },
    tickText: { color: s.axisTextColor, size: s.axisTextSize },
  });
  return {
    grid: {
      show: s.gridShow,
      horizontal: { color: s.gridColor },
      vertical: { color: s.gridColor },
    },
    candle: {
      bar: {
        upColor: s.candleUpColor,
        downColor: s.candleDownColor,
        noChangeColor: '#888888',
        upBorderColor: s.candleUpBorderColor,
        downBorderColor: s.candleDownBorderColor,
        noChangeBorderColor: '#888888',
        upWickColor: s.candleUpWickColor,
        downWickColor: s.candleDownWickColor,
        noChangeWickColor: '#888888',
      },
      // 線形圖 (klinecharts 'area'): plain line, no fill — same as
      // DARK_STYLES, only the line colour is user-settable.
      area: {
        lineSize: 1,
        lineColor: s.areaLineColor,
        backgroundColor: 'transparent',
      },
      priceMark: {
        last: {
          upColor: s.candleUpColor,
          downColor: s.candleDownColor,
          noChangeColor: '#888888',
        },
      },
    },
    xAxis: axis(),
    yAxis: axis(),
    crosshair: {
      show: true,
      horizontal: { line: { color: s.crosshairColor } },
      vertical: { line: { color: s.crosshairColor } },
    },
    separator: {
      color: s.separatorColor,
    },
  };
}
