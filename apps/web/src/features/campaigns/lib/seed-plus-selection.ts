import type { PlusTariffRow } from './adapt-plus-tariff';
import {
  plusOffer,
  type PlusCustomPriceMap,
  type PlusSelectionMap,
  type PlusSelectionState,
} from './plus-bulk-actions';

/** Minimal per-period shape the seed needs (a full detail period satisfies it). */
interface SeedPeriod {
  readonly rows: readonly PlusTariffRow[];
}

/**
 * Seeds the Plus detail page's editable join state from the server-authoritative
 * `selected` + `customPrice` of every row in every period.
 *
 * Only a stored join (`selected`) is restored, and only when the selection route would
 * accept it again, because
 * the page sends every row of every period on save and one refused entry fails the
 * whole request:
 *   - a stored custom price: custom-joined, whatever the ceiling (a custom price
 *     never needs the Plus price upper limit);
 *   - else a stored join whose offer has a price: joined at the ceiling (`'plus'`);
 *   - else (joined, no custom price, ceiling unknown): the route's `PLUS_PRICE_UNKNOWN`
 *     would refuse it, so it seeds as not joined (no entry in either map) and the next
 *     save sends `selected: false` and clears it.
 *
 * A kept custom price is restored with the offer's profit: the exact custom-price
 * profit is not in the detail payload, so the summary approximates it until the seller
 * re-confirms (which captures the estimate). It only picks server strings; it does no
 * arithmetic.
 */
export function seedPlusSelection(periods: readonly SeedPeriod[]): PlusSelectionState {
  const selection: PlusSelectionMap = {};
  const customPrices: PlusCustomPriceMap = {};
  for (const period of periods) {
    for (const row of period.rows) {
      const offer = plusOffer(row);
      // Only a stored JOIN is restored: a custom price stored on a row that is not
      // joined (possible through the API, never sent by this page) stays unjoined, and
      // the next save clears it, rather than joining Plus on its own.
      if (!row.selected) continue;
      if (row.customPrice !== null) {
        customPrices[row.id] = {
          price: row.customPrice,
          netProfit: offer?.netProfit ?? null,
          marginPct: offer?.marginPct ?? null,
        };
        continue;
      }
      if (offer !== undefined && offer.price !== null) {
        selection[row.id] = 'plus';
      }
    }
  }
  return { selection, customPrices };
}
