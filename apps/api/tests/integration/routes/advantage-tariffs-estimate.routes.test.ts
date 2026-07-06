// Happy-path integration tests for the Advantage tariff item estimate endpoint.
//
// The estimate runs the SAME profit engine + resolvers the detail view uses, at
// the requested price, resolving the reduced commission from the band that price
// lands in (of the store's commission tariff), else the category rate — so the
// breakdown modal never disagrees with the tier badge. The `scenario: "current"`
// mode prices the item's customer price at its current commission and MUST equal the
// detail row's `current` breakdown byte-for-byte — proven for BOTH commission
// sources (a band-matched item and a category-fallback item). An unmatched item
// degrades to not-calculable; an invalid or mode-contradictory price is a 422; a
// foreign item id is 404.
//
// Fixture mirrors advantage-tariffs.routes.test.ts: one calculable band-matched
// variant (TRY cost + SENDEOMP shipping + fee defs) with an active-period commission
// tariff whose bands cover it, one calculable category-fallback variant (its barcode
// is NOT in the commission tariff, so the commission comes from a category rate rule),
// plus an unmatched item.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const MATCHED_BARCODE = 'ADV-EST';
const MATCHED_BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '280.00', upperLimit: '299.99', commissionPct: '13.1' },
  { key: 'band3', lowerLimit: '250.00', upperLimit: '279.99', commissionPct: '11.5' },
  { key: 'band4', upperLimit: '249.99', commissionPct: '8.8' },
];

// A second calculable variant whose barcode is NOT in the commission tariff, so its
// commission falls back to a CATEGORY rate rule — proving the other current-scenario
// commission source.
const CAT_BARCODE = 'ADV-CAT-EST';
const CAT_CUSTOMER_PRICE = '360.00';
const CAT_CATEGORY_ID = 598n;
const CAT_COMMISSION_PCT = '15'; // category fallback percent

interface CurrentWire {
  commissionPct: string | null;
  netProfit: string | null;
  marginPct: string | null;
  isBest: boolean;
}
interface DetailItemWire {
  id: string;
  barcode: string;
  customerPrice: string;
  calculable: boolean;
  current: CurrentWire;
}
interface DetailWire {
  items: DetailItemWire[];
}

interface EstimateWire {
  itemId: string;
  price: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'category' | null;
  calculable: boolean;
  reason: string | null;
  breakdown: {
    saleGross: string;
    commissionGross: string;
    shippingGross: string;
    netProfit: string;
    saleMarginPct: string | null;
  } | null;
}

interface EstimateFixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  tariffId: string;
  matchedItemId: string;
  catFallbackItemId: string;
  unmatchedItemId: string;
}

async function setupFixture(): Promise<EstimateFixture> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing - globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Advantage Estimate Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'advantage-estimate-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8602n,
      productMainId: 'pm-8602',
      title: 'Avantaj Ürünü',
      categoryId: 597n,
      categoryName: 'Bayrak',
      brandId: 2032n,
      brandName: 'Alpaka',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 86020n,
      barcode: MATCHED_BARCODE,
      stockCode: 'STK-EST',
      salePrice: new Decimal('360.00'),
      listPrice: new Decimal('360.00'),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
    },
  });

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
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });
  await ensureFeeDefinitions();

  const commissionTariff = await prisma.commissionTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Temmuz Komisyon Tarifesi' },
  });
  const now = Date.now();
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: commissionTariff.id,
      dateRangeLabel: '7 - 14 Temmuz',
      startsAt: new Date(now - 86_400_000),
      endsAt: new Date(now + 86_400_000),
      sortOrder: 0,
    },
  });
  await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      stockCode: 'STK-EST',
      productTitle: 'Avantaj Ürünü',
      currentPrice: '360.00',
      currentCommissionPct: '0.1900',
      bands: MATCHED_BANDS,
    },
  });

  const tariff = await prisma.advantageTariff.create({
    // Pinned to the commission tariff → its bands supply the reduced rate the
    // estimate resolves (no silent auto-resolution).
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Avantajlı Ürün Etiketleri',
      commissionSourceTariffId: commissionTariff.id,
    },
  });
  const matched = await prisma.advantageTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      stockCode: 'STK-EST',
      productTitle: 'Avantaj Ürünü',
      currentPrice: '360.00',
      customerPrice: '360.00',
      hasCommissionTariff: true,
      starTiers: [
        { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
        { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
        { key: 'tier3', upperLimit: '223.78' },
      ],
      applyUntilEnd: false,
      sortOrder: 0,
    },
  });
  const unmatched = await prisma.advantageTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      barcode: 'ADV-UNKNOWN',
      productTitle: 'Eşleşmeyen Ürün',
      currentPrice: '300.00',
      customerPrice: '300.00',
      hasCommissionTariff: false,
      starTiers: [
        { key: 'tier1', upperLimit: '250.00', lowerLimit: '240.00' },
        { key: 'tier2', upperLimit: '239.99', lowerLimit: '200.00' },
        { key: 'tier3', upperLimit: '199.99' },
      ],
      applyUntilEnd: false,
      sortOrder: 1,
    },
  });

  // ─── Category-fallback item ─────────────────────────────────────────────────
  // A matched, costable variant whose barcode is absent from the commission tariff's
  // bands, so the commission resolves from a CATEGORY rate rule (not a band). Its own
  // category (598, no brand) gets a single CATEGORY commission rate.
  const catProduct = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8603n,
      productMainId: 'pm-8603',
      title: 'Kategori Avantaj Ürünü',
      categoryId: CAT_CATEGORY_ID,
      categoryName: 'Kategori',
      brandId: null,
      brandName: null,
    },
  });
  const catVariant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: catProduct.id,
      platformVariantId: 86030n,
      barcode: CAT_BARCODE,
      stockCode: 'STK-CAT',
      salePrice: new Decimal('360.00'),
      listPrice: new Decimal('360.00'),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: catVariant.id },
  });
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId: CAT_CATEGORY_ID,
      brandId: null,
      categoryName: 'Kategori',
      parentCategoryName: 'Üst Kategori',
      brandName: null,
      baseRate: new Decimal(CAT_COMMISSION_PCT),
      paymentTermDays: 60,
      segmentOverrides: {},
      fetchedAt: new Date(),
      sourceScreen: 'CategoryCommissionPaymentTerms',
    },
  });
  const catFallback = await prisma.advantageTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      productVariantId: catVariant.id,
      barcode: CAT_BARCODE,
      stockCode: 'STK-CAT',
      productTitle: 'Kategori Avantaj Ürünü',
      currentPrice: '360.00',
      customerPrice: CAT_CUSTOMER_PRICE,
      hasCommissionTariff: false,
      starTiers: [
        { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
        { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
        { key: 'tier3', upperLimit: '223.78' },
      ],
      applyUntilEnd: false,
      sortOrder: 2,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    tariffId: tariff.id,
    matchedItemId: matched.id,
    catFallbackItemId: catFallback.id,
    unmatchedItemId: unmatched.id,
  };
}

function estimateUrl(fx: EstimateFixture, itemId: string): string {
  return `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}/items/${itemId}/estimate`;
}

function detailUrl(fx: EstimateFixture): string {
  return `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}`;
}

/** Reads the detail's `current` scenario for one item by barcode. */
async function fetchDetailItem(fx: EstimateFixture, barcode: string): Promise<DetailItemWire> {
  const res = await app.request(detailUrl(fx), {
    headers: { Authorization: bearer(fx.accessToken) },
  });
  const body = (await res.json()) as DetailWire;
  const item = body.items.find((i) => i.barcode === barcode);
  if (item === undefined) throw new Error(`detail item ${barcode} missing`);
  return item;
}

/**
 * Proves `scenario: 'current'` reproduces the detail row's `current` breakdown
 * byte-for-byte: same price (the customer price), same commission (and its source),
 * same net profit. Margin is compared numerically because the estimate serializes it
 * at 4dp while the detail's `current` rounds to 2dp.
 */
async function assertCurrentParity(
  fx: EstimateFixture,
  itemId: string,
  barcode: string,
  expectedSource: 'band' | 'category',
): Promise<void> {
  const detailItem = await fetchDetailItem(fx, barcode);
  expect(detailItem.calculable).toBe(true);
  expect(detailItem.current.netProfit).not.toBeNull();
  expect(detailItem.current.marginPct).not.toBeNull();

  const res = await app.request(estimateUrl(fx, itemId), {
    method: 'POST',
    headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'current' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as EstimateWire;

  expect(body.itemId).toBe(itemId);
  expect(body.calculable).toBe(true);
  expect(body.reason).toBeNull();
  // Priced on the customer price the detail baseline uses.
  expect(body.price).toBe(detailItem.customerPrice);
  expect(body.breakdown?.saleGross).toBe(detailItem.customerPrice);
  // The current commission + its source echoed exactly as the detail resolved them.
  expect(body.commissionSource).toBe(expectedSource);
  expect(body.commissionPct).toBe(detailItem.current.commissionPct);
  // The whole point: the modal number must equal the row badge exactly.
  expect(body.breakdown?.netProfit).toBe(detailItem.current.netProfit);
  // Margin: same underlying Decimal, only the serialization precision differs (4dp vs 2dp).
  expect(Number(body.breakdown?.saleMarginPct)).toBeCloseTo(
    Number(detailItem.current.marginPct),
    1,
  );
}

describe('Advantage Product Labels - item estimate', () => {
  let fx: EstimateFixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('computes the full breakdown at a price whose band supplies the commission', async () => {
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '260.00' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;

    expect(body.itemId).toBe(fx.matchedItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.price).toBe('260.00');
    // 260.00 lands in band3 (250 – 279.99 → 11.5%), read from the commission tariff.
    expect(body.commissionSource).toBe('band');
    expect(Number(body.commissionPct)).toBe(11.5);
    expect(body.breakdown).not.toBeNull();
    expect(body.breakdown?.saleGross).toBe('260.00');
    expect(body.breakdown?.saleMarginPct).not.toBeNull();
    // Full breakdown line items are present (not a mock's summary).
    expect(Number(body.breakdown?.commissionGross)).toBeGreaterThan(0);
    expect(Number(body.breakdown?.shippingGross)).toBeGreaterThan(0);
  });

  it('current scenario equals the detail current breakdown when the commission is a band', async () => {
    // The band-matched item's customer price (360) lands in band1 (19%) of the
    // commission tariff — the estimate must reproduce the detail's `current` exactly.
    await assertCurrentParity(fx, fx.matchedItemId, MATCHED_BARCODE, 'band');
  });

  it('current scenario equals the detail current breakdown when the commission is a category fallback', async () => {
    // The category-fallback item's barcode is absent from the commission tariff, so
    // its current commission comes from the CATEGORY rate rule (15%) — the estimate
    // must reproduce the detail's `current` exactly, with source 'category'.
    await assertCurrentParity(fx, fx.catFallbackItemId, CAT_BARCODE, 'category');
  });

  it('rejects a price sent with scenario:current (INVALID_ESTIMATE_MODE)', async () => {
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current', price: '100.00' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string; code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.field === 'price' && e.code === 'INVALID_ESTIMATE_MODE')).toBe(
      true,
    );
  });

  it('rejects an empty body — neither price nor scenario (PRICE_REQUIRED)', async () => {
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string; code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.field === 'price' && e.code === 'PRICE_REQUIRED')).toBe(true);
  });

  it('an unmatched item is not calculable', async () => {
    const res = await app.request(estimateUrl(fx, fx.unmatchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '220.00' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;
    expect(body.calculable).toBe(false);
    expect(body.reason).toBe('NO_PRODUCT');
    expect(body.breakdown).toBeNull();
  });

  it('a foreign item id returns 404', async () => {
    const res = await app.request(estimateUrl(fx, crypto.randomUUID()), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '260.00' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('an invalid price returns 422', async () => {
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '12.345' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string; code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors[0]?.field).toBe('price');
    expect(body.errors[0]?.code).toBe('INVALID_CUSTOM_PRICE');
  });
});
