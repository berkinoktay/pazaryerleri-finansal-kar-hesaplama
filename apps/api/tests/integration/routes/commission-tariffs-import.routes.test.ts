// Round-trip integration test for POST .../commission-tariffs/import using the
// REAL Trendyol "Ürün Komisyon Tarifeleri" export as a fixture. This proves the
// whole chain on the actual vendor format: the engine's bogus-<dimension> fix,
// positional column mapping (duplicate commission headers), period detection,
// barcode → variant matching, persistence, and on-read profit computation.
//
// One catalog variant matches a fixture barcode (TB200X300A) and is fully
// costed (TRY cost + SENDEOMP shipping + fee defs), so its bands compute; the
// remaining rows have no catalog product and report NO_PRODUCT.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { parseStoredTariffBands } from '@pazarsync/profit';
import {
  cellText,
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  type CellPatch,
  type CellRow,
  type ResolvedLayout,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import { trendyolCommissionTariffFormat } from '@/workbooks/formats/trendyol/commission-tariff.format';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrder, createOrganization } from '../../helpers/factories';
import { blockColumn, blocksOf } from '../../helpers/layout-blocks';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-commission-tariff.xlsx', import.meta.url),
);
const MATCHED_BARCODE = 'TB200X300A';

interface ImportWire {
  tariffId: string;
  productCount: number;
  periodCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
  prefilledRows: number;
  unknownCurrentPriceRows: number;
  unknownCommissionRows: number;
}
interface BandWire {
  key: string;
  lowerLimit: string | null;
  upperLimit: string | null;
  price: string;
  commissionPct: string;
  netProfit: string | null;
}
interface DetailWire {
  periods: {
    dateRangeLabel: string;
    items: {
      barcode: string;
      commissionBasePrice: string | null;
      calculable: boolean;
      reason: string | null;
      bands: BandWire[];
    }[];
  }[];
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setupStoreWithMatch(): Promise<Ctx> {
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
      name: 'Import Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'tariff-import-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9101n,
      productMainId: 'pm-9101',
      title: '200x300 Cm Kumaş Türk Bayrağı',
      categoryId: 597n,
      categoryName: 'Bayrak',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 91010n,
      barcode: MATCHED_BARCODE,
      stockCode: MATCHED_BARCODE,
      salePrice: new Decimal('852.00'),
      listPrice: new Decimal('852.00'),
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
      amountGross: new Decimal('300.00'),
      vatRate: 20,
    },
  });
  // The scenario engine costs from the profile's VERSIONS (effective-dated), exactly as
  // the real cost-profile service writes a version 1 on create. Without it the variant
  // would read MISSING_COST and the matched item would be uncalculable.
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: org.id,
      version: 1,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('300.00'),
      vatRate: 20,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });
  await ensureFeeDefinitions();

  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

function importRequest(ctx: Ctx, file: Buffer = FIXTURE): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), 'trendyol-commission-tariff.xlsx');
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

// This file sends as many imports as RATE_LIMITS.FILE_IMPORT allows per minute with the
// same pooled user; reset the in-memory limiter so each test starts with a fresh bucket
// and the next added case does not tip it into a 429.
beforeEach(() => {
  _resetRateLimitStoreForTests();
});

describe('POST .../commission-tariffs/import — real Trendyol fixture', () => {
  let ctx: Ctx;
  let imported: ImportWire;
  // The `workbook.import.prefilled` log lines of the import request.
  let prefilledLogs: Parameters<typeof syncLog.info>[];

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    ctx = await setupStoreWithMatch();

    const info = vi.spyOn(syncLog, 'info');
    const res = await app.request(importRequest(ctx));
    prefilledLogs = info.mock.calls.filter(([event]) => event === 'workbook.import.prefilled');
    info.mockRestore();
    expect(res.status).toBe(201);
    imported = (await res.json()) as ImportWire;
  });

  it('answers prefilledRows, the count of filled-in rows the import logs', () => {
    // The real file arrives with prefilled choice labels: one log line counts them.
    expect(prefilledLogs).toEqual([
      [
        'workbook.import.prefilled',
        { page: WORKBOOK_PAGES.COMMISSION_TARIFF, count: expect.any(Number) },
      ],
    ]);
    const count = prefilledLogs[0]?.[1]?.['count'];
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(imported.prefilledRows)).toBe(true);
    expect(imported.prefilledRows).toBe(count);
  });

  it('imports every product row with one period and matches the catalog barcode', () => {
    expect(imported.productCount).toBeGreaterThan(50);
    expect(imported.periodCount).toBe(1);
    expect(imported.itemCount).toBe(imported.productCount);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(imported.productCount - 1);
    expect(imported.skippedRows).toBe(0);
  });

  it('answers unknownCurrentPriceRows 0 for a file whose prices all read', async () => {
    expect(imported.unknownCurrentPriceRows).toBe(0);
    // Every stored item of the real file carries a current price.
    expect(
      await prisma.commissionTariffItem.count({
        where: { organizationId: ctx.orgId, storeId: ctx.storeId, currentPrice: null },
      }),
    ).toBe(0);
  });

  it('answers unknownCommissionRows 0 for a file whose percents all read', async () => {
    expect(imported.unknownCommissionRows).toBe(0);
    // Every stored item of the real file carries a current commission.
    expect(
      await prisma.commissionTariffItem.count({
        where: { organizationId: ctx.orgId, storeId: ctx.storeId, currentCommissionPct: null },
      }),
    ).toBe(0);
  });

  it('assigns a sequential sortOrder reflecting the Excel row order', async () => {
    const items = await prisma.commissionTariffItem.findMany({
      where: { storeId: ctx.storeId },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true },
    });
    // 0-based, gap-free, one per row — proves the import numbers products by file order
    // (not all defaulting to 0, which would leave the detail order non-deterministic).
    expect(items.map((i) => i.sortOrder)).toEqual(items.map((_row, index) => index));
  });

  it('computes per-band profit for the matched product and NO_PRODUCT for the rest', async () => {
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${imported.tariffId}`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    expect(body.periods).toHaveLength(1);
    const period = body.periods[0];
    expect(period?.dateRangeLabel).toContain('Haziran');

    const matched = period?.items.find((i) => i.barcode === MATCHED_BARCODE);
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    // The "KOMİSYONA ESAS FİYAT" column was read from the real vendor file (852.0 for
    // this row) — byte-level proof the layout's search string matches the header.
    expect(matched?.commissionBasePrice).toBe('852.00');
    // Four bands, each with a non-null computed profit. The 4-day commissions are
    // 19 / 13.1 / 12.1 / 10.6 percent (read positionally past the duplicate headers).
    expect(matched?.bands).toHaveLength(4);
    expect(matched?.bands.map((b) => b.commissionPct)).toEqual(['19', '13.1', '12.1', '10.6']);
    for (const band of matched?.bands ?? []) {
      expect(band.netProfit).not.toBeNull();
    }

    const unmatched = period?.items.find((i) => i.barcode !== MATCHED_BARCODE);
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
  });
});

describe('POST .../commission-tariffs/import — profit recompute queueing', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  // An order's commission never reads a tariff's bands, so a tariff is not an order
  // input: nothing is queued, not even an order carrying an imported barcode.
  it('queues no order, not even one whose barcode the tariff covers', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();

    // An order whose item carries a barcode present in the fixture.
    const covered = await createOrder(ctx.orgId, ctx.storeId);
    await prisma.orderItem.create({
      data: {
        orderId: covered.id,
        organizationId: ctx.orgId,
        quantity: 1,
        lineSaleGross: '0.00',
        barcode: MATCHED_BARCODE,
      },
    });

    const res = await app.request(importRequest(ctx));
    expect(res.status).toBe(201);

    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: covered.id } }),
    ).toBeNull();
  });
});

// The current commission is stored in a numeric(6,4) column and never written back, so
// the import keeps a commission of 100 and the item insert is the first to refuse it.
const OVERFLOWING_COMMISSION = '100';
// Sheet row 2 is the fixture's first kept (barcode-carrying) row.
const FIRST_KEPT_ROW = 2;

// Strict issues: a `meta` on the file issue would fail the parse.
const ProblemSchema = z.object({
  status: z.number(),
  code: z.string(),
  errors: z.array(z.strictObject({ field: z.string(), code: z.string() })),
});

/** The fixture with the current commission of its first kept row replaced. */
async function withFirstCurrentCommission(value: string): Promise<Buffer> {
  const format = trendyolCommissionTariffFormat;
  const grid = await readWorkbookGrid(FIXTURE, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable commission fixture');
  const barcode = columnIndex(format.layout, layout, 'barcode');
  expect(cellText(grid[FIRST_KEPT_ROW - 1] ?? [], barcode)).not.toBeNull();
  const commission = columnIndex(format.layout, layout, 'currentCommission');
  if (commission === null) throw new Error('the fixture has no current commission column');
  return patchFixture(
    FIXTURE,
    [{ excelRow: FIRST_KEPT_ROW, col: commission, value: { kind: 'number', value } }],
    { sheet: format.sheet },
  );
}

// A stock past even the 64-bit range: Prisma refuses it before the query with a
// validation error (a 500) unless the row read refuses it first.
const OVERFLOWING_STOCK = '100000000000000000000';

/** The fixture with the stock of its first kept row replaced. */
async function withFirstStock(value: string): Promise<Buffer> {
  const format = trendyolCommissionTariffFormat;
  const grid = await readWorkbookGrid(FIXTURE, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable commission fixture');
  const barcode = columnIndex(format.layout, layout, 'barcode');
  expect(cellText(grid[FIRST_KEPT_ROW - 1] ?? [], barcode)).not.toBeNull();
  const stock = columnIndex(format.layout, layout, 'stock');
  if (stock === null) throw new Error('the fixture has no stock column');
  return patchFixture(
    FIXTURE,
    [{ excelRow: FIRST_KEPT_ROW, col: stock, value: { kind: 'number', value } }],
    { sheet: format.sheet },
  );
}

describe('POST .../commission-tariffs/import - a number its column cannot hold', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('answers 422 MALFORMED_SHEET on file for a current commission of 100 and stores nothing', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const file = await withFirstCurrentCommission(OVERFLOWING_COMMISSION);

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    // The write transaction rolled back: no tariff, period or item of the store.
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    expect(await prisma.commissionTariff.count({ where: scope })).toBe(0);
    expect(await prisma.commissionTariffPeriod.count({ where: scope })).toBe(0);
    expect(await prisma.commissionTariffItem.count({ where: scope })).toBe(0);
  });

  it('answers 422 MALFORMED_SHEET on file for a stock past the 64-bit range and stores nothing', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const file = await withFirstStock(OVERFLOWING_STOCK);

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    // The row read refused the file before the write: no tariff, period or item of the store.
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    expect(await prisma.commissionTariff.count({ where: scope })).toBe(0);
    expect(await prisma.commissionTariffPeriod.count({ where: scope })).toBe(0);
    expect(await prisma.commissionTariffItem.count({ where: scope })).toBe(0);
  });
});

// The day count inside a period header, "(N " before the day unit.
const PERIOD_HEADER_DAYS_RE = /\(\d+ /;

/**
 * The fixture with the header of its present period (the block whose label the first
 * data row fills) rewritten to `days` days; only the digits of the header change.
 */
async function withPresentPeriodDays(days: number): Promise<Buffer> {
  const format = trendyolCommissionTariffFormat;
  const grid = await readWorkbookGrid(FIXTURE, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable commission fixture');
  const headerRow = grid[layout.headerRowIndex] ?? [];
  const firstRow = grid[layout.headerRowIndex + 1] ?? [];
  const present = blocksOf(format.layout, layout, 'periods').find(
    (block) => cellText(firstRow, blockColumn(format.layout, 'periods', block, 'label')) !== null,
  );
  if (present === undefined) throw new Error('the fixture has no present period');
  const headerText = cellText(headerRow, present.anchor);
  if (headerText === null) throw new Error('the present period has no header');
  const rewritten = headerText.replace(PERIOD_HEADER_DAYS_RE, `(${days} `);
  expect(rewritten).not.toBe(headerText);
  const file = patchFixture(
    FIXTURE,
    [
      {
        excelRow: layout.headerRowIndex + 1,
        col: present.anchor,
        value: { kind: 'text', value: rewritten },
      },
    ],
    { sheet: format.sheet },
  );
  // The rewritten file still resolves, its present period now tagged `days`.
  const reread = resolveLayout(
    format.layout,
    await readWorkbookGrid(file, { sheet: format.sheet }),
  );
  if (reread === null) throw new Error('the rewritten commission fixture does not resolve');
  expect(blocksOf(format.layout, reread, 'periods').map((block) => block.tag)).toContain(days);
  return file;
}

describe('POST .../commission-tariffs/import - a period of 0 days', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('answers 422 MALFORMED_SHEET on file for a "(0 days)" period header and stores nothing', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const file = await withPresentPeriodDays(0);

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    expect(await prisma.commissionTariff.count({ where: scope })).toBe(0);
  });
});

// The 3-day block before the fixture's 4-day period, which the fixture leaves blank:
// filled on the first row, the upload holds two periods of one 7-day week.
const FIRST_PERIOD_LABEL = '23 Haziran 08.00-26 Haziran 07.59';
const FIRST_PERIOD_COMMS = [
  ['comm1', '19'],
  ['comm2', '13.1'],
  ['comm3', '12.1'],
  ['comm4', '10.6'],
] as const;

const ImportCountsSchema = z.object({
  productCount: z.number(),
  periodCount: z.number(),
  itemCount: z.number(),
  unknownCurrentPriceRows: z.number(),
  unknownCommissionRows: z.number(),
});

/** The patches that fill the blank 3-day block of `firstRow`, so the upload holds two periods. */
function fillFirstPeriodPatches(
  layout: ResolvedLayout,
  firstRow: CellRow,
): Omit<CellPatch, 'excelRow'>[] {
  const spec = trendyolCommissionTariffFormat.layout;
  const block = blocksOf(spec, layout, 'periods')[0];
  if (block === undefined) throw new Error('no first period block');
  const label = blockColumn(spec, 'periods', block, 'label');
  expect(cellText(firstRow, label)).toBeNull();
  const patches: Omit<CellPatch, 'excelRow'>[] = [
    { col: label, value: { kind: 'text', value: FIRST_PERIOD_LABEL } },
  ];
  for (const [key, value] of FIRST_PERIOD_COMMS) {
    patches.push({
      col: blockColumn(spec, 'periods', block, key),
      value: { kind: 'number', value },
    });
  }
  return patches;
}

interface FirstRowEdits {
  /** Blank band 1's lower limit too: band 1 has no upper limit, so it has neither. */
  readonly blankBand1Lower?: boolean;
  /** Blank the commission base price too, so the row has no known price at all. */
  readonly blankCommissionBasePrice?: boolean;
  /** Fill the blank 3-day period block, so the upload holds two periods. */
  readonly fillFirstPeriod?: boolean;
}

/**
 * The fixture with the current price of its first kept row blanked, and `edits` written
 * over the same row, with that row's barcode.
 */
async function withBlankFirstCurrentPrice(
  edits: FirstRowEdits = {},
): Promise<{ readonly file: Buffer; readonly barcode: string }> {
  const format = trendyolCommissionTariffFormat;
  const grid = await readWorkbookGrid(FIXTURE, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable commission fixture');
  const firstRow = grid[FIRST_KEPT_ROW - 1] ?? [];
  const barcode = cellText(firstRow, columnIndex(format.layout, layout, 'barcode'));
  if (barcode === null) throw new Error('the first kept row has no barcode');
  const column = (key: 'currentPrice' | 'band1Lower' | 'commissionBasePrice'): number => {
    const col = columnIndex(format.layout, layout, key);
    if (col === null) throw new Error(`the fixture has no ${key} column`);
    return col;
  };
  // The fixture row holds a readable current price, so blanking it is the change.
  expect(cellText(firstRow, column('currentPrice'))).not.toBeNull();

  const patches: Omit<CellPatch, 'excelRow'>[] = [
    { col: column('currentPrice'), value: { kind: 'clear' } },
  ];
  if (edits.blankBand1Lower === true) {
    expect(cellText(firstRow, column('band1Lower'))).not.toBeNull();
    patches.push({ col: column('band1Lower'), value: { kind: 'clear' } });
  }
  if (edits.blankCommissionBasePrice === true) {
    expect(cellText(firstRow, column('commissionBasePrice'))).not.toBeNull();
    patches.push({ col: column('commissionBasePrice'), value: { kind: 'clear' } });
  }
  if (edits.fillFirstPeriod === true) {
    patches.push(...fillFirstPeriodPatches(layout, firstRow));
  }
  const file = patchFixture(
    FIXTURE,
    patches.map((patch) => ({ ...patch, excelRow: FIRST_KEPT_ROW })),
    { sheet: format.sheet },
  );
  return { file, barcode };
}

describe('POST .../commission-tariffs/import - an unknown current price', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('stores a row with a blank current price with current_price NULL in every period', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const { file, barcode } = await withBlankFirstCurrentPrice({ fillFirstPeriod: true });

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(201);
    const body = ImportCountsSchema.parse(await res.json());
    expect(body.periodCount).toBe(2);
    // The row's commission base price is still known and prices its current profit, so
    // the row is not counted as one with no known price.
    expect(body.unknownCurrentPriceRows).toBe(0);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const items = await prisma.commissionTariffItem.findMany({
      where: { ...scope, barcode },
      select: { periodId: true, currentPrice: true },
    });
    // One item per period, each with an unknown current price, never 0.
    expect(new Set(items.map((item) => item.periodId)).size).toBe(2);
    expect(items.map((item) => item.currentPrice)).toEqual([null, null]);
    // Only that row lost its price: every other row keeps the file's price.
    expect(await prisma.commissionTariffItem.count({ where: scope })).toBe(body.productCount * 2);
    expect(
      await prisma.commissionTariffItem.count({ where: { ...scope, currentPrice: null } }),
    ).toBe(2);
  });

  it('imports a file where one row has a blank current price and a band with neither limit', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const { file, barcode } = await withBlankFirstCurrentPrice({ blankBand1Lower: true });

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(201);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const item = await prisma.commissionTariffItem.findFirst({
      where: { ...scope, barcode },
      select: { currentPrice: true, bands: true },
    });
    expect(item?.currentPrice).toBeNull();
    // Band 1 is stored with neither limit: it has no price until a price is known.
    const band1 = parseStoredTariffBands(item?.bands ?? null).find((band) => band.key === 'band1');
    expect(band1).toMatchObject({ lowerLimit: null, upperLimit: null, commissionPct: '19' });
    const other = await prisma.commissionTariffItem.findFirst({
      where: { ...scope, NOT: { barcode } },
      select: { currentPrice: true },
    });
    expect(other?.currentPrice).not.toBeNull();
  });

  it('counts each product row with an unknown current price once, whatever the number of periods', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const { file, barcode } = await withBlankFirstCurrentPrice({
      blankCommissionBasePrice: true,
      fillFirstPeriod: true,
    });

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(201);
    const body = ImportCountsSchema.parse(await res.json());
    expect(body.periodCount).toBe(2);
    expect(body.itemCount).toBe(body.productCount * 2);
    // The row with neither a current price nor a commission base price is stored once per
    // period, and counted once.
    const items = await prisma.commissionTariffItem.findMany({
      where: { organizationId: ctx.orgId, storeId: ctx.storeId, barcode },
      select: { currentPrice: true, commissionBasePrice: true },
    });
    expect(items).toEqual([
      { currentPrice: null, commissionBasePrice: null },
      { currentPrice: null, commissionBasePrice: null },
    ]);
    expect(body.unknownCurrentPriceRows).toBe(1);
  });
});

/**
 * The fixture with the current commission of its first kept row blanked and its blank
 * 3-day block filled (two periods), with that row's barcode.
 */
async function withBlankFirstCurrentCommission(): Promise<{
  readonly file: Buffer;
  readonly barcode: string;
}> {
  const format = trendyolCommissionTariffFormat;
  const grid = await readWorkbookGrid(FIXTURE, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable commission fixture');
  const firstRow = grid[FIRST_KEPT_ROW - 1] ?? [];
  const barcode = cellText(firstRow, columnIndex(format.layout, layout, 'barcode'));
  if (barcode === null) throw new Error('the first kept row has no barcode');
  const commission = columnIndex(format.layout, layout, 'currentCommission');
  if (commission === null) throw new Error('the fixture has no current commission column');
  // The fixture row holds a readable current commission, so blanking it is the change.
  expect(cellText(firstRow, commission)).not.toBeNull();

  const patches: Omit<CellPatch, 'excelRow'>[] = [
    { col: commission, value: { kind: 'clear' } },
    ...fillFirstPeriodPatches(layout, firstRow),
  ];
  const file = patchFixture(
    FIXTURE,
    patches.map((patch) => ({ ...patch, excelRow: FIRST_KEPT_ROW })),
    { sheet: format.sheet },
  );
  return { file, barcode };
}

describe('POST .../commission-tariffs/import - an unknown current commission', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('stores a row with a blank current commission with current_commission_pct NULL in every period', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const { file, barcode } = await withBlankFirstCurrentCommission();

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(201);
    const body = ImportCountsSchema.parse(await res.json());
    expect(body.periodCount).toBe(2);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const items = await prisma.commissionTariffItem.findMany({
      where: { ...scope, barcode },
      select: { periodId: true, currentCommissionPct: true, currentPrice: true },
    });
    // One item per period, each with an unknown current commission, never 0; the row's
    // current price is still known.
    expect(new Set(items.map((item) => item.periodId)).size).toBe(2);
    expect(items.map((item) => item.currentCommissionPct)).toEqual([null, null]);
    expect(items.every((item) => item.currentPrice !== null)).toBe(true);
    // Only that row lost its commission: every other row keeps the file's percent.
    expect(await prisma.commissionTariffItem.count({ where: scope })).toBe(body.productCount * 2);
    expect(
      await prisma.commissionTariffItem.count({ where: { ...scope, currentCommissionPct: null } }),
    ).toBe(2);
  });

  it('counts a row with a blank current commission once in unknownCommissionRows, whatever the number of periods', async () => {
    await truncateAll();
    const ctx = await setupStoreWithMatch();
    const { file } = await withBlankFirstCurrentCommission();

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(201);
    const body = ImportCountsSchema.parse(await res.json());
    // The row is stored once per period, and counted once; its prices are known, so it
    // is not counted as a row with no known price.
    expect(body.periodCount).toBe(2);
    expect(body.unknownCommissionRows).toBe(1);
    expect(body.unknownCurrentPriceRows).toBe(0);
  });
});
