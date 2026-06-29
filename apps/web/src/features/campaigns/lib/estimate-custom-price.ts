import { Decimal } from 'decimal.js';

import type { CommissionTariffRow, PriceBand } from '../types';

export interface CustomPriceEstimate {
  /** The tariff band the entered price falls into. */
  band: PriceBand;
  commissionPct: Decimal;
  profit: Decimal;
  /** Margin percent as a plain string for margin-coloring. */
  marginPct: string;
}

/**
 * Map a custom price to the tariff band whose range it falls into. Bands are
 * ordered band1 (highest "ve üzeri" threshold) → band4 (lowest "ve altı").
 */
export function bandForPrice(row: CommissionTariffRow, price: Decimal): PriceBand {
  const [b1, b2, b3, b4] = row.bands;
  if (price.greaterThanOrEqualTo(b1.threshold)) return b1;
  if (price.greaterThan(b3.threshold)) return b2;
  if (price.greaterThan(b4.threshold)) return b3;
  return b4;
}

/**
 * Estimate profit if the seller sells at `price`: find the band the price falls
 * into, use that band's commission, and apply the same formula the bands use
 * (price − price·commission − unitCost). MOCK preview — the real engine computes
 * and persists profit; this only powers the what-if input client-side.
 */
export function estimateCustomPrice(row: CommissionTariffRow, price: Decimal): CustomPriceEstimate {
  const band = bandForPrice(row, price);
  const profit = price.minus(price.times(band.commissionPct)).minus(row.unitCost);
  const marginPct = price.isZero() ? '0' : profit.dividedBy(price).times(100).toFixed(2);
  return { band, commissionPct: band.commissionPct, profit, marginPct };
}
