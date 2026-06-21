// Happy-path integration tests for GET .../product-pricing.
//
// The interesting case is `calculable: true`, which requires THREE independent
// inputs to all resolve for a variant:
//   1. cost   → a TRY CostProfile attached via ProductVariantCostProfile (no FX)
//   2. ship   → a store wired to SENDEOMP + TRENDYOL_CONTRACT, variant with desi
//   3. commission → a marketplace_commission_rate row matching the product's
//                   categoryId, plus the four loop-invariant fee definitions
//                   (COMMISSION_INVOICE / STOPPAGE / PLATFORM_SERVICE / SHIPPING)
//
// truncateAll() wipes fee_definitions + marketplace_commission_rate every test
// (they are restored only at teardown), so each test that needs them seeds them
// itself. The shipping reference catalog (carriers + tariffs) is NOT truncated —
// it is ensured once by globalSetup — so SENDEOMP is always present.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

// ─── Fixture building blocks ───────────────────────────────────────────────────

const CATEGORY_ID = 597n;
const BRAND_ID = 2032n;

/** Seed the four loop-invariant fee definitions a calculable variant needs. */
async function seedFeeDefinitions(): Promise<void> {
  await prisma.feeDefinition.createMany({
    data: [
      {
        platform: 'TRENDYOL',
        feeType: 'COMMISSION_INVOICE',
        displayName: 'Komisyon Faturası',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: new Decimal('0'),
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2026-01-01'),
        isRequired: true,
      },
      {
        platform: 'TRENDYOL',
        feeType: 'STOPPAGE',
        displayName: 'Stopaj',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: new Decimal('0.0100'),
        defaultVatRate: new Decimal('0'),
        effectiveFrom: new Date('2026-01-01'),
        isRequired: true,
      },
      {
        platform: 'TRENDYOL',
        feeType: 'PLATFORM_SERVICE',
        displayName: 'Platform Hizmet Bedeli',
        calculationKind: 'FIXED',
        fixedAmountNet: new Decimal('10.99'),
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2026-01-01'),
        isRequired: true,
      },
      {
        platform: 'TRENDYOL',
        feeType: 'SHIPPING',
        displayName: 'Kargo',
        calculationKind: 'FIXED',
        fixedAmountNet: new Decimal('0'),
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2026-01-01'),
        isRequired: true,
      },
    ],
  });
}

/** Seed a CATEGORY commission rate so resolveCommissionRate returns a rate. */
async function seedCommissionRate(): Promise<void> {
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId: CATEGORY_ID,
      brandId: null,
      categoryName: 'Gömlek',
      parentCategoryName: null,
      brandName: null,
      baseRate: new Decimal('18.00'),
      paymentTermDays: 60,
      segmentOverrides: {},
      fetchedAt: new Date(),
      sourceScreen: 'CategoryCommissionPaymentTerms',
    },
  });
}

interface FullySetupCtx {
  accessToken: string;
  orgId: string;
  storeId: string;
  calculableVariantId: string;
  noCostVariantId: string;
}

/**
 * Build an org + store + two variants:
 *   - `calculableVariantId`: cost OK (TRY profile) + shipping OK (desi 3 on a
 *     SENDEOMP / TRENDYOL_CONTRACT store) + commission OK (category rule)
 *   - `noCostVariantId`: same product/category (commission + shipping OK) but
 *     NO cost profile attached → costStatus NO_PROFILES, calculable false
 */
async function setupFullyConfiguredStore(): Promise<FullySetupCtx> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing — globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Pricing Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'pricing-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  // Approved (default) product with a category so commission resolves.
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8001n,
      productMainId: 'pm-8001',
      title: 'Beyaz Keten Gömlek',
      categoryId: CATEGORY_ID,
      categoryName: 'Gömlek',
      brandId: BRAND_ID,
      brandName: 'Modline',
    },
  });

  // Calculable variant: salePrice 500, desi 3 (SENDEOMP desi-3 = 101.99 NET), vat 20.
  const calculableVariant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 80010n,
      barcode: 'BC-CALC',
      stockCode: 'STK-CALC',
      salePrice: new Decimal('500.00'),
      listPrice: new Decimal('500.00'),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
    },
  });

  // No-cost variant: identical shipping + commission inputs but no cost profile.
  const noCostVariant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 80011n,
      barcode: 'BC-NOCOST',
      stockCode: 'STK-NOCOST',
      salePrice: new Decimal('500.00'),
      listPrice: new Decimal('500.00'),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
    },
  });

  // Attach a TRY cost profile (no FX) to ONLY the calculable variant.
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      currency: 'TRY',
      vatRate: 20,
      fxRateMode: 'MANUAL',
    },
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: org.id,
      profileId: profile.id,
      productVariantId: calculableVariant.id,
    },
  });

  await seedFeeDefinitions();
  await seedCommissionRate();

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    calculableVariantId: calculableVariant.id,
    noCostVariantId: noCostVariant.id,
  };
}

// ─── Response wire shape ───────────────────────────────────────────────────────

interface PricingRowWire {
  variantId: string;
  sku: string;
  barcode: string;
  productName: string;
  salePrice: string;
  costStatus: string;
  shippingEstimateStatus: string;
  commissionStatus: string;
  calculable: boolean;
  netProfit: string | null;
  saleMarginPct: string | null;
  costMarkupPct: string | null;
}

interface ListResponseWire {
  data: PricingRowWire[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}

describe('GET /v1/organizations/:orgId/stores/:storeId/product-pricing', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without an auth token', async () => {
    const org = await createOrganization();
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'S',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'no-token',
        credentials: 'opaque',
      },
    });
    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/product-pricing`);
    expect(res.status).toBe(401);
  });

  it('returns an empty list when the store has no approved products', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Empty Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'empty',
        credentials: 'opaque',
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/product-pricing`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toEqual([]);
    expect(body.pagination).toEqual({ page: 1, perPage: 25, total: 0, totalPages: 0 });
  });

  it('returns calculable=true with non-null profit + margin for a fully-set-up variant', async () => {
    const ctx = await setupFullyConfiguredStore();

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;

    const row = body.data.find((r) => r.variantId === ctx.calculableVariantId);
    expect(row).toBeDefined();
    expect(row?.costStatus).toBe('OK');
    expect(row?.shippingEstimateStatus).toBe('OK');
    expect(row?.commissionStatus).toBe('OK');
    expect(row?.calculable).toBe(true);
    // Financial fields are present and parse as decimals (computed in backend).
    expect(row?.netProfit).not.toBeNull();
    expect(row?.saleMarginPct).not.toBeNull();
    expect(Number.isNaN(Number(row?.netProfit))).toBe(false);
    expect(Number.isNaN(Number(row?.saleMarginPct))).toBe(false);
    expect(row?.salePrice).toBe('500.00');
  });

  it('returns a not-calculable row (costStatus NO_PROFILES, null profit) for a variant without cost', async () => {
    const ctx = await setupFullyConfiguredStore();

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;

    const row = body.data.find((r) => r.variantId === ctx.noCostVariantId);
    expect(row).toBeDefined();
    // Shipping + commission are OK (same product/store), only cost is missing.
    expect(row?.shippingEstimateStatus).toBe('OK');
    expect(row?.commissionStatus).toBe('OK');
    expect(row?.costStatus).toBe('NO_PROFILES');
    expect(row?.calculable).toBe(false);
    expect(row?.netProfit).toBeNull();
    expect(row?.saleMarginPct).toBeNull();
    expect(row?.costMarkupPct).toBeNull();
  });

  it('calculableOnly=true hides the not-calculable row while keeping the calculable one', async () => {
    const ctx = await setupFullyConfiguredStore();

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing?calculableOnly=true`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;

    const ids = body.data.map((r) => r.variantId);
    expect(ids).toContain(ctx.calculableVariantId);
    expect(ids).not.toContain(ctx.noCostVariantId);
    expect(body.data.every((r) => r.calculable)).toBe(true);
  });
});
