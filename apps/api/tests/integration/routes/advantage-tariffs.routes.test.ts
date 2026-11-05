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
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
interface CommissionBandWire {
  lowerLimit: string | null;
  upperLimit: string | null;
  commissionPct: string;
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
  commissionBands: CommissionBandWire[] | null;
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
      // Two images: the detail must surface the first one for the matched item.
      imageUrls: ['https://cdn.example/adv-0.jpg', 'https://cdn.example/adv-1.jpg'],
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
    // The matched item surfaces its catalog product's first image.
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
    // --- Golden tier profit (hand-derived from the fixture, NOT the engine) ---
    // Locks that the chosen band rate flows into the engine at the tier's own price.
    // tier2 is priced at its upperLimit 274.42 and lands in band3 -> 11.5% commission.
    // Same fixture constants as product-pricing: cost 200 GROSS (VAT 20%), SENDEOMP
    // desi-3 ship 122.39 GROSS, PSF 13.19 GROSS, sale VAT 20%, commission VAT 20%,
    // stoppage 1% of NET sale; store has no profitSettings -> defaults (includeStopaj
    // true, includeNegativeNetVat FALSE). Each line's VAT rounds half-up to the kurus;
    // netProfit = sum of signed line GROSS (incl. stoppage) minus effective net VAT
    // (floored at 0 when the net VAT is negative):
    //   saleGross 274.42; commission round(0.115*274.42)=31.56; ship 122.39; psf 13.19;
    //   cost 200.00; saleVAT round(274.42/6)=45.74 -> saleNet 228.68 -> stoppage 2.29
    //   inputVAT = cost 33.33 + comm round(31.56/6)=5.26 + ship 20.40 + psf 2.20 = 61.19
    //   netVAT 45.74 - 61.19 = -15.45 < 0 -> floored to 0 (negative net VAT excluded)
    //   netProfit = 274.42 - 31.56 - 122.39 - 13.19 - 200.00 - 2.29 - 0 = -95.01
    expect(matched?.tiers[1]?.netProfit).toBe('-95.01');
    // The band-sourced item surfaces its full commission-band ladder (top-down), so the
    // UI can label WHICH band a price lands in. Money at 2 decimals, percent at 4 —
    // omitted limits (band1 upper, band4 lower) serialize to null.
    expect(matched?.commissionBands).toEqual([
      { lowerLimit: '300.00', upperLimit: null, commissionPct: '19.0000' },
      { lowerLimit: '280.00', upperLimit: '299.99', commissionPct: '13.1000' },
      { lowerLimit: '250.00', upperLimit: '279.99', commissionPct: '11.5000' },
      { lowerLimit: null, upperLimit: '249.99', commissionPct: '8.8000' },
    ]);
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
    // Its barcode is not in the commission tariff → no band ladder to show (null).
    expect(unmatched?.commissionBands).toBeNull();
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

describe('Advantage Product Labels — per-item degrade (decision 9)', () => {
  // TWO items' scenarios are forced to throw (a negative customer price, which the
  // engine's unit-price validator rejects): the detail must still return 200 with those
  // items' profit empty (reason null) while a third item computes fine, and the failures
  // must collapse into exactly one [profit-read] line per request with failedCount 2.
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('keeps the advantage detail up when items fail to compute and logs once', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Advantage Degrade Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'advantage-degrade-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    // brandId null so the category rate rule below matches on category alone.
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 8801n,
        productMainId: 'pm-8801',
        title: 'Bozulma Avantaj Urunu',
        categoryId: 599n,
        categoryName: 'Kategori',
        brandId: null,
        brandName: null,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: 88010n,
        barcode: 'ADV-DEG',
        stockCode: 'STK-ADEG',
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
        name: 'COGS Adv Degrade',
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
        name: 'COGS Adv Degrade',
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
    // A CATEGORY commission rate so the unpinned (category-mode) advantage resolves a
    // commission for the matched variant -> the healthy item is calculable.
    await prisma.marketplaceCommissionRate.create({
      data: {
        platform: 'TRENDYOL',
        ruleKind: 'CATEGORY',
        categoryId: 599n,
        brandId: null,
        categoryName: 'Kategori',
        parentCategoryName: 'Ust Kategori',
        brandName: null,
        baseRate: new Decimal('15'),
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });

    // Unpinned -> category commission supplies the rate (no band ladder).
    const tariff = await prisma.advantageTariff.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Bozulma Avantaj' },
    });
    const tiers = [
      { key: 'tier1', upperLimit: '450.00', lowerLimit: '400.00' },
      { key: 'tier2', upperLimit: '399.99', lowerLimit: '300.00' },
      { key: 'tier3', upperLimit: '299.99' },
    ];
    const baseItem = {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      productVariantId: variant.id,
      barcode: 'ADV-DEG',
      productTitle: 'Bozulma Avantaj Urunu',
      currentPrice: '500.00',
      hasCommissionTariff: false,
      starTiers: tiers,
      applyUntilEnd: false,
    };
    // Healthy item: a positive customer price -> computes.
    const okItem = await prisma.advantageTariffItem.create({
      data: { ...baseItem, customerPrice: '500.00', sortOrder: 0 },
    });
    // Two failing items: a NEGATIVE customer price makes the engine reject the baseline
    // unit price -> each item's compute throws.
    const fail1 = await prisma.advantageTariffItem.create({
      data: { ...baseItem, customerPrice: '-5.00', sortOrder: 1 },
    });
    const fail2 = await prisma.advantageTariffItem.create({
      data: { ...baseItem, customerPrice: '-7.00', sortOrder: 2 },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/advantage-tariffs/${tariff.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const items = ((await res.json()) as DetailWire).items;

      const ok = items.find((i) => i.id === okItem.id);
      expect(ok?.calculable).toBe(true);
      expect(ok?.current.netProfit).not.toBeNull();

      for (const failId of [fail1.id, fail2.id]) {
        const bad = items.find((i) => i.id === failId);
        expect(bad?.calculable).toBe(false);
        // A degraded compute carries no reason (not NO_PRODUCT -- the variant is matched).
        expect(bad?.reason).toBeNull();
        expect(bad?.current.netProfit).toBeNull();
        expect(bad?.tiers.every((t) => t.netProfit === null)).toBe(true);
      }

      // Two failing items collapse into exactly one [profit-read] line, failedCount 2.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({
          surface: 'advantage-tariff',
          orderId: null,
          failedCount: 2,
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
