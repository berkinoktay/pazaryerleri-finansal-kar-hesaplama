// Integration tests for the batch scenario path the product-pricing LIST now relies
// on. The list no longer assembles a legacy UnitEconomics per variant; it loads every
// variant's scenario base in one pass (loadTrendyolScenarioBases) and scores each with
// the shared engine (evaluateTrendyolScenario). These tests pin that path for the two
// outcomes the list cares about:
//
//   1. a calculable variant (cost version + shipping + commission all resolved) loads
//      a ready base and evaluates to a net profit with no blocking issue, and its cost
//      gross comes from the attached cost profile version;
//   2. a no-cost variant loads a ready base too (a missing cost is NOT a load failure)
//      but evaluates to a MISSING_COST issue and no net profit.
//
// They replace the old "pure assembly == live path" checks: the assembly helper is
// legacy now, so the equivalence is against the loader + engine the list actually runs.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitIssueCode } from '@pazarsync/db/enums';
import { evaluateTrendyolScenario, loadTrendyolScenarioBases } from '@pazarsync/profit';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const CATEGORY_A = 597n;
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
  calculableVariantId: string;
  noCostVariantId: string;
}

/**
 * Build an org + TRENDYOL store wired to SENDEOMP / TRENDYOL_CONTRACT, with one product
 * (category 597, brand 2032) and two variants: one with a TRY cost profile (and its
 * version, so the engine can cost it) and one without. Commission rate seeded for the
 * category; fee definitions ensured.
 */
async function setupBatchFixture(): Promise<BatchFixture> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing -- globalSetup ensureShippingReferenceData must run');
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

  const product = await prisma.product.create({
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

  async function makeVariant(platformVariantId: bigint, suffix: string): Promise<string> {
    const v = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId,
        barcode: `BC-${suffix}`,
        stockCode: `STK-${suffix}`,
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: DEFAULT_VAT_RATE,
        dimensionalWeightOverride: new Decimal('3.0'),
      },
    });
    return v.id;
  }

  const calculableVariantId = await makeVariant(90010n, 'CALC');
  const noCostVariantId = await makeVariant(90011n, 'NOCOST');

  // Attach a TRY cost profile + version to ONLY the calculable variant.
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: DEFAULT_VAT_RATE,
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: org.id,
      version: 1,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: DEFAULT_VAT_RATE,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: calculableVariantId },
  });

  await ensureFeeDefinitions();
  await seedCommissionRate(CATEGORY_A, '18.00');

  return { orgId: org.id, storeId: store.id, calculableVariantId, noCostVariantId };
}

let ctx: BatchFixture;

beforeAll(async () => {
  await ensureDbReachable();
  await truncateAll();
  ctx = await setupBatchFixture();
});

describe('loadTrendyolScenarioBases + evaluateTrendyolScenario -- the list scenario path', () => {
  it('scores a calculable variant to a net profit with no blocking issue and the attached cost', async () => {
    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      scenarioDate: new Date(),
      variants: [{ variantId: ctx.calculableVariantId }],
    });

    const loaded = bases.get(ctx.calculableVariantId);
    expect(loaded?.kind).toBe('ready');
    if (loaded?.kind !== 'ready') throw new Error('expected a ready base');

    const { statement } = evaluateTrendyolScenario({
      ...loaded.base,
      unitPrice: new Decimal('500.00'),
    });

    // Cost, shipping and commission all resolved -> a net profit and no blocking issue.
    expect(statement.netProfit).not.toBeNull();
    expect(statement.issues).toHaveLength(0);
    // The cost gross comes from the attached profile version (200.00 GROSS).
    expect(statement.costGross.toFixed(2)).toBe('200.00');
  });

  it('loads a ready base for a no-cost variant but evaluates it to a MISSING_COST issue', async () => {
    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      scenarioDate: new Date(),
      variants: [{ variantId: ctx.noCostVariantId }],
    });

    const loaded = bases.get(ctx.noCostVariantId);
    // A missing cost is not a load failure: the base loads, the gap shows on evaluation.
    expect(loaded?.kind).toBe('ready');
    if (loaded?.kind !== 'ready') throw new Error('expected a ready base');

    const { statement } = evaluateTrendyolScenario({
      ...loaded.base,
      unitPrice: new Decimal('500.00'),
    });

    expect(statement.netProfit).toBeNull();
    expect(statement.issues.some((issue) => issue.code === ProfitIssueCode.MISSING_COST)).toBe(
      true,
    );
  });

  it('loads both variants in a single pass', async () => {
    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      scenarioDate: new Date(),
      variants: [{ variantId: ctx.calculableVariantId }, { variantId: ctx.noCostVariantId }],
    });

    expect(bases.size).toBe(2);
    expect(bases.get(ctx.calculableVariantId)?.kind).toBe('ready');
    expect(bases.get(ctx.noCostVariantId)?.kind).toBe('ready');
  });
});
