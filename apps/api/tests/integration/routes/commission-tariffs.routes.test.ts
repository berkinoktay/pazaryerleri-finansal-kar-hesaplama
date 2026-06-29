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
        { key: 'band1', threshold: '500.00', commissionPct: '0.19' },
        { key: 'band2', threshold: '450.00', commissionPct: '0.15' },
        { key: 'band3', threshold: '400.00', commissionPct: '0.12' },
        { key: 'band4', threshold: '350.00', commissionPct: '0.10' },
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
      bands: [{ key: 'band1', threshold: '300.00', commissionPct: '0.20' }],
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
    expect(matched?.bands).toHaveLength(4);
    // Every band has a real (non-null) net profit + margin, and a best band is marked.
    for (const band of matched?.bands ?? []) {
      expect(band.netProfit).not.toBeNull();
      expect(band.marginPct).not.toBeNull();
    }
    expect(matched?.bestBandKey).not.toBeNull();
    expect(matched?.bands.map((b) => b.key)).toContain(matched?.bestBandKey);

    const unmatched = period?.items.find((i) => i.barcode === 'BC-UNKNOWN');
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
    expect(unmatched?.bands[0]?.netProfit).toBeNull();
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
