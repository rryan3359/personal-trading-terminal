/**
 * position-calc.ts — pure position-size math for the long/short
 * position tools (TradingView formulas, verified against TV's help
 * article "How to use long and short position drawing tools" and the
 * leverage blog post).
 *
 * No klinecharts import: the figure callback (chart-theme) and the
 * settings dialog both use this. Point value is 1 for crypto
 * (BTCUSDT etc.); it is a parameter so a future symbol with a
 * different point value needs no formula change.
 *
 * TV formulas (long; short mirrors the signs):
 *   Qty = min(QtyRisk, QtyLvg)
 *   QtyRisk = (RiskSize / ((Entry − Stop) * Point value)) / Lot size
 *   QtyLvg  = (Account * Leverage / Entry) * Point value / Lot size
 *   RiskSize = Risk (amount mode) or Risk/100 * Account (percent mode)
 *   Balance at TP = Account + (TP − Entry) * Qty * Point value * Lot size
 *   Balance at SL = Account − (Entry − Stop) * Qty * Point value * Lot size
 *   R:R = (TP − Entry) / (Entry − Stop)
 */

export type PositionRiskMode = 'percent' | 'amount';

/** Which stats the on-chart pill shows. */
export type PositionStatsMode = 'all' | 'qty-pnl' | 'balance';

/**
 * Per-position settings, stored in the overlay's extendData
 * (pos-prefixed keys) and as the "last position inputs" in
 * localStorage for the next new position. The dialog edits these;
 * the entry/stop/target prices themselves are the overlay points,
 * not settings.
 */
export interface PositionSettings {
  /** Initial account size (USDT). Neutral default, not Ryan's account. */
  posAccount: number;
  posRiskMode: PositionRiskMode;
  /** % of account (percent mode) or currency amount (amount mode). */
  posRisk: number;
  posLeverage: number;
  posLotSize: number;
  /** Decimals for the displayed quantity. */
  posQtyPrecision: number;
  /** Profit-zone / target colour. */
  posProfitColor: string;
  /** Risk-zone / stop colour. */
  posRiskColor: string;
  /** Label + pill font size in px. */
  posTextSize: number;
  posStats: PositionStatsMode;
  /** Compact stats mode: pill shows quantity + R:R + TP/SL P&L only. */
  posCompact: boolean;
  /** Always show the stats pill (off: only a compact R:R + Qty label). */
  posShowStats: boolean;
}

export const DEFAULT_POSITION_SETTINGS: PositionSettings = {
  posAccount: 10000,
  posRiskMode: 'percent',
  posRisk: 1,
  posLeverage: 1,
  posLotSize: 1,
  posQtyPrecision: 3,
  posProfitColor: '#26a69a',
  posRiskColor: '#ef5350',
  posTextSize: 11,
  posStats: 'all',
  posCompact: false,
  posShowStats: true,
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isHexColor = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Read + validate position settings from an overlay's extendData. */
export function readPositionSettings(
  ext: Record<string, unknown>,
): PositionSettings {
  const d = DEFAULT_POSITION_SETTINGS;
  const account = isFiniteNumber(ext.posAccount) ? ext.posAccount : d.posAccount;
  const risk = isFiniteNumber(ext.posRisk) ? ext.posRisk : d.posRisk;
  const leverage = isFiniteNumber(ext.posLeverage)
    ? ext.posLeverage
    : d.posLeverage;
  const lotSize = isFiniteNumber(ext.posLotSize) ? ext.posLotSize : d.posLotSize;
  const qtyPrecision = isFiniteNumber(ext.posQtyPrecision)
    ? Math.max(0, Math.min(8, Math.floor(ext.posQtyPrecision)))
    : d.posQtyPrecision;
  const textSize = isFiniteNumber(ext.posTextSize)
    ? Math.max(8, Math.min(24, Math.floor(ext.posTextSize)))
    : d.posTextSize;
  return {
    posAccount: account > 0 ? account : d.posAccount,
    posRiskMode: ext.posRiskMode === 'amount' ? 'amount' : 'percent',
    posRisk: risk >= 0 ? risk : d.posRisk,
    posLeverage: leverage > 0 ? leverage : d.posLeverage,
    posLotSize: lotSize > 0 ? lotSize : d.posLotSize,
    posQtyPrecision: qtyPrecision,
    posProfitColor: isHexColor(ext.posProfitColor)
      ? ext.posProfitColor
      : d.posProfitColor,
    posRiskColor: isHexColor(ext.posRiskColor)
      ? ext.posRiskColor
      : d.posRiskColor,
    posTextSize: textSize,
    posStats:
      ext.posStats === 'qty-pnl' || ext.posStats === 'balance'
        ? ext.posStats
        : 'all',
    posCompact: ext.posCompact === true,
    posShowStats: ext.posShowStats !== false,
  };
}

export interface PositionCalc {
  /** Quantity (rounded to qtyPrecision decimals). 0 when uncomputable. */
  qty: number;
  /** Money at risk (RiskSize). */
  riskSize: number;
  riskPerUnit: number;
  rewardPerUnit: number;
  /** Reward / risk ratio. */
  rr: number;
  /** P&L if the target is hit (positive). */
  pnlTp: number;
  /** P&L if the stop is hit (negative). */
  pnlSl: number;
  /** % move to target (positive) / to stop (negative). */
  pctTp: number;
  pctSl: number;
  /** Account balance after closing at target / stop. */
  balanceTp: number;
  balanceSl: number;
  /** Open P&L at the last close (null when no last price). */
  openPnl: number | null;
  openPct: number | null;
}

export function calcPosition(
  settings: PositionSettings,
  isLong: boolean,
  entry: number,
  stop: number,
  target: number,
  lastClose: number | null,
  pointValue = 1,
): PositionCalc {
  const zero: PositionCalc = {
    qty: 0,
    riskSize: 0,
    riskPerUnit: 0,
    rewardPerUnit: 0,
    rr: 0,
    pnlTp: 0,
    pnlSl: 0,
    pctTp: 0,
    pctSl: 0,
    balanceTp: settings.posAccount,
    balanceSl: settings.posAccount,
    openPnl: null,
    openPct: null,
  };
  const riskPerUnit = Math.abs(entry - stop);
  const rewardPerUnit = Math.abs(target - entry);
  const rr = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
  if (riskPerUnit <= 0 || entry <= 0) return { ...zero, rr };
  const account = settings.posAccount;
  const leverage = settings.posLeverage;
  if (account <= 0 || leverage <= 0) return { ...zero, rr };
  const riskSize =
    settings.posRiskMode === 'percent'
      ? (settings.posRisk / 100) * account
      : settings.posRisk;
  const qtyRisk =
    riskSize / (riskPerUnit * pointValue) / settings.posLotSize;
  const qtyLvg =
    ((account * leverage) / entry) * pointValue / settings.posLotSize;
  const qtyRaw = Math.min(qtyRisk, qtyLvg);
  if (!Number.isFinite(qtyRaw) || qtyRaw <= 0) return { ...zero, rr };
  const qty = Number(qtyRaw.toFixed(settings.posQtyPrecision));
  const dir = isLong ? 1 : -1;
  const unit = qty * pointValue * settings.posLotSize;
  const pnlTp = (target - entry) * dir * unit;
  const pnlSl = (stop - entry) * dir * unit;
  const pctTp = ((target - entry) / entry) * 100 * dir;
  const pctSl = ((stop - entry) / entry) * 100 * dir;
  return {
    qty,
    riskSize,
    riskPerUnit,
    rewardPerUnit,
    rr,
    pnlTp,
    pnlSl,
    pctTp,
    pctSl,
    balanceTp: account + pnlTp,
    balanceSl: account + pnlSl,
    openPnl:
      lastClose === null ? null : (lastClose - entry) * dir * unit,
    openPct:
      lastClose === null
        ? null
        : ((lastClose - entry) / entry) * 100 * dir,
  };
}
