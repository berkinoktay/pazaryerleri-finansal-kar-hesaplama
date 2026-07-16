// Integration tests for the FUTURE-start commission anchor + tariff-period transparency
// on the İndirimler (discount list) detail + item estimate endpoints.
//
// Domain: Trendyol's product-API commission is tariff-agnostic, so the tariff band tier is
// the only true rate for a tariff product. This feature anchors that band tier to WHEN the
// campaign actually starts: a list whose `startsAt` is in the future resolves its bands from
// the tariff WEEK that covers that start instant (across ALL the store's tariffs), not just
// the latest-created one. Anything else (past/absent `startsAt`, or a future start with no
// covering week) keeps the pre-anchor behavior: the latest-created tariff resolved at `now`.
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
  discounted: { commissionPct: string | null; commissionSource: string | null };
}
interface DetailWire {
  commissionTariffName: string | null;
  commissionPeriodLabel: string | null;
  commissionPeriodExpired: boolean;
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
  });

  it('a future startsAt with NO covering week falls back to the latest tariff resolved now', async () => {
    const { body: estBody } = await estimate(fx, fx.noCoverListId, fx.noCoverItemId);
    expect(estBody.commissionSource).toBe('band');
    expect(Number(estBody.commissionPct)).toBe(LATEST_PCT);
    expect(estBody.commissionTariffName).toBe(LATEST_TARIFF_NAME);
    expect(estBody.commissionPeriodLabel).toBe(LATEST_PERIOD_LABEL);

    const { body: detBody } = await detail(fx, fx.noCoverListId);
    expect(detBody.commissionTariffName).toBe(LATEST_TARIFF_NAME);
    expect(detBody.commissionPeriodLabel).toBe(LATEST_PERIOD_LABEL);
    const item = detBody.items.find((i) => i.barcode === BAND_BARCODE);
    expect(Number(item?.discounted.commissionPct)).toBe(LATEST_PCT);
  });

  it('a null startsAt keeps the existing behavior (latest tariff resolved now)', async () => {
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

// ─── Covering-week resolution on the anlık (`now`) path + expired-period flag ──────────────
//
// The covering-week lookup now runs for EVERY anchor, `now` included — not just future starts.
// This kills the upload-order trap: with two adjacent weeks uploaded OUT of order, the tariff
// whose week COVERS today must win over whichever tariff carries the newest createdAt. When no
// week covers the anchor, the resolution falls back to the latest-uploaded tariff's last-past
// period and the detail flags `commissionPeriodExpired: true` so the seller knows the current
// week's tariff is not uploaded yet. Windows are kept ±10 days wide so the resolver's İstanbul
// wall-clock-as-UTC (~3h) normalization cannot flip coverage or expiry.

const COVER_BARCODE = 'DISC-COVER-BAND';
const COVER_CATEGORY_ID = 702n;

const COVERING_NOW_PCT = 12; // week covers NOW, uploaded FIRST (older createdAt)
const EXPIRED_PCT = 40; // week entirely past, uploaded LAST (newer createdAt)
const EXPIRED_ONLY_PCT = 33; // the only tariff — a past week

const COVERING_NOW_TARIFF_NAME = 'Kapsayan Cari Tarife';
const COVERING_NOW_PERIOD_LABEL = 'Kapsayan Cari Hafta';
const EXPIRED_TARIFF_NAME = 'Suresi Dolmus Tarife';

interface CoveringFixture {
  accessToken: string;
  orgId: string;
  coverStoreId: string; // covering week + an expired week both present
  coverListId: string; // null-start list in the cover store
  expiredStoreId: string; // ONLY an expired week
  expiredListId: string; // null-start list in the expired store
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

  // Builds a store with one matched variant on COVER_BARCODE, priced + COGS'd + shippable so
  // the item is calculable (the band tier is the resolved commission source).
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
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 96_001n,
        productMainId: `pm-cover-${externalAccountId}`,
        title: `Kapsama Ürünü ${COVER_BARCODE}`,
        categoryId: COVER_CATEGORY_ID,
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
        platformVariantId: 960_010n,
        barcode: COVER_BARCODE,
        stockCode: `STK-${COVER_BARCODE}`,
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
    return store.id;
  }

  // Seeds a tariff whose catch-all band maps every price to `pct`. Week + period bounds are
  // wall-clock-as-UTC and kept ±10 days wide. `createdAt` is set explicitly so the
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

  // A discount list with a NULL startsAt → the anlık (`now`) anchor path.
  async function seedNullStartList(storeId: string, name: string): Promise<string> {
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: org.id, storeId, barcode: COVER_BARCODE },
      select: { id: true },
    });
    const list = await prisma.discountList.create({
      data: {
        organizationId: org.id,
        storeId,
        name,
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('20.00'),
        startsAt: null,
        createdBy: user.id,
      },
    });
    await prisma.discountListItem.create({
      data: {
        organizationId: org.id,
        storeId,
        listId: list.id,
        productVariantId: variant.id,
        barcode: COVER_BARCODE,
        productTitle: `Kapsama Ürünü ${COVER_BARCODE}`,
        currentPrice: new Decimal(CURRENT_PRICE),
        included: true,
        sortOrder: 0,
      },
    });
    return list.id;
  }

  const now = Date.now();

  // Store A: a covering-now week (uploaded FIRST) + an expired week (uploaded LAST).
  const coverStoreId = await seedStore('Cover Store', 'disc-cover-test');
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
  const coverListId = await seedNullStartList(coverStoreId, 'Anlık Kapsayan Liste');

  // Store B: ONLY an expired week — the fallback path must still return its bands.
  const expiredStoreId = await seedStore('Expired Store', 'disc-expired-test');
  await seedTariffIn({
    storeId: expiredStoreId,
    name: EXPIRED_TARIFF_NAME,
    periodLabel: 'Gecmis Hafta',
    weekCenterMs: now - 40 * DAY_MS,
    pct: EXPIRED_ONLY_PCT,
    createdAt: new Date(now - DAY_MS),
  });
  const expiredListId = await seedNullStartList(expiredStoreId, 'Anlık Süresi Dolmuş Liste');

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    coverStoreId,
    coverListId,
    expiredStoreId,
    expiredListId,
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

describe('Discount Lists - covering-week resolution on the current path + expired flag', () => {
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

  it('a covering week for now is NOT flagged as expired', async () => {
    const { body } = await detailFor(cfx.accessToken, cfx.orgId, cfx.coverStoreId, cfx.coverListId);
    expect(body.commissionPeriodExpired).toBe(false);
  });

  it('when only an expired week exists the fallback returns its bands and flags it expired', async () => {
    const { status, body } = await detailFor(
      cfx.accessToken,
      cfx.orgId,
      cfx.expiredStoreId,
      cfx.expiredListId,
    );
    expect(status).toBe(200);
    // No week covers now → fallback to the latest-uploaded tariff's last-past period. The
    // bands still come through, and the seller is told the period is expired.
    expect(body.commissionTariffName).toBe(EXPIRED_TARIFF_NAME);
    expect(body.commissionPeriodExpired).toBe(true);
    const item = body.items.find((i) => i.barcode === COVER_BARCODE);
    expect(item?.discounted.commissionSource).toBe('band');
    expect(Number(item?.discounted.commissionPct)).toBe(EXPIRED_ONLY_PCT);
  });
});
