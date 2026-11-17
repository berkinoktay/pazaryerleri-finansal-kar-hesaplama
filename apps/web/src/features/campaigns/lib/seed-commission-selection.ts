import type { CommissionTariffRow } from '../types';
import type { CommissionSelectionState, CustomPriceMap, SelectionMap } from './bulk-actions';
import { findBand } from './commission-tariff-summary';

/** Minimal per-period shape the seed needs (a full detail period satisfies it). */
interface SeedPeriod {
  readonly rows: readonly CommissionTariffRow[];
}

/**
 * Seeds the detail page's editable choice state from the server-authoritative
 * `selectedBand` + `customPrice` of every row in every period.
 *
 * A stored selection is kept only when the selection route would accept it again,
 * because the page sends every row of every period on save and one refused entry
 * fails the whole request:
 *   - the row must still hold the selected band (the route's `BAND_NOT_STORED`,
 *     which a custom price does not waive);
 *   - the band must have a price unless a custom price is stored (the route's
 *     `BAND_PRICE_UNKNOWN`: a band with neither limit while the current price is
 *     unknown).
 * Anything else seeds as not selected (no entry in either map), so the next save
 * sends `band: null` and clears it.
 *
 * A kept custom price is restored with its band's profit: the exact custom-price
 * profit is not in the detail payload, so the summary approximates it until the
 * seller re-confirms (which captures the estimate). It only picks server strings;
 * it does no arithmetic.
 */
export function seedCommissionSelection(periods: readonly SeedPeriod[]): CommissionSelectionState {
  const selection: SelectionMap = {};
  const customPrices: CustomPriceMap = {};
  for (const period of periods) {
    for (const row of period.rows) {
      if (row.selectedBand === null) continue;
      const band = findBand(row, row.selectedBand);
      if (band === undefined) continue;
      if (row.customPrice === null && band.price === null) continue;
      selection[row.id] = row.selectedBand;
      if (row.customPrice !== null) {
        customPrices[row.id] = {
          price: row.customPrice,
          netProfit: band.netProfit,
          marginPct: band.marginPct,
        };
      }
    }
  }
  return { selection, customPrices };
}
