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

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  cellText,
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  type CellPatch,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import { trendyolPlusCommissionTariffFormat } from '@/workbooks/formats/trendyol/plus-commission-tariff.format';
import { missingExportRequirement, resolveWriteColumns } from '@/workbooks/write-columns';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { blockColumn, blocksOf } from '../../helpers/layout-blocks';

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
      dimensionalWeightOverride: new Decimal('3.0'),
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

// This file sends more imports than RATE_LIMITS.FILE_IMPORT allows per minute with the
// same pooled user; reset the in-memory limiter so each test starts with a fresh bucket.
beforeEach(() => {
  _resetRateLimitStoreForTests();
});

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
    expect(item3?.plusCommissionPct?.toString()).toBe(MULTI_OFFER_3DAY);
    expect(item4?.plusCommissionPct?.toString()).toBe(MULTI_OFFER_4DAY);

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

// A period offer is stored in a numeric(6,4) column. The import's write-back check reads
// it as a plain number, so an offer of 100 reaches the item insert, which cannot hold it.
const OVERFLOWING_OFFER = '100';
// Sheet row 2, the first kept row of the single-period fixture, is MATCHED_BARCODE's.
const FIRST_KEPT_ROW = 2;

// Strict issues: a `meta` on the file issue would fail the parse.
const ProblemSchema = z.object({
  status: z.number(),
  code: z.string(),
  errors: z.array(z.strictObject({ field: z.string(), code: z.string() })),
});

/** The single-period fixture with the first period's offer of its first kept row replaced. */
async function withFirstOffer(value: string): Promise<Buffer> {
  const format = trendyolPlusCommissionTariffFormat;
  const grid = await readWorkbookGrid(FIXTURE_7DAY, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable Plus fixture');
  const barcode = columnIndex(format.layout, layout, 'barcode');
  expect(cellText(grid[FIRST_KEPT_ROW - 1] ?? [], barcode)).toBe(MATCHED_BARCODE);
  const period = blocksOf(format.layout, layout, 'periods')[0];
  if (period === undefined) throw new Error('the fixture has no period block');
  const offer = blockColumn(format.layout, 'periods', period, 'offer');
  return patchFixture(
    FIXTURE_7DAY,
    [{ excelRow: FIRST_KEPT_ROW, col: offer, value: { kind: 'number', value } }],
    { sheet: format.sheet },
  );
}

describe('POST .../plus-commission-tariffs/import - a number its column cannot hold', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('answers 422 MALFORMED_SHEET on file for a period offer of 100 and stores nothing', async () => {
    const ctx = await setupStore();
    const file = await withFirstOffer(OVERFLOWING_OFFER);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff.xlsx'));

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    // The write transaction rolled back: no tariff, period or item of the store.
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    expect(await prisma.plusCommissionTariff.count({ where: scope })).toBe(0);
    expect(await prisma.plusCommissionTariffPeriod.count({ where: scope })).toBe(0);
    expect(await prisma.plusCommissionTariffItem.count({ where: scope })).toBe(0);
  });
});

// The day count inside a period header, "(N " before the day unit.
const PERIOD_HEADER_DAYS_RE = /\(\d+ /;

/**
 * The single-period fixture with the header of its one period rewritten to `days`
 * days; only the digits of the header change, so the file keeps one block.
 */
async function withPeriodDays(days: number): Promise<Buffer> {
  const format = trendyolPlusCommissionTariffFormat;
  const grid = await readWorkbookGrid(FIXTURE_7DAY, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable Plus fixture');
  const blocks = blocksOf(format.layout, layout, 'periods');
  expect(blocks).toHaveLength(1);
  const period = blocks[0];
  if (period === undefined) throw new Error('the fixture has no period block');
  const headerText = cellText(grid[layout.headerRowIndex] ?? [], period.anchor);
  if (headerText === null) throw new Error('the period has no header');
  const rewritten = headerText.replace(PERIOD_HEADER_DAYS_RE, `(${days} `);
  expect(rewritten).not.toBe(headerText);
  const file = patchFixture(
    FIXTURE_7DAY,
    [
      {
        excelRow: layout.headerRowIndex + 1,
        col: period.anchor,
        value: { kind: 'text', value: rewritten },
      },
    ],
    { sheet: format.sheet },
  );
  // The rewritten file still resolves, its one period now tagged `days`.
  const reread = resolveLayout(
    format.layout,
    await readWorkbookGrid(file, { sheet: format.sheet }),
  );
  if (reread === null) throw new Error('the rewritten Plus fixture does not resolve');
  expect(blocksOf(format.layout, reread, 'periods').map((block) => block.tag)).toEqual([days]);
  return file;
}

describe('POST .../plus-commission-tariffs/import - a period of 0 days', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('answers 422 MALFORMED_SHEET on file for a "(0 days)" period header and stores nothing', async () => {
    const ctx = await setupStore();
    const file = await withPeriodDays(0);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff.xlsx'));

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    expect(await prisma.plusCommissionTariff.count({ where: scope })).toBe(0);
  });
});

/** The price columns a test blanks. */
type PriceColumn = 'currentPrice' | 'commissionBasePrice' | 'plusPriceUpperLimit';

/** The plain columns a test blanks: a price, or the current commission. */
type BlankColumn = PriceColumn | 'currentCommission';

const ImportedSchema = z.object({ tariffId: z.string() });

/** `fixture` with the `columns` cells of its first kept row (`barcode`'s) cleared. */
async function withBlankCells(
  fixture: Buffer,
  barcode: string,
  columns: readonly BlankColumn[],
): Promise<Buffer> {
  const format = trendyolPlusCommissionTariffFormat;
  const grid = await readWorkbookGrid(fixture, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable Plus fixture');
  const barcodeCol = columnIndex(format.layout, layout, 'barcode');
  expect(cellText(grid[FIRST_KEPT_ROW - 1] ?? [], barcodeCol)).toBe(barcode);
  const patches = columns.map((key): CellPatch => {
    const col = columnIndex(format.layout, layout, key);
    if (col === null) throw new Error(`the fixture has no ${key} column`);
    return { excelRow: FIRST_KEPT_ROW, col, value: { kind: 'clear' } };
  });
  return patchFixture(fixture, patches, { sheet: format.sheet });
}

describe('POST .../plus-commission-tariffs/import - an unknown price', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('stores a row with a blank Plus price upper limit with plus_price_upper_limit NULL in every period', async () => {
    const ctx = await setupStore();
    const file = await withBlankCells(FIXTURE_MULTI, MULTI_BARCODE, ['plusPriceUpperLimit']);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff-3ve4.xlsx'));

    expect(res.status).toBe(201);
    const { tariffId } = ImportedSchema.parse(await res.json());
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const items = await prisma.plusCommissionTariffItem.findMany({
      where: { ...scope, barcode: MULTI_BARCODE, period: { tariffId } },
      select: {
        currentPrice: true,
        plusPriceUpperLimit: true,
        plusCommissionBasePrice: true,
      },
    });
    // One item per period, each with the unknown ceiling; the row's own Plus commission
    // base price is known, so it does not fall back.
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.plusPriceUpperLimit).toBeNull();
      expect(item.plusCommissionBasePrice?.toString()).toBe('886.78');
      expect(item.currentPrice?.toString()).toBe('933.45');
    }
    // Only that row's items carry an unknown ceiling.
    expect(
      await prisma.plusCommissionTariffItem.count({
        where: { ...scope, plusPriceUpperLimit: null },
      }),
    ).toBe(2);
  });

  it('stores a row with blank current and commission base prices with both columns NULL', async () => {
    const ctx = await setupStore();
    const file = await withBlankCells(FIXTURE_7DAY, MATCHED_BARCODE, [
      'currentPrice',
      'commissionBasePrice',
    ]);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff.xlsx'));

    expect(res.status).toBe(201);
    const { tariffId } = ImportedSchema.parse(await res.json());
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const item = await prisma.plusCommissionTariffItem.findFirst({
      where: { ...scope, barcode: MATCHED_BARCODE, period: { tariffId } },
      select: {
        currentPrice: true,
        commissionBasePrice: true,
        plusPriceUpperLimit: true,
        plusCommissionBasePrice: true,
      },
    });
    expect(item).not.toBeNull();
    expect(item?.currentPrice).toBeNull();
    expect(item?.commissionBasePrice).toBeNull();
    // The Plus prices of the same row are untouched.
    expect(item?.plusPriceUpperLimit?.toString()).toBe('377.66');
    expect(item?.plusCommissionBasePrice?.toString()).toBe('448.87');
    // Only that row carries an unknown current price.
    expect(
      await prisma.plusCommissionTariffItem.count({ where: { ...scope, currentPrice: null } }),
    ).toBe(1);
  });
});

const UnknownPriceCountSchema = z.object({
  periodCount: z.number(),
  unknownPriceRows: z.number(),
});

describe('POST .../plus-commission-tariffs/import - the unknown price count', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('answers unknownPriceRows 0 for a file whose prices all read', async () => {
    const ctx = await setupStore();

    const res = await app.request(importRequest(ctx, FIXTURE_7DAY, 'trendyol-plus-tariff.xlsx'));

    expect(res.status).toBe(201);
    const body = UnknownPriceCountSchema.parse(await res.json());
    expect(body.unknownPriceRows).toBe(0);
  });

  it('counts each product row with an unknown price once, whatever the number of periods', async () => {
    const ctx = await setupStore();
    const file = await withBlankCells(FIXTURE_MULTI, MULTI_BARCODE, ['plusPriceUpperLimit']);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff-3ve4.xlsx'));

    expect(res.status).toBe(201);
    const body = UnknownPriceCountSchema.parse(await res.json());
    // Two periods store two items of the row, and the row still counts once.
    expect(body.periodCount).toBe(2);
    expect(body.unknownPriceRows).toBe(1);
  });
});

/**
 * `fixture` with the offer of its period block `blockIndex` cleared on its first kept
 * row (`barcode`'s); the block's label stays, so the period is still stored.
 */
async function withBlankFirstRowOffer(
  fixture: Buffer,
  barcode: string,
  blockIndex: number,
): Promise<Buffer> {
  const format = trendyolPlusCommissionTariffFormat;
  const grid = await readWorkbookGrid(fixture, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable Plus fixture');
  const firstRow = grid[FIRST_KEPT_ROW - 1] ?? [];
  expect(cellText(firstRow, columnIndex(format.layout, layout, 'barcode'))).toBe(barcode);
  const period = blocksOf(format.layout, layout, 'periods')[blockIndex];
  if (period === undefined) throw new Error(`the fixture has no period block ${blockIndex}`);
  const offer = blockColumn(format.layout, 'periods', period, 'offer');
  // The fixture row holds a readable offer, so blanking it is the change.
  expect(cellText(firstRow, offer)).not.toBeNull();
  return patchFixture(
    fixture,
    [{ excelRow: FIRST_KEPT_ROW, col: offer, value: { kind: 'clear' } }],
    { sheet: format.sheet },
  );
}

const UnknownPercentImportSchema = z.object({
  tariffId: z.string(),
  periodCount: z.number(),
});

describe('POST .../plus-commission-tariffs/import - an unknown commission percent', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('stores a row with a blank period offer with plus_commission_pct NULL in that period only', async () => {
    const ctx = await setupStore();
    const file = await withBlankFirstRowOffer(FIXTURE_MULTI, MULTI_BARCODE, 0);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff-3ve4.xlsx'));

    expect(res.status).toBe(201);
    const body = UnknownPercentImportSchema.parse(await res.json());
    expect(body.periodCount).toBe(2);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const items = await prisma.plusCommissionTariffItem.findMany({
      where: { ...scope, barcode: MULTI_BARCODE, period: { tariffId: body.tariffId } },
      orderBy: { period: { sortOrder: 'asc' } },
      select: {
        currentCommissionPct: true,
        plusCommissionPct: true,
        period: { select: { dayCount: true } },
      },
    });
    // The 3-day item stores the unknown offer as null, never 0; the 4-day item keeps
    // its own offer, and the row's current commission is known in both.
    expect(
      items.map((item) => [item.period.dayCount, item.plusCommissionPct?.toString() ?? null]),
    ).toEqual([
      [3, null],
      [4, MULTI_OFFER_4DAY],
    ]);
    expect(items.every((item) => item.currentCommissionPct !== null)).toBe(true);
    // Only that item lost its offer.
    expect(
      await prisma.plusCommissionTariffItem.count({
        where: { ...scope, plusCommissionPct: null },
      }),
    ).toBe(1);
  });

  it('stores a blank current commission as NULL', async () => {
    const ctx = await setupStore();
    const file = await withBlankCells(FIXTURE_MULTI, MULTI_BARCODE, ['currentCommission']);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff-3ve4.xlsx'));

    expect(res.status).toBe(201);
    const body = UnknownPercentImportSchema.parse(await res.json());
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const items = await prisma.plusCommissionTariffItem.findMany({
      where: { ...scope, barcode: MULTI_BARCODE, period: { tariffId: body.tariffId } },
      orderBy: { period: { sortOrder: 'asc' } },
      select: { currentCommissionPct: true, plusCommissionPct: true },
    });
    // One item per period, each with an unknown current commission, never 0; the row's
    // offers are still known.
    expect(items.map((item) => item.currentCommissionPct)).toEqual([null, null]);
    expect(items.map((item) => item.plusCommissionPct?.toString() ?? null)).toEqual([
      MULTI_OFFER_3DAY,
      MULTI_OFFER_4DAY,
    ]);
    // Only that row lost its current commission.
    expect(
      await prisma.plusCommissionTariffItem.count({
        where: { ...scope, currentCommissionPct: null },
      }),
    ).toBe(2);
  });
});

const UnknownCommissionCountSchema = z.object({
  periodCount: z.number(),
  unknownCommissionRows: z.number(),
});

describe('POST .../plus-commission-tariffs/import - the unknown commission count', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it.each([
    [FIXTURE_7DAY, 'trendyol-plus-tariff.xlsx'],
    [FIXTURE_MULTI, 'trendyol-plus-tariff-3ve4.xlsx'],
  ])(
    'answers unknownCommissionRows 0 for a file whose percents all read (%#)',
    async (fixture, filename) => {
      const ctx = await setupStore();

      const res = await app.request(importRequest(ctx, fixture, filename));

      expect(res.status).toBe(201);
      const body = UnknownCommissionCountSchema.parse(await res.json());
      expect(body.unknownCommissionRows).toBe(0);
    },
  );

  it('counts a row with a blank offer in one stored period once', async () => {
    const ctx = await setupStore();
    const file = await withBlankFirstRowOffer(FIXTURE_MULTI, MULTI_BARCODE, 0);

    const res = await app.request(importRequest(ctx, file, 'trendyol-plus-tariff-3ve4.xlsx'));

    expect(res.status).toBe(201);
    const body = UnknownCommissionCountSchema.parse(await res.json());
    // Two periods store two items of the row, one with the unknown offer; the row
    // counts once.
    expect(body.periodCount).toBe(2);
    expect(body.unknownCommissionRows).toBe(1);
  });
});

// The header written over a write column: a text the layout does not know.
const REMOVED_HEADER = 'Removed column';

const PLUS_FIXTURES: [Buffer, string][] = [
  [FIXTURE_7DAY, 'trendyol-plus-tariff.xlsx'],
  [FIXTURE_MULTI, 'trendyol-plus-tariff-3ve4.xlsx'],
];

/**
 * Patches that overwrite the header of every write column the Plus export requires in
 * `fixture` (the Plus price and the tariff selection: either one carries the opt-in).
 * The columns are found through the format's write keys, so no header text is typed.
 */
async function requiredWriteHeaderPatches(fixture: Buffer): Promise<CellPatch[]> {
  const format = trendyolPlusCommissionTariffFormat;
  const grid = await readWorkbookGrid(fixture, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable Plus fixture');
  const required = format.exportRequires.flat();
  const patches = resolveWriteColumns(format, layout)
    .filter((entry) => required.includes(entry.key))
    .map(
      (entry): CellPatch => ({
        excelRow: layout.headerRowIndex + 1,
        col: entry.col,
        value: { kind: 'text', value: REMOVED_HEADER },
      }),
    );
  // An empty list would hand back the fixture untouched, and the import would answer 201.
  expect(patches.length).toBeGreaterThan(0);
  return patches;
}

/** True when `file` still reads as a Plus file but has no column its export requires. */
async function missesExportColumn(file: Buffer): Promise<boolean> {
  const format = trendyolPlusCommissionTariffFormat;
  const grid = await readWorkbookGrid(file, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the patched Plus fixture no longer resolves');
  return missingExportRequirement(format, resolveWriteColumns(format, layout));
}

describe('POST .../plus-commission-tariffs/import - a file with no column to write selections into', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it.each(PLUS_FIXTURES)(
    'answers 422 NO_WRITEBACK_COLUMN on file and stores nothing (%#)',
    async (fixture, filename) => {
      const ctx = await setupStore();
      const file = patchFixture(fixture, await requiredWriteHeaderPatches(fixture), {
        sheet: trendyolPlusCommissionTariffFormat.sheet,
      });
      // The file still reads as a Plus file: only its write columns are gone.
      expect(await missesExportColumn(file)).toBe(true);

      const res = await app.request(importRequest(ctx, file, filename));

      expect(res.status).toBe(422);
      const body = ProblemSchema.parse(await res.json());
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors).toEqual([{ field: 'file', code: 'NO_WRITEBACK_COLUMN' }]);
      const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
      expect(await prisma.plusCommissionTariff.count({ where: scope })).toBe(0);
    },
  );

  it.each(PLUS_FIXTURES)('imports the untouched fixture (%#)', async (fixture, filename) => {
    const ctx = await setupStore();
    const file = patchFixture(fixture, [], { sheet: trendyolPlusCommissionTariffFormat.sheet });
    expect(await missesExportColumn(file)).toBe(false);

    const res = await app.request(importRequest(ctx, file, filename));

    expect(res.status).toBe(201);
  });
});
