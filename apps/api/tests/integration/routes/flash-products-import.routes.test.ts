// Round-trip integration test for POST .../flash-products/import using the real
// Trendyol "Flaş Ürünler" export as a fixture.
//
// Proves the whole import chain on the actual vendor sheet (sheet `TeklifÜrünleri`):
// Title-Case header-name column mapping, per-row 24h/3h offer detection, the
// `dd/MM/yyyy HH:mm` window parse (business-timezone), barcode → variant matching,
// and persistence — including the feature's novelty that the SAME product spans
// several rows (different dates) and each row is its own item. The real fixture
// carries only 24h offers, so the 3h + both-offer + skip scenarios are derived from
// it via `patchFixture` (the engine's test-only run of the export patch path).

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  readWorkbookGrid,
  resolveLayout,
  type CellPatch,
  type CellPatchValue,
  type SheetSelector,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import { createApp } from '@/app';
import { trendyolFlashProductListFormat } from '@/workbooks/formats/trendyol/flash-product-list.format';
import { missingExportRequirement, resolveWriteColumns } from '@/workbooks/write-columns';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

const app = createApp();

const FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-flash-products.xlsx', import.meta.url),
);

// Facts of the real fixture (verified from the file): 122 data rows, 34 distinct
// barcodes, every row carries a 24h offer and NO 3h offer. The first data row is
// ATA100X150R (24h price 179.47, window 08/07/2026 00:00 → 23:59, "Var"), and that
// product recurs on rows 2/4/6/8 (Excel 1-based).
const TOTAL_ROWS = 122;
const DISTINCT_PRODUCTS = 34;
const MATCHED_BARCODE = 'ATA100X150R';
const MATCHED_ROW_COUNT = 4;

// 0-based grid columns (Title-Case header layout).
const COL_CURRENT_COMMISSION = 8;
const COL_OFFER_24_PRICE = 10;
const COL_OFFER_3_PRICE = 11;
const COL_OFFER_3_START = 15;
const COL_OFFER_3_END = 16;

// The fixture holds a single sheet; the fixture patcher selects it strictly by position.
const FIRST_SHEET: SheetSelector = { by: 'index', index: 0 };

interface ImportWire {
  listId: string;
  name: string;
  productCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
  unknownCommissionRows: number;
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setupStore(withMatch: boolean): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  if (withMatch) {
    const product = await createProduct(org.id, store.id);
    await createProductVariant(org.id, store.id, product.id, { barcode: MATCHED_BARCODE });
  }
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

function importRequest(ctx: Ctx, file: Buffer): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), 'trendyol_flas_urunler.xlsx');
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/flash-products/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

async function importFile(ctx: Ctx, file: Buffer): Promise<ImportWire> {
  const res = await app.request(importRequest(ctx, file));
  expect(res.status).toBe(201);
  return (await res.json()) as ImportWire;
}

/** Builds a one-row cell patch for the byte-preserving fixture manipulation. */
function rowPatch(excelRow: number, cells: [number, CellPatchValue][]): CellPatch[] {
  return cells.map(([col, value]) => ({ excelRow, col, value }));
}

describe('POST .../flash-products/import - real Trendyol fixture', () => {
  let ctx: Ctx;
  let imported: ImportWire;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    ctx = await setupStore(true);
    imported = await importFile(ctx, FIXTURE);
  });

  it('imports every offer row and matches only the catalog barcode', () => {
    expect(imported.itemCount).toBe(TOTAL_ROWS);
    expect(imported.productCount).toBe(DISTINCT_PRODUCTS);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(DISTINCT_PRODUCTS - 1);
    // The real fixture has a 24h offer on every row, so nothing is skipped.
    expect(imported.skippedRows).toBe(0);
    expect(imported.name).not.toBe('');
  });

  it('answers unknownCommissionRows 0 for a file whose percents all read', async () => {
    expect(imported.unknownCommissionRows).toBe(0);
    // Every stored item of the real file carries a current commission.
    expect(
      await prisma.flashProductItem.count({
        where: { organizationId: ctx.orgId, storeId: ctx.storeId, currentCommissionPct: null },
      }),
    ).toBe(0);
  });

  it('persists a list (with the raw file) and one item per row', async () => {
    const list = await prisma.flashProductList.findUnique({
      where: { id: imported.listId },
      select: { storeId: true, sourceFile: true },
    });
    expect(list?.storeId).toBe(ctx.storeId);
    expect(list?.sourceFile).not.toBeNull();

    const itemCount = await prisma.flashProductItem.count({ where: { listId: imported.listId } });
    expect(itemCount).toBe(imported.itemCount);
  });

  it('parses the 24h offer price and window of the first row', async () => {
    const items = await prisma.flashProductItem.findMany({
      where: { listId: imported.listId },
      orderBy: { sortOrder: 'asc' },
    });
    const first = items[0];
    expect(first?.barcode).toBe(MATCHED_BARCODE);
    expect(Number(first?.offer24Price)).toBe(179.47);
    // "08/07/2026 00:00" → "23:59" Istanbul wall clock parsed to the true instant.
    expect(first?.offer24StartsAt?.getTime()).toBe(
      businessZoneEpochToInstant(Date.UTC(2026, 6, 8, 0, 0)).getTime(),
    );
    expect(first?.offer24EndsAt?.getTime()).toBe(
      businessZoneEpochToInstant(Date.UTC(2026, 6, 8, 23, 59)).getTime(),
    );
    // No 3h offer in the real fixture.
    expect(first?.offer3Price).toBeNull();
    expect(first?.offer3StartsAt).toBeNull();
  });

  it('maps "Var" to hasCommissionTariff, keeps the current commission + campaigned flag, and matches the variant', async () => {
    const first = await prisma.flashProductItem.findFirst({
      where: { listId: imported.listId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(first?.hasCommissionTariff).toBe(true);
    expect(Number(first?.currentCommissionPct)).toBe(19);
    expect(first?.campaignedProduct).toBe('-');
    expect(first?.productVariantId).not.toBeNull();
  });

  it('keeps each date of the same product as a separate item with sequential sortOrder', async () => {
    const items = await prisma.flashProductItem.findMany({
      where: { listId: imported.listId },
      orderBy: { sortOrder: 'asc' },
    });
    // sortOrder mirrors the Excel row order, contiguously 0..N-1.
    expect(items.map((i) => i.sortOrder)).toEqual([...Array(TOTAL_ROWS).keys()]);

    const recurring = items.filter((i) => i.barcode === MATCHED_BARCODE);
    expect(recurring).toHaveLength(MATCHED_ROW_COUNT);
    // Distinct rows → distinct items (distinct sortOrder), not deduplicated.
    expect(new Set(recurring.map((i) => i.sortOrder)).size).toBe(MATCHED_ROW_COUNT);
  });
});

describe('POST .../flash-products/import - derived offer scenarios', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('parses a 3h offer (price + window) alongside the 24h offer on the same row', async () => {
    const ctx = await setupStore(false);
    // Add a 3h offer to the first data row (Excel row 2): price + window dates.
    const patched = patchFixture(
      FIXTURE,
      rowPatch(2, [
        [COL_OFFER_3_PRICE, { kind: 'number', value: '99.90' }],
        [COL_OFFER_3_START, { kind: 'text', value: '08/07/2026 09:00' }],
        [COL_OFFER_3_END, { kind: 'text', value: '08/07/2026 12:00' }],
      ]),
      { sheet: FIRST_SHEET },
    );
    const result = await importFile(ctx, patched);
    expect(result.itemCount).toBe(TOTAL_ROWS);

    const first = await prisma.flashProductItem.findFirst({
      where: { listId: result.listId },
      orderBy: { sortOrder: 'asc' },
    });
    // Both offers now present on the one row.
    expect(Number(first?.offer24Price)).toBe(179.47);
    expect(Number(first?.offer3Price)).toBe(99.9);
    expect(first?.offer3StartsAt?.getTime()).toBe(
      businessZoneEpochToInstant(Date.UTC(2026, 6, 8, 9, 0)).getTime(),
    );
    expect(first?.offer3EndsAt?.getTime()).toBe(
      businessZoneEpochToInstant(Date.UTC(2026, 6, 8, 12, 0)).getTime(),
    );
  });

  it('skips a row whose 24h and 3h offers are both empty', async () => {
    const ctx = await setupStore(false);
    // Blank the first row's 24h price; it has no 3h offer → the row is skipped.
    const patched = patchFixture(
      FIXTURE,
      rowPatch(2, [[COL_OFFER_24_PRICE, { kind: 'text', value: '' }]]),
      { sheet: FIRST_SHEET },
    );
    const result = await importFile(ctx, patched);
    expect(result.skippedRows).toBe(1);
    expect(result.itemCount).toBe(TOTAL_ROWS - 1);
    // The skipped row's product recurs elsewhere, so the distinct-product count holds.
    expect(result.productCount).toBe(DISTINCT_PRODUCTS);
  });
});

describe('POST .../flash-products/import - an unknown current commission', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('stores a row with a blank current commission with current_commission_pct NULL', async () => {
    const ctx = await setupStore(true);
    // Blank the first data row's current commission (Excel row 2, ATA100X150R).
    const patched = patchFixture(
      FIXTURE,
      rowPatch(2, [[COL_CURRENT_COMMISSION, { kind: 'clear' }]]),
      { sheet: FIRST_SHEET },
    );
    const result = await importFile(ctx, patched);
    // The row is still kept: an unknown commission does not drop it.
    expect(result.itemCount).toBe(TOTAL_ROWS);
    expect(result.skippedRows).toBe(0);

    const items = await prisma.flashProductItem.findMany({
      where: { organizationId: ctx.orgId, storeId: ctx.storeId, listId: result.listId },
      orderBy: { sortOrder: 'asc' },
      select: { barcode: true, currentCommissionPct: true },
    });
    const first = items[0];
    expect(first?.barcode).toBe(MATCHED_BARCODE);
    // Unknown, never 0.
    expect(first?.currentCommissionPct).toBeNull();
    // Only that row lost its commission: the same product's other dates keep the file's
    // percent, and every other row is known.
    const others = items.filter((item, index) => index > 0 && item.barcode === MATCHED_BARCODE);
    expect(others).toHaveLength(MATCHED_ROW_COUNT - 1);
    expect(others.map((item) => Number(item.currentCommissionPct))).toEqual([19, 19, 19]);
    expect(items.filter((item) => item.currentCommissionPct === null)).toHaveLength(1);
  });

  it('counts a product with a blank current commission on two date rows once in unknownCommissionRows', async () => {
    const ctx = await setupStore(true);
    // Blank the current commission of two dates of one product (Excel rows 2 and 4).
    const patched = patchFixture(
      FIXTURE,
      [
        ...rowPatch(2, [[COL_CURRENT_COMMISSION, { kind: 'clear' }]]),
        ...rowPatch(4, [[COL_CURRENT_COMMISSION, { kind: 'clear' }]]),
      ],
      { sheet: FIRST_SHEET },
    );
    const result = await importFile(ctx, patched);

    // Both rows are stored with an unknown commission, and both belong to one product.
    const unknown = await prisma.flashProductItem.findMany({
      where: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        listId: result.listId,
        currentCommissionPct: null,
      },
      select: { barcode: true },
    });
    expect(unknown.map((item) => item.barcode)).toEqual([MATCHED_BARCODE, MATCHED_BARCODE]);
    expect(result.unknownCommissionRows).toBe(1);
  });
});

// The header written over a write column: a text the layout does not know.
const REMOVED_HEADER = 'Removed column';

// Strict issues: a `meta` on the file issue would fail the parse.
const ProblemSchema = z.object({
  status: z.number(),
  code: z.string(),
  errors: z.array(z.strictObject({ field: z.string(), code: z.string() })),
});

/**
 * Patches that overwrite the header of every write column the Flash export requires (the
 * updated price label). The columns are found through the format's write keys, so no
 * header text is typed.
 */
async function requiredWriteHeaderPatches(): Promise<CellPatch[]> {
  const format = trendyolFlashProductListFormat;
  const grid = await readWorkbookGrid(FIXTURE, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable Flash fixture');
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

/** True when `file` still reads as a Flash file but has no column its export requires. */
async function missesExportColumn(file: Buffer): Promise<boolean> {
  const format = trendyolFlashProductListFormat;
  const grid = await readWorkbookGrid(file, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the patched Flash fixture no longer resolves');
  return missingExportRequirement(format, resolveWriteColumns(format, layout));
}

describe('POST .../flash-products/import - a file with no column to write selections into', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('answers 422 NO_WRITEBACK_COLUMN on file and stores nothing', async () => {
    const ctx = await setupStore(false);
    const file = patchFixture(FIXTURE, await requiredWriteHeaderPatches(), { sheet: FIRST_SHEET });
    // The file still reads as a Flash file: only its write column is gone.
    expect(await missesExportColumn(file)).toBe(true);

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'NO_WRITEBACK_COLUMN' }]);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    expect(await prisma.flashProductList.count({ where: scope })).toBe(0);
  });

  it('imports the untouched fixture', async () => {
    const ctx = await setupStore(false);
    const file = patchFixture(FIXTURE, [], { sheet: FIRST_SHEET });
    expect(await missesExportColumn(file)).toBe(false);

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(201);
  });
});
