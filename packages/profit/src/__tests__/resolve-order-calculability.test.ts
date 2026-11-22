import { describe, expect, it } from 'vitest';

import {
  hasMissingDesi,
  type OrderLineForCalcCheck,
  resolveOrderCalculability,
} from '../resolve-order-calculability';

// A resolved, costed, non-digital line with a desi: the default fully calculable line.
function line(over: Partial<OrderLineForCalcCheck> & { barcode: string }): OrderLineForCalcCheck {
  return {
    variantId: `v-${over.barcode}`,
    unitCostSnapshotNet: '10.00',
    unitDesi: '1',
    isDigital: false,
    ...over,
  };
}

describe('resolveOrderCalculability', () => {
  it('returns calculable when every line has variant + cost + desi', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: 'v1', unitCostSnapshotNet: '12.50' }),
      line({ barcode: 'B', variantId: 'v2', unitCostSnapshotNet: '8.00' }),
    ]);
    expect(result).toEqual({ kind: 'calculable' });
  });

  it('treats a missing variant as cost_missing — the order is still written (spec 2026-06-11)', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: null, unitCostSnapshotNet: null, unitDesi: null }),
      line({ barcode: 'B', variantId: 'v2', unitCostSnapshotNet: '8.00' }),
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
      line({ barcode: 'A', variantId: 'v1', unitCostSnapshotNet: '12.50' }),
      line({ barcode: 'B', variantId: 'v2', unitCostSnapshotNet: null }),
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'cost_missing', barcode: 'B', variantId: 'v2' });
  });

  it('a line missing both variant and cost maps to cost_missing with a null variantId', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: null, unitCostSnapshotNet: null, unitDesi: null }),
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

  it('a costed line without a desi maps to desi_missing', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: 'v1', unitDesi: null }),
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'desi_missing', barcode: 'A', variantId: 'v1' });
  });

  it('a line missing both cost and desi maps to cost_missing (cost wins)', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: 'v1', unitCostSnapshotNet: null, unitDesi: null }),
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'cost_missing', barcode: 'A', variantId: 'v1' });
  });

  it('multi-line: a desiless line BEFORE an uncosted line still maps to cost_missing', () => {
    // Every line is checked for cost first, so the order of the lines never lets the
    // desi reason win over a cost gap on a later line.
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: 'v1', unitDesi: null }),
      line({ barcode: 'B', variantId: 'v2', unitCostSnapshotNet: null }),
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'cost_missing', barcode: 'B', variantId: 'v2' });
  });

  it('a digital line without a desi does not block the order', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: 'v1', unitDesi: null, isDigital: true }),
      line({ barcode: 'B', variantId: 'v2' }),
    ]);
    expect(result).toEqual({ kind: 'calculable' });
  });

  it('a digital line still needs a cost', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: 'v1', unitCostSnapshotNet: null, isDigital: true }),
    ]);
    expect(result).toEqual({ kind: 'skip', reason: 'cost_missing', barcode: 'A', variantId: 'v1' });
  });

  it('a desi of 0 (a real desi Trendyol sent) does not block the order', () => {
    const result = resolveOrderCalculability([
      line({ barcode: 'A', variantId: 'v1', unitDesi: '0' }),
    ]);
    expect(result).toEqual({ kind: 'calculable' });
  });
});

describe('hasMissingDesi', () => {
  it('is false when every non-digital resolved line has a desi (0 included)', () => {
    expect(
      hasMissingDesi([
        line({ barcode: 'A', unitDesi: '0' }),
        line({ barcode: 'B', unitDesi: '2.5' }),
      ]),
    ).toBe(false);
  });

  it('is true when a resolved non-digital line has no desi', () => {
    expect(hasMissingDesi([line({ barcode: 'A' }), line({ barcode: 'B', unitDesi: null })])).toBe(
      true,
    );
  });

  it('ignores a digital line without a desi', () => {
    expect(hasMissingDesi([line({ barcode: 'A', unitDesi: null, isDigital: true })])).toBe(false);
  });

  it('ignores an unresolved line (its gap is a cost gap, not a desi gap)', () => {
    expect(
      hasMissingDesi([
        line({ barcode: 'A', variantId: null, unitCostSnapshotNet: null, unitDesi: null }),
      ]),
    ).toBe(false);
  });

  it('is false for an order with no lines', () => {
    expect(hasMissingDesi([])).toBe(false);
  });
});
