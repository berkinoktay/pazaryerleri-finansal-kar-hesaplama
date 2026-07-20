// Happy-path integration tests for the İndirimler (discount list) item estimate endpoint.
//
// The estimate runs the SAME three-tier commission chain + profit engine the detail view
// uses, for the chosen scenario (`current` / `discounted`), resolving the reduced
// commission on the scenario's OWN price. The chain's priority is proven end-to-end: a
// covering commission-tariff band wins first, else the variant's synced commission, else
// a category rate rule, else nothing (NO_COMMISSION). A `discounted` scenario re-resolves
// the band on the discounted price (a lower price can land in a lower band). One assert
// proves the detail's `discounted.commissionSource` uses the very same chain.
//
// Fixture: one org/store (TRY cost + SENDEOMP shipping + fee defs) with a commission
// tariff whose bands cover the band item, plus a synced-rate item, a category-rate item
// and a bare item — each on a distinct category so the tiers do not cross-contaminate.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const BAND_BARCODE = 'DISC-EST-BAND';
const PROD_BARCODE = 'DISC-EST-PROD';
const CAT_BARCODE = 'DISC-EST-CAT';
const NONE_BARCODE = 'DISC-EST-NONE';

// current 300 → discounted 240 (NET -20%). 240 lands in band2 (150–299.99 → 12); 300 in
// band1 (≥300 → 19).
const CURRENT_PRICE = '300.00';
const DISCOUNTED_PRICE = '240.00';
const BAND_DISCOUNTED_PCT = 12;
const BAND_CURRENT_PCT = 19;
const PRODUCT_PCT = 18;
const CATEGORY_PCT = 15;

const BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '150.00', upperLimit: '299.99', commissionPct: '12' },
  { key: 'band3', upperLimit: '149.99', commissionPct: '8' },
];

const BAND_CATEGORY_ID = 597n;
const PROD_CATEGORY_ID = 598n;
const CAT_CATEGORY_ID = 599n;
const NONE_CATEGORY_ID = 600n;

interface ScenarioWire {
  price: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'product' | 'category' | null;
  netProfit: string | null;
}
interface DetailItemWire {
  id: string;
  barcode: string;
  calculable: boolean;
  discounted: ScenarioWire;
}
interface DetailWire {
  items: DetailItemWire[];
}
interface EstimateWire {
  itemId: string;
  scenario: 'current' | 'discounted';
  price: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'product' | 'category' | null;
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

interface Fixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  listId: string;
  bandItemId: string;
  productItemId: string;
  categoryItemId: string;
  noneItemId: string;
  // A second list of type BUY_X_PAY_Y (4-al-2-öde) carrying the SAME band product, to prove the
  // list-price band anchor: effective 150 (300×2/4) but the rate comes from the 300 band.
  buyXListId: string;
  buyXBandItemId: string;
}

// 4-al-2-öde @300 → effective 150.00; the band still comes from the 300 (band1 → 19%) list price.
const BUYX_DISCOUNTED_PRICE = '150.00';

async function setupFixture(): Promise<Fixture> {
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
      name: 'Discount Estimate Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'discount-estimate-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

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
  await ensureFeeDefinitions();

  let platformSeq = 90_000n;
  async function createCalculableVariant(opts: {
    barcode: string;
    categoryId: bigint;
    syncedCommissionRate: string | null;
  }): Promise<string> {
    platformSeq += 1n;
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: platformSeq,
        productMainId: `pm-${platformSeq}`,
        title: `İndirim Ürünü ${opts.barcode}`,
        categoryId: opts.categoryId,
        categoryName: 'Kategori',
        brandId: null,
        brandName: null,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: platformSeq * 10n,
        barcode: opts.barcode,
        stockCode: `STK-${opts.barcode}`,
        salePrice: new Decimal(CURRENT_PRICE),
        listPrice: new Decimal(CURRENT_PRICE),
        vatRate: 20,
        dimensionalWeight: new Decimal('3.0'),
        syncedCommissionRate:
          opts.syncedCommissionRate !== null ? new Decimal(opts.syncedCommissionRate) : null,
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
    });
    return variant.id;
  }

  const bandVariantId = await createCalculableVariant({
    barcode: BAND_BARCODE,
    categoryId: BAND_CATEGORY_ID,
    syncedCommissionRate: null,
  });
  await createCalculableVariant({
    barcode: PROD_BARCODE,
    categoryId: PROD_CATEGORY_ID,
    syncedCommissionRate: String(PRODUCT_PCT),
  });
  await createCalculableVariant({
    barcode: CAT_BARCODE,
    categoryId: CAT_CATEGORY_ID,
    syncedCommissionRate: null,
  });
  await createCalculableVariant({
    barcode: NONE_BARCODE,
    categoryId: NONE_CATEGORY_ID,
    syncedCommissionRate: null,
  });

  // Category rate ONLY for the category-source item's category — the 3rd-tier fallback.
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId: CAT_CATEGORY_ID,
      brandId: null,
      categoryName: 'Kategori',
      parentCategoryName: 'Üst Kategori',
      brandName: null,
      baseRate: new Decimal(CATEGORY_PCT),
      paymentTermDays: 60,
      segmentOverrides: {},
      fetchedAt: new Date(),
      sourceScreen: 'CategoryCommissionPaymentTerms',
    },
  });

  // Commission tariff — a week that COVERS now (covering-only rule), whose period bands cover
  // the band item (by barcode) only. Week bounds ±1 day wide are safely clear of the resolver's
  // İstanbul wall-clock-as-UTC (~3h) normalization.
  const now = Date.now();
  const commissionTariff = await prisma.commissionTariff.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Temmuz Komisyon Tarifesi',
      weekStartsAt: new Date(now - 86_400_000),
      weekEndsAt: new Date(now + 86_400_000),
    },
  });
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
      productVariantId: bandVariantId,
      barcode: BAND_BARCODE,
      stockCode: `STK-${BAND_BARCODE}`,
      productTitle: `İndirim Ürünü ${BAND_BARCODE}`,
      currentPrice: CURRENT_PRICE,
      currentCommissionPct: '0.1900',
      bands: BANDS,
      sortOrder: 0,
    },
  });

  const list = await prisma.discountList.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'İndirim Listesi',
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: new Decimal('20.00'),
      createdBy: user.id,
    },
  });

  let sortOrder = 0;
  async function createItem(barcode: string, variantId: string): Promise<string> {
    const item = await prisma.discountListItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        listId: list.id,
        productVariantId: variantId,
        barcode,
        productTitle: `İndirim Ürünü ${barcode}`,
        currentPrice: new Decimal(CURRENT_PRICE),
        included: true,
        sortOrder: sortOrder++,
      },
    });
    return item.id;
  }

  // Re-read the matched variant ids by barcode so the items point at the right variants.
  const variants = await prisma.productVariant.findMany({
    where: { storeId: store.id },
    select: { id: true, barcode: true },
  });
  const idByBarcode = new Map(variants.map((v) => [v.barcode, v.id]));

  const bandItemId = await createItem(BAND_BARCODE, idByBarcode.get(BAND_BARCODE) ?? '');
  const productItemId = await createItem(PROD_BARCODE, idByBarcode.get(PROD_BARCODE) ?? '');
  const categoryItemId = await createItem(CAT_BARCODE, idByBarcode.get(CAT_BARCODE) ?? '');
  const noneItemId = await createItem(NONE_BARCODE, idByBarcode.get(NONE_BARCODE) ?? '');

  // Second list — BUY_X_PAY_Y (4-al-2-öde) — carrying the same band product. Its discounted band
  // anchors to the CURRENT price (300 → band1 19%), not the effective 150 (which sits in band2).
  const buyXList = await prisma.discountList.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: '4 Al 2 Öde Listesi',
      discountType: 'BUY_X_PAY_Y',
      buyQuantity: 4,
      payQuantity: 2,
      createdBy: user.id,
    },
  });
  const buyXBandItem = await prisma.discountListItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: buyXList.id,
      productVariantId: idByBarcode.get(BAND_BARCODE) ?? '',
      barcode: BAND_BARCODE,
      productTitle: `İndirim Ürünü ${BAND_BARCODE}`,
      currentPrice: new Decimal(CURRENT_PRICE),
      included: true,
      sortOrder: 0,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    listId: list.id,
    bandItemId,
    productItemId,
    categoryItemId,
    noneItemId,
    buyXListId: buyXList.id,
    buyXBandItemId: buyXBandItem.id,
  };
}

function estimateUrl(fx: Fixture, itemId: string, listId: string = fx.listId): string {
  return `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${listId}/items/${itemId}/estimate`;
}

async function estimate(
  fx: Fixture,
  itemId: string,
  scenario: 'current' | 'discounted',
  listId: string = fx.listId,
): Promise<{ status: number; body: EstimateWire }> {
  const res = await app.request(estimateUrl(fx, itemId, listId), {
    method: 'POST',
    headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  return { status: res.status, body: (await res.json()) as EstimateWire };
}

describe('Discount Lists - item estimate', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('discounted scenario is calculable with the band commission from the discounted price', async () => {
    const { status, body } = await estimate(fx, fx.bandItemId, 'discounted');
    expect(status).toBe(200);
    expect(body.itemId).toBe(fx.bandItemId);
    expect(body.scenario).toBe('discounted');
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    // 300 − 20% = 240, which lands in band2 (12%), read from the commission tariff.
    expect(body.price).toBe(DISCOUNTED_PRICE);
    expect(body.commissionSource).toBe('band');
    expect(Number(body.commissionPct)).toBe(BAND_DISCOUNTED_PCT);
    expect(body.breakdown?.saleGross).toBe(DISCOUNTED_PRICE);
    // Commission is consistent with the discounted price × the resolved rate.
    expect(Number(body.breakdown?.commissionGross)).toBeCloseTo(
      Number(DISCOUNTED_PRICE) * (BAND_DISCOUNTED_PCT / 100),
      2,
    );
    expect(Number(body.breakdown?.shippingGross)).toBeGreaterThan(0);
  });

  it('current scenario resolves the band on the current price (a different band)', async () => {
    const { status, body } = await estimate(fx, fx.bandItemId, 'current');
    expect(status).toBe(200);
    expect(body.price).toBe(CURRENT_PRICE);
    expect(body.commissionSource).toBe('band');
    // 300 lands in band1 (19%) — the discounted scenario used band2 (12%).
    expect(Number(body.commissionPct)).toBe(BAND_CURRENT_PCT);
  });

  it("falls back to the variant's synced commission when no band matches (source 'product')", async () => {
    const { status, body } = await estimate(fx, fx.productItemId, 'discounted');
    expect(status).toBe(200);
    expect(body.calculable).toBe(true);
    expect(body.commissionSource).toBe('product');
    expect(Number(body.commissionPct)).toBe(PRODUCT_PCT);
  });

  it("falls back to the category rate when there is no band and no synced rate (source 'category')", async () => {
    const { status, body } = await estimate(fx, fx.categoryItemId, 'discounted');
    expect(status).toBe(200);
    expect(body.calculable).toBe(true);
    expect(body.commissionSource).toBe('category');
    expect(Number(body.commissionPct)).toBe(CATEGORY_PCT);
  });

  it('is not calculable when nothing in the chain resolves (NO_COMMISSION)', async () => {
    const { status, body } = await estimate(fx, fx.noneItemId, 'discounted');
    expect(status).toBe(200);
    expect(body.calculable).toBe(false);
    expect(body.reason).toBe('NO_COMMISSION');
    expect(body.commissionSource).toBeNull();
    expect(body.commissionPct).toBeNull();
    expect(body.breakdown).toBeNull();
  });

  it('BUY_X_PAY_Y resolves the discounted band from the CURRENT price, not the effective price', async () => {
    const { status, body } = await estimate(fx, fx.buyXBandItemId, 'discounted', fx.buyXListId);
    expect(status).toBe(200);
    expect(body.calculable).toBe(true);
    // Effective unit is 150 (300×2/4) — the matrah/display — but the band comes from the 300
    // list price → band1 19% (NOT band2 12% that 150 would fall into).
    expect(body.price).toBe(BUYX_DISCOUNTED_PRICE);
    expect(body.commissionSource).toBe('band');
    expect(Number(body.commissionPct)).toBe(BAND_CURRENT_PCT);
    // Matrah/revenue stays the 150 effective price; commission = 150 × 19%.
    expect(body.breakdown?.saleGross).toBe(BUYX_DISCOUNTED_PRICE);
    expect(Number(body.breakdown?.commissionGross)).toBeCloseTo(
      Number(BUYX_DISCOUNTED_PRICE) * (BAND_CURRENT_PCT / 100),
      2,
    );
  });

  it('NET still resolves the discounted band from the discounted price (band jump preserved)', async () => {
    const { status, body } = await estimate(fx, fx.bandItemId, 'discounted');
    expect(status).toBe(200);
    // Contrast with BUY_X above: NET's every-unit-cheaper discount keeps the discounted-price band.
    expect(body.price).toBe(DISCOUNTED_PRICE);
    expect(body.commissionSource).toBe('band');
    expect(Number(body.commissionPct)).toBe(BAND_DISCOUNTED_PCT);
  });

  it('the BUY_X detail row agrees with its estimate (band from the current price)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.buyXListId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    const bandItem = body.items.find((i) => i.id === fx.buyXBandItemId);
    expect(bandItem?.calculable).toBe(true);
    expect(bandItem?.discounted.price).toBe(BUYX_DISCOUNTED_PRICE);
    expect(bandItem?.discounted.commissionSource).toBe('band');
    expect(Number(bandItem?.discounted.commissionPct)).toBe(BAND_CURRENT_PCT);
  });

  it("the detail's discounted.commissionSource uses the same chain as the estimate", async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    const bandItem = body.items.find((i) => i.id === fx.bandItemId);
    expect(bandItem?.calculable).toBe(true);
    expect(bandItem?.discounted.commissionSource).toBe('band');
    expect(bandItem?.discounted.price).toBe(DISCOUNTED_PRICE);
    expect(Number(bandItem?.discounted.commissionPct)).toBe(BAND_DISCOUNTED_PCT);
  });

  it('rejects an unknown scenario value with 422', async () => {
    const res = await app.request(estimateUrl(fx, fx.bandItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'bogus' }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('a foreign item id returns 404', async () => {
    const res = await app.request(estimateUrl(fx, crypto.randomUUID()), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'discounted' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });
});
