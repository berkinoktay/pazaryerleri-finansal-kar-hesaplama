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
