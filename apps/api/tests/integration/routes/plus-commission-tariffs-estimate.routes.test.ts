// Integration tests for the Plus tariff item estimate endpoint.
//
// The estimate runs the SAME profit engine + resolvers the detail view uses, so the
// breakdown modal never disagrees with the badge. Two modes: pass a `price` (under
// the item's reduced Plus commission) - an estimate at the Plus ceiling MUST equal
// the detail's `plus.netProfit`; or pass `scenario: 'current'` (no price) - the
// item's commission-base price at its current commission, which MUST equal the
// detail row's `currentNetProfit`. An unmatched item degrades to not-calculable; a
// contradictory or missing payload is a 422.
//
// Fixture mirrors plus-commission-tariffs.routes.test.ts: one calculable variant
// (TRY cost + SENDEOMP shipping + fee defs) plus an unmatched item, under one period.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

interface ScenarioWire {
  price: string;
  netProfit: string | null;
}
interface DetailItemWire {
  id: string;
  barcode: string;
  commissionBasePrice: string;
  currentNetProfit: string | null;
  plus: ScenarioWire;
}
interface DetailWire {
  periods: { items: DetailItemWire[] }[];
}
interface EstimateWire {
  itemId: string;
  price: string;
  commissionPct: string | null;
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
      name: 'Plus Estimate Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'plus-estimate-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8402n,
      productMainId: 'pm-8402',
      title: 'Plus Tarife Urunu',
      categoryId: 597n,
      categoryName: 'Gomlek',
      brandId: 2032n,
      brandName: 'Modline',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 84020n,
      barcode: 'BC-EST',
      stockCode: 'STK-EST',
      salePrice: new Decimal('500.00'),
      listPrice: new Decimal('500.00'),
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

  const tariff = await prisma.plusCommissionTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Plus Tarifesi' },
  });
  const period = await prisma.plusCommissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      dateRangeLabel: '30 Haziran - 7 Temmuz',
      sortOrder: 0,
    },
  });
  const matched = await prisma.plusCommissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: 'BC-EST',
      stockCode: 'STK-EST',
      productTitle: 'Plus Tarife Urunu',
      currentPrice: '500.00',
      // Customer-seen price commission is charged on - lower than the 500 sale price
      // (a discounted product). The current scenario must price on THIS, not 500.
      commissionBasePrice: '480.00',
      currentCommissionPct: '19.0000',
      plusPriceUpperLimit: '450.00',
      plusCommissionPct: '15.4',
      plusCommissionBasePrice: '450.00',
      sortOrder: 0,
    },
  });
  const unmatched = await prisma.plusCommissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      barcode: 'BC-UNKNOWN',
      productTitle: 'Eslesmeyen Urun',
      currentPrice: '300.00',
      commissionBasePrice: '300.00',
      currentCommissionPct: '20',
      plusPriceUpperLimit: '280.00',
      plusCommissionPct: '16',
      plusCommissionBasePrice: '280.00',
      sortOrder: 1,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    tariffId: tariff.id,
    matchedItemId: matched.id,
    unmatchedItemId: unmatched.id,
  };
}

function estimateUrl(fx: EstimateFixture, itemId: string): string {
  return `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs/${fx.tariffId}/items/${itemId}/estimate`;
}

async function fetchDetailItem(fx: EstimateFixture, barcode: string): Promise<DetailItemWire> {
  const detailRes = await app.request(
    `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs/${fx.tariffId}`,
    { headers: { Authorization: bearer(fx.accessToken) } },
  );
  const detail = (await detailRes.json()) as DetailWire;
  const item = detail.periods[0]?.items.find((i) => i.barcode === barcode);
  if (item === undefined) throw new Error(`detail item ${barcode} missing`);
  return item;
}

describe('Plus Commission Tariffs - item estimate', () => {
  let fx: EstimateFixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('computes the full breakdown at a price under the Plus commission', async () => {
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '350.00' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;

    expect(body.itemId).toBe(fx.matchedItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.price).toBe('350.00');
    // Estimate uses the item's reduced Plus commission (15.4%).
    expect(Number(body.commissionPct)).toBe(15.4);
    expect(body.breakdown).not.toBeNull();
    expect(body.breakdown?.saleGross).toBe('350.00');
    expect(body.breakdown?.saleMarginPct).not.toBeNull();
    // Full breakdown line items are present (not a mock's summary).
    expect(Number(body.breakdown?.commissionGross)).toBeGreaterThan(0);
    expect(Number(body.breakdown?.shippingGross)).toBeGreaterThan(0);
  });

  it('price mode at the Plus ceiling equals the detail plus.netProfit (same engine)', async () => {
    const matched = await fetchDetailItem(fx, 'BC-EST');
    expect(matched.plus.price).toBe('450.00');
    expect(matched.plus.netProfit).not.toBeNull();

    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: matched.plus.price }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;
    expect(body.calculable).toBe(true);
    expect(Number(body.commissionPct)).toBe(15.4);
    // The estimate at the ceiling must reproduce the detail's Plus profit byte-for-byte.
    expect(body.breakdown?.netProfit).toBe(matched.plus.netProfit);
  });

  it('current scenario breakdown equals the detail currentNetProfit (same engine, same base price + commission)', async () => {
    const matched = await fetchDetailItem(fx, 'BC-EST');
    expect(matched.commissionBasePrice).toBe('480.00');
    expect(matched.currentNetProfit).not.toBeNull();

    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;

    expect(body.itemId).toBe(fx.matchedItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    // Priced on the commission-base price (480, the customer-seen price), NOT the 500 sale price.
    expect(body.price).toBe('480.00');
    expect(body.breakdown?.saleGross).toBe('480.00');
    // Commission is the item's CURRENT rate, echoed in the detail's 4dp wire format.
    expect(body.commissionPct).toBe('19.0000');
    // The whole point: the modal number must equal the row badge exactly.
    expect(body.breakdown?.netProfit).toBe(matched.currentNetProfit);
  });

  it('rejects price sent with scenario:current (INVALID_ESTIMATE_MODE)', async () => {
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

  it('rejects an empty body - neither price nor scenario (PRICE_REQUIRED)', async () => {
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
      body: JSON.stringify({ price: '250.00' }),
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
      body: JSON.stringify({ price: '350.00' }),
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
