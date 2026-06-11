import { describe, expect, it } from 'vitest';

import { resolveOrderCalculability } from '../resolve-order-calculability';

describe('resolveOrderCalculability', () => {
  it('returns calculable when every line has variant + cost', () => {
    const result = resolveOrderCalculability([
      { barcode: 'A', variantId: 'v1', unitCostSnapshotNet: '12.50' },
      { barcode: 'B', variantId: 'v2', unitCostSnapshotNet: '8.00' },
    ]);
    expect(result).toEqual({ kind: 'calculable' });
  });

  it('treats a missing variant as cost_missing — the order is still written (spec 2026-06-11)', () => {
    const result = resolveOrderCalculability([
      { barcode: 'A', variantId: null, unitCostSnapshotNet: null },
      { barcode: 'B', variantId: 'v2', unitCostSnapshotNet: '8.00' },
    ]);
    expect(result).toEqual({
      kind: 'skip',
      reason: 'cost_missing',
      barcode: 'A',
      variantId: null,
    });
  });

  it('returns skip cost_missing when variant exists but cost null', () => {
    const result = resolveOrderCalculability([
      { barcode: 'A', variantId: 'v1', unitCostSnapshotNet: '12.50' },
      { barcode: 'B', variantId: 'v2', unitCostSnapshotNet: null },
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'cost_missing', barcode: 'B', variantId: 'v2' });
  });

  it('a line missing both variant and cost maps to cost_missing with a null variantId', () => {
    const result = resolveOrderCalculability([
      { barcode: 'A', variantId: null, unitCostSnapshotNet: null },
    ]);
    expect(result).toEqual({
      kind: 'skip',
      reason: 'cost_missing',
      barcode: 'A',
      variantId: null,
    });
  });

  it('returns calculable for empty lines (edge case — order with zero items)', () => {
    const result = resolveOrderCalculability([]);
    expect(result).toEqual({ kind: 'calculable' });
  });
});
