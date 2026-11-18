// The generic workbook import through the discount route, its first consumer:
//   - the stored format id, the stored file name rule and the typed name rule;
//   - a write-back column a seller made unwritable (a shared formula, an array formula,
//     a merged range) is refused at upload with 422 MALFORMED_SHEET, not at the first
//     export, and nothing is stored;
//   - the store's list quota counts this store only, and refuses before the file is read;
//   - one import of a store and page at a time, whatever the letter case of the ids in
//     the path (the lock key is the stored store id);
//   - a Hepsiburada store has no discount format;
//   - a text cell holding U+0000, which Postgres cannot store, is refused at upload
//     with 422 MALFORMED_SHEET, never a 500, and nothing is stored;
//   - active content (a macro project part, a WEBSERVICE formula) is refused at upload
//     with 422 UNSAFE_CONTENT, and nothing is stored.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';
import {
  cellText,
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  UNSAFE_CONTENT_REASONS,
  type CellValue,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { buildXlsxFixture } from '@pazarsync/spreadsheet/testing';
import { UPLOAD_NAME_MAX_LENGTH, WORKBOOK_PAGES } from '@pazarsync/utils';

import { createApp } from '@/app';
import { MAX_LISTS_PER_STORE_PAGE } from '@/config/workbook-limits';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import { trendyolDiscountListFormat } from '@/workbooks/formats/trendyol/discount-list.format';
import { TRENDYOL_DEFAULT_NAMES, TRENDYOL_SHEET_NAMES } from '@/workbooks/formats/trendyol/labels';
import { NUL_CHARACTER_REASON } from '@/workbooks/import-rows';
import { importLockKey, WORKBOOK_IMPORT_LOCK_SEED } from '@/workbooks/upload-quota';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import {
  macroFixture,
  rezippedFixture,
  unsafeFormulaFixture,
} from '../../helpers/workbook-unsafe-fixtures';

const app = createApp();

const FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-discount-products.xlsx', import.meta.url),
);
const DISCOUNT_FORMAT_ID = 'TRENDYOL:DISCOUNT_LIST:v1';

// Another page's real file, for the quota pre-check.
const FLASH_FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-flash-products.xlsx', import.meta.url),
);

const NET_CONFIG = {
  discountType: 'NET',
  valueKind: 'AMOUNT',
  value: '50',
  startsAt: '2026-07-21T05:00:00.000Z',
  endsAt: '2026-07-28T04:59:00.000Z',
} as const;

// 0-based column of "Kampayaya Dahil Edilsin Mi?" in the real header (column I).
const INCLUDED_COL = 8;
const COLUMN_LETTERS = 'ABCDEFGHI';

// The holder transaction outlives the request's two engine jobs; Prisma's default 5 s
// could release the lock while the request is still running.
const LOCK_HOLDER_TIMEOUT_MS = 60_000;

const RLO = String.fromCodePoint(0x202e);

const ProblemSchema = z.object({
  code: z.string(),
  errors: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

// The whole body of a 422, field issues as sent (meta included), for a strict pin.
const RawValidationSchema = z.object({ code: z.string(), errors: z.array(z.unknown()) });

const ImportSchema = z.object({ listId: z.string(), name: z.string(), itemCount: z.number() });

const GrantedSchema = z.array(z.object({ granted: z.number() }));

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setupStore(platform: 'TRENDYOL' | 'HEPSIBURADA' = 'TRENDYOL'): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id, { platform });
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

function importRequest(
  ctx: Ctx,
  file: Buffer,
  filename = 'trendyol_indirimler.xlsx',
  path: { orgId: string; storeId: string } = ctx,
  typedName?: string,
): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), filename);
  for (const [key, value] of Object.entries(NET_CONFIG)) form.append(key, value);
  if (typedName !== undefined) form.append('name', typedName);
  return new Request(
    `http://local/v1/organizations/${path.orgId}/stores/${path.storeId}/discount-lists/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

async function problem(res: Response): Promise<z.infer<typeof ProblemSchema>> {
  return ProblemSchema.parse(await res.json());
}

// Hand-built discount sheets with an unwritable participation column.

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellXml(col: number, excelRow: number, value: CellValue): string {
  const ref = `${COLUMN_LETTERS.charAt(col)}${excelRow}`;
  if (value === null) return '';
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
}

/**
 * The real fixture's header and first two data rows as a worksheet, with the
 * participation cell of each data row replaced by `included(excelRow)` and `tail`
 * written after the sheet data.
 */
function discountSheet(grid: SheetData, included: (excelRow: number) => string, tail = ''): Buffer {
  const rows = grid.slice(0, 3).map((cells, index) => {
    const excelRow = index + 1;
    const body = cells
      .map((value, col) =>
        col === INCLUDED_COL && excelRow > 1 ? included(excelRow) : cellXml(col, excelRow, value),
      )
      .join('');
    return `<row r="${excelRow}">${body}</row>`;
  });
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rows.join('')}</sheetData>${tail}</worksheet>`;
  return buildXlsxFixture([{ name: TRENDYOL_SHEET_NAMES.DISCOUNT_LIST, xml }]);
}

// A text cell holding U+0000, edited into the real fixture's bytes.

const NUL = String.fromCodePoint(0);
// U+0000 as the character reference a worksheet carries; the engine reads it as text.
const NUL_REFERENCE = '&#0;';
// The fixture's one worksheet part.
const DISCOUNT_SHEET_PART = 'xl/worksheets/sheet1.xml';

/**
 * The real fixture with one cell of its first data row (a shared string there) turned
 * into an inline string: the cell's own text followed by U+0000. Only that cell's XML
 * changes; every other entry keeps its bytes.
 */
function withNulInFirstDataRow(grid: SheetData, key: 'barcode' | 'productTitle'): Buffer {
  const format = trendyolDiscountListFormat;
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('unreadable discount fixture');
  const col = columnIndex(format.layout, layout, key);
  if (col === null) throw new Error(`the fixture has no ${key} column`);
  const excelRow = layout.headerRowIndex + 2;
  const original = cellText(grid[excelRow - 1] ?? [], col);
  if (original === null) throw new Error(`the first data row has no ${key}`);
  const ref = `${COLUMN_LETTERS.charAt(col)}${excelRow}`;

  const entries = unzipSync(new Uint8Array(FIXTURE));
  const part = entries[DISCOUNT_SHEET_PART];
  if (part === undefined) throw new Error('the fixture has no discount worksheet part');
  const xml = strFromU8(part);
  const cell = new RegExp(`<c r="${ref}"[^>]*>.*?</c>`);
  const edited = xml.replace(
    cell,
    `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(original)}${NUL_REFERENCE}</t></is></c>`,
  );
  if (edited === xml) throw new Error(`the fixture has no cell ${ref}`);
  entries[DISCOUNT_SHEET_PART] = strToU8(edited);
  return Buffer.from(zipSync(entries));
}

// The import lock, held by another transaction.

/** Asserts THIS lock is granted in this database (pg_locks is cluster-wide). */
async function expectLockGranted(key: string): Promise<void> {
  const rows = GrantedSchema.parse(
    await prisma.$queryRaw`
      WITH "h" AS (SELECT hashtextextended(${key}, ${WORKBOOK_IMPORT_LOCK_SEED}::int8) AS "v")
      SELECT count(*)::int AS "granted"
      FROM pg_locks, "h"
      WHERE locktype = 'advisory'
        AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid::bigint = (("h"."v" >> 32) & 4294967295)
        AND objid::bigint = ("h"."v" & 4294967295)
        AND objsubid = 1`,
  );
  expect(rows).toEqual([{ granted: 1 }]);
}

/** Runs `during` while another transaction holds the import lock of `key`. */
async function withImportLockHeld<T>(key: string, during: () => T | Promise<T>): Promise<T> {
  let signalLocked: () => void = () => undefined;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${WORKBOOK_IMPORT_LOCK_SEED}::int8))`;
      signalLocked();
      await released;
    },
    { timeout: LOCK_HOLDER_TIMEOUT_MS },
  );
  try {
    await Promise.race([
      locked,
      holder.then(() => {
        throw new Error('The lock holder ended before it took the lock');
      }),
    ]);
    await expectLockGranted(key);
    return await during();
  } finally {
    release();
    await holder;
  }
}

beforeEach(() => {
  _resetRateLimitStoreForTests();
});

describe('generic workbook import on the discount route', () => {
  let realGrid: SheetData;

  beforeAll(async () => {
    await ensureDbReachable();
    realGrid = await readWorkbookGrid(FIXTURE, { sheet: { by: 'index', index: 0 } });
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('imports the real file and stores its format id', async () => {
    const ctx = await setupStore();

    const res = await app.request(importRequest(ctx, FIXTURE));

    expect(res.status).toBe(201);
    const { listId } = ImportSchema.parse(await res.json());
    const list = await prisma.discountList.findFirst({
      where: { id: listId, organizationId: ctx.orgId, storeId: ctx.storeId },
      select: { sourceFormatId: true, sourceFilename: true },
    });
    expect(list).toEqual({
      sourceFormatId: DISCOUNT_FORMAT_ID,
      sourceFilename: 'trendyol_indirimler.xlsx',
    });
  });

  it('stores a clean file name of at most 120 characters', async () => {
    const ctx = await setupStore();
    const filename = `${'a'.repeat(150)}${RLO}${'b'.repeat(150)}.xlsx`;

    const res = await app.request(importRequest(ctx, FIXTURE, filename));

    expect(res.status).toBe(201);
    const { listId, name } = ImportSchema.parse(await res.json());
    const list = await prisma.discountList.findFirst({
      where: { id: listId, organizationId: ctx.orgId, storeId: ctx.storeId },
      select: { sourceFilename: true, name: true },
    });
    const stored = list?.sourceFilename ?? '';
    expect(Array.from(stored)).toHaveLength(UPLOAD_NAME_MAX_LENGTH);
    expect(stored.endsWith('.xlsx')).toBe(true);
    expect(stored.includes(RLO)).toBe(false);
    expect(list?.name).toBe(name);
    expect(name.includes(RLO)).toBe(false);
    expect(Array.from(name).length).toBeLessThanOrEqual(UPLOAD_NAME_MAX_LENGTH);
  });

  it('stores no file name for a name that is not .xlsx, and names the list by default', async () => {
    const ctx = await setupStore();

    const res = await app.request(importRequest(ctx, FIXTURE, 'data.bin'));

    expect(res.status).toBe(201);
    const { listId, name } = ImportSchema.parse(await res.json());
    expect(name).toBe(TRENDYOL_DEFAULT_NAMES.DISCOUNT_LIST);
    const list = await prisma.discountList.findFirst({
      where: { id: listId, organizationId: ctx.orgId, storeId: ctx.storeId },
      select: { sourceFilename: true, name: true },
    });
    expect(list).toEqual({ sourceFilename: null, name: TRENDYOL_DEFAULT_NAMES.DISCOUNT_LIST });
  });

  it('refuses a typed name above 120 characters with 422 NAME_TOO_LONG, and stores nothing', async () => {
    const ctx = await setupStore();
    const typedName = 'n'.repeat(UPLOAD_NAME_MAX_LENGTH + 1);

    const res = await app.request(importRequest(ctx, FIXTURE, undefined, ctx, typedName));

    expect(res.status).toBe(422);
    const body = RawValidationSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toStrictEqual([
      { field: 'name', code: 'NAME_TOO_LONG', meta: { zodCode: 'too_big' } },
    ]);
    expect(await prisma.discountList.count()).toBe(0);
  });

  it('refuses a typed name holding a bidi override with 422 NAME_INVALID_CHARACTERS', async () => {
    const ctx = await setupStore();

    const res = await app.request(importRequest(ctx, FIXTURE, undefined, ctx, `Liste ${RLO}1`));

    expect(res.status).toBe(422);
    const body = RawValidationSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toStrictEqual([
      { field: 'name', code: 'NAME_INVALID_CHARACTERS', meta: { zodCode: 'invalid_format' } },
    ]);
    expect(await prisma.discountList.count()).toBe(0);
  });

  it('imports a typed name of exactly 120 characters and stores it unchanged', async () => {
    const ctx = await setupStore();
    const typedName = 'n'.repeat(UPLOAD_NAME_MAX_LENGTH);

    const res = await app.request(importRequest(ctx, FIXTURE, undefined, ctx, typedName));

    expect(res.status).toBe(201);
    const { listId, name } = ImportSchema.parse(await res.json());
    expect(name).toBe(typedName);
    const list = await prisma.discountList.findFirst({
      where: { id: listId, organizationId: ctx.orgId, storeId: ctx.storeId },
      select: { name: true },
    });
    expect(list).toEqual({ name: typedName });
  });

  describe('refuses a participation column the export could not write, and stores nothing', () => {
    const CASES = [
      {
        name: 'a shared formula',
        sheet: (grid: SheetData) =>
          discountSheet(grid, (excelRow) =>
            excelRow === 2
              ? '<c r="I2" t="str"><f t="shared" ref="I2:I3" si="0">H2</f><v>Kaybeden</v></c>'
              : `<c r="I${excelRow}" t="str"><f t="shared" si="0"/><v>Kaybeden</v></c>`,
          ),
      },
      {
        name: 'an array formula',
        sheet: (grid: SheetData) =>
          discountSheet(grid, (excelRow) =>
            excelRow === 2
              ? '<c r="I2" t="str"><f t="array" ref="I2:I3">H2:H3</f><v>Kaybeden</v></c>'
              : `<c r="I${excelRow}" t="str"><v>Kaybeden</v></c>`,
          ),
      },
      {
        name: 'a merged range',
        sheet: (grid: SheetData) =>
          discountSheet(
            grid,
            (excelRow) => cellXml(INCLUDED_COL, excelRow, excelRow === 2 ? 'Kaybeden' : null),
            '<mergeCells count="1"><mergeCell ref="I2:I3"/></mergeCells>',
          ),
      },
    ] as const;

    it.each(CASES)('$name over the column: 422 MALFORMED_SHEET', async ({ sheet }) => {
      const ctx = await setupStore();

      const res = await app.request(importRequest(ctx, sheet(realGrid)));

      expect(res.status).toBe(422);
      const body = await problem(res);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
      expect(await prisma.discountList.count()).toBe(0);
    });

    it('imports the same hand-built sheet with plain participation cells (control)', async () => {
      const ctx = await setupStore();
      const plain = discountSheet(realGrid, (excelRow) =>
        cellXml(INCLUDED_COL, excelRow, 'Kaybeden'),
      );

      const res = await app.request(importRequest(ctx, plain));

      expect(res.status).toBe(201);
      expect(ImportSchema.parse(await res.json()).itemCount).toBe(2);
    });
  });

  it('refuses the list after the per-store limit with 409 UPLOAD_QUOTA_EXCEEDED', async () => {
    const ctx = await setupStore();
    await prisma.discountList.createMany({
      data: Array.from({ length: MAX_LISTS_PER_STORE_PAGE }, (_, i) => ({
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: `Seeded list ${i + 1}`,
        discountType: 'NET',
      })),
    });

    const res = await app.request(importRequest(ctx, FIXTURE));

    expect(res.status).toBe(409);
    const body = await problem(res);
    expect(body.code).toBe('UPLOAD_QUOTA_EXCEEDED');
    expect(body.meta).toMatchObject({ limit: 'lists', maxLists: MAX_LISTS_PER_STORE_PAGE });
    expect(
      await prisma.discountList.count({
        where: { organizationId: ctx.orgId, storeId: ctx.storeId },
      }),
    ).toBe(MAX_LISTS_PER_STORE_PAGE);
  });

  it('refuses on the list limit before it reads the file', async () => {
    const ctx = await setupStore();
    await prisma.discountList.createMany({
      data: Array.from({ length: MAX_LISTS_PER_STORE_PAGE }, (_, i) => ({
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: `Seeded list ${i + 1}`,
        discountType: 'NET',
      })),
    });

    // Another page's real file: parsed, the discount page would answer 422
    // WRONG_FILE_FOR_PAGE, so a 409 proves the quota answered before the parse.
    const res = await app.request(importRequest(ctx, FLASH_FIXTURE));

    expect(res.status).toBe(409);
    const body = await problem(res);
    expect(body.code).toBe('UPLOAD_QUOTA_EXCEEDED');
    expect(body.meta).toMatchObject({ limit: 'lists', maxLists: MAX_LISTS_PER_STORE_PAGE });
  });

  it("does not count another organization's or a sibling store's lists", async () => {
    const ctx = await setupStore();
    const sibling = await createStore(ctx.orgId);
    const otherOrg = await createOrganization();
    const otherStore = await createStore(otherOrg.id);
    for (const scope of [
      { organizationId: ctx.orgId, storeId: sibling.id },
      { organizationId: otherOrg.id, storeId: otherStore.id },
    ]) {
      await prisma.discountList.createMany({
        data: Array.from({ length: MAX_LISTS_PER_STORE_PAGE }, (_, i) => ({
          ...scope,
          name: `Seeded list ${i + 1}`,
          discountType: 'NET',
        })),
      });
    }

    const res = await app.request(importRequest(ctx, FIXTURE));

    expect(res.status).toBe(201);
  });

  it('refuses a second import of the store and page while another holds the lock', async () => {
    const ctx = await setupStore();
    const key = importLockKey(
      { organizationId: ctx.orgId, storeId: ctx.storeId },
      WORKBOOK_PAGES.DISCOUNT_LIST,
    );

    const res = await withImportLockHeld(key, () => app.request(importRequest(ctx, FIXTURE)));

    expect(res.status).toBe(409);
    const body = await problem(res);
    expect(body.code).toBe('IMPORT_IN_PROGRESS');
    expect(await prisma.discountList.count()).toBe(0);
  });

  it('takes the same lock when the path spells the ids in upper case', async () => {
    const ctx = await setupStore();
    const upper = { orgId: ctx.orgId.toUpperCase(), storeId: ctx.storeId.toUpperCase() };
    const key = importLockKey(
      { organizationId: ctx.orgId, storeId: ctx.storeId },
      WORKBOOK_PAGES.DISCOUNT_LIST,
    );

    const locked = await withImportLockHeld(key, () =>
      app.request(importRequest(ctx, FIXTURE, undefined, upper)),
    );

    expect(locked.status).toBe(409);
    expect((await problem(locked)).code).toBe('IMPORT_IN_PROGRESS');

    const free = await app.request(importRequest(ctx, FIXTURE, undefined, upper));

    expect(free.status).toBe(201);
    const { listId } = ImportSchema.parse(await free.json());
    const list = await prisma.discountList.findFirst({
      where: { id: listId },
      select: { organizationId: true, storeId: true },
    });
    expect(list).toEqual({ organizationId: ctx.orgId, storeId: ctx.storeId });
  });

  describe('refuses a text cell holding U+0000 before anything stores or queries it', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      ['a product name cell', 'productTitle'],
      ['the barcode cell', 'barcode'],
    ] as const)('U+0000 in %s: 422 MALFORMED_SHEET, never a 500', async (_name, key) => {
      const ctx = await setupStore();
      const file = withNulInFirstDataRow(realGrid, key);
      // The engine reads the reference as text: the cell holds U+0000.
      const grid = await readWorkbookGrid(file, { sheet: trendyolDiscountListFormat.sheet });
      const layout = resolveLayout(trendyolDiscountListFormat.layout, grid);
      const col =
        layout === null ? null : columnIndex(trendyolDiscountListFormat.layout, layout, key);
      expect(cellText(grid[1] ?? [], col)?.endsWith(NUL)).toBe(true);
      const info = vi.spyOn(syncLog, 'info');
      const warn = vi.spyOn(syncLog, 'warn');

      const res = await app.request(importRequest(ctx, file));

      expect(res.status).toBe(422);
      const body = await problem(res);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
      expect(await prisma.discountList.count()).toBe(0);
      // readRows refused it, not the database: the persist safety net never ran.
      expect(info).toHaveBeenCalledWith('workbook.upload-rejected', {
        page: WORKBOOK_PAGES.DISCOUNT_LIST,
        code: 'MALFORMED_SHEET',
        reason: NUL_CHARACTER_REASON,
      });
      expect(warn).not.toHaveBeenCalledWith(
        'workbook.import.value-not-storable',
        expect.anything(),
      );
    });
  });

  describe('refuses active content at upload', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      [
        'a macro project part',
        (source: Buffer) => macroFixture(source),
        UNSAFE_CONTENT_REASONS.UNSAFE_PART,
      ],
      [
        'a WEBSERVICE formula',
        (source: Buffer) => unsafeFormulaFixture(source, DISCOUNT_SHEET_PART),
        UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
      ],
    ] as const)('%s: 422 UNSAFE_CONTENT, and nothing is stored', async (_name, build, reason) => {
      const ctx = await setupStore();
      const info = vi.spyOn(syncLog, 'info');

      const res = await app.request(importRequest(ctx, build(FIXTURE)));

      expect(res.status).toBe(422);
      const body = RawValidationSchema.parse(await res.json());
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors).toStrictEqual([{ field: 'file', code: 'UNSAFE_CONTENT' }]);
      expect(await prisma.discountList.count()).toBe(0);
      expect(await prisma.discountListItem.count()).toBe(0);
      expect(info).toHaveBeenCalledWith('workbook.upload-rejected', {
        page: WORKBOOK_PAGES.DISCOUNT_LIST,
        code: 'UNSAFE_CONTENT',
        reason,
      });
    });

    it('imports the fixture rebuilt by the same helper without the addition (control)', async () => {
      const ctx = await setupStore();

      const res = await app.request(importRequest(ctx, rezippedFixture(FIXTURE)));

      expect(res.status).toBe(201);
    });
  });

  it('answers a Hepsiburada store with 422 UNSUPPORTED_PLATFORM_FORMAT', async () => {
    const ctx = await setupStore('HEPSIBURADA');

    const res = await app.request(importRequest(ctx, FIXTURE));

    expect(res.status).toBe(422);
    const body = await problem(res);
    expect(body.errors).toEqual([{ field: 'file', code: 'UNSUPPORTED_PLATFORM_FORMAT' }]);
    expect(await prisma.discountList.count()).toBe(0);
  });
});
