// The generic workbook export through the discount route, its first consumer:
//   - a list stored without a format id is exported through format selection, which
//     reads the stored file once;
//   - nothing an export reads surfaces as a 500: bytes that are not a workbook, a
//     format id no adapter knows, a renamed sheet, a byte after the zip end record and
//     a row that no longer matches its item are each a 409 CONFLICT with a reason, and
//     the list is not marked exported;
//   - a list whose choices match the stored file streams the stored bytes back;
//   - the download carries the hardened headers and never the raw stored name.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import { TRENDYOL_SHEET_NAMES } from '@/workbooks/formats/trendyol/labels';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { webClientFilename } from '../../helpers/web-client-filename';

// The engine itself, with its grid read wrapped in a spy.
vi.mock('@pazarsync/spreadsheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pazarsync/spreadsheet')>();
  return { ...actual, readWorkbookGrid: vi.fn(actual.readWorkbookGrid) };
});

const app = createApp();
const engineRead = vi.mocked(readWorkbookGrid);

const FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-discount-products.xlsx', import.meta.url),
);
const IMPORT_FILENAME = 'trendyol_indirimler.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NET_CONFIG = {
  discountType: 'NET',
  valueKind: 'AMOUNT',
  value: '50',
  startsAt: '2026-07-21T05:00:00.000Z',
  endsAt: '2026-07-28T04:59:00.000Z',
} as const;

const RLO = String.fromCodePoint(0x202e);
// RLO as it reads percent-encoded in a `filename*` value.
const RLO_PERCENT_ENCODED = '%E2%80%AE';
// An upload name that sanitizes to itself but carries header parameter syntax; copied
// as it is into the quoted fallback, the web client would save `setup.exe`.
const SMUGGLED_NAME = "rapor;filename*=UTF-8''setup.exe;.xlsx";

const ImportSchema = z.object({ listId: z.string() });
const ProblemSchema = z.object({
  code: z.string(),
  meta: z.object({ reason: z.string().optional() }).optional(),
});

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setupStore(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

async function importFile(
  ctx: Ctx,
  file: Buffer = FIXTURE,
  filename: string = IMPORT_FILENAME,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), filename);
  for (const [key, value] of Object.entries(NET_CONFIG)) form.append(key, value);
  const res = await app.request(
    new Request(
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/discount-lists/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return ImportSchema.parse(await res.json()).listId;
}

function exportRequest(ctx: Ctx, listId: string): Request {
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/discount-lists/${listId}/export`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
  );
}

async function storedList(
  ctx: Ctx,
  listId: string,
): Promise<{ exportedAt: Date | null; sourceFile: Uint8Array | null }> {
  const list = await prisma.discountList.findFirst({
    where: { id: listId, organizationId: ctx.orgId, storeId: ctx.storeId },
    select: { exportedAt: true, sourceFile: true },
  });
  if (list === null) throw new Error('the list is gone');
  return list;
}

async function updateList(
  ctx: Ctx,
  listId: string,
  data: {
    sourceFile?: Uint8Array<ArrayBuffer>;
    sourceFormatId?: string | null;
    sourceFilename?: string;
  },
): Promise<void> {
  const { count } = await prisma.discountList.updateMany({
    where: { id: listId, organizationId: ctx.orgId, storeId: ctx.storeId },
    data,
  });
  expect(count).toBe(1);
}

/** Answers 409 CONFLICT with `reason`, and the list is still not marked exported. */
async function expectConflict(ctx: Ctx, listId: string, reason: string): Promise<void> {
  const res = await app.request(exportRequest(ctx, listId));

  expect(res.status).toBe(409);
  const body = ProblemSchema.parse(await res.json());
  expect(body.code).toBe('CONFLICT');
  expect(body.meta?.reason).toBe(reason);
  expect((await storedList(ctx, listId)).exportedAt).toBeNull();
}

/** The fixture with its discount sheet renamed in the workbook part. */
function renamedSheetFixture(): Buffer {
  const entries = unzipSync(new Uint8Array(FIXTURE));
  const workbook = entries['xl/workbook.xml'];
  if (workbook === undefined) throw new Error('the fixture has no workbook part');
  const xml = strFromU8(workbook);
  const renamed = xml.replace(`name="${TRENDYOL_SHEET_NAMES.DISCOUNT_LIST}"`, 'name="Renamed"');
  if (renamed === xml) throw new Error('the fixture does not name the discount sheet');
  entries['xl/workbook.xml'] = strToU8(renamed);
  return Buffer.from(zipSync(entries));
}

beforeEach(() => {
  _resetRateLimitStoreForTests();
});

describe('generic workbook export on the discount route', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('exports a list without a stored format id, reading the stored file once', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    await updateList(ctx, listId, { sourceFormatId: null });
    engineRead.mockClear();

    const res = await app.request(exportRequest(ctx, listId));

    expect(res.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), FIXTURE)).toBe(0);
    expect(engineRead).toHaveBeenCalledTimes(1);
  });

  it('answers stored bytes that are not a workbook with 409 STORED_FILE_UNREADABLE', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    await updateList(ctx, listId, {
      sourceFormatId: null,
      sourceFile: new Uint8Array(Buffer.from('not a workbook')),
    });

    await expectConflict(ctx, listId, 'STORED_FILE_UNREADABLE');
  });

  it('answers a format id no adapter knows with 409 STORED_FILE_UNRECOGNIZED', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    await updateList(ctx, listId, { sourceFormatId: 'TRENDYOL:DISCOUNT_LIST:v9' });

    await expectConflict(ctx, listId, 'STORED_FILE_UNRECOGNIZED');
  });

  it('answers an item whose barcode no longer matches its row with 409 ROW_MISMATCH', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    const first = await prisma.discountListItem.findFirst({
      where: { listId, organizationId: ctx.orgId, storeId: ctx.storeId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (first === null) throw new Error('the import stored no item');
    await prisma.discountListItem.updateMany({
      where: { id: first.id, organizationId: ctx.orgId, storeId: ctx.storeId },
      data: { barcode: 'CHANGED-BARCODE' },
    });

    await expectConflict(ctx, listId, 'ROW_MISMATCH');
  });

  it('answers a stored file whose sheet was renamed with 409 STORED_FILE_UNRECOGNIZED', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    await updateList(ctx, listId, { sourceFile: new Uint8Array(renamedSheetFixture()) });

    await expectConflict(ctx, listId, 'STORED_FILE_UNRECOGNIZED');
  });

  it('answers a byte after the zip end record with 409 STORED_FILE_UNREADABLE', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    const trailing = Buffer.concat([FIXTURE, Buffer.from('x')]);
    await updateList(ctx, listId, { sourceFile: new Uint8Array(trailing) });

    await expectConflict(ctx, listId, 'STORED_FILE_UNREADABLE');
  });

  it('streams the stored bytes back when no choice deviates, and marks the list exported', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);

    const res = await app.request(exportRequest(ctx, listId));

    expect(res.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), FIXTURE)).toBe(0);
    expect((await storedList(ctx, listId)).exportedAt).not.toBeNull();
  });

  it('sends the five download headers', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);

    const res = await app.request(exportRequest(ctx, listId));

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-type')).toBe(XLSX_MIME);
    expect(res.headers.get('content-length')).toBe(String(body.length));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain(`filename="${IMPORT_FILENAME}"`);
    expect(disposition).toContain(`filename*=UTF-8''${IMPORT_FILENAME}`);
  });

  it('never puts a raw stored name with a bidi override into the header', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    await updateList(ctx, listId, { sourceFilename: `rapor${RLO}xslx.xlsx` });

    const res = await app.request(exportRequest(ctx, listId));

    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('filename="');
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition.includes(RLO)).toBe(false);
    expect(disposition.includes(RLO_PERCENT_ENCODED)).toBe(false);
    expect(disposition).toContain('raporxslx.xlsx');
  });

  it('never lets an uploaded name with parameter syntax steer the name the web client saves', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx, FIXTURE, SMUGGLED_NAME);

    const res = await app.request(exportRequest(ctx, listId));

    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('filename="rapor_filename__UTF-8__setup.exe_.xlsx"');
    // The first `filename*=` is the parameter, after the fallback's closing quote.
    expect(disposition.indexOf('filename*=')).toBeGreaterThan(disposition.lastIndexOf('"'));
    expect(webClientFilename(disposition)).toBe(SMUGGLED_NAME);
  });
});
