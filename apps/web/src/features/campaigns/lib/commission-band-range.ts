import { Decimal } from 'decimal.js';

import type { AdvantageCommissionBand } from '../api/get-advantage-tariff-detail.api';

/**
 * Finds the commission band a price lands in, mirroring the backend `bandForPrice`
 * semantics: iterate the stored top-down order (band1 → band4) and return the FIRST
 * band whose window contains the price, so a price sitting on a shared boundary
 * resolves to the HIGHER band. Pure comparison / ordering — no arithmetic, no money
 * math (the profit is always computed server-side). Returns null when no band
 * contains the price (e.g. an empty ladder).
 */
export function findBandForPrice(
  bands: readonly AdvantageCommissionBand[],
  price: Decimal,
): AdvantageCommissionBand | null {
  for (const band of bands) {
    const aboveLower = band.lowerLimit === null || price.gte(band.lowerLimit);
    const belowUpper = band.upperLimit === null || price.lte(band.upperLimit);
    if (aboveLower && belowUpper) return band;
  }
  return null;
}

/**
 * Finds the band whose commission rate equals `commissionPct` (numeric compare, so any
 * decimal-string formatting matches). Used to mark the band the cell ACTUALLY charges from:
 * for list-price-anchored discounts (X-al-Y / Nth-product) the charged rate comes from the
 * CURRENT price's band, not the displayed discounted price's band, so matching by the shown
 * rate marks the right band regardless of which price drove it. Bands partition the price
 * line with distinct rates, so the first match is the charged band. Returns null when no
 * band carries that rate (e.g. an empty ladder). Pure comparison — no money math.
 */
export function findBandByCommissionPct(
  bands: readonly AdvantageCommissionBand[],
  commissionPct: string,
): AdvantageCommissionBand | null {
  const target = new Decimal(commissionPct);
  for (const band of bands) {
    if (new Decimal(band.commissionPct).equals(target)) return band;
  }
  return null;
}

/**
 * The three i18n templates a band range is rendered with, pre-bound to next-intl's
 * `t`. Kept as callbacks so {@link formatBandRange} stays a pure, framework-free
 * function that the unit tests can drive with plain string builders.
 */
export interface BandRangeLabelFns {
  /** Top band (open above): e.g. "₺181,10 ve üzeri". */
  readonly above: (price: string) => string;
  /** Middle band (both bounds): e.g. "₺146,01–₺163,88". */
  readonly range: (lower: string, upper: string) => string;
  /** Bottom band (open below): e.g. "₺146,00 ve altı". */
  readonly below: (price: string) => string;
}

/**
 * Formats a commission band's price window into a human range label, using the
 * caller-supplied currency formatter and i18n templates. Pure presentation — the
 * money is only formatted for display, never derived:
 *   - top band (lower set, no upper)   → "{lower} ve üzeri"
 *   - middle band (both bounds set)     → "{lower}–{upper}"
 *   - bottom band (upper set, no lower) → "{upper} ve altı"
 * Returns null for a degenerate band with neither limit (never a real band).
 */
export function formatBandRange(
  band: Pick<AdvantageCommissionBand, 'lowerLimit' | 'upperLimit'>,
  formatCurrency: (value: string) => string,
  labels: BandRangeLabelFns,
): string | null {
  const { lowerLimit, upperLimit } = band;
  if (lowerLimit !== null && upperLimit === null) {
    return labels.above(formatCurrency(lowerLimit));
  }
  if (lowerLimit === null && upperLimit !== null) {
    return labels.below(formatCurrency(upperLimit));
  }
  if (lowerLimit !== null && upperLimit !== null) {
    return labels.range(formatCurrency(lowerLimit), formatCurrency(upperLimit));
  }
  return null;
}
