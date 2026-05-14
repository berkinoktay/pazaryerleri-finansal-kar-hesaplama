import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';

/**
 * Result of resolving a store + (category[, brand]) + segment to a single
 * effective commission rate. `paymentTermDays` comes from the row that
 * produced the winning rate (segment overrides do NOT have their own term —
 * they override commission only, not vade).
 */
export interface ResolvedCommissionRate {
  rate: Decimal;
  paymentTermDays: number;
  ruleSource: 'category' | 'category_brand';
  segmentApplied: string | null;
}

/**
 * Trendyol FAQ rule (paraphrased from the seller help center):
 * > Komisyon = kategori × marka × satıcı seviyesi × satıcı grubu boyutlarının
 * > çapraz çarpımı. Bir ürün için birden fazla kriter eşleşirse, en düşük
 * > komisyon uygulanır.
 *
 * This function reproduces that resolution: it collects every candidate
 * rate that matches the (storeId, categoryId, brandId, sellerSegment)
 * combination and returns the one with the lowest `rate`. The candidate
 * pool is:
 *   1. The kategori-only base rate (if a CATEGORY rule exists)
 *   2. The kategori-only segment override for `sellerSegment` (if present)
 *   3. The kategori+marka base rate (if `brandId` provided and a CATEGORY_BRAND rule exists)
 *   4. The kategori+marka segment override for `sellerSegment` (if present)
 *
 * Returns `null` if no rule matches at all (caller decides: warn + fallback
 * to platform default, or refuse to compute profit).
 *
 * Uses `findFirst` instead of `findUnique` because the underlying composite
 * unique on the table is `(store_id, rule_kind, category_id, brand_id)` and
 * Postgres treats NULL brand_id as DISTINCT by default — `findUnique` with
 * a null branding would be cleaner if we had `NULLS NOT DISTINCT`, but we
 * don't, so findFirst is safer.
 */
export async function resolveCommissionRate(args: {
  storeId: string;
  categoryId: bigint;
  brandId: bigint | null;
  sellerSegment: string | null;
}): Promise<ResolvedCommissionRate | null> {
  const { storeId, categoryId, brandId, sellerSegment } = args;
  const candidates: ResolvedCommissionRate[] = [];

  // Kategori-only
  const catRule = await prisma.marketplaceCommissionRate.findFirst({
    where: { storeId, ruleKind: 'CATEGORY', categoryId, brandId: null },
  });
  if (catRule !== null) {
    candidates.push({
      rate: catRule.baseRate,
      paymentTermDays: catRule.paymentTermDays,
      ruleSource: 'category',
      segmentApplied: null,
    });
    if (sellerSegment !== null) {
      const overrides = (catRule.segmentOverrides ?? {}) as Record<string, string>;
      const override = overrides[sellerSegment];
      if (override !== undefined) {
        candidates.push({
          rate: new Decimal(override),
          paymentTermDays: catRule.paymentTermDays,
          ruleSource: 'category',
          segmentApplied: sellerSegment,
        });
      }
    }
  }

  // Kategori+marka (only if brand provided)
  if (brandId !== null) {
    const cbRule = await prisma.marketplaceCommissionRate.findFirst({
      where: { storeId, ruleKind: 'CATEGORY_BRAND', categoryId, brandId },
    });
    if (cbRule !== null) {
      candidates.push({
        rate: cbRule.baseRate,
        paymentTermDays: cbRule.paymentTermDays,
        ruleSource: 'category_brand',
        segmentApplied: null,
      });
      if (sellerSegment !== null) {
        const overrides = (cbRule.segmentOverrides ?? {}) as Record<string, string>;
        const override = overrides[sellerSegment];
        if (override !== undefined) {
          candidates.push({
            rate: new Decimal(override),
            paymentTermDays: cbRule.paymentTermDays,
            ruleSource: 'category_brand',
            segmentApplied: sellerSegment,
          });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((min, c) => (c.rate.lt(min.rate) ? c : min));
}
