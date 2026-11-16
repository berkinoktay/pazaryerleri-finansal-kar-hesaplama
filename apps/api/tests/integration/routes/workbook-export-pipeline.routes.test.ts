// The generic workbook export through the discount route, its first consumer:
//   - a list stored without a format id is exported through format selection, which
//     reads the stored file once;
//   - nothing an export reads surfaces as a 500: bytes that are not a workbook, a
//     format id no adapter knows, a renamed sheet, a byte after the zip end record and
//     a row that no longer matches its item are each a 409 with its reason as the code, and
//     the list is not marked exported;
//   - a list whose choices match the stored file streams the stored bytes back;
//   - the download carries the hardened headers and never the raw stored name;
//   - the patch step: a write-back cell a stored file holds under a shared formula is
//     409 STORED_FILE_UNREADABLE, a full parse queue is 503 IMPORT_BUSY;
//   - a stored file holding active content (a macro project part, a WEBSERVICE
//     formula) is 409 STORED_FILE_UNREADABLE, and no byte of it is handed out.
// And, on the pages whose stored records can hold what the export cannot write:
//   - a legacy commission tariff whose window files share a name is 409
//     EXPORT_FILENAME_COLLISION, and one that plans more files than one engine call
//     patches is 409 STORED_FILE_UNREADABLE, both before the engine patches anything;
//   - a legacy campaign list whose maximum price the write rule refuses is 409
//     STORED_FILE_UNREADABLE, never a 500.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { CampaignPriceSelection } from '@pazarsync/db/enums';
import {
  MAX_PATCH_OUTPUTS,
  patchWorkbook,
  readWorkbookGrid,
  SpreadsheetFileError,
  UNSAFE_CONTENT_REASONS,
} from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import { TRENDYOL_SHEET_NAMES } from '@/workbooks/formats/trendyol/labels';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { webClientFilename } from '../../helpers/web-client-filename';
import { macroFixture, unsafeFormulaFixture } from '../../helpers/workbook-unsafe-fixtures';

// The engine itself, with its grid read and its patch wrapped in spies.
vi.mock('@pazarsync/spreadsheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pazarsync/spreadsheet')>();
  return {
    ...actual,
    readWorkbookGrid: vi.fn(actual.readWorkbookGrid),
    patchWorkbook: vi.fn(actual.patchWorkbook),
  };
});

const app = createApp();
const engineRead = vi.mocked(readWorkbookGrid);
const enginePatch = vi.mocked(patchWorkbook);

const FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-discount-products.xlsx', import.meta.url),
);
const IMPORT_FILENAME = 'trendyol_indirimler.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// The content type of every problem body (`c.json` in problem-details.ts).
const JSON_MIME = 'application/json';

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
const ProblemSchema = z.object({ code: z.string() });

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

/**
 * Answers 409 with `reason` as its code, and the list is still not marked exported.
 * Returns the response, its body already read.
 */
async function expectConflict(ctx: Ctx, listId: string, reason: string): Promise<Response> {
  const res = await app.request(exportRequest(ctx, listId));

  expect(res.status).toBe(409);
  const body = ProblemSchema.parse(await res.json());
  expect(body.code).toBe(reason);
  expect((await storedList(ctx, listId)).exportedAt).toBeNull();
  return res;
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

// The column letter of the participation flag in the real header, and the fixture's one
// worksheet part.
const INCLUDED_COL_LETTER = 'I';
const DISCOUNT_SHEET_PART = 'xl/worksheets/sheet1.xml';

/**
 * The real fixture with the participation cells of sheet rows 2 and 3 under one shared
 * formula, written as the upload case of a seller-made shared formula writes them
 * (workbook-import-pipeline.routes.test.ts). Every row and barcode stays, so the stored
 * list's items still pair with the kept rows.
 */
function sharedFormulaFixture(): Buffer {
  const entries = unzipSync(new Uint8Array(FIXTURE));
  const part = entries[DISCOUNT_SHEET_PART];
  if (part === undefined) throw new Error('the fixture has no discount worksheet part');
  const xml = strFromU8(part);
  const shared = (excelRow: number): string =>
    excelRow === 2
      ? '<c r="I2" t="str"><f t="shared" ref="I2:I3" si="0">H2</f><v>Kaybeden</v></c>'
      : `<c r="I${excelRow}" t="str"><f t="shared" si="0"/><v>Kaybeden</v></c>`;
  let edited = xml;
  for (const excelRow of [2, 3]) {
    const cell = new RegExp(`<c r="${INCLUDED_COL_LETTER}${excelRow}"[^>]*>.*?</c>`);
    const next = edited.replace(cell, shared(excelRow));
    if (next === edited) throw new Error(`the fixture has no cell I${excelRow}`);
    edited = next;
  }
  entries[DISCOUNT_SHEET_PART] = strToU8(edited);
  return Buffer.from(zipSync(entries));
}

/** Marks the list's first item (sheet row 2) as included: the one selected row. */
async function selectFirstItem(ctx: Ctx, listId: string): Promise<void> {
  const first = await prisma.discountListItem.findFirst({
    where: { listId, organizationId: ctx.orgId, storeId: ctx.storeId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  if (first === null) throw new Error('the import stored no item');
  const { count } = await prisma.discountListItem.updateMany({
    where: { id: first.id, organizationId: ctx.orgId, storeId: ctx.storeId },
    data: { included: true },
  });
  expect(count).toBe(1);
}

/** The `workbook.stored-file-rejected` lines a warn spy saw. */
function storedFileRejections(warn: { mock: { calls: unknown[][] } }): unknown[][] {
  return warn.mock.calls.filter(([event]) => event === 'workbook.stored-file-rejected');
}

beforeEach(() => {
  _resetRateLimitStoreForTests();
  enginePatch.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('answers a selected cell the stored file holds under a shared formula with 409 STORED_FILE_UNREADABLE', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    // The format id stays: the stored file is read strictly, as the import stored it.
    await updateList(ctx, listId, { sourceFile: new Uint8Array(sharedFormulaFixture()) });
    await selectFirstItem(ctx, listId);
    enginePatch.mockClear();

    await expectConflict(ctx, listId, 'STORED_FILE_UNREADABLE');
    // The patch step itself refused the file.
    expect(enginePatch).toHaveBeenCalledTimes(1);
  });

  it('answers a full parse queue at the patch step with 503 IMPORT_BUSY and a Retry-After', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx);
    await selectFirstItem(ctx, listId);
    enginePatch.mockClear();
    // Built as tests/unit/workbooks/workbook-errors.test.ts builds the engine's refusal.
    enginePatch.mockRejectedValueOnce(
      new SpreadsheetFileError('ENGINE_BUSY', 'Workbook parse queue is full', { cap: 8 }),
    );

    const res = await app.request(exportRequest(ctx, listId));

    expect(res.status).toBe(503);
    expect(ProblemSchema.parse(await res.json()).code).toBe('IMPORT_BUSY');
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(enginePatch).toHaveBeenCalledTimes(1);
    expect((await storedList(ctx, listId)).exportedAt).toBeNull();
  });

  it.each([
    [
      'a macro project',
      (source: Buffer) => macroFixture(source),
      UNSAFE_CONTENT_REASONS.UNSAFE_PART,
    ],
    [
      'a WEBSERVICE formula',
      (source: Buffer) => unsafeFormulaFixture(source, DISCOUNT_SHEET_PART),
      UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
    ],
  ] as const)(
    'answers a stored file with %s with 409 STORED_FILE_UNREADABLE and hands out no byte of it',
    async (_name, build, reason) => {
      const ctx = await setupStore();
      const listId = await importFile(ctx);
      await updateList(ctx, listId, { sourceFile: new Uint8Array(build(FIXTURE)) });
      const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);

      const res = await expectConflict(ctx, listId, 'STORED_FILE_UNREADABLE');

      // A problem body, never the workbook.
      expect(res.headers.get('content-type')).toBe(JSON_MIME);
      expect(storedFileRejections(warn)).toEqual([
        [
          'workbook.stored-file-rejected',
          {
            page: WORKBOOK_PAGES.DISCOUNT_LIST,
            recordId: listId,
            code: 'UNSAFE_CONTENT',
            reason,
          },
        ],
      ]);
    },
  );
});

// A legacy commission tariff: a stored record of the period model the upload no longer
// lets in, seeded through Prisma with the real file and no format id.

const COMMISSION_FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-commission-tariff.xlsx', import.meta.url),
);
// A barcode of the commission fixture.
const COMMISSION_BARCODE = 'TB200X300A';

/**
 * A tariff of the store holding the real commission file and no format id, with one
 * period per entry of `dayCounts` (in order) and in each period one selected item of
 * COMMISSION_BARCODE at its own custom price, so every period writes its own file.
 */
async function seedLegacyTariff(ctx: Ctx, dayCounts: readonly number[]): Promise<string> {
  const tariff = await prisma.commissionTariff.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      name: 'Legacy tariff',
      sourceFilename: 'tariff.xlsx',
      sourceFile: new Uint8Array(COMMISSION_FIXTURE),
      sourceFormatId: null,
    },
    select: { id: true },
  });
  for (const [index, dayCount] of dayCounts.entries()) {
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        tariffId: tariff.id,
        dateRangeLabel: `period ${index + 1}`,
        dayCount,
        sortOrder: index,
      },
      select: { id: true },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        periodId: period.id,
        barcode: COMMISSION_BARCODE,
        productTitle: 'Legacy item',
        currentPrice: '285.00',
        currentCommissionPct: '0.19',
        bands: [],
        selectedBand: 'band1',
        customPrice: `${100 + index}.00`,
      },
    });
  }
  return tariff.id;
}

function tariffExportRequest(ctx: Ctx, tariffId: string): Request {
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}/export`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
  );
}

async function tariffExportedAt(ctx: Ctx, tariffId: string): Promise<Date | null> {
  const tariff = await prisma.commissionTariff.findFirst({
    where: { id: tariffId, organizationId: ctx.orgId, storeId: ctx.storeId },
    select: { exportedAt: true },
  });
  if (tariff === null) throw new Error('the tariff is gone');
  return tariff.exportedAt;
}

describe('generic workbook export of a legacy commission tariff', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('answers two window files of one name with 409 EXPORT_FILENAME_COLLISION before any patch', async () => {
    const ctx = await setupStore();
    // Two zero-day periods with different prices: two files, both named for 0 days.
    const tariffId = await seedLegacyTariff(ctx, [0, 0]);

    const res = await app.request(tariffExportRequest(ctx, tariffId));

    expect(res.status).toBe(409);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('EXPORT_FILENAME_COLLISION');
    expect(enginePatch).not.toHaveBeenCalled();
    expect(await tariffExportedAt(ctx, tariffId)).toBeNull();
  });

  it('answers more planned files than one engine call patches with 409 STORED_FILE_UNREADABLE before any patch', async () => {
    const ctx = await setupStore();
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    // Periods of 1 to 9 days with different prices: nine files, nine distinct names,
    // every window label a single digit the write rule accepts.
    const dayCounts = Array.from({ length: MAX_PATCH_OUTPUTS + 1 }, (_, index) => index + 1);
    const tariffId = await seedLegacyTariff(ctx, dayCounts);

    const res = await app.request(tariffExportRequest(ctx, tariffId));

    expect(res.status).toBe(409);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('STORED_FILE_UNREADABLE');
    expect(enginePatch).not.toHaveBeenCalled();
    expect(storedFileRejections(warn)).toEqual([
      [
        'workbook.stored-file-rejected',
        {
          page: WORKBOOK_PAGES.COMMISSION_TARIFF,
          recordId: tariffId,
          code: null,
          reason: 'too-many-files',
        },
      ],
    ]);
    expect(await tariffExportedAt(ctx, tariffId)).toBeNull();
  });
});

// A legacy marketplace campaign list: imported through the route, then given what only
// a list stored before the upload checked its values can hold.

const CAMPAIGN_FIXTURE = readFileSync(
  new URL('../../fixtures/marketplace-campaign-sample.xlsx', import.meta.url),
);
const CAMPAIGN_CONFIG = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '10',
  trendyolFundingPct: '40',
  startsAt: '2026-09-10T09:00:00.000Z',
  endsAt: '2026-09-14T09:00:00.000Z',
} as const;
const CampaignImportSchema = z.object({ campaignId: z.string() });

async function importCampaign(ctx: Ctx): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(CAMPAIGN_FIXTURE)]), 'trendyol_kampanya.xlsx');
  for (const [key, value] of Object.entries(CAMPAIGN_CONFIG)) form.append(key, value);
  const res = await app.request(
    new Request(
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/marketplace-campaigns/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return CampaignImportSchema.parse(await res.json()).campaignId;
}

describe('generic workbook export of a legacy marketplace campaign list', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('answers a negative maximum price selected as MAX with 409 STORED_FILE_UNREADABLE, never a 500', async () => {
    const ctx = await setupStore();
    const campaignId = await importCampaign(ctx);
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const { count: lists } = await prisma.marketplaceCampaignList.updateMany({
      where: { id: campaignId, ...scope },
      data: { sourceFormatId: null },
    });
    expect(lists).toBe(1);
    const first = await prisma.marketplaceCampaignItem.findFirst({
      where: { listId: campaignId, ...scope },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (first === null) throw new Error('the import stored no item');
    const { count: items } = await prisma.marketplaceCampaignItem.updateMany({
      where: { id: first.id, ...scope },
      data: { maxPrice: '-5.00', selection: CampaignPriceSelection.MAX },
    });
    expect(items).toBe(1);
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    enginePatch.mockClear();

    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/marketplace-campaigns/${campaignId}/export`,
        { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
      ),
    );

    expect(res.status).toBe(409);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('STORED_FILE_UNREADABLE');
    expect(enginePatch).not.toHaveBeenCalled();
    expect(storedFileRejections(warn)).toEqual([
      [
        'workbook.stored-file-rejected',
        {
          page: WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
          recordId: campaignId,
          code: null,
          reason: 'unwritable-value',
        },
      ],
    ]);
    const campaign = await prisma.marketplaceCampaignList.findFirst({
      where: { id: campaignId, ...scope },
      select: { exportedAt: true },
    });
    expect(campaign?.exportedAt).toBeNull();
  });
});
