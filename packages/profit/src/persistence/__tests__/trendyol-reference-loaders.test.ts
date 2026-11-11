/**
 * Integration tests for loadCommissionRulesForCategories (the commission rule loader the
 * order chain and the scenario screens share). They run against the isolated test
 * database: the loader must read only Trendyol rows for the requested categories, so a
 * same-numbered category on another marketplace never leaks into a Trendyol rate.
 *
 * The rule table is platform-global reference data (no tenant), so the tests use
 * category ids no seed carries and delete exactly their own rows before each test and
 * after the suite.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { CommissionRuleKind, Platform } from '@pazarsync/db/enums';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveTrendyolCategoryRate } from '../../marketplaces/trendyol/resolve-commission-rate';
import { loadCommissionRulesForCategories } from '../trendyol-reference-loaders';
import { ensureDbReachable } from './helpers/melontik-parcel';

/** Category ids far outside any seeded reference range, owned by this suite. */
const CATEGORY_WITH_RULES = 990_001n;
const CATEGORY_NOT_REQUESTED = 990_002n;
const CATEGORY_WITHOUT_RULES = 990_003n;
const SUITE_CATEGORY_IDS = [CATEGORY_WITH_RULES, CATEGORY_NOT_REQUESTED, CATEGORY_WITHOUT_RULES];
const BRAND_ID = 977_855n;

async function createRule(params: {
  readonly platform: Platform;
  readonly ruleKind: CommissionRuleKind;
  readonly categoryId: bigint;
  readonly brandId: bigint | null;
  readonly baseRate: string;
}): Promise<void> {
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: params.platform,
      ruleKind: params.ruleKind,
      categoryId: params.categoryId,
      brandId: params.brandId,
      categoryName: 'Suite category',
      parentCategoryName: null,
      brandName: params.brandId === null ? null : 'Suite brand',
      baseRate: new Decimal(params.baseRate),
      paymentTermDays: 60,
      segmentOverrides: {},
      fetchedAt: new Date(),
      sourceScreen: 'CategoryCommissionPaymentTerms',
    },
  });
}

async function deleteSuiteRules(): Promise<void> {
  await prisma.marketplaceCommissionRate.deleteMany({
    where: { categoryId: { in: SUITE_CATEGORY_IDS } },
  });
}

describe('loadCommissionRulesForCategories', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await deleteSuiteRules();
  });

  afterAll(async () => {
    await deleteSuiteRules();
  });

  it('lets a lower brand rule win over the category rule of the same category', async () => {
    await createRule({
      platform: Platform.TRENDYOL,
      ruleKind: CommissionRuleKind.CATEGORY,
      categoryId: CATEGORY_WITH_RULES,
      brandId: null,
      baseRate: '20.00',
    });
    await createRule({
      platform: Platform.TRENDYOL,
      ruleKind: CommissionRuleKind.CATEGORY_BRAND,
      categoryId: CATEGORY_WITH_RULES,
      brandId: BRAND_ID,
      baseRate: '15.00',
    });

    const rules = await loadCommissionRulesForCategories(prisma, {
      categoryIds: [CATEGORY_WITH_RULES],
    });
    const resolved = resolveTrendyolCategoryRate({
      rules,
      categoryId: CATEGORY_WITH_RULES.toString(),
      brandId: BRAND_ID.toString(),
    });

    expect(resolved?.source).toBe('CATEGORY_BRAND');
    expect(resolved?.ratePct.toString()).toBe('15');
  });

  it('ignores another marketplace row that shares the category number', async () => {
    await createRule({
      platform: Platform.TRENDYOL,
      ruleKind: CommissionRuleKind.CATEGORY,
      categoryId: CATEGORY_WITH_RULES,
      brandId: null,
      baseRate: '20.00',
    });
    // Lower Hepsiburada rules on the same category (and brand) must not reach the result.
    await createRule({
      platform: Platform.HEPSIBURADA,
      ruleKind: CommissionRuleKind.CATEGORY,
      categoryId: CATEGORY_WITH_RULES,
      brandId: null,
      baseRate: '5.00',
    });
    await createRule({
      platform: Platform.HEPSIBURADA,
      ruleKind: CommissionRuleKind.CATEGORY_BRAND,
      categoryId: CATEGORY_WITH_RULES,
      brandId: BRAND_ID,
      baseRate: '3.00',
    });

    const rules = await loadCommissionRulesForCategories(prisma, {
      categoryIds: [CATEGORY_WITH_RULES],
    });

    expect(rules.categoryRatePct.get(CATEGORY_WITH_RULES.toString())?.toString()).toBe('20');
    expect(rules.categoryBrandRatePct.size).toBe(0);
    const resolved = resolveTrendyolCategoryRate({
      rules,
      categoryId: CATEGORY_WITH_RULES.toString(),
      brandId: BRAND_ID.toString(),
    });
    expect(resolved?.source).toBe('CATEGORY');
    expect(resolved?.ratePct.toString()).toBe('20');
  });

  it('resolves null for a category that is not in the requested list', async () => {
    await createRule({
      platform: Platform.TRENDYOL,
      ruleKind: CommissionRuleKind.CATEGORY,
      categoryId: CATEGORY_NOT_REQUESTED,
      brandId: null,
      baseRate: '18.00',
    });

    const rules = await loadCommissionRulesForCategories(prisma, {
      categoryIds: [CATEGORY_WITHOUT_RULES],
    });

    expect(
      resolveTrendyolCategoryRate({
        rules,
        categoryId: CATEGORY_NOT_REQUESTED.toString(),
        brandId: null,
      }),
    ).toBeNull();
    expect(
      resolveTrendyolCategoryRate({
        rules,
        categoryId: CATEGORY_WITHOUT_RULES.toString(),
        brandId: null,
      }),
    ).toBeNull();
  });
});
