// Integration tests for the Plus tariff item estimate endpoint.
//
// The estimate runs the SAME profit engine + resolvers the detail view uses, so the
// breakdown modal never disagrees with the badge. Two modes: pass a `price` (under
// the item's reduced Plus commission) - an estimate at the Plus ceiling MUST equal
// the detail's `plus.netProfit`; or pass `scenario: 'current'` (no price) - the
// item's commission-base price at its current commission, which MUST equal the
// detail row's `currentNetProfit`. An unmatched item degrades to not-calculable; a
// contradictory or missing payload is a 422. An item whose prices are unknown (NULL)
// still estimates a typed price, and its current scenario answers 422
// CURRENT_PRICE_UNKNOWN when no baseline price is known. An unknown (NULL) commission
// percent is never priced at 0%: the current scenario of an item whose current commission
// is unknown answers 422 CURRENT_COMMISSION_UNKNOWN, a typed price for an item whose Plus
// offer is unknown answers 422 PLUS_COMMISSION_UNKNOWN, and each mode still works when
// only the other percent is unknown.
//
// Fixture mirrors plus-commission-tariffs.routes.test.ts: one calculable variant
// (TRY cost + SENDEOMP shipping + fee defs) plus an unmatched item, under one period.

import { z } from '@hono/zod-openapi';
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
  /** Null when the Plus price upper limit is unknown. */
  price: string | null;
  /** Null when the file's Plus commission offer cell was blank or unreadable. */
  commissionPct: string | null;
  netProfit: string | null;
}
interface DetailItemWire {
  id: string;
  barcode: string;
  // The three prices are null when the file's cell was blank, unreadable or 0.
  currentPrice: string | null;
  commissionBasePrice: string | null;
  plusPriceUpperLimit: string | null;
  /** Null when the file's current commission cell was blank or unreadable. */
  currentCommissionPct: string | null;
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
  /** Matched; current price, commission base price and Plus ceiling unknown (NULL). */
  unknownPricesItemId: string;
  /** Matched; commission base price unknown (NULL), current price 480 like the matched base. */
  unknownCommissionBaseItemId: string;
  /** Matched; the matched item's prices and Plus offer, current commission unknown (NULL). */
  unknownCurrentCommissionItemId: string;
  /** Matched; the matched item's prices and current commission, Plus offer unknown (NULL). */
  unknownPlusCommissionItemId: string;
}

/** The stored prices of one seeded item; null is a cell the file left blank, unreadable or 0. */
interface SeededPrices {
  readonly currentPrice: string | null;
  readonly commissionBasePrice: string | null;
  readonly plusPriceUpperLimit: string | null;
}

/** The stored percents of one seeded item; null is a cell the file left blank or unreadable. */
interface SeededPercents {
  readonly currentCommissionPct: string | null;
  readonly plusCommissionPct: string | null;
}

/** The matched item's current commission (19) and Plus offer (15.4). */
const KNOWN_PERCENTS: SeededPercents = {
  currentCommissionPct: '19.0000',
  plusCommissionPct: '15.4',
};

/** The matched item's prices. */
const MATCHED_PRICES: SeededPrices = {
  currentPrice: '500.00',
  commissionBasePrice: '480.00',
  plusPriceUpperLimit: '450.00',
};

// The estimate responses the unknown-price cases read, parsed rather than cast.
const ProblemSchema = z.object({
  code: z.string(),
  errors: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
});
const EstimateResultSchema = z.object({
  itemId: z.string(),
  price: z.string(),
  commissionPct: z.string().nullable(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
  breakdown: z.object({ saleGross: z.string(), netProfit: z.string() }).nullable(),
});

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
  // Matched to the same variant, current commission and Plus offer as `matched` unless
  // `percents` says otherwise; the known prices differ.
  const makeMatchedItem = async (
    barcode: string,
    sortOrder: number,
    prices: SeededPrices,
    percents: SeededPercents = KNOWN_PERCENTS,
  ): Promise<string> => {
    const item = await prisma.plusCommissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode,
        productTitle: barcode,
        currentPrice: prices.currentPrice,
        commissionBasePrice: prices.commissionBasePrice,
        currentCommissionPct: percents.currentCommissionPct,
        plusPriceUpperLimit: prices.plusPriceUpperLimit,
        plusCommissionPct: percents.plusCommissionPct,
        // The import's fallback: the Plus commission base is the ceiling when unknown.
        plusCommissionBasePrice: prices.plusPriceUpperLimit,
        sortOrder,
      },
    });
    return item.id;
  };
  const unknownPricesItemId = await makeMatchedItem('BC-EST-NOPRICE', 2, {
    currentPrice: null,
    commissionBasePrice: null,
    plusPriceUpperLimit: null,
  });
  const unknownCommissionBaseItemId = await makeMatchedItem('BC-EST-NOBASE', 3, {
    currentPrice: '480.00',
    commissionBasePrice: null,
    plusPriceUpperLimit: '450.00',
  });
  // The matched item's prices (so the baseline price is known), with one percent the file
  // left blank or unreadable.
  const unknownCurrentCommissionItemId = await makeMatchedItem('BC-EST-NOCPCT', 4, MATCHED_PRICES, {
    currentCommissionPct: null,
    plusCommissionPct: '15.4',
  });
  const unknownPlusCommissionItemId = await makeMatchedItem('BC-EST-NOPPCT', 5, MATCHED_PRICES, {
    currentCommissionPct: '19.0000',
    plusCommissionPct: null,
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    tariffId: tariff.id,
    matchedItemId: matched.id,
    unmatchedItemId: unmatched.id,
    unknownPricesItemId,
    unknownCommissionBaseItemId,
    unknownCurrentCommissionItemId,
    unknownPlusCommissionItemId,
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

  it('answers 422 CURRENT_PRICE_UNKNOWN on field scenario when neither baseline price is known', async () => {
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
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'scenario', code: 'CURRENT_PRICE_UNKNOWN' }]);
  });

  it('estimates the current scenario from the current price when only the commission base price is unknown', async () => {
    const row = await fetchDetailItem(fx, 'BC-EST-NOBASE');
    const matched = await fetchDetailItem(fx, 'BC-EST');
    expect(row.commissionBasePrice).toBeNull();
    expect(row.currentPrice).toBe('480.00');
    // The current price 480 prices it exactly as the matched item's commission base 480.
    expect(row.currentNetProfit).not.toBeNull();
    expect(row.currentNetProfit).toBe(matched.currentNetProfit);

    const res = await app.request(estimateUrl(fx, fx.unknownCommissionBaseItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(200);
    const body = EstimateResultSchema.parse(await res.json());
    expect(body.itemId).toBe(fx.unknownCommissionBaseItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    // Priced on the current price, at the item's current commission.
    expect(body.price).toBe('480.00');
    expect(body.breakdown?.saleGross).toBe('480.00');
    expect(body.commissionPct).toBe('19.0000');
    // The modal number equals the row's current profit exactly.
    expect(body.breakdown?.netProfit).toBe(row.currentNetProfit);
  });

  it('still estimates a custom price for an item whose ceiling is unknown', async () => {
    const row = await fetchDetailItem(fx, 'BC-EST-NOPRICE');
    expect(row.plusPriceUpperLimit).toBeNull();
    expect(row.plus.price).toBeNull();
    expect(row.plus.netProfit).toBeNull();

    const estimateAt = async (itemId: string): Promise<z.infer<typeof EstimateResultSchema>> => {
      const res = await app.request(estimateUrl(fx, itemId), {
        method: 'POST',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '350.00' }),
      });
      expect(res.status).toBe(200);
      return EstimateResultSchema.parse(await res.json());
    };
    // A typed price needs no stored price: it is priced under the item's Plus commission.
    const body = await estimateAt(fx.unknownPricesItemId);
    expect(body.itemId).toBe(fx.unknownPricesItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.price).toBe('350.00');
    expect(Number(body.commissionPct)).toBe(15.4);
    expect(body.breakdown?.saleGross).toBe('350.00');
    // Same variant, same Plus commission, same price: the fully priced item's figure.
    const control = await estimateAt(fx.matchedItemId);
    expect(body.breakdown).not.toBeNull();
    expect(control.breakdown).not.toBeNull();
    expect(body.breakdown?.netProfit).toBe(control.breakdown?.netProfit);
  });

  it('answers 422 CURRENT_COMMISSION_UNKNOWN on field scenario', async () => {
    // The baseline price is known (480), so the price check passes; the detail row has no
    // current profit because its percent is unknown, so there is nothing to break down.
    const row = await fetchDetailItem(fx, 'BC-EST-NOCPCT');
    expect(row.commissionBasePrice).toBe('480.00');
    expect(row.currentCommissionPct).toBeNull();
    expect(row.currentNetProfit).toBeNull();

    const res = await app.request(estimateUrl(fx, fx.unknownCurrentCommissionItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'scenario', code: 'CURRENT_COMMISSION_UNKNOWN' }]);

    // The price mode applies the Plus offer, which is known: it still estimates, exactly
    // as the fully known item at the same price.
    const priceAt = async (itemId: string): Promise<z.infer<typeof EstimateResultSchema>> => {
      const priced = await app.request(estimateUrl(fx, itemId), {
        method: 'POST',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '350.00' }),
      });
      expect(priced.status).toBe(200);
      return EstimateResultSchema.parse(await priced.json());
    };
    const offer = await priceAt(fx.unknownCurrentCommissionItemId);
    const control = await priceAt(fx.matchedItemId);
    expect(offer.calculable).toBe(true);
    expect(Number(offer.commissionPct)).toBe(15.4);
    expect(offer.breakdown).not.toBeNull();
    expect(offer.breakdown?.netProfit).toBe(control.breakdown?.netProfit);
  });

  it('answers 422 PLUS_COMMISSION_UNKNOWN on field price when the Plus commission is unknown', async () => {
    // The ceiling is known, but the offer percent is not: the detail offer has no profit.
    const row = await fetchDetailItem(fx, 'BC-EST-NOPPCT');
    expect(row.plusPriceUpperLimit).toBe('450.00');
    expect(row.plus.commissionPct).toBeNull();
    expect(row.plus.netProfit).toBeNull();

    const res = await app.request(estimateUrl(fx, fx.unknownPlusCommissionItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: '350.00' }),
    });
    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'price', code: 'PLUS_COMMISSION_UNKNOWN' }]);

    // The current scenario applies the current percent, which is known: it still estimates
    // and equals the row's current profit exactly.
    expect(row.currentNetProfit).not.toBeNull();
    const current = await app.request(estimateUrl(fx, fx.unknownPlusCommissionItemId), {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    });
    expect(current.status).toBe(200);
    const currentBody = EstimateResultSchema.parse(await current.json());
    expect(currentBody.calculable).toBe(true);
    expect(currentBody.commissionPct).toBe('19.0000');
    expect(currentBody.breakdown?.netProfit).toBe(row.currentNetProfit);
  });
});
