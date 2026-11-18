import { Decimal } from 'decimal.js';

import { offerKeyFromEnum, type FlashProductRow } from './adapt-flash-product';
import {
  bandForKey,
  flashCustomCeiling,
  type FlashCustomPriceMap,
  type FlashSelectionMap,
  type FlashSelectionState,
} from './flash-bulk-actions';

/**
 * Seeds the Flash detail page's editable choice state from the server-authoritative
 * `selectedOffer` + `customPrice` of every row.
 *
 * A stored choice is kept only when the selection route would accept it again, because
 * the page sends every row on save and one refused entry fails the whole request:
 *   - a stored custom price needs a row that carries at least one offer (the route's
 *     `OFFER_NOT_STORED`: there is no ceiling to check against) and may not be above the
 *     row's lowest offer price (the route's `CUSTOM_PRICE_ABOVE_MAX`; a price equal to it
 *     is kept);
 *   - else a stored offer must be one the row carries (the route's `OFFER_NOT_STORED`).
 * Anything else seeds as not selected (no entry in either map), so the next save sends
 * `offer: null, customPrice: null` and clears it. A row with a custom price never falls
 * back to its stored offer: the two are mutually exclusive on this page.
 *
 * A kept custom price is restored without a profit: the exact custom-price profit is not
 * in the detail payload (there is no single scenario for an arbitrary custom price), so
 * the live estimate on the visible card fills it in, and re-confirming captures it. It
 * only orders server strings; it does no arithmetic.
 */
export function seedFlashSelection(rows: readonly FlashProductRow[]): FlashSelectionState {
  const selection: FlashSelectionMap = {};
  const customPrices: FlashCustomPriceMap = {};
  for (const row of rows) {
    if (row.customPrice !== null) {
      const ceiling = flashCustomCeiling(row);
      if (ceiling !== null && !new Decimal(row.customPrice).greaterThan(ceiling)) {
        customPrices[row.id] = { price: row.customPrice, netProfit: null, marginPct: null };
      }
      continue;
    }
    const offerKey = offerKeyFromEnum(row.selectedOffer);
    if (offerKey !== null && bandForKey(row, offerKey) !== undefined) {
      selection[row.id] = offerKey;
    }
  }
  return { selection, customPrices };
}
