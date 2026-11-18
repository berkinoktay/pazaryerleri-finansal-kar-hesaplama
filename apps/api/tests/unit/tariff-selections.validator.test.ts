// The selection routes of both tariff pages take every item of a tariff in one save.
// A tariff stores one item per row in each period of its week, so the body cap is the
// row cap times the most periods a week holds (MAX_TARIFF_ITEMS), not the row cap.

import { describe, expect, it } from 'vitest';

import { UpdateSelectionsBodySchema } from '@/validators/commission-tariff.validator';
import { BoundedCustomPriceSchema, SelectionCustomPriceSchema } from '@/validators/custom-price';
import { UpdatePlusSelectionsBodySchema } from '@/validators/plus-commission-tariff.validator';
import { MAX_TARIFF_ITEMS } from '@/workbooks/tariff-week';

/** `count` distinct, well-formed item ids. */
function itemIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `a1b2c3d4-e5f6-4890-a234-${index.toString().padStart(12, '0')}`,
  );
}

function commissionBody(count: number): unknown {
  return {
    selections: itemIds(count).map((itemId) => ({ itemId, band: 'band2', customPrice: null })),
  };
}

function plusBody(count: number): unknown {
  return {
    selections: itemIds(count).map((itemId) => ({ itemId, selected: true, customPrice: null })),
  };
}

describe('tariff selection body cap', () => {
  it('is 15000: three periods of the 5000-row read cap', () => {
    // Pinned on purpose: a change of the row cap or of the week rule moves the public
    // maxItems of both routes, which the API changelog and the OpenAPI snapshot record.
    expect(MAX_TARIFF_ITEMS).toBe(15_000);
  });

  it('accepts every item of the largest commission tariff and refuses one more', () => {
    expect(UpdateSelectionsBodySchema.safeParse(commissionBody(MAX_TARIFF_ITEMS)).success).toBe(
      true,
    );
    const over = UpdateSelectionsBodySchema.safeParse(commissionBody(MAX_TARIFF_ITEMS + 1));
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['selections']);
  });

  it('accepts every item of the largest Plus tariff and refuses one more', () => {
    expect(UpdatePlusSelectionsBodySchema.safeParse(plusBody(MAX_TARIFF_ITEMS)).success).toBe(true);
    const over = UpdatePlusSelectionsBodySchema.safeParse(plusBody(MAX_TARIFF_ITEMS + 1));
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['selections']);
  });

  it('refuses a custom price wider than the stored column on both pages', () => {
    const itemId = itemIds(1)[0];
    const commission = (customPrice: string): boolean =>
      UpdateSelectionsBodySchema.safeParse({
        selections: [{ itemId, band: 'band2', customPrice }],
      }).success;
    const plus = (customPrice: string): boolean =>
      UpdatePlusSelectionsBodySchema.safeParse({
        selections: [{ itemId, selected: true, customPrice }],
      }).success;

    // numeric(12,2): ten integer digits fit, eleven overflow the column.
    for (const accepts of [commission, plus]) {
      expect(accepts('9999999999.99')).toBe(true);
      expect(accepts('12345678901')).toBe(false);
      expect(accepts('12345678901.50')).toBe(false);
    }
  });
});

describe('stored custom price schemas', () => {
  const bounded = (value: string): boolean => BoundedCustomPriceSchema.safeParse(value).success;
  const selection = (value: string): boolean => SelectionCustomPriceSchema.safeParse(value).success;

  it('take ten integer digits and refuse eleven, with the INVALID_CUSTOM_PRICE code', () => {
    for (const accepts of [bounded, selection]) {
      expect(accepts('9999999999')).toBe(true);
      expect(accepts('9999999999.99')).toBe(true);
      expect(accepts('12345678901')).toBe(false);
      expect(accepts('12345678901.50')).toBe(false);
    }
    const over = BoundedCustomPriceSchema.safeParse('12345678901');
    expect(over.error?.issues.map((issue) => issue.message)).toEqual(['INVALID_CUSTOM_PRICE']);
  });

  it('let a zero price through the bounded schema only; the tariff selection refuses it', () => {
    for (const zero of ['0', '0.00', '000']) {
      expect(bounded(zero)).toBe(true);
      expect(selection(zero)).toBe(false);
    }
  });
});
