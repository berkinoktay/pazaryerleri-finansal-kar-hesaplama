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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';

import { createApp } from '@/app';
import { listProductPricing } from '@/services/product-pricing.service';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { countingTransactionClient } from '../../helpers/counting-transaction-client';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

// ─── Fixture building blocks ───────────────────────────────────────────────────

const CATEGORY_ID = 597n;
const BRAND_ID = 2032n;

/** Seed a CATEGORY commission rate so the scenario loader resolves a category rate for the variant. */
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
      dimensionalWeightOverride: new Decimal('3.0'),
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
      dimensionalWeightOverride: new Decimal('3.0'),
    },
  });

  // Attach a TRY cost profile (no FX) to ONLY the calculable variant. The scenario
  // engine reads the profile's VERSION (effective at the scenario date), so seed a
  // single version alongside the profile.
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
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
      vatRate: 20,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
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

  it('leaves delisted and archived variants out of the product pricing list', async () => {
    // The pricing list reads the shared products-page listing scope (LISTED_VARIANT_WHERE:
    // delistedAt null and status not ARCHIVED). A delisted or archived variant must never
    // appear, regardless of calculability.
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Scope Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'scope',
        credentials: 'opaque',
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 9001n,
        productMainId: 'pm-9001',
        title: 'Scope Product',
      },
    });
    const baseVariant = {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      salePrice: new Decimal('100.00'),
      listPrice: new Decimal('100.00'),
      vatRate: 20,
    };
    const onSale = await prisma.productVariant.create({
      data: {
        ...baseVariant,
        platformVariantId: 90010n,
        barcode: 'SC-ONSALE',
        stockCode: 'SC-ONSALE',
        status: ProductVariantStatus.ON_SALE,
      },
    });
    const locked = await prisma.productVariant.create({
      data: {
        ...baseVariant,
        platformVariantId: 90011n,
        barcode: 'SC-LOCKED',
        stockCode: 'SC-LOCKED',
        status: ProductVariantStatus.LOCKED,
      },
    });
    // Archived: excluded by the listing scope (status not ARCHIVED).
    await prisma.productVariant.create({
      data: {
        ...baseVariant,
        platformVariantId: 90012n,
        barcode: 'SC-ARCHIVED',
        stockCode: 'SC-ARCHIVED',
        status: ProductVariantStatus.ARCHIVED,
      },
    });
    // Delisted: still ON_SALE but dropped from Trendyol's feed (delistedAt set) -> excluded.
    await prisma.productVariant.create({
      data: {
        ...baseVariant,
        platformVariantId: 90013n,
        barcode: 'SC-DELISTED',
        stockCode: 'SC-DELISTED',
        status: ProductVariantStatus.ON_SALE,
        delistedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/product-pricing`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;

    // Only the listed variants (ON_SALE + LOCKED) survive the shared scope.
    const ids = body.data.map((r) => r.variantId).sort();
    expect(ids).toEqual([locked.id, onSale.id].sort());
    expect(body.pagination.total).toBe(2);
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
    //
    // Faz 4B: these values are UNCHANGED under the scenario engine. The plan's
    // expected differences all no-op for this fixture: cost VAT equals the sale VAT
    // (B1 is a no-op here), there is no tariff band or synced rate so commission stays
    // the 18% category rule (B3 no-op), net VAT is positive so the default settings
    // (includeStopaj true, includeNegativeNetVat false) do not bite, and per-line kurus
    // rounding lands on the same figures -- so the pins carry over verbatim.
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
      // Two ordered images on product A: the first entry is the primary the row surfaces.
      imageUrls: [PRIMARY_IMAGE_URL, SECONDARY_IMAGE_URL],
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

  // A low-cost (200) and a high-cost (480) profile to drive profitable vs loss. The
  // scenario engine reads the effective VERSION, so each profile carries one.
  async function createCostProfileWithVersion(
    name: string,
    amountGross: string,
  ): Promise<{ id: string }> {
    const created = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name,
        type: 'COGS',
        amountGross: new Decimal(amountGross),
        vatRate: 20,
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: created.id,
        organizationId: org.id,
        version: 1,
        name,
        type: 'COGS',
        amountGross: new Decimal(amountGross),
        vatRate: 20,
        changedFields: [],
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    });
    return created;
  }
  const lowCost = await createCostProfileWithVersion('Low COGS', '200.00');
  const highCost = await createCostProfileWithVersion('High COGS', '480.00');

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
        dimensionalWeightOverride: new Decimal('3.0'),
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

  it('imageUrl is the first imageUrls entry when present, null otherwise', async () => {
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
    //
    // Faz 4B: UNCHANGED under the scenario solver. The solver returns the lowest kurus
    // meeting the 20% margin; for this fixture that is the same 588.74 the old closed
    // form produced (no band splits -- no tariff band here -- and the single net-VAT
    // segment is linear, so the lowest meeting price equals the old half-up price).
    expect(body.price).toBe('588.74');
    // priceDelta = solved − current sale price (588.74 − 500.00 = 88.74), signed.
    expect(body.priceDelta).toBe('88.74');
    expect(body.breakdown).toBeDefined();
    expect(body.breakdown?.netProfit).toBeDefined();
    // netProfit at the solved price should be approximately 20% of solved price GROSS
    expect(Number(body.breakdown?.netProfit)).toBeGreaterThan(0);
  });

  it('solves a markup target: 40% markup → 200 calculable:true with pinned price', async () => {
    const res = await sendQuote(ctx.calculableVariantId, 'markup', '40', ctx.accessToken);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      calculable: boolean;
      price?: string;
      priceDelta?: string;
      breakdown?: Record<string, string | null>;
    };
    expect(body.calculable).toBe(true);

    // ── Golden price guard (derived by hand from the fixture, not the engine) ──────
    // Same fixture as the 20% margin case. Markup is netProfit / costGross; the cost
    // GROSS is a price-independent 200.00, so a 40% markup needs netProfit >= 80.00.
    // Net profit in the NET convention (each line's gross minus its rounded VAT):
    //   netProfit(P) = saleNet − commissionNet − stoppage − 279.65
    //     saleNet      = P − round(P/6)                         [20% sale VAT]
    //     commission   = round(0.18·P); commissionNet = that − round(that/6)
    //     stoppage     = round(saleNet/100)                     [1% of net sale]
    //     279.65       = costNet 166.67 + shipNet 101.99 + psfNet 10.99 (all constant)
    // At P=532.80: saleNet 444.00, commissionNet 79.92, stoppage 4.44 → netProfit 79.99
    //   (markup 39.995% < 40, so 532.80 misses).
    // At P=532.81: saleNet 444.01, commissionNet 79.92, stoppage 4.44 → netProfit 80.00
    //   (markup exactly 40.00% >= 40). 532.81 is the lowest kurus that meets the target.
    expect(body.price).toBe('532.81');
    // priceDelta = solved − current sale price (532.81 − 500.00 = 32.81), signed.
    expect(body.priceDelta).toBe('32.81');
    expect(body.breakdown?.netProfit).toBe('80.00');
    // Quote margins render the stored numeric(12,4) precision: 80.00 / 200 × 100.
    expect(body.breakdown?.costMarkupPct).toBe('40.0000');
    // The solver returns the LOWEST kurus meeting the target, so the target still holds.
    expect(Number(body.breakdown?.costMarkupPct)).toBeGreaterThanOrEqual(40);
  });

  it('solves a profit target: 100 TRY profit → 200 calculable:true with pinned price', async () => {
    const res = await sendQuote(ctx.calculableVariantId, 'profit', '100', ctx.accessToken);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      calculable: boolean;
      price?: string;
      priceDelta?: string;
      breakdown?: Record<string, string | null>;
    };
    expect(body.calculable).toBe(true);

    // ── Golden price guard (derived by hand from the fixture, not the engine) ──────
    // Same netProfit(P) as the markup case above. An absolute profit target of 100.00
    // needs netProfit >= 100.00:
    // At P=562.44: saleNet 468.70, commissionNet 84.37, stoppage 4.69 → netProfit 99.99
    //   (< 100, so 562.44 misses).
    // At P=562.45: saleNet 468.71, commissionNet 84.37, stoppage 4.69 → netProfit 100.00
    //   (= 100). 562.45 is the lowest kurus that meets the target.
    expect(body.price).toBe('562.45');
    // priceDelta = solved − current sale price (562.45 − 500.00 = 62.45), signed.
    expect(body.priceDelta).toBe('62.45');
    expect(body.breakdown?.netProfit).toBe('100.00');
    // Markup at the solved price: netProfit 100.00 / cost 200 × 100 = 50.0000.
    expect(body.breakdown?.costMarkupPct).toBe('50.0000');
    // The solver returns the LOWEST kurus meeting the target, so the target still holds.
    expect(Number(body.breakdown?.netProfit)).toBeGreaterThanOrEqual(100);
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

// -- Scenario-engine behaviours: digital, active tariff band, degradation --
//
// One fixture, four variants in the same category (597, 18% rule), all sharing the
// SENDEOMP / TRENDYOL_CONTRACT store and a single 200 GROSS cost profile (+version):
//   - physical:   desi 3, 18% category commission, shipping + PSF deducted;
//   - digital:    isDigital -- no shipping, no PSF (its profit beats the physical one);
//   - tariffBand: an active 10% tariff band on its barcode -- IGNORED by product pricing,
//   - failing:    a negative desi override that makes the scenario evaluation throw.
// Built once in beforeAll; every test is a read.

const SCENARIO_CATEGORY_ID = 597n;

interface ScenarioEngineCtx {
  accessToken: string;
  orgId: string;
  storeId: string;
  physicalVariantId: string;
  digitalVariantId: string;
  tariffBandVariantId: string;
  failingVariantId: string;
  failingVariant2Id: string;
}

async function setupScenarioEngineFixture(): Promise<ScenarioEngineCtx> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing -- globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Scenario Engine Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'scenario-engine',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  await ensureFeeDefinitions();
  await seedCommissionRate(); // category 597 @ 18%

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9500n,
      productMainId: 'pm-9500',
      title: 'Scenario Product',
      categoryId: SCENARIO_CATEGORY_ID,
      categoryName: 'Gomlek',
      brandId: BRAND_ID,
      brandName: 'Modline',
    },
  });

  // One 200 GROSS cost profile (+version) shared by every variant.
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Scenario',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: org.id,
      version: 1,
      name: 'COGS Scenario',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });

  let seq = 95000n;
  async function makeVariant(
    suffix: string,
    extra: { isDigital?: boolean; dimensionalWeightOverride?: string; salePrice?: string },
  ): Promise<string> {
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: seq++,
        barcode: `BC-${suffix}`,
        stockCode: `STK-${suffix}`,
        salePrice: new Decimal(extra.salePrice ?? '500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: 20,
        isDigital: extra.isDigital ?? false,
        dimensionalWeightOverride:
          extra.dimensionalWeightOverride !== undefined
            ? new Decimal(extra.dimensionalWeightOverride)
            : null,
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
    });
    return variant.id;
  }

  const physicalVariantId = await makeVariant('PHYS', { dimensionalWeightOverride: '3.0' });
  const digitalVariantId = await makeVariant('DIG', { isDigital: true });
  const tariffBandVariantId = await makeVariant('TARIFF', { dimensionalWeightOverride: '3.0' });
  // Two negative sale prices: accepted by the DB (no check constraint) but rejected by
  // the scenario's unit-price validator at evaluation time -- the deterministic way to
  // make exactly these two variants' compute throw while their siblings succeed, so the
  // per-variant failures can be asserted to log once for the whole list.
  const failingVariantId = await makeVariant('FAIL', {
    dimensionalWeightOverride: '3.0',
    salePrice: '-1.00',
  });
  const failingVariant2Id = await makeVariant('FAIL2', {
    dimensionalWeightOverride: '3.0',
    salePrice: '-2.00',
  });

  // An active commission tariff for BC-TARIFF: one band at 10% covering now. Product
  // pricing never consults tariff bands, so this must be ignored (the test proves it).
  const tariff = await prisma.commissionTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Active Tariff' },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      dateRangeLabel: 'covering',
      sortOrder: 0,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2027-01-01T00:00:00Z'),
    },
  });
  await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      barcode: 'BC-TARIFF',
      productTitle: 'Scenario Product',
      currentPrice: new Decimal('500.00'),
      currentCommissionPct: new Decimal('10'),
      bands: [{ key: 'band1', commissionPct: '10' }],
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    physicalVariantId,
    digitalVariantId,
    tariffBandVariantId,
    failingVariantId,
    failingVariant2Id,
  };
}

describe('GET .../product-pricing -- scenario engine (digital / ignored tariff / degradation)', () => {
  let sctx: ScenarioEngineCtx;

  beforeAll(async () => {
    await truncateAll();
    sctx = await setupScenarioEngineFixture();
  }, 60000);

  async function fetchRows(): Promise<PricingRowWire[]> {
    const res = await app.request(
      `/v1/organizations/${sctx.orgId}/stores/${sctx.storeId}/product-pricing?perPage=100`,
      { headers: { Authorization: bearer(sctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as ListResponseWire).data;
  }

  it('prices a digital product without shipping', async () => {
    const rows = await fetchRows();
    const digital = rows.find((r) => r.variantId === sctx.digitalVariantId);
    const physical = rows.find((r) => r.variantId === sctx.physicalVariantId);
    expect(digital?.calculable).toBe(true);
    // A digital variant raises no shipping issue: the status is OK and no cargo deducts.
    expect(digital?.shippingEstimateStatus).toBe('OK');
    expect(digital?.netProfit).not.toBeNull();
    // Neither shipping nor PSF is deducted, so the digital profit beats the physical one.
    expect(Number(digital?.netProfit)).toBeGreaterThan(Number(physical?.netProfit));
  });

  it('ignores an active tariff band on the product pricing list', async () => {
    const rows = await fetchRows();
    const banded = rows.find((r) => r.variantId === sctx.tariffBandVariantId);
    const physical = rows.find((r) => r.variantId === sctx.physicalVariantId);
    expect(banded?.calculable).toBe(true);
    expect(physical?.calculable).toBe(true);
    // Owner decision (2026-11-09): product pricing is not a campaign screen, so it never
    // consults a product tariff band. Both variants share the category (18% rule), cost
    // and shipping, and the "banded" variant's 10% tariff is IGNORED -- so its net profit
    // equals the plain physical variant's, proving the stored tariff changes nothing.
    expect(banded?.netProfit).toBe(physical?.netProfit);
  });

  it('keeps the list up when variants fail to compute and logs the failures once', async () => {
    // Silence + capture the deliberate fallback log so the one-line-per-request rule
    // can be asserted (two failing variants must still produce a single [profit-read]).
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rows = await fetchRows();
      // Every variant is still present (the list always returns 200 -- owner rule).
      expect(rows).toHaveLength(5);
      const failing = rows.find((r) => r.variantId === sctx.failingVariantId);
      const failing2 = rows.find((r) => r.variantId === sctx.failingVariant2Id);
      expect(failing).toBeDefined();
      expect(failing2).toBeDefined();
      // Each negative sale price is rejected by the scenario unit-price validator
      // (assertScenarioUnitPrice), so its evaluation throws and its profit is empty while
      // the row stays. The siblings computed fine -- bad variants did not take the list down.
      expect(failing?.calculable).toBe(false);
      expect(failing?.netProfit).toBeNull();
      expect(failing2?.calculable).toBe(false);
      expect(failing2?.netProfit).toBeNull();
      expect(rows.find((r) => r.variantId === sctx.physicalVariantId)?.calculable).toBe(true);
      expect(rows.find((r) => r.variantId === sctx.digitalVariantId)?.calculable).toBe(true);

      // Two per-variant failures, but the list logs them ONCE (the first error with the
      // failed count) so a systemic failure on a large catalog is not 5 000 log lines.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({ surface: 'product-pricing', orderId: null, failedCount: 2 }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// -- Large catalog: constant query count + wall-time guard --
//
// The list computes EVERY candidate variant, so a 5 000-variant store must still issue
// a constant number of queries (the scenario loader batches all reference reads) and
// finish well under any transaction/timeout ceiling. Two stores (5 and 5 000 variants)
// in one org; the query count for the large store must equal the small store's.

interface LargeCatalogCtx {
  orgId: string;
  smallStoreId: string;
  largeStoreId: string;
}

async function createStoreWithVariants(
  orgId: string,
  name: string,
  externalAccountId: string,
  barcodePrefix: string,
  platformVariantBase: bigint,
  count: number,
): Promise<string> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing -- globalSetup ensureShippingReferenceData must run');
  }
  const store = await prisma.store.create({
    data: {
      organizationId: orgId,
      name,
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId,
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId: store.id,
      platformContentId: platformVariantBase,
      productMainId: `pm-${externalAccountId}`,
      title: `${name} Product`,
      categoryId: SCENARIO_CATEGORY_ID,
      categoryName: 'Gomlek',
    },
  });
  const data = Array.from({ length: count }, (_unused, index) => ({
    organizationId: orgId,
    storeId: store.id,
    productId: product.id,
    platformVariantId: platformVariantBase + BigInt(index),
    barcode: `${barcodePrefix}-${index.toString()}`,
    stockCode: `${barcodePrefix}-${index.toString()}`,
    salePrice: new Decimal('500.00'),
    listPrice: new Decimal('500.00'),
    vatRate: 20,
    dimensionalWeightOverride: new Decimal('3.0'),
  }));
  await prisma.productVariant.createMany({ data });
  return store.id;
}

describe('GET .../product-pricing -- large catalog (constant query count)', () => {
  let lctx: LargeCatalogCtx;

  beforeAll(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    await seedCommissionRate(); // category 597 @ 18%
    const org = await createOrganization();
    const smallStoreId = await createStoreWithVariants(
      org.id,
      'Small',
      'cat-small',
      'BC-S',
      100000n,
      5,
    );
    const largeStoreId = await createStoreWithVariants(
      org.id,
      'Large',
      'cat-large',
      'BC-L',
      1000000n,
      5000,
    );
    lctx = { orgId: org.id, smallStoreId, largeStoreId };
  }, 120000);

  async function countQueries(storeId: string): Promise<number> {
    let queries = 0;
    const counting = countingTransactionClient(prisma, () => {
      queries += 1;
    });
    const { total } = await listProductPricing(counting, lctx.orgId, storeId, {
      page: 1,
      perPage: 100,
    });
    expect(total).toBeGreaterThan(0);
    return queries;
  }

  it('lists five thousand variants with a constant number of queries', async () => {
    const qSmall = await countQueries(lctx.smallStoreId);
    const qLarge = await countQueries(lctx.largeStoreId);
    expect(qSmall).toBeGreaterThan(0);
    // N+1 guard: the scenario loader batches every reference read, so 5 000 variants
    // cost the same number of queries as 5.
    expect(qLarge).toBe(qSmall);

    // Wall time through the real client (reported, not pinned). An N+1 regression --
    // thousands of round-trips -- would blow the generous ceiling below.
    const start = Date.now();
    const { data, total } = await listProductPricing(prisma, lctx.orgId, lctx.largeStoreId, {
      page: 1,
      perPage: 100,
    });
    const elapsedMs = Date.now() - start;
    expect(total).toBe(5000);
    expect(data).toHaveLength(100);
    process.stdout.write(
      `\n[perf] listProductPricing over 5000 variants: ${elapsedMs.toString()} ms (queries: ${qLarge.toString()})\n`,
    );
    expect(elapsedMs).toBeLessThan(30000);
  }, 60000);
});

// -- Version-less cost profile: list and quote agree it is a missing cost --
//
// A variant whose only cost profile has NO version. fetchCostAggregates counts the
// profile (so the old quote pre-gate saw cost OK and ran the solver, which then returned
// NOT_COMPUTABLE -> NOT_CALCULABLE), but the scenario loader DROPS a version-less profile
// so the base carries no cost and the engine raises MISSING_COST. The list already reads
// that (costStatus NO_PROFILES); the quote now reads the same base, so both agree the
// cost is missing. Built once in beforeAll; both requests are reads.

interface VersionlessCostCtx {
  accessToken: string;
  orgId: string;
  storeId: string;
  versionlessVariantId: string;
}

async function setupVersionlessCostFixture(): Promise<VersionlessCostCtx> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing -- globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Versionless Cost Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'versionless-cost',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  await ensureFeeDefinitions();
  await seedCommissionRate(); // category 597 @ 18% -> commission + shipping are OK

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8800n,
      productMainId: 'pm-8800',
      title: 'Versionless Cost Product',
      categoryId: CATEGORY_ID,
      categoryName: 'Gomlek',
      brandId: BRAND_ID,
      brandName: 'Modline',
    },
  });

  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 88000n,
      barcode: 'BC-VERSIONLESS',
      stockCode: 'STK-VERSIONLESS',
      salePrice: new Decimal('500.00'),
      listPrice: new Decimal('500.00'),
      vatRate: 20,
      dimensionalWeightOverride: new Decimal('3.0'),
    },
  });

  // A cost profile (NOT archived, so fetchCostAggregates counts it) with NO version, so
  // the scenario loader drops it and the engine sees no cost.
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Versionless COGS',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    versionlessVariantId: variant.id,
  };
}

describe('.../product-pricing -- version-less cost profile (list + quote agree)', () => {
  let vctx: VersionlessCostCtx;

  beforeAll(async () => {
    await truncateAll();
    vctx = await setupVersionlessCostFixture();
  });

  it('reports a version-less cost profile as missing cost on both the list and the quote', async () => {
    // List: the loader drops the version-less profile, so the row reads NO_PROFILES.
    const listRes = await app.request(
      `/v1/organizations/${vctx.orgId}/stores/${vctx.storeId}/product-pricing?perPage=25`,
      { headers: { Authorization: bearer(vctx.accessToken) } },
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as ListResponseWire;
    const row = listBody.data.find((r) => r.variantId === vctx.versionlessVariantId);
    expect(row).toBeDefined();
    expect(row?.costStatus).toBe('NO_PROFILES');
    expect(row?.calculable).toBe(false);

    // Quote: the cost gate now reads the same base, so it agrees -- NO_COST, not
    // NOT_CALCULABLE (which the fetchCostAggregates pre-gate used to produce).
    const quoteRes = await app.request(
      `/v1/organizations/${vctx.orgId}/stores/${vctx.storeId}/product-pricing/quote`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(vctx.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variantId: vctx.versionlessVariantId,
          target: { type: 'margin', value: '20' },
        }),
      },
    );
    expect(quoteRes.status).toBe(200);
    const quoteBody = (await quoteRes.json()) as {
      calculable: boolean;
      variantId: string;
      reason?: string;
    };
    expect(quoteBody.calculable).toBe(false);
    expect(quoteBody.variantId).toBe(vctx.versionlessVariantId);
    expect(quoteBody.reason).toBe('NO_COST');
  });
});

// -- Zero sale price (owner decision 2026-11-10) -----------------------------
//
// A costed variant whose sale price is 0.00 (most locked or blacklisted products carry
// 0) is not scored: the row is still listed, but not calculable and with empty profit,
// so it drops out of calculableOnly, never reads as a loss and sorts with the
// null-profit rows. Built on the fully-configured store (calculable 57.85 + no-cost).

interface ZeroPriceCtx extends FullySetupCtx {
  zeroPriceVariantId: string;
}

async function setupZeroPriceFixture(): Promise<ZeroPriceCtx> {
  const base = await setupFullyConfiguredStore();

  // Reuse the calculable variant's product and cost profile so the zero-priced variant
  // has every input (cost, shipping, commission) and differs only in its sale price.
  const calculable = await prisma.productVariant.findFirst({
    where: { id: base.calculableVariantId, organizationId: base.orgId, storeId: base.storeId },
    select: { productId: true },
  });
  const costLink = await prisma.productVariantCostProfile.findFirst({
    where: { organizationId: base.orgId, productVariantId: base.calculableVariantId },
    select: { profileId: true },
  });
  if (calculable === null || costLink === null) {
    throw new Error('fully-configured fixture is missing the calculable variant or its cost');
  }

  const zeroPrice = await prisma.productVariant.create({
    data: {
      organizationId: base.orgId,
      storeId: base.storeId,
      productId: calculable.productId,
      platformVariantId: 80012n,
      barcode: 'BC-ZERO',
      stockCode: 'STK-ZERO',
      salePrice: new Decimal('0.00'),
      listPrice: new Decimal('0.00'),
      vatRate: 20,
      dimensionalWeightOverride: new Decimal('3.0'),
    },
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: base.orgId,
      profileId: costLink.profileId,
      productVariantId: zeroPrice.id,
    },
  });

  return { ...base, zeroPriceVariantId: zeroPrice.id };
}

function isListResponseWire(value: unknown): value is ListResponseWire {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    Array.isArray(value.data) &&
    'pagination' in value
  );
}

describe('GET .../product-pricing -- zero sale price', () => {
  let zctx: ZeroPriceCtx;

  beforeAll(async () => {
    await truncateAll();
    zctx = await setupZeroPriceFixture();
  });

  async function fetchRows(query: string): Promise<PricingRowWire[]> {
    const res = await app.request(
      `/v1/organizations/${zctx.orgId}/stores/${zctx.storeId}/product-pricing${query}`,
      { headers: { Authorization: bearer(zctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!isListResponseWire(body)) {
      throw new Error('unexpected product pricing list body');
    }
    return body.data;
  }

  it('does not score a variant whose sale price is zero', async () => {
    // No calculableOnly: the row is listed, not calculable, with empty profit. The three
    // statuses read OK because an unpriced variant's inputs are not checked at all (the
    // fixture happens to have every input); cost is not surfaced.
    const all = await fetchRows('?perPage=25');
    const row = all.find((r) => r.variantId === zctx.zeroPriceVariantId);
    expect(row).toBeDefined();
    expect(row?.salePrice).toBe('0.00');
    expect(row?.netProfit).toBeNull();
    expect(row?.calculable).toBe(false);
    expect(row?.saleMarginPct).toBeNull();
    expect(row?.costMarkupPct).toBeNull();
    expect(row?.cost).toBeNull();
    expect(row?.costStatus).toBe('OK');
    expect(row?.shippingEstimateStatus).toBe('OK');
    expect(row?.commissionStatus).toBe('OK');

    // calculableOnly=true: the zero-priced variant is left out, the scored one stays.
    const calculableIds = (await fetchRows('?calculableOnly=true&perPage=25')).map(
      (r) => r.variantId,
    );
    expect(calculableIds).not.toContain(zctx.zeroPriceVariantId);
    expect(calculableIds).toContain(zctx.calculableVariantId);

    // profitStatus=loss: a zero price never reads as a loss.
    const lossIds = (await fetchRows('?profitStatus=loss&perPage=25')).map((r) => r.variantId);
    expect(lossIds).not.toContain(zctx.zeroPriceVariantId);

    // sortBy=netProfit:asc: it sorts in the null-profit tail, after every scored row
    // (nulls keep the SQL salePrice order, so it may precede the no-cost row there).
    const sorted = await fetchRows('?sortBy=netProfit:asc&perPage=25');
    const zeroIndex = sorted.findIndex((r) => r.variantId === zctx.zeroPriceVariantId);
    const calculableIndex = sorted.findIndex((r) => r.variantId === zctx.calculableVariantId);
    expect(calculableIndex).toBeGreaterThan(-1);
    expect(zeroIndex).toBeGreaterThan(calculableIndex);
    expect(sorted.slice(zeroIndex).every((r) => r.netProfit === null)).toBe(true);
  });
});
