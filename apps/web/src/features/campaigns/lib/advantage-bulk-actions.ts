import { Decimal } from 'decimal.js';

import type {
  AdvantageBand,
  AdvantageTariffRow,
  NonNullStarTierKey,
} from './adapt-advantage-tariff';
import { resolveBestChoice } from './best-choice';

export type { NonNullStarTierKey };

/**
 * Per-item tier choice map: `rowId → 'tier1' | 'tier2' | 'tier3'` (or null when cleared).
 * Unlike the Plus model (a single `'plus'`) an Advantage product picks ONE of four states
 * — None / Avantaj / Çok Avantaj / Süper Avantaj. A single-valued sibling of the Plus
 * `PlusSelectionMap` so the shared cells read a row's choice the same way.
 *
 * This pairs with {@link AdvantageCustomPriceMap}: the two maps are MUTUALLY EXCLUSIVE
 * per row — a row is either tier-joined (`selection[id] != null`), custom-joined
 * (`customPrices[id] != null`), or not joined. Setting one clears the other.
 */
export type AdvantageSelectionMap = Record<string, NonNullStarTierKey | null>;

/**
 * A committed custom Advantage price for one product: the seller typed a price and
 * confirmed it with "Bu fiyatı seç". The estimated profit/margin are captured at confirm
 * time so the header summary can total the joined products without re-estimating. `price`
 * is a GROSS decimal string.
 */
export interface AdvantageCustomChoice {
  price: string;
  netProfit: string | null;
  marginPct: string | null;
}

/** Per-item committed custom price, or null/absent when the row is not custom-joined. */
export type AdvantageCustomPriceMap = Record<string, AdvantageCustomChoice | null>;

/** The full per-row selection state: tier opt-ins + custom-price opt-ins. */
export interface AdvantageSelectionState {
  selection: AdvantageSelectionMap;
  customPrices: AdvantageCustomPriceMap;
}

/**
 * Whether the seller has joined this row — via a star tier OR a custom price. The single
 * "is joined" predicate for export, summary, and filtering.
 */
export function isJoinedRow(
  selection: AdvantageSelectionMap,
  customPrices: AdvantageCustomPriceMap,
  itemId: string,
): boolean {
  return selection[itemId] != null || customPrices[itemId] != null;
}

/** The band (tier) object for a given key on a row, or undefined when that tier is absent. */
export function bandForKey(
  row: AdvantageTariffRow,
  key: NonNullStarTierKey,
): AdvantageBand | undefined {
  return row.bands.find((band) => band.key === key);
}

/** A band's net profit as a Decimal, or null when the row/tier is not calculable. */
function bandProfit(band: AdvantageBand): Decimal | null {
  return band.netProfit !== null ? new Decimal(band.netProfit) : null;
}

/**
 * The most-profitable tier (band) of a row together with the winning profit, comparing
 * pre-computed `netProfit`. Bands with null profit (not calculable) never win; `band` is
 * undefined (and `profit` null) when no tier is calculable. Returning both lets a caller
 * that needs the winner's profit avoid re-deriving it with a second {@link bandProfit}
 * allocation. Display ordering over already-backend-computed figures — no money math.
 */
function bestBandWithProfit(row: AdvantageTariffRow): {
  band: AdvantageBand | undefined;
  profit: Decimal | null;
} {
  let band: AdvantageBand | undefined;
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
 * The most-profitable tier (band) of a row, comparing pre-computed `netProfit`. Bands
 * with null profit (not calculable) never win; undefined when no tier is calculable.
 * Display ordering over already-backend-computed figures — no money math.
 */
export function bestBand(row: AdvantageTariffRow): AdvantageBand | undefined {
  return bestBandWithProfit(row).band;
}

/**
 * The tier key that wins the row's holistic "En kârlı" race ({@link resolveBestChoice}),
 * or null when the current price / a custom price / nothing profitable wins instead. The
 * committed custom price competes so a manually-set price is not overwritten. Purely a
 * strict ordering of already-computed figures — no money math.
 */
function winningTierKey(
  row: AdvantageTariffRow,
  committedCustomNetProfit: string | null,
): NonNullStarTierKey | null {
  const best = resolveBestChoice(row, committedCustomNetProfit);
  return row.bands.find((band) => band.key === best)?.key ?? null;
}

/** Best-tier profit filter (based on the best tier's net-profit sign). */
export type AdvantageProfitFilter = 'all' | 'profitable' | 'loss';

/** Join-state filter. */
export type AdvantageSelectionFilter = 'all' | 'selected' | 'unselected';

/**
 * The detail screen's five client-side filter dimensions. Structurally identical to the
 * commission `TariffFilterState`, so the shared advanced-filter chip adapters in
 * `tariff-filter-fields.ts` map to/from it — only the profit/margin SEMANTICS differ
 * (they read the BEST tier's scenario).
 */
export interface AdvantageTariffFilterState {
  query: string;
  category: string | null;
  brand: string | null;
  /** Show only rows whose BEST-tier margin is at least this percent. */
  minMarginPct: number | null;
  profit: AdvantageProfitFilter;
  selection: AdvantageSelectionFilter;
}

/**
 * Apply each row's most profitable option ("Her ürüne en kârlı kademe") — the holistic
 * {@link resolveBestChoice} winner: a star tier when one wins, no selection when keeping
 * the current price (or nothing profitable) wins, and the committed CUSTOM price is
 * preserved when it is the winner. Uncalculable rows are left untouched. Choosing/clearing
 * a tier always drops the row's custom price, keeping the two maps mutually exclusive.
 */
export function selectBestForAll(
  rows: readonly AdvantageTariffRow[],
  state: AdvantageSelectionState,
): AdvantageSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (!row.calculable) continue;
    const committedCustom = customPrices[row.id]?.netProfit ?? null;
    const best = resolveBestChoice(row, committedCustom);
    const winningBand = row.bands.find((band) => band.key === best);
    if (winningBand !== undefined) {
      // A tier wins → select it, clear any custom price.
      selection[row.id] = winningBand.key;
      customPrices[row.id] = null;
    } else if (best === 'custom') {
      // The committed custom price wins → keep it, clear the tier selection.
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
 * Choose the best tier only for rows where a star tier actually wins the holistic race
 * ("Sadece kârlı kademeler") — dropping to an advantage tier is not always a win, so this
 * selects only the products that genuinely improve on the current price. Rows where the
 * current or a custom price wins are left untouched (their existing choice is preserved).
 */
export function selectProfitable(
  rows: readonly AdvantageTariffRow[],
  state: AdvantageSelectionState,
): AdvantageSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (!row.calculable) continue;
    const committedCustom = customPrices[row.id]?.netProfit ?? null;
    const key = winningTierKey(row, committedCustom);
    if (key !== null) {
      selection[row.id] = key;
      customPrices[row.id] = null;
    }
  }
  return { selection, customPrices };
}

/** Clear the listed rows' selection entirely (both tier and custom). */
export function clearSelections(
  rows: readonly AdvantageTariffRow[],
  state: AdvantageSelectionState,
): AdvantageSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    selection[row.id] = null;
    customPrices[row.id] = null;
  }
  return { selection, customPrices };
}

export function filterAdvantageRows(
  rows: readonly AdvantageTariffRow[],
  selection: AdvantageSelectionMap,
  customPrices: AdvantageCustomPriceMap,
  filters: AdvantageTariffFilterState,
): AdvantageTariffRow[] {
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

    // The best tier (and its profit Decimal) is only resolved when a margin or profit
    // filter is actually engaged — both derive from the SAME winning band, computed in a
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
