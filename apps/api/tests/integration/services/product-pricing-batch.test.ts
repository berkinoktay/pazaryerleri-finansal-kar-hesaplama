// Focused tests for the Slice 2.5 / Task 1 batch refactor of the product-pricing
// assembly service. Two invariants:
//
//   1. `batchResolveCommission` dedupes by unique (categoryId, brandId): two
//      variants in the SAME category+brand share ONE resolved result (proven by
//      reference identity — the resolver produces one object per call, so an
//      identical reference means a single call), while a variant in a DIFFERENT
//      category gets a distinct result and a null-category variant gets null.
//
//   2. The now-pure `assembleUnitEconomics(ctx, variant, inputs)`, fed with the
//      batch-resolved commission + shipping, yields the SAME econ/statuses as the
//      "live" path (commission via resolveCommissionRate, shipping via
//      estimateShippingCostForVariant) for a calculable AND a no-cost variant.
//      This is the guard that the refactor did not alter any math.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { resolveFeeDefinition } from '@pazarsync/profit';

import { resolveCommissionRate } from '../../../src/services/commission-rate-resolver';
import {
  assembleUnitEconomics,
  batchResolveCommission,
  batchResolveShipping,
} from '../../../src/services/product-pricing.service';
import { fetchCostAggregates } from '../../../src/services/products-list.service';
import { estimateShippingCostForVariant } from '../../../src/services/shipping-estimator.service';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

// Two distinct categories so the dedupe has something to distinguish.
const CATEGORY_A = 597n;
const CATEGORY_B = 720n;
const BRAND_ID = 2032n;
const DEFAULT_VAT_RATE = 20;

async function seedCommissionRate(categoryId: bigint, baseRate: string): Promise<void> {
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId,
      brandId: null,
      categoryName: `Cat-${categoryId.toString()}`,
      parentCategoryName: null,
      brandName: null,
      baseRate: new Decimal(baseRate),
      paymentTermDays: 60,
      segmentOverrides: {},
      fetchedAt: new Date(),
      sourceScreen: 'CategoryCommissionPaymentTerms',
    },
  });
}

interface BatchFixture {
  orgId: string;
  storeId: string;
  platform: 'TRENDYOL';
  // Two variants in CATEGORY_A + BRAND_ID (same pair → dedupe target).
  pairVariant1Id: string;
  pairVariant2Id: string;
  // One variant in CATEGORY_B (different pair).
  otherCategoryVariantId: string;
  // One variant whose product has a null categoryId (no possible match).
  noCategoryVariantId: string;
  // The calculable variant (= pairVariant1) carries a TRY cost profile.
  calculableVariantId: string;
  // A second cost-less variant in CATEGORY_A (= pairVariant2) for the no-cost case.
  noCostVariantId: string;
}

/**
 * Build an org + TRENDYOL store wired to SENDEOMP / TRENDYOL_CONTRACT, with:
 *   - product A (CATEGORY_A, BRAND_ID): two variants, one WITH a TRY cost profile
 *     (calculable) and one WITHOUT (no-cost)
 *   - product B (CATEGORY_B): one variant
 *   - product C (null category): one variant
 * Commission rates seeded for CATEGORY_A and CATEGORY_B; fee defs ensured.
 */
async function setupBatchFixture(): Promise<BatchFixture> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing — globalSetup ensureShippingReferenceData must run');
  }

  const org = await createOrganization();
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Batch Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'batch-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const productA = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9001n,
      productMainId: 'pm-9001',
      title: 'Product A',
      categoryId: CATEGORY_A,
      categoryName: 'Cat-A',
      brandId: BRAND_ID,
      brandName: 'Brand',
    },
  });

  const productB = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9002n,
      productMainId: 'pm-9002',
      title: 'Product B',
      categoryId: CATEGORY_B,
      categoryName: 'Cat-B',
      brandId: BRAND_ID,
      brandName: 'Brand',
    },
  });

  const productC = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9003n,
      productMainId: 'pm-9003',
      title: 'Product C (no category)',
      categoryId: null,
      categoryName: null,
      brandId: null,
      brandName: null,
    },
  });

  async function makeVariant(
    productId: string,
    platformVariantId: bigint,
    suffix: string,
  ): Promise<string> {
    const v = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId,
        platformVariantId,
        barcode: `BC-${suffix}`,
        stockCode: `STK-${suffix}`,
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: DEFAULT_VAT_RATE,
        dimensionalWeight: new Decimal('3.0'),
      },
    });
    return v.id;
  }

  const pairVariant1Id = await makeVariant(productA.id, 90010n, 'A1');
  const pairVariant2Id = await makeVariant(productA.id, 90011n, 'A2');
  const otherCategoryVariantId = await makeVariant(productB.id, 90020n, 'B1');
  const noCategoryVariantId = await makeVariant(productC.id, 90030n, 'C1');

  // Attach a TRY cost profile (no FX) to ONLY pairVariant1 → calculable.
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      currency: 'TRY',
      vatRate: DEFAULT_VAT_RATE,
      fxRateMode: 'MANUAL',
    },
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: org.id,
      profileId: profile.id,
      productVariantId: pairVariant1Id,
    },
  });

  await ensureFeeDefinitions();
  await seedCommissionRate(CATEGORY_A, '18.00');
  await seedCommissionRate(CATEGORY_B, '12.00');

  return {
    orgId: org.id,
    storeId: store.id,
    platform: 'TRENDYOL',
    pairVariant1Id,
    pairVariant2Id,
    otherCategoryVariantId,
    noCategoryVariantId,
    calculableVariantId: pairVariant1Id,
    noCostVariantId: pairVariant2Id,
  };
}

// Variant shape the assembly + batch helpers read.
async function loadVariant(variantId: string): Promise<{
  id: string;
  stockCode: string;
  barcode: string;
  salePrice: Decimal;
  vatRate: number | null;
  isDigital: boolean;
  product: { title: string; categoryId: bigint | null; brandId: bigint | null };
}> {
  const v = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: {
      id: true,
      stockCode: true,
      barcode: true,
      salePrice: true,
      vatRate: true,
      isDigital: true,
      product: { select: { title: true, categoryId: true, brandId: true } },
    },
  });
  return v;
}

let ctx: BatchFixture;

beforeAll(async () => {
  await ensureDbReachable();
  await truncateAll();
  ctx = await setupBatchFixture();
});

describe('batchResolveCommission — dedupe by (categoryId, brandId)', () => {
  it('maps two same-pair variants to ONE shared result (single resolver call), distinct pair distinct, null category null', async () => {
    const variants = [
      { id: ctx.pairVariant1Id, product: { categoryId: CATEGORY_A, brandId: BRAND_ID } },
      { id: ctx.pairVariant2Id, product: { categoryId: CATEGORY_A, brandId: BRAND_ID } },
      { id: ctx.otherCategoryVariantId, product: { categoryId: CATEGORY_B, brandId: BRAND_ID } },
      { id: ctx.noCategoryVariantId, product: { categoryId: null, brandId: null } },
    ];

    const map = await batchResolveCommission(ctx.platform, variants);

    const r1 = map.get(ctx.pairVariant1Id);
    const r2 = map.get(ctx.pairVariant2Id);
    const rOther = map.get(ctx.otherCategoryVariantId);
    const rNull = map.get(ctx.noCategoryVariantId);

    // Same pair → same object reference (proves resolveCommissionRate ran once
    // for the pair; one call produces exactly one object).
    expect(r1).toBeDefined();
    expect(r1).not.toBeNull();
    expect(r1).toBe(r2);
    expect(r1?.rate.toString()).toBe('18');

    // Different category → distinct, non-shared result.
    expect(rOther).toBeDefined();
    expect(rOther).not.toBe(r1);
    expect(rOther?.rate.toString()).toBe('12');

    // Null category → null, no resolver call.
    expect(rNull).toBeNull();
  });

  it('matches resolveCommissionRate exactly for each variant (live equivalence)', async () => {
    const variants = [
      { id: ctx.pairVariant1Id, product: { categoryId: CATEGORY_A, brandId: BRAND_ID } },
      { id: ctx.otherCategoryVariantId, product: { categoryId: CATEGORY_B, brandId: BRAND_ID } },
    ];
    const map = await batchResolveCommission(ctx.platform, variants);

    const liveA = await resolveCommissionRate({
      platform: ctx.platform,
      categoryId: CATEGORY_A,
      brandId: BRAND_ID,
      sellerSegment: null,
    });
    const liveB = await resolveCommissionRate({
      platform: ctx.platform,
      categoryId: CATEGORY_B,
      brandId: BRAND_ID,
      sellerSegment: null,
    });

    expect(map.get(ctx.pairVariant1Id)?.rate.toString()).toBe(liveA?.rate.toString());
    expect(map.get(ctx.otherCategoryVariantId)?.rate.toString()).toBe(liveB?.rate.toString());
  });
});

describe('assembleUnitEconomics (pure) === live path', () => {
  it('calculable variant: batch-resolved inputs yield the same econ + statuses as the live path', async () => {
    const variant = await loadVariant(ctx.calculableVariantId);

    // ── Live path (commission + shipping resolved per-variant) ──────────────
    const liveResult = await prisma.$transaction(async (tx) => {
      const feeDefs = await resolveFeeDefsForTest(tx);
      const costMap = await fetchCostAggregates(ctx.orgId, [variant.id]);
      const commission = await resolveCommissionRate({
        platform: ctx.platform,
        categoryId: CATEGORY_A,
        brandId: BRAND_ID,
        sellerSegment: null,
      });
      const shipping = await estimateShippingCostForVariant(variant.id, tx);
      return assembleUnitEconomics({ platform: ctx.platform, feeDefs }, variant, {
        costAggregate: costMap.get(variant.id),
        commission,
        shipping,
      });
    });

    // ── Batch path (commission + shipping resolved in batch) ────────────────
    const costMap = await fetchCostAggregates(ctx.orgId, [variant.id]);
    const commissionMap = await batchResolveCommission(ctx.platform, [variant]);
    const shippingMap = await batchResolveShipping(ctx.orgId, ctx.storeId, [variant.id]);
    const batchResult = await prisma.$transaction(async (tx) => {
      const feeDefs = await resolveFeeDefsForTest(tx);
      return assembleUnitEconomics({ platform: ctx.platform, feeDefs }, variant, {
        costAggregate: costMap.get(variant.id),
        commission: commissionMap.get(variant.id) ?? null,
        shipping: shippingMap.get(variant.id) ?? { ok: false, reason: 'STORE_NOT_FOUND' },
      });
    });

    expect(batchResult.costStatus).toBe('OK');
    expect(batchResult.shippingStatus).toBe('OK');
    expect(batchResult.commissionStatus).toBe('OK');
    expect(batchResult.econ).not.toBeNull();

    // Statuses match.
    expect(batchResult.costStatus).toBe(liveResult.costStatus);
    expect(batchResult.shippingStatus).toBe(liveResult.shippingStatus);
    expect(batchResult.commissionStatus).toBe(liveResult.commissionStatus);

    // Econ matches field-by-field (Decimal compared as string).
    expect(batchResult.econ?.commissionRate.toString()).toBe(
      liveResult.econ?.commissionRate.toString(),
    );
    expect(batchResult.econ?.cost.gross.toString()).toBe(liveResult.econ?.cost.gross.toString());
    expect(batchResult.econ?.saleVatRate.toString()).toBe(liveResult.econ?.saleVatRate.toString());
    expect(batchResult.econ?.stoppageRate.toString()).toBe(
      liveResult.econ?.stoppageRate.toString(),
    );
    // Fixed fees (shipping + PSF) match in count and amount.
    expect(batchResult.econ?.fixedFees.length).toBe(liveResult.econ?.fixedFees.length);
    const batchShip = batchResult.econ?.fixedFees[0];
    const liveShip = liveResult.econ?.fixedFees[0];
    expect(batchShip?.gross.toString()).toBe(liveShip?.gross.toString());
  });

  it('no-cost variant: both paths report NO_PROFILES + null econ', async () => {
    const variant = await loadVariant(ctx.noCostVariantId);

    const costMap = await fetchCostAggregates(ctx.orgId, [variant.id]);
    const commissionMap = await batchResolveCommission(ctx.platform, [variant]);
    const shippingMap = await batchResolveShipping(ctx.orgId, ctx.storeId, [variant.id]);

    const batchResult = await prisma.$transaction(async (tx) => {
      const feeDefs = await resolveFeeDefsForTest(tx);
      return assembleUnitEconomics({ platform: ctx.platform, feeDefs }, variant, {
        costAggregate: costMap.get(variant.id),
        commission: commissionMap.get(variant.id) ?? null,
        shipping: shippingMap.get(variant.id) ?? { ok: false, reason: 'STORE_NOT_FOUND' },
      });
    });

    const liveResult = await prisma.$transaction(async (tx) => {
      const feeDefs = await resolveFeeDefsForTest(tx);
      const liveCostMap = await fetchCostAggregates(ctx.orgId, [variant.id]);
      const commission = await resolveCommissionRate({
        platform: ctx.platform,
        categoryId: CATEGORY_A,
        brandId: BRAND_ID,
        sellerSegment: null,
      });
      const shipping = await estimateShippingCostForVariant(variant.id, tx);
      return assembleUnitEconomics({ platform: ctx.platform, feeDefs }, variant, {
        costAggregate: liveCostMap.get(variant.id),
        commission,
        shipping,
      });
    });

    // Shipping + commission OK, cost missing → not calculable, null econ.
    expect(batchResult.costStatus).toBe('NO_PROFILES');
    expect(batchResult.shippingStatus).toBe('OK');
    expect(batchResult.commissionStatus).toBe('OK');
    expect(batchResult.econ).toBeNull();

    expect(batchResult.costStatus).toBe(liveResult.costStatus);
    expect(batchResult.shippingStatus).toBe(liveResult.shippingStatus);
    expect(batchResult.commissionStatus).toBe(liveResult.commissionStatus);
    expect(liveResult.econ).toBeNull();
  });
});

// The service keeps `resolveFeeDefs` private; rebuild the same four loop-invariant
// FeeDefinitions here from the public engine resolver so the test feeds the
// assembly the identical fee context the service would.
async function resolveFeeDefsForTest(tx: Parameters<typeof resolveFeeDefinition>[0]): Promise<{
  commissionVatRate: Decimal;
  stoppageRate: Decimal;
  psfNet: Decimal;
  psfVatRate: Decimal;
  shipVatRate: Decimal;
}> {
  const now = new Date();
  const [commissionDef, stoppageDef, psfDef, shipDef] = await Promise.all([
    resolveFeeDefinition(tx, { platform: 'TRENDYOL', feeType: 'COMMISSION_INVOICE', at: now }),
    resolveFeeDefinition(tx, { platform: 'TRENDYOL', feeType: 'STOPPAGE', at: now }),
    resolveFeeDefinition(tx, { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE', at: now }),
    resolveFeeDefinition(tx, { platform: 'TRENDYOL', feeType: 'SHIPPING', at: now }),
  ]);
  if (stoppageDef.rateOfSale === null) throw new Error('STOPPAGE missing rateOfSale');
  if (psfDef.fixedAmountNet === null) throw new Error('PLATFORM_SERVICE missing fixedAmountNet');
  return {
    commissionVatRate: new Decimal(commissionDef.defaultVatRate),
    stoppageRate: new Decimal(stoppageDef.rateOfSale),
    psfNet: new Decimal(psfDef.fixedAmountNet),
    psfVatRate: new Decimal(psfDef.defaultVatRate),
    shipVatRate: new Decimal(shipDef.defaultVatRate),
  };
}
