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

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  cloneVariantWithBarcode,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

interface ScenarioWire {
  /** Null when the Plus price upper limit is unknown. */
  price: string | null;
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
  // The three prices are null when the file's cell was blank, unreadable or 0.
  currentPrice: string | null;
  commissionBasePrice: string | null;
  currentCommissionPct: string;
  currentNetProfit: string | null;
  currentMarginPct: string | null;
  plusPriceUpperLimit: string | null;
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
      // Two images: the detail must surface the first one for the matched item.
      imageUrls: ['https://cdn.example/plus-0.jpg', 'https://cdn.example/plus-1.jpg'],
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
    // The matched item surfaces its catalog product's first image.
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
      // The detail resolves an item's variant by its own barcode: give each barcode a
      // copy of the calculable variant.
      await cloneVariantWithBarcode(variant.id, barcode);
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
        dimensionalWeightOverride: new Decimal('3.0'),
      },
    });
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'COGS Ceiling',
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
        name: 'COGS Ceiling',
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
      // The detail resolves an item's variant by its own barcode: give each barcode a
      // copy of the calculable variant.
      await cloneVariantWithBarcode(variant.id, barcode);
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
    // The periods and items go with the tariff: the database cascades the scoped delete.
    const periods = await prisma.plusCommissionTariffPeriod.findMany({
      where: { tariffId: fx.tariffId },
      select: { id: true },
    });
    const periodIds = periods.map((period) => period.id);
    const childCount = async (): Promise<number> =>
      (await prisma.plusCommissionTariffPeriod.count({ where: { id: { in: periodIds } } })) +
      (await prisma.plusCommissionTariffItem.count({ where: { periodId: { in: periodIds } } }));
    expect(await childCount()).toBeGreaterThan(periodIds.length);

    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs/${fx.tariffId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);
    expect(await childCount()).toBe(0);

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListWire).data).toHaveLength(0);
  });
});

describe('Plus Commission Tariffs - validity reflects the real Istanbul instant', () => {
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
    const store = await createStore(org.id, { name: 'Plus Validity Store' });
    const tariff = await prisma.plusCommissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Gecerlilik Tarifesi' },
    });
    const now = Date.now();
    await prisma.plusCommissionTariffPeriod.create({
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
    await prisma.plusCommissionTariffPeriod.create({
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
      `/v1/organizations/${orgId}/stores/${storeId}/plus-commission-tariffs/${tariffId}`,
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
      `/v1/organizations/${orgId}/stores/${storeId}/plus-commission-tariffs/${tariffId}`,
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
      `/v1/organizations/${orgId}/stores/${storeId}/plus-commission-tariffs`,
      { headers: { Authorization: bearer(accessToken) } },
    );
    const list = (await listRes.json()) as ListWire;
    expect(list.data.find((r) => r.id === tariffId)?.validity).toBe('active');
  });
});

describe('Plus Commission Tariffs - per-item degrade (decision 9)', () => {
  // Two items' scenarios are forced to throw (a negative commission-base price, which the
  // engine's unit-price validator rejects): the detail must still return 200 with those
  // items' profit empty (reason null) while a third item computes fine, and the failures
  // must be logged exactly once per request with the right surface + failedCount 2 (the
  // per-request collect-then-log-once path, NOT one line per failing row).
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('keeps the Plus detail up when items fail to compute and logs once', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Plus Degrade Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'plus-degrade-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8801n,
        productMainId: 'pm-8801',
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
        platformVariantId: 88010n,
        barcode: 'BC-PDEG',
        stockCode: 'STK-PDEG',
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
        name: 'COGS Plus Degrade',
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
        name: 'COGS Plus Degrade',
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
      data: { organizationId: org.id, storeId: store.id, name: 'Bozulma Tarifesi' },
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
    // The detail resolves an item's variant by its own barcode: give each item barcode a
    // copy of the calculable variant.
    for (const barcode of ['BC-OK', 'BC-FAIL', 'BC-FAIL-2']) {
      await cloneVariantWithBarcode(variant.id, barcode);
    }
    // Healthy item: a positive commission-base price -> computes.
    await prisma.plusCommissionTariffItem.create({
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
        plusPriceUpperLimit: '450.00',
        plusCommissionPct: '15.4',
        plusCommissionBasePrice: '450.00',
        sortOrder: 0,
      },
    });
    // Two failing items: same calculable variant, but a NEGATIVE commission-base price
    // makes the engine reject the baseline unit price -> each item's compute throws. Two
    // of them prove the collect-then-log-once path reports failedCount 2 from a single line.
    const failing = await prisma.plusCommissionTariffItem.create({
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
        plusPriceUpperLimit: '450.00',
        plusCommissionPct: '15.4',
        plusCommissionBasePrice: '450.00',
        sortOrder: 1,
      },
    });
    const failingTwo = await prisma.plusCommissionTariffItem.create({
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
        plusPriceUpperLimit: '450.00',
        plusCommissionPct: '15.4',
        plusCommissionBasePrice: '450.00',
        sortOrder: 2,
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const items = ((await res.json()) as DetailWire).periods[0]?.items ?? [];

      const ok = items.find((i) => i.barcode === 'BC-OK');
      expect(ok?.calculable).toBe(true);
      expect(ok?.currentNetProfit).not.toBeNull();

      // Both failing items degrade: not calculable, no reason (NOT NO_PRODUCT -- the
      // variant is matched), empty current + Plus profits.
      for (const failingId of [failing.id, failingTwo.id]) {
        const bad = items.find((i) => i.id === failingId);
        expect(bad?.calculable).toBe(false);
        expect(bad?.reason).toBeNull();
        expect(bad?.currentNetProfit).toBeNull();
        expect(bad?.plus.netProfit).toBeNull();
      }

      // Two failing items -> still exactly one [profit-read] line for this surface, with
      // failedCount 2 (collected then logged once, not one line per row).
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({
          surface: 'plus-commission-tariff',
          orderId: null,
          failedCount: 2,
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// The detail fields the unknown-price and unknown-commission cases read, parsed rather
// than cast.
const UnknownPriceItemSchema = z.object({
  barcode: z.string(),
  currentPrice: z.string().nullable(),
  commissionBasePrice: z.string().nullable(),
  // Null when the file's current commission cell was blank or unreadable.
  currentCommissionPct: z.string().nullable(),
  currentNetProfit: z.string().nullable(),
  currentMarginPct: z.string().nullable(),
  plusPriceUpperLimit: z.string().nullable(),
  plus: z.object({
    price: z.string().nullable(),
    // Null when the file's Plus commission offer cell was blank or unreadable.
    commissionPct: z.string().nullable(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
  }),
  plusIsBetter: z.boolean(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
});
const UnknownPriceDetailSchema = z.object({
  periods: z.array(z.object({ items: z.array(UnknownPriceItemSchema) })),
});
type UnknownPriceItem = z.infer<typeof UnknownPriceItemSchema>;

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

/** The current commission (19) and Plus offer (15.4) every row carries unless it says otherwise. */
const KNOWN_PERCENTS: SeededPercents = {
  currentCommissionPct: '19.0000',
  plusCommissionPct: '15.4',
};

describe('Plus Commission Tariffs - unknown (NULL) prices and commissions', () => {
  // Every row points at the SAME calculable variant, current commission (19) and Plus
  // offer (15.4), so the rows differ only in which prices are known. CONTROL is fully
  // priced with the ceiling equal to its baseline, so the lower Plus commission makes Plus
  // better: a `plusIsBetter: false` on an unknown-price row is then the unknown price at
  // work, not the numbers. CONTROL_400 is the same product at another price, to show the
  // fallback baseline is the current price and not just any value. The control rows also
  // prove the base loaded (not degraded), since a degraded base also answers
  // `calculable: false` with `reason: null`. The NO_*_PCT rows carry CONTROL's prices and
  // differ from it only in an unknown (NULL) commission percent, so every null figure on
  // them is the unknown percent at work, never a profit priced at 0%.
  const CONTROL = 'BC-PUNK-CTRL';
  const CONTROL_400 = 'BC-PUNK-CTRL-400';
  const NO_BASELINE = 'BC-PUNK-NO-BASE';
  const NO_COMMISSION_BASE = 'BC-PUNK-NO-CBP';
  const NO_CEILING = 'BC-PUNK-NO-CEIL';
  const NO_PRICE = 'BC-PUNK-NO-PRICE';
  const NO_CURRENT_PCT = 'BC-PUNK-NO-CPCT';
  const NO_PLUS_PCT = 'BC-PUNK-NO-PPCT';
  const NO_PCT = 'BC-PUNK-NO-PCT';

  let accessToken: string;
  let detailUrl: string;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Plus Unknown Price Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'plus-unknown-price-test',
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
        title: 'Bilinmeyen Fiyat Urunu',
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
        barcode: 'BC-PUNK',
        stockCode: 'STK-PUNK',
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
        name: 'COGS Unknown Price',
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
        name: 'COGS Unknown Price',
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
    // Earlier blocks truncate, and the detail resolves fee definitions unconditionally.
    await ensureFeeDefinitions();

    const tariff = await prisma.plusCommissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Bilinmeyen Fiyat Tarifesi' },
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
    let sort = 0;
    const makeItem = async (
      barcode: string,
      prices: SeededPrices,
      percents: SeededPercents = KNOWN_PERCENTS,
    ): Promise<void> => {
      // The detail resolves an item's variant by its own barcode: give each barcode a
      // copy of the calculable variant.
      await cloneVariantWithBarcode(variant.id, barcode);
      await prisma.plusCommissionTariffItem.create({
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
          sortOrder: sort++,
        },
      });
    };
    await makeItem(CONTROL, {
      currentPrice: '500.00',
      commissionBasePrice: '500.00',
      plusPriceUpperLimit: '500.00',
    });
    await makeItem(CONTROL_400, {
      currentPrice: '400.00',
      commissionBasePrice: '400.00',
      plusPriceUpperLimit: '400.00',
    });
    await makeItem(NO_BASELINE, {
      currentPrice: null,
      commissionBasePrice: null,
      plusPriceUpperLimit: '500.00',
    });
    // The current price (400) differs from the ceiling and the variant's sale price (both
    // 500), so a baseline taken from either of those would price this row like CONTROL.
    await makeItem(NO_COMMISSION_BASE, {
      currentPrice: '400.00',
      commissionBasePrice: null,
      plusPriceUpperLimit: '500.00',
    });
    await makeItem(NO_CEILING, {
      currentPrice: '500.00',
      commissionBasePrice: '500.00',
      plusPriceUpperLimit: null,
    });
    await makeItem(NO_PRICE, {
      currentPrice: null,
      commissionBasePrice: null,
      plusPriceUpperLimit: null,
    });
    // CONTROL's prices; only the named percent (or both) is unknown.
    const controlPrices: SeededPrices = {
      currentPrice: '500.00',
      commissionBasePrice: '500.00',
      plusPriceUpperLimit: '500.00',
    };
    await makeItem(NO_CURRENT_PCT, controlPrices, {
      currentCommissionPct: null,
      plusCommissionPct: '15.4',
    });
    await makeItem(NO_PLUS_PCT, controlPrices, {
      currentCommissionPct: '19.0000',
      plusCommissionPct: null,
    });
    await makeItem(NO_PCT, controlPrices, { currentCommissionPct: null, plusCommissionPct: null });

    accessToken = user.accessToken;
    detailUrl = `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff.id}`;
  });

  async function fetchItems(): Promise<readonly UnknownPriceItem[]> {
    const res = await app.request(detailUrl, { headers: { Authorization: bearer(accessToken) } });
    expect(res.status).toBe(200);
    return UnknownPriceDetailSchema.parse(await res.json()).periods[0]?.items ?? [];
  }

  function itemOf(items: readonly UnknownPriceItem[], barcode: string): UnknownPriceItem {
    const item = items.find((i) => i.barcode === barcode);
    if (item === undefined) throw new Error(`detail item ${barcode} missing`);
    return item;
  }

  it('returns null prices and a null current profit when neither baseline price is known, with the Plus profit computed', async () => {
    const items = await fetchItems();
    const control = itemOf(items, CONTROL);
    const row = itemOf(items, NO_BASELINE);

    expect(row.currentPrice).toBeNull();
    expect(row.commissionBasePrice).toBeNull();
    expect(row.currentNetProfit).toBeNull();
    expect(row.currentMarginPct).toBeNull();
    // The offer is still priced at its known ceiling, exactly as the control's.
    expect(row.plusPriceUpperLimit).toBe('500.00');
    expect(row.plus.price).toBe('500.00');
    expect(row.plus.netProfit).not.toBeNull();
    expect(row.plus.netProfit).toBe(control.plus.netProfit);
    expect(row.plus.marginPct).toBe(control.plus.marginPct);
    // The calculable offer decides calculability.
    expect(row.calculable).toBe(true);
    expect(row.reason).toBeNull();
    // Plus wins on the control; with no current profit there is nothing to compare.
    expect(control.plusIsBetter).toBe(true);
    expect(row.plusIsBetter).toBe(false);
  });

  it('computes the current profit from the current price when only the commission base price is unknown', async () => {
    const items = await fetchItems();
    const control = itemOf(items, CONTROL);
    const other = itemOf(items, CONTROL_400);
    const row = itemOf(items, NO_COMMISSION_BASE);

    expect(row.commissionBasePrice).toBeNull();
    expect(row.currentPrice).toBe('400.00');
    expect(row.calculable).toBe(true);
    expect(row.reason).toBeNull();
    // Priced at the current price 400: CONTROL_400's figures, not the 500 of the ceiling
    // or the variant's sale price (CONTROL's figures).
    expect(row.currentNetProfit).not.toBeNull();
    expect(row.currentNetProfit).toBe(other.currentNetProfit);
    expect(row.currentMarginPct).toBe(other.currentMarginPct);
    expect(row.currentNetProfit).not.toBe(control.currentNetProfit);
    // Both profits are known, so the Plus offer is priced at its own ceiling as usual.
    expect(row.plus.price).toBe('500.00');
    expect(row.plus.netProfit).toBe(control.plus.netProfit);
  });

  it('returns the Plus offer with price null and no profit when the ceiling is unknown, and plusIsBetter false', async () => {
    const items = await fetchItems();
    const control = itemOf(items, CONTROL);
    const row = itemOf(items, NO_CEILING);

    expect(row.plusPriceUpperLimit).toBeNull();
    expect(row.plus.price).toBeNull();
    expect(row.plus.netProfit).toBeNull();
    expect(row.plus.marginPct).toBeNull();
    expect(row.plus.commissionPct).toBe('15.4');
    // The current figures are computed as usual.
    expect(row.currentPrice).toBe('500.00');
    expect(row.commissionBasePrice).toBe('500.00');
    expect(row.currentNetProfit).not.toBeNull();
    expect(row.currentNetProfit).toBe(control.currentNetProfit);
    expect(row.currentMarginPct).toBe(control.currentMarginPct);
    expect(row.calculable).toBe(true);
    expect(row.reason).toBeNull();
    // The control (same prices, ceiling known) says Plus is better; an unknown ceiling never does.
    expect(control.plusIsBetter).toBe(true);
    expect(row.plusIsBetter).toBe(false);
  });

  it('returns calculable false with reason null when no price is known', async () => {
    const items = await fetchItems();
    const row = itemOf(items, NO_PRICE);

    expect(row.calculable).toBe(false);
    expect(row.reason).toBeNull();
    expect(row.currentPrice).toBeNull();
    expect(row.commissionBasePrice).toBeNull();
    expect(row.plusPriceUpperLimit).toBeNull();
    expect(row.currentNetProfit).toBeNull();
    expect(row.currentMarginPct).toBeNull();
    expect(row.plus.price).toBeNull();
    expect(row.plus.netProfit).toBeNull();
    expect(row.plus.marginPct).toBeNull();
    expect(row.plusIsBetter).toBe(false);
    // The same variant prices the control: this is the unknown prices, not a degraded base.
    expect(itemOf(items, CONTROL).calculable).toBe(true);
  });

  it('does not log a profit-read failure for a row with an unknown price', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const items = await fetchItems();
      // The no-price row has the degrade shape (not calculable, reason null) beside a
      // calculable control on the same variant, yet the degrade path's log never runs.
      expect(itemOf(items, CONTROL).calculable).toBe(true);
      const noPrice = itemOf(items, NO_PRICE);
      expect(noPrice.calculable).toBe(false);
      expect(noPrice.reason).toBeNull();
      expect(itemOf(items, NO_BASELINE).calculable).toBe(true);
      expect(itemOf(items, NO_CEILING).calculable).toBe(true);
      // An unknown price is not a failure: nothing throws, so nothing is logged.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns a null current profit when the current commission is unknown, with the Plus profit computed', async () => {
    const items = await fetchItems();
    const control = itemOf(items, CONTROL);
    const row = itemOf(items, NO_CURRENT_PCT);

    // No made-up 0: the unknown percent stays null on the wire, the prices stay known.
    expect(row.currentCommissionPct).toBeNull();
    expect(control.currentCommissionPct).toBe('19.0000');
    expect(row.currentPrice).toBe('500.00');
    expect(row.commissionBasePrice).toBe('500.00');
    // The control prices the same baseline at 19%; this row has no current figures at all.
    expect(control.currentNetProfit).not.toBeNull();
    expect(row.currentNetProfit).toBeNull();
    expect(row.currentMarginPct).toBeNull();
    // The offer reads only its own percent: priced exactly as the control's.
    expect(row.plus.price).toBe('500.00');
    expect(row.plus.commissionPct).toBe('15.4');
    expect(row.plus.netProfit).not.toBeNull();
    expect(row.plus.netProfit).toBe(control.plus.netProfit);
    expect(row.plus.marginPct).toBe(control.plus.marginPct);
    // The calculable offer decides calculability; with no current profit Plus is never
    // "better" (the control, with the same numbers, says it is).
    expect(row.calculable).toBe(true);
    expect(row.reason).toBeNull();
    expect(control.plusIsBetter).toBe(true);
    expect(row.plusIsBetter).toBe(false);
  });

  it('returns the Plus offer with its price, a null commissionPct and no profit when the Plus commission is unknown, and plusIsBetter false', async () => {
    const items = await fetchItems();
    const control = itemOf(items, CONTROL);
    const row = itemOf(items, NO_PLUS_PCT);

    // The ceiling is known, so the offer echoes its price; its percent is unknown, so it
    // has no commission and no profit (never priced at 0%).
    expect(row.plusPriceUpperLimit).toBe('500.00');
    expect(row.plus.price).toBe('500.00');
    expect(row.plus.commissionPct).toBeNull();
    expect(row.plus.netProfit).toBeNull();
    expect(row.plus.marginPct).toBeNull();
    expect(control.plus.netProfit).not.toBeNull();
    // The current figures read only the current percent: computed exactly as the control's.
    expect(row.currentCommissionPct).toBe('19.0000');
    expect(row.currentNetProfit).not.toBeNull();
    expect(row.currentNetProfit).toBe(control.currentNetProfit);
    expect(row.currentMarginPct).toBe(control.currentMarginPct);
    expect(row.calculable).toBe(true);
    expect(row.reason).toBeNull();
    // The control says Plus is better; an offer with no profit never is.
    expect(control.plusIsBetter).toBe(true);
    expect(row.plusIsBetter).toBe(false);
  });

  it('returns calculable false with reason null when both commissions are unknown', async () => {
    const items = await fetchItems();
    const row = itemOf(items, NO_PCT);

    expect(row.calculable).toBe(false);
    expect(row.reason).toBeNull();
    expect(row.currentCommissionPct).toBeNull();
    expect(row.currentNetProfit).toBeNull();
    expect(row.currentMarginPct).toBeNull();
    // The prices are known and echoed; neither scenario has a percent, so neither has a profit.
    expect(row.currentPrice).toBe('500.00');
    expect(row.plus.price).toBe('500.00');
    expect(row.plus.commissionPct).toBeNull();
    expect(row.plus.netProfit).toBeNull();
    expect(row.plus.marginPct).toBeNull();
    expect(row.plusIsBetter).toBe(false);
    // The same variant and prices price the control: this is the unknown percents, not a
    // degraded base.
    expect(itemOf(items, CONTROL).calculable).toBe(true);
  });
});

// The detail fields the late-variant case reads, parsed rather than cast.
const LateVariantItemSchema = z.object({
  id: z.string(),
  imageUrl: z.string().nullable(),
  currentNetProfit: z.string().nullable(),
  plus: z.object({ netProfit: z.string().nullable() }),
  calculable: z.boolean(),
  reason: z.string().nullable(),
});
const LateVariantDetailSchema = z.object({
  periods: z.array(z.object({ items: z.array(LateVariantItemSchema) })),
});
type LateVariantItem = z.infer<typeof LateVariantItemSchema>;

describe('Plus Commission Tariffs - the item variant is resolved from the barcode at read time', () => {
  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('an item imported before its variant existed is priced once the variant exists', async () => {
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Plus Late Variant Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'plus-late-variant-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'COGS Late Variant',
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
        name: 'COGS Late Variant',
        type: 'COGS',
        amountGross: new Decimal('200.00'),
        vatRate: 20,
        changedFields: [],
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    });
    // Earlier blocks truncate, and the detail resolves fee definitions unconditionally.
    await ensureFeeDefinitions();

    const tariff = await prisma.plusCommissionTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Gec Eslesme Tarifesi' },
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
    // Uploaded before the product sync: no catalog variant carried the barcode, so the
    // import stored no variant link. Every price and percent is known.
    const item = await prisma.plusCommissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: null,
        barcode: 'BC-PLATE',
        productTitle: 'Gec Eslesen Urun',
        currentPrice: '500.00',
        commissionBasePrice: '500.00',
        currentCommissionPct: '19.0000',
        plusPriceUpperLimit: '450.00',
        plusCommissionPct: '15.4',
        plusCommissionBasePrice: '450.00',
        sortOrder: 0,
      },
    });

    const detailUrl = `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff.id}`;
    const fetchItem = async (): Promise<LateVariantItem> => {
      const res = await app.request(detailUrl, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const detail = LateVariantDetailSchema.parse(await res.json());
      const row = detail.periods[0]?.items.find((i) => i.id === item.id);
      if (row === undefined) throw new Error('detail item BC-PLATE missing');
      return row;
    };

    // No catalog variant carries the barcode yet.
    const before = await fetchItem();
    expect(before.calculable).toBe(false);
    expect(before.reason).toBe('NO_PRODUCT');
    expect(before.imageUrl).toBeNull();
    expect(before.currentNetProfit).toBeNull();
    expect(before.plus.netProfit).toBeNull();

    // The product sync lands the product and its variant (with a cost) after the upload.
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 9001n,
        productMainId: 'pm-9001',
        title: 'Gec Eslesen Urun',
        categoryId: 597n,
        categoryName: 'Gomlek',
        brandId: 2032n,
        brandName: 'Modline',
        // Two images: the detail must surface the first one.
        imageUrls: ['https://cdn.example/plus-late-0.jpg', 'https://cdn.example/plus-late-1.jpg'],
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: 90010n,
        barcode: 'BC-PLATE',
        stockCode: 'STK-PLATE',
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: 20,
        dimensionalWeightOverride: new Decimal('3.0'),
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
    });

    // The same GET, with no re-upload, now prices the item and shows its image.
    const after = await fetchItem();
    expect(after.calculable).toBe(true);
    expect(after.reason).toBeNull();
    expect(after.currentNetProfit).not.toBeNull();
    expect(after.plus.netProfit).not.toBeNull();
    expect(after.imageUrl).toBe('https://cdn.example/plus-late-0.jpg');

    // The reads resolved the variant without writing the stored link back.
    const stored = await prisma.plusCommissionTariffItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { productVariantId: true },
    });
    expect(stored.productVariantId).toBeNull();
  });
});
