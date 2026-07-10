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
      storeId: store.id,
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
  imageUrl: string | null;
  cost: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
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

  it('calculableOnly=true: total/totalPages reflect the FILTERED count (in-memory pipeline)', async () => {
    // Two variants total (calculable + noCost); only one survives the filter.
    // Slice 2.5 Task 3 computes every variant in memory then filters BEFORE the
    // slice, so total/totalPages now reflect the 1 surviving row exactly (the
    // previous v1 caveat — unfiltered total — was removed with the salePrice proxy).
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing?calculableOnly=true`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;

    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
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

// ── In-memory filter / sort / paginate + image/cost (Slice 2.5 Task 3) ────────
//
// A richer fixture: six variants spanning profitable / loss / no-cost across two
// categories + two brands, one product carrying a position-ordered image set.
// All six share the SENDEOMP / TRENDYOL_CONTRACT store (shipping OK) and a
// seeded commission rate per category (commission OK), so calculability is
// driven purely by cost presence/amount:
//   - profitable: cost 200 GROSS  → netProfit > 0
//   - loss:       cost 480 GROSS  → netProfit < 0
//   - no-cost:    no profile      → calculable=false, netProfit null
//
// The fixture is built once in beforeAll; every test is a read.

const CATEGORY_B_ID = 700n;
const BRAND_B_ID = 3100n;
const PRIMARY_IMAGE_URL = 'https://cdn.example.com/p-primary.jpg';
const SECONDARY_IMAGE_URL = 'https://cdn.example.com/p-secondary.jpg';

interface RichFixtureVariants {
  aProfit1: string;
  aProfit2: string;
  aLoss: string;
  aNoCost: string;
  bProfit: string;
  bLoss: string;
}

interface RichFixtureCtx {
  accessToken: string;
  orgId: string;
  storeId: string;
  variants: RichFixtureVariants;
}

/** Seed a CATEGORY commission rate for an arbitrary category so it resolves. */
async function seedCommissionRateFor(categoryId: bigint, categoryName: string): Promise<void> {
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId,
      brandId: null,
      categoryName,
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

async function setupRichFixture(): Promise<RichFixtureCtx> {
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
      name: 'Rich Pricing Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'rich-pricing',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  await ensureFeeDefinitions();
  await seedCommissionRate(); // category A (597)
  await seedCommissionRateFor(CATEGORY_B_ID, 'Pantolon'); // category B (700)

  // Two products: A in category 597/brand 2032, B in category 700/brand 3100.
  const productA = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9001n,
      productMainId: 'pm-9001',
      title: 'A Beyaz Gömlek',
      categoryId: CATEGORY_ID,
      categoryName: 'Gömlek',
      brandId: BRAND_ID,
      brandName: 'Modline',
    },
  });
  const productB = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9002n,
      productMainId: 'pm-9002',
      title: 'Z Siyah Pantolon',
      categoryId: CATEGORY_B_ID,
      categoryName: 'Pantolon',
      brandId: BRAND_B_ID,
      brandName: 'Denimco',
    },
  });

  // Two ordered images on product A — position 0 is the primary the row surfaces.
  await prisma.productImage.createMany({
    data: [
      { organizationId: org.id, productId: productA.id, url: SECONDARY_IMAGE_URL, position: 1 },
      { organizationId: org.id, productId: productA.id, url: PRIMARY_IMAGE_URL, position: 0 },
    ],
  });

  // A low-cost (200) and a high-cost (480) profile to drive profitable vs loss.
  const lowCost = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Low COGS',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      currency: 'TRY',
      vatRate: 20,
      fxRateMode: 'MANUAL',
    },
  });
  const highCost = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'High COGS',
      type: 'COGS',
      amountGross: new Decimal('480.00'),
      currency: 'TRY',
      vatRate: 20,
      fxRateMode: 'MANUAL',
    },
  });

  let seq = 90100n;
  async function makeVariant(
    product: { id: string },
    sku: string,
    profileId: string | null,
  ): Promise<string> {
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: seq++,
        barcode: `BC-${sku}`,
        stockCode: sku,
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: 20,
        dimensionalWeight: new Decimal('3.0'),
      },
    });
    if (profileId !== null) {
      await prisma.productVariantCostProfile.create({
        data: { organizationId: org.id, profileId, productVariantId: variant.id },
      });
    }
    return variant.id;
  }

  // Category A: 2 profitable + 1 loss + 1 no-cost. Category B: 1 profitable + 1 loss.
  const aProfit1 = await makeVariant(productA, 'A-PROFIT-1', lowCost.id);
  const aProfit2 = await makeVariant(productA, 'A-PROFIT-2', lowCost.id);
  const aLoss = await makeVariant(productA, 'A-LOSS', highCost.id);
  const aNoCost = await makeVariant(productA, 'A-NOCOST', null);
  const bProfit = await makeVariant(productB, 'B-PROFIT', lowCost.id);
  const bLoss = await makeVariant(productB, 'B-LOSS', highCost.id);

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    variants: { aProfit1, aProfit2, aLoss, aNoCost, bProfit, bLoss },
  };
}

describe('GET .../product-pricing — in-memory filter/sort/paginate + image/cost', () => {
  let ctx: RichFixtureCtx;

  beforeAll(async () => {
    await truncateAll();
    ctx = await setupRichFixture();
  });

  function listUrl(query: string): string {
    return `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/product-pricing${query}`;
  }

  async function fetchList(query: string): Promise<ListResponseWire> {
    const res = await app.request(listUrl(query), {
      headers: { Authorization: bearer(ctx.accessToken) },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ListResponseWire;
  }

  it('no filter: returns all six variants with an exact total', async () => {
    const body = await fetchList('?perPage=25');
    expect(body.data).toHaveLength(6);
    expect(body.pagination.total).toBe(6);
  });

  it('profitStatus=profitable: only netProfit>0 rows, total is the FILTERED count', async () => {
    const body = await fetchList('?profitStatus=profitable&perPage=25');
    // 3 profitable variants (aProfit1, aProfit2, bProfit) out of 6.
    expect(body.pagination.total).toBe(3);
    expect(body.data).toHaveLength(3);
    expect(body.data.every((r) => r.netProfit !== null && Number(r.netProfit) > 0)).toBe(true);
    const ids = body.data.map((r) => r.variantId);
    expect(ids).toContain(ctx.variants.aProfit1);
    expect(ids).toContain(ctx.variants.bProfit);
    expect(ids).not.toContain(ctx.variants.aLoss);
    expect(ids).not.toContain(ctx.variants.aNoCost);
  });

  it('profitStatus=loss: only netProfit<0 rows (no-cost excluded)', async () => {
    const body = await fetchList('?profitStatus=loss&perPage=25');
    expect(body.pagination.total).toBe(2);
    expect(body.data.every((r) => r.netProfit !== null && Number(r.netProfit) < 0)).toBe(true);
    const ids = body.data.map((r) => r.variantId);
    expect(ids).toContain(ctx.variants.aLoss);
    expect(ids).toContain(ctx.variants.bLoss);
    expect(ids).not.toContain(ctx.variants.aNoCost);
  });

  it('marginMin=20 filters out the sub-20% (and null-margin) rows', async () => {
    // Profitable rows have margin 11.57% (< 20), loss rows are negative, no-cost
    // is null — so marginMin=20 yields ZERO rows here, proving the bound applies
    // AND that null margins are excluded.
    const all = await fetchList('?perPage=25');
    const margins = all.data
      .map((r) => (r.saleMarginPct === null ? null : Number(r.saleMarginPct)))
      .filter((m): m is number => m !== null);
    expect(margins.every((m) => m < 20)).toBe(true); // sanity: fixture has no ≥20 margins

    const body = await fetchList('?marginMin=20&perPage=25');
    expect(body.pagination.total).toBe(0);
    expect(body.data).toHaveLength(0);

    // marginMin=-100 keeps every CALCULABLE row (5: 3 profitable + 2 loss) but
    // drops the null-margin no-cost row.
    const wide = await fetchList('?marginMin=-100&perPage=25');
    expect(wide.pagination.total).toBe(5);
    expect(wide.data.every((r) => r.saleMarginPct !== null)).toBe(true);
  });

  it('categoryId=B filters to category-B variants only (SQL filter)', async () => {
    const body = await fetchList(`?categoryId=${CATEGORY_B_ID}&perPage=25`);
    expect(body.pagination.total).toBe(2);
    const ids = body.data.map((r) => r.variantId);
    expect(ids).toContain(ctx.variants.bProfit);
    expect(ids).toContain(ctx.variants.bLoss);
    expect(body.data.every((r) => r.categoryId === CATEGORY_B_ID.toString())).toBe(true);
    expect(body.data.every((r) => r.categoryName === 'Pantolon')).toBe(true);
  });

  it('brandId filters to brand-B variants only (SQL filter)', async () => {
    const body = await fetchList(`?brandId=${BRAND_B_ID}&perPage=25`);
    expect(body.pagination.total).toBe(2);
    expect(body.data.every((r) => r.brandId === BRAND_B_ID.toString())).toBe(true);
    expect(body.data.every((r) => r.brandName === 'Denimco')).toBe(true);
  });

  it('sortBy=netProfit:desc orders by COMPUTED profit with null-profit rows LAST', async () => {
    const body = await fetchList('?sortBy=netProfit:desc&perPage=25');
    expect(body.data).toHaveLength(6);

    // Split at the first null netProfit; everything before is calculable (desc),
    // everything at/after is null. This proves the salePrice-proxy was removed:
    // a salePrice sort would NOT cluster nulls or order by profit.
    const profits = body.data.map((r) => (r.netProfit === null ? null : Number(r.netProfit)));
    const firstNull = profits.indexOf(null);
    expect(firstNull).toBeGreaterThan(-1); // the no-cost row is null

    // Non-null prefix is descending; nulls cluster last.
    const nonNull = profits.slice(0, firstNull).filter((p): p is number => p !== null);
    expect([...nonNull].sort((a, b) => b - a)).toEqual(nonNull);
    expect(profits.slice(firstNull).every((p) => p === null)).toBe(true);

    // The top row is a profitable one; the last row is the no-cost (null) one.
    const last = body.data[body.data.length - 1];
    expect(body.data[0]?.netProfit).not.toBeNull();
    expect(last?.netProfit).toBeNull();
    expect(last?.variantId).toBe(ctx.variants.aNoCost);
  });

  it('sortBy=netProfit:asc orders ascending with null-profit rows still LAST', async () => {
    const body = await fetchList('?sortBy=netProfit:asc&perPage=25');
    const profits = body.data.map((r) => (r.netProfit === null ? null : Number(r.netProfit)));
    const firstNull = profits.indexOf(null);
    const nonNull = profits.slice(0, firstNull).filter((p): p is number => p !== null);
    expect([...nonNull].sort((a, b) => a - b)).toEqual(nonNull);
    // nulls last even on ascending sort
    expect(body.data[body.data.length - 1]?.netProfit).toBeNull();
  });

  it('imageUrl is the position-0 image when present, null otherwise', async () => {
    const body = await fetchList('?perPage=25');
    const withImage = body.data.find((r) => r.variantId === ctx.variants.aProfit1);
    expect(withImage?.imageUrl).toBe(PRIMARY_IMAGE_URL);

    // Category-B product has no images.
    const noImage = body.data.find((r) => r.variantId === ctx.variants.bProfit);
    expect(noImage?.imageUrl).toBeNull();
  });

  it('cost is the GROSS aggregate when costStatus=OK, null for the no-cost row', async () => {
    const body = await fetchList('?perPage=25');
    const profitable = body.data.find((r) => r.variantId === ctx.variants.aProfit1);
    expect(profitable?.costStatus).toBe('OK');
    expect(profitable?.cost).toBe('200.00');

    const noCost = body.data.find((r) => r.variantId === ctx.variants.aNoCost);
    expect(noCost?.costStatus).toBe('NO_PROFILES');
    expect(noCost?.cost).toBeNull();
  });

  it('pagination over a filtered set: total is filtered, page slices correctly', async () => {
    const page1 = await fetchList('?profitStatus=profitable&perPage=10&page=1');
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.totalPages).toBe(1);
    expect(page1.data).toHaveLength(3);

    // page 2 at perPage=10 is past the 3-row filtered set → empty slice, total still 3.
    const page2 = await fetchList('?profitStatus=profitable&perPage=10&page=2');
    expect(page2.pagination.total).toBe(3);
    expect(page2.data).toHaveLength(0);
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
      priceDelta?: string;
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
    // priceDelta = solved − current sale price (588.74 − 500.00 = 88.74), signed.
    expect(body.priceDelta).toBe('88.74');
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
