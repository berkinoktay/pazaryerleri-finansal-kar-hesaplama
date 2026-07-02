// Happy-path integration tests for the saved Plus Commission Tariffs endpoints
// (list / detail / delete).
//
// Mirror of commission-tariffs.routes.test.ts, adapted for Plus: there are NO
// bands and NO period nesting — each item carries a CURRENT scenario (current
// price @ current commission) and a PLUS scenario (the Plus price ceiling @ the
// reduced Plus commission), both computed on read. The seller's opt-in is a
// boolean (`selected`), not a chosen band.
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
  calculable: boolean;
  reason: string | null;
  current: ScenarioWire;
  plus: ScenarioWire;
  plusIsBetter: boolean;
  selected: boolean;
  customPrice: string | null;
}
interface DetailWire {
  id: string;
  name: string;
  dateRangeLabel: string;
  validity: string | null;
  exported: boolean;
  items: ItemWire[];
}
interface ListWire {
  data: {
    id: string;
    name: string;
    productCount: number;
    selectedCount: number;
    exported: boolean;
    validity: string | null;
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
 * + fee defs) and a saved Plus tariff with two items: one matched to that variant
 * (opted into Plus) and one unmatched (no catalog product).
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
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Plus Tarifesi',
      dateRangeLabel: '30 Haziran - 7 Temmuz',
    },
  });
  // Matched item: opted into Plus.
  await prisma.plusCommissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
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
      tariffId: tariff.id,
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

  it('lists the saved tariff with product + opt-in aggregates', async () => {
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
    // No parseable period dates -> validity is null.
    expect(row?.validity).toBeNull();
    expect(typeof row?.updatedAt).toBe('string');
  });

  it('returns the detail with current + Plus profit computed for the matched item', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/plus-commission-tariffs/${fx.tariffId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    expect(body.id).toBe(fx.tariffId);
    expect(body.dateRangeLabel).toBe('30 Haziran - 7 Temmuz');
    expect(body.items).toHaveLength(2);

    const matched = body.items.find((i) => i.barcode === 'BC-PLUS');
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    expect(matched?.selected).toBe(true);
    // The matched item surfaces its catalog product's position-0 image.
    expect(matched?.imageUrl).toBe('https://cdn.example/plus-0.jpg');
    // Both scenarios have a real (non-null) net profit + margin.
    expect(matched?.current.price).toBe('500.00');
    expect(matched?.current.netProfit).not.toBeNull();
    expect(matched?.current.marginPct).not.toBeNull();
    expect(matched?.plus.price).toBe('450.00');
    expect(matched?.plus.netProfit).not.toBeNull();
    expect(matched?.plus.marginPct).not.toBeNull();
    expect(typeof matched?.plusIsBetter).toBe('boolean');

    const unmatched = body.items.find((i) => i.barcode === 'BC-UNKNOWN');
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
    expect(unmatched?.current.netProfit).toBeNull();
    expect(unmatched?.plus.netProfit).toBeNull();
    // An unmatched item has no catalog product, so no image.
    expect(unmatched?.imageUrl).toBeNull();
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
