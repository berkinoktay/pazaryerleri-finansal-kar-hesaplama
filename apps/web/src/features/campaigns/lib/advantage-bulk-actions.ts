import { Decimal } from 'decimal.js';

import type { AdvantageTariffDetailItem, AdvantageTier, StarTierKey } from '../types';

/** One of the three concrete star tiers (never null) — an actual seller choice. */
export type NonNullStarTierKey = NonNullable<StarTierKey>;

/**
 * Per-item tier choice map: `rowId → 'tier1' | 'tier2' | 'tier3'`. Absent = the
 * product has no tier chosen (None). Unlike the Plus model (a single boolean per row)
 * an Advantage product picks ONE of four states — None / Avantaj / Çok Avantaj /
 * Süper Avantaj.
 *
 * This pairs with {@link AdvantageCustomPriceMap}: the two maps are MUTUALLY EXCLUSIVE
 * per row — a row is either tier-joined (`tiers[id] != null`), custom-joined
 * (`customPrices[id] != null`), or not joined. Setting one clears the other.
 */
export type AdvantageTierMap = Record<string, NonNullStarTierKey>;

/**
 * A committed custom Advantage price for one product: the seller typed a price and
 * confirmed it with "Bu fiyatı seç". The estimated profit/margin are captured at
 * confirm time so the header summary can total the joined products without
 * re-estimating. `price` is a GROSS decimal string.
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
  tiers: AdvantageTierMap;
  customPrices: AdvantageCustomPriceMap;
}

/**
 * Whether the seller has joined this row — via a star tier OR a custom price. The
 * single "is joined" predicate for export, summary, and filtering.
 */
export function isJoinedRow(
  tiers: AdvantageTierMap,
  customPrices: AdvantageCustomPriceMap,
  itemId: string,
): boolean {
  return tiers[itemId] != null || customPrices[itemId] != null;
}

/** The tier object for a given key on a row, or undefined when that tier is absent. */
export function tierForKey(
  row: AdvantageTariffDetailItem,
  key: NonNullStarTierKey,
): AdvantageTier | undefined {
  return row.tiers.find((tier) => tier.key === key);
}

/** The row's most-profitable tier object (per the backend `bestTierKey`), or undefined. */
export function bestTier(row: AdvantageTariffDetailItem): AdvantageTier | undefined {
  if (row.bestTierKey == null) return undefined;
  return tierForKey(row, row.bestTierKey);
}

/** A scenario's net profit as a Decimal, or null when the row/tier is not calculable. */
function netProfitOrNull(netProfit: string | null): Decimal | null {
  return netProfit !== null ? new Decimal(netProfit) : null;
}

/**
 * Whether the row's best tier nets MORE profit than doing nothing (the current price).
 * Display math over two ALREADY-backend-computed profits (like {@link ProfitDelta} and
 * the header summary) — it never computes profit/commission/VAT, so the
 * no-frontend-financial-calculation rule holds. Un-calculable rows are not "better".
 */
export function bestTierIsBetter(row: AdvantageTariffDetailItem): boolean {
  const best = bestTier(row);
  if (best === undefined) return false;
  const tierProfit = netProfitOrNull(best.netProfit);
  const currentProfit = netProfitOrNull(row.current.netProfit);
  if (tierProfit === null || currentProfit === null) return false;
  return tierProfit.greaterThan(currentProfit);
}

/** Best-tier profit filter (based on the best tier's net-profit sign). */
export type AdvantageProfitFilter = 'all' | 'profitable' | 'loss';

/** Join-state filter. */
export type AdvantageSelectionFilter = 'all' | 'selected' | 'unselected';

/**
 * The detail screen's five client-side filter dimensions. Structurally identical to
 * the commission `TariffFilterState`, so the shared advanced-filter chip adapters in
 * `tariff-filter-fields.ts` map to/from it — only the profit/margin SEMANTICS differ
 * (they read the BEST tier's scenario, not a single offer).
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
 * Choose the most-profitable tier for every listed calculable row (uncalculable rows
 * cannot be chosen). Choosing a tier clears any per-row custom price, keeping the two
 * maps mutually exclusive.
 */
export function selectBestForAll(
  rows: readonly AdvantageTariffDetailItem[],
  state: AdvantageSelectionState,
): AdvantageSelectionState {
  const tiers = { ...state.tiers };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (row.calculable && row.bestTierKey != null) {
      tiers[row.id] = row.bestTierKey;
      customPrices[row.id] = null;
    }
  }
  return { tiers, customPrices };
}

/**
 * Choose the best tier only for rows where it nets MORE than the current price
 * (`bestTierIsBetter`). The useful default: dropping to an advantage tier is not always
 * a win, so this selects only the products that genuinely improve. Custom-priced rows
 * it touches switch to the best tier; rows it does not touch keep their choice.
 */
export function selectProfitable(
  rows: readonly AdvantageTariffDetailItem[],
  state: AdvantageSelectionState,
): AdvantageSelectionState {
  const tiers = { ...state.tiers };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (row.calculable && row.bestTierKey != null && bestTierIsBetter(row)) {
      tiers[row.id] = row.bestTierKey;
      customPrices[row.id] = null;
    }
  }
  return { tiers, customPrices };
}

/** Clear the listed rows' selection entirely (both tier and custom). */
export function clearSelections(
  rows: readonly AdvantageTariffDetailItem[],
  state: AdvantageSelectionState,
): AdvantageSelectionState {
  const tiers = { ...state.tiers };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    delete tiers[row.id];
    customPrices[row.id] = null;
  }
  return { tiers, customPrices };
}

export function filterAdvantageRows(
  rows: readonly AdvantageTariffDetailItem[],
  tiers: AdvantageTierMap,
  customPrices: AdvantageCustomPriceMap,
  filters: AdvantageTariffFilterState,
): AdvantageTariffDetailItem[] {
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

    const best = bestTier(row);
    const bestMargin = best?.marginPct ?? null;
    const bestProfit = netProfitOrNull(best?.netProfit ?? null);
    if (
      filters.minMarginPct !== null &&
      (bestMargin === null || Number(bestMargin) < filters.minMarginPct)
    ) {
      return false;
    }
    if (filters.profit === 'profitable' && !(bestProfit !== null && bestProfit.greaterThan(0))) {
      return false;
    }
    if (filters.profit === 'loss' && (bestProfit === null || bestProfit.greaterThan(0))) {
      return false;
    }

    const joined = isJoinedRow(tiers, customPrices, row.id);
    if (filters.selection === 'selected' && !joined) return false;
    if (filters.selection === 'unselected' && joined) return false;

    return true;
  });
}
