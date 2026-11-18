// The commission tariff detail and item estimate resolve each item's catalog variant from
// the item's barcode as the store's catalog is at request time, never from the
// product_variant_id stored at import (an import-time snapshot). Pinned here:
//   - linked later: an item uploaded before its product existed is priced, with its
//     image, once the variant exists, with no re-upload (and the GET writes nothing);
//   - re-linked after delete: the stored variant is gone, a new variant with the same
//     barcode prices the item;
//   - stale id: a stored id pointing at a variant with ANOTHER barcode is not read;
//   - duplicate barcode: a listed variant beats an older delisted copy, on every read;
//   - one lookup per read: the barcode lookup runs once per detail or estimate request,
//     whatever the item and period count;
//   - failed lookup: the detail and the estimate still answer 200 with every item
//     degraded (reason null, not NO_PRODUCT) and one [profit-read] log line.
//
// The calculable-variant setup mirrors seedTariffFixture in
// commission-tariffs.routes.test.ts (TRY cost + SENDEOMP shipping + fee definitions).

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { resolveVariantIdsByBarcode } from '@/lib/variant-barcode-lookup';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

// The barcode lookup wrapped in a spy that runs the real query, so a case can count how
// many times one request resolves its items.
vi.mock('@/lib/variant-barcode-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/variant-barcode-lookup')>();
  return { ...actual, resolveVariantIdsByBarcode: vi.fn(actual.resolveVariantIdsByBarcode) };
});

const app = createApp();

const BandSchema = z.object({
  key: z.string(),
  price: z.string().nullable(),
  netProfit: z.string().nullable(),
});
const ItemSchema = z.object({
  id: z.string(),
  barcode: z.string(),
  imageUrl: z.string().nullable(),
  currentNetProfit: z.string().nullable(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
  bands: z.array(BandSchema),
});
const DetailSchema = z.object({
  periods: z.array(z.object({ items: z.array(ItemSchema) })),
});
const EstimateSchema = z.object({
  itemId: z.string(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
  breakdown: z.object({ netProfit: z.string() }).nullable(),
});
type DetailItem = z.infer<typeof ItemSchema>;
type Detail = z.infer<typeof DetailSchema>;
type Estimate = z.infer<typeof EstimateSchema>;

// Four limited bands: every band has a price whatever the current price.
const LIMITED_BANDS = [
  { key: 'band1', lowerLimit: '450.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '400.00', upperLimit: '450.00', commissionPct: '15' },
  { key: 'band3', lowerLimit: '350.00', upperLimit: '400.00', commissionPct: '12' },
  { key: 'band4', upperLimit: '350.00', commissionPct: '10' },
];

interface SeededItem {
  readonly barcode: string;
  /** The product_variant_id written at import (the snapshot the reads must ignore). */
  readonly storedVariantId: string | null;
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
  profileId: string;
}

let ctx: Ctx;
let nextPlatformId = 95_000n;

function platformId(): bigint {
  nextPlatformId += 1n;
  return nextPlatformId;
}

async function createImagedProduct(imageUrl: string): Promise<{ id: string }> {
  return prisma.product.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      platformContentId: platformId(),
      productMainId: `pm-relink-${platformId().toString()}`,
      title: 'Relink Product',
      categoryId: 597n,
      categoryName: 'Gomlek',
      brandId: 2032n,
      brandName: 'Modline',
      // Two images: the detail must surface the first one.
      imageUrls: [imageUrl, `${imageUrl}?second`],
    },
    select: { id: true },
  });
}

/**
 * One catalog variant of the context store: 500 TRY, VAT 20, desi 3. Linked to the shared
 * COGS profile unless `withCost` is false. `delistedAt` / `createdAt` shape a duplicate.
 */
async function createVariant(
  productId: string,
  barcode: string,
  options: {
    readonly withCost?: boolean;
    readonly delistedAt?: Date;
    readonly createdAt?: Date;
  } = {},
): Promise<{ id: string }> {
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      productId,
      platformVariantId: platformId(),
      barcode,
      stockCode: barcode,
      salePrice: new Decimal('500.00'),
      listPrice: new Decimal('500.00'),
      vatRate: 20,
      dimensionalWeightOverride: new Decimal('3.0'),
      delistedAt: options.delistedAt ?? null,
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    },
    select: { id: true },
  });
  if (options.withCost ?? true) {
    await prisma.productVariantCostProfile.create({
      data: { organizationId: ctx.orgId, profileId: ctx.profileId, productVariantId: variant.id },
    });
  }
  return variant;
}

/**
 * A saved tariff of the context store with one period per entry of `periods`. Every item
 * has a known current price (500), commission base price (480) and current commission
 * (19%), and the four limited bands. Returns the tariff id and the item ids of the first
 * period by barcode.
 */
async function seedTariff(
  periods: ReadonlyArray<ReadonlyArray<SeededItem>>,
): Promise<{ tariffId: string; itemIdOf: (barcode: string) => string }> {
  const tariff = await prisma.commissionTariff.create({
    data: { organizationId: ctx.orgId, storeId: ctx.storeId, name: 'Relink Tariff' },
    select: { id: true },
  });
  const firstPeriodIds = new Map<string, string>();
  for (const [periodIndex, items] of periods.entries()) {
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        tariffId: tariff.id,
        dateRangeLabel: `Period ${periodIndex.toString()}`,
        sortOrder: periodIndex,
      },
      select: { id: true },
    });
    const created = await prisma.commissionTariffItem.createManyAndReturn({
      data: items.map((item, sortOrder) => ({
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        periodId: period.id,
        productVariantId: item.storedVariantId,
        barcode: item.barcode,
        productTitle: item.barcode,
        sortOrder,
        currentPrice: '500.00',
        commissionBasePrice: '480.00',
        currentCommissionPct: '19.0000',
        bands: LIMITED_BANDS,
      })),
      select: { id: true, barcode: true },
    });
    if (periodIndex === 0) {
      for (const row of created) firstPeriodIds.set(row.barcode, row.id);
    }
  }
  return {
    tariffId: tariff.id,
    itemIdOf: (barcode: string): string => {
      const id = firstPeriodIds.get(barcode);
      if (id === undefined) throw new Error(`tariff has no item ${barcode}`);
      return id;
    },
  };
}

async function fetchDetail(tariffId: string): Promise<Detail> {
  const res = await app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}`,
    { headers: { Authorization: bearer(ctx.accessToken) } },
  );
  expect(res.status).toBe(200);
  return DetailSchema.parse(await res.json());
}

async function fetchDetailItem(tariffId: string, barcode: string): Promise<DetailItem> {
  const detail = await fetchDetail(tariffId);
  const item = detail.periods[0]?.items.find((row) => row.barcode === barcode);
  if (item === undefined) throw new Error(`detail has no item ${barcode}`);
  return item;
}

async function estimateCurrent(tariffId: string, itemId: string): Promise<Estimate> {
  const res = await app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}/items/${itemId}/estimate`,
    {
      method: 'POST',
      headers: { Authorization: bearer(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    },
  );
  expect(res.status).toBe(200);
  return EstimateSchema.parse(await res.json());
}

function expectNoProduct(item: DetailItem): void {
  expect(item.calculable).toBe(false);
  expect(item.reason).toBe('NO_PRODUCT');
  expect(item.imageUrl).toBeNull();
  expect(item.currentNetProfit).toBeNull();
  for (const band of item.bands) {
    expect(band.netProfit).toBeNull();
  }
}

function expectPriced(item: DetailItem): void {
  expect(item.calculable).toBe(true);
  expect(item.reason).toBeNull();
  expect(item.currentNetProfit).not.toBeNull();
  expect(item.bands).toHaveLength(LIMITED_BANDS.length);
  for (const band of item.bands) {
    expect(band.netProfit).not.toBeNull();
  }
}

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
      name: 'Relink Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'tariff-relink-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Relink',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
    },
  });
  // The scenario engine costs from the profile's versions, as the cost-profile service
  // writes a version 1 on create.
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: org.id,
      version: 1,
      name: 'COGS Relink',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });
  await ensureFeeDefinitions();

  ctx = { accessToken: user.accessToken, orgId: org.id, storeId: store.id, profileId: profile.id };
});

describe('Commission tariffs - the item variant is resolved from the barcode at read time', () => {
  it('prices an item imported before its variant existed once the variant exists, with no re-upload', async () => {
    const { tariffId, itemIdOf } = await seedTariff([
      [{ barcode: 'BC-LATE', storedVariantId: null }],
    ]);
    const itemId = itemIdOf('BC-LATE');

    // No catalog variant carries the barcode yet.
    expectNoProduct(await fetchDetailItem(tariffId, 'BC-LATE'));
    const estimateBefore = await estimateCurrent(tariffId, itemId);
    expect(estimateBefore.calculable).toBe(false);
    expect(estimateBefore.reason).toBe('NO_PRODUCT');
    expect(estimateBefore.breakdown).toBeNull();

    // The product sync lands the variant (with a cost) after the upload.
    const product = await createImagedProduct('https://cdn.example/late-0.jpg');
    await createVariant(product.id, 'BC-LATE');

    const after = await fetchDetailItem(tariffId, 'BC-LATE');
    expectPriced(after);
    expect(after.imageUrl).toBe('https://cdn.example/late-0.jpg');

    const estimateAfter = await estimateCurrent(tariffId, itemId);
    expect(estimateAfter.calculable).toBe(true);
    expect(estimateAfter.reason).toBeNull();
    expect(estimateAfter.breakdown).not.toBeNull();
    // The modal number equals the detail row's current profit exactly.
    expect(estimateAfter.breakdown?.netProfit).toBe(after.currentNetProfit);

    // The reads resolved the variant without writing the stored link back.
    const stored = await prisma.commissionTariffItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { productVariantId: true },
    });
    expect(stored.productVariantId).toBeNull();
  });

  it('prices an item whose stored variant was deleted from the new variant with that barcode', async () => {
    const firstProduct = await createImagedProduct('https://cdn.example/relink-v1.jpg');
    const first = await createVariant(firstProduct.id, 'BC-RELINK');
    const { tariffId, itemIdOf } = await seedTariff([
      [{ barcode: 'BC-RELINK', storedVariantId: first.id }],
    ]);
    expect((await fetchDetailItem(tariffId, 'BC-RELINK')).imageUrl).toBe(
      'https://cdn.example/relink-v1.jpg',
    );

    await prisma.productVariant.delete({ where: { id: first.id } });
    const secondProduct = await createImagedProduct('https://cdn.example/relink-v2.jpg');
    await createVariant(secondProduct.id, 'BC-RELINK');

    const after = await fetchDetailItem(tariffId, 'BC-RELINK');
    expectPriced(after);
    expect(after.imageUrl).toBe('https://cdn.example/relink-v2.jpg');

    const estimate = await estimateCurrent(tariffId, itemIdOf('BC-RELINK'));
    expect(estimate.calculable).toBe(true);
    expect(estimate.breakdown?.netProfit).toBe(after.currentNetProfit);
  });

  it('does not read a stored id whose variant carries another barcode', async () => {
    const product = await createImagedProduct('https://cdn.example/other-0.jpg');
    const other = await createVariant(product.id, 'BC-OTHER');
    const { tariffId, itemIdOf } = await seedTariff([
      [
        // Stored link points at a calculable variant, but no variant has this barcode.
        { barcode: 'BC-STALE', storedVariantId: other.id },
        // Control: the same variant prices an item that carries its own barcode.
        { barcode: 'BC-OTHER', storedVariantId: null },
      ],
    ]);

    expectNoProduct(await fetchDetailItem(tariffId, 'BC-STALE'));
    expectPriced(await fetchDetailItem(tariffId, 'BC-OTHER'));

    const estimate = await estimateCurrent(tariffId, itemIdOf('BC-STALE'));
    expect(estimate.calculable).toBe(false);
    expect(estimate.reason).toBe('NO_PRODUCT');
    expect(estimate.breakdown).toBeNull();
  });

  it('prices from the listed variant when an older delisted copy without cost shares the barcode', async () => {
    const product = await createImagedProduct('https://cdn.example/dup-0.jpg');
    // The old copy is older (so an "oldest wins" rule alone would pick it), delisted and
    // has no cost: priced from it, the item would read NO_COST.
    const old = await createVariant(product.id, 'BC-DUP', {
      withCost: false,
      delistedAt: new Date(Date.now() - 86_400_000),
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    });
    await createVariant(product.id, 'BC-DUP');
    const { tariffId, itemIdOf } = await seedTariff([
      [{ barcode: 'BC-DUP', storedVariantId: old.id }],
    ]);

    const profits: Array<string | null> = [];
    for (let read = 0; read < 2; read += 1) {
      const row = await fetchDetailItem(tariffId, 'BC-DUP');
      expectPriced(row);
      const estimate = await estimateCurrent(tariffId, itemIdOf('BC-DUP'));
      expect(estimate.calculable).toBe(true);
      expect(estimate.breakdown?.netProfit).toBe(row.currentNetProfit);
      profits.push(row.currentNetProfit);
    }
    expect(profits[1]).toBe(profits[0]);
  });
});

describe('Commission tariffs - one barcode lookup per read', () => {
  it('resolves the items with one lookup per detail read and per estimate', async () => {
    const lookup = vi.mocked(resolveVariantIdsByBarcode);
    const product = await createImagedProduct('https://cdn.example/bulk-0.jpg');

    // A small tariff: one period of two items.
    const smallBarcodes = ['BC-Q-1', 'BC-Q-2'];
    for (const barcode of smallBarcodes) await createVariant(product.id, barcode);
    const small = await seedTariff([
      smallBarcodes.map((barcode) => ({ barcode, storedVariantId: null })),
    ]);

    // A large tariff: three periods of the same 40 barcodes, every one with a variant.
    const bulkBarcodes = Array.from(
      { length: 40 },
      (_, index) => `BC-BULK-${index.toString().padStart(2, '0')}`,
    );
    await prisma.productVariant.createMany({
      data: bulkBarcodes.map((barcode) => ({
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        productId: product.id,
        platformVariantId: platformId(),
        barcode,
        stockCode: barcode,
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: 20,
        dimensionalWeightOverride: new Decimal('3.0'),
      })),
    });
    const bulkPeriod = bulkBarcodes.map((barcode) => ({ barcode, storedVariantId: null }));
    const large = await seedTariff([bulkPeriod, bulkPeriod, bulkPeriod]);

    lookup.mockClear();
    const smallDetail = await fetchDetail(small.tariffId);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ctx.orgId, storeId: ctx.storeId },
      expect.anything(),
    );
    for (const item of smallDetail.periods[0]?.items ?? []) {
      expectPriced(item);
    }

    lookup.mockClear();
    const largeDetail = await fetchDetail(large.tariffId);
    expect(lookup).toHaveBeenCalledTimes(1);
    const [, , requested] = lookup.mock.calls[0] ?? [];
    expect(new Set(requested ?? []).size).toBe(bulkBarcodes.length);
    expect(largeDetail.periods).toHaveLength(3);
    for (const period of largeDetail.periods) {
      expect(period.items).toHaveLength(bulkBarcodes.length);
      // Every item found its variant (these variants carry no cost, so they are not
      // calculable, but never for want of a product).
      for (const item of period.items) {
        expect(item.reason).not.toBe('NO_PRODUCT');
      }
    }

    lookup.mockClear();
    await estimateCurrent(large.tariffId, large.itemIdOf('BC-BULK-07'));
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

// A failed barcode lookup is a profit-read failure like a failed scenario-base load: the
// page and the modal still open (200) with empty profit, every item reads degraded
// (reason null, never NO_PRODUCT -- the product may well exist), and the failure is logged
// once as [profit-read] (owner decision 2026-11-04).
describe('Commission tariffs - a failed barcode lookup degrades instead of failing', () => {
  const PROFIT_READ_LOG = '[profit-read] in-request profit computation failed';

  it('opens the detail with every item degraded and logs the failure once', async () => {
    const lookup = vi.mocked(resolveVariantIdsByBarcode);
    const product = await createImagedProduct('https://cdn.example/ldeg-0.jpg');
    // A priced variant: without the failure this item would be calculable, and the item
    // with no variant would read NO_PRODUCT -- so the degraded reading is distinguishable.
    await createVariant(product.id, 'BC-LDEG-PRICED');
    const { tariffId } = await seedTariff([
      [
        { barcode: 'BC-LDEG-PRICED', storedVariantId: null },
        { barcode: 'BC-LDEG-NONE', storedVariantId: null },
      ],
    ]);
    const lookupError = new Error('barcode lookup down');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      lookup.mockRejectedValueOnce(lookupError);
      const detail = await fetchDetail(tariffId);

      const items = detail.periods[0]?.items ?? [];
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.calculable).toBe(false);
        expect(item.reason).toBeNull();
        expect(item.imageUrl).toBeNull();
        expect(item.currentNetProfit).toBeNull();
        for (const band of item.bands) {
          expect(band.netProfit).toBeNull();
        }
      }

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, fields] = errorSpy.mock.calls[0] ?? [];
      expect(message).toBe(PROFIT_READ_LOG);
      expect(fields).toMatchObject({
        surface: 'commission-tariff',
        organizationId: ctx.orgId,
        orderId: null,
        err: lookupError,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('opens the estimate as degraded and logs the failure once', async () => {
    const lookup = vi.mocked(resolveVariantIdsByBarcode);
    const product = await createImagedProduct('https://cdn.example/ldeg-est-0.jpg');
    await createVariant(product.id, 'BC-LDEG-EST');
    const { tariffId, itemIdOf } = await seedTariff([
      [{ barcode: 'BC-LDEG-EST', storedVariantId: null }],
    ]);
    const lookupError = new Error('barcode lookup down');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      lookup.mockRejectedValueOnce(lookupError);
      const estimate = await estimateCurrent(tariffId, itemIdOf('BC-LDEG-EST'));

      expect(estimate.calculable).toBe(false);
      expect(estimate.reason).toBeNull();
      expect(estimate.breakdown).toBeNull();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, fields] = errorSpy.mock.calls[0] ?? [];
      expect(message).toBe(PROFIT_READ_LOG);
      expect(fields).toMatchObject({
        surface: 'commission-tariff',
        organizationId: ctx.orgId,
        orderId: null,
        err: lookupError,
      });
    } finally {
      errorSpy.mockRestore();
    }

    // The failure was one request's: the next read resolves the variant and prices it.
    const after = await estimateCurrent(tariffId, itemIdOf('BC-LDEG-EST'));
    expect(after.calculable).toBe(true);
  });
});
