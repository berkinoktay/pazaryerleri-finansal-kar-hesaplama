// Happy-path integration tests for the saved Plus Commission Tariffs endpoints
// (list / detail / delete).
//
// Mirror of commission-tariffs.routes.test.ts, adapted for Plus: instead of a
// 4-band ladder each item carries a flattened CURRENT scenario (the customer-seen
// commission-base price @ current commission) and a nested PLUS scenario (the Plus
// price ceiling @ the reduced Plus commission), both computed on read. The Plus
// tariff now shares the product tariff's three-level shape (tariff → period → item),
// so a single upload can carry MULTIPLE date-range periods (a 3-day + a 4-day block).
// The seller's opt-in is a boolean (`selected`), not a chosen band.
//
// A calculable item needs only cost (TRY profile) + shipping (SENDEOMP /
// TRENDYOL_CONTRACT) + the fee definitions. Fixture is built once in beforeAll
// (each Supabase auth user costs ~800 ms). SENDEOMP is ensured by globalSetup.

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
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
}
interface ItemWire {
  id: string;
  barcode: string;
  stockCode: string | null;
  productTitle: string;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  currentPrice: string;
  commissionBasePrice: string;
  currentCommissionPct: string;
  currentNetProfit: string | null;
  currentMarginPct: string | null;
  plusPriceUpperLimit: string;
  plus: ScenarioWire;
  plusIsBetter: boolean;
  calculable: boolean;
  reason: string | null;
  selected: boolean;
  customPrice: string | null;
}
interface DetailWire {
  id: string;
  name: string;
  exported: boolean;
  periods: {
    id: string;
    dateRangeLabel: string;
    dayCount: number | null;
    validity: string | null;
    items: ItemWire[];
  }[];
}
interface ListWire {
  data: {
    id: string;
    name: string;
    productCount: number;
    selectedCount: number;
    exported: boolean;
    validity: string | null;
    weekStartsAt: string | null;
    weekEndsAt: string | null;
    updatedAt: string;
  }[];
}

interface TariffFixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  tariffId: string;
}

/**
 * Builds an org + store with one calculable variant (TRY cost + SENDEOMP shipping
 * + fee defs) and a saved Plus tariff with one period holding two items: one matched
 * to that variant (opted into Plus) and one unmatched (no catalog product).
 */
async function setupTariffFixture(): Promise<TariffFixture> {
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
      name: 'Plus Tariff Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'plus-tariff-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 8301n,
      productMainId: 'pm-8301',
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
      platformVariantId: 83010n,
      barcode: 'BC-PLUS',
      stockCode: 'STK-PLUS',
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
        url: 'https://cdn.example/plus-1.jpg',
        position: 1,
      },
      {
        organizationId: org.id,
        productId: product.id,
        url: 'https://cdn.example/plus-0.jpg',
        position: 0,
      },
    ],
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
  // Matched item: opted into Plus.
  await prisma.plusCommissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: 'BC-PLUS',
      stockCode: 'STK-PLUS',
      productTitle: 'Plus Tarife Urunu',
      currentPrice: '500.00',
      commissionBasePrice: '500.00',
      currentCommissionPct: '19',
      plusPriceUpperLimit: '450.00',
      plusCommissionPct: '15.4',
      plusCommissionBasePrice: '450.00',
      plusSelected: true,
      sortOrder: 0,
    },
  });
  // Unmatched item: no catalog product.
  await prisma.plusCommissionTariffItem.create({
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
      plusSelected: false,
      sortOrder: 1,
    },
  });

  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id, tariffId: tariff.id };
}

describe('Plus Commission Tariffs - list / detail / delete', () => {
  let fx: TariffFixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupTariffFixture();
  });

  it('lists the saved tariff with UNIQUE product + opt-in aggregates', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListWire;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.id).toBe(fx.tariffId);
    expect(row?.name).toBe('Plus Tarifesi');
    expect(row?.productCount).toBe(2);
    expect(row?.selectedCount).toBe(1);
    expect(row?.exported).toBe(false);
    // No parseable period dates -> validity + week window are null.
    expect(row?.validity).toBeNull();
    expect(row?.weekStartsAt).toBeNull();
    expect(row?.weekEndsAt).toBeNull();
    expect(typeof row?.updatedAt).toBe('string');
  });

  it('returns the detail with period + current + Plus profit computed for the matched item', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs/${fx.tariffId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    expect(body.id).toBe(fx.tariffId);
    expect(body.periods).toHaveLength(1);
    const period = body.periods[0];
    expect(period?.dateRangeLabel).toBe('30 Haziran - 7 Temmuz');
    expect(period?.items).toHaveLength(2);

    const matched = period?.items.find((i) => i.barcode === 'BC-PLUS');
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    expect(matched?.selected).toBe(true);
    // The matched item surfaces its catalog product's position-0 image.
    expect(matched?.imageUrl).toBe('https://cdn.example/plus-0.jpg');
    // The flattened current scenario has a real (non-null) net profit + margin.
    expect(matched?.currentPrice).toBe('500.00');
    expect(matched?.commissionBasePrice).toBe('500.00');
    expect(matched?.currentNetProfit).not.toBeNull();
    expect(matched?.currentMarginPct).not.toBeNull();
    // The nested Plus scenario is priced at the ceiling.
    expect(matched?.plusPriceUpperLimit).toBe('450.00');
    expect(matched?.plus.price).toBe('450.00');
    expect(matched?.plus.netProfit).not.toBeNull();
    expect(matched?.plus.marginPct).not.toBeNull();
    expect(typeof matched?.plusIsBetter).toBe('boolean');

    const unmatched = period?.items.find((i) => i.barcode === 'BC-UNKNOWN');
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
    expect(unmatched?.currentNetProfit).toBeNull();
    expect(unmatched?.plus.netProfit).toBeNull();
    // An unmatched item has no catalog product, so no image.
    expect(unmatched?.imageUrl).toBeNull();
  });

  it('orders products by Excel row order (sortOrder), identically across sub-periods', async () => {
    // The detail must list products in the uploaded file's order (`sortOrder`, set at
    // import) - matching Trendyol's screen - and identically in both sub-period tabs
    // (the same product carries the same sortOrder in every period). NOT alphabetical
    // and NOT Postgres heap order (which diverged between the periods' item sets).
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Plus Order Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'plus-order-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    await ensureFeeDefinitions();

    const tariff = await prisma.plusCommissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Siralama Tarifesi' },
    });
    // Excel/sortOrder order Gama(0), Alfa(1), Beta(2) - deliberately NOT alphabetical.
    const GAMA = { barcode: 'BC-G', title: 'Gama Urun', sortOrder: 0 };
    const ALFA = { barcode: 'BC-A', title: 'Alfa Urun', sortOrder: 1 };
    const BETA = { barcode: 'BC-B', title: 'Beta Urun', sortOrder: 2 };
    const makePeriod = async (
      dayCount: number,
      periodSort: number,
      offer: string,
      insertOrder: ReadonlyArray<{ barcode: string; title: string; sortOrder: number }>,
    ): Promise<void> => {
      const period = await prisma.plusCommissionTariffPeriod.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          tariffId: tariff.id,
          dateRangeLabel: `${dayCount} gun`,
          dayCount,
          sortOrder: periodSort,
        },
      });
      for (const p of insertOrder) {
        await prisma.plusCommissionTariffItem.create({
          data: {
            organizationId: org.id,
            storeId: store.id,
            periodId: period.id,
            barcode: p.barcode,
            productTitle: p.title,
            sortOrder: p.sortOrder,
            currentPrice: '300.00',
            commissionBasePrice: '300.00',
            currentCommissionPct: '20',
            plusPriceUpperLimit: '280.00',
            plusCommissionPct: offer,
            plusCommissionBasePrice: '280.00',
          },
        });
      }
    };
    // Same products, DIFFERENT insertion order per period - sortOrder must still drive output.
    await makePeriod(3, 0, '10.7', [BETA, GAMA, ALFA]);
    await makePeriod(4, 1, '13.1', [ALFA, BETA, GAMA]);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff.id}`,
      { method: 'GET', headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    expect(body.periods).toHaveLength(2);
    expect(body.periods.map((p) => p.dayCount)).toEqual([3, 4]);
    // sortOrder order (0,1,2), NOT alphabetical (['Alfa','Beta','Gama']).
    const expected = ['Gama Urun', 'Alfa Urun', 'Beta Urun'];
    expect(body.periods[0]?.items.map((i) => i.productTitle)).toEqual(expected);
    expect(body.periods[1]?.items.map((i) => i.productTitle)).toEqual(expected);
    // Each period's item carries THAT period's Plus offer percent.
    expect(body.periods[0]?.items[0]?.plus.commissionPct).toBe('10.7');
    expect(body.periods[1]?.items[0]?.plus.commissionPct).toBe('13.1');
    // A multi-period tariff still reports UNIQUE products in the list, not 2xN.
    const listRes = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    const list = (await listRes.json()) as ListWire;
    expect(list.data[0]?.productCount).toBe(3);
  });

  it('computes the current-scenario profit at commissionBasePrice, not the sale price', async () => {
    // The "do nothing" baseline must run at the KOMISYONA ESAS FIYAT (the customer-seen
    // price commission is charged on), NOT the sale price. Three items share one
    // calculable variant + one current commission, differing only in price inputs:
    //   A: currentPrice 500, commissionBasePrice 400 -> baseline at 400
    //   B: currentPrice 400, commissionBasePrice 400 -> baseline at 400 (same point)
    //   C: currentPrice 500, commissionBasePrice 500 -> baseline at 500 (sale price)
    // So A must equal B (same 400 price point) and differ from C (500 price point).
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Plus Base Price Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'plus-base-price-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8501n,
        productMainId: 'pm-8501',
        title: 'Baz Fiyat Urunu',
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
        platformVariantId: 85010n,
        barcode: 'BC-PBASE',
        stockCode: 'STK-PBASE',
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

    const tariff = await prisma.plusCommissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Baz Fiyat Tarifesi' },
    });
    const period = await prisma.plusCommissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: '1 - 7 Temmuz',
        sortOrder: 0,
      },
    });
    // All three point at the SAME calculable variant + same current commission; only
    // the price inputs differ. The Plus columns are inert here (the current scenario
    // uses commissionBasePrice + currentCommissionPct).
    let sort = 0;
    const makeItem = async (
      barcode: string,
      currentPrice: string,
      commissionBasePrice: string,
    ): Promise<void> => {
      await prisma.plusCommissionTariffItem.create({
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
          plusPriceUpperLimit: '450.00',
          plusCommissionPct: '15.4',
          plusCommissionBasePrice: '450.00',
          sortOrder: sort++,
        },
      });
    };
    await makeItem('BC-A', '500.00', '400.00');
    await makeItem('BC-B', '400.00', '400.00');
    await makeItem('BC-C', '500.00', '500.00');

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const items = ((await res.json()) as DetailWire).periods[0]?.items ?? [];
    const a = items.find((i) => i.barcode === 'BC-A');
    const b = items.find((i) => i.barcode === 'BC-B');
    const c = items.find((i) => i.barcode === 'BC-C');

    expect(a?.calculable).toBe(true);
    expect(a?.currentNetProfit).not.toBeNull();
    // (1) A (base 400) equals B (currentPrice 400, base 400) - same 400 price point.
    expect(a?.currentNetProfit).toBe(b?.currentNetProfit);
    // (2) A (base 400) differs from C (base 500) - proves the baseline is computed
    // from commissionBasePrice, NOT the sale price.
    expect(a?.currentNetProfit).not.toBe(c?.currentNetProfit);
    // (3) The base price is echoed on each item.
    expect(a?.commissionBasePrice).toBe('400.00');
    expect(c?.commissionBasePrice).toBe('500.00');
  });

  it('computes the Plus offer at the ceiling, ignoring a committed custom price', async () => {
    // Regression: a committed custom Plus price (below the ceiling) must NOT change the
    // detail's `plus` scenario — the offer card is a pure ceiling option, so `plus.price`
    // always equals `plusPriceUpperLimit` and `plus.netProfit` is the ceiling's profit
    // (NOT the custom price's). Two items share ONE calculable variant + identical ceiling
    // (450) + reduced commission (15.4), differing only in `customPrice`:
    //   A: customPrice null  -> joined at the ceiling
    //   B: customPrice 400   -> committed below the ceiling
    // A and B must produce an IDENTICAL Plus scenario; B still echoes its custom price.
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Plus Ceiling Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'plus-ceiling-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8601n,
        productMainId: 'pm-8601',
        title: 'Tavan Fiyat Urunu',
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
        platformVariantId: 86010n,
        barcode: 'BC-CEIL',
        stockCode: 'STK-CEIL',
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
        name: 'COGS Ceiling',
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
      data: { organizationId: org.id, storeId: store.id, name: 'Tavan Tarifesi' },
    });
    const period = await prisma.plusCommissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: '1 - 7 Temmuz',
        sortOrder: 0,
      },
    });
    // Both point at the SAME variant + the SAME ceiling/commission; only customPrice differs.
    let sort = 0;
    const makeItem = async (barcode: string, customPrice: string | null): Promise<void> => {
      await prisma.plusCommissionTariffItem.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          periodId: period.id,
          productVariantId: variant.id,
          barcode,
          productTitle: barcode,
          currentPrice: '500.00',
          commissionBasePrice: '500.00',
          currentCommissionPct: '19.0000',
          plusPriceUpperLimit: '450.00',
          plusCommissionPct: '15.4',
          plusCommissionBasePrice: '450.00',
          plusSelected: customPrice === null,
          customPrice,
          sortOrder: sort++,
        },
      });
    };
    await makeItem('BC-CEIL-A', null);
    await makeItem('BC-CEIL-B', '400.00');

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const items = ((await res.json()) as DetailWire).periods[0]?.items ?? [];
    const a = items.find((i) => i.barcode === 'BC-CEIL-A');
    const b = items.find((i) => i.barcode === 'BC-CEIL-B');

    // (1) Both Plus scenarios are priced at the ceiling — the custom 400 is ignored.
    expect(a?.plus.price).toBe('450.00');
    expect(b?.plus.price).toBe('450.00');
    expect(b?.plusPriceUpperLimit).toBe('450.00');
    // (2) The custom-priced item's Plus profit equals the ceiling-joined item's — proof
    // the committed custom price never entered the on-read compute.
    expect(a?.plus.netProfit).not.toBeNull();
    expect(b?.plus.netProfit).toBe(a?.plus.netProfit);
    expect(b?.plus.marginPct).toBe(a?.plus.marginPct);
    expect(b?.plusIsBetter).toBe(a?.plusIsBetter);
    // (3) The custom price is still echoed on the wire (exported / re-seeded), just unused
    // in the compute — and it is NOT the Plus scenario's price.
    expect(b?.customPrice).toBe('400.00');
    expect(b?.plus.price).not.toBe(b?.customPrice);
  });

  it('deletes the tariff and then lists empty', async () => {
    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs/${fx.tariffId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListWire).data).toHaveLength(0);
  });
});
