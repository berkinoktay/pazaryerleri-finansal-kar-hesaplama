import { type FilterRow } from '@/lib/advanced-filter';

import {
  ORDER_STATUSES,
  RECONCILIATION_STATUSES,
  type OrderStatusValue,
  type ReconciliationStatusValue,
} from './orders-filter-parsers';

// Stable field keys for the orders advanced-filter catalog. The catalog with
// localized labels lives in useOrderFilterFields() (a hook, needs next-intl);
// these keys are the contract the adapters below map to/from URL params.
export const ORDER_FILTER_FIELDS = {
  status: 'status',
  reconciliationStatus: 'reconciliationStatus',
  lossOnly: 'lossOnly',
} as const;

function isOrderStatus(value: string): value is OrderStatusValue {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

function isReconciliationStatus(value: string): value is ReconciliationStatusValue {
  return (RECONCILIATION_STATUSES as readonly string[]).includes(value);
}

// The slice of OrdersFilters the advanced-filter chips own. Orders keeps its
// readable individual URL params (?status=DELIVERED) — the chips are DERIVED
// state, adapted both ways by the two functions below. q / from / to / sort /
// costStatus stay outside the chip system (search box, DateRangePicker, tabs).
export interface OrderAdvancedParams {
  status: OrderStatusValue | null;
  reconciliationStatus: ReconciliationStatusValue | null;
  lossOnly: boolean;
}

/**
 * URL params → FilterRow[] for the toolbar's `advancedFilter.value`. Row ids
 * are the field keys — each dimension appears at most once (the add menu hides
 * already-applied fields), so the id is stable across renders and the chip
 * edit popover keeps working through URL round-trips.
 */
export function orderFilterRowsFromParams(params: OrderAdvancedParams): FilterRow[] {
  const rows: FilterRow[] = [];
  if (params.status !== null) {
    rows.push({
      id: ORDER_FILTER_FIELDS.status,
      field: ORDER_FILTER_FIELDS.status,
      operator: 'eq',
      value: params.status,
    });
  }
  if (params.reconciliationStatus !== null) {
    rows.push({
      id: ORDER_FILTER_FIELDS.reconciliationStatus,
      field: ORDER_FILTER_FIELDS.reconciliationStatus,
      operator: 'eq',
      value: params.reconciliationStatus,
    });
  }
  if (params.lossOnly) {
    rows.push({
      id: ORDER_FILTER_FIELDS.lossOnly,
      field: ORDER_FILTER_FIELDS.lossOnly,
      operator: 'isTrue',
      value: '',
    });
  }
  return rows;
}

/**
 * FilterRow[] → URL params for `onApply`. Every dimension is emitted
 * explicitly (null / false when its row is absent) so removing a chip clears
 * the matching param. Enum-invalid values degrade to "no filter" — a chip can
 * never look applied while the query ignores it.
 */
export function orderFilterParamsFromRows(rows: FilterRow[]): OrderAdvancedParams {
  const params: OrderAdvancedParams = { status: null, reconciliationStatus: null, lossOnly: false };
  for (const filterRow of rows) {
    const value = Array.isArray(filterRow.value) ? filterRow.value[0] : filterRow.value;
    switch (filterRow.field) {
      case ORDER_FILTER_FIELDS.status:
        if (value !== undefined && isOrderStatus(value)) params.status = value;
        break;
      case ORDER_FILTER_FIELDS.reconciliationStatus:
        if (value !== undefined && isReconciliationStatus(value)) {
          params.reconciliationStatus = value;
        }
        break;
      case ORDER_FILTER_FIELDS.lossOnly:
        params.lossOnly = filterRow.operator === 'isTrue';
        break;
    }
  }
  return params;
}
