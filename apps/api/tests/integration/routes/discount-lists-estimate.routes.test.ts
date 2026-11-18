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
import {
  cloneVariantWithBarcode,
  createMembership,
  createOrganization,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const BAND_BARCODE = 'DISC-EST-BAND';
const PROD_BARCODE = 'DISC-EST-PROD';
const CAT_BARCODE = 'DISC-EST-CAT';
const NONE_BARCODE = 'DISC-EST-NONE';
// A variant whose synced rate is an explicit 0 (decision 7: "not sent", not a real 0%),
// so the chain must skip the product tier and fall to this category's rate.
const ZERO_BARCODE = 'DISC-EST-ZERO';

// current 300 → discounted 240 (NET -20%). 240 lands in band2 (150–299.99 → 12); 300 in
// band1 (≥300 → 19).
const CURRENT_PRICE = '300.00';
const DISCOUNTED_PRICE = '240.00';
const BAND_DISCOUNTED_PCT = 12;
const BAND_CURRENT_PCT = 19;
const PRODUCT_PCT = 18;
const CATEGORY_PCT = 15;
// Distinct from CATEGORY_PCT and carries decimals so the 4dp serialization is unambiguous.
const ZERO_CATEGORY_PCT = '17.5';
const ZERO_CATEGORY_PCT_4DP = '17.5000';

const BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '150.00', upperLimit: '299.99', commissionPct: '12' },
  { key: 'band3', upperLimit: '149.99', commissionPct: '8' },
];

const BAND_CATEGORY_ID = 597n;
const PROD_CATEGORY_ID = 598n;
const CAT_CATEGORY_ID = 599n;
const NONE_CATEGORY_ID = 600n;
const ZERO_CATEGORY_ID = 601n;

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
    costGross: string;
    commissionGross: string;
    shippingGross: string;
    netProfit: string;
    saleMarginPct: string | null;
  } | null;
  breakdownScope: 'unit' | 'order';
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
  zeroItemId: string;
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
      vatRate: 20,
    },
  });
  // The scenario engine costs from the profile's VERSIONS (effective-dated), exactly as the
  // real cost-profile service writes a version 1 on create. Without it every matched variant
  // sharing this profile would read MISSING_COST. One version covers all the variants.
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
        dimensionalWeightOverride: new Decimal('3.0'),
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
  // Synced rate is an explicit 0 — the chain must treat it as "not sent" and fall to category.
  await createCalculableVariant({
    barcode: ZERO_BARCODE,
    categoryId: ZERO_CATEGORY_ID,
    syncedCommissionRate: '0',
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
  // Category rate for the synced-zero item's category — the tier the chain must land on.
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId: ZERO_CATEGORY_ID,
      brandId: null,
      categoryName: 'Kategori',
      parentCategoryName: 'Üst Kategori',
      brandName: null,
      baseRate: new Decimal(ZERO_CATEGORY_PCT),
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
  const zeroItemId = await createItem(ZERO_BARCODE, idByBarcode.get(ZERO_BARCODE) ?? '');

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
    zeroItemId,
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
    // NET is a UNIT-presentation list, so even the discounted scenario stays a per-unit breakdown.
    expect(body.breakdownScope).toBe('unit');
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

  it('falls back to the category rate when the synced rate is zero (source "category")', async () => {
    const { status, body } = await estimate(fx, fx.zeroItemId, 'discounted');
    expect(status).toBe(200);
    expect(body.calculable).toBe(true);
    // Decision 7: a synced rate of 0 is "not sent", so the chain skips the product tier and
    // resolves this category's rate instead of charging a real 0%.
    expect(body.commissionSource).toBe('category');
    expect(body.commissionPct).toBe(ZERO_CATEGORY_PCT_4DP);
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

  it('BUY_X_PAY_Y discounted returns an ORDER breakdown with the band from the CURRENT price', async () => {
    const { status, body } = await estimate(fx, fx.buyXBandItemId, 'discounted', fx.buyXListId);
    expect(status).toBe(200);
    expect(body.calculable).toBe(true);
    // BUY_X_PAY_Y is an ORDER-presentation list, so the discounted scenario is framed as the whole
    // 4-al-2-öde basket: n = buyQuantity = 4 units, effective unit 150 (300×2/4), order revenue 600.
    expect(body.breakdownScope).toBe('order');
    expect(body.price).toBe('600.00');
    // The band still comes from the 300 list price → band1 19% (NOT band2 12% that 150 sits in).
    expect(body.commissionSource).toBe('band');
    expect(Number(body.commissionPct)).toBe(BAND_CURRENT_PCT);
    // Order-level breakdown: saleGross = basketPaidTotal (150 × 4 = 600), commission = 600 × 19%,
    // cost = n × the unit COGS (200 × 4 = 800); shipping stays a single per-parcel charge.
    expect(body.breakdown?.saleGross).toBe('600.00');
    expect(Number(body.breakdown?.commissionGross)).toBeCloseTo(600 * (BAND_CURRENT_PCT / 100), 2);
    expect(body.breakdown?.costGross).toBe('800.00');
  });

  it('BUY_X_PAY_Y current scenario stays a UNIT breakdown at the current price', async () => {
    const { status, body } = await estimate(fx, fx.buyXBandItemId, 'current', fx.buyXListId);
    expect(status).toBe(200);
    // The current ("do nothing") scenario is never order-framed — one unit at the current price.
    expect(body.breakdownScope).toBe('unit');
    expect(body.price).toBe(CURRENT_PRICE);
    expect(body.breakdown?.saleGross).toBe(CURRENT_PRICE);
    // Single-unit cost — no n× scaling on the unit-scoped scenario.
    expect(body.breakdown?.costGross).toBe('200.00');
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

describe('Discount Lists - the estimate resolves the item variant from the barcode at read time', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('an item imported before its variant existed is estimated once the variant exists', async () => {
    const LATE_BARCODE = 'DISC-EST-LATE';
    // Uploaded before the product sync: no catalog variant carried the barcode, so the
    // import stored no variant link. The barcode is not in the covering commission tariff,
    // so once matched its commission comes from the variant's synced rate.
    const late = await prisma.discountListItem.create({
      data: {
        organizationId: fx.orgId,
        storeId: fx.storeId,
        listId: fx.listId,
        productVariantId: null,
        barcode: LATE_BARCODE,
        productTitle: 'Gec Eslesen Urun',
        currentPrice: new Decimal(CURRENT_PRICE),
        included: true,
        sortOrder: 50,
      },
    });

    // No catalog variant carries the barcode yet.
    const before = await estimate(fx, late.id, 'discounted');
    expect(before.status).toBe(200);
    expect(before.body.itemId).toBe(late.id);
    expect(before.body.calculable).toBe(false);
    expect(before.body.reason).toBe('NO_PRODUCT');
    expect(before.body.breakdown).toBeNull();

    // The product sync lands a variant with that barcode after the upload: the same
    // economics as the synced-rate fixture variant (synced rate, category, cost link).
    const productVariant = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: fx.orgId, storeId: fx.storeId, barcode: PROD_BARCODE },
      select: { id: true },
    });
    await cloneVariantWithBarcode(productVariant.id, LATE_BARCODE);

    // The same estimate, with no re-upload, now prices the item with a full breakdown.
    const after = await estimate(fx, late.id, 'discounted');
    expect(after.status).toBe(200);
    expect(after.body.calculable).toBe(true);
    expect(after.body.reason).toBeNull();
    expect(after.body.price).toBe(DISCOUNTED_PRICE);
    expect(after.body.commissionSource).toBe('product');
    expect(Number(after.body.commissionPct)).toBe(PRODUCT_PCT);
    expect(after.body.breakdown).not.toBeNull();
    expect(after.body.breakdown?.saleGross).toBe(DISCOUNTED_PRICE);

    // The modal number equals the detail row's discounted profit exactly.
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const detail: DetailWire = await res.json();
    const row = detail.items.find((i) => i.id === late.id);
    expect(row?.calculable).toBe(true);
    expect(row?.discounted.commissionSource).toBe('product');
    expect(row?.discounted.netProfit).toBe(after.body.breakdown?.netProfit);

    // The reads resolved the variant without writing the stored link back.
    const stored = await prisma.discountListItem.findUniqueOrThrow({
      where: { id: late.id },
      select: { productVariantId: true },
    });
    expect(stored.productVariantId).toBeNull();
  });
});
