import type { BandKey, CommissionTariffRow, PriceBand } from '../types';

export type SelectionMap = Record<string, BandKey | null>;

/** Target-margin selection strategy. */
export type TargetStrategy = 'least-drop' | 'max-profit';

/** Best-band-based profit filter. */
export type ProfitFilter = 'all' | 'profitable' | 'loss';

/** Selection-state filter. */
export type SelectionFilter = 'all' | 'selected' | 'unselected';

function bestBand(row: CommissionTariffRow): PriceBand {
  let best: PriceBand = row.bands[0];
  for (const band of row.bands) {
    if (band.profit.greaterThan(best.profit)) best = band;
  }
  return best;
}

/** Apply the most profitable band to every row. */
export function selectBestForAll(
  rows: readonly CommissionTariffRow[],
  prev: SelectionMap,
): SelectionMap {
  const next = { ...prev };
  for (const row of rows) next[row.id] = row.bestBand;
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
    if (best.profit.greaterThan(0)) next[row.id] = best.key;
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
      if (Number(band.marginPct) < targetPct) continue;
      if (chosen === undefined) {
        chosen = band;
        continue;
      }
      const better =
        strategy === 'least-drop'
          ? band.threshold.greaterThan(chosen.threshold)
          : band.profit.greaterThan(chosen.profit);
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
      ![row.productTitle, row.modelCode, row.barcode].some((field) =>
        field.toLocaleLowerCase('tr').includes(query),
      )
    ) {
      return false;
    }
    if (filters.category !== null && row.category !== filters.category) return false;
    if (filters.brand !== null && row.brand !== filters.brand) return false;

    const best = bestBand(row);
    if (filters.minMarginPct !== null && Number(best.marginPct) < filters.minMarginPct)
      return false;
    if (filters.profit === 'profitable' && !best.profit.greaterThan(0)) return false;
    if (filters.profit === 'loss' && best.profit.greaterThan(0)) return false;

    const chosen = selection[row.id];
    const isSelected = chosen !== undefined && chosen !== null;
    if (filters.selection === 'selected' && !isSelected) return false;
    if (filters.selection === 'unselected' && isSelected) return false;

    return true;
  });
}
