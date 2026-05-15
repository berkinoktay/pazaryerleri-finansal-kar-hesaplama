// Integration tests for resolveCommissionRate — runs against the real
// marketplace_commission_rate table because the function does 1-2 Prisma
// findFirst calls and there's no value in mocking Prisma for that volume.
//
// 7-case matrix covers the Trendyol FAQ rule:
//   "Bir ürün için birden fazla kriter eşleşirse en düşük komisyon uygulanır."
//
// Commission rates are platform-scoped reference data (no per-store rows),
// so the resolver takes `platform` not `storeId`.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { resolveCommissionRate } from '../../../src/services/commission-rate-resolver';
import { ensureDbReachable, truncateAll } from '../../helpers/db';

const CATEGORY_ID = BigInt(411);
const BRAND_ID = BigInt(16);

async function seedCategory(
  platform: 'TRENDYOL' | 'HEPSIBURADA',
  baseRate: string,
  segmentOverrides: Record<string, string> = {},
  paymentTermDays = 60,
): Promise<void> {
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform,
      ruleKind: 'CATEGORY',
      categoryId: CATEGORY_ID,
      brandId: null,
      categoryName: 'Casual Ayakkabı',
      parentCategoryName: 'Günlük Ayakkabı',
      brandName: null,
      baseRate: new Decimal(baseRate),
      paymentTermDays,
      segmentOverrides,
      fetchedAt: new Date(),
      sourceScreen: 'CategoryCommissionPaymentTerms',
    },
  });
}

async function seedCategoryBrand(
  platform: 'TRENDYOL' | 'HEPSIBURADA',
  baseRate: string,
  segmentOverrides: Record<string, string> = {},
  paymentTermDays = 60,
): Promise<void> {
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform,
      ruleKind: 'CATEGORY_BRAND',
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
      categoryName: 'Casual Ayakkabı',
      brandName: 'Reebok 10',
      baseRate: new Decimal(baseRate),
      paymentTermDays,
      segmentOverrides,
      fetchedAt: new Date(),
      sourceScreen: 'CommercialRatesByCategoryAndBrand',
    },
  });
}

describe('resolveCommissionRate', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Case 1: nothing seeded → null ─────────────────────────────────────

  it('returns null when no matching rule exists', async () => {
    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
      sellerSegment: null,
    });
    expect(result).toBeNull();
  });

  // ─── Case 2: only kategori-only rule → returns it ──────────────────────

  it('returns kategori-only base rate when no brand rule exists', async () => {
    await seedCategory('TRENDYOL', '8.00');

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
      sellerSegment: null,
    });

    expect(result).not.toBeNull();
    expect(result?.rate.toString()).toBe('8');
    expect(result?.ruleSource).toBe('category');
    expect(result?.segmentApplied).toBeNull();
  });

  // ─── Case 3: both rules → MIN wins ─────────────────────────────────────

  it('picks the lower rate when category and brand rules both match', async () => {
    await seedCategory('TRENDYOL', '8.00');
    await seedCategoryBrand('TRENDYOL', '5.00');

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
      sellerSegment: null,
    });

    expect(result?.rate.toString()).toBe('5');
    expect(result?.ruleSource).toBe('category_brand');
  });

  // ─── Case 4: segment override on cat-only is the lowest ────────────────

  it('applies segment override when it beats all base rates', async () => {
    // Trendyol FAQ MIN: ka2 of cat-only (3.00) is lower than both bases (8, 5)
    // and lower than cat-brand's ka2 (4.00) — so cat-only ka2 wins.
    await seedCategory('TRENDYOL', '8.00', { ka2: '3.00' });
    await seedCategoryBrand('TRENDYOL', '5.00', { ka2: '4.00' });

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
      sellerSegment: 'ka2',
    });

    expect(result?.rate.toString()).toBe('3');
    expect(result?.ruleSource).toBe('category');
    expect(result?.segmentApplied).toBe('ka2');
  });

  // ─── Case 5: sellerSegment null → segment overrides ignored ────────────

  it('ignores segment overrides when sellerSegment is null', async () => {
    // Even though ka2 of cat-only is 3.00 (cheaper), with sellerSegment=null
    // it should NOT be considered. Cat-brand base 5.00 wins over cat 8.00.
    await seedCategory('TRENDYOL', '8.00', { ka2: '3.00' });
    await seedCategoryBrand('TRENDYOL', '5.00', { ka2: '4.00' });

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
      sellerSegment: null,
    });

    expect(result?.rate.toString()).toBe('5');
    expect(result?.segmentApplied).toBeNull();
  });

  // ─── Case 6: brandId null → only cat-only rule considered ──────────────

  it('only considers kategori-only rules when brandId is null', async () => {
    await seedCategory('TRENDYOL', '8.00');
    await seedCategoryBrand('TRENDYOL', '5.00');

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: null,
      sellerSegment: null,
    });

    // 5.00 is cheaper but only available under cat-brand; with brandId null
    // we must not see it.
    expect(result?.rate.toString()).toBe('8');
    expect(result?.ruleSource).toBe('category');
  });

  // ─── Case 7: missing segment key → override skipped, not error ─────────

  it('skips segment override when the seller segment key is not present', async () => {
    await seedCategory('TRENDYOL', '8.00', { ka2: '3.00' });

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: null,
      sellerSegment: 'na1', // not in overrides
    });

    expect(result?.rate.toString()).toBe('8');
    expect(result?.segmentApplied).toBeNull();
  });

  // ─── Bonus: paymentTermDays follows the winning rule's row ─────────────

  it('returns paymentTermDays from the row that produced the winning rate', async () => {
    await seedCategory('TRENDYOL', '8.00', {}, 30);
    await seedCategoryBrand('TRENDYOL', '5.00', {}, 90);

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: BRAND_ID,
      sellerSegment: null,
    });

    // cat-brand wins (5 < 8) → its paymentTerm (90) applies
    expect(result?.rate.toString()).toBe('5');
    expect(result?.paymentTermDays).toBe(90);
  });

  // ─── Cross-platform isolation: HEPSIBURADA rule doesn't bleed into TRENDYOL ─

  it("does not return another platform's rate", async () => {
    await seedCategory('HEPSIBURADA', '1.00');

    const result = await resolveCommissionRate({
      platform: 'TRENDYOL',
      categoryId: CATEGORY_ID,
      brandId: null,
      sellerSegment: null,
    });

    expect(result).toBeNull();
  });
});
