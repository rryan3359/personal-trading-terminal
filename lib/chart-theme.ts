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
 *   Fibonacci batch (TV-only tools, share the retracement's level
 *   options in extendData — levels / levelColors / fibExtend /
 *   fibLevelText; see the section header):
 *   fibChannel           -> 2 points, parallel lines at fib ratios
 *                           of the price move, extendable left/right
 *   fibTimeZones         -> 2 points (anchor + unit), vertical lines
 *                           at fib sequence numbers of the unit
 *   fibFan               -> 2 points, rays from the first point at
 *                           fib ratios of the price move
 *   fibArc               -> 2 points, semicircles centred on the
 *                           first point at fib ratios of the distance
 *   fibSpiral            -> 2 points (centre + radius point),
 *                           logarithmic spiral growing by φ per
 *                           quarter turn
 *   fibWedge             -> 3 points (apex + two boundary points),
 *                           rays splitting the wedge angle at fib
 *                           ratios, extended to the pane edge
 *   Pitchfork batch (TV-only tools, median + two parallel outer
 *   lines in pixel space; options in extendData — pitchExtend /
 *   showMedian / showOuter / medianBold):
 *   pitchfork            -> 3 points (P0, P1, P2), median from P0
 *                           through the P1-P2 midpoint; outer lines
 *                           through P1 and P2, parallel to the median
 *   schiffPitchfork      -> median origin at the midpoint of P0 and
 *                           the P1-P2 midpoint (50% from P0 toward M)
 *   modifiedSchiffPitchfork -> median origin at 25% from P0 toward M
 *                           (halfway between P0 and the Schiff origin)
 *   insidePitchfork      -> median origin at M itself; P0 only sets
 *                           the direction
 *   Gann batch (TV-only tools; options in extendData —
 *   gannExtend / gannAnglesEnabled / gannMainBold / gannAngleText /
 *   gannGrid / gannShowDiagonal / gannShowMidlines / gannShowLabels):
 *   gannFan              -> 2 points (anchor + direction point). The
 *                           P0->P1 line IS the 1x1 line; the other 6
 *                           angle lines are rays from P0 whose pixel
 *                           slope is k * the 1x1 pixel slope
 *                           (k = 1/8, 1/4, 1/2, 2, 4, 8), so the fan
 *                           is exact in data space (price per bar)
 *                           whatever the axis scale is
 *   gannSquare           -> 2 points (opposite corners), 4x4 grid +
 *                           diagonals + price / date scale labels
 *   gannBox              -> 2 points (opposite corners), 3x3 grid +
 *                           diagonals + midlines + scale labels
 *   Pattern batch (TV-only tools; options in extendData —
 *   patternShowLabels / patternShowNeckline / patternShowDashed /
 *   patternShowRatios):
 *   headShoulders        -> 5 points (LS, H, RS, neckline L, neckline
 *                           R): polyline LS-H-RS + dashed neckline
 *   elliottImpulse       -> 6 points (0-5): 5-segment polyline
 *   elliottCorrection    -> 4 points (0, A, B, C): 3-segment polyline
 *   abcdPattern          -> 4 points (A, B, C, D): AB, BC, CD +
 *                           dashed AD
 *   xabcdPattern         -> 5 points (X, A, B, C, D): XA, AB, BC, CD
 *                           + dashed XD + optional retracement % at
 *                           each segment midpoint
 *   threeDrives          -> 6 points (drive, retrace x3): polyline,
 *                           the three drive points labelled 1/2/3
 */

import {
  registerFigure,
  registerOverlay,
  type Chart,
  type DeepPartial,
  type Overlay,
  type OverlayCreateFiguresCallback,
  type OverlayEvent,
  type Styles,
  type TextAttrs,
  type TextStyle,
} from 'klinecharts';
import { MULTI_POINT_MAX_POINTS } from '@/lib/chart-config';
import {
  calcPosition,
  readPositionSettings,
} from '@/lib/position-calc';

/**
 * G-18 (Phase 2 Step 4): klinecharts 10.1.1 deletes an overlay on
 * right-click unless the overlay's onRightClick calls preventDefault()
 * (OverlayView._figureMouseRightClickEvent -> store removeOverlay, no
 * undo, no immediate persist). Every custom overlay template below
 * carries this handler so a right-click opens the app's context menu
 * instead of silently deleting the drawing. Built-in overlays have no
 * template here; Chart.tsx's overlayCreate carries the same handler
 * for them.
 */
const preventOverlayRightClickDelete = (e: OverlayEvent<unknown>): void => {
  e.preventDefault?.();
};

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
    // 線形圖 (klinecharts 'area'): plain line, no fill, so it reads as a
    // TradingView-style line chart instead of an area chart.
    area: {
      lineSize: 1,
      lineColor: '#2962ff',
      backgroundColor: 'transparent',
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

/**
 * Colour (hex #rrggbb, or rgb()/rgba()) -> rgba() with the given
 * alpha. UI-drawn overlays store the line colour as rgba (the
 * opacity is folded in by stylesForOverlay), so a fill computed
 * from it must replace the alpha instead of passing the opaque
 * rgba through — otherwise the fill comes out solid and hides the
 * candles underneath (and the arrows drawn in the same colour).
 * Hex input keeps the existing behaviour; anything else is
 * returned unchanged.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const s = hex.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(
      s,
    );
  if (rgb) {
    return `rgba(${Number(rgb[1])}, ${Number(rgb[2])}, ${Number(rgb[3])}, ${alpha})`;
  }
  return hex;
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
    onRightClick: preventOverlayRightClickDelete,
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

let positionRegistered = false;

/**
 * Mirror a position stop to the correct side of the entry at the same
 * distance (long: stop below the entry, short: stop above). A stop
 * already on the correct side is returned unchanged. Shared by the
 * figure callback (live, during drags) and the draw-end normaliser
 * (committed points + persistence).
 */
export function mirrorPositionStop(
  isLong: boolean,
  entry: number,
  stop: number,
): number {
  if (isLong) return stop > entry ? entry - (stop - entry) : stop;
  return stop < entry ? entry + (entry - stop) : stop;
}

/**
 * Mirror a position target to the profit side of the entry at the
 * same distance (long: target above the entry, short: below). A
 * target already on the profit side is returned unchanged. The
 * target is a price level, so equality with the entry is left alone
 * (it is not wrong-sided, just zero reward).
 */
export function mirrorPositionTarget(
  isLong: boolean,
  entry: number,
  target: number,
): number {
  if (isLong) return target < entry ? entry + (entry - target) : target;
  return target > entry ? entry - (target - entry) : target;
}

/**
 * Register the custom "longPosition" / "shortPosition" overlays once
 * per page load. Three points: p0 = entry, p1 = stop, p2 = target.
 * The draw takes two clicks (entry, stop); the target is appended
 * at draw end at posRR (default 2 — i.e. 1:2R) from the entry, then
 * drags freely as the third point. Legacy 2-point saves have no p2
 * and keep deriving the target from extendData.posRR. The risk zone
 * spans entry → stop; the profit zone entry → target. The box's
 * horizontal extent is p0.x → p1.x (p2 shares p1's timestamp).
 * The stop may never cross the entry line (long: below, short:
 * above) and the target may never cross to the loss side; a point
 * placed or dragged onto the wrong side is mirrored to the correct
 * side at the same distance. Zones use the per-overlay profit/risk
 * colours (extendData.posProfitColor / posRiskColor); the entry line
 * uses the overlay line colour. Labels: TP + SL with prices and R
 * multiples (right), entry price (left). The stats pill (TV-style)
 * shows quantity, TP/SL P&L + %, account balance after TP/SL, R:R
 * and open P&L (last close); compact mode and the stats-item preset
 * trim it, and with "always show stats" off only a compact R:R +
 * Qty label is drawn at the entry line.
 */
export function registerPositionOverlays(): void {
  if (positionRegistered) return;
  positionRegistered = true;
  registerTextNoHitFigure();

  const makeFigures =
    (
      isLong: boolean,
    ): OverlayCreateFiguresCallback<unknown> =>
    ({ chart, coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const p0 = overlay.points[0];
      const p1 = overlay.points[1];
      if (p0?.value === undefined || p1?.value === undefined) return [];
      const precision = chart.getSymbol?.()?.pricePrecision ?? 2;
      const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
      const settings = readPositionSettings(ext);
      const posRR =
        typeof ext.posRR === 'number' && ext.posRR > 0 ? ext.posRR : 2;
      const entry = p0.value;
      const stopRaw = p1.value;
      const risk = Math.abs(entry - stopRaw);
      if (risk <= 0) return [];
      // The stop may never cross the entry line: a long's stop sits
      // below the entry, a short's above. A stop placed or dragged
      // onto the wrong side is mirrored to the correct side at the
      // same distance, and written back so the point, the drag
      // handle, the axis marks and persistence all converge on the
      // corrected stop. (The write-back takes effect on the next
      // render; the draw-end normaliser in the controller corrects
      // the committed points immediately, so a freshly drawn
      // position is never left with a raw stop.)
      const stop = mirrorPositionStop(isLong, entry, stopRaw);
      if (stop !== stopRaw) {
        p1.value = stop;
      }
      // The target is the 3rd point when present; legacy 2-point
      // saves derive it from posRR. A target on the loss side is
      // mirrored to the profit side at the same distance, and its
      // timestamp is kept on the stop's — the target is a price
      // level on the box's right edge, so a horizontal drag snaps
      // back on the next render.
      let target: number;
      let rr: number;
      const p2 = overlay.points[2];
      if (p2?.value !== undefined) {
        const targetRaw = p2.value;
        target = mirrorPositionTarget(isLong, entry, targetRaw);
        if (target !== targetRaw) {
          p2.value = target;
        }
        if (p2.timestamp !== p1.timestamp) {
          p2.timestamp = p1.timestamp;
        }
        rr = Math.abs(target - entry) / risk;
      } else {
        target = isLong ? entry + posRR * risk : entry - posRR * risk;
        rr = posRR;
      }
      const entryY = coordinates[0].y;
      // Pixel y of the (possibly mirrored) stop: mirror the raw stop
      // pixel across the entry line to match the corrected value.
      const stopY =
        stop !== stopRaw ? 2 * entryY - coordinates[1].y : coordinates[1].y;
      // Pixel y for a price, linearly interpolated/extrapolated from
      // the entry→stop segment (works whichever side stop is on).
      const yFor = (price: number) =>
        entryY + ((entry - price) / (entry - stop)) * (stopY - entryY);
      const tpY = yFor(target);
      const xs = coordinates.map((c) => c.x);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const w = Math.max(1, x1 - x0);
      const profitTop = Math.min(entryY, tpY);
      const profitH = Math.max(1, Math.abs(tpY - entryY));
      const riskTop = Math.min(entryY, stopY);
      const riskH = Math.max(1, Math.abs(stopY - entryY));
      const lineColor = overlay.styles?.line?.color ?? '#2962ff';
      const profitColor = settings.posProfitColor;
      const riskColor = settings.posRiskColor;
      const textSize = settings.posTextSize;
      const fmt = (v: number) => v.toFixed(precision);
      const figures: Array<Record<string, unknown>> = [
        {
          type: 'rect',
          attrs: { x: x0, y: profitTop, width: w, height: profitH },
          styles: {
            style: 'stroke_fill',
            color: hexToRgba(profitColor, 0.12),
            borderColor: profitColor,
            borderSize: 1,
            borderStyle: 'solid',
          },
        },
        {
          type: 'rect',
          attrs: { x: x0, y: riskTop, width: w, height: riskH },
          styles: {
            style: 'stroke_fill',
            color: hexToRgba(riskColor, 0.12),
            borderColor: riskColor,
            borderSize: 1,
            borderStyle: 'solid',
          },
        },
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: x0, y: entryY },
              { x: x1, y: entryY },
            ],
          },
          styles: { color: lineColor, size: 1, style: 'dashed' },
        },
      ];
      const tpText: OverlayTextLike = {
        content: `TP ${fmt(target)}\n+${rr.toFixed(2)}R`,
        color: profitColor,
        size: textSize,
        bold: true,
        alignH: 'right',
        alignV: 'middle',
      };
      const slText: OverlayTextLike = {
        content: `SL ${fmt(stop)}\n-1.00R`,
        color: riskColor,
        size: textSize,
        bold: true,
        alignH: 'right',
        alignV: 'middle',
      };
      const entryText: OverlayTextLike = {
        content: `入場 ${fmt(entry)}`,
        color: '#d1d4dc',
        size: textSize,
        alignH: 'left',
        alignV: 'middle',
      };
      figures.push(
        ...textFigures(tpText.content, x1 - 6, profitTop + profitH / 2, tpText),
        ...textFigures(slText.content, x1 - 6, riskTop + riskH / 2, slText),
        ...textFigures(entryText.content, x0 + 6, entryY, entryText),
      );
      // ---- stats (TV position calculation) ----
      let lastClose: number | null = null;
      try {
        const data = chart.getDataList() ?? [];
        const last = data[data.length - 1];
        if (typeof last?.close === 'number') lastClose = last.close;
      } catch {
        lastClose = null;
      }
      const calc = calcPosition(
        settings,
        isLong,
        entry,
        stop,
        target,
        lastClose,
      );
      const fmtMoney = (v: number) =>
        `$${Math.abs(v).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      const fmtSignedMoney = (v: number) =>
        `${v < 0 ? '-' : '+'}${fmtMoney(v)}`;
      const fmtPct = (v: number) =>
        `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
      const qtyText = calc.qty.toFixed(settings.posQtyPrecision);
      if (!settings.posShowStats) {
        // Compact R:R + Qty label at the entry line (right end);
        // the full pill stays hidden until the user turns stats on.
        const midText: OverlayTextLike = {
          content: `R:R ${rr.toFixed(2)} · 數量 ${qtyText}`,
          color: '#d1d4dc',
          size: textSize,
          bold: true,
          alignH: 'right',
          alignV: 'middle',
        };
        figures.push(
          ...textFigures(midText.content, x1 - 6, entryY, midText),
        );
        return figures as never;
      }
      // Pill lines (text + per-line colour). The stats preset trims
      // the list; compact mode shows quantity + R:R + TP/SL P&L only.
      type PillLine = { text: string; color: string };
      const tpLine: PillLine = {
        text: `TP ${fmtSignedMoney(calc.pnlTp)} (${fmtPct(calc.pctTp)})`,
        color: profitColor,
      };
      const slLine: PillLine = {
        text: `SL ${fmtSignedMoney(calc.pnlSl)} (${fmtPct(calc.pctSl)})`,
        color: riskColor,
      };
      let pillLines: PillLine[];
      if (settings.posCompact) {
        pillLines = [
          { text: `數量 ${qtyText} · R:R ${rr.toFixed(2)}`, color: '#d1d4dc' },
          {
            text: `TP ${fmtSignedMoney(calc.pnlTp)} / SL ${fmtSignedMoney(calc.pnlSl)}`,
            color: '#d1d4dc',
          },
        ];
      } else if (settings.posStats === 'qty-pnl') {
        pillLines = [
          { text: `數量 ${qtyText}`, color: '#d1d4dc' },
          tpLine,
          slLine,
          { text: `R:R ${rr.toFixed(2)}`, color: '#d1d4dc' },
        ];
      } else if (settings.posStats === 'balance') {
        pillLines = [
          { text: `數量 ${qtyText}`, color: '#d1d4dc' },
          {
            text: `TP 後帳戶 ${fmtMoney(calc.balanceTp)}`,
            color: '#d1d4dc',
          },
          {
            text: `SL 後帳戶 ${fmtMoney(calc.balanceSl)}`,
            color: '#d1d4dc',
          },
          { text: `R:R ${rr.toFixed(2)}`, color: '#d1d4dc' },
        ];
      } else {
        pillLines = [
          { text: `數量 ${qtyText}`, color: '#d1d4dc' },
          tpLine,
          slLine,
          {
            text: `TP 後帳戶 ${fmtMoney(calc.balanceTp)}`,
            color: '#d1d4dc',
          },
          {
            text: `SL 後帳戶 ${fmtMoney(calc.balanceSl)}`,
            color: '#d1d4dc',
          },
          { text: `R:R ${rr.toFixed(2)}`, color: '#d1d4dc' },
        ];
        if (calc.openPnl !== null && calc.openPct !== null) {
          pillLines.push({
            text: `開倉損益 ${fmtSignedMoney(calc.openPnl)} (${fmtPct(calc.openPct)})`,
            color: calc.openPnl >= 0 ? profitColor : riskColor,
          });
        }
      }
      // Pill geometry: right of the box, centred on the entry line;
      // flip to the left when it would run off the pane.
      const lh = Math.round(textSize * 1.4);
      const pad = 6;
      const pillW =
        Math.max(
          ...pillLines.map((l) =>
            textNoHitWidth(l.text, textSize, 'normal'),
          ),
        ) +
        pad * 2;
      const pillH = pillLines.length * lh + pad * 2;
      let paneW: number | null = null;
      let paneH: number | null = null;
      try {
        const size = chart.getSize?.('candle_pane');
        if (size) {
          paneW = size.width;
          paneH = size.height;
        }
      } catch {
        paneW = null;
        paneH = null;
      }
      const onRight = paneW === null || x1 + 8 + pillW <= paneW - 4;
      const pillX = onRight ? x1 + 8 : x0 - 8 - pillW;
      let pillY = entryY - pillH / 2;
      if (paneH !== null) {
        pillY = Math.max(4, Math.min(pillY, paneH - pillH - 4));
      }
      figures.push({
        type: 'rect',
        attrs: { x: pillX, y: pillY, width: pillW, height: pillH },
        styles: {
          style: 'stroke_fill',
          color: 'rgba(30,34,45,0.95)',
          borderColor: '#2a2e39',
          borderSize: 1,
          borderStyle: 'solid',
        },
      });
      pillLines.forEach((line, i) => {
        const t: OverlayTextLike = {
          content: line.text,
          color: line.color,
          size: textSize,
          bold: false,
          alignH: 'left',
          alignV: 'top',
        };
        figures.push(
          ...textFigures(
            line.text,
            pillX + pad,
            pillY + pad + i * lh,
            t,
          ),
        );
      });
      return figures as never;
    };

  registerOverlay({
    name: 'longPosition',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: makeFigures(true),
  });
  registerOverlay({
    name: 'shortPosition',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: makeFigures(false),
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
    onRightClick: preventOverlayRightClickDelete,
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
    onRightClick: preventOverlayRightClickDelete,
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
    onRightClick: preventOverlayRightClickDelete,
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
        if (!fibLevelEnabledOf(overlay, i)) return;
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

/** Compact volume: 4.57 K / 1.23 M / 2.00 B (TV Date Range style). */
function formatCompactVolume(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)} K`;
  return v.toFixed(2);
}

let measureRegistered = false;

/**
 * Register the custom "measure" overlay once per page load.
 * TV Date Range look: two points -> one blue rect + two direction
 * arrows crossing at the rect centre (vertical at the centre x,
 * horizontal at the centre y; heads point from the start toward
 * the end: down/up for the price move, right/left for time) + a
 * dark stats box below the rect (above it when there is no room
 * below): price change, percent, ticks, candle count, calendar
 * days, summed volume. Never persisted (Chart.tsx filters it out
 * of saves); Esc or clicking empty space removes it. Candle count
 * uses extendData.intervalMs (ms per candle); ticks assume one
 * tick = 10^-pricePrecision (the symbol info has no tickSize).
 */
export function registerMeasureOverlay(): void {
  if (measureRegistered) return;
  measureRegistered = true;

  registerOverlay({
    name: 'measure',
    onRightClick: preventOverlayRightClickDelete,
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
      // TV Date Range is blue; the colour comes from the overlay
      // itself (default #2962ff) so the edit bar can change it.
      const color = overlay.styles?.line?.color ?? '#2962ff';
      const [a, b] = coordinates;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      const diff = p1.value - p0.value;
      const pct = p0.value !== 0 ? (diff / p0.value) * 100 : 0;
      const sign = diff >= 0 ? '+' : '';
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const fmt = (v: number) =>
        v.toLocaleString('en-US', {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision,
        });
      const ticks = Math.round(diff / Math.pow(10, -precision));
      const ticksText =
        ticks >= 0
          ? `+${ticks.toLocaleString('en-US')}`
          : ticks.toLocaleString('en-US');
      const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
      const intervalMs =
        typeof ext.intervalMs === 'number' ? ext.intervalMs : 0;
      const bars =
        intervalMs > 0
          ? Math.round(
              Math.abs(p1.timestamp - p0.timestamp) / intervalMs,
            ) + 1
          : 0;
      // Calendar days, inclusive (93 daily bars span 93 days).
      const days =
        Math.floor(Math.abs(p1.timestamp - p0.timestamp) / 86400000) + 1;
      // Summed volume over the bars inside the range (inclusive).
      let volume: number | null = null;
      try {
        const data = chart.getDataList() ?? [];
        const lo = Math.min(p0.timestamp, p1.timestamp);
        const hi = Math.max(p0.timestamp, p1.timestamp);
        let sum = 0;
        let n = 0;
        for (const d of data) {
          if (d.timestamp >= lo && d.timestamp <= hi) {
            sum += d.volume ?? 0;
            n++;
          }
        }
        volume = n > 0 ? sum : null;
      } catch {
        volume = null;
      }
      const textLines = [
        `${sign}${fmt(diff)} (${sign}${pct.toFixed(2)}%) ${ticksText}`,
        bars > 0 ? `${bars}根K棒， ${days}日` : `${days}日`,
        ...(volume !== null
          ? [`成交量 ${formatCompactVolume(volume)}`]
          : []),
      ];
      const figures: Array<Record<string, unknown>> = [
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
      ];
      // Direction arrows crossing at the rect centre.
      const cx = x + width / 2;
      const cy = y + height / 2;
      if (height > 0 && diff !== 0) {
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [
              { x: cx, y },
              { x: cx, y: y + height },
            ],
          },
          styles: { color, size: 2, style: 'solid' },
        });
        const down = diff < 0;
        const hy = down ? y + height : y;
        const back = down ? -7 : 7;
        figures.push({
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: cx - 4.5, y: hy + back },
              { x: cx + 4.5, y: hy + back },
              { x: cx, y: hy },
            ],
          },
          styles: { style: 'fill', color },
        });
      }
      if (width > 0 && p1.timestamp !== p0.timestamp) {
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [
              { x, y: cy },
              { x: x + width, y: cy },
            ],
          },
          styles: { color, size: 2, style: 'solid' },
        });
        const right = p1.timestamp > p0.timestamp;
        const hx = right ? x + width : x;
        const back = right ? -7 : 7;
        figures.push({
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: hx + back, y: cy - 4.5 },
              { x: hx + back, y: cy + 4.5 },
              { x: hx, y: cy },
            ],
          },
          styles: { style: 'fill', color },
        });
      }
      // Dark stats box below the rect (above it when there is no
      // room below), left-aligned with the rect.
      const fontSize = 12;
      const lineH = 14;
      const padX = 8;
      const padY = 6;
      const boxW =
        Math.max(
          ...textLines.map((t) => textNoHitWidth(t, fontSize, 'normal')),
        ) +
        padX * 2;
      const boxH = textLines.length * lineH + padY * 2;
      const paneH = chart.getSize('candle_pane')?.height ?? null;
      const belowY = y + height + 6;
      const boxY =
        paneH !== null && belowY + boxH > paneH ? y - 6 - boxH : belowY;
      figures.push({
        type: 'rect',
        attrs: { x, y: boxY, width: boxW, height: boxH },
        styles: {
          style: 'fill',
          color: 'rgba(30, 34, 45, 0.95)',
        },
      });
      figures.push({
        type: 'text',
        isCheckEvent: false,
        attrs: textLines.map((text, i) => ({
          x: x + padX,
          y: boxY + padY + i * lineH,
          text,
          baseline: 'top',
        })),
        styles: { color: '#d1d4dc' },
      });
      return figures as never;
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
 *  optional fill at extendData.fillOpacity. A second 'line' figure
 *  traces the same border: the polygon's hit test is pure
 *  point-in-polygon with zero tolerance, so a click exactly on the
 *  border (e.g. a triangle edge midpoint) is a ray-casting coin flip
 *  and misses, while the line figure's hit test carries the
 *  library's ±2px DEVIATION. Same colour/size/style, so the extra
 *  figure is visually identical — it only widens the hit target. */
function geomPolygonFigure(
  coordinates: Array<{ x: number; y: number }>,
  overlay: Overlay,
): Array<Record<string, unknown>> {
  const line = geomLineStyle(overlay);
  const { fill, fillOpacity } = geomFillOf(overlay);
  return [
    {
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
    },
    {
      type: 'line',
      attrs: { coordinates: [...coordinates, coordinates[0]] },
      styles: geomLineFigureStyles(line),
    },
  ];
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
    onRightClick: preventOverlayRightClickDelete,
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
      return geomPolygonFigure(
        sampleEllipsePoints((a.x + b.x) / 2, (a.y + b.y) / 2, rx, ry),
        overlay,
      ) as never;
    },
  });

  registerOverlay({
    name: 'triangle',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 3) return [];
      return geomPolygonFigure(coordinates.slice(0, 3), overlay) as never;
    },
  });

  registerOverlay({
    name: 'arc',
    onRightClick: preventOverlayRightClickDelete,
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
    onRightClick: preventOverlayRightClickDelete,
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
    onRightClick: preventOverlayRightClickDelete,
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
    onRightClick: preventOverlayRightClickDelete,
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
    onRightClick: preventOverlayRightClickDelete,
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

// ---- fibonacci tools batch (TV-only tools) ------------------------------

/**
 * Fibonacci tools: the retracement plus 6 TV-only tools, all custom
 * overlays (klinecharts has no built-ins for them). They share the
 * level options in extendData:
 *   levels      -> number[] (ratios, or fib sequence numbers for
 *                  fibTimeZones); extendData.levels overrides the
 *                  per-tool default below
 *   levelColors -> per-level line colours (fallback: FIB_LEVEL_COLORS)
 *   fibExtend   -> 'left' | 'right' | 'both' (channel / fan only;
 *                  fan defaults to 'right', the rest to 'both')
 *   fibLevelText -> show the level labels (default true)
 * Levels are data-space ratios: a level r of a price move dv = v1-v0
 * sits at v0 + r*dv. All geometry is computed in pixel space from
 * `coordinates` (the overlay's pixel points), so a saved overlay
 * restores correctly on any symbol / interval.
 */

/** Default levels per fib tool. */
export const FIB_CHANNEL_LEVELS = [
  0, 0.382, 0.5, 0.618, 1, 1.618, 2.618, 3.618, 4.236,
];
export const FIB_TIMEZONE_LEVELS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
export const FIB_FAN_LEVELS = [0, 0.382, 0.5, 0.618, 1];
export const FIB_ARC_LEVELS = [0.382, 0.5, 0.618, 1, 1.618];
export const FIB_WEDGE_LEVELS = [0, 0.382, 0.5, 0.618, 1];

/** The fib family: retracement + the 6 new tools. */
export const FIB_TOOL_NAMES: ReadonlySet<string> = new Set([
  'fibonacciRetracement',
  'fibChannel',
  'fibTimeZones',
  'fibFan',
  'fibArc',
  'fibSpiral',
  'fibWedge',
]);

export function isFibTool(name: string): boolean {
  return FIB_TOOL_NAMES.has(name);
}

/** Position tools (long/short): entry + stop points, TP derived at
 *  extendData.posRR (default 2, i.e. 1:2R). */
export const POSITION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'longPosition',
  'shortPosition',
]);

export function isPositionTool(name: string): boolean {
  return POSITION_TOOL_NAMES.has(name);
}

/** Whether the tool has editable levels (all fib tools except the
 *  spiral, whose shape is a single curve). */
export function fibHasLevels(name: string): boolean {
  return isFibTool(name) && name !== 'fibSpiral';
}

export function fibDefaultLevels(name: string): number[] {
  switch (name) {
    case 'fibChannel':
      return FIB_CHANNEL_LEVELS;
    case 'fibTimeZones':
      return FIB_TIMEZONE_LEVELS;
    case 'fibFan':
      return FIB_FAN_LEVELS;
    case 'fibArc':
      return FIB_ARC_LEVELS;
    case 'fibWedge':
      return FIB_WEDGE_LEVELS;
    default:
      return FIB_LEVELS;
  }
}

/** Levels for one fib overlay: extendData.levels when it is a
 *  non-empty finite-number array, else the tool's default. */
export function fibLevelsOf(
  overlay: { extendData?: unknown },
  name?: string,
): number[] {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  if (Array.isArray(ext.levels)) {
    const list = (ext.levels as unknown[]).filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    if (list.length > 0) return list;
  }
  return fibDefaultLevels(
    name ?? (overlay as { name?: string }).name ?? '',
  );
}

/** Per-level line colour: extendData.levelColors[i], else the shared
 *  FIB_LEVEL_COLORS cycle (same fallback as the retracement). */
export function fibLevelColorOf(
  overlay: { extendData?: unknown },
  i: number,
): string {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  const colors = Array.isArray(ext.levelColors)
    ? (ext.levelColors as unknown[])
    : [];
  return typeof colors[i] === 'string'
    ? (colors[i] as string)
    : FIB_LEVEL_COLORS[i % FIB_LEVEL_COLORS.length];
}

/** Level labels on/off (default true). */
export function fibLevelTextOf(overlay: { extendData?: unknown }): boolean {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  return ext.fibLevelText !== false;
}

/**
 * Per-level on/off for the fib level rows (dialog toggle). The flags
 * live in extendData.levelEnabled, parallel to levels: a missing /
 * non-boolean entry means enabled, so old saves draw every level. A
 * disabled level keeps its value AND its colour (same index) — only
 * the line is not drawn — so toggling never re-maps the other
 * levels' colours.
 */
export function fibLevelEnabledOf(
  overlay: { extendData?: unknown },
  i: number,
): boolean {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  const list = Array.isArray(ext.levelEnabled)
    ? (ext.levelEnabled as unknown[])
    : [];
  return list[i] !== false;
}

/** Level-line horizontal extent (channel / fan). Fan defaults to
 *  'right' (rays run forward in time); the rest default to 'both'. */
export function fibExtendOf(
  overlay: { extendData?: unknown },
  name: string,
): 'left' | 'right' | 'both' {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  if (ext.fibExtend === 'left' || ext.fibExtend === 'right')
    return ext.fibExtend;
  return name === 'fibFan' ? 'right' : 'both';
}

type FibPt = { x: number; y: number };

/** 'line' figure styles for one fib level: the level colour, the
 *  overlay's width / dash. */
function fibLineFigureStyles(
  overlay: Overlay,
  color: string,
): Record<string, unknown> {
  const line = geomLineStyle(overlay);
  return geomLineFigureStyles({ ...line, color });
}

/** Non-hittable level label (same shape as the retracement's labels:
 *  built-in 'text' figure, isCheckEvent false — a click on a label
 *  still selects the overlay, it just never steals a drag). */
function fibLevelLabel(
  x: number,
  y: number,
  text: string,
  color: string,
): Record<string, unknown> {
  return {
    type: 'text',
    isCheckEvent: false,
    attrs: [{ x, y, text, baseline: 'bottom' }],
    styles: { color },
  };
}

/** Horizontal span of level lines for a fibExtend option, from the
 *  two anchor pixels (same convention as the retracement). */
function fibXSpan(
  x0: number,
  x1: number,
  width: number,
  extend: 'left' | 'right' | 'both',
): { xStart: number; xEnd: number } {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  return {
    xStart: extend === 'right' ? minX : 0,
    xEnd: extend === 'left' ? maxX : width,
  };
}

/** Line figure through two pixel points, extended horizontally to
 *  [xStart, xEnd] along the line's slope (the channel / fan
 *  pattern). Falls back to the raw segment for a (near-)vertical
 *  line, which has no slope to extend along. */
function fibExtendedLineFigure(
  a: FibPt,
  b: FibPt,
  xStart: number,
  xEnd: number,
  styles: Record<string, unknown>,
): Record<string, unknown> {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) {
    return { type: 'line', attrs: { coordinates: [a, b] }, styles };
  }
  const m = (b.y - a.y) / dx;
  const yAt = (x: number) => a.y + m * (x - a.x);
  return {
    type: 'line',
    attrs: {
      coordinates: [
        { x: xStart, y: yAt(xStart) },
        { x: xEnd, y: yAt(xEnd) },
      ],
    },
    styles,
  };
}

/** Ray from `origin` in direction `dir` (unit vector) to the edge of
 *  the [0, width] x [0, height] box, or null when it never leaves
 *  (zero direction). Used by the wedge's boundary / ratio rays. */
function fibRayToBoxEdge(
  origin: FibPt,
  dir: FibPt,
  width: number,
  height: number,
): FibPt | null {
  let t = Infinity;
  if (dir.x > 1e-9) t = Math.min(t, (width - origin.x) / dir.x);
  else if (dir.x < -1e-9) t = Math.min(t, -origin.x / dir.x);
  if (dir.y > 1e-9) t = Math.min(t, (height - origin.y) / dir.y);
  else if (dir.y < -1e-9) t = Math.min(t, -origin.y / dir.y);
  if (!Number.isFinite(t) || t <= 0) return null;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
}

let fibonacciToolsRegistered = false;

/**
 * Register the 6 fib tools once per page load (see the section header
 * for the per-tool notes). fibChannel / fibTimeZones / fibFan /
 * fibArc / fibSpiral take 2 clicks (totalStep 3); fibWedge takes 3
 * (totalStep 4: apex + two boundary points).
 */
export function registerFibonacciToolsOverlays(): void {
  if (fibonacciToolsRegistered) return;
  fibonacciToolsRegistered = true;

  registerOverlay({
    name: 'fibChannel',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ chart, coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return [];
      const [c0, c1] = coordinates;
      const p0 = overlay.points[0];
      const p1 = overlay.points[1];
      if (p0?.value === undefined || p1?.value === undefined) return [];
      // A vertical trend has no slope to offset parallel lines along:
      // the level lines would all coincide on the trend itself.
      if (Math.abs(c1.x - c0.x) < 1) {
        return [
          {
            type: 'line',
            attrs: { coordinates: [c0, c1] },
            styles: fibLineFigureStyles(
              overlay,
              overlay.styles?.line?.color ?? '#2962ff',
            ),
          },
        ] as never;
      }
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const v0 = p0.value;
      const dv = p1.value - v0;
      const levels = fibLevelsOf(overlay, 'fibChannel');
      const extend = fibExtendOf(overlay, 'fibChannel');
      const { xStart, xEnd } = fibXSpan(
        c0.x,
        c1.x,
        bounding.width,
        extend,
      );
      const showText = fibLevelTextOf(overlay);
      const figures: Array<Record<string, unknown>> = [];
      levels.forEach((r, i) => {
        if (!fibLevelEnabledOf(overlay, i)) return;
        const color = fibLevelColorOf(overlay, i);
        // Level r shifts the trend line vertically by r * the pixel
        // price move: through (c0.x, c0.y + r*(c1.y-c0.y)) and
        // (c1.x, c1.y + r*(c1.y-c0.y)).
        const a = { x: c0.x, y: c0.y + r * (c1.y - c0.y) };
        const b = { x: c1.x, y: c1.y + r * (c1.y - c0.y) };
        figures.push(
          fibExtendedLineFigure(
            a,
            b,
            xStart,
            xEnd,
            fibLineFigureStyles(overlay, color),
          ),
        );
        if (showText) {
          // Price where the label sits: the level line's data-space
          // value at xStart (timestamp is linear in x).
          const value =
            v0 + dv * (r + (xStart - c0.x) / (c1.x - c0.x));
          const m = (b.y - a.y) / (b.x - a.x);
          figures.push(
            fibLevelLabel(
              xStart,
              a.y + m * (xStart - a.x),
              `${value.toFixed(precision)} (${(r * 100).toFixed(1)}%)`,
              color,
            ),
          );
        }
      });
      return figures as never;
    },
  });

  registerOverlay({
    name: 'fibTimeZones',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return [];
      const [c0, c1] = coordinates;
      const unit = c1.x - c0.x;
      // The two points share a timestamp: no time unit to repeat.
      if (Math.abs(unit) < 1) return [];
      const levels = fibLevelsOf(overlay, 'fibTimeZones');
      const showText = fibLevelTextOf(overlay);
      const figures: Array<Record<string, unknown>> = [];
      levels.forEach((n, i) => {
        if (!fibLevelEnabledOf(overlay, i)) return;
        const x = c0.x + n * unit;
        if (x < -1 || x > bounding.width + 1) return;
        const color = fibLevelColorOf(overlay, i);
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [
              { x, y: 0 },
              { x, y: bounding.height },
            ],
          },
          styles: fibLineFigureStyles(overlay, color),
        });
        if (showText) {
          figures.push({
            type: 'text',
            isCheckEvent: false,
            attrs: [{ x, y: 6, text: `${n}`, baseline: 'top' }],
            styles: { color },
          });
        }
      });
      return figures as never;
    },
  });

  registerOverlay({
    name: 'fibFan',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ chart, coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return [];
      const [c0, c1] = coordinates;
      const p0 = overlay.points[0];
      const p1 = overlay.points[1];
      if (p0?.value === undefined || p1?.value === undefined) return [];
      if (Math.abs(c1.x - c0.x) < 1) return [];
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const v0 = p0.value;
      const dv = p1.value - v0;
      const levels = fibLevelsOf(overlay, 'fibFan');
      const extend = fibExtendOf(overlay, 'fibFan');
      const showText = fibLevelTextOf(overlay);
      const figures: Array<Record<string, unknown>> = [];
      levels.forEach((r, i) => {
        if (!fibLevelEnabledOf(overlay, i)) return;
        const color = fibLevelColorOf(overlay, i);
        // Ray from the apex through (c1.x, c0.y + r*(c1.y-c0.y)) —
        // the point at the second anchor's time, r of the price move.
        const end = { x: c1.x, y: c0.y + r * (c1.y - c0.y) };
        const { xStart, xEnd } = fibXSpan(c0.x, end.x, bounding.width, extend);
        figures.push(
          fibExtendedLineFigure(
            c0,
            end,
            xStart,
            xEnd,
            fibLineFigureStyles(overlay, color),
          ),
        );
        if (showText) {
          figures.push(
            fibLevelLabel(
              end.x,
              end.y,
              `${(v0 + r * dv).toFixed(precision)} (${(r * 100).toFixed(1)}%)`,
              color,
            ),
          );
        }
      });
      return figures as never;
    },
  });

  registerOverlay({
    name: 'fibArc',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [c0, c1] = coordinates;
      const dist = Math.hypot(c1.x - c0.x, c1.y - c0.y);
      if (dist < 2) return [];
      // Arcs are semicircles centred on the first point, bulging to
      // the side of the trend line the retracement runs toward:
      // the sweep [trend - π, trend] passes through trend - π/2.
      const trend = Math.atan2(c1.y - c0.y, c1.x - c0.x);
      const levels = fibLevelsOf(overlay, 'fibArc');
      const showText = fibLevelTextOf(overlay);
      const figures: Array<Record<string, unknown>> = [];
      levels.forEach((r, i) => {
        if (!fibLevelEnabledOf(overlay, i)) return;
        if (r <= 0) return;
        const radius = r * dist;
        const color = fibLevelColorOf(overlay, i);
        figures.push({
          type: 'arc',
          attrs: {
            x: c0.x,
            y: c0.y,
            r: radius,
            startAngle: trend - Math.PI,
            endAngle: trend,
          },
          styles: fibLineFigureStyles(overlay, color),
        });
        if (showText) {
          const mid = trend - Math.PI / 2;
          figures.push(
            fibLevelLabel(
              c0.x + radius * Math.cos(mid),
              c0.y + radius * Math.sin(mid),
              `${(r * 100).toFixed(1)}%`,
              color,
            ),
          );
        }
      });
      return figures as never;
    },
  });

  registerOverlay({
    name: 'fibSpiral',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return [];
      const [c0, c1] = coordinates;
      const r0 = Math.hypot(c1.x - c0.x, c1.y - c0.y);
      if (r0 < 2) return [];
      // Logarithmic spiral through the second point: the radius grows
      // by the golden ratio every quarter turn (b = ln φ / (π/2)),
      // wound from the second point's direction outward until it
      // leaves the pane (at most 3 full turns).
      const phi = (1 + Math.sqrt(5)) / 2;
      const b = Math.log(phi) / (Math.PI / 2);
      const a0 = Math.atan2(c1.y - c0.y, c1.x - c0.x);
      const maxR = Math.hypot(bounding.width, bounding.height);
      const pts: Array<{ x: number; y: number }> = [];
      const step = 0.05;
      for (let th = 0; th <= Math.PI * 6; th += step) {
        const r = r0 * Math.exp(b * th);
        if (r > maxR) break;
        pts.push({
          x: c0.x + r * Math.cos(a0 + th),
          y: c0.y + r * Math.sin(a0 + th),
        });
      }
      if (pts.length < 2) return [];
      return [
        {
          type: 'line',
          attrs: { coordinates: pts },
          styles: fibLineFigureStyles(
            overlay,
            overlay.styles?.line?.color ?? '#2962ff',
          ),
        },
      ] as never;
    },
  });

  registerOverlay({
    name: 'fibWedge',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 3) return [];
      const [a, b, c] = coordinates;
      const d1 = { x: b.x - a.x, y: b.y - a.y };
      const d2 = { x: c.x - a.x, y: c.y - a.y };
      const len1 = Math.hypot(d1.x, d1.y);
      const len2 = Math.hypot(d2.x, d2.y);
      if (len1 < 2 || len2 < 2) return [];
      // Intermediate rays split the (short-way) angle between the
      // two boundary directions at the fib ratios.
      const a1 = Math.atan2(d1.y, d1.x);
      const a2 = Math.atan2(d2.y, d2.x);
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff <= -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 1e-6) return [];
      const levels = fibLevelsOf(overlay, 'fibWedge');
      const showText = fibLevelTextOf(overlay);
      const figures: Array<Record<string, unknown>> = [];
      levels.forEach((r, i) => {
        if (!fibLevelEnabledOf(overlay, i)) return;
        const color = fibLevelColorOf(overlay, i);
        const angle = a1 + r * diff;
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const end = fibRayToBoxEdge(a, dir, bounding.width, bounding.height);
        if (!end) return;
        figures.push({
          type: 'line',
          attrs: { coordinates: [a, end] },
          styles: fibLineFigureStyles(overlay, color),
        });
        if (showText) {
          figures.push(
            fibLevelLabel(end.x, end.y, `${(r * 100).toFixed(1)}%`, color),
          );
        }
      });
      return figures as never;
    },
  });
}

// ---- pitchfork batch (TV-only tools) ------------------------------------

/**
 * Pitchfork tools: 4 TV-only tools, all custom overlays (klinecharts
 * has no built-ins for them). Three anchor points (P0, P1, P2):
 *   pitchfork               -> median from P0 through the midpoint M
 *                              of P1-P2; outer lines through P1 and
 *                              P2, parallel to the median
 *   schiffPitchfork         -> median origin at the midpoint of P0
 *                              and M (50% from P0 toward M)
 *   modifiedSchiffPitchfork -> median origin at 25% from P0 toward
 *                              M (halfway between P0 and the Schiff
 *                              origin)
 *   insidePitchfork         -> median origin at M itself; P0 only
 *                              sets the direction
 * All three lines run in the median direction and extend per
 * extendData.pitchExtend ('none' | 'right' | 'both', default
 * 'right'). Options in extendData: showMedian (default true),
 * showOuter (default true), medianBold (default false — the median
 * is drawn one size thicker). All lines use the overlay's main line
 * colour, so the floating bar's colour pick applies directly.
 */

/** The pitchfork family. */
export const PITCHFORK_TOOL_NAMES: ReadonlySet<string> = new Set([
  'pitchfork',
  'schiffPitchfork',
  'modifiedSchiffPitchfork',
  'insidePitchfork',
]);

export function isPitchforkTool(name: string): boolean {
  return PITCHFORK_TOOL_NAMES.has(name);
}

/** Line extension for a pitchfork ('none' | 'right' | 'both'). */
export function pitchExtendOf(overlay: {
  extendData?: unknown;
}): 'none' | 'right' | 'both' {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  if (ext.pitchExtend === 'none' || ext.pitchExtend === 'both')
    return ext.pitchExtend;
  return 'right';
}

/** Median / outer visibility + median bold, from extendData. */
export function pitchOptionsOf(overlay: {
  extendData?: unknown;
}): { showMedian: boolean; showOuter: boolean; medianBold: boolean } {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  return {
    showMedian: ext.showMedian !== false,
    showOuter: ext.showOuter !== false,
    medianBold: ext.medianBold === true,
  };
}

type PitchPt = { x: number; y: number };

/**
 * Median + outer lines of a pitchfork in pixel space, from the three
 * anchor pixels. Returns null when P0 and M coincide (no direction).
 * Each entry is { start, end } in natural (unextended) length: the
 * median runs S -> M (inside: M -> M + d*|M-P0|), each outer runs
 * A -> A + d*((M-A)·d), i.e. to M's position along the median
 * direction. Extension is applied by the caller via
 * fibExtendedLineFigure with the pitchExtend x-span.
 */
function pitchforkLines(
  p0: PitchPt,
  p1: PitchPt,
  p2: PitchPt,
  name: string,
): {
  median: { start: PitchPt; end: PitchPt };
  outers: Array<{ start: PitchPt; end: PitchPt }>;
} | null {
  const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dx = m.x - p0.x;
  const dy = m.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return null;
  const d = { x: dx / len, y: dy / len };
  let s: PitchPt;
  let medianEnd: PitchPt;
  if (name === 'schiffPitchfork') {
    s = { x: p0.x + dx * 0.5, y: p0.y + dy * 0.5 };
    medianEnd = m;
  } else if (name === 'modifiedSchiffPitchfork') {
    s = { x: p0.x + dx * 0.25, y: p0.y + dy * 0.25 };
    medianEnd = m;
  } else if (name === 'insidePitchfork') {
    s = m;
    medianEnd = { x: m.x + d.x * len, y: m.y + d.y * len };
  } else {
    s = p0;
    medianEnd = m;
  }
  const outerEnd = (a: PitchPt): PitchPt => {
    const t = (m.x - a.x) * d.x + (m.y - a.y) * d.y;
    return { x: a.x + d.x * t, y: a.y + d.y * t };
  };
  return {
    median: { start: s, end: medianEnd },
    outers: [
      { start: p1, end: outerEnd(p1) },
      { start: p2, end: outerEnd(p2) },
    ],
  };
}

/** Horizontal span for one pitchfork line: 'none' keeps the natural
 *  segment, 'right'/'both' extend along the slope like the fib
 *  tools (fibXSpan). */
function pitchXSpan(
  a: PitchPt,
  b: PitchPt,
  width: number,
  extend: 'none' | 'right' | 'both',
): { xStart: number; xEnd: number } {
  if (extend === 'none') {
    return { xStart: Math.min(a.x, b.x), xEnd: Math.max(a.x, b.x) };
  }
  return fibXSpan(a.x, b.x, width, extend);
}

let pitchforkRegistered = false;

/**
 * Register the 4 pitchfork overlays once per page load (see the
 * section header). All take 3 clicks (totalStep 4): P0, P1, P2.
 * The median + outer lines are 'line' figures, so they carry the
 * library's ±2px hit test; the three anchor points are the default
 * point figures, draggable while selected.
 */
export function registerPitchforkOverlays(): void {
  if (pitchforkRegistered) return;
  pitchforkRegistered = true;

  const names = [
    'pitchfork',
    'schiffPitchfork',
    'modifiedSchiffPitchfork',
    'insidePitchfork',
  ] as const;
  names.forEach((name) => {
    registerOverlay({
      name,
      onRightClick: preventOverlayRightClickDelete,
      totalStep: 4,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates, bounding, overlay }) => {
        if (coordinates.length < 3) return [];
        const [p0, p1, p2] = coordinates;
        const line = geomLineStyle(overlay);
        const lines = pitchforkLines(p0, p1, p2, name);
        if (!lines) {
          // No median direction (P0 sits on the P1-P2 midpoint):
          // draw the P1-P2 segment so the drawing stays visible.
          return [
            {
              type: 'line',
              attrs: { coordinates: [p1, p2] },
              styles: geomLineFigureStyles(line),
            },
          ] as never;
        }
        const { showMedian, showOuter, medianBold } =
          pitchOptionsOf(overlay);
        const extend = pitchExtendOf(overlay);
        const medianStyles = geomLineFigureStyles(
          medianBold ? { ...line, size: line.size + 1 } : line,
        );
        const outerStyles = geomLineFigureStyles(line);
        const figures: Array<Record<string, unknown>> = [];
        if (showMedian) {
          const span = pitchXSpan(
            lines.median.start,
            lines.median.end,
            bounding.width,
            extend,
          );
          figures.push(
            fibExtendedLineFigure(
              lines.median.start,
              lines.median.end,
              span.xStart,
              span.xEnd,
              medianStyles,
            ),
          );
        }
        if (showOuter) {
          for (const o of lines.outers) {
            const span = pitchXSpan(
              o.start,
              o.end,
              bounding.width,
              extend,
            );
            figures.push(
              fibExtendedLineFigure(
                o.start,
                o.end,
                span.xStart,
                span.xEnd,
                outerStyles,
              ),
            );
          }
        }
        return figures as never;
      },
    });
  });
}

// ---- gann batch (TV-only tools) ------------------------------------

/**
 * Gann tools: 3 TV-only tools, all custom overlays (klinecharts has
 * no built-ins for them). All geometry is computed in pixel space
 * from `coordinates`, so a saved overlay restores correctly on any
 * symbol / interval.
 *   gannFan    -> 2 points (anchor + direction point). The P0->P1
 *                 line IS the 1x1 line; the other 6 angle lines are
 *                 rays from P0 whose pixel slope is k * the 1x1
 *                 pixel slope (k = 1/8, 1/4, 1/2, 2, 4, 8), so the
 *                 fan is exact in data space (price per bar) whatever
 *                 the axis scale is. Extendable right / both.
 *   gannSquare -> 2 points (opposite corners of the box), 4x4 grid
 *                 (default) + diagonals + price / date scale labels.
 *   gannBox    -> 2 points (opposite corners), 3x3 grid (default) +
 *                 diagonals + centre midlines + scale labels.
 * Options in extendData:
 *   gannExtend        -> 'none' | 'right' | 'both' (fan only,
 *                        default 'right')
 *   gannAnglesEnabled -> boolean[7] parallel to GANN_FAN_ANGLES
 *                        (missing / non-boolean = enabled, so old
 *                        saves draw every angle)
 *   gannMainBold      -> the 1x1 line is drawn one size thicker
 *                        (default false)
 *   gannAngleText     -> show the angle + price labels (default true)
 *   gannGrid          -> grid divisions per side, 1-8 (square
 *                        default 4, box default 3)
 *   gannShowDiagonal  -> draw both diagonals (default true)
 *   gannShowMidlines  -> draw the centre cross (box default true,
 *                        square default false)
 *   gannShowLabels    -> price labels on the left edge + date labels
 *                        along the bottom (default true)
 * All lines use the overlay's main line colour, so the floating
 * bar's colour pick applies directly.
 */

/** The Gann fan's 7 angle lines: label + slope ratio vs the 1x1 line. */
export const GANN_FAN_ANGLES: ReadonlyArray<{
  label: string;
  ratio: number;
}> = [
  { label: '1x8', ratio: 1 / 8 },
  { label: '1x4', ratio: 1 / 4 },
  { label: '1x2', ratio: 1 / 2 },
  { label: '1x1', ratio: 1 },
  { label: '2x1', ratio: 2 },
  { label: '4x1', ratio: 4 },
  { label: '8x1', ratio: 8 },
];

/** The Gann family. */
export const GANN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'gannFan',
  'gannSquare',
  'gannBox',
]);

export function isGannTool(name: string): boolean {
  return GANN_TOOL_NAMES.has(name);
}

/** Default grid divisions per side: square 4x4, box 3x3. */
export function gannDefaultGrid(name: string): number {
  return name === 'gannBox' ? 3 : 4;
}

/** Line extension for the fan ('none' | 'right' | 'both'). */
export function gannExtendOf(overlay: {
  extendData?: unknown;
}): 'none' | 'right' | 'both' {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  if (ext.gannExtend === 'none' || ext.gannExtend === 'both')
    return ext.gannExtend;
  return 'right';
}

export interface GannOptions {
  /** Per-angle on/off, parallel to GANN_FAN_ANGLES. */
  anglesEnabled: boolean[];
  mainBold: boolean;
  angleText: boolean;
  /** Grid divisions per side (square / box). */
  grid: number;
  showDiagonal: boolean;
  showMidlines: boolean;
  showLabels: boolean;
}

/** All Gann options from extendData, with per-tool defaults. */
export function gannOptionsOf(
  overlay: { extendData?: unknown },
  name: string,
): GannOptions {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  const enabled = Array.isArray(ext.gannAnglesEnabled)
    ? (ext.gannAnglesEnabled as unknown[])
    : [];
  const grid =
    typeof ext.gannGrid === 'number' &&
    Number.isFinite(ext.gannGrid) &&
    ext.gannGrid >= 1 &&
    ext.gannGrid <= 8
      ? Math.floor(ext.gannGrid)
      : gannDefaultGrid(name);
  return {
    anglesEnabled: GANN_FAN_ANGLES.map((_, i) => enabled[i] !== false),
    mainBold: ext.gannMainBold === true,
    angleText: ext.gannAngleText !== false,
    grid,
    showDiagonal: ext.gannShowDiagonal !== false,
    showMidlines:
      ext.gannShowMidlines === true ||
      (ext.gannShowMidlines !== false && name === 'gannBox'),
    showLabels: ext.gannShowLabels !== false,
  };
}

type GannPt = { x: number; y: number };

/** Non-hittable angle label for the fan (the registered 'textNoHit'
 *  figure: unlike the built-in 'text' figure, it draws no background
 *  chip when backgroundColor is unset — the built-in paints the
 *  label's rect in the overlay's line colour — and its checkEventOn
 *  is false, so clicks pass through to the drawing underneath). */
function gannAngleLabel(
  x: number,
  y: number,
  text: string,
  color: string,
): Record<string, unknown> {
  return {
    type: 'textNoHit',
    attrs: [{ x, y, text, baseline: 'bottom' }],
    styles: { color },
  };
}

/**
 * Border + grid + diagonals + midlines + scale labels for a Gann
 * square / box, from the two opposite-corner pixels. Returns [] when
 * the box is degenerate (under 2px on a side). The price at a
 * horizontal grid row and the date at a vertical grid column are
 * interpolated linearly between the two anchor data points, so the
 * labels stay correct after a restore on any symbol / interval.
 */
function gannGridFigures(
  chart: Chart,
  coordinates: Array<GannPt>,
  overlay: Overlay,
  name: string,
): Array<Record<string, unknown>> {
  if (coordinates.length < 2) return [];
  const [c0, c1] = coordinates;
  const p0 = overlay.points[0];
  const p1 = overlay.points[1];
  if (
    p0?.value === undefined ||
    p1?.value === undefined ||
    p0?.timestamp === undefined ||
    p1?.timestamp === undefined
  )
    return [];
  const w = Math.abs(c1.x - c0.x);
  const h = Math.abs(c1.y - c0.y);
  if (w < 2 || h < 2) return [];
  const v0 = p0.value;
  const v1 = p1.value;
  const t0 = p0.timestamp;
  const t1 = p1.timestamp;
  const x0 = Math.min(c0.x, c1.x);
  const x1 = Math.max(c0.x, c1.x);
  const y0 = Math.min(c0.y, c1.y);
  const y1 = Math.max(c0.y, c1.y);
  const line = geomLineStyle(overlay);
  const styles = geomLineFigureStyles(line);
  const opts = gannOptionsOf(overlay, name);
  const n = opts.grid;
  const figures: Array<Record<string, unknown>> = [];
  // Border: the polygon figure carries the ±2px hit line, so the
  // border is clickable (the polygon's own hit test is zero-
  // tolerance on the edge).
  figures.push(
    ...geomPolygonFigure(
      [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
      overlay,
    ),
  );
  for (let i = 1; i < n; i++) {
    const x = x0 + (w * i) / n;
    figures.push({
      type: 'line',
      attrs: { coordinates: [{ x, y: y0 }, { x, y: y1 }] },
      styles,
    });
  }
  for (let i = 1; i < n; i++) {
    const y = y0 + (h * i) / n;
    figures.push({
      type: 'line',
      attrs: { coordinates: [{ x: x0, y }, { x: x1, y }] },
      styles,
    });
  }
  if (opts.showDiagonal) {
    figures.push({
      type: 'line',
      attrs: { coordinates: [{ x: x0, y: y0 }, { x: x1, y: y1 }] },
      styles,
    });
    figures.push({
      type: 'line',
      attrs: { coordinates: [{ x: x0, y: y1 }, { x: x1, y: y0 }] },
      styles,
    });
  }
  if (opts.showMidlines) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    figures.push({
      type: 'line',
      attrs: { coordinates: [{ x: mx, y: y0 }, { x: mx, y: y1 }] },
      styles,
    });
    figures.push({
      type: 'line',
      attrs: { coordinates: [{ x: x0, y: my }, { x: x1, y: my }] },
      styles,
    });
  }
  if (opts.showLabels) {
    const precision = chart.getSymbol?.()?.pricePrecision ?? 2;
    const valueAtY = (y: number) =>
      v0 + ((y - c0.y) / (c1.y - c0.y)) * (v1 - v0);
    for (let i = 0; i <= n; i++) {
      const y = y0 + (h * i) / n;
      figures.push(
        gannAngleLabel(
          x0 + 4,
          y,
          `${valueAtY(y).toFixed(precision)}`,
          line.color,
        ),
      );
    }
    const timeAtX = (x: number) =>
      t0 + ((x - c0.x) / (c1.x - c0.x)) * (t1 - t0);
    // Dates sit just BELOW the box (baseline 'top'), so the first
    // column never overlaps the bottom row's price label.
    for (let i = 0; i <= n; i++) {
      const x = x0 + (w * i) / n;
      const d = new Date(timeAtX(x));
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      figures.push({
        type: 'textNoHit',
        attrs: [{ x, y: y1 + 4, text: `${mm}/${dd}`, baseline: 'top' }],
        styles: { color: line.color },
      });
    }
  }
  return figures;
}

/** Horizontal span for one fan line: 'none' keeps the natural
 *  segment, 'right'/'both' extend along the slope like the fib
 *  tools (fibXSpan). */
function gannFanXSpan(
  a: GannPt,
  b: GannPt,
  width: number,
  extend: 'none' | 'right' | 'both',
): { xStart: number; xEnd: number } {
  if (extend === 'none') {
    return { xStart: Math.min(a.x, b.x), xEnd: Math.max(a.x, b.x) };
  }
  return fibXSpan(a.x, b.x, width, extend);
}

let gannRegistered = false;

/**
 * Register the 3 Gann overlays once per page load (see the section
 * header). All take 2 clicks (totalStep 3).
 */
export function registerGannOverlays(): void {
  if (gannRegistered) return;
  gannRegistered = true;

  registerOverlay({
    name: 'gannFan',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ chart, coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return [];
      const [c0, c1] = coordinates;
      const p0 = overlay.points[0];
      const p1 = overlay.points[1];
      if (p0?.value === undefined || p1?.value === undefined) return [];
      const line = geomLineStyle(overlay);
      // A vertical reference line has no slope to fan from: the
      // angle lines would all coincide on the reference itself.
      if (Math.abs(c1.x - c0.x) < 1) {
        return [
          {
            type: 'line',
            attrs: { coordinates: [c0, c1] },
            styles: geomLineFigureStyles(line),
          },
        ] as never;
      }
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const v0 = p0.value;
      const dv = p1.value - p0.value;
      const extend = gannExtendOf(overlay);
      const opts = gannOptionsOf(overlay, 'gannFan');
      const figures: Array<Record<string, unknown>> = [];
      GANN_FAN_ANGLES.forEach((a, i) => {
        if (!opts.anglesEnabled[i]) return;
        // Ray from the anchor through the point at the second
        // anchor's time, a.ratio of the price move — the 1x1 line
        // passes through P1 itself.
        const end = { x: c1.x, y: c0.y + a.ratio * (c1.y - c0.y) };
        const { xStart, xEnd } = gannFanXSpan(
          c0,
          end,
          bounding.width,
          extend,
        );
        const styles = geomLineFigureStyles(
          a.ratio === 1 && opts.mainBold
            ? { ...line, size: line.size + 1 }
            : line,
        );
        figures.push(
          fibExtendedLineFigure(c0, end, xStart, xEnd, styles),
        );
        if (opts.angleText) {
          figures.push(
            gannAngleLabel(
              end.x,
              end.y,
              `${a.label} ${(v0 + a.ratio * dv).toFixed(precision)}`,
              line.color,
            ),
          );
        }
      });
      return figures as never;
    },
  });

  registerOverlay({
    name: 'gannSquare',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ chart, coordinates, overlay }) =>
      gannGridFigures(chart, coordinates, overlay, 'gannSquare') as never,
  });

  registerOverlay({
    name: 'gannBox',
    onRightClick: preventOverlayRightClickDelete,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ chart, coordinates, overlay }) =>
      gannGridFigures(chart, coordinates, overlay, 'gannBox') as never,
  });
}

// ---- pattern batch (TV-only tools) ------------------------------------

/**
 * Pattern tools: 6 TV-only tools, all custom overlays (klinecharts
 * has no built-ins for them). Every one is a multi-point polyline
 * through its anchor points (pixel space) plus point labels drawn
 * with the registered 'textNoHit' figure (never hittable, no
 * background chip — the built-in 'text' figure paints the label
 * rect in the overlay's line colour, which is why Gann labels use
 * textNoHit too). Labels sit above local price highs and below
 * local price lows (pixel y grows downward), so they stay off the
 * line. The head-and-shoulders main polyline runs LS-H-RS only;
 * its neckline is a separate dashed segment through the last two
 * points. ABCD / XABCD likewise get a dashed AD / XD segment.
 * Options in extendData:
 *   patternShowLabels   -> point labels on/off (default true)
 *   patternShowNeckline -> the head-and-shoulders neckline
 *                          (default true)
 *   patternShowDashed   -> the AD / XD dashed line (default true)
 *   patternShowRatios   -> the XABCD retracement % labels at each
 *                          segment midpoint (default true)
 * All lines use the overlay's main line colour, so the floating
 * bar's colour pick applies directly. Partial coordinates (fewer
 * points than the tool takes) draw the polyline through the points
 * placed so far, so the in-progress preview works.
 */

/** The pattern family. */
export const PATTERN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'headShoulders',
  'elliottImpulse',
  'elliottCorrection',
  'abcdPattern',
  'xabcdPattern',
  'threeDrives',
]);

export function isPatternTool(name: string): boolean {
  return PATTERN_TOOL_NAMES.has(name);
}

/** Point labels, parallel to the tool's points ('' = no label). */
export const PATTERN_POINT_LABELS: Record<string, string[]> = {
  headShoulders: ['LS', 'H', 'RS', '', ''],
  elliottImpulse: ['0', '1', '2', '3', '4', '5'],
  elliottCorrection: ['0', 'A', 'B', 'C'],
  abcdPattern: ['A', 'B', 'C', 'D'],
  xabcdPattern: ['X', 'A', 'B', 'C', 'D'],
  threeDrives: ['1', '', '2', '', '3', ''],
};

/** Points the main polyline runs through (headShoulders stops at
 *  RS; the last two points are the neckline, drawn separately). */
const PATTERN_MAIN_POINT_COUNT: Record<string, number> = {
  headShoulders: 3,
};

export interface PatternOptions {
  showLabels: boolean;
  showNeckline: boolean;
  showDashed: boolean;
  showRatios: boolean;
}

/** All pattern options from extendData, with defaults. */
export function patternOptionsOf(overlay: {
  extendData?: unknown;
}): PatternOptions {
  const ext = (overlay.extendData ?? {}) as Record<string, unknown>;
  return {
    showLabels: ext.patternShowLabels !== false,
    showNeckline: ext.patternShowNeckline !== false,
    showDashed: ext.patternShowDashed !== false,
    showRatios: ext.patternShowRatios !== false,
  };
}

type PatternPt = { x: number; y: number };

/** Whether the label for point i sits below it: below a local
 *  price low (pixel y larger than both neighbours), above
 *  otherwise. Endpoints compare against their single neighbour. */
function patternLabelBelow(
  coords: Array<PatternPt>,
  i: number,
): boolean {
  const y = coords[i].y;
  const prev = i > 0 ? coords[i - 1].y : null;
  const next = i < coords.length - 1 ? coords[i + 1].y : null;
  if (prev !== null && next !== null) return y > prev && y > next;
  const other = prev ?? next;
  if (other === null) return false;
  return y > other;
}

/** One non-hittable point label, offset off the point so it does
 *  not sit on the line. */
function patternPointLabel(
  p: PatternPt,
  text: string,
  color: string,
  below: boolean,
): Record<string, unknown> {
  return {
    type: 'textNoHit',
    attrs: [
      {
        x: p.x,
        y: below ? p.y + 8 : p.y - 8,
        text,
        baseline: below ? 'top' : 'bottom',
      },
    ],
    styles: { color, size: 12, weight: 'bold' },
  };
}

/** One retracement % label at a segment midpoint (XABCD): the
 *  segment's price move as a % of the previous leg's move. */
function patternRatioLabel(
  a: PatternPt,
  b: PatternPt,
  va: number,
  vb: number,
  prevLeg: number,
  color: string,
): Record<string, unknown> | null {
  if (prevLeg <= 0) return null;
  const pct = (Math.abs(vb - va) / prevLeg) * 100;
  if (!Number.isFinite(pct)) return null;
  return {
    type: 'textNoHit',
    attrs: [
      {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2 - 8,
        text: `${pct.toFixed(1)}%`,
        baseline: 'bottom',
      },
    ],
    styles: { color, size: 11 },
  };
}

/** All figures for one pattern overlay (shared by the 6 tools). */
function patternFigures(
  coordinates: Array<PatternPt>,
  overlay: Overlay,
  name: string,
): Array<Record<string, unknown>> {
  if (coordinates.length < 2) return [];
  const line = geomLineStyle(overlay);
  const styles = geomLineFigureStyles(line);
  const opts = patternOptionsOf(overlay);
  const labels = PATTERN_POINT_LABELS[name] ?? [];
  const figures: Array<Record<string, unknown>> = [];
  // Main polyline (headShoulders: LS-H-RS only).
  const mainCount = PATTERN_MAIN_POINT_COUNT[name] ?? coordinates.length;
  figures.push({
    type: 'line',
    attrs: { coordinates: coordinates.slice(0, mainCount) },
    styles,
  });
  // Dashed extra segment: neckline (headShoulders, points 4-5) or
  // AD (abcd, points 1-4) / XD (xabcd, points 1-5).
  const dashedStyles = geomLineFigureStyles({
    ...line,
    style: 'dashed',
    dashedValue: [4, 4],
  });
  if (name === 'headShoulders' && opts.showNeckline) {
    if (coordinates.length >= 5) {
      figures.push({
        type: 'line',
        attrs: { coordinates: [coordinates[3], coordinates[4]] },
        styles: dashedStyles,
      });
    }
  } else if (name === 'abcdPattern' && opts.showDashed) {
    if (coordinates.length >= 4) {
      figures.push({
        type: 'line',
        attrs: { coordinates: [coordinates[0], coordinates[3]] },
        styles: dashedStyles,
      });
    }
  } else if (name === 'xabcdPattern' && opts.showDashed) {
    if (coordinates.length >= 5) {
      figures.push({
        type: 'line',
        attrs: { coordinates: [coordinates[0], coordinates[4]] },
        styles: dashedStyles,
      });
    }
  }
  // Point labels.
  if (opts.showLabels) {
    coordinates.forEach((p, i) => {
      const text = labels[i];
      if (!text) return;
      figures.push(
        patternPointLabel(p, text, line.color, patternLabelBelow(coordinates, i)),
      );
    });
  }
  // XABCD retracement ratios at the AB / BC / CD midpoints.
  if (name === 'xabcdPattern' && opts.showRatios) {
    const vals = overlay.points.map((p) => p.value);
    if (vals.every((v): v is number => typeof v === 'number')) {
      const legs = [1, 2, 3].map((i) => Math.abs(vals[i] - vals[i - 1]));
      for (let i = 1; i <= 3; i++) {
        if (coordinates.length <= i) break;
        const label = patternRatioLabel(
          coordinates[i - 1],
          coordinates[i],
          vals[i - 1],
          vals[i],
          legs[i - 1],
          line.color,
        );
        if (label) figures.push(label);
      }
    }
  }
  return figures;
}

let patternRegistered = false;

/**
 * Register the 6 pattern overlays once per page load (see the
 * section header). headShoulders takes 5 clicks (totalStep 6),
 * elliottImpulse / threeDrives 6 clicks (totalStep 7),
 * elliottCorrection / abcdPattern 4 clicks (totalStep 5),
 * xabcdPattern 5 clicks (totalStep 6); double-click (or Esc, see
 * Chart.tsx) force-completes an in-progress overlay.
 */
export function registerPatternOverlays(): void {
  if (patternRegistered) return;
  patternRegistered = true;
  registerTextNoHitFigure();

  const defs: Array<{ name: string; totalStep: number }> = [
    { name: 'headShoulders', totalStep: 6 },
    { name: 'elliottImpulse', totalStep: 7 },
    { name: 'elliottCorrection', totalStep: 5 },
    { name: 'abcdPattern', totalStep: 5 },
    { name: 'xabcdPattern', totalStep: 6 },
    { name: 'threeDrives', totalStep: 7 },
  ];
  defs.forEach(({ name, totalStep }) => {
    registerOverlay({
      name,
      onRightClick: preventOverlayRightClickDelete,
      totalStep,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates, overlay }) =>
        patternFigures(coordinates, overlay, name) as never,
    });
  });
}
