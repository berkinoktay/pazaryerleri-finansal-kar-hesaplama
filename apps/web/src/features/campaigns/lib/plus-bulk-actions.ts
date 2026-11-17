import { Decimal } from 'decimal.js';

import type { PlusBand, PlusTariffRow } from './adapt-plus-tariff';

/**
 * Chosen Plus option per row: `'plus'` = joined AT THE CEILING, `null`/absent = not
 * joined at the ceiling. A single-valued sibling of the commission `SelectionMap`
 * (`Record<string, string | null>`); the export preview reads it through
 * `resolvePlusExportPrice` in export-preview.ts.
 *
 * This pairs with {@link PlusCustomPriceMap}: the two maps are MUTUALLY EXCLUSIVE per
 * row — a row is either ceiling-joined (`selection[id] === 'plus'`), custom-joined
 * (`customPrices[id] != null`), or not joined. Setting one clears the other.
 */
export type PlusSelectionMap = Record<string, string | null>;

/**
 * A committed custom Plus price for one product: the seller typed a price at/below the
 * ceiling and confirmed it. The estimated profit/margin are captured at confirm time
 * so the header summary can total the joined products without re-estimating. `price`
 * is a GROSS decimal string.
 */
export interface PlusCustomChoice {
  price: string;
  netProfit: string | null;
  marginPct: string | null;
}

/** Per-item committed custom price, or null/absent when the row is not custom-joined. */
export type PlusCustomPriceMap = Record<string, PlusCustomChoice | null>;

/** The full per-row Plus choice state: ceiling opt-ins + custom-price opt-ins. */
export interface PlusSelectionState {
  selection: PlusSelectionMap;
  customPrices: PlusCustomPriceMap;
}

/** The row's single Plus offer (the one-element `bands` array), or undefined defensively. */
export function plusOffer(row: PlusTariffRow): PlusBand | undefined {
  return row.bands[0];
}

/**
 * Whether the seller has joined Plus for this row — at the ceiling OR at a custom
 * price. The single "is joined" predicate for export, summary, and filtering.
 */
export function isJoinedRow(
  selection: PlusSelectionMap,
  customPrices: PlusCustomPriceMap,
  itemId: string,
): boolean {
  return selection[itemId] === 'plus' || customPrices[itemId] != null;
}

/** Plus-scenario profit filter (based on the PLUS offer's net-profit sign). */
export type PlusProfitFilter = 'all' | 'profitable' | 'loss';

/** Join-state filter. */
export type PlusSelectionFilter = 'all' | 'selected' | 'unselected';

/**
 * The detail screen's five client-side filter dimensions. Structurally identical to
 * the commission `TariffFilterState`, so the shared advanced-filter chip adapters in
 * `tariff-filter-fields.ts` map to/from it — only the profit/margin SEMANTICS differ
 * (they read the PLUS offer, not a best band).
 */
export interface PlusTariffFilterState {
  query: string;
  category: string | null;
  brand: string | null;
  /** Show only rows whose PLUS-offer margin is at least this percent. */
  minMarginPct: number | null;
  profit: PlusProfitFilter;
  selection: PlusSelectionFilter;
}

/**
 * Apply the row's most profitable option to every listed row. It follows the row's
 * 'En karli' marker, as the commission page's bulk select does:
 *   - an uncalculable row, an offer with no price (unknown ceiling, which cannot be
 *     joined without a custom price), or an offer whose Plus commission percent is
 *     unknown (which cannot be joined at all) is left untouched;
 *   - when the current profit is unknown, the offer is the row's best only when its own
 *     profit is strictly positive: the row joins at the ceiling then, otherwise it is
 *     left untouched;
 *   - with both profits known, it joins where the offer beats doing nothing
 *     (`plusIsBetter`) and un-joins where keeping the current price wins.
 * Choosing/clearing always drops any per-row custom price, keeping the two maps
 * mutually exclusive. It only ranks backend figures; it does no money arithmetic.
 */
export function selectBestForAll(
  rows: readonly PlusTariffRow[],
  state: PlusSelectionState,
): PlusSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (!row.calculable) continue;
    const offer = plusOffer(row);
    if (offer === undefined || offer.price === null || offer.commissionPct === null) continue;
    if (row.currentNetProfit === null) {
      if (offer.netProfit === null || !new Decimal(offer.netProfit).greaterThan(0)) continue;
      selection[row.id] = 'plus';
      customPrices[row.id] = null;
      continue;
    }
    selection[row.id] = row.plusIsBetter ? 'plus' : null;
    customPrices[row.id] = null;
  }
  return { selection, customPrices };
}

/**
 * Join (at the ceiling) only the rows where Plus nets more than the current
 * price/commission (`plusIsBetter`). The useful default: often the lower Plus-ceiling
 * price hurts more than the reduced commission helps, so joining every product is a
 * mistake — this joins only the ones that genuinely win, leaving the rest untouched.
 * Custom-priced rows it touches switch to the ceiling. An offer with no price (unknown
 * ceiling) or with an unknown Plus commission percent is never joined and is left
 * untouched; `plusIsBetter` is already false there, the checks are defensive.
 */
export function joinProfitable(
  rows: readonly PlusTariffRow[],
  state: PlusSelectionState,
): PlusSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    const offer = plusOffer(row);
    const offerPrice = offer?.price ?? null;
    const offerCommissionPct = offer?.commissionPct ?? null;
    if (row.calculable && row.plusIsBetter && offerPrice !== null && offerCommissionPct !== null) {
      selection[row.id] = 'plus';
      customPrices[row.id] = null;
    }
  }
  return { selection, customPrices };
}

/** Un-join the listed rows entirely (both ceiling and custom). */
export function clearJoins(
  rows: readonly PlusTariffRow[],
  state: PlusSelectionState,
): PlusSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    selection[row.id] = null;
    customPrices[row.id] = null;
  }
  return { selection, customPrices };
}

export function filterPlusRows(
  rows: readonly PlusTariffRow[],
  selection: PlusSelectionMap,
  customPrices: PlusCustomPriceMap,
  filters: PlusTariffFilterState,
): PlusTariffRow[] {
  const query = filters.query.trim().toLocaleLowerCase('tr');
  return rows.filter((row) => {
    if (
      query !== '' &&
      ![row.productTitle, row.stockCode, row.barcode].some((field) =>
        (field ?? '').toLocaleLowerCase('tr').includes(query),
      )
    ) {
      return false;
    }
    if (filters.category !== null && row.category !== filters.category) return false;
    if (filters.brand !== null && row.brand !== filters.brand) return false;

    const offer = plusOffer(row);
    const plusMargin = offer?.marginPct ?? null;
    if (
      filters.minMarginPct !== null &&
      (plusMargin === null || Number(plusMargin) < filters.minMarginPct)
    ) {
      return false;
    }
    // The Plus offer's net profit only matters (and is only allocated as a Decimal) when
    // a profit filter is actually engaged — derived from the `offer` already in hand.
    if (filters.profit !== 'all') {
      const plusProfit = offer?.netProfit != null ? new Decimal(offer.netProfit) : null;
      if (filters.profit === 'profitable' && !(plusProfit !== null && plusProfit.greaterThan(0))) {
        return false;
      }
      if (filters.profit === 'loss' && (plusProfit === null || plusProfit.greaterThan(0))) {
        return false;
      }
    }

    const joined = isJoinedRow(selection, customPrices, row.id);
    if (filters.selection === 'selected' && !joined) return false;
    if (filters.selection === 'unselected' && joined) return false;

    return true;
  });
}
