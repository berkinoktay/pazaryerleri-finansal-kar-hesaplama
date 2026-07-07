import { Decimal } from 'decimal.js';

import type { FlashBand, FlashOfferKey, FlashProductRow } from './adapt-flash-product';
import { resolveBestChoice } from './best-choice';

export type { FlashOfferKey };

/**
 * Per-item offer choice map: `rowId → 'h24' | 'h3'` (or null when cleared). A Flash row
 * picks ONE of up to four states — None / 24 Saatlik / 3 Saatlik / Custom.
 *
 * This pairs with {@link FlashCustomPriceMap}: the two maps are MUTUALLY EXCLUSIVE per row
 * — a row is either offer-joined (`selection[id] != null`), custom-joined
 * (`customPrices[id] != null`), or not joined. Setting one clears the other.
 */
export type FlashSelectionMap = Record<string, FlashOfferKey | null>;

/**
 * A committed custom Flash price for one row: the seller typed a price and confirmed it
 * with "Bu fiyatı seç". The estimated profit/margin are captured at confirm time so the
 * header summary can total the joined rows without re-estimating. `price` is a GROSS
 * decimal string.
 */
export interface FlashCustomChoice {
  price: string;
  netProfit: string | null;
  marginPct: string | null;
}

/** Per-item committed custom price, or null/absent when the row is not custom-joined. */
export type FlashCustomPriceMap = Record<string, FlashCustomChoice | null>;

/** The full per-row selection state: offer opt-ins + custom-price opt-ins. */
export interface FlashSelectionState {
  selection: FlashSelectionMap;
  customPrices: FlashCustomPriceMap;
}

/**
 * Whether the seller has joined this row — via a flash offer OR a custom price. The single
 * "is joined" predicate for export, summary, and filtering.
 */
export function isJoinedRow(
  selection: FlashSelectionMap,
  customPrices: FlashCustomPriceMap,
  itemId: string,
): boolean {
  return selection[itemId] != null || customPrices[itemId] != null;
}

/** The band (offer) object for a given key on a row, or undefined when that offer is absent. */
export function bandForKey(row: FlashProductRow, key: FlashOfferKey): FlashBand | undefined {
  return row.bands.find((band) => band.key === key);
}

/**
 * The custom-price CEILING for a row: the LOWEST of its present offer prices
 * (`min(offer24.price, offer3.price)` over the offers that actually exist). A custom flash
 * price may never exceed the best offer the seller was given. Pure ordering over
 * already-served prices — no money math. Null when the row carries no offer.
 */
export function flashCustomCeiling(row: FlashProductRow): Decimal | null {
  let ceiling: Decimal | null = null;
  for (const band of row.bands) {
    const price = new Decimal(band.price);
    if (ceiling === null || price.lessThan(ceiling)) ceiling = price;
  }
  return ceiling;
}

/** A band's net profit as a Decimal, or null when the row/offer is not calculable. */
function bandProfit(band: FlashBand): Decimal | null {
  return band.netProfit !== null ? new Decimal(band.netProfit) : null;
}

/**
 * The most-profitable offer (band) of a row together with the winning profit, comparing
 * pre-computed `netProfit`. Bands with null profit (not calculable) never win; `band` is
 * undefined (and `profit` null) when no offer is calculable. Display ordering over
 * already-backend-computed figures — no money math.
 */
function bestBandWithProfit(row: FlashProductRow): {
  band: FlashBand | undefined;
  profit: Decimal | null;
} {
  let band: FlashBand | undefined;
  let profit: Decimal | null = null;
  for (const candidate of row.bands) {
    const candidateProfit = bandProfit(candidate);
    if (candidateProfit === null) continue;
    if (profit === null || candidateProfit.greaterThan(profit)) {
      band = candidate;
      profit = candidateProfit;
    }
  }
  return { band, profit };
}

/**
 * The offer key that wins the row's holistic "En kârlı" race ({@link resolveBestChoice}),
 * or null when the current price / a custom price / nothing profitable wins instead. The
 * committed custom price competes so a manually-set price is not overwritten. Purely a
 * strict ordering of already-computed figures — no money math.
 */
function winningOfferKey(
  row: FlashProductRow,
  committedCustomNetProfit: string | null,
): FlashOfferKey | null {
  const best = resolveBestChoice(row, committedCustomNetProfit);
  return row.bands.find((band) => band.key === best)?.key ?? null;
}

/** Best-offer profit filter (based on the best offer's net-profit sign). */
export type FlashProfitFilter = 'all' | 'profitable' | 'loss';

/** Join-state filter. */
export type FlashSelectionFilter = 'all' | 'selected' | 'unselected';

/**
 * The detail screen's five client-side filter dimensions. Structurally identical to the
 * commission/Advantage `TariffFilterState`, so the shared advanced-filter chip adapters in
 * `tariff-filter-fields.ts` map to/from it — only the profit/margin SEMANTICS differ (they
 * read the BEST offer's scenario).
 */
export interface FlashProductFilterState {
  query: string;
  category: string | null;
  brand: string | null;
  /** Show only rows whose BEST-offer margin is at least this percent. */
  minMarginPct: number | null;
  profit: FlashProfitFilter;
  selection: FlashSelectionFilter;
}

/**
 * Apply each row's most profitable option ("Her ürüne en kârlı seçim") — the holistic
 * {@link resolveBestChoice} winner: a flash offer when one wins, no selection when keeping
 * the current price (or nothing profitable) wins, and the committed CUSTOM price is
 * preserved when it is the winner. Uncalculable rows are left untouched. Choosing/clearing
 * an offer always drops the row's custom price, keeping the two maps mutually exclusive.
 */
export function selectBestForAll(
  rows: readonly FlashProductRow[],
  state: FlashSelectionState,
): FlashSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (!row.calculable) continue;
    const committedCustom = customPrices[row.id]?.netProfit ?? null;
    const best = resolveBestChoice(row, committedCustom);
    const winningBand = row.bands.find((band) => band.key === best);
    if (winningBand !== undefined) {
      // An offer wins → select it, clear any custom price.
      selection[row.id] = winningBand.key;
      customPrices[row.id] = null;
    } else if (best === 'custom') {
      // The committed custom price wins → keep it, clear the offer selection.
      selection[row.id] = null;
    } else {
      // Current wins, or nothing is profitable → no selection at all.
      selection[row.id] = null;
      customPrices[row.id] = null;
    }
  }
  return { selection, customPrices };
}

/**
 * Choose the best offer only for rows where a flash offer actually wins the holistic race
 * ("Sadece kârlı teklifler") — joining a flash slot is not always a win, so this selects
 * only the rows that genuinely improve on the current price. Rows where the current or a
 * custom price wins are left untouched (their existing choice is preserved).
 */
export function selectProfitable(
  rows: readonly FlashProductRow[],
  state: FlashSelectionState,
): FlashSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (!row.calculable) continue;
    const committedCustom = customPrices[row.id]?.netProfit ?? null;
    const key = winningOfferKey(row, committedCustom);
    if (key !== null) {
      selection[row.id] = key;
      customPrices[row.id] = null;
    }
  }
  return { selection, customPrices };
}

/** Clear the listed rows' selection entirely (both offer and custom). */
export function clearSelections(
  rows: readonly FlashProductRow[],
  state: FlashSelectionState,
): FlashSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    selection[row.id] = null;
    customPrices[row.id] = null;
  }
  return { selection, customPrices };
}

export function filterFlashRows(
  rows: readonly FlashProductRow[],
  selection: FlashSelectionMap,
  customPrices: FlashCustomPriceMap,
  filters: FlashProductFilterState,
): FlashProductRow[] {
  const query = filters.query.trim().toLocaleLowerCase('tr');
  return rows.filter((row) => {
    if (
      query !== '' &&
      ![row.productTitle, row.modelCode, row.barcode].some((field) =>
        (field ?? '').toLocaleLowerCase('tr').includes(query),
      )
    ) {
      return false;
    }
    if (filters.category !== null && row.category !== filters.category) return false;
    if (filters.brand !== null && row.brand !== filters.brand) return false;

    // The best offer (and its profit Decimal) is only resolved when a margin or profit
    // filter is actually engaged — both derive from the SAME winning offer, computed in a
    // single pass so the winner's profit is never re-allocated.
    if (filters.minMarginPct !== null || filters.profit !== 'all') {
      const { band: best, profit } = bestBandWithProfit(row);
      const bestMargin = best?.marginPct ?? null;
      if (
        filters.minMarginPct !== null &&
        (bestMargin === null || Number(bestMargin) < filters.minMarginPct)
      ) {
        return false;
      }
      if (filters.profit === 'profitable' && !(profit !== null && profit.greaterThan(0))) {
        return false;
      }
      if (filters.profit === 'loss' && (profit === null || profit.greaterThan(0))) {
        return false;
      }
    }

    const joined = isJoinedRow(selection, customPrices, row.id);
    if (filters.selection === 'selected' && !joined) return false;
    if (filters.selection === 'unselected' && joined) return false;

    return true;
  });
}
