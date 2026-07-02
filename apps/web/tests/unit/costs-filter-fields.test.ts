import { describe, expect, it } from 'vitest';

import {
  costsFilterParamsFromRows,
  costsFilterRowsFromParams,
} from '@/features/costs/lib/costs-filter-fields';

describe('costs filter adapters', () => {
  it('round-trips type + archived', () => {
    const params = { typeFilter: 'SHIPPING', showArchived: true };
    expect(costsFilterParamsFromRows(costsFilterRowsFromParams(params))).toEqual(params);
  });

  it('emits explicit empty values for absent rows', () => {
    expect(costsFilterParamsFromRows([])).toEqual({ typeFilter: '', showArchived: false });
  });

  it('degrades an enum-invalid type to "no filter" — a chip can never lie', () => {
    expect(
      costsFilterParamsFromRows([{ id: 't', field: 'type', operator: 'eq', value: 'Shipping' }]),
    ).toEqual({ typeFilter: '', showArchived: false });
  });
});
