// Happy-path integration tests for the Flash Products item estimate endpoint.
//
// The estimate runs the SAME profit engine + resolvers the detail view uses, at the
// requested price, resolving the reduced commission from the band that price lands in
// (of the item's primary window), else the flat "Mevcut Komisyon" rate — so an estimate
// at an offer price never disagrees with that offer's badge. The `scenario: "current"`
// mode prices the item's customer price at its current commission and MUST equal the
// detail row's current baseline byte-for-byte. An unmatched item degrades to
// not-calculable; an invalid or mode-contradictory price is a 422; a foreign item id is
// 404.
//
// Fixture: one calculable band-matched variant (TRY cost + SENDEOMP shipping + fee defs)
// with a commission tariff whose active period bands cover the offer window, plus an
// unmatched item.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const MATCHED_BARCODE = 'FLASH-EST';
const OFFER_PRICE = '260.00';
// 260 lands in band2 (250–299.99 → 11.5) of the covering period.
const BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '250.00', upperLimit: '299.99', commissionPct: '11.5' },
  { key: 'band3', upperLimit: '249.99', commissionPct: '8' },
];

function flashInstant(year: number, month1: number, day: number, hour: number, minute = 0): Date {
  return businessZoneEpochToInstant(Date.UTC(year, month1 - 1, day, hour, minute));
}

interface OfferWire {
  price: string;
  commissionPct: string;
  netProfit: string | null;
}
interface DetailItemWire {
  id: string;
  barcode: string;
  calculable: boolean;
  currentNetProfit: string | null;
  currentCommissionPct: string;
  offer24: OfferWire | null;
}
interface DetailWire {
  items: DetailItemWire[];
}
interface EstimateWire {
  itemId: string;
  price: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'current' | null;
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
  matchedItemId: string;
  unmatchedItemId: string;
}

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
      name: 'Flash Estimate Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'flash-estimate-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9201n,
      productMainId: 'pm-9201',
      title: 'Flaş Ürünü',
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
      platformVariantId: 92010n,
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
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });
  await ensureFeeDefinitions();

  const weekStart = new Date(Date.UTC(2026, 6, 8, 8, 0));
  const weekEnd = new Date(Date.UTC(2026, 6, 15, 8, 0));
  const commissionTariff = await prisma.commissionTariff.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Temmuz Komisyon Tarifesi',
      weekStartsAt: weekStart,
      weekEndsAt: weekEnd,
    },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: commissionTariff.id,
      dateRangeLabel: '8 Temmuz 08.00-15 Temmuz 07.59',
      dayCount: 7,
      startsAt: weekStart,
      endsAt: weekEnd,
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
      productTitle: 'Flaş Ürünü',
      currentPrice: '360.00',
      currentCommissionPct: '0.1900',
      bands: BANDS,
      sortOrder: 0,
    },
  });

  const list = await prisma.flashProductList.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Flaş Ürünler' },
  });
  const matched = await prisma.flashProductItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      productTitle: 'Flaş Ürünü',
      currentPrice: '360.00',
      customerPrice: '360.00',
      currentCommissionPct: '19',
      hasCommissionTariff: true,
      offer24Price: OFFER_PRICE,
      offer24StartsAt: flashInstant(2026, 7, 9, 0),
      offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
      sortOrder: 0,
    },
  });
  const unmatched = await prisma.flashProductItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      barcode: 'FLASH-UNKNOWN',
      productTitle: 'Eşleşmeyen Ürün',
      currentPrice: '300.00',
      customerPrice: '300.00',
      currentCommissionPct: '19',
      hasCommissionTariff: false,
      offer24Price: '220.00',
      offer24StartsAt: flashInstant(2026, 7, 9, 0),
      offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
      sortOrder: 1,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    listId: list.id,
    matchedItemId: matched.id,
    unmatchedItemId: unmatched.id,
  };
}

function estimateUrl(fx: Fixture, itemId: string): string {
  return `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}/items/${itemId}/estimate`;
}

async function fetchMatchedDetailItem(fx: Fixture): Promise<DetailItemWire> {
  const res = await app.request(
    `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
    { headers: { Authorization: bearer(fx.accessToken) } },
  );
  const body = (await res.json()) as DetailWire;
  const item = body.items.find((i) => i.id === fx.matchedItemId);
  if (item === undefined) throw new Error('matched detail item missing');
  return item;
}

describe('Flash Products - item estimate', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('at the offer price resolves the SAME band commission + profit as the detail offer', async () => {
    const detailItem = await fetchMatchedDetailItem(fx);
    expect(detailItem.offer24?.commissionPct).toBe('11.5000');
    expect(detailItem.offer24?.netProfit).not.toBeNull();

    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: OFFER_PRICE }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;

    expect(body.itemId).toBe(fx.matchedItemId);
    expect(body.calculable).toBe(true);
    expect(body.price).toBe(OFFER_PRICE);
    // 260 lands in band2 (11.5), read from the commission tariff.
    expect(body.commissionSource).toBe('band');
    expect(Number(body.commissionPct)).toBe(11.5);
    // The whole point: the estimate at the offer price equals the detail offer's profit.
    expect(body.breakdown?.netProfit).toBe(detailItem.offer24?.netProfit);
    expect(Number(body.breakdown?.commissionGross)).toBeGreaterThan(0);
    expect(Number(body.breakdown?.shippingGross)).toBeGreaterThan(0);
  });

  it('current scenario equals the detail current baseline (flat "Mevcut Komisyon")', async () => {
    const detailItem = await fetchMatchedDetailItem(fx);
    expect(detailItem.calculable).toBe(true);
    expect(detailItem.currentNetProfit).not.toBeNull();

    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;

    // Priced on the customer price at the flat current commission.
    expect(body.commissionSource).toBe('current');
    expect(Number(body.commissionPct)).toBe(Number(detailItem.currentCommissionPct));
    expect(body.breakdown?.netProfit).toBe(detailItem.currentNetProfit);
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
      body: JSON.stringify({ price: OFFER_PRICE }),
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
