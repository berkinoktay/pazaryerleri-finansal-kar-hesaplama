// Round-trip tests for the İndirimler (Promosyon > İndirimler) import -> select -> export
// chain, plus the zero-deviation verbatim path and the no-source 409.
//
// Export is the proof that matters: import Trendyol's real İndirimler file (which keeps
// the raw bytes as the source), record participation choices, export, and read the
// patched .xlsx back to assert the authoritative export contract:
//   • an included row writes "Evet" into "Kampayaya Dahil Edilsin Mi?";
//   • a row we EXCLUDE that the file had pre-marked "Evet" writes "Hayır";
//   • only cells that DEVIATE from the source are patched — a row whose stored choice
//     already matches the file is byte-for-byte unchanged.
// A list with NO deviations from the source streams back byte-for-byte verbatim; a list
// with no stored source is 409.

import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { cellText } from '@/lib/xlsx-grid-cells';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-discount-products.xlsx', import.meta.url),
);
const SHEET_NAME = 'Ürünler';
const XLSX_MIME = 'spreadsheetml';
// The import stores the uploaded blob's name; the export streams back under it.
const IMPORT_FILENAME = 'trendyol_indirimler.xlsx';

// 0-based grid column of the participation cell (verified against the fixture header).
const COL_PARTICIPATION = 8; // I "Kampayaya Dahil Edilsin Mi?"

// The two participation labels Trendyol reads (and the export writes back).
const INCLUDED_YES = 'Evet';
const INCLUDED_NO = 'Hayır';

// The fixture's 4 rows: DISC-BC-1..3 start "Hayır", DISC-BC-4 starts "Evet".
const BARCODE_FIRST = 'DISC-BC-1';
const BARCODE_SECOND = 'DISC-BC-2';
const BARCODE_PREMARKED = 'DISC-BC-4';

// A valid NET config that passes the shared import refinement (both dates are required).
const NET_CONFIG = {
  discountType: 'NET',
  valueKind: 'AMOUNT',
  value: '50',
  startsAt: '2026-07-21T05:00:00.000Z',
  endsAt: '2026-07-28T04:59:00.000Z',
} as const;

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

async function importFile(ctx: Ctx, file: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), IMPORT_FILENAME);
  for (const [key, value] of Object.entries(NET_CONFIG)) form.append(key, value);
  const res = await app.request(
    new Request(
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/discount-lists/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { listId: string }).listId;
}

async function patchSelections(ctx: Ctx, listId: string, selections: unknown): Promise<void> {
  const res = await app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/discount-lists/${listId}/selections`,
    {
      method: 'PATCH',
      headers: { Authorization: bearer(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'set', selections }),
    },
  );
  expect(res.status).toBe(200);
}

function exportRequest(ctx: Ctx, listId: string): Request {
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/discount-lists/${listId}/export`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
  );
}

describe('discount-lists export', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('writes "Evet" into marked rows and leaves unchanged rows byte-identical', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx, FIXTURE);

    // Items are ordered by sortOrder == data-row index (no skipped rows in the fixture).
    const items = await prisma.discountListItem.findMany({
      where: { listId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(items[0]?.barcode).toBe(BARCODE_FIRST);
    expect(items[1]?.barcode).toBe(BARCODE_SECOND);
    expect(items[3]?.barcode).toBe(BARCODE_PREMARKED);

    // Include the first two rows (source "Hayır" → they now deviate to "Evet").
    await patchSelections(ctx, listId, [
      { itemId: items[0]?.id, included: true },
      { itemId: items[1]?.id, included: true },
    ]);

    const res = await app.request(exportRequest(ctx, listId));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME);
    expect(res.headers.get('content-disposition')).toContain(IMPORT_FILENAME);

    const out = Buffer.from(await res.arrayBuffer());
    expect(out.subarray(0, 2).toString('ascii')).toBe('PK');

    const sourceGrid = await readWorkbookGrid(FIXTURE, { sheetName: SHEET_NAME });
    const grid = await readWorkbookGrid(out, { sheetName: SHEET_NAME });

    // Grid index = sortOrder + 1 (header is row 1). The two marked rows now say "Evet".
    expect(cellText(grid[1] ?? [], COL_PARTICIPATION)).toBe(INCLUDED_YES);
    expect(cellText(grid[2] ?? [], COL_PARTICIPATION)).toBe(INCLUDED_YES);

    // Untouched rows deep-equal the source: DISC-BC-3 stays "Hayır" (still excluded), and
    // DISC-BC-4 stays "Evet" (its stored included=true already matches the file — no
    // deviation, no patch). This proves ONLY deviating cells are written.
    expect(grid[3]).toEqual(sourceGrid[3]);
    expect(grid[4]).toEqual(sourceGrid[4]);
    expect(cellText(grid[3] ?? [], COL_PARTICIPATION)).toBe(INCLUDED_NO);
    expect(cellText(grid[4] ?? [], COL_PARTICIPATION)).toBe(INCLUDED_YES);

    // The list is now marked exported.
    const listed = await prisma.discountList.findUnique({ where: { id: listId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('writes "Hayır" when a source-"Evet" row is excluded from the selection', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx, FIXTURE);

    const items = await prisma.discountListItem.findMany({
      where: { listId },
      orderBy: { sortOrder: 'asc' },
    });
    const premarked = items[3]; // DISC-BC-4 — source "Evet", imported as included=true.
    expect(premarked?.barcode).toBe(BARCODE_PREMARKED);
    expect(premarked?.included).toBe(true);

    // Drop it from the selection → the cell must deviate back to "Hayır".
    await patchSelections(ctx, listId, [{ itemId: premarked?.id, included: false }]);

    const res = await app.request(exportRequest(ctx, listId));
    expect(res.status).toBe(200);

    const out = Buffer.from(await res.arrayBuffer());
    const grid = await readWorkbookGrid(out, { sheetName: SHEET_NAME });
    expect(cellText(grid[4] ?? [], COL_PARTICIPATION)).toBe(INCLUDED_NO);

    // The three source-"Hayır" rows still match the file, so they stay untouched.
    const sourceGrid = await readWorkbookGrid(FIXTURE, { sheetName: SHEET_NAME });
    expect(grid[1]).toEqual(sourceGrid[1]);
    expect(grid[2]).toEqual(sourceGrid[2]);
    expect(grid[3]).toEqual(sourceGrid[3]);
  });

  it('streams the source file back verbatim when nothing deviates (200)', async () => {
    const ctx = await setupStore();
    // No selection changes: the imported state already mirrors the file (BC-1..3 excluded,
    // BC-4 included), so no cell deviates and nothing is patched.
    const listId = await importFile(ctx, FIXTURE);

    const res = await app.request(exportRequest(ctx, listId));
    expect(res.status).toBe(200);

    const out = Buffer.from(await res.arrayBuffer());
    expect(Buffer.compare(out, FIXTURE)).toBe(0);

    // A verbatim export still stamps exportedAt (the seller downloaded the file).
    const listed = await prisma.discountList.findUnique({ where: { id: listId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('marks exported:true in the list DTO after an export', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx, FIXTURE);
    await app.request(exportRequest(ctx, listId));

    const body = (await (
      await app.request(`/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/discount-lists`, {
        headers: { Authorization: bearer(ctx.accessToken) },
      })
    ).json()) as { data: { id: string; exported: boolean }[] };
    expect(body.data.find((l) => l.id === listId)?.exported).toBe(true);
  });

  it('returns 409 when the list has no stored source file', async () => {
    const ctx = await setupStore();
    // Seed a list directly, so no source file was ever stored.
    const list = await prisma.discountList.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: 'No Source Discount List',
        discountType: 'NET',
        valueKind: 'AMOUNT',
        value: '50',
      },
    });

    const res = await app.request(exportRequest(ctx, list.id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('CONFLICT');
  });
});
