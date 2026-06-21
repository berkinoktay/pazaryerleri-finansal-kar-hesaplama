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
// Structure rationale: two nested describes with independent lifecycle hooks.
//   "simple" tests: truncateAll in beforeEach (each test starts clean).
//   "fixture-sharing" tests: one beforeAll that truncates and builds the full
//      fixture once, then all tests in the group read from it. This avoids
//      creating a Supabase auth user for every test (each Admin API call takes
//      ~800 ms locally; 4 consecutive calls reliably hit the 5 s timeout).
//
// The shipping reference catalog (carriers + tariffs) is NOT truncated —
// it is ensured once by globalSetup — so SENDEOMP is always present.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

// ─── Fixture building blocks ───────────────────────────────────────────────────

const CATEGORY_ID = 597n;
const BRAND_ID = 2032n;

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
 *
 * Uses ensureFeeDefinitions() (shared helper that reads the real migration SQL)
 * instead of an inline seed to avoid the DRY violation and ensure the test
 * exercises the actual production data shape (platform ALL for STOPPAGE +
 * COMMISSION_INVOICE; platform TRENDYOL for PLATFORM_SERVICE + SHIPPING).
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

  await ensureFeeDefinitions();
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

// ─── Suite ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ensureDbReachable();
});

// ── Simple tests that need a clean DB per test ────────────────────────────────

describe('GET /v1/organizations/:orgId/stores/:storeId/product-pricing — simple cases', () => {
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
});

// ── Tests that share the fully-configured-store fixture ───────────────────────
//
// All fixture-sharing tests run inside a single describe whose beforeAll builds
// the store ONCE. Because there is no outer beforeEach that would truncate the
// DB between tests inside this group, the fixture persists for the whole group.
// Only read operations are performed; no test mutates the shared fixture.

describe('GET /v1/organizations/:orgId/stores/:storeId/product-pricing — fully-configured store', () => {
  let ctx: FullySetupCtx;

  beforeAll(async () => {
    await truncateAll();
    ctx = await setupFullyConfiguredStore();
  });

  it('returns calculable=true with pinned profit + margin for the calculable variant', async () => {
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
    expect(row?.salePrice).toBe('500.00');

    // ── Golden-value guard ────────────────────────────────────────────────────
    // Fixture: salePrice=500 (VAT 20%), cost=200 GROSS (VAT 20%), commission=18%
    // of gross, commissionVAT=20% (ALL/COMMISSION_INVOICE), stoppage=1% of NET
    // sale (ALL/STOPPAGE), SENDEOMP desi-3 → 101.99 NET → 122.39 GROSS (VAT 20%),
    // PSF=10.99 NET → 13.19 GROSS (VAT 20%). netProfit=57.85, margin=11.57%,
    // markup=28.93%. If any formula constant, fee definition, or tariff row
    // changes, this diff makes the breakage explicit rather than silently wrong.
    expect(Number.isFinite(Number(row?.netProfit))).toBe(true);
    expect(Number(row?.netProfit)).toBeGreaterThan(0);
    expect(row?.netProfit).toBe('57.85');
    expect(row?.saleMarginPct).toBe('11.57');
    expect(row?.costMarkupPct).toBe('28.93');
  });

  it('returns a not-calculable row (costStatus NO_PROFILES, null profit) for the no-cost variant', async () => {
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

  it('calculableOnly=true: total/totalPages reflect the UNFILTERED count (v1 caveat)', async () => {
    // Two variants total (calculable + noCost); only one survives the filter.
    // total and totalPages must reflect all 2 variants, not just the 1 shown.
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing?calculableOnly=true`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;

    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.totalPages).toBe(1);
  });

  it('pagination: page 1 returns both variants when calculableOnly is absent', async () => {
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing?page=1&perPage=25`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;

    expect(body.pagination.total).toBe(2);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.perPage).toBe(25);
    expect(body.data).toHaveLength(2);
  });

  it('returns 403 when a user not in the org accesses the same store', async () => {
    // A second user with no membership in this org must get 403 — tenant boundary.
    const outsider = await createAuthenticatedTestUser();
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing`,
      { headers: { Authorization: bearer(outsider.accessToken) } },
    );
    expect(res.status).toBe(403);
  });
});

// ── Quote tests that share the fully-configured-store fixture ─────────────────
//
// These tests re-use the same fixture as the list tests above. The quote tests
// are READ operations; no test mutates the shared fixture. Three cases:
//   1. calculable variant + margin target  → 200 calculable:true, price present
//   2. no-cost variant                     → 200 calculable:false, reason NO_COST
//   3. unreachable margin (95%) on the calculable variant → UNREACHABLE_TARGET
//
// The golden price for the 20% margin case is pinned; if the profit formula,
// fee definitions, or tariff changes, this diff makes the breakage explicit.

describe('POST /v1/organizations/:orgId/stores/:storeId/product-pricing/quote — fully-configured store', () => {
  let ctx: FullySetupCtx;

  beforeAll(async () => {
    await truncateAll();
    ctx = await setupFullyConfiguredStore();
  });

  // Helper: send a POST quote request.
  function sendQuote(variantId: string, type: string, value: string, token: string) {
    return app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing/quote`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ variantId, target: { type, value } }),
      },
    );
  }

  it('happy path: calculable variant + 20% margin target → 200 calculable:true with pinned price', async () => {
    const res = await sendQuote(ctx.calculableVariantId, 'margin', '20', ctx.accessToken);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      calculable: boolean;
      variantId: string;
      price?: string;
      breakdown?: Record<string, string>;
    };
    expect(body.calculable).toBe(true);
    expect(body.variantId).toBe(ctx.calculableVariantId);
    expect(body.price).toBeDefined();

    // ── Golden price guard ─────────────────────────────────────────────────────
    // Fixture: cost=200 GROSS (VAT 20%), commission=18% of GROSS, commissionVAT=20%
    // (ALL/COMMISSION_INVOICE), stoppage=1% of NET sale (ALL/STOPPAGE),
    // SENDEOMP desi-3 → 101.99 NET → 122.39 GROSS (VAT 20%),
    // PSF=10.99 NET → 13.19 GROSS (VAT 20%). Target: margin=20%.
    // solvePriceForTarget produces this price given those economics; if any
    // formula constant, fee definition, or tariff row changes, the diff is explicit.
    // Pinned empirically from first green run: 588.74.
    expect(body.price).toBe('588.74');
    expect(body.breakdown).toBeDefined();
    expect(body.breakdown?.netProfit).toBeDefined();
    // netProfit at the solved price should be approximately 20% of solved price GROSS
    expect(Number(body.breakdown?.netProfit)).toBeGreaterThan(0);
  });

  it('no-cost variant → 200 calculable:false, reason NO_COST', async () => {
    const res = await sendQuote(ctx.noCostVariantId, 'margin', '20', ctx.accessToken);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      calculable: boolean;
      variantId: string;
      reason?: string;
    };
    expect(body.calculable).toBe(false);
    expect(body.variantId).toBe(ctx.noCostVariantId);
    expect(body.reason).toBe('NO_COST');
  });

  it('unreachable margin target (95%) on the calculable variant → calculable:false, reason UNREACHABLE_TARGET', async () => {
    // A 95% margin means only 5% goes to all costs combined — economically
    // impossible given commission ~18% + shipping + PSF alone.
    const res = await sendQuote(ctx.calculableVariantId, 'margin', '95', ctx.accessToken);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      calculable: boolean;
      variantId: string;
      reason?: string;
    };
    expect(body.calculable).toBe(false);
    expect(body.reason).toBe('UNREACHABLE_TARGET');
  });

  it('returns 401 without an auth token', async () => {
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing/quote`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: ctx.calculableVariantId,
          target: { type: 'margin', value: '20' },
        }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('returns 422 INVALID_REFERENCE for a variantId not belonging to this store', async () => {
    const res = await sendQuote(crypto.randomUUID(), 'margin', '20', ctx.accessToken);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_REFERENCE');
  });
});
