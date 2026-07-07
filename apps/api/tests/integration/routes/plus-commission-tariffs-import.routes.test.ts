// Round-trip integration test for POST .../plus-commission-tariffs/import using the
// real Trendyol "Plus Komisyon" exports as fixtures. It proves the whole chain on
// the actual vendor sheets for BOTH shapes:
//   • single-period (7-day) → one period + one item per product;
//   • multi-period (3-day + 4-day) → two periods, one item per (product × period),
//     each item carrying THAT period's Plus offer percent, with sortOrder aligned
//     across periods and the tariff week window folded to [min start … max end].
//
// Persistence is asserted directly through Prisma (the on-read profit detail is a
// sibling concern covered by the detail route test).

import { readFileSync } from 'node:fs';

import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const FIXTURE_7DAY = readFileSync(
  new URL('../../fixtures/trendyol-plus-tariff.xlsx', import.meta.url),
);
const FIXTURE_MULTI = readFileSync(
  new URL('../../fixtures/trendyol-plus-tariff-3ve4.xlsx', import.meta.url),
);

// A barcode present in the single-period fixture (matched to a catalog variant).
const MATCHED_BARCODE = '85697423698';
// The first product row of the multi-period fixture and its two per-period offers.
const MULTI_BARCODE = '2902003000019';
const MULTI_OFFER_3DAY = '10.7';
const MULTI_OFFER_4DAY = '13.1';

interface ImportWire {
  tariffId: string;
  productCount: number;
  periodCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setupStore(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id, { name: 'Plus Import Store' });
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

/** Adds a catalog variant matching `barcode` so the import reports one match. */
async function addVariant(ctx: Ctx, barcode: string): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      platformContentId: 9301n,
      productMainId: 'pm-9301',
      title: 'Turk Bayragi',
      categoryId: 597n,
      categoryName: 'Bayrak',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      productId: product.id,
      platformVariantId: 93010n,
      barcode,
      stockCode: barcode,
      salePrice: new Decimal('472.50'),
      listPrice: new Decimal('472.50'),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
    },
  });
}

function importRequest(ctx: Ctx, fixture: Buffer, filename: string): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(fixture)]), filename);
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

describe('POST .../plus-commission-tariffs/import - real Trendyol fixtures', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('imports the single-period (7-day) fixture as one period + one item per product', async () => {
    const ctx = await setupStore();
    await addVariant(ctx, MATCHED_BARCODE);

    const res = await app.request(importRequest(ctx, FIXTURE_7DAY, 'trendyol-plus-tariff.xlsx'));
    expect(res.status).toBe(201);
    const imported = (await res.json()) as ImportWire;

    expect(imported.periodCount).toBe(1);
    expect(imported.productCount).toBeGreaterThan(40);
    expect(imported.itemCount).toBe(imported.productCount);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(imported.productCount - 1);
    expect(imported.skippedRows).toBe(0);

    // One tariff, one 7-day period, one item per product row.
    const periods = await prisma.plusCommissionTariffPeriod.findMany({
      where: { tariffId: imported.tariffId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(periods).toHaveLength(1);
    expect(periods[0]?.dayCount).toBe(7);
    expect((periods[0]?.dateRangeLabel ?? '').length).toBeGreaterThan(0);

    const itemCount = await prisma.plusCommissionTariffItem.count({
      where: { periodId: periods[0]?.id },
    });
    expect(itemCount).toBe(imported.productCount);

    // The folded week window parses from the single period's date range.
    const tariff = await prisma.plusCommissionTariff.findUnique({
      where: { id: imported.tariffId },
      select: { storeId: true, weekStartsAt: true, weekEndsAt: true },
    });
    expect(tariff?.storeId).toBe(ctx.storeId);
    expect(tariff?.weekStartsAt).not.toBeNull();
    expect(tariff?.weekEndsAt).not.toBeNull();
  });

  it('imports the multi-period (3+4-day) fixture as two periods, offers per period', async () => {
    const ctx = await setupStore();

    const res = await app.request(
      importRequest(ctx, FIXTURE_MULTI, 'trendyol-plus-tariff-3ve4.xlsx'),
    );
    expect(res.status).toBe(201);
    const imported = (await res.json()) as ImportWire;

    expect(imported.periodCount).toBe(2);
    expect(imported.productCount).toBeGreaterThan(0);
    // One item per (product × period): two periods → twice the product count.
    expect(imported.itemCount).toBe(imported.productCount * 2);

    const periods = await prisma.plusCommissionTariffPeriod.findMany({
      where: { tariffId: imported.tariffId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(periods).toHaveLength(2);
    expect(periods.map((p) => p.dayCount)).toEqual([3, 4]);

    const period3 = periods[0];
    const period4 = periods[1];
    if (period3 === undefined || period4 === undefined) throw new Error('periods missing');

    // Each period's item for the first product carries THAT period's offer percent.
    const item3 = await prisma.plusCommissionTariffItem.findFirst({
      where: { periodId: period3.id, barcode: MULTI_BARCODE },
    });
    const item4 = await prisma.plusCommissionTariffItem.findFirst({
      where: { periodId: period4.id, barcode: MULTI_BARCODE },
    });
    expect(item3?.plusCommissionPct.toString()).toBe(MULTI_OFFER_3DAY);
    expect(item4?.plusCommissionPct.toString()).toBe(MULTI_OFFER_4DAY);

    // The per-period item lists share the identical (barcode, sortOrder) sequence so
    // the detail tabs line the products up row-for-row.
    const seq3 = await prisma.plusCommissionTariffItem.findMany({
      where: { periodId: period3.id },
      orderBy: { sortOrder: 'asc' },
      select: { barcode: true, sortOrder: true },
    });
    const seq4 = await prisma.plusCommissionTariffItem.findMany({
      where: { periodId: period4.id },
      orderBy: { sortOrder: 'asc' },
      select: { barcode: true, sortOrder: true },
    });
    expect(seq4).toEqual(seq3);

    // The tariff week window folds to [min(period.starts) … max(period.ends)].
    const tariff = await prisma.plusCommissionTariff.findUnique({
      where: { id: imported.tariffId },
      select: { weekStartsAt: true, weekEndsAt: true },
    });
    const expectedStart = Math.min(
      period3.startsAt?.getTime() ?? Infinity,
      period4.startsAt?.getTime() ?? Infinity,
    );
    const expectedEnd = Math.max(
      period3.endsAt?.getTime() ?? -Infinity,
      period4.endsAt?.getTime() ?? -Infinity,
    );
    expect(tariff?.weekStartsAt?.getTime()).toBe(expectedStart);
    expect(tariff?.weekEndsAt?.getTime()).toBe(expectedEnd);
    // The 3-day block starts the window, the 4-day block ends it.
    expect(tariff?.weekStartsAt?.getTime()).toBe(period3.startsAt?.getTime());
    expect(tariff?.weekEndsAt?.getTime()).toBe(period4.endsAt?.getTime());
  });
});
