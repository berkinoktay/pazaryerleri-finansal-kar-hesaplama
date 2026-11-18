import type { AdvantageTariffRow } from './adapt-advantage-tariff';
import {
  bandForKey,
  type AdvantageCustomPriceMap,
  type AdvantageSelectionMap,
  type AdvantageSelectionState,
} from './advantage-bulk-actions';

/**
 * Seeds the Advantage detail page's editable choice state from the server-authoritative
 * `selectedTier` + `customPrice` of every row.
 *
 * A stored choice is kept only when the selection route would accept it again, because
 * the page sends every row on save and one refused entry fails the whole request:
 *   - a stored custom price is kept (the page sends it with `tier: null`, which the route
 *     never checks against the stored tiers);
 *   - else a stored tier must be one the row stores (the route's `TIER_NOT_STORED`).
 * Anything else seeds as not selected (no entry in either map), so the next save sends
 * `tier: null, customPrice: null` and clears it.
 *
 * A kept custom price is restored without a profit: the exact custom-price profit is not
 * in the detail payload (there is no single scenario for an arbitrary custom price on
 * this vertical), so the live estimate on the visible card fills it in, and re-confirming
 * captures it. It only picks server strings; it does no arithmetic.
 */
export function seedAdvantageSelection(
  rows: readonly AdvantageTariffRow[],
): AdvantageSelectionState {
  const selection: AdvantageSelectionMap = {};
  const customPrices: AdvantageCustomPriceMap = {};
  for (const row of rows) {
    if (row.customPrice !== null) {
      customPrices[row.id] = { price: row.customPrice, netProfit: null, marginPct: null };
      continue;
    }
    if (row.selectedTier !== null && bandForKey(row, row.selectedTier) !== undefined) {
      selection[row.id] = row.selectedTier;
    }
  }
  return { selection, customPrices };
}
