// Happy-path integration tests for the Flash Products item estimate endpoint.
//
// The estimate runs the SAME profit engine + resolvers the detail view uses, at the
// requested price, resolving the reduced commission from the band that price lands in
// (of the item's primary window), else the flat "Mevcut Komisyon" rate — so an estimate
// at an offer price never disagrees with that offer's badge. The `scenario: "current"`
// mode prices the item's customer price at its current commission and MUST equal the
// detail row's current baseline byte-for-byte. An unmatched item degrades to
// not-calculable; an invalid or mode-contradictory price is a 422; a foreign item id is
// 404. An unknown (NULL) flat rate is never priced at 0%: its current scenario is a 422
// CURRENT_COMMISSION_UNKNOWN, and a price no band covers answers not calculable with a
// null commission.
//
// Fixture: one calculable band-matched variant (TRY cost + SENDEOMP shipping + fee defs)
// with a commission tariff whose active period bands cover the offer window, plus an
// unmatched item.

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

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

// The estimate responses the unknown-flat-rate cases read, parsed rather than cast.
const ProblemSchema = z.object({
  code: z.string(),
  errors: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
});
const EstimateResultSchema = z.object({
  itemId: z.string(),
  price: z.string(),
  commissionPct: z.string().nullable(),
  commissionSource: z.enum(['band', 'current']).nullable(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
  breakdown: z.object({ saleGross: z.string(), netProfit: z.string() }).nullable(),
});

interface Fixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  listId: string;
  matchedItemId: string;
  unmatchedItemId: string;
  /** Matched, no commission tariff flag, flat "Mevcut Komisyon" unknown (NULL). */
  unknownFlatItemId: string;
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
  // The matched variant, but the file's "Mevcut Komisyon" cell was blank or unreadable
  // (NULL) and the product has no commission tariff, so no band covers any price: every
  // price falls back to the unknown flat rate.
  const unknownFlat = await prisma.flashProductItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      productTitle: 'Komisyonsuz Flas Urunu',
      currentPrice: '360.00',
      customerPrice: '360.00',
      currentCommissionPct: null,
      hasCommissionTariff: false,
      offer24Price: OFFER_PRICE,
      offer24StartsAt: flashInstant(2026, 7, 9, 0),
      offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
      sortOrder: 2,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    listId: list.id,
    matchedItemId: matched.id,
    unmatchedItemId: unmatched.id,
    unknownFlatItemId: unknownFlat.id,
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

  it('answers 422 CURRENT_COMMISSION_UNKNOWN on field scenario when the flat rate is unknown', async () => {
    // The customer price is known; the current scenario prices it at the flat rate, which
    // is unknown, so there is nothing to break down (the detail row has no current profit).
    const res = await app.request(estimateUrl(fx, fx.unknownFlatItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'scenario', code: 'CURRENT_COMMISSION_UNKNOWN' }]);
  });

  it('answers 200 not calculable with a null commission for a price with no covering band', async () => {
    const estimateAt = async (itemId: string): Promise<z.infer<typeof EstimateResultSchema>> => {
      const res = await app.request(estimateUrl(fx, itemId), {
        method: 'POST',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '350.00' }),
      });
      expect(res.status).toBe(200);
      return EstimateResultSchema.parse(await res.json());
    };

    // No band covers the price, so it falls back to the unknown flat rate: not an invalid
    // request, but nothing to price either -- never priced at 0%. A compute that threw is
    // degraded to the same shape and logged; nothing may be logged here.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let body: z.infer<typeof EstimateResultSchema>;
    try {
      body = await estimateAt(fx.unknownFlatItemId);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
    expect(body.itemId).toBe(fx.unknownFlatItemId);
    expect(body.price).toBe('350.00');
    expect(body.calculable).toBe(false);
    expect(body.reason).toBeNull();
    expect(body.commissionPct).toBeNull();
    expect(body.commissionSource).toBe('current');
    expect(body.breakdown).toBeNull();

    // The same variant at the same price is calculable when its commission is known, so
    // the result above is the unknown rate, not a missing cost or a degraded base.
    const control = await estimateAt(fx.matchedItemId);
    expect(control.calculable).toBe(true);
    expect(control.breakdown).not.toBeNull();
  });
});

describe('Flash Products - the estimate resolves the item variant from the barcode at read time', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('an item imported before its variant existed is estimated once the variant exists', async () => {
    const LATE_BARCODE = 'FLASH-EST-LATE';
    // Uploaded before the product sync: no catalog variant carried the barcode, so the
    // import stored no variant link. Known flat rate, no commission tariff.
    const late = await prisma.flashProductItem.create({
      data: {
        organizationId: fx.orgId,
        storeId: fx.storeId,
        listId: fx.listId,
        productVariantId: null,
        barcode: LATE_BARCODE,
        productTitle: 'Gec Eslesen Flas Urunu',
        currentPrice: '360.00',
        customerPrice: '360.00',
        currentCommissionPct: '19',
        hasCommissionTariff: false,
        offer24Price: OFFER_PRICE,
        offer24StartsAt: flashInstant(2026, 7, 9, 0),
        offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
        sortOrder: 3,
      },
    });
    const estimateCurrent = async (): Promise<z.infer<typeof EstimateResultSchema>> => {
      const res = await app.request(estimateUrl(fx, late.id), {
        method: 'POST',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'current' }),
      });
      expect(res.status).toBe(200);
      return EstimateResultSchema.parse(await res.json());
    };

    // No catalog variant carries the barcode yet.
    const before = await estimateCurrent();
    expect(before.itemId).toBe(late.id);
    expect(before.calculable).toBe(false);
    expect(before.reason).toBe('NO_PRODUCT');
    expect(before.breakdown).toBeNull();

    // The product sync lands a variant with that barcode (same product and cost as the
    // fixture's matched variant) after the upload.
    const matchedVariant = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: fx.orgId, storeId: fx.storeId, barcode: MATCHED_BARCODE },
    });
    await cloneVariantWithBarcode(matchedVariant.id, LATE_BARCODE);

    // The same estimate, with no re-upload, now prices the item with a full breakdown.
    const after = await estimateCurrent();
    expect(after.calculable).toBe(true);
    expect(after.reason).toBeNull();
    expect(after.price).toBe('360.00');
    expect(after.commissionSource).toBe('current');
    expect(after.breakdown).not.toBeNull();
    expect(after.breakdown?.saleGross).toBe('360.00');

    // The modal number equals the detail row's current profit exactly.
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const detail: DetailWire = await res.json();
    const detailRow = detail.items.find((i) => i.id === late.id);
    expect(detailRow?.calculable).toBe(true);
    expect(detailRow?.currentNetProfit).not.toBeNull();
    expect(after.breakdown?.netProfit).toBe(detailRow?.currentNetProfit);

    // The reads resolved the variant without writing the stored link back.
    const stored = await prisma.flashProductItem.findUniqueOrThrow({
      where: { id: late.id },
      select: { productVariantId: true },
    });
    expect(stored.productVariantId).toBeNull();
  });
});
