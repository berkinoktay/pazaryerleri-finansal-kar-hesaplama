import { type FilterRow } from '@/lib/advanced-filter';

import type { ProfitFilter, SelectionFilter, TariffFilterState } from './bulk-actions';

// Stable field keys for the tariff-detail advanced-filter catalog. The catalog
// with localized labels + period-derived category/brand options lives in
// useTariffFilterFields(); these keys are the contract the adapters below map
// to/from the feature's TariffFilterState (query stays with SearchInput).
export const TARIFF_FILTER_FIELDS = {
  category: 'category',
  brand: 'brand',
  minMargin: 'minMargin',
  profit: 'profit',
  selection: 'selection',
} as const;

const PROFIT_VALUES: readonly ProfitFilter[] = ['profitable', 'loss'];
const SELECTION_VALUES: readonly SelectionFilter[] = ['selected', 'unselected'];

function isProfitValue(value: string): value is Exclude<ProfitFilter, 'all'> {
  return (PROFIT_VALUES as readonly string[]).includes(value);
}

function isSelectionValue(value: string): value is Exclude<SelectionFilter, 'all'> {
  return (SELECTION_VALUES as readonly string[]).includes(value);
}

/** TariffFilterState → FilterRow[] — the tri-states' 'all' means "no chip". */
export function tariffRowsFromFilterState(filters: TariffFilterState): FilterRow[] {
  const rows: FilterRow[] = [];
  if (filters.category !== null) {
    rows.push({
      id: TARIFF_FILTER_FIELDS.category,
      field: TARIFF_FILTER_FIELDS.category,
      operator: 'eq',
      value: filters.category,
    });
  }
  if (filters.brand !== null) {
    rows.push({
      id: TARIFF_FILTER_FIELDS.brand,
      field: TARIFF_FILTER_FIELDS.brand,
      operator: 'eq',
      value: filters.brand,
    });
  }
  if (filters.minMarginPct !== null) {
    rows.push({
      id: TARIFF_FILTER_FIELDS.minMargin,
      field: TARIFF_FILTER_FIELDS.minMargin,
      operator: 'gte',
      value: String(filters.minMarginPct),
    });
  }
  if (filters.profit !== 'all') {
    rows.push({
      id: TARIFF_FILTER_FIELDS.profit,
      field: TARIFF_FILTER_FIELDS.profit,
      operator: 'eq',
      value: filters.profit,
    });
  }
  if (filters.selection !== 'all') {
    rows.push({
      id: TARIFF_FILTER_FIELDS.selection,
      field: TARIFF_FILTER_FIELDS.selection,
      operator: 'eq',
      value: filters.selection,
    });
  }
  return rows;
}

/**
 * FilterRow[] → the chip-owned slice of TariffFilterState. Every dimension is
 * emitted explicitly (null / 'all' when its row is absent) so removing a chip
 * clears it. Non-numeric margin values and unknown enum values degrade to
 * "no filter" — a chip can never look applied while filterRows() ignores it.
 */
export function tariffFilterStateFromRows(rows: FilterRow[]): Omit<TariffFilterState, 'query'> {
  const next: Omit<TariffFilterState, 'query'> = {
    category: null,
    brand: null,
    minMarginPct: null,
    profit: 'all',
    selection: 'all',
  };
  for (const filterRow of rows) {
    const scalar = Array.isArray(filterRow.value) ? filterRow.value[0] : filterRow.value;
    if (scalar === undefined) continue;
    switch (filterRow.field) {
      case TARIFF_FILTER_FIELDS.category:
        next.category = scalar;
        break;
      case TARIFF_FILTER_FIELDS.brand:
        next.brand = scalar;
        break;
      case TARIFF_FILTER_FIELDS.minMargin: {
        const numeric = Number(scalar);
        if (scalar.trim().length > 0 && Number.isFinite(numeric)) next.minMarginPct = numeric;
        break;
      }
      case TARIFF_FILTER_FIELDS.profit:
        if (isProfitValue(scalar)) next.profit = scalar;
        break;
      case TARIFF_FILTER_FIELDS.selection:
        if (isSelectionValue(scalar)) next.selection = scalar;
        break;
    }
  }
  return next;
}
