import type { Decimal } from 'decimal.js';

import type { CommissionTariffRow, PriceBand } from '../types';

/**
 * The income/expense breakdown behind a single profit figure, for the detail
 * modal: sale price (income) − commission − unit cost = profit.
 */
export interface TariffBreakdown {
  /** Sale price the profit is computed at (income). */
  price: Decimal;
  /** Commission fraction (e.g. 0.131 = %13,1) — shown beside the commission row. */
  commissionPct: Decimal;
  /** Commission amount at this price (expense). */
  commission: Decimal;
  /** Non-commission unit cost: product + shipping + other (expense). */
  unitCost: Decimal;
  /** Resulting net profit (income − expenses). */
  profit: Decimal;
  /** Margin percent as a plain string for coloring, e.g. "9.11". */
  marginPct: string;
}

/**
 * Builds the breakdown behind a price-band's profit. MOCK display helper (the
 * authoritative figures come from the backend engine): band1 is the product's
 * current range so its price is the live `currentPrice`; the discount bands are
 * priced at their threshold. `commission = price · commissionPct`, matching how
 * the mock derives `profit = price − commission − unitCost`.
 */
export function buildBandBreakdown(
  row: CommissionTariffRow,
  band: PriceBand,
  isCurrent: boolean,
): TariffBreakdown {
  const price = isCurrent ? row.currentPrice : band.threshold;
  return {
    price,
    commissionPct: band.commissionPct,
    commission: price.times(band.commissionPct),
    unitCost: row.unitCost,
    profit: band.profit,
    marginPct: band.marginPct,
  };
}
