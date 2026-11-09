import { describe, expect, it } from 'vitest';

import {
  makeTrendyolItemAttributes,
  trendyolReference,
} from '../../../__tests__/fixtures/trendyol-reference';
import {
  resolveTrendyolCommissionRate,
  type ResolvedTrendyolCommissionRate,
} from '../resolve-commission-rate';
import { type TrendyolItemAttributes } from '../trendyol-inputs';

const rules = trendyolReference().commission;

function resolve(item: TrendyolItemAttributes): ResolvedTrendyolCommissionRate | null {
  return resolveTrendyolCommissionRate({ item, rules });
}

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
    );
    expect(result?.ratePct.toString()).toBe('20');
    expect(result?.source).toBe('CATEGORY');
  });

  it('uses a positive order rate', () => {
    const result = resolve(makeTrendyolItemAttributes({ orderItemId: 'a' }));
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
    );
    expect(missing?.ratePct.toString()).toBe('17.5');
    expect(missing?.source).toBe('PRODUCT_SYNC');
  });

  it('falls back to the lowest category rule', () => {
    const withBrand = resolve(
      makeTrendyolItemAttributes({
        orderItemId: 'a',
        orderCommissionRatePct: null,
        categoryId: '369',
        brandId: '977855',
      }),
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
    );
    expect(result).toBeNull();
  });
});
