// Happy-path integration tests for the tariff item estimate endpoint.
//
// The core invariant: an estimate at a band's price (band-click mode) equals
// that band's profit in the detail response — same engine, same resolvers, so
// the breakdown modal never disagrees with the badge. Custom-price mode derives
// the band from the price; the current scenario (`scenario: 'current'`) prices the
// item's own commission-base price at its current commission and MUST equal the
// detail row's `currentNetProfit` badge; an unmatched item degrades to
// not-calculable. An item whose prices are unknown (NULL) still estimates a band, and
// its current scenario answers 422 CURRENT_PRICE_UNKNOWN when no baseline is known. An
// item whose current commission is unknown (NULL) still estimates a band, and its current
// scenario answers 422 CURRENT_COMMISSION_UNKNOWN (never priced at 0%).
//
// Fixture matches commission-tariffs.routes.test.ts: one calculable variant
// (TRY cost + SENDEOMP shipping + fee defs) plus an unmatched item.

import { z } from '@hono/zod-openapi';
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

interface BandWire {
  key: string;
  /** Null for a band with neither limit when the current price is unknown. */
  price: string | null;
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
}
interface DetailItemWire {
  id: string;
  barcode: string;
  /** Null when the file's current price cell was blank, unreadable or 0. */
  currentPrice: string | null;
  commissionBasePrice: string | null;
  /** Null when the file's current commission cell was blank or unreadable. */
  currentCommissionPct: string | null;
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

// The estimate responses the unknown-commission cases read, parsed rather than cast.
const ProblemSchema = z.object({
  code: z.string(),
  errors: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
});
const EstimateResultSchema = z.object({
  itemId: z.string(),
  price: z.string(),
  bandKey: z.string().nullable(),
  commissionPct: z.string().nullable(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
  breakdown: z.object({ saleGross: z.string(), netProfit: z.string() }).nullable(),
});

interface EstimateFixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  tariffId: string;
  matchedItemId: string;
  unmatchedItemId: string;
  /** Matched; current price AND commission base price unknown (NULL). */
  unknownPricesItemId: string;
  /** Matched; current price unknown (NULL), commission base price 480 like the matched item. */
  unknownCurrentItemId: string;
  /** Matched; the matched item's prices and bands, current commission unknown (NULL). */
  unknownCommissionItemId: string;
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
      dimensionalWeightOverride: new Decimal('3.0'),
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
  // The scenario engine costs from the profile's VERSIONS (effective-dated), exactly as
  // the real cost-profile service writes a version 1 on create. Without it the variant
  // would read MISSING_COST.
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
  // Touching boundaries (band2.upper = band1.lower = 450): a band-click on
  // band2 (price 450) must still resolve to band2 — that is what bandKey does.
  const bands = [
    { key: 'band1', lowerLimit: '450.00', commissionPct: '19' },
    { key: 'band2', lowerLimit: '400.00', upperLimit: '450.00', commissionPct: '15' },
    { key: 'band3', lowerLimit: '350.00', upperLimit: '400.00', commissionPct: '12' },
    { key: 'band4', upperLimit: '350.00', commissionPct: '10' },
  ];
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
      bands,
    },
  });
  // The detail and the estimate resolve an item's variant by its own barcode: give each
  // of the items below a copy of the calculable variant under its barcode.
  for (const barcode of ['BC-EST-NOPRICE', 'BC-EST-NOCURRENT', 'BC-EST-NOPCT']) {
    await cloneVariantWithBarcode(variant.id, barcode);
  }
  // The same calculable variant and bands as the matched item, but the file's price
  // cells were blank, unreadable or 0, so the prices are stored as NULL.
  const unknownPrices = await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: 'BC-EST-NOPRICE',
      productTitle: 'Fiyatsiz Urun',
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: '19.0000',
      bands,
    },
  });
  const unknownCurrent = await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: 'BC-EST-NOCURRENT',
      productTitle: 'Guncel Fiyatsiz Urun',
      currentPrice: null,
      commissionBasePrice: '480.00',
      currentCommissionPct: '19.0000',
      bands,
    },
  });
  // The matched item's prices and bands, but the file's current commission cell was blank
  // or unreadable, so the percent is stored as NULL. Its baseline price is known, so only
  // the percent stands between it and a current scenario.
  const unknownCommission = await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: 'BC-EST-NOPCT',
      productTitle: 'Komisyonsuz Urun',
      currentPrice: '500.00',
      commissionBasePrice: '480.00',
      currentCommissionPct: null,
      bands,
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
    unknownPricesItemId: unknownPrices.id,
    unknownCurrentItemId: unknownCurrent.id,
    unknownCommissionItemId: unknownCommission.id,
  };
}

async function fetchDetailItem(fx: EstimateFixture, barcode: string): Promise<DetailItemWire> {
  const res = await app.request(
    `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs/${fx.tariffId}`,
    { headers: { Authorization: bearer(fx.accessToken) } },
  );
  expect(res.status).toBe(200);
  const item = ((await res.json()) as DetailWire).periods[0]?.items.find(
    (i) => i.barcode === barcode,
  );
  if (item === undefined) throw new Error(`detail has no item ${barcode}`);
  return item;
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

  it('keeps the band key on the estimate', async () => {
    // A band-click passes an explicit bandKey; at a price on that band's upper limit
    // (450 = band2.upper = band1.lower, a shared boundary) the echoed key must stay
    // band2, NOT the higher band the raw price lookup would pick.
    const clicked = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '450.00', bandKey: 'band2' }),
    });
    expect(clicked.status).toBe(200);
    const clickedBody = (await clicked.json()) as EstimateWire;
    expect(clickedBody.bandKey).toBe('band2');
    expect(clickedBody.commissionPct).toBe('15');

    // A custom price strictly inside another band (375 in band3 [350,400]) echoes THAT
    // band's key, resolved from the price alone (no explicit bandKey).
    const custom = await app.request(estimateUrl(fx, fx.matchedItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '375.00' }),
    });
    expect(custom.status).toBe(200);
    const customBody = (await custom.json()) as EstimateWire;
    expect(customBody.bandKey).toBe('band3');
    expect(customBody.commissionPct).toBe('12');
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

  it('answers 422 CURRENT_PRICE_UNKNOWN on field scenario when neither price is known', async () => {
    // The detail row has no current profit for this item, so there is no current scenario
    // to break down: the estimate refuses instead of pricing a made-up 0.
    const row = await fetchDetailItem(fx, 'BC-EST-NOPRICE');
    expect(row.currentPrice).toBeNull();
    expect(row.commissionBasePrice).toBeNull();
    expect(row.currentNetProfit).toBeNull();

    const res = await app.request(estimateUrl(fx, fx.unknownPricesItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string; code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([
      expect.objectContaining({ field: 'scenario', code: 'CURRENT_PRICE_UNKNOWN' }),
    ]);
  });

  it('estimates the current scenario from the base price when only the current price is unknown', async () => {
    const row = await fetchDetailItem(fx, 'BC-EST-NOCURRENT');
    expect(row.currentPrice).toBeNull();
    expect(row.commissionBasePrice).toBe('480.00');
    expect(row.currentNetProfit).not.toBeNull();

    const res = await app.request(estimateUrl(fx, fx.unknownCurrentItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;
    expect(body.itemId).toBe(fx.unknownCurrentItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.bandKey).toBeNull();
    // Priced on the commission base price, at the item's current commission.
    expect(body.price).toBe('480.00');
    expect(body.breakdown?.saleGross).toBe('480.00');
    expect(body.commissionPct).toBe('19.0000');
    // The modal number equals the row's current profit exactly.
    expect(body.breakdown?.netProfit).toBe(row.currentNetProfit);
  });

  it('still estimates a band price for an item whose current price is unknown', async () => {
    const row = await fetchDetailItem(fx, 'BC-EST-NOPRICE');
    const band2 = row.bands.find((b) => b.key === 'band2');
    expect(band2?.price).toBe('450.00');
    expect(band2?.netProfit).not.toBeNull();

    // A band-click on a limited band needs no current price: the band's own limit prices it.
    const res = await app.request(estimateUrl(fx, fx.unknownPricesItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: band2?.price, bandKey: 'band2' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateWire;
    expect(body.itemId).toBe(fx.unknownPricesItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.bandKey).toBe('band2');
    expect(body.commissionPct).toBe('15');
    expect(body.price).toBe('450.00');
    expect(body.breakdown?.saleGross).toBe('450.00');
    // The estimate reproduces the detail band's profit exactly.
    expect(body.breakdown?.netProfit).toBe(band2?.netProfit);
  });

  it('answers 422 CURRENT_COMMISSION_UNKNOWN on field scenario when the current commission is unknown', async () => {
    // The baseline price is known (480), so the price check passes; the detail row still
    // has no current profit because its percent is unknown, so there is nothing to break
    // down: the estimate refuses instead of pricing a made-up 0%.
    const row = await fetchDetailItem(fx, 'BC-EST-NOPCT');
    expect(row.commissionBasePrice).toBe('480.00');
    expect(row.currentCommissionPct).toBeNull();
    expect(row.currentNetProfit).toBeNull();

    const res = await app.request(estimateUrl(fx, fx.unknownCommissionItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'scenario', code: 'CURRENT_COMMISSION_UNKNOWN' }]);
  });

  it('still estimates a band price for that item', async () => {
    const row = await fetchDetailItem(fx, 'BC-EST-NOPCT');
    const matched = await fetchDetailItem(fx, 'BC-EST');
    const band2 = row.bands.find((b) => b.key === 'band2');
    expect(band2?.price).toBe('450.00');
    expect(band2?.netProfit).not.toBeNull();
    // Same variant, same bands: the band profit equals the fully known item's.
    expect(band2?.netProfit).toBe(matched.bands.find((b) => b.key === 'band2')?.netProfit);

    // A band-click applies the band's own percent, never the unknown current one.
    const res = await app.request(estimateUrl(fx, fx.unknownCommissionItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: band2?.price, bandKey: 'band2' }),
    });
    expect(res.status).toBe(200);
    const body = EstimateResultSchema.parse(await res.json());
    expect(body.itemId).toBe(fx.unknownCommissionItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.bandKey).toBe('band2');
    expect(body.commissionPct).toBe('15');
    expect(body.price).toBe('450.00');
    expect(body.breakdown?.saleGross).toBe('450.00');
    // The estimate reproduces the detail band's profit exactly.
    expect(body.breakdown?.netProfit).toBe(band2?.netProfit);
  });
});

describe('Commission Tariffs — zero-commission band', () => {
  // The engine honors an explicit 0% commission override (plan Görev 1). Two bands land
  // on the SAME price (500): band1 is open-topped from 500 (0% commission), band2 is
  // [400, 500] (19%). Priced at 500 the 0% band must net strictly MORE than the 19% band,
  // and the estimate at the 0% band must charge no commission at all.
  let accessToken: string;
  let orgId: string;
  let storeId: string;
  let tariffId: string;
  let itemId: string;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Zero Commission Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'zero-commission-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8203n,
        productMainId: 'pm-8203',
        title: 'Sifir Komisyon Urunu',
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
        platformVariantId: 82030n,
        barcode: 'BC-ZERO',
        stockCode: 'STK-ZERO',
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: 20,
        dimensionalWeightOverride: new Decimal('3.0'),
      },
    });
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'COGS Zero',
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
        name: 'COGS Zero',
        type: 'COGS',
        amountGross: new Decimal('200.00'),
        vatRate: 20,
        changedFields: [],
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
    });
    await ensureFeeDefinitions();

    const tariff = await prisma.commissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Sifir Tarifesi' },
    });
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: '1 – 7 Temmuz',
        sortOrder: 0,
      },
    });
    const item = await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-ZERO',
        stockCode: 'STK-ZERO',
        productTitle: 'Sifir Komisyon Urunu',
        currentPrice: '500.00',
        commissionBasePrice: '500.00',
        currentCommissionPct: '19.0000',
        // band1 open-topped from 500 (bandPrice = 500, 0% commission); band2 [400,500]
        // (bandPrice = 500, 19%). Both priced at 500 for an apples-to-apples comparison.
        bands: [
          { key: 'band1', lowerLimit: '500.00', commissionPct: '0' },
          { key: 'band2', lowerLimit: '400.00', upperLimit: '500.00', commissionPct: '19' },
        ],
      },
    });

    accessToken = user.accessToken;
    orgId = org.id;
    storeId = store.id;
    tariffId = tariff.id;
    itemId = item.id;
  });

  it('prices a zero-commission band at zero commission', async () => {
    const detailRes = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/commission-tariffs/${tariffId}`,
      { headers: { Authorization: bearer(accessToken) } },
    );
    expect(detailRes.status).toBe(200);
    const matched = ((await detailRes.json()) as DetailWire).periods[0]?.items.find(
      (i) => i.barcode === 'BC-ZERO',
    );
    const zeroBand = matched?.bands.find((b) => b.key === 'band1');
    const paidBand = matched?.bands.find((b) => b.key === 'band2');
    expect(zeroBand?.price).toBe('500.00');
    expect(paidBand?.price).toBe('500.00');
    expect(zeroBand?.netProfit).not.toBeNull();
    expect(paidBand?.netProfit).not.toBeNull();
    // Same price, no commission vs 19% commission -> the 0% band nets strictly more.
    expect(Number(zeroBand?.netProfit)).toBeGreaterThan(Number(paidBand?.netProfit));

    const estRes = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/commission-tariffs/${tariffId}/items/${itemId}/estimate`,
      {
        method: 'POST',
        headers: { Authorization: bearer(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '500.00', bandKey: 'band1' }),
      },
    );
    expect(estRes.status).toBe(200);
    const est = (await estRes.json()) as EstimateWire;
    expect(est.bandKey).toBe('band1');
    expect(est.commissionPct).toBe('0');
    // An explicit 0% override charges no commission at all.
    expect(est.breakdown?.commissionGross).toBe('0.00');
    // The estimate at the band price reproduces the detail band's profit exactly.
    expect(est.breakdown?.netProfit).toBe(zeroBand?.netProfit);
  });
});
