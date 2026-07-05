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
      dimensionalWeight: new Decimal('3.0'),
    },
  });
  // Two images: the detail must surface the position-0 one for the matched item.
  await prisma.productImage.createMany({
    data: [
      {
        organizationId: org.id,
        productId: product.id,
        url: 'https://cdn.example/tar-1.jpg',
        position: 1,
      },
      {
        organizationId: org.id,
        productId: product.id,
        url: 'https://cdn.example/tar-0.jpg',
        position: 0,
      },
    ],
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
    // The matched item surfaces its catalog product's position-0 image.
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
        dimensionalWeight: new Decimal('3.0'),
      },
    });
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        name: 'COGS Base',
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
