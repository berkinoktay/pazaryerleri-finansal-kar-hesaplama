// Happy-path integration tests for the saved Flash Products endpoints
// (list / detail / delete) — with the commission-resolution matrix that is this
// vertical's novelty.
//
// A flash offer carries its OWN window dates but NO commission. The reduced rate is
// resolved AUTOMATICALLY (no upload-time picker) from the store's Commission Tariff:
// the offer window's END selects the covering week and, within it, the covering
// sub-period; that period's item bands (by barcode) supply the rate via bandForPrice.
// It falls back to the flat "Mevcut Komisyon" (I column) when the product is not
// flagged "Var", when no week covers the window, when the barcode is absent from the
// period, or when the bands are empty — there is NO category fallback (the difference
// from Advantage).
//
// The fixture builds ONE commission week split into two sub-periods (3-Gün + 4-Gün)
// whose SAME barcode carries DIFFERENT bands per period. Offer rows of that same product
// — one whose window sits wholly in the first sub-period, one wholly in the second —
// resolve to DIFFERENT commissions. That is the novelty lock: same product, same offer
// price, different rate because the window lands in a different period. A THIRD row locks
// the straddling-window END rule: a 00:00–23:59 window that STARTS in the first sub-period
// but ENDS in the second resolves to the SECOND period's band (the TB300X450R 10 Temmuz
// case — Trendyol anchors a boundary-straddling window to the period containing its END,
// verified live 2026-07-07). Three more rows exercise each flat-fallback branch. A
// calculable row needs cost (TRY profile) + shipping (SENDEOMP) + fee definitions;
// SENDEOMP is ensured by globalSetup. The same fixture with an unknown (NULL) flat rate
// proves that rate is never priced at 0%: no current profit, no flat-fallback offer profit,
// while a band-covered offer still computes.

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

const MATCHED_BARCODE = 'FLASH-1';
const NOBAND_BARCODE = 'FLASH-NOBAND';
const OFFER_PRICE = '260.00';
const FLAT_COMMISSION = '19'; // "Mevcut Komisyon" (I) — the flat fallback percent

// Period 1 (3-Gün) bands for the matched barcode: 260 lands in band2 (250–299.99 → 11.5).
const PERIOD1_BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '250.00', upperLimit: '299.99', commissionPct: '11.5' },
  { key: 'band3', upperLimit: '249.99', commissionPct: '8' },
];
// Period 2 (4-Gün) bands for the SAME barcode: 260 lands in band2 → 9 (the novelty).
const PERIOD2_BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '250.00', upperLimit: '299.99', commissionPct: '9' },
  { key: 'band3', upperLimit: '249.99', commissionPct: '6' },
];

/** İstanbul wall-clock (dd/MM/yyyy HH:mm) → the true instant the flash import stores. */
function flashInstant(year: number, month1: number, day: number, hour: number, minute = 0): Date {
  return businessZoneEpochToInstant(Date.UTC(year, month1 - 1, day, hour, minute));
}

interface OfferWire {
  price: string;
  startsAt: string | null;
  endsAt: string | null;
  validity: string | null;
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
}
interface CommissionBandWire {
  lowerLimit: string | null;
  upperLimit: string | null;
  commissionPct: string;
}
interface ItemWire {
  id: string;
  barcode: string;
  modelCode: string | null;
  productTitle: string;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  stock: number | null;
  externalId: string | null;
  currentPrice: string;
  customerPrice: string;
  currentCommissionPct: string;
  currentNetProfit: string | null;
  currentMarginPct: string | null;
  calculable: boolean;
  reason: string | null;
  hasCommissionTariff: boolean;
  commissionSource: 'band' | 'current';
  commissionBands: CommissionBandWire[] | null;
  offer24: OfferWire | null;
  offer3: OfferWire | null;
  selectedOffer: string | null;
  customPrice: string | null;
}
interface DetailWire {
  id: string;
  name: string;
  exported: boolean;
  items: ItemWire[];
}
interface ListWire {
  data: {
    id: string;
    name: string;
    productCount: number;
    itemCount: number;
    selectedCount: number;
    exported: boolean;
    updatedAt: string;
  }[];
}

interface Fixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  listId: string;
  itemPeriod1: string;
  itemPeriod2: string;
  itemStraddle: string;
  itemNoBand: string;
  itemFlagFalse: string;
  itemNoWeek: string;
}

/**
 * `flatCommission` is the "Mevcut Komisyon" (I) every flash row carries; null is a cell the
 * file left blank or unreadable (an unknown flat rate).
 */
async function setupFixture(flatCommission: string | null = FLAT_COMMISSION): Promise<Fixture> {
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
      name: 'Flash Products Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'flash-products-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  // ─── Two calculable variants (cost + shipping + fee defs) ────────────────────
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9101n,
      productMainId: 'pm-9101',
      title: 'Flaş Ürünü',
      categoryId: 597n,
      categoryName: 'Bayrak',
      brandId: 2032n,
      brandName: 'Alpaka',
      imageUrls: ['https://cdn.example/flash-1.jpg'],
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 91010n,
      barcode: MATCHED_BARCODE,
      stockCode: 'STK-FLASH',
      salePrice: new Decimal('360.00'),
      listPrice: new Decimal('360.00'),
      vatRate: 20,
      dimensionalWeightOverride: new Decimal('3.0'),
    },
  });
  const noBandProduct = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9102n,
      productMainId: 'pm-9102',
      title: 'Bandsız Flaş Ürünü',
      categoryId: 597n,
      categoryName: 'Bayrak',
      brandId: 2032n,
      brandName: 'Alpaka',
    },
  });
  const noBandVariant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: noBandProduct.id,
      platformVariantId: 91020n,
      barcode: NOBAND_BARCODE,
      stockCode: 'STK-NOBAND',
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
  // the real cost-profile service writes a version 1 on create. Without it the variants
  // would read MISSING_COST. One version covers both variants sharing this profile.
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
  await prisma.productVariantCostProfile.createMany({
    data: [
      { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
      { organizationId: org.id, profileId: profile.id, productVariantId: noBandVariant.id },
    ],
  });
  await ensureFeeDefinitions();

  // ─── Commission tariff: ONE week, two sub-periods with different bands ───────
  // Bounds are İstanbul wall-clock stored AS UTC (how the commission import persists
  // them). weekStartsAt/weekEndsAt span both sub-periods.
  const weekStart = new Date(Date.UTC(2026, 6, 8, 8, 0)); // 8 Temmuz 08.00
  const period1End = new Date(Date.UTC(2026, 6, 11, 8, 0)); // 11 Temmuz 08.00 (3-Gün)
  const weekEnd = new Date(Date.UTC(2026, 6, 15, 8, 0)); // 15 Temmuz 08.00 (4-Gün end)

  const commissionTariff = await prisma.commissionTariff.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Temmuz Komisyon Tarifesi',
      weekStartsAt: weekStart,
      weekEndsAt: weekEnd,
    },
  });
  const period1 = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: commissionTariff.id,
      dateRangeLabel: '8 Temmuz 08.00-11 Temmuz 07.59',
      dayCount: 3,
      startsAt: weekStart,
      endsAt: period1End,
      sortOrder: 0,
    },
  });
  const period2 = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: commissionTariff.id,
      dateRangeLabel: '11 Temmuz 08.00-15 Temmuz 07.59',
      dayCount: 4,
      startsAt: period1End,
      endsAt: weekEnd,
      sortOrder: 1,
    },
  });
  await prisma.commissionTariffItem.createMany({
    data: [
      {
        organizationId: org.id,
        storeId: store.id,
        periodId: period1.id,
        productVariantId: variant.id,
        barcode: MATCHED_BARCODE,
        stockCode: 'STK-FLASH',
        productTitle: 'Flaş Ürünü',
        currentPrice: '360.00',
        currentCommissionPct: '0.1900',
        bands: PERIOD1_BANDS,
        sortOrder: 0,
      },
      {
        organizationId: org.id,
        storeId: store.id,
        periodId: period2.id,
        productVariantId: variant.id,
        barcode: MATCHED_BARCODE,
        stockCode: 'STK-FLASH',
        productTitle: 'Flaş Ürünü',
        currentPrice: '360.00',
        currentCommissionPct: '0.1900',
        bands: PERIOD2_BANDS,
        sortOrder: 0,
      },
    ],
  });

  // ─── Flash list + items covering the resolution matrix ──────────────────────
  const list = await prisma.flashProductList.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Flaş Ürünler', createdBy: user.id },
  });

  const baseOfferItem = {
    organizationId: org.id,
    storeId: store.id,
    listId: list.id,
    productTitle: 'Flaş Ürünü',
    currentPrice: '360.00',
    customerPrice: '360.00',
    currentCommissionPct: flatCommission,
    offer24Price: OFFER_PRICE,
  };

  // (a) hasCommissionTariff + window in the FIRST sub-period → Period 1 band (11.5).
  const itemPeriod1 = await prisma.flashProductItem.create({
    data: {
      ...baseOfferItem,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      hasCommissionTariff: true,
      offer24StartsAt: flashInstant(2026, 7, 9, 0),
      offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
      sortOrder: 0,
    },
  });
  // (a) SAME product, window in the SECOND sub-period → Period 2 band (9). NOVELTY.
  const itemPeriod2 = await prisma.flashProductItem.create({
    data: {
      ...baseOfferItem,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      hasCommissionTariff: true,
      offer24StartsAt: flashInstant(2026, 7, 12, 0),
      offer24EndsAt: flashInstant(2026, 7, 12, 23, 59),
      sortOrder: 1,
    },
  });
  // (a′) STRADDLE: a 00:00–23:59 window whose START is in Period 1 (before the 11 Temmuz
  // 08.00 boundary) but whose END is in Period 2 → resolves to Period 2's band (9), NOT
  // Period 1's (11.5). This is the TB300X450R 10 Temmuz case: Trendyol anchors a
  // boundary-straddling window to the period containing its END (verified live 2026-07-07).
  const itemStraddle = await prisma.flashProductItem.create({
    data: {
      ...baseOfferItem,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      hasCommissionTariff: true,
      offer24StartsAt: flashInstant(2026, 7, 11, 0), // 11 Temmuz 00.00 → Period 1
      offer24EndsAt: flashInstant(2026, 7, 11, 23, 59), // 11 Temmuz 23.59 → Period 2
      sortOrder: 5,
    },
  });
  // (d) hasCommissionTariff but the barcode is absent from the period → flat.
  const itemNoBand = await prisma.flashProductItem.create({
    data: {
      ...baseOfferItem,
      productVariantId: noBandVariant.id,
      barcode: NOBAND_BARCODE,
      productTitle: 'Bandsız Flaş Ürünü',
      hasCommissionTariff: true,
      offer24StartsAt: flashInstant(2026, 7, 9, 0),
      offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
      sortOrder: 2,
    },
  });
  // (c) hasCommissionTariff = false → flat, no lookup at all.
  const itemFlagFalse = await prisma.flashProductItem.create({
    data: {
      ...baseOfferItem,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      hasCommissionTariff: false,
      offer24StartsAt: flashInstant(2026, 7, 9, 0),
      offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
      sortOrder: 3,
    },
  });
  // (b) hasCommissionTariff but the window falls in NO covering week → flat.
  const itemNoWeek = await prisma.flashProductItem.create({
    data: {
      ...baseOfferItem,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      hasCommissionTariff: true,
      offer24StartsAt: flashInstant(2026, 8, 1, 0),
      offer24EndsAt: flashInstant(2026, 8, 1, 23, 59),
      sortOrder: 4,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    listId: list.id,
    itemPeriod1: itemPeriod1.id,
    itemPeriod2: itemPeriod2.id,
    itemStraddle: itemStraddle.id,
    itemNoBand: itemNoBand.id,
    itemFlagFalse: itemFlagFalse.id,
    itemNoWeek: itemNoWeek.id,
  };
}

describe('Flash Products - list / detail / delete', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('lists the saved upload with product / item / selected aggregates', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListWire;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.id).toBe(fx.listId);
    expect(row?.name).toBe('Flaş Ürünler');
    // Two distinct barcodes (FLASH-1 recurs on five rows, FLASH-NOBAND on one).
    expect(row?.productCount).toBe(2);
    expect(row?.itemCount).toBe(6);
    expect(row?.selectedCount).toBe(0);
    expect(row?.exported).toBe(false);
  });

  it('resolves per-offer commission from the covering week+period, split by sub-period (the novelty)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    expect(body.id).toBe(fx.listId);
    expect(body.items).toHaveLength(6);

    const byId = new Map(body.items.map((i) => [i.id, i]));
    const p1 = byId.get(fx.itemPeriod1);
    const p2 = byId.get(fx.itemPeriod2);
    const straddle = byId.get(fx.itemStraddle);
    const noBand = byId.get(fx.itemNoBand);
    const flagFalse = byId.get(fx.itemFlagFalse);
    const noWeek = byId.get(fx.itemNoWeek);

    // (a) FIRST sub-period → Period 1 band (11.5). Band-sourced, ladder surfaced.
    expect(p1?.calculable).toBe(true);
    expect(p1?.commissionSource).toBe('band');
    expect(p1?.offer24?.commissionPct).toBe('11.5000');
    expect(p1?.offer24?.netProfit).not.toBeNull();
    // --- Golden offer profit (hand-derived from the fixture, NOT the engine) ---
    // Locks that the resolved band rate (Period 1 band2 = 11.5%) flows into the engine
    // at the offer price 260.00. Same fixture constants as product-pricing: cost 200
    // GROSS (VAT 20%), SENDEOMP desi-3 ship 122.39 GROSS, PSF 13.19 GROSS, sale VAT 20%,
    // commission VAT 20%, stoppage 1% of NET sale; store has no profitSettings ->
    // defaults (includeStopaj true, includeNegativeNetVat FALSE). Each line's VAT rounds
    // half-up to the kurus; netProfit = sum of signed line GROSS (incl. stoppage) minus
    // effective net VAT (floored at 0 when the net VAT is negative):
    //   saleGross 260.00; commission round(0.115*260)=29.90; ship 122.39; psf 13.19;
    //   cost 200.00; saleVAT round(260/6)=43.33 -> saleNet 216.67 -> stoppage 2.17
    //   inputVAT = cost 33.33 + comm round(29.90/6)=4.98 + ship 20.40 + psf 2.20 = 60.91
    //   netVAT 43.33 - 60.91 = -17.58 < 0 -> floored to 0 (negative net VAT excluded)
    //   netProfit = 260.00 - 29.90 - 122.39 - 13.19 - 200.00 - 2.17 - 0 = -107.65
    expect(p1?.offer24?.netProfit).toBe('-107.65');
    expect(p1?.imageUrl).toBe('https://cdn.example/flash-1.jpg');
    expect(p1?.commissionBands).toEqual([
      { lowerLimit: '300.00', upperLimit: null, commissionPct: '19.0000' },
      { lowerLimit: '250.00', upperLimit: '299.99', commissionPct: '11.5000' },
      { lowerLimit: null, upperLimit: '249.99', commissionPct: '8.0000' },
    ]);

    // (a) SECOND sub-period → Period 2 band (9). SAME product+price, DIFFERENT rate.
    expect(p2?.commissionSource).toBe('band');
    expect(p2?.offer24?.commissionPct).toBe('9.0000');
    // The novelty lock: identical barcode + offer price, different commission period.
    expect(p1?.barcode).toBe(p2?.barcode);
    expect(p1?.offer24?.price).toBe(p2?.offer24?.price);
    expect(p1?.offer24?.commissionPct).not.toBe(p2?.offer24?.commissionPct);
    expect(p2?.commissionBands?.[1]?.commissionPct).toBe('9.0000');

    // (a′) STRADDLE lock (TB300X450R 10 Temmuz): window STARTS in Period 1, ENDS in
    // Period 2 → anchored to the END → Period 2's band (9.0), NOT Period 1's (11.5).
    expect(straddle?.commissionSource).toBe('band');
    expect(straddle?.offer24?.commissionPct).toBe('9.0000');
    expect(straddle?.commissionBands?.[1]?.commissionPct).toBe('9.0000');

    // (d) barcode absent from the period → flat "Mevcut Komisyon" (19), no ladder.
    expect(noBand?.commissionSource).toBe('current');
    expect(noBand?.commissionBands).toBeNull();
    expect(noBand?.offer24?.commissionPct).toBe('19.0000');

    // (c) hasCommissionTariff = false → flat, no lookup.
    expect(flagFalse?.hasCommissionTariff).toBe(false);
    expect(flagFalse?.commissionSource).toBe('current');
    expect(flagFalse?.commissionBands).toBeNull();
    expect(flagFalse?.offer24?.commissionPct).toBe('19.0000');

    // (b) no covering week → flat.
    expect(noWeek?.commissionSource).toBe('current');
    expect(noWeek?.commissionBands).toBeNull();
    expect(noWeek?.offer24?.commissionPct).toBe('19.0000');
  });

  it('exposes the current baseline, offer window + validity on each item', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    const body = (await res.json()) as DetailWire;
    const p1 = body.items.find((i) => i.id === fx.itemPeriod1);

    // Current scenario = customerPrice @ currentCommissionPct (the flat I column).
    expect(p1?.currentCommissionPct).toBe('19.0000');
    expect(p1?.currentNetProfit).not.toBeNull();
    expect(p1?.currentMarginPct).not.toBeNull();
    // Offer surfaces its window + a validity badge; no 3h offer on this file.
    expect(p1?.offer24?.price).toBe(OFFER_PRICE);
    expect(typeof p1?.offer24?.startsAt).toBe('string');
    expect(['active', 'upcoming', 'past']).toContain(p1?.offer24?.validity);
    expect(p1?.offer3).toBeNull();
    // Nothing selected yet.
    expect(p1?.selectedOffer).toBeNull();
    expect(p1?.customPrice).toBeNull();
  });

  it('keeps the flat current rate when the flash tariff has no band', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    const noBand = body.items.find((i) => i.id === fx.itemNoBand);

    // hasCommissionTariff but its barcode is absent from the period -> no covering band,
    // so the offer keeps the flat "Mevcut Komisyon" (I) rate, source 'current'.
    expect(noBand?.hasCommissionTariff).toBe(true);
    expect(noBand?.commissionSource).toBe('current');
    // The offer commission equals the item's current (flat) rate, both in 4dp.
    expect(noBand?.offer24?.commissionPct).toBe(noBand?.currentCommissionPct);
    expect(noBand?.offer24?.commissionPct).toBe('19.0000');
    // The item is calculable (cost + shipping resolve) and the offer carries a concrete,
    // finite profit -- not null.
    expect(noBand?.calculable).toBe(true);
    expect(noBand?.offer24?.netProfit).not.toBeNull();
    expect(Number.isFinite(Number(noBand?.offer24?.netProfit))).toBe(true);
  });

  it('404s for a list id from another store, then deletes and lists empty', async () => {
    const foreign = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${crypto.randomUUID()}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(foreign.status).toBe(404);

    // The items go with the list: the database cascades the scoped delete.
    const itemCount = async (): Promise<number> =>
      prisma.flashProductItem.count({ where: { listId: fx.listId } });
    expect(await itemCount()).toBeGreaterThan(0);

    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);
    expect(await itemCount()).toBe(0);

    const detail = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(detail.status).toBe(404);

    const list = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(((await list.json()) as ListWire).data).toHaveLength(0);
  });
});

describe('Flash Products — per-item degrade (decision 9)', () => {
  // TWO items' scenarios are forced to throw (a negative customer price, which the
  // engine's unit-price validator rejects): the detail must still return 200 with those
  // items' profit empty (reason null) while a third item computes fine, and the failures
  // must collapse into exactly one [profit-read] line per request with failedCount 2.
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('keeps the flash detail up when items fail to compute and logs once', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Flash Degrade Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'flash-degrade-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 9301n,
        productMainId: 'pm-9301',
        title: 'Bozulma Flas Urunu',
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
        platformVariantId: 93010n,
        barcode: 'FLASH-DEG',
        stockCode: 'STK-FDEG',
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
        name: 'COGS Flash Degrade',
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
        name: 'COGS Flash Degrade',
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

    const list = await prisma.flashProductList.create({
      data: { organizationId: org.id, storeId: store.id, name: 'Bozulma Flas', createdBy: user.id },
    });
    const baseItem = {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: variant.id,
      barcode: 'FLASH-DEG',
      productTitle: 'Bozulma Flas Urunu',
      currentPrice: '500.00',
      currentCommissionPct: '19', // flat, no commission tariff -> the flat fallback
      hasCommissionTariff: false,
      offer24Price: '400.00',
    };
    // Healthy item: a positive customer price -> computes.
    const okItem = await prisma.flashProductItem.create({
      data: { ...baseItem, customerPrice: '500.00', sortOrder: 0 },
    });
    // Two failing items: a NEGATIVE customer price makes the engine reject the baseline
    // unit price -> each item's compute throws.
    const fail1 = await prisma.flashProductItem.create({
      data: { ...baseItem, customerPrice: '-5.00', sortOrder: 1 },
    });
    const fail2 = await prisma.flashProductItem.create({
      data: { ...baseItem, customerPrice: '-7.00', sortOrder: 2 },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/flash-products/${list.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const items = ((await res.json()) as DetailWire).items;

      const ok = items.find((i) => i.id === okItem.id);
      expect(ok?.calculable).toBe(true);
      expect(ok?.currentNetProfit).not.toBeNull();

      for (const failId of [fail1.id, fail2.id]) {
        const bad = items.find((i) => i.id === failId);
        expect(bad?.calculable).toBe(false);
        // A degraded compute carries no reason (not NO_PRODUCT -- the variant is matched).
        expect(bad?.reason).toBeNull();
        expect(bad?.currentNetProfit).toBeNull();
        expect(bad?.offer24?.netProfit).toBeNull();
      }

      // Two failing items collapse into exactly one [profit-read] line, failedCount 2.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({
          surface: 'flash-product',
          orderId: null,
          failedCount: 2,
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// The detail fields the unknown-flat-rate cases read, parsed rather than cast.
const UnknownFlatOfferSchema = z.object({
  price: z.string(),
  startsAt: z.string().nullable(),
  // Null when no tariff band covers the offer and the flat rate is unknown.
  commissionPct: z.string().nullable(),
  netProfit: z.string().nullable(),
  marginPct: z.string().nullable(),
});
const UnknownFlatItemSchema = z.object({
  id: z.string(),
  // Null when the file's "Mevcut Komisyon" cell was blank or unreadable.
  currentCommissionPct: z.string().nullable(),
  currentNetProfit: z.string().nullable(),
  currentMarginPct: z.string().nullable(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
  commissionSource: z.enum(['band', 'current']),
  commissionBands: z
    .array(
      z.object({
        lowerLimit: z.string().nullable(),
        upperLimit: z.string().nullable(),
        commissionPct: z.string(),
      }),
    )
    .nullable(),
  offer24: UnknownFlatOfferSchema.nullable(),
});
const UnknownFlatDetailSchema = z.object({ items: z.array(UnknownFlatItemSchema) });
type UnknownFlatItem = z.infer<typeof UnknownFlatItemSchema>;

describe('Flash Products - unknown flat commission', () => {
  // The same resolution matrix as the main fixture, but every row's "Mevcut Komisyon" (I)
  // cell was blank or unreadable, so the flat rate is stored as NULL. The commission tariff
  // still covers the band rows, so they are pinned against the known-rate fixture's
  // hand-derived numbers; the flat-fallback rows have no rate at all and must never be
  // priced at 0%.
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture(null);
  });

  async function fetchItems(): Promise<readonly UnknownFlatItem[]> {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    return UnknownFlatDetailSchema.parse(await res.json()).items;
  }

  function itemOf(items: readonly UnknownFlatItem[], id: string): UnknownFlatItem {
    const item = items.find((i) => i.id === id);
    if (item === undefined) throw new Error(`detail item ${id} missing`);
    return item;
  }

  it('returns a null currentCommissionPct and a null current profit when the flat rate is unknown', async () => {
    const items = await fetchItems();
    expect(items).toHaveLength(6);
    // No made-up 0 anywhere: the unknown rate stays null on the wire, and no row has a
    // current scenario (it would have to be priced at the unknown rate).
    for (const item of items) {
      expect(item.currentCommissionPct).toBeNull();
      expect(item.currentNetProfit).toBeNull();
      expect(item.currentMarginPct).toBeNull();
    }
  });

  it('returns a flat-fallback offer with commissionPct null and no profit', async () => {
    // A compute that threw is degraded to the same shape (not calculable, reason null, no
    // profit) and logged; nothing may be logged here, so the shape is the unknown rate.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let items: readonly UnknownFlatItem[];
    try {
      items = await fetchItems();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
    // (d) no band for the barcode, (c) no tariff flag, (b) no covering week: each falls
    // back to the flat rate, which is unknown.
    for (const id of [fx.itemNoBand, fx.itemFlagFalse, fx.itemNoWeek]) {
      const item = itemOf(items, id);
      expect(item.commissionSource).toBe('current');
      expect(item.commissionBands).toBeNull();
      // The offer keeps its price and window; it has no commission and no profit.
      expect(item.offer24?.price).toBe(OFFER_PRICE);
      expect(typeof item.offer24?.startsAt).toBe('string');
      expect(item.offer24?.commissionPct).toBeNull();
      expect(item.offer24?.netProfit).toBeNull();
      expect(item.offer24?.marginPct).toBeNull();
      // Its only offer was never evaluated, so nothing is calculable and there is no reason
      // (the variants are matched and costed, as in the main block where they compute).
      expect(item.calculable).toBe(false);
      expect(item.reason).toBeNull();
    }
  });

  it('still computes an offer covered by a commission tariff band', async () => {
    const items = await fetchItems();
    const p1 = itemOf(items, fx.itemPeriod1);
    const p2 = itemOf(items, fx.itemPeriod2);
    const straddle = itemOf(items, fx.itemStraddle);

    // A band offer never reads the flat rate: the Period 1 band (11.5) prices it to the
    // same hand-derived profit as with a known flat rate (see the main block, -107.65).
    expect(p1.commissionSource).toBe('band');
    expect(p1.offer24?.commissionPct).toBe('11.5000');
    expect(p1.offer24?.netProfit).toBe('-107.65');
    expect(p1.offer24?.marginPct).not.toBeNull();
    expect(p1.commissionBands).toEqual([
      { lowerLimit: '300.00', upperLimit: null, commissionPct: '19.0000' },
      { lowerLimit: '250.00', upperLimit: '299.99', commissionPct: '11.5000' },
      { lowerLimit: null, upperLimit: '249.99', commissionPct: '8.0000' },
    ]);
    // The calculable band offer makes the item calculable, with no current profit.
    expect(p1.calculable).toBe(true);
    expect(p1.reason).toBeNull();
    expect(p1.currentNetProfit).toBeNull();

    // The other sub-period and the straddling window resolve the Period 2 band (9).
    for (const item of [p2, straddle]) {
      expect(item.commissionSource).toBe('band');
      expect(item.offer24?.commissionPct).toBe('9.0000');
      expect(item.offer24?.netProfit).not.toBeNull();
      expect(item.calculable).toBe(true);
      expect(item.reason).toBeNull();
    }
  });
});

describe('Flash Products - the item variant is resolved from the barcode at read time', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('an item imported before its variant existed is priced once the variant exists', async () => {
    const LATE_BARCODE = 'FLASH-LATE';
    // Uploaded before the product sync: no catalog variant carried the barcode, so the
    // import stored no variant link. Same prices, window and flat rate as the fixture's
    // flag-false row, so once matched it prices exactly like that row.
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
        currentCommissionPct: FLAT_COMMISSION,
        hasCommissionTariff: false,
        offer24Price: OFFER_PRICE,
        offer24StartsAt: flashInstant(2026, 7, 9, 0),
        offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
        sortOrder: 6,
      },
    });

    const fetchItems = async (): Promise<ItemWire[]> => {
      const res = await app.request(
        `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/flash-products/${fx.listId}`,
        { headers: { Authorization: bearer(fx.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body: DetailWire = await res.json();
      return body.items;
    };
    const itemOf = (items: ItemWire[], id: string): ItemWire => {
      const row = items.find((i) => i.id === id);
      if (row === undefined) throw new Error(`detail item ${id} missing`);
      return row;
    };

    // No catalog variant carries the barcode yet.
    const before = itemOf(await fetchItems(), late.id);
    expect(before.calculable).toBe(false);
    expect(before.reason).toBe('NO_PRODUCT');
    expect(before.imageUrl).toBeNull();
    expect(before.currentNetProfit).toBeNull();
    expect(before.offer24?.price).toBe(OFFER_PRICE);
    expect(before.offer24?.netProfit).toBeNull();

    // The product sync lands a variant with that barcode after the upload: the same
    // product (with its image) and cost as the fixture's FLASH-1 variant.
    const matchedVariant = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: fx.orgId, storeId: fx.storeId, barcode: MATCHED_BARCODE },
    });
    await cloneVariantWithBarcode(matchedVariant.id, LATE_BARCODE);

    // The same GET, with no re-upload, now prices the item and shows the image.
    const items = await fetchItems();
    const after = itemOf(items, late.id);
    expect(after.calculable).toBe(true);
    expect(after.reason).toBeNull();
    expect(after.imageUrl).toBe('https://cdn.example/flash-1.jpg');
    expect(after.currentNetProfit).not.toBeNull();
    expect(after.commissionSource).toBe('current');
    expect(after.offer24?.commissionPct).toBe('19.0000');
    expect(after.offer24?.netProfit).not.toBeNull();
    // Same economics as the flag-false row of the same response.
    const flagFalse = itemOf(items, fx.itemFlagFalse);
    expect(after.currentNetProfit).toBe(flagFalse.currentNetProfit);
    expect(after.offer24?.netProfit).toBe(flagFalse.offer24?.netProfit);

    // The reads resolved the variant without writing the stored link back.
    const stored = await prisma.flashProductItem.findUniqueOrThrow({
      where: { id: late.id },
      select: { productVariantId: true },
    });
    expect(stored.productVariantId).toBeNull();
  });
});
