// Happy-path integration tests for the saved Advantage Product Labels endpoints
// (list / detail / commission-source / delete).
//
// Mirror of plus-commission-tariffs.routes.test.ts, adapted for the Advantage
// vertical: there is NO commission and NO period in this Excel — each product
// exposes three STAR TIERS (Avantaj / Çok Avantaj / Süper Avantaj) whose reduced
// commission is READ from the store's Commission Tariff at compute time. A tier's
// target price lands into a commission BAND and THAT band's rate is used; the
// detail also surfaces WHICH commission tariff/period supplied the rates
// (`commissionSource`, `commissionSourceMode`).
//
// A calculable item needs cost (TRY profile) + shipping (SENDEOMP /
// TRENDYOL_CONTRACT) + fee definitions + a resolvable commission (a band, else the
// category rate). The fixture seeds a commission tariff whose ACTIVE period holds
// four bands covering the matched product's three tier prices and its current
// price, so every tier resolves to a band. Fixture is built once in beforeAll
// (each Supabase auth user costs ~800 ms). SENDEOMP is ensured by globalSetup.

import { readFileSync } from 'node:fs';

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

// The real Trendyol "Avantajlı Ürün Etiketleri" export — used only by the import
// validation case below (a valid file must parse before the commission-source pin
// is validated).
const ADVANTAGE_FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-advantage-tariff.xlsx', import.meta.url),
);

interface TierWire {
  key: string;
  upperLimit: string;
  lowerLimit: string | null;
  price: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'category' | null;
  netProfit: string | null;
  marginPct: string | null;
}
interface CurrentWire {
  netProfit: string | null;
  marginPct: string | null;
  isBest: boolean;
}
interface ItemWire {
  id: string;
  barcode: string;
  stockCode: string | null;
  productTitle: string;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  size: string | null;
  stock: number | null;
  currentPrice: string;
  customerPrice: string;
  hasCommissionTariff: boolean;
  calculable: boolean;
  reason: string | null;
  current: CurrentWire;
  tiers: TierWire[];
  bestTierKey: string | null;
  selectedTier: string | null;
  customPrice: string | null;
}
interface CommissionSourceWire {
  tariffId: string;
  tariffName: string;
  periodLabel: string;
  startsAt: string | null;
  endsAt: string | null;
}
interface DetailWire {
  id: string;
  name: string;
  exported: boolean;
  commissionSourceMode: 'pinned' | 'category';
  commissionSource: CommissionSourceWire | null;
  hasUnmatchedCommissionProducts: boolean;
  items: ItemWire[];
}
interface ListWire {
  data: {
    id: string;
    name: string;
    productCount: number;
    selectedCount: number;
    exported: boolean;
    updatedAt: string;
  }[];
}

interface TariffFixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  tariffId: string;
  commissionTariffId: string;
  matchedItemId: string;
}

const MATCHED_BARCODE = 'ADV-1';

// Four bands covering the matched product's three tier prices + its current price:
//   current 360.00 → band1 (19)   ·  tier1 292.91 → band2 (13.1)
//   tier2   274.42 → band3 (11.5) ·  tier3 223.78 → band4 (8.8)
// (band1 has no upper, band4 no lower — the persisted JSON omits null limits).
const MATCHED_BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '280.00', upperLimit: '299.99', commissionPct: '13.1' },
  { key: 'band3', lowerLimit: '250.00', upperLimit: '279.99', commissionPct: '11.5' },
  { key: 'band4', upperLimit: '249.99', commissionPct: '8.8' },
];

const MATCHED_STAR_TIERS = [
  { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
  { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
  { key: 'tier3', upperLimit: '223.78' },
];

/**
 * Builds an org + store with one calculable variant (TRY cost + SENDEOMP shipping
 * + fee defs), an active-period Commission Tariff whose bands cover the product,
 * and a saved Advantage tariff (PINNED to that commission tariff) with two items:
 * one matched to the variant (three star tiers) and one unmatched (no catalog
 * product). The pin makes the commission tariff the reduced-rate source (there is
 * no silent auto-resolution).
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
      name: 'Advantage Tariff Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'advantage-tariff-test',
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
      title: 'Avantaj Ürünü',
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
      platformVariantId: 85010n,
      barcode: MATCHED_BARCODE,
      stockCode: 'STK-ADV',
      salePrice: new Decimal('360.00'),
      listPrice: new Decimal('360.00'),
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
        url: 'https://cdn.example/adv-1.jpg',
        position: 1,
      },
      {
        organizationId: org.id,
        productId: product.id,
        url: 'https://cdn.example/adv-0.jpg',
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

  // ─── Commission Tariff (the cross-vertical source) — active period + bands ──
  const commissionTariff = await prisma.commissionTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Temmuz Komisyon Tarifesi' },
  });
  const now = Date.now();
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: commissionTariff.id,
      dateRangeLabel: '7 - 14 Temmuz',
      startsAt: new Date(now - 86_400_000),
      endsAt: new Date(now + 86_400_000),
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
      stockCode: 'STK-ADV',
      productTitle: 'Avantaj Ürünü',
      currentPrice: '360.00',
      currentCommissionPct: '0.1900',
      bands: MATCHED_BANDS,
    },
  });

  // ─── Advantage tariff + items ───────────────────────────────────────────────
  const tariff = await prisma.advantageTariff.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Avantajlı Ürün Etiketleri',
      // The seller pins this advantage to the commission tariff (week) whose bands
      // supply the reduced rates — there is no silent auto-resolution.
      commissionSourceTariffId: commissionTariff.id,
    },
  });
  const matched = await prisma.advantageTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      stockCode: 'STK-ADV',
      productTitle: 'Avantaj Ürünü',
      category: 'Bayrak',
      brand: 'Alpaka',
      currentPrice: '360.00',
      customerPrice: '360.00',
      hasCommissionTariff: true,
      starTiers: MATCHED_STAR_TIERS,
      applyUntilEnd: false,
      sortOrder: 0,
    },
  });
  await prisma.advantageTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      barcode: 'ADV-UNKNOWN',
      productTitle: 'Eşleşmeyen Ürün',
      currentPrice: '300.00',
      customerPrice: '300.00',
      // No catalog match AND no commission tariff flag → excluded from the
      // "Var but no band" hybrid-warning signal, so the matched item (which DOES
      // match a band) leaves hasUnmatchedCommissionProducts false.
      hasCommissionTariff: false,
      starTiers: [
        { key: 'tier1', upperLimit: '250.00', lowerLimit: '240.00' },
        { key: 'tier2', upperLimit: '239.99', lowerLimit: '200.00' },
        { key: 'tier3', upperLimit: '199.99' },
      ],
      applyUntilEnd: false,
      sortOrder: 1,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    tariffId: tariff.id,
    commissionTariffId: commissionTariff.id,
    matchedItemId: matched.id,
  };
}

describe('Advantage Product Labels - list / detail / commission-source / delete', () => {
  let fx: TariffFixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupTariffFixture();
  });

  it('lists the saved tariff with product + selection aggregates', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListWire;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.id).toBe(fx.tariffId);
    expect(row?.name).toBe('Avantajlı Ürün Etiketleri');
    expect(row?.productCount).toBe(2);
    expect(row?.selectedCount).toBe(0);
    expect(row?.exported).toBe(false);
    expect(typeof row?.updatedAt).toBe('string');
  });

  it('returns the detail with per-tier profit read from the commission tariff bands', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    expect(body.id).toBe(fx.tariffId);
    // The fixture pins this advantage to the commission tariff → pinned source.
    expect(body.commissionSourceMode).toBe('pinned');
    expect(body.commissionSource).not.toBeNull();
    expect(body.commissionSource?.tariffId).toBe(fx.commissionTariffId);
    expect(body.commissionSource?.periodLabel).toBe('7 - 14 Temmuz');
    expect(body.commissionSource?.startsAt).not.toBeNull();
    expect(body.commissionSource?.endsAt).not.toBeNull();
    // All the file's "Var" products matched a band → no hybrid warning.
    expect(body.hasUnmatchedCommissionProducts).toBe(false);
    expect(body.items).toHaveLength(2);

    const matched = body.items.find((i) => i.barcode === MATCHED_BARCODE);
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    expect(matched?.hasCommissionTariff).toBe(true);
    // The matched item surfaces its catalog product's position-0 image.
    expect(matched?.imageUrl).toBe('https://cdn.example/adv-0.jpg');
    // Every tier resolved its reduced commission from a band and has a real profit.
    expect(matched?.tiers).toHaveLength(3);
    for (const tier of matched?.tiers ?? []) {
      expect(tier.commissionPct).not.toBeNull();
      expect(tier.commissionSource).toBe('band');
      expect(tier.netProfit).not.toBeNull();
      expect(tier.marginPct).not.toBeNull();
    }
    // The three tier prices landed in the three lower bands (13.1 / 11.5 / 8.8).
    // commissionPct is serialized at 4-decimal precision (matching the commission-tariff
    // vertical's `toFixed(4)`), so the full applied rate is preserved on the wire.
    expect(matched?.tiers.map((t) => t.commissionPct)).toEqual(['13.1000', '11.5000', '8.8000']);
    // The "do nothing" baseline (current price + its band commission) is computed.
    expect(matched?.current.netProfit).not.toBeNull();
    expect(matched?.current.marginPct).not.toBeNull();
    // Every scenario here runs at a loss (cost 200 against the marketplace's commission +
    // fees), so "En kârlı" is shown NOWHERE — neither a tier nor the current baseline is
    // flagged. This is the regression Berkin caught: a loss must never read as "best".
    expect(Number(matched?.current.netProfit)).toBeLessThan(0);
    expect(matched?.current.isBest).toBe(false);
    expect(matched?.bestTierKey).toBeNull();

    const unmatched = body.items.find((i) => i.barcode === 'ADV-UNKNOWN');
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
    expect(unmatched?.tiers.every((t) => t.netProfit === null)).toBe(true);
    // An uncalculable item is never "En kârlı" — neither a tier nor the current baseline.
    expect(unmatched?.bestTierKey).toBeNull();
    expect(unmatched?.current.isBest).toBe(false);
    // An unmatched item has no catalog product, so no image.
    expect(unmatched?.imageUrl).toBeNull();
  });

  it('re-pins the commission source then clears it back to category', async () => {
    const url = `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}/commission-source`;

    const pin = await app.request(url, {
      method: 'PATCH',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ commissionSourceTariffId: fx.commissionTariffId }),
    });
    expect(pin.status).toBe(200);
    expect(
      ((await pin.json()) as { commissionSourceTariffId: string | null }).commissionSourceTariffId,
    ).toBe(fx.commissionTariffId);

    // Detail reports the pinned source (bands resolve → the reduced rates).
    const pinnedDetail = (await (
      await app.request(
        `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}`,
        { headers: { Authorization: bearer(fx.accessToken) } },
      )
    ).json()) as DetailWire;
    expect(pinnedDetail.commissionSourceMode).toBe('pinned');
    expect(pinnedDetail.commissionSource?.tariffId).toBe(fx.commissionTariffId);

    // Clearing the pin drops back to category commission (no tariff supplies bands).
    const clear = await app.request(url, {
      method: 'PATCH',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ commissionSourceTariffId: null }),
    });
    expect(clear.status).toBe(200);
    expect(
      ((await clear.json()) as { commissionSourceTariffId: string | null })
        .commissionSourceTariffId,
    ).toBeNull();

    const categoryDetail = (await (
      await app.request(
        `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}`,
        { headers: { Authorization: bearer(fx.accessToken) } },
      )
    ).json()) as DetailWire;
    expect(categoryDetail.commissionSourceMode).toBe('category');
    expect(categoryDetail.commissionSource).toBeNull();

    // Restore the pin so later reads of the fixture stay pinned.
    await app.request(url, {
      method: 'PATCH',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ commissionSourceTariffId: fx.commissionTariffId }),
    });
  });

  it('an UNPINNED advantage resolves to category mode (no commission tariff supplies bands)', async () => {
    const tariff = await prisma.advantageTariff.create({
      // No commissionSourceTariffId → the seller chose category commission at upload.
      data: { organizationId: fx.orgId, storeId: fx.storeId, name: 'Kategori Komisyonlu Avantaj' },
    });
    await prisma.advantageTariffItem.create({
      data: {
        organizationId: fx.orgId,
        storeId: fx.storeId,
        tariffId: tariff.id,
        barcode: 'ADV-CAT',
        productTitle: 'Kategori Ürünü',
        currentPrice: '300.00',
        customerPrice: '300.00',
        hasCommissionTariff: false,
        starTiers: [{ key: 'tier1', upperLimit: '250.00' }],
        applyUntilEnd: false,
        sortOrder: 0,
      },
    });

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${tariff.id}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    // Nothing pinned → category commission; no source surfaced.
    expect(body.commissionSourceMode).toBe('category');
    expect(body.commissionSource).toBeNull();

    // Clean up so the store's tariff list stays at the shared fixture's one row.
    await prisma.advantageTariff.delete({ where: { id: tariff.id } });
  });

  it('rejects an import pinned to a commission tariff from outside the store (422)', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(ADVANTAGE_FIXTURE)]),
      'trendyol_avantajli_urun_etiketleri.xlsx',
    );
    // A random/foreign id is not a commission tariff of this store.
    form.append('commissionSourceTariffId', crypto.randomUUID());

    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/import`,
        { method: 'POST', headers: { Authorization: bearer(fx.accessToken) }, body: form },
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      errors: { field: string; code: string }[];
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors[0]?.field).toBe('commissionSourceTariffId');
    expect(body.errors[0]?.code).toBe('INVALID_COMMISSION_SOURCE');
  });

  it('404s when pinning a commission tariff from another store', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}/commission-source`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ commissionSourceTariffId: crypto.randomUUID() }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('deletes the tariff and then lists empty', async () => {
    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);

    const detail = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs/${fx.tariffId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(detail.status).toBe(404);

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/advantage-tariffs`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListWire).data).toHaveLength(0);
  });
});
