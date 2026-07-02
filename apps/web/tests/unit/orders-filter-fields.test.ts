import { describe, expect, it } from 'vitest';

import {
  ORDER_FILTER_FIELDS,
  orderFilterParamsFromRows,
  orderFilterRowsFromParams,
} from '@/features/orders/lib/orders-filter-fields';
import type { FilterRow } from '@/lib/advanced-filter';

describe('orderFilterRowsFromParams', () => {
  it('emits no rows when nothing is filtered', () => {
    expect(
      orderFilterRowsFromParams({ status: null, reconciliationStatus: null, lossOnly: false }),
    ).toEqual([]);
  });

  it('emits one row per active dimension with the field key as a stable id', () => {
    const rows = orderFilterRowsFromParams({
      status: 'DELIVERED',
      reconciliationStatus: 'NOT_SETTLED',
      lossOnly: true,
    });
    expect(rows).toEqual([
      { id: 'status', field: 'status', operator: 'eq', value: 'DELIVERED' },
      {
        id: 'reconciliationStatus',
        field: 'reconciliationStatus',
        operator: 'eq',
        value: 'NOT_SETTLED',
      },
      { id: 'lossOnly', field: 'lossOnly', operator: 'isTrue', value: '' },
    ]);
  });
});

describe('orderFilterParamsFromRows', () => {
  it('round-trips the full set', () => {
    const params = {
      status: 'SHIPPED',
      reconciliationStatus: 'FULLY_SETTLED',
      lossOnly: true,
    } as const;
    expect(orderFilterParamsFromRows(orderFilterRowsFromParams(params))).toEqual(params);
  });

  it('emits explicit null/false for absent rows so removing a chip clears its param', () => {
    expect(orderFilterParamsFromRows([])).toEqual({
      status: null,
      reconciliationStatus: null,
      lossOnly: false,
    });
  });

  it('degrades enum-invalid values to "no filter" — a chip can never lie', () => {
    const hostile: FilterRow[] = [
      { id: 'a', field: ORDER_FILTER_FIELDS.status, operator: 'eq', value: 'Delivered' },
      { id: 'b', field: ORDER_FILTER_FIELDS.reconciliationStatus, operator: 'eq', value: 'NOPE' },
    ];
    expect(orderFilterParamsFromRows(hostile)).toEqual({
      status: null,
      reconciliationStatus: null,
      lossOnly: false,
    });
  });
});
