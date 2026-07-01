import { Decimal } from 'decimal.js';

import type { CommissionTariffRow, PriceBand } from '../types';

/** Chosen band key per row (`band1`..`band4`), or null when none is chosen. */
export type SelectionMap = Record<string, string | null>;

/** Target-margin selection strategy. */
export type TargetStrategy = 'least-drop' | 'max-profit';

/** Best-band-based profit filter. */
export type ProfitFilter = 'all' | 'profitable' | 'loss';

/** Selection-state filter. */
export type SelectionFilter = 'all' | 'selected' | 'unselected';

/** A band's net profit as a Decimal, or null when the row is not calculable. */
function bandProfit(band: PriceBand): Decimal | null {
  return band.netProfit !== null ? new Decimal(band.netProfit) : null;
}

/**
 * The most profitable band of a row, comparing pre-computed `netProfit`. Bands
 * with null profit (not calculable) never win. Falls back to the first band when
 * none is calculable, so callers always get a band.
 */
function bestBand(row: CommissionTariffRow): PriceBand | undefined {
  let best: PriceBand | undefined;
  let bestProfit: Decimal | null = null;
  for (const band of row.bands) {
    const profit = bandProfit(band);
    if (profit === null) continue;
    if (bestProfit === null || profit.greaterThan(bestProfit)) {
      best = band;
      bestProfit = profit;
    }
  }
  return best ?? row.bands[0];
}

/** Apply the most profitable (server-marked) band to every row. */
export function selectBestForAll(
  rows: readonly CommissionTariffRow[],
  prev: SelectionMap,
): SelectionMap {
  const next = { ...prev };
  for (const row of rows) {
    if (row.bestBandKey !== null) next[row.id] = row.bestBandKey;
  }
  return next;
}

/** Apply the best band only to rows whose best band is profitable (skip losers). */
export function selectProfitableOnly(
  rows: readonly CommissionTariffRow[],
  prev: SelectionMap,
): SelectionMap {
  const next = { ...prev };
  for (const row of rows) {
    const best = bestBand(row);
    const profit = best !== undefined ? bandProfit(best) : null;
    if (best !== undefined && profit !== null && profit.greaterThan(0)) next[row.id] = best.key;
  }
  return next;
}

/**
 * Target-margin selection. For each row, among the bands meeting the target
 * margin, pick by strategy: `least-drop` = the highest-price (least price cut)
 * band that still hits the target; `max-profit` = the most profitable among
 * them. Rows with no band meeting the target are left untouched.
 */
export function selectByTargetMargin(
  rows: readonly CommissionTariffRow[],
  prev: SelectionMap,
  targetPct: number,
  strategy: TargetStrategy,
): SelectionMap {
  const next = { ...prev };
  for (const row of rows) {
    let chosen: PriceBand | undefined;
    for (const band of row.bands) {
      if (band.marginPct === null || Number(band.marginPct) < targetPct) continue;
      if (chosen === undefined) {
        chosen = band;
        continue;
      }
      const better =
        strategy === 'least-drop'
          ? new Decimal(band.price).greaterThan(chosen.price)
          : (bandProfit(band) ?? new Decimal(0)).greaterThan(bandProfit(chosen) ?? new Decimal(0));
      if (better) chosen = band;
    }
    if (chosen !== undefined) next[row.id] = chosen.key;
  }
  return next;
}

/** Clear the chosen band for the given rows. */
export function clearSelections(
  rows: readonly CommissionTariffRow[],
  prev: SelectionMap,
): SelectionMap {
  const next = { ...prev };
  for (const row of rows) delete next[row.id];
  return next;
}

export interface TariffFilterState {
  query: string;
  category: string | null;
  brand: string | null;
  /** Show only rows whose best-band margin ≥ this percent. */
  minMarginPct: number | null;
  profit: ProfitFilter;
  selection: SelectionFilter;
}

export function filterRows(
  rows: readonly CommissionTariffRow[],
  selection: SelectionMap,
  filters: TariffFilterState,
): CommissionTariffRow[] {
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

    const best = bestBand(row);
    const bestMargin = best?.marginPct ?? null;
    const bestProfit = best !== undefined ? bandProfit(best) : null;
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

    const chosen = selection[row.id];
    const isSelected = chosen !== undefined && chosen !== null;
    if (filters.selection === 'selected' && !isSelected) return false;
    if (filters.selection === 'unselected' && isSelected) return false;

    return true;
  });
}
