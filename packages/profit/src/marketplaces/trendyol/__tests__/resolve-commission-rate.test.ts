import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  makeTrendyolItemAttributes,
  trendyolReference,
  type MakeTrendyolBandParams,
} from '../../../__tests__/fixtures/trendyol-reference';
import {
  resolveTrendyolCommissionRate,
  type ResolvedTrendyolCommissionRate,
} from '../resolve-commission-rate';
import { type TrendyolItemAttributes } from '../trendyol-inputs';

const rules = trendyolReference().commission;

function resolve(
  item: TrendyolItemAttributes,
  unitCommissionBase: string,
): ResolvedTrendyolCommissionRate | null {
  return resolveTrendyolCommissionRate({
    item,
    unitCommissionBase: new Decimal(unitCommissionBase),
    rules,
  });
}

const THREE_BANDS: readonly MakeTrendyolBandParams[] = [
  { lowerLimit: '300', upperLimit: null, ratePct: '19' },
  { lowerLimit: '250', upperLimit: '300', ratePct: '15' },
  { lowerLimit: null, upperLimit: '250', ratePct: '12' },
];

describe('resolveTrendyolCommissionRate', () => {
  it('applies an explicit zero commission override', () => {
    // A non-null override wins the whole chain and is applied verbatim, zero included,
    // ahead of the order rate it is given alongside. Source is OVERRIDE, not ORDER.
    const result = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        commissionRatePctOverride: '0',
        orderCommissionRatePct: '19',
        syncedCommissionRatePct: '17.5',
      }),
      '280',
    );
    expect(result).not.toBeNull();
    expect(result?.ratePct.toString()).toBe('0');
    expect(result?.source).toBe('OVERRIDE');
  });

  it('keeps treating a synced zero rate as unknown', () => {
    // Phase 2A rule: Trendyol sends 0 when it does not know the rate, so a synced 0
    // is "not received" and falls through to the category rule, unlike an override 0.
    const result = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        orderCommissionRatePct: null,
        syncedCommissionRatePct: '0',
        categoryId: '369',
        brandId: null,
      }),
      '100',
    );
    expect(result?.ratePct.toString()).toBe('20');
    expect(result?.source).toBe('CATEGORY');
  });

  it('uses a positive order rate', () => {
    const result = resolve(makeTrendyolItemAttributes({ orderItemId: 'a' }), '280');
    expect(result).not.toBeNull();
    expect(result?.ratePct.toString()).toBe('19');
    expect(result?.source).toBe('ORDER');
  });

  it('treats a zero or missing order rate as not sent', () => {
    const zero = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        orderCommissionRatePct: '0',
        syncedCommissionRatePct: '17.5',
        categoryId: null,
      }),
      '280',
    );
    expect(zero?.ratePct.toString()).toBe('17.5');
    expect(zero?.source).toBe('PRODUCT_SYNC');

    const missing = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        orderCommissionRatePct: null,
        syncedCommissionRatePct: '17.5',
        categoryId: null,
      }),
      '280',
    );
    expect(missing?.ratePct.toString()).toBe('17.5');
    expect(missing?.source).toBe('PRODUCT_SYNC');
  });

  it('picks the tariff band that contains the unit price', () => {
    const item = makeTrendyolItemAttributes({
      orderItemId: 'a',
      orderCommissionRatePct: null,
      tariffBands: THREE_BANDS,
    });

    const mid = resolve(item, '280');
    expect(mid?.ratePct.toString()).toBe('15');
    expect(mid?.source).toBe('TARIFF_BAND');

    const low = resolve(item, '100');
    expect(low?.ratePct.toString()).toBe('12');
    expect(low?.source).toBe('TARIFF_BAND');
  });

  it('resolves a price on a shared band boundary to the band listed first', () => {
    const item = makeTrendyolItemAttributes({
      orderItemId: 'a',
      orderCommissionRatePct: null,
      tariffBands: THREE_BANDS,
    });

    const result = resolve(item, '300');
    expect(result?.ratePct.toString()).toBe('19');
    expect(result?.source).toBe('TARIFF_BAND');
  });

  it('falls back to the synced product rate when no band contains the price', () => {
    const item = makeTrendyolItemAttributes({
      orderItemId: 'a',
      orderCommissionRatePct: null,
      tariffBands: [{ lowerLimit: '300', upperLimit: null, ratePct: '19' }],
      syncedCommissionRatePct: '17.5',
    });

    const result = resolve(item, '100');
    expect(result?.ratePct.toString()).toBe('17.5');
    expect(result?.source).toBe('PRODUCT_SYNC');
  });

  it('falls back to the lowest category rule', () => {
    const withBrand = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        orderCommissionRatePct: null,
        categoryId: '369',
        brandId: '977855',
      }),
      '100',
    );
    expect(withBrand?.ratePct.toString()).toBe('16.5');
    expect(withBrand?.source).toBe('CATEGORY_BRAND');

    const withoutBrand = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        orderCommissionRatePct: null,
        categoryId: '369',
        brandId: null,
      }),
      '100',
    );
    expect(withoutBrand?.ratePct.toString()).toBe('20');
    expect(withoutBrand?.source).toBe('CATEGORY');
  });

  it('returns null when nothing applies', () => {
    const result = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        orderCommissionRatePct: null,
        categoryId: null,
        brandId: null,
      }),
      '100',
    );
    expect(result).toBeNull();
  });
});
