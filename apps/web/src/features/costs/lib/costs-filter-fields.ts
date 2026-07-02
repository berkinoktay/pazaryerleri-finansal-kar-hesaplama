import { type FilterRow } from '@/lib/advanced-filter';

import { CostProfileType } from '../types/cost-profile.types';

// Stable field keys for the costs advanced-filter catalog — the adapters
// below map to/from the page's filter state (type + archived; search stays
// a client column filter on the toolbar).
export const COSTS_FILTER_FIELDS = {
  type: 'type',
  archived: 'archived',
} as const;

export interface CostsAdvancedParams {
  typeFilter: CostProfileType | '';
  showArchived: boolean;
}

function isCostProfileType(value: string): value is CostProfileType {
  return (Object.values(CostProfileType) as readonly string[]).includes(value);
}

/** Filter state → FilterRow[] (row ids are the field keys — one per dimension). */
export function costsFilterRowsFromParams(params: CostsAdvancedParams): FilterRow[] {
  const rows: FilterRow[] = [];
  if (params.typeFilter.length > 0) {
    rows.push({
      id: COSTS_FILTER_FIELDS.type,
      field: COSTS_FILTER_FIELDS.type,
      operator: 'eq',
      value: params.typeFilter,
    });
  }
  if (params.showArchived) {
    rows.push({
      id: COSTS_FILTER_FIELDS.archived,
      field: COSTS_FILTER_FIELDS.archived,
      operator: 'isTrue',
      value: '',
    });
  }
  return rows;
}

/**
 * FilterRow[] → filter state. Dimensions absent from the set are emitted
 * explicitly (empty / false) so removing a chip clears them; enum-invalid
 * type values degrade to "no filter" — a chip can never lie.
 */
export function costsFilterParamsFromRows(rows: FilterRow[]): CostsAdvancedParams {
  const params: CostsAdvancedParams = { typeFilter: '', showArchived: false };

  for (const filterRow of rows) {
    const scalar = Array.isArray(filterRow.value) ? filterRow.value[0] : filterRow.value;
    switch (filterRow.field) {
      case COSTS_FILTER_FIELDS.type:
        if (scalar !== undefined && isCostProfileType(scalar)) params.typeFilter = scalar;
        break;
      case COSTS_FILTER_FIELDS.archived:
        params.showArchived = filterRow.operator === 'isTrue';
        break;
    }
  }
  return params;
}
