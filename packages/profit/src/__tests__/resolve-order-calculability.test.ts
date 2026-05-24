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

  it('returns skip variant_not_found when first line variant is null', () => {
    const result = resolveOrderCalculability([
      { barcode: 'A', variantId: null, unitCostSnapshotNet: null },
      { barcode: 'B', variantId: 'v2', unitCostSnapshotNet: '8.00' },
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'variant_not_found', barcode: 'A' });
  });

  it('returns skip cost_missing when variant exists but cost null', () => {
    const result = resolveOrderCalculability([
      { barcode: 'A', variantId: 'v1', unitCostSnapshotNet: '12.50' },
      { barcode: 'B', variantId: 'v2', unitCostSnapshotNet: null },
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'cost_missing', barcode: 'B', variantId: 'v2' });
  });

  it('variant_not_found wins when both fail on the same line', () => {
    const result = resolveOrderCalculability([
      { barcode: 'A', variantId: null, unitCostSnapshotNet: null },
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'variant_not_found', barcode: 'A' });
  });

  it('returns calculable for empty lines (edge case — order with zero items)', () => {
    const result = resolveOrderCalculability([]);
    expect(result).toEqual({ kind: 'calculable' });
  });
});
