// Happy-path integration tests for the saved Commission Tariffs endpoints
// (list / detail / delete).
//
// The interesting case is the detail's COMPUTED per-band profit. Unlike Ürün
// Fiyatlandırma the commission comes from the Excel band (not the rate table), so
// a calculable item needs only cost (TRY profile) + shipping (SENDEOMP /
// TRENDYOL_CONTRACT) + the fee definitions — NO marketplace_commission_rate row.
//
// Fixture is built once in beforeAll (each Supabase auth user costs ~800 ms).
// The shipping reference catalog is ensured by globalSetup (SENDEOMP present).

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  FeeCalculationKind,
  FeeScope,
  OrderFeeType,
  ProfitRecomputeReason,
} from '@pazarsync/db/enums';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

interface BandWire {
  key: string;
  price: string;
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
}
interface ItemWire {
  id: string;
  barcode: string;
  productTitle: string;
  imageUrl: string | null;
  commissionBasePrice: string | null;
  currentNetProfit: string | null;
  currentMarginPct: string | null;
  calculable: boolean;
  reason: string | null;
  bestBandKey: string | null;
  selectedBand: string | null;
  customPrice: string | null;
  bands: BandWire[];
}
interface DetailWire {
  id: string;
  name: string;
  exported: boolean;
  periods: { id: string; dateRangeLabel: string; validity: string | null; items: ItemWire[] }[];
}
interface ListWire {
  data: {
    id: string;
    name: string;
    productCount: number;
    selectedCount: number;
    exported: boolean;
    validity: string | null;
  }[];
}

interface TariffFixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  tariffId: string;
}

/**
 * Builds an org + store with one calculable variant (TRY cost + SENDEOMP shipping +
 * fee defs) and a saved tariff with two items: one matched to that variant (four
 * bands, a band selected) and one unmatched (no catalog product).
 */
async function setupTariffFixture(): Promise<TariffFixture> {
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
      name: 'Tariff Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'tariff-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8101n,
      productMainId: 'pm-8101',
      title: 'Tarife Ürünü',
      categoryId: 597n,
      categoryName: 'Gömlek',
      brandId: 2032n,
      brandName: 'Modline',
      // Two images: the detail must surface the first one for the matched item.
      imageUrls: ['https://cdn.example/tar-0.jpg', 'https://cdn.example/tar-1.jpg'],
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 81010n,
      barcode: 'BC-TAR',
      stockCode: 'STK-TAR',
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
  await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: 'BC-TAR',
      stockCode: 'STK-TAR',
      productTitle: 'Tarife Ürünü',
      currentPrice: '500.00',
      currentCommissionPct: '0.1900',
      bands: [
        { key: 'band1', lowerLimit: '450.00', commissionPct: '19' },
        { key: 'band2', lowerLimit: '400.00', upperLimit: '450.00', commissionPct: '15' },
        { key: 'band3', lowerLimit: '350.00', upperLimit: '400.00', commissionPct: '12' },
        { key: 'band4', upperLimit: '350.00', commissionPct: '10' },
      ],
      selectedBand: 'band2',
    },
  });
  await prisma.commissionTariffItem.create({
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

  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id, tariffId: tariff.id };
}

describe('Commission Tariffs — list / detail / delete', () => {
  let fx: TariffFixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupTariffFixture();
  });

  it('lists the saved tariff with product + selection aggregates', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListWire;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.id).toBe(fx.tariffId);
    expect(row?.name).toBe('Haziran Tarifesi');
    expect(row?.productCount).toBe(2);
    expect(row?.selectedCount).toBe(1);
    expect(row?.exported).toBe(false);
    // No parseable period dates → validity is null.
    expect(row?.validity).toBeNull();
  });

  it('returns the detail with per-band profit computed for the matched item', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs/${fx.tariffId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    expect(body.periods).toHaveLength(1);
    const period = body.periods[0];
    expect(period?.items).toHaveLength(2);

    const matched = period?.items.find((i) => i.barcode === 'BC-TAR');
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    expect(matched?.selectedBand).toBe('band2');
    // The matched item surfaces its catalog product's first image.
    expect(matched?.imageUrl).toBe('https://cdn.example/tar-0.jpg');
    expect(matched?.bands).toHaveLength(4);
    // Every band has a real (non-null) net profit + margin, and a best band is marked.
    for (const band of matched?.bands ?? []) {
      expect(band.netProfit).not.toBeNull();
      expect(band.marginPct).not.toBeNull();
    }
    expect(matched?.bestBandKey).not.toBeNull();
    expect(matched?.bands.map((b) => b.key)).toContain(matched?.bestBandKey);
    // The "do nothing" baseline (current price + current commission) is computed
    // for a calculable item — it backs the "Güncele göre" delta on the frontend.
    expect(matched?.currentNetProfit).not.toBeNull();
    expect(matched?.currentMarginPct).not.toBeNull();

    const unmatched = period?.items.find((i) => i.barcode === 'BC-UNKNOWN');
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
    expect(unmatched?.bands[0]?.netProfit).toBeNull();
    // An uncalculable item has no baseline profit either.
    expect(unmatched?.currentNetProfit).toBeNull();
    // An unmatched item has no catalog product, so no image.
    expect(unmatched?.imageUrl).toBeNull();
  });

  it('orders products by Excel row order (sortOrder), identically across sub-periods', async () => {
    // The detail must list products in the uploaded file's order (`sortOrder`, set at
    // import) — matching Trendyol's screen — and identically in both sub-period tabs
    // (the same product carries the same sortOrder in every period). NOT alphabetical
    // and NOT Postgres heap order (which diverged between the periods' item sets).
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Order Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'order-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    await ensureFeeDefinitions();

    const tariff = await prisma.commissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Sıralama Tarifesi' },
    });
    // Excel/sortOrder order Gama(0), Alfa(1), Beta(2) — deliberately NOT alphabetical.
    const GAMA = { barcode: 'BC-G', title: 'Gama Ürün', sortOrder: 0 };
    const ALFA = { barcode: 'BC-A', title: 'Alfa Ürün', sortOrder: 1 };
    const BETA = { barcode: 'BC-B', title: 'Beta Ürün', sortOrder: 2 };
    const bands = [{ key: 'band1', upperLimit: '300.00', commissionPct: '20' }];
    const makePeriod = async (
      dayCount: number,
      periodSort: number,
      insertOrder: ReadonlyArray<{ barcode: string; title: string; sortOrder: number }>,
    ): Promise<void> => {
      const period = await prisma.commissionTariffPeriod.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          tariffId: tariff.id,
          dateRangeLabel: `${dayCount} gün`,
          dayCount,
          sortOrder: periodSort,
        },
      });
      for (const p of insertOrder) {
        await prisma.commissionTariffItem.create({
          data: {
            organizationId: org.id,
            storeId: store.id,
            periodId: period.id,
            barcode: p.barcode,
            productTitle: p.title,
            sortOrder: p.sortOrder,
            currentPrice: '300.00',
            currentCommissionPct: '0.2000',
            bands,
          },
        });
      }
    };
    // Same products, DIFFERENT insertion order per period — sortOrder must still drive output.
    await makePeriod(3, 0, [BETA, GAMA, ALFA]);
    await makePeriod(4, 1, [ALFA, BETA, GAMA]);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff.id}`,
      { method: 'GET', headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    expect(body.periods).toHaveLength(2);
    // sortOrder order (0,1,2), NOT alphabetical (['Alfa','Beta','Gama']).
    const expected = ['Gama Ürün', 'Alfa Ürün', 'Beta Ürün'];
    expect(body.periods[0]?.items.map((i) => i.productTitle)).toEqual(expected);
    expect(body.periods[1]?.items.map((i) => i.productTitle)).toEqual(expected);
  });

  it('computes the current-scenario profit at commissionBasePrice, falling back to currentPrice', async () => {
    // The "do nothing" baseline must run at the KOMİSYONA ESAS FİYAT (the customer-seen
    // price commission is charged on), NOT the sale price. Three items share one
    // calculable variant + one current commission, differing only in price inputs:
    //   A: currentPrice 500, commissionBasePrice 400  → baseline at 400
    //   B: currentPrice 400, commissionBasePrice null → baseline at 400 (fallback)
    //   C: currentPrice 500, commissionBasePrice null → baseline at 500 (fallback)
    // So A must equal B (same 400 price point) and differ from C (sale-price fallback).
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Base Price Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'base-price-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8201n,
        productMainId: 'pm-8201',
        title: 'Baz Fiyat Ürünü',
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
        platformVariantId: 82010n,
        barcode: 'BC-BASE',
        stockCode: 'STK-BASE',
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
        name: 'COGS Base',
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
        name: 'COGS Base',
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
      data: { organizationId: org.id, storeId: store.id, name: 'Baz Fiyat Tarifesi' },
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
    // All three point at the SAME calculable variant + same current commission; only
    // the price inputs differ. A single band satisfies calculability (its commission
    // does not affect the current-scenario, which uses currentCommissionPct).
    const bands = [{ key: 'band1', upperLimit: '600.00', commissionPct: '19' }];
    const makeItem = async (
      barcode: string,
      currentPrice: string,
      commissionBasePrice: string | null,
    ): Promise<void> => {
      await prisma.commissionTariffItem.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          periodId: period.id,
          productVariantId: variant.id,
          barcode,
          productTitle: barcode,
          currentPrice,
          commissionBasePrice,
          currentCommissionPct: '19.0000',
          bands,
        },
      });
    };
    await makeItem('BC-A', '500.00', '400.00');
    await makeItem('BC-B', '400.00', null);
    await makeItem('BC-C', '500.00', null);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const items = ((await res.json()) as DetailWire).periods[0]?.items ?? [];
    const a = items.find((i) => i.barcode === 'BC-A');
    const b = items.find((i) => i.barcode === 'BC-B');
    const c = items.find((i) => i.barcode === 'BC-C');

    expect(a?.calculable).toBe(true);
    expect(a?.currentNetProfit).not.toBeNull();
    // (1) A (base 400) equals B (fallback at currentPrice 400) — same price point.
    expect(a?.currentNetProfit).toBe(b?.currentNetProfit);
    // (2) A (base 400) differs from C (fallback at sale price 500) — proves the
    // baseline is NOT computed from the sale price when a base price is present.
    expect(a?.currentNetProfit).not.toBe(c?.currentNetProfit);
    // (3) The base price is echoed for A, null for B (column absent).
    expect(a?.commissionBasePrice).toBe('400.00');
    expect(b?.commissionBasePrice).toBeNull();
  });

  it('deletes the tariff and then lists empty', async () => {
    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs/${fx.tariffId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/commission-tariffs`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListWire).data).toHaveLength(0);
  });
});

describe('DELETE .../commission-tariffs/{tariffId} - profit recompute queueing', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('queues the orders whose barcodes the deleted tariff covered', async () => {
    await truncateAll();

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Delete Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'tariff-delete-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
      },
    });

    const tariff = await prisma.commissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Delete Tariff' },
    });
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: '1 - 7 July',
        sortOrder: 0,
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        barcode: 'BC-DEL',
        productTitle: 'Delete Product',
        currentPrice: '300.00',
        currentCommissionPct: '0.2000',
        bands: [{ key: 'band1', upperLimit: '300.00', commissionPct: '20' }],
      },
    });

    // An order whose item carries the tariff's barcode -> must queue after the delete.
    const covered = await createOrder(org.id, store.id);
    await prisma.orderItem.create({
      data: {
        orderId: covered.id,
        organizationId: org.id,
        quantity: 1,
        lineSaleGross: '0.00',
        commissionRate: '0.00',
        commissionGross: '0.00',
        barcode: 'BC-DEL',
      },
    });

    // An order whose barcode the tariff never covered -> must stay out.
    const uncovered = await createOrder(org.id, store.id);
    await prisma.orderItem.create({
      data: {
        orderId: uncovered.id,
        organizationId: org.id,
        quantity: 1,
        lineSaleGross: '0.00',
        commissionRate: '0.00',
        commissionGross: '0.00',
        barcode: 'BC-UNRELATED',
      },
    });

    // Clear any queue rows left by the setup so the assertion proves the delete's own enqueue.
    await prisma.profitRecomputeRequest.deleteMany();

    const del = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff.id}`,
      { method: 'DELETE', headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(del.status).toBe(204);

    const coveredQueued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: covered.id },
    });
    expect(coveredQueued?.reason).toBe(ProfitRecomputeReason.REFERENCE_CHANGED);
    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: uncovered.id } }),
    ).toBeNull();
  });
});

describe('Commission Tariffs - validity reflects the real Istanbul instant', () => {
  // Period bounds are stored as Istanbul wall-clock saved verbatim as UTC, while the
  // request's `now` is a true instant. Istanbul runs UTC+3, so the real instant a bound
  // denotes is ~3h BEFORE the stored value. Each stored bound below sits only 1h ahead of
  // `now` (less than the 3h offset), so the OLD raw comparison (stored-vs-now) misreads it
  // and only the converted comparison classifies it correctly:
  //   - active: stored start now+1h reads 'upcoming' raw, but its real start (now-2h) is
  //     already past -> active.
  //   - past:   stored end now+1h reads 'active' raw, but its real end (now-2h) is already
  //     past -> ended.
  // Dates are relative to Date.now() so the test never drifts.
  const HOUR_MS = 60 * 60 * 1000;
  let accessToken: string;
  let orgId: string;
  let storeId: string;
  let tariffId: string;

  beforeAll(async () => {
    await ensureDbReachable();
    // The detail route resolves fee definitions unconditionally; a prior describe's
    // truncate may have cleared them, so re-seed before building the fixture.
    await ensureFeeDefinitions();
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id, { name: 'Validity Store' });
    const tariff = await prisma.commissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Gecerlilik Tarifesi' },
    });
    const now = Date.now();
    await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: 'Aktif Donem',
        sortOrder: 0,
        startsAt: new Date(now + 1 * HOUR_MS), // real now-2h
        endsAt: new Date(now + 10 * HOUR_MS), // real now+7h
      },
    });
    await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: 'Biten Donem',
        sortOrder: 1,
        startsAt: new Date(now - 20 * HOUR_MS), // real now-23h
        endsAt: new Date(now + 1 * HOUR_MS), // real now-2h
      },
    });
    accessToken = user.accessToken;
    orgId = org.id;
    storeId = store.id;
    tariffId = tariff.id;
  });

  it('marks a tariff period active from the real Istanbul start', async () => {
    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/commission-tariffs/${tariffId}`,
      { headers: { Authorization: bearer(accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    const active = body.periods.find((p) => p.dateRangeLabel === 'Aktif Donem');
    // Raw stored start (now+1h) would read 'upcoming'; the converted real start (now-2h)
    // is already past, so the period is active.
    expect(active?.validity).toBe('active');
  });

  it('marks it ended at the real Istanbul end', async () => {
    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/commission-tariffs/${tariffId}`,
      { headers: { Authorization: bearer(accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    const ended = body.periods.find((p) => p.dateRangeLabel === 'Biten Donem');
    // Raw stored end (now+1h) would read 'active'; the converted real end (now-2h) is
    // already past, so the period is ended.
    expect(ended?.validity).toBe('past');

    // The list's overall validity spans both periods' real instants [now-23h, now+7h),
    // which contains now -> active (exercises the list call site's conversion too).
    const listRes = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/commission-tariffs`,
      { headers: { Authorization: bearer(accessToken) } },
    );
    const list = (await listRes.json()) as ListWire;
    expect(list.data.find((r) => r.id === tariffId)?.validity).toBe('active');
  });
});

describe('Commission Tariffs — per-item degrade (decision 9)', () => {
  // Two items' scenarios are forced to throw (a negative commission-base price, which the
  // engine's unit-price validator rejects): the detail must still return 200 with those
  // items' profit empty (reason null) while a third item computes fine, and the failures
  // must be logged exactly once per request with the right surface + failedCount 2 (the
  // per-request collect-then-log-once path, NOT one line per failing row).
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('keeps the tariff detail up when items fail to compute and logs once', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Degrade Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'tariff-degrade-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8701n,
        productMainId: 'pm-8701',
        title: 'Bozulma Ürünü',
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
        platformVariantId: 87010n,
        barcode: 'BC-DEG',
        stockCode: 'STK-DEG',
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
        name: 'COGS Degrade',
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
        name: 'COGS Degrade',
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
      data: { organizationId: org.id, storeId: store.id, name: 'Bozulma Tarifesi' },
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
    const bands = [{ key: 'band1', upperLimit: '600.00', commissionPct: '19' }];
    // Healthy item: a positive commission-base price -> computes.
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-OK',
        productTitle: 'Saglam',
        currentPrice: '500.00',
        commissionBasePrice: '400.00',
        currentCommissionPct: '19.0000',
        sortOrder: 0,
        bands,
      },
    });
    // Two failing items: same calculable variant, but a NEGATIVE commission-base price
    // makes the engine reject the baseline unit price -> each item's compute throws. Two
    // of them prove the collect-then-log-once path reports failedCount 2 from a single line.
    const failing = await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-FAIL',
        productTitle: 'Bozuk',
        currentPrice: '500.00',
        commissionBasePrice: '-5.00',
        currentCommissionPct: '19.0000',
        sortOrder: 1,
        bands,
      },
    });
    const failingTwo = await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-FAIL-2',
        productTitle: 'Bozuk 2',
        currentPrice: '500.00',
        commissionBasePrice: '-7.00',
        currentCommissionPct: '19.0000',
        sortOrder: 2,
        bands,
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const items = ((await res.json()) as DetailWire).periods[0]?.items ?? [];

      const ok = items.find((i) => i.barcode === 'BC-OK');
      expect(ok?.calculable).toBe(true);
      expect(ok?.currentNetProfit).not.toBeNull();

      // Both failing items degrade: not calculable, no reason (NOT NO_PRODUCT -- the
      // variant is matched), empty profits and bands.
      for (const failingId of [failing.id, failingTwo.id]) {
        const bad = items.find((i) => i.id === failingId);
        expect(bad?.calculable).toBe(false);
        expect(bad?.reason).toBeNull();
        expect(bad?.currentNetProfit).toBeNull();
        for (const band of bad?.bands ?? []) {
          expect(band.netProfit).toBeNull();
        }
      }

      // Two failing items -> still exactly one [profit-read] line for this surface, with
      // failedCount 2 (collected then logged once, not one line per row).
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({
          surface: 'commission-tariff',
          orderId: null,
          failedCount: 2,
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('Commission Tariffs - store-wide degrade (decision 9)', () => {
  // The WHOLE scenario load fails (not just one item): a TRENDYOL PLATFORM_SERVICE fee
  // definition with a NULL fixed amount, effective just before now, wins the loader's
  // "latest effectiveFrom" ordering over the seeded row, so `loadTrendyolScenarioBases`
  // throws IncompleteFeeDefinitionError. `loadScreenScenarioBases` then degrades the whole
  // request (bases === null) and logs ONCE at the loader level (no failedCount). The detail
  // must still return 200 with every matched item empty (reason null), and -- the point of
  // the degrade-first ordering -- a matched item reports reason null, never NO_PRODUCT. The
  // poisoned definition is removed in `finally` so later tests in the run are unaffected
  // (truncateAll DOES wipe fee_definitions, but only the next test that truncates would).
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('degrades every item with one log when the store-wide load fails', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Store Degrade Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'tariff-store-degrade-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8901n,
        productMainId: 'pm-8901',
        title: 'Bozulma Urunu',
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
        platformVariantId: 89010n,
        barcode: 'BC-SDEG',
        stockCode: 'STK-SDEG',
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
        name: 'COGS Store Degrade',
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
        name: 'COGS Store Degrade',
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

    // Poison the store-wide load: a later PLATFORM_SERVICE definition with no fixed amount.
    // effectiveFrom now-1min beats the seeded 2026-05-18 row in resolveFeeDefinition's
    // "latest effectiveFrom <= scenarioDate" ordering; the unique key is
    // (platform, feeType, effectiveFrom), so a distinct effectiveFrom avoids a clash.
    const poison = await prisma.feeDefinition.create({
      data: {
        platform: FeeScope.TRENDYOL,
        feeType: OrderFeeType.PLATFORM_SERVICE,
        displayName: 'Platform Hizmet Bedeli (eksik)',
        calculationKind: FeeCalculationKind.FIXED,
        fixedAmountNet: null,
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date(Date.now() - 60 * 1000),
        isRequired: true,
      },
    });

    const tariff = await prisma.commissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Magaza Bozulma Tarifesi' },
    });
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: '1 - 7 Temmuz',
        sortOrder: 0,
      },
    });
    const bands = [{ key: 'band1', upperLimit: '600.00', commissionPct: '19' }];
    // Two matched items (same calculable variant) - both must degrade to reason null when
    // the store-wide load fails, proving the degrade wins over a per-item NO_PRODUCT.
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-SDEG-1',
        productTitle: 'Magaza Bozulma 1',
        currentPrice: '500.00',
        commissionBasePrice: '400.00',
        currentCommissionPct: '19.0000',
        sortOrder: 0,
        bands,
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-SDEG-2',
        productTitle: 'Magaza Bozulma 2',
        currentPrice: '500.00',
        commissionBasePrice: '400.00',
        currentCommissionPct: '19.0000',
        sortOrder: 1,
        bands,
      },
    });
    // A third MATCHED item (same calculable variant) but with NO bands (empty JSON list).
    // Under a store-wide degrade the degrade-first ordering must win: reason null, never
    // NO_PRODUCT. This is the only item whose no-bands branch would otherwise fire, so it
    // is what pins the ordering (M10: moving the degraded check after the no-bands check).
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-SDEG-NB',
        productTitle: 'Magaza Bozulma Bantsiz',
        currentPrice: '500.00',
        commissionBasePrice: '400.00',
        currentCommissionPct: '19.0000',
        sortOrder: 2,
        bands: [],
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const items = ((await res.json()) as DetailWire).periods[0]?.items ?? [];
      expect(items).toHaveLength(3);

      // Every matched item degrades: not calculable, reason null (NEVER NO_PRODUCT), empty
      // profits and bands.
      for (const item of items) {
        expect(item.calculable).toBe(false);
        expect(item.reason).toBeNull();
        expect(item.currentNetProfit).toBeNull();
        for (const band of item.bands) {
          expect(band.netProfit).toBeNull();
        }
      }

      // The bandless matched item is the one that pins the degrade-first ordering: with no
      // bands its no-bands branch would report NO_PRODUCT if the degraded check did not run
      // first, so the store-wide degrade must still give it reason null.
      const bandless = items.find((item) => item.barcode === 'BC-SDEG-NB');
      expect(bandless?.calculable).toBe(false);
      expect(bandless?.reason).toBeNull();
      expect(bandless?.bands).toHaveLength(0);

      // The loader logs ONCE at request level - WITHOUT failedCount (that key is set only by
      // the per-item collect-then-log-once path, not the store-wide loader failure).
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, fields] = errorSpy.mock.calls[0] ?? [];
      expect(message).toBe('[profit-read] in-request profit computation failed');
      expect(fields).toMatchObject({ surface: 'commission-tariff', orderId: null });
      expect(fields).not.toHaveProperty('failedCount');
    } finally {
      errorSpy.mockRestore();
      // Remove the poisoned fee definition so later tests in the run are unaffected.
      await prisma.feeDefinition.delete({ where: { id: poison.id } });
    }
  });
});

describe('Commission Tariffs - sub-kurus band limits (Faz 4B closing gate)', () => {
  // An imported Excel cell can carry more than two decimals (xlsx keeps arbitrary
  // precision), so a band upperLimit like "149.999" reaches the engine unrounded. The
  // engine rejects a unit price with more than two decimals, which (before the fix) threw
  // and degraded the whole item. The engine price is now rounded half-up to the kurus
  // ("149.999" -> 150.00), so the band computes and prices identically to a sibling band
  // whose limit is already "150.00" -- and no [profit-read] degrade line is logged.
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('prices a band whose limit has more than two decimals', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Sub Kurus Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'tariff-subkurus-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 9101n,
        productMainId: 'pm-9101',
        title: 'Alt Kurus Urunu',
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
        platformVariantId: 91010n,
        barcode: 'BC-SUBK',
        stockCode: 'STK-SUBK',
        salePrice: new Decimal('150.00'),
        listPrice: new Decimal('150.00'),
        vatRate: 20,
        dimensionalWeightOverride: new Decimal('3.0'),
      },
    });
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'COGS SubKurus',
        type: 'COGS',
        amountGross: new Decimal('50.00'),
        vatRate: 20,
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: org.id,
        version: 1,
        name: 'COGS SubKurus',
        type: 'COGS',
        amountGross: new Decimal('50.00'),
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
      data: { organizationId: org.id, storeId: store.id, name: 'Alt Kurus Tarifesi' },
    });
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: '1 - 7 Temmuz',
        sortOrder: 0,
      },
    });
    // Two bands at the SAME commission: one whose upperLimit carries a third decimal that
    // rounds up to the kurus (149.999 -> 150.00) and a sibling already at 150.00. Both must
    // price to the same engine revenue, so their net profits must match exactly.
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: 'BC-SUBK',
        stockCode: 'STK-SUBK',
        productTitle: 'Alt Kurus Urunu',
        currentPrice: '150.00',
        currentCommissionPct: '19.0000',
        bands: [
          { key: 'bandSub', upperLimit: '149.999', commissionPct: '19' },
          { key: 'bandWhole', upperLimit: '150.00', commissionPct: '19' },
        ],
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const item = ((await res.json()) as DetailWire).periods[0]?.items[0];

      expect(item?.calculable).toBe(true);
      expect(item?.reason).toBeNull();

      const bandSub = item?.bands.find((b) => b.key === 'bandSub');
      const bandWhole = item?.bands.find((b) => b.key === 'bandWhole');
      // The sub-kurus limit rounds to the kurus for both the engine and the wire price.
      expect(bandSub?.price).toBe('150.00');
      expect(bandWhole?.price).toBe('150.00');
      expect(bandSub?.netProfit).not.toBeNull();
      // Priced at the identical 150.00 point under the identical rate, the two bands must
      // net the same profit (asserted against the sibling, not recomputed with the engine).
      expect(bandSub?.netProfit).toBe(bandWhole?.netProfit);
      expect(bandSub?.marginPct).toBe(bandWhole?.marginPct);

      // No degrade: the item computed, so no [profit-read] line was written.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
