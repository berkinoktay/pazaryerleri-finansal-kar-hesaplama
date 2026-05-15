import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Platform } from '@pazarsync/db';

/**
 * Result of resolving a (platform, categoryId[, brandId][, segment]) lookup
 * to a single effective commission rate. `paymentTermDays` comes from the row
 * that produced the winning rate (segment overrides do NOT have their own
 * term — they override commission only, not vade).
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
 * rate that matches the (platform, categoryId, brandId, sellerSegment)
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
 * Commission rates are global per-platform (NOT per-tenant) — Trendyol's
 * tariff is the same for every seller, so a single shared row set services
 * every store. In practice `sellerSegment` is always passed as `null` today
 * because Trendyol does not expose a seller's segment via API; profit
 * calculation falls back to `base_rate`. The segment-override branches are
 * kept so we're ready the moment Trendyol starts surfacing segment info.
 *
 * Uses `findFirst` because the composite unique on the table is
 * `(platform, rule_kind, category_id, brand_id)` and Postgres treats NULL
 * brand_id as DISTINCT by default — `findUnique` with a null brand_id
 * would be cleaner if we had `NULLS NOT DISTINCT`, but we don't. The seed
 * + import REPLACE contract guarantees no duplicates exist in practice.
 */
export async function resolveCommissionRate(args: {
  platform: Platform;
  categoryId: bigint;
  brandId: bigint | null;
  sellerSegment: string | null;
}): Promise<ResolvedCommissionRate | null> {
  const { platform, categoryId, brandId, sellerSegment } = args;
  const candidates: ResolvedCommissionRate[] = [];

  // Kategori-only
  const catRule = await prisma.marketplaceCommissionRate.findFirst({
    where: { platform, ruleKind: 'CATEGORY', categoryId, brandId: null },
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
      where: { platform, ruleKind: 'CATEGORY_BRAND', categoryId, brandId },
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
