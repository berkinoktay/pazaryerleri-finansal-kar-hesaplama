// Happy-path integration tests for the tariff item estimate endpoint.
//
// The core invariant: an estimate at a band's price (band-click mode) equals
// that band's profit in the detail response — same engine, same resolvers, so
// the breakdown modal never disagrees with the badge. Custom-price mode derives
// the band from the price; the current scenario (`scenario: 'current'`) prices the
// item's own commission-base price at its current commission and MUST equal the
// detail row's `currentNetProfit` badge; an unmatched item degrades to
// not-calculable.
//
// Fixture matches commission-tariffs.routes.test.ts: one calculable variant
// (TRY cost + SENDEOMP shipping + fee defs) plus an unmatched item.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

interface BandWire {
  key: string;
  price: string;
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
}
interface DetailItemWire {
  id: string;
  barcode: string;
  commissionBasePrice: string | null;
  currentNetProfit: string | null;
  bands: BandWire[];
}
interface DetailWire {
  periods: { items: DetailItemWire[] }[];
}
interface EstimateWire {
  itemId: string;
  price: string;
  bandKey: string | null;
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
    throw new Error('SENDEOMP carrier missing — globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Estimate Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'estimate-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8202n,
      productMainId: 'pm-8202',
      title: 'Tarife Ürünü',
      categoryId: 597n,
      categoryName: 'Gömlek',
      brandId: 2032n,
      brandName: 'Modline',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 82020n,
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

  const tariff = await prisma.commissionTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Haziran Tarifesi' },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      dateRangeLabel: '23 – 26 Haziran',
      sortOrder: 0,
    },
  });
  const matched = await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: 'BC-EST',
      stockCode: 'STK-EST',
      productTitle: 'Tarife Ürünü',
      currentPrice: '500.00',
      // Customer-seen price commission is charged on — lower than the 500 sale price
      // (a discounted product). The current scenario must price on THIS, not 500.
      commissionBasePrice: '480.00',
      currentCommissionPct: '19.0000',
      // Touching boundaries (band2.upper = band1.lower = 450): a band-click on
      // band2 (price 450) must still resolve to band2 — that is what bandKey does.
      bands: [
        { key: 'band1', lowerLimit: '450.00', commissionPct: '19' },
        { key: 'band2', lowerLimit: '400.00', upperLimit: '450.00', commissionPct: '15' },
        { key: 'band3', lowerLimit: '350.00', upperLimit: '400.00', commissionPct: '12' },
        { key: 'band4', upperLimit: '350.00', commissionPct: '10' },
      ],
    },
  });
  const unmatched = await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      barcode: 'BC-UNKNOWN',
      productTitle: 'Eşleşmeyen Ürün',
      currentPrice: '300.00',
      currentCommissionPct: '0.2000',
      bands: [{ key: 'band1', upperLimit: '300.00', commissionPct: '20' }],
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
  return `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs/${fx.tariffId}/items/${itemId}/estimate`;
}

describe('Commission Tariffs — item estimate', () => {
  let fx: EstimateFixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('band-click estimate equals the detail band profit (same engine)', async () => {
    // Read the detail so we can compare against its computed band2 profit.
    const detailRes = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs/${fx.tariffId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    const detail = (await detailRes.json()) as DetailWire;
    const matched = detail.periods[0]?.items.find((i) => i.barcode === 'BC-EST');
    const band2 = matched?.bands.find((b) => b.key === 'band2');
    expect(band2?.netProfit).not.toBeNull();

    // Estimate at band2's own price, passing bandKey — must land on band2 despite
    // the touching boundary, and its net profit must match the detail exactly.
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: band2?.price, bandKey: 'band2' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;

    expect(body.itemId).toBe(fx.matchedItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.bandKey).toBe('band2');
    expect(body.commissionPct).toBe('15');
    expect(body.breakdown).not.toBeNull();
    expect(body.breakdown?.netProfit).toBe(band2?.netProfit);
    expect(body.breakdown?.saleMarginPct).not.toBeNull();
    // Full breakdown line items are present (not the mock's 3-line summary).
    expect(Number(body.breakdown?.commissionGross)).toBeGreaterThan(0);
    expect(Number(body.breakdown?.shippingGross)).toBeGreaterThan(0);
  });

  it('custom-price estimate derives the band from the price', async () => {
    // 420 is strictly inside band2 [400,450] — not on a boundary, so it resolves
    // to band2 without an explicit bandKey.
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '420.00' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;
    expect(body.calculable).toBe(true);
    expect(body.bandKey).toBe('band2');
    expect(body.commissionPct).toBe('15');
    expect(body.price).toBe('420.00');
    expect(body.breakdown?.saleGross).toBe('420.00');
  });

  it('a custom price on a shared boundary resolves to the higher band', async () => {
    // 450 is both band1.lower and band2.upper — the first containing band (band1) wins.
    const res = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '450.00' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;
    expect(body.bandKey).toBe('band1');
    expect(body.commissionPct).toBe('19');
  });

  it('current scenario breakdown equals the detail currentNetProfit (same engine, same price + commission)', async () => {
    // Read the detail's current-scenario numbers for the SAME item, then prove the
    // estimate reproduces them byte-for-byte — the guarantee the badge relies on.
    const detailRes = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs/${fx.tariffId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    const detail = (await detailRes.json()) as DetailWire;
    const matched = detail.periods[0]?.items.find((i) => i.barcode === 'BC-EST');
    expect(matched?.commissionBasePrice).toBe('480.00');
    expect(matched?.currentNetProfit).not.toBeNull();

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
    expect(body.bandKey).toBeNull();
    // Priced on the commission-base price (480, the customer-seen price), NOT the 500 sale price.
    expect(body.price).toBe('480.00');
    expect(body.breakdown?.saleGross).toBe('480.00');
    // Commission is the item's CURRENT rate, echoed in the detail's 4dp wire format.
    expect(body.commissionPct).toBe('19.0000');
    // The whole point: the modal number must equal the row badge exactly.
    expect(body.breakdown?.netProfit).toBe(matched?.currentNetProfit);
  });

  it('current scenario falls back to the sale price when commission-base price is absent', async () => {
    // The unmatched item has no commissionBasePrice (a legacy import shape) — current
    // mode prices on currentPrice (300) and, being unmatched, is not calculable.
    const res = await app.request(estimateUrl(fx, fx.unmatchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;
    expect(body.price).toBe('300.00'); // == currentPrice (fallback)
    expect(body.bandKey).toBeNull();
    expect(body.calculable).toBe(false);
    expect(body.reason).toBe('NO_PRODUCT');
    expect(body.breakdown).toBeNull();
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
      body: JSON.stringify({ price: '420.00' }),
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
