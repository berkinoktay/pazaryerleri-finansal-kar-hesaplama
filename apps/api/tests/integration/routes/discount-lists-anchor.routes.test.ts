// Integration tests for the FUTURE-start commission anchor + tariff-period transparency
// on the İndirimler (discount list) detail + item estimate endpoints.
//
// Domain: Trendyol's product-API commission is tariff-agnostic, so the tariff band tier is
// the only true rate for a tariff product. COVERING-ONLY rule (Berkin 2026-07-16): the band
// tier is authoritative ONLY when a tariff WEEK covers the anchor instant — an expired week's
// tariff no longer exists for the seller on Trendyol's side. A list whose `startsAt` is in the
// future resolves its bands from the tariff week that covers that start (across ALL the store's
// tariffs). When NO week covers the anchor — the anlık `now` path with an un-uploaded current
// week, OR a future start whose week is not uploaded — there are NO bands at all: the per-item
// chain falls to the product's synced rate, then the category rate, then NO_COMMISSION.
//
// Fixture: one store with TWO commission tariffs for the SAME band barcode but different band
// percents —
//   • "Güncel Tarife"  (LATEST-created) — week covers NOW, band pct 25.
//   • "Kapsayan Tarife" (created EARLIER) — week covers a FUTURE instant (~30d out), band pct 10.
// Three lists on that barcode: one starting inside the covering week, one starting far in the
// future (no covering week), one with no start. Commission tariff week/period bounds are
// persisted as İstanbul WALL-CLOCK-as-UTC, so the seeded windows are made wide (±10 days) to
// stay robust under the resolver's `businessZoneEpochToInstant` normalization — the ±3h skew
// cannot flip a 20-day-wide window's coverage of the anchor.

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const BAND_BARCODE = 'DISC-ANCHOR-BAND';
const BAND_CATEGORY_ID = 701n;
const CURRENT_PRICE = '300.00';

const LATEST_PCT = 25; // "Güncel Tarife" band — resolved at `now` (existing path).
const COVERING_PCT = 10; // "Kapsayan Tarife" band — resolved for a future anchor.

const LATEST_TARIFF_NAME = 'Güncel Tarife';
const LATEST_PERIOD_LABEL = 'Güncel Hafta';
const COVERING_TARIFF_NAME = 'Kapsayan Tarife';
const COVERING_PERIOD_LABEL = 'Kapsayan Hafta';

const DAY_MS = 86_400_000;

interface EstimateWire {
  itemId: string;
  scenario: 'current' | 'discounted';
  price: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'product' | 'category' | null;
  calculable: boolean;
  reason: string | null;
  commissionTariffName: string | null;
  commissionPeriodLabel: string | null;
}

interface DetailItemWire {
  id: string;
  barcode: string;
  calculable: boolean;
  reason: string | null;
  discounted: { commissionPct: string | null; commissionSource: string | null };
  commissionBands: Array<{
    lowerLimit: string | null;
    upperLimit: string | null;
    commissionPct: string;
  }> | null;
}
interface DetailWire {
  commissionTariffName: string | null;
  commissionPeriodLabel: string | null;
  commissionTariffOutdated: boolean;
  items: DetailItemWire[];
}

interface Fixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  coveringListId: string; // startsAt inside the covering week
  noCoverListId: string; // startsAt far future, no covering week
  nullStartListId: string; // startsAt null
  coveringItemId: string;
  noCoverItemId: string;
  nullStartItemId: string;
}

async function setupFixture(): Promise<Fixture> {
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
      name: 'Discount Anchor Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'discount-anchor-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
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
  await ensureFeeDefinitions();

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 95_001n,
      productMainId: 'pm-anchor',
      title: `İndirim Ürünü ${BAND_BARCODE}`,
      categoryId: BAND_CATEGORY_ID,
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
      platformVariantId: 950_010n,
      barcode: BAND_BARCODE,
      stockCode: `STK-${BAND_BARCODE}`,
      salePrice: new Decimal(CURRENT_PRICE),
      listPrice: new Decimal(CURRENT_PRICE),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
      syncedCommissionRate: null,
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });

  const now = Date.now();

  // Seeds one tariff whose bands (a single catch-all band → `pct`) match every price. Week +
  // period bounds are wall-clock-as-UTC; kept ±10 days wide so the resolver's ~3h
  // normalization cannot flip coverage of the anchor. `createdAt` is set explicitly so the
  // "latest-created" tie is deterministic.
  async function seedTariff(opts: {
    name: string;
    periodLabel: string;
    weekCenterMs: number;
    pct: number;
    createdAt: Date;
  }): Promise<void> {
    const tariff = await prisma.commissionTariff.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: opts.name,
        weekStartsAt: new Date(opts.weekCenterMs - 10 * DAY_MS),
        weekEndsAt: new Date(opts.weekCenterMs + 10 * DAY_MS),
        createdAt: opts.createdAt,
      },
    });
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        tariffId: tariff.id,
        dateRangeLabel: opts.periodLabel,
        startsAt: new Date(opts.weekCenterMs - 10 * DAY_MS),
        endsAt: new Date(opts.weekCenterMs + 10 * DAY_MS),
        sortOrder: 0,
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: BAND_BARCODE,
        stockCode: `STK-${BAND_BARCODE}`,
        productTitle: `İndirim Ürünü ${BAND_BARCODE}`,
        currentPrice: CURRENT_PRICE,
        currentCommissionPct: new Decimal(opts.pct).toFixed(4),
        bands: [{ key: 'band1', commissionPct: String(opts.pct) }],
        sortOrder: 0,
      },
    });
  }

  const anchorFutureMs = now + 30 * DAY_MS; // inside the covering week
  // Covering tariff — created EARLIER so it is NOT the latest.
  await seedTariff({
    name: COVERING_TARIFF_NAME,
    periodLabel: COVERING_PERIOD_LABEL,
    weekCenterMs: anchorFutureMs,
    pct: COVERING_PCT,
    createdAt: new Date(now - 2 * DAY_MS),
  });
  // Latest-created tariff — its week covers NOW.
  await seedTariff({
    name: LATEST_TARIFF_NAME,
    periodLabel: LATEST_PERIOD_LABEL,
    weekCenterMs: now,
    pct: LATEST_PCT,
    createdAt: new Date(now - DAY_MS),
  });

  async function seedList(opts: { name: string; startsAt: Date | null }): Promise<{
    listId: string;
    itemId: string;
  }> {
    const list = await prisma.discountList.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: opts.name,
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('20.00'),
        startsAt: opts.startsAt,
        createdBy: user.id,
      },
    });
    const item = await prisma.discountListItem.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        listId: list.id,
        productVariantId: variant.id,
        barcode: BAND_BARCODE,
        productTitle: `İndirim Ürünü ${BAND_BARCODE}`,
        currentPrice: new Decimal(CURRENT_PRICE),
        included: true,
        sortOrder: 0,
      },
    });
    return { listId: list.id, itemId: item.id };
  }

  const covering = await seedList({
    name: 'Gelecek Kampanya',
    startsAt: new Date(anchorFutureMs),
  });
  const noCover = await seedList({
    name: 'Çok İleri Kampanya',
    startsAt: new Date(now + 100 * DAY_MS),
  });
  const nullStart = await seedList({ name: 'Başlangıçsız Liste', startsAt: null });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    coveringListId: covering.listId,
    noCoverListId: noCover.listId,
    nullStartListId: nullStart.listId,
    coveringItemId: covering.itemId,
    noCoverItemId: noCover.itemId,
    nullStartItemId: nullStart.itemId,
  };
}

async function estimate(
  fx: Fixture,
  listId: string,
  itemId: string,
): Promise<{ status: number; body: EstimateWire }> {
  const res = await app.request(
    `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${listId}/items/${itemId}/estimate`,
    {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'discounted' }),
    },
  );
  return { status: res.status, body: (await res.json()) as EstimateWire };
}

async function detail(fx: Fixture, listId: string): Promise<{ status: number; body: DetailWire }> {
  const res = await app.request(
    `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${listId}`,
    { headers: { Authorization: bearer(fx.accessToken) } },
  );
  return { status: res.status, body: (await res.json()) as DetailWire };
}

describe('Discount Lists - future-start commission anchor + tariff transparency', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('a future startsAt inside a covering week resolves the COVERING band, not the latest tariff', async () => {
    const { status, body } = await estimate(fx, fx.coveringListId, fx.coveringItemId);
    expect(status).toBe(200);
    expect(body.calculable).toBe(true);
    expect(body.commissionSource).toBe('band');
    // The covering tariff's band (10%), NOT the latest-created tariff's band (25%).
    expect(Number(body.commissionPct)).toBe(COVERING_PCT);
    expect(body.commissionTariffName).toBe(COVERING_TARIFF_NAME);
    expect(body.commissionPeriodLabel).toBe(COVERING_PERIOD_LABEL);
  });

  it('the detail row agrees with the estimate for the anchored (covering) list', async () => {
    const { status, body } = await detail(fx, fx.coveringListId);
    expect(status).toBe(200);
    expect(body.commissionTariffName).toBe(COVERING_TARIFF_NAME);
    expect(body.commissionPeriodLabel).toBe(COVERING_PERIOD_LABEL);
    const item = body.items.find((i) => i.barcode === BAND_BARCODE);
    expect(item?.discounted.commissionSource).toBe('band');
    expect(Number(item?.discounted.commissionPct)).toBe(COVERING_PCT);
    // The band source exposes its ladder so the UI popover can mark both prices.
    expect(item?.commissionBands).not.toBeNull();
    expect(item?.commissionBands?.length).toBeGreaterThan(0);
    expect(Number(item?.commissionBands?.[0]?.commissionPct)).toBe(COVERING_PCT);
  });

  it('a future startsAt with NO covering week now resolves NO band (was: fell back to the latest tariff)', async () => {
    // CHANGE (covering-only rule): the current week's rates are NOT authoritative for a future
    // date whose week is not uploaded. No covering week → no bands at all. The band barcode's
    // variant has no synced rate and no seeded category rate, so the chain lands on NO_COMMISSION.
    const { body: estBody } = await estimate(fx, fx.noCoverListId, fx.noCoverItemId);
    expect(estBody.commissionSource).toBeNull();
    expect(estBody.commissionPct).toBeNull();
    expect(estBody.reason).toBe('NO_COMMISSION');
    expect(estBody.commissionTariffName).toBeNull();
    expect(estBody.commissionPeriodLabel).toBeNull();

    const { body: detBody } = await detail(fx, fx.noCoverListId);
    // The store HAS tariffs (latest + covering) but none covers a +100d anchor → outdated.
    expect(detBody.commissionTariffName).toBeNull();
    expect(detBody.commissionPeriodLabel).toBeNull();
    expect(detBody.commissionTariffOutdated).toBe(true);
    const item = detBody.items.find((i) => i.barcode === BAND_BARCODE);
    expect(item?.discounted.commissionSource).toBeNull();
    expect(item?.reason).toBe('NO_COMMISSION');
    // No covering week → no ladder to show either.
    expect(item?.commissionBands).toBeNull();
  });

  it('a null startsAt anchors to now and resolves the week that COVERS now (the current tariff)', async () => {
    // anchor = now → the "Güncel Tarife" week covers now, so its band (25%) resolves. Same
    // result as before the covering-only change, but now via a genuine covering hit, not a
    // best-available fallback.
    const { body: estBody } = await estimate(fx, fx.nullStartListId, fx.nullStartItemId);
    expect(estBody.commissionSource).toBe('band');
    expect(Number(estBody.commissionPct)).toBe(LATEST_PCT);
    expect(estBody.commissionTariffName).toBe(LATEST_TARIFF_NAME);
    expect(estBody.commissionPeriodLabel).toBe(LATEST_PERIOD_LABEL);
  });

  it('the transparency fields are present on both the detail and the estimate responses', async () => {
    const { body: detBody } = await detail(fx, fx.coveringListId);
    expect(detBody).toHaveProperty('commissionTariffName');
    expect(detBody).toHaveProperty('commissionPeriodLabel');

    const { body: estBody } = await estimate(fx, fx.coveringListId, fx.coveringItemId);
    expect(estBody).toHaveProperty('commissionTariffName');
    expect(estBody).toHaveProperty('commissionPeriodLabel');
  });
});

// ─── Covering-only resolution on the anlık (`now`) path + outdated-tariff flag ──────────────
//
// COVERING-ONLY rule: the covering-week lookup runs for EVERY anchor, `now` included. It kills
// the upload-order trap (with two adjacent weeks uploaded OUT of order, the tariff whose week
// COVERS today wins over whichever carries the newest createdAt) AND enforces that bands are
// authoritative ONLY from a covering week. When NO week covers the anchor there are NO bands at
// all — the per-item chain falls to the product's synced rate, then the category rate, then
// NO_COMMISSION — and the detail flags `commissionTariffOutdated: true` when the store still has
// ≥1 (stale) tariff, so the seller knows their uploads don't reach this campaign's week. Windows
// are kept ±10 days wide so the resolver's İstanbul wall-clock-as-UTC (~3h) normalization cannot
// flip coverage.

const COVER_BARCODE = 'DISC-COVER-BAND'; // cover store's band item; expired store's product item
const COVER_CAT_BARCODE = 'DISC-COVER-CAT'; // expired store's category-rate item
const ZERO_BARCODE = 'DISC-ZERO-BAND'; // zero-tariff store's item
const COVER_CATEGORY_ID = 702n; // no seeded category rate (band/product/zero items live here)
const COVER_CAT_CATEGORY_ID = 703n; // HAS a seeded CATEGORY commission rate

const COVERING_NOW_PCT = 12; // week covers NOW, uploaded FIRST (older createdAt)
const EXPIRED_PCT = 40; // week entirely past, uploaded LAST (newer createdAt) — never surfaces now
const PRODUCT_RATE_PCT = 18; // syncedCommissionRate on the expired store's product-source variant
const CATEGORY_RATE_PCT = 15; // seeded MarketplaceCommissionRate base rate for COVER_CAT_CATEGORY_ID

const COVERING_NOW_TARIFF_NAME = 'Kapsayan Cari Tarife';
const COVERING_NOW_PERIOD_LABEL = 'Kapsayan Cari Hafta';
const EXPIRED_TARIFF_NAME = 'Suresi Dolmus Tarife';

interface CoveringFixture {
  accessToken: string;
  orgId: string;
  coverStoreId: string; // covering week + an expired week both present
  coverListId: string; // null-start list in the cover store
  expiredStoreId: string; // ONLY an expired week; product + category items
  expiredListId: string; // null-start list in the expired store
  expiredProductItemId: string; // the item whose variant carries a synced rate → 'product'
  expiredCategoryItemId: string; // the item resolving via the seeded category rate → 'category'
  zeroStoreId: string; // NO tariffs at all
  zeroListId: string; // null-start list in the zero-tariff store
}

async function setupCoveringFixture(): Promise<CoveringFixture> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing - globalSetup ensureShippingReferenceData must run');
  }
  const carrierId = carrier.id;
  await ensureFeeDefinitions();

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  // A CATEGORY commission rate for COVER_CAT_CATEGORY_ID so a variant with no band and no synced
  // rate resolves via the category tier. Global reference row (not tenant-scoped) — truncated
  // per test by truncateAll, so a distinct test-only category id can never collide with the seed.
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId: COVER_CAT_CATEGORY_ID,
      brandId: null,
      categoryName: 'Kategori Orani',
      baseRate: new Decimal(CATEGORY_RATE_PCT),
      paymentTermDays: 14,
      fetchedAt: new Date(),
      sourceScreen: 'test',
    },
  });

  // A store with no products yet — variants are seeded separately so a store can hold several.
  async function seedStore(name: string, externalAccountId: string): Promise<string> {
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name,
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId,
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrierId,
      },
    });
    return store.id;
  }

  // One matched variant, priced + COGS'd + shippable so the item is calculable. `seq` offsets the
  // platform ids so several variants can coexist in one store. `syncedCommissionRate` non-null
  // makes the item resolve via the product tier when no band covers the anchor.
  async function seedVariant(opts: {
    storeId: string;
    barcode: string;
    categoryId: bigint;
    syncedCommissionRate: string | null;
    seq: number;
  }): Promise<string> {
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: opts.storeId,
        name: `COGS Test ${opts.seq}`,
        type: 'COGS',
        amountGross: new Decimal('200.00'),
        currency: 'TRY',
        vatRate: 20,
        fxRateMode: 'MANUAL',
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: opts.storeId,
        platformContentId: BigInt(96_000 + opts.seq),
        productMainId: `pm-cover-${opts.seq}`,
        title: `Kapsama Ürünü ${opts.barcode}`,
        categoryId: opts.categoryId,
        categoryName: 'Kategori',
        brandId: null,
        brandName: null,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: opts.storeId,
        productId: product.id,
        platformVariantId: BigInt(960_000 + opts.seq),
        barcode: opts.barcode,
        stockCode: `STK-${opts.barcode}`,
        salePrice: new Decimal(CURRENT_PRICE),
        listPrice: new Decimal(CURRENT_PRICE),
        vatRate: 20,
        dimensionalWeight: new Decimal('3.0'),
        syncedCommissionRate:
          opts.syncedCommissionRate !== null ? new Decimal(opts.syncedCommissionRate) : null,
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
    });
    return variant.id;
  }

  // Seeds a tariff whose catch-all band maps every COVER_BARCODE price to `pct`. Week + period
  // bounds are wall-clock-as-UTC and kept ±10 days wide. `createdAt` is set explicitly so the
  // "latest-uploaded" tie is deterministic.
  async function seedTariffIn(opts: {
    storeId: string;
    name: string;
    periodLabel: string;
    weekCenterMs: number;
    pct: number;
    createdAt: Date;
  }): Promise<void> {
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: org.id, storeId: opts.storeId, barcode: COVER_BARCODE },
      select: { id: true },
    });
    const tariff = await prisma.commissionTariff.create({
      data: {
        organizationId: org.id,
        storeId: opts.storeId,
        name: opts.name,
        weekStartsAt: new Date(opts.weekCenterMs - 10 * DAY_MS),
        weekEndsAt: new Date(opts.weekCenterMs + 10 * DAY_MS),
        createdAt: opts.createdAt,
      },
    });
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: org.id,
        storeId: opts.storeId,
        tariffId: tariff.id,
        dateRangeLabel: opts.periodLabel,
        startsAt: new Date(opts.weekCenterMs - 10 * DAY_MS),
        endsAt: new Date(opts.weekCenterMs + 10 * DAY_MS),
        sortOrder: 0,
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: org.id,
        storeId: opts.storeId,
        periodId: period.id,
        productVariantId: variant.id,
        barcode: COVER_BARCODE,
        stockCode: `STK-${COVER_BARCODE}`,
        productTitle: `Kapsama Ürünü ${COVER_BARCODE}`,
        currentPrice: CURRENT_PRICE,
        currentCommissionPct: new Decimal(opts.pct).toFixed(4),
        bands: [{ key: 'band1', commissionPct: String(opts.pct) }],
        sortOrder: 0,
      },
    });
  }

  // A discount list with a NULL startsAt (the anlık `now` anchor path), one item per barcode.
  async function seedList(opts: {
    storeId: string;
    name: string;
    barcodes: readonly string[];
  }): Promise<{ listId: string; itemIds: Map<string, string> }> {
    const list = await prisma.discountList.create({
      data: {
        organizationId: org.id,
        storeId: opts.storeId,
        name: opts.name,
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('20.00'),
        startsAt: null,
        createdBy: user.id,
      },
    });
    const itemIds = new Map<string, string>();
    let sortOrder = 0;
    for (const barcode of opts.barcodes) {
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { organizationId: org.id, storeId: opts.storeId, barcode },
        select: { id: true },
      });
      const item = await prisma.discountListItem.create({
        data: {
          organizationId: org.id,
          storeId: opts.storeId,
          listId: list.id,
          productVariantId: variant.id,
          barcode,
          productTitle: `Kapsama Ürünü ${barcode}`,
          currentPrice: new Decimal(CURRENT_PRICE),
          included: true,
          sortOrder: sortOrder++,
        },
      });
      itemIds.set(barcode, item.id);
    }
    return { listId: list.id, itemIds };
  }

  const now = Date.now();

  // Store A: a covering-now week (uploaded FIRST) + an expired week (uploaded LAST).
  const coverStoreId = await seedStore('Cover Store', 'disc-cover-test');
  await seedVariant({
    storeId: coverStoreId,
    barcode: COVER_BARCODE,
    categoryId: COVER_CATEGORY_ID,
    syncedCommissionRate: null,
    seq: 1,
  });
  await seedTariffIn({
    storeId: coverStoreId,
    name: COVERING_NOW_TARIFF_NAME,
    periodLabel: COVERING_NOW_PERIOD_LABEL,
    weekCenterMs: now,
    pct: COVERING_NOW_PCT,
    createdAt: new Date(now - 20 * DAY_MS), // FIRST / older
  });
  await seedTariffIn({
    storeId: coverStoreId,
    name: EXPIRED_TARIFF_NAME,
    periodLabel: 'Gecmis Hafta',
    weekCenterMs: now - 40 * DAY_MS, // entirely past
    pct: EXPIRED_PCT,
    createdAt: new Date(now - DAY_MS), // LAST / newer
  });
  const coverList = await seedList({
    storeId: coverStoreId,
    name: 'Anlık Kapsayan Liste',
    barcodes: [COVER_BARCODE],
  });

  // Store B: ONLY an expired week. No band covers now → the two items fall to product / category.
  const expiredStoreId = await seedStore('Expired Store', 'disc-expired-test');
  await seedVariant({
    storeId: expiredStoreId,
    barcode: COVER_BARCODE, // product-source: carries a synced rate
    categoryId: COVER_CATEGORY_ID,
    syncedCommissionRate: String(PRODUCT_RATE_PCT),
    seq: 2,
  });
  await seedVariant({
    storeId: expiredStoreId,
    barcode: COVER_CAT_BARCODE, // category-source: no synced rate, its category has a rate
    categoryId: COVER_CAT_CATEGORY_ID,
    syncedCommissionRate: null,
    seq: 3,
  });
  await seedTariffIn({
    storeId: expiredStoreId,
    name: EXPIRED_TARIFF_NAME,
    periodLabel: 'Gecmis Hafta',
    weekCenterMs: now - 40 * DAY_MS,
    pct: EXPIRED_PCT,
    createdAt: new Date(now - DAY_MS),
  });
  const expiredList = await seedList({
    storeId: expiredStoreId,
    name: 'Anlık Süresi Dolmuş Liste',
    barcodes: [COVER_BARCODE, COVER_CAT_BARCODE],
  });
  const expiredProductItemId = expiredList.itemIds.get(COVER_BARCODE);
  const expiredCategoryItemId = expiredList.itemIds.get(COVER_CAT_BARCODE);
  if (expiredProductItemId === undefined || expiredCategoryItemId === undefined) {
    throw new Error('expired list items missing');
  }

  // Store C: NO commission tariffs at all — nothing to be outdated.
  const zeroStoreId = await seedStore('Zero Tariff Store', 'disc-zero-test');
  await seedVariant({
    storeId: zeroStoreId,
    barcode: ZERO_BARCODE,
    categoryId: COVER_CATEGORY_ID,
    syncedCommissionRate: null,
    seq: 4,
  });
  const zeroList = await seedList({
    storeId: zeroStoreId,
    name: 'Anlık Tarifesiz Liste',
    barcodes: [ZERO_BARCODE],
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    coverStoreId,
    coverListId: coverList.listId,
    expiredStoreId,
    expiredListId: expiredList.listId,
    expiredProductItemId,
    expiredCategoryItemId,
    zeroStoreId,
    zeroListId: zeroList.listId,
  };
}

async function detailFor(
  token: string,
  orgId: string,
  storeId: string,
  listId: string,
): Promise<{ status: number; body: DetailWire }> {
  const res = await app.request(
    `/v1/organizations/${orgId}/stores/${storeId}/discount-lists/${listId}`,
    { headers: { Authorization: bearer(token) } },
  );
  return { status: res.status, body: (await res.json()) as DetailWire };
}

async function estimateFor(
  token: string,
  orgId: string,
  storeId: string,
  listId: string,
  itemId: string,
): Promise<{ status: number; body: EstimateWire }> {
  const res = await app.request(
    `/v1/organizations/${orgId}/stores/${storeId}/discount-lists/${listId}/items/${itemId}/estimate`,
    {
      method: 'POST',
      headers: { Authorization: bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'discounted' }),
    },
  );
  return { status: res.status, body: (await res.json()) as EstimateWire };
}

describe('Discount Lists - covering-only resolution on the current path + outdated flag', () => {
  let cfx: CoveringFixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    cfx = await setupCoveringFixture();
  });

  it('covering week beats a newer-created expired week on the anlık path', async () => {
    const { status, body } = await detailFor(
      cfx.accessToken,
      cfx.orgId,
      cfx.coverStoreId,
      cfx.coverListId,
    );
    expect(status).toBe(200);
    // The covering-now tariff (12%) was uploaded FIRST; the expired week (40%) was uploaded
    // LAST. Coverage wins over createdAt — the band resolves to the covering week, not 40%.
    expect(body.commissionTariffName).toBe(COVERING_NOW_TARIFF_NAME);
    expect(body.commissionPeriodLabel).toBe(COVERING_NOW_PERIOD_LABEL);
    const item = body.items.find((i) => i.barcode === COVER_BARCODE);
    expect(item?.discounted.commissionSource).toBe('band');
    expect(Number(item?.discounted.commissionPct)).toBe(COVERING_NOW_PCT);
  });

  it('a covering week for now is NOT flagged as outdated', async () => {
    const { body } = await detailFor(cfx.accessToken, cfx.orgId, cfx.coverStoreId, cfx.coverListId);
    expect(body.commissionTariffOutdated).toBe(false);
  });

  it('when only an expired week exists there are NO bands; items fall to product / category rate', async () => {
    const { status, body } = await detailFor(
      cfx.accessToken,
      cfx.orgId,
      cfx.expiredStoreId,
      cfx.expiredListId,
    );
    expect(status).toBe(200);
    // No week covers now → no authoritative bands, so no tariff/period is surfaced. The store
    // still HAS a tariff (an expired week), so the seller is told their uploads are outdated.
    expect(body.commissionTariffName).toBeNull();
    expect(body.commissionPeriodLabel).toBeNull();
    expect(body.commissionTariffOutdated).toBe(true);

    // The variant with a synced rate resolves via the product tier...
    const productItem = body.items.find((i) => i.barcode === COVER_BARCODE);
    expect(productItem?.discounted.commissionSource).toBe('product');
    expect(Number(productItem?.discounted.commissionPct)).toBe(PRODUCT_RATE_PCT);

    // ...and the one with no synced rate falls through to the category rate.
    const categoryItem = body.items.find((i) => i.barcode === COVER_CAT_BARCODE);
    expect(categoryItem?.discounted.commissionSource).toBe('category');
    expect(Number(categoryItem?.discounted.commissionPct)).toBe(CATEGORY_RATE_PCT);
  });

  it('the estimate for an expired-only store resolves no band (product source) with null tariff fields', async () => {
    const { status, body } = await estimateFor(
      cfx.accessToken,
      cfx.orgId,
      cfx.expiredStoreId,
      cfx.expiredListId,
      cfx.expiredProductItemId,
    );
    expect(status).toBe(200);
    expect(body.commissionSource).toBe('product');
    expect(Number(body.commissionPct)).toBe(PRODUCT_RATE_PCT);
    expect(body.commissionTariffName).toBeNull();
    expect(body.commissionPeriodLabel).toBeNull();
  });

  it('a store with ZERO tariffs is NOT flagged as outdated (nothing to be outdated)', async () => {
    const { status, body } = await detailFor(
      cfx.accessToken,
      cfx.orgId,
      cfx.zeroStoreId,
      cfx.zeroListId,
    );
    expect(status).toBe(200);
    expect(body.commissionTariffOutdated).toBe(false);
    expect(body.commissionTariffName).toBeNull();
    expect(body.commissionPeriodLabel).toBeNull();
    const item = body.items.find((i) => i.barcode === ZERO_BARCODE);
    expect(item?.discounted.commissionSource).toBeNull();
  });
});
