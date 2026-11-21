import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  makeTrendyolItemAttributes,
  trendyolReference,
} from '../../../__tests__/fixtures/trendyol-reference';
import {
  resolveTrendyolCategoryRate,
  resolveTrendyolCommissionRate,
  type ResolvedTrendyolCommissionRate,
} from '../resolve-commission-rate';
import {
  trendyolCategoryBrandKey,
  type TrendyolCommissionRules,
  type TrendyolItemAttributes,
} from '../trendyol-inputs';

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

  it('a captured item resolves its category rung from its own captured rules', () => {
    // The parcel-level maps carry 20 (category 369) and 16.5 (369 + brand 977855). A
    // captured item carries the rates of its capture moment instead; those win.
    const uncaptured = makeTrendyolItemAttributes({
      orderItemId: 'a',
      orderCommissionRatePct: null,
      categoryId: '369',
      brandId: '977855',
    });
    const captured: TrendyolItemAttributes = {
      ...uncaptured,
      capturedCategoryRules: {
        categoryRatePct: new Map([['369', new Decimal('22')]]),
        categoryBrandRatePct: new Map([
          [trendyolCategoryBrandKey('369', '977855'), new Decimal('21')],
        ]),
      },
    };
    const capturedResult = resolve(captured);
    expect(capturedResult?.ratePct.toString()).toBe('21');
    expect(capturedResult?.source).toBe('CATEGORY_BRAND');

    // A captured item without a captured brand rule never falls back to the parcel's
    // brand rule (16.5): only its own captured category rate applies.
    const capturedCategoryOnly = resolve({
      ...uncaptured,
      capturedCategoryRules: {
        categoryRatePct: new Map([['369', new Decimal('22')]]),
        categoryBrandRatePct: new Map(),
      },
    });
    expect(capturedCategoryOnly?.ratePct.toString()).toBe('22');
    expect(capturedCategoryOnly?.source).toBe('CATEGORY');

    // Captured with no rule at all: nothing applies, the parcel maps are not consulted.
    const capturedNoRule = resolve({
      ...uncaptured,
      capturedCategoryRules: { categoryRatePct: new Map(), categoryBrandRatePct: new Map() },
    });
    expect(capturedNoRule).toBeNull();

    // Without the field the item resolves from the parcel maps, as before.
    const uncapturedResult = resolve(uncaptured);
    expect(uncapturedResult?.ratePct.toString()).toBe('16.5');
    expect(uncapturedResult?.source).toBe('CATEGORY_BRAND');

    // The earlier rungs still come first for a captured item.
    const capturedWithSyncedRate = resolve({
      ...captured,
      syncedCommissionRatePct: new Decimal('15'),
    });
    expect(capturedWithSyncedRate?.ratePct.toString()).toBe('15');
    expect(capturedWithSyncedRate?.source).toBe('PRODUCT_SYNC');
  });
});

describe('resolveTrendyolCategoryRate', () => {
  const CATEGORY_ID = '411';
  const BRAND_ID = '16';

  function categoryRules(params: {
    readonly categoryRate: string | null;
    readonly brandRate: string | null;
  }): TrendyolCommissionRules {
    const categoryRatePct = new Map<string, Decimal>();
    const categoryBrandRatePct = new Map<string, Decimal>();
    if (params.categoryRate !== null) {
      categoryRatePct.set(CATEGORY_ID, new Decimal(params.categoryRate));
    }
    if (params.brandRate !== null) {
      categoryBrandRatePct.set(
        trendyolCategoryBrandKey(CATEGORY_ID, BRAND_ID),
        new Decimal(params.brandRate),
      );
    }
    return { categoryRatePct, categoryBrandRatePct };
  }

  it('uses the category rule when it is the only rule', () => {
    const result = resolveTrendyolCategoryRate({
      rules: categoryRules({ categoryRate: '8', brandRate: null }),
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
    });
    expect(result?.ratePct.toString()).toBe('8');
    expect(result?.source).toBe('CATEGORY');
  });

  it('uses the category+brand rule when it is the only rule', () => {
    const result = resolveTrendyolCategoryRate({
      rules: categoryRules({ categoryRate: null, brandRate: '5' }),
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
    });
    expect(result?.ratePct.toString()).toBe('5');
    expect(result?.source).toBe('CATEGORY_BRAND');
  });

  it('picks the category+brand rule when it is lower than the category rule', () => {
    const result = resolveTrendyolCategoryRate({
      rules: categoryRules({ categoryRate: '8', brandRate: '5' }),
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
    });
    expect(result?.ratePct.toString()).toBe('5');
    expect(result?.source).toBe('CATEGORY_BRAND');
  });

  it('picks the category rule when it is lower than the category+brand rule', () => {
    const result = resolveTrendyolCategoryRate({
      rules: categoryRules({ categoryRate: '5', brandRate: '8' }),
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
    });
    expect(result?.ratePct.toString()).toBe('5');
    expect(result?.source).toBe('CATEGORY');
  });

  it('picks the category rule on a tie', () => {
    const result = resolveTrendyolCategoryRate({
      rules: categoryRules({ categoryRate: '8', brandRate: '8' }),
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
    });
    expect(result?.ratePct.toString()).toBe('8');
    expect(result?.source).toBe('CATEGORY');
  });

  it('ignores the category+brand rule when the brand id is null', () => {
    const result = resolveTrendyolCategoryRate({
      rules: categoryRules({ categoryRate: '8', brandRate: '5' }),
      categoryId: CATEGORY_ID,
      brandId: null,
    });
    expect(result?.ratePct.toString()).toBe('8');
    expect(result?.source).toBe('CATEGORY');
  });

  it('returns null when no rule matches', () => {
    const result = resolveTrendyolCategoryRate({
      rules: categoryRules({ categoryRate: null, brandRate: null }),
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
    });
    expect(result).toBeNull();
  });
});
