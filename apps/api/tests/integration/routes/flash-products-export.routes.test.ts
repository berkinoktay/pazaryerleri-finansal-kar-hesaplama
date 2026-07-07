// Round-trip tests for the Flash Products import -> select -> export chain, plus the
// zero-selection verbatim path and the no-source 409.
//
// Export is the proof that matters: import Trendyol's real Flaş Ürünler file (which
// keeps the raw bytes as the source), record per-ROW selections (H24 / H3 / custom),
// export, and read the patched .xlsx back to assert the authoritative export contract:
//   • an H24 row writes "24 Saat" into "Güncellenecek Fiyat" (J) and does NOT touch M;
//   • an H3 row writes "3 Saat" into J;
//   • a custom row writes "Senin Belirlediğin Flaş Fiyatı" into J AND the numeric price
//     into "Senin Belirlediğin Flaş Fiyatı" (M);
//   • an unselected row is byte-for-byte unchanged — including another date row of the
//     SAME product as a selected row (selections are per-row, not per-barcode).
// A list with no selections streams back verbatim; a list with no stored source is 409.

import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { cellText } from '@/lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '@/lib/xlsx-patch';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-flash-products.xlsx', import.meta.url),
);
const SHEET_NAME = 'TeklifÜrünleri';
const XLSX_MIME = 'spreadsheetml';
const EXPORT_FILENAME = 'flas-urunler.xlsx';

// 0-based grid columns (Title-Case header layout, verified against the fixture).
const COL_BARCODE = 1;
const COL_UPDATED_PRICE = 9; // J "Güncellenecek Fiyat"
const COL_OFFER_3_PRICE = 11; // L "3 Saat Fiyat"
const COL_CUSTOM_FLASH_PRICE = 12; // M "Senin Belirlediğin Flaş Fiyatı"
const COL_OFFER_3_START = 15; // P
const COL_OFFER_3_END = 16; // Q

// The three literal "Güncellenecek Fiyat" labels the export writes.
const LABEL_24H = '24 Saat';
const LABEL_3H = '3 Saat';
const LABEL_CUSTOM = 'Senin Belirlediğin Flaş Fiyatı';
const CUSTOM_PRICE = '149.90';

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

/** Builds a one-row cell patch for the byte-preserving fixture manipulation (F2 pattern). */
function rowPatch(
  excelRow: number,
  cells: [number, XlsxCellValue][],
): Map<number, Map<number, XlsxCellValue>> {
  return new Map([[excelRow, new Map(cells)]]);
}

async function importFile(ctx: Ctx, file: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), 'trendyol_flas_urunler.xlsx');
  const res = await app.request(
    new Request(
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/flash-products/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { listId: string }).listId;
}

async function patchSelections(ctx: Ctx, listId: string, selections: unknown): Promise<void> {
  const res = await app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/flash-products/${listId}/selections`,
    {
      method: 'PATCH',
      headers: { Authorization: bearer(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections }),
    },
  );
  expect(res.status).toBe(200);
}

function exportRequest(ctx: Ctx, listId: string): Request {
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/flash-products/${listId}/export`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
  );
}

describe('flash-products export', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('writes per-row labels (24 Saat / 3 Saat / custom) and leaves unselected rows untouched', async () => {
    const ctx = await setupStore();

    // Add a 3h offer to Excel row 3 (sortOrder 1) so an H3 selection is faithful; the
    // real fixture carries only 24h offers. Adding a 3h offer keeps the row as one item.
    const source = patchXlsxCells(
      FIXTURE,
      rowPatch(3, [
        [COL_OFFER_3_PRICE, { kind: 'number', value: '99.90' }],
        [COL_OFFER_3_START, { kind: 'inlineStr', value: '08/07/2026 09:00' }],
        [COL_OFFER_3_END, { kind: 'inlineStr', value: '08/07/2026 12:00' }],
      ]),
    );
    const listId = await importFile(ctx, source);

    // Items are ordered by sortOrder; with no skipped rows sortOrder == data-row index,
    // so item at sortOrder s lives on Excel row s+2 (grid index s+1).
    const items = await prisma.flashProductItem.findMany({
      where: { listId },
      orderBy: { sortOrder: 'asc' },
    });
    const h24Item = items[0]; // Excel row 2, barcode ATA100X150R
    const h3Item = items[1]; // Excel row 3, the patched 3h offer
    const untouchedItem = items[2]; // Excel row 4, SAME barcode as h24Item (per-row proof)
    const customItem = items[3]; // Excel row 5
    expect(h24Item?.barcode).toBe('ATA100X150R');
    expect(untouchedItem?.barcode).toBe('ATA100X150R');

    await patchSelections(ctx, listId, [
      { itemId: h24Item?.id, offer: 'H24', customPrice: null },
      { itemId: h3Item?.id, offer: 'H3', customPrice: null },
      { itemId: customItem?.id, offer: null, customPrice: CUSTOM_PRICE },
    ]);

    const res = await app.request(exportRequest(ctx, listId));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME);
    expect(res.headers.get('content-disposition')).toContain(EXPORT_FILENAME);

    const out = Buffer.from(await res.arrayBuffer());
    expect(out.subarray(0, 2).toString('ascii')).toBe('PK');

    const sourceGrid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
    const grid = await readWorkbookGrid(out, { sheetName: SHEET_NAME });

    // Grid index = sortOrder + 1 (header is row 1).
    const row2 = grid[1] ?? [];
    const row3 = grid[2] ?? [];
    const row5 = grid[4] ?? [];

    // H24 → "24 Saat" in J, M untouched (an offer never writes the custom price).
    expect(cellText(row2, COL_UPDATED_PRICE)).toBe(LABEL_24H);
    expect(cellText(row2, COL_CUSTOM_FLASH_PRICE)).toBe(
      cellText(sourceGrid[1] ?? [], COL_CUSTOM_FLASH_PRICE),
    );

    // H3 → "3 Saat" in J, M still untouched.
    expect(cellText(row3, COL_UPDATED_PRICE)).toBe(LABEL_3H);
    expect(cellText(row3, COL_CUSTOM_FLASH_PRICE)).toBe(
      cellText(sourceGrid[2] ?? [], COL_CUSTOM_FLASH_PRICE),
    );

    // Custom → the label in J AND the numeric price in M.
    expect(cellText(row5, COL_UPDATED_PRICE)).toBe(LABEL_CUSTOM);
    expect(Number(cellText(row5, COL_CUSTOM_FLASH_PRICE))).toBe(Number(CUSTOM_PRICE));

    // The unselected sibling date row (row 4, same barcode as the H24 row) is untouched:
    // every cell equals the source. This proves selections are per-ROW, not per-barcode.
    expect(grid[3]).toEqual(sourceGrid[3]);
    expect(cellText(grid[3] ?? [], COL_BARCODE)).toBe('ATA100X150R');
    expect(cellText(grid[3] ?? [], COL_UPDATED_PRICE)).toBeNull();

    // The list is now marked exported.
    const listed = await prisma.flashProductList.findUnique({ where: { id: listId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('streams the source file back verbatim when there are no selections (200)', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx, FIXTURE);

    const res = await app.request(exportRequest(ctx, listId));
    expect(res.status).toBe(200);

    // Nothing to patch → byte-for-byte the original upload.
    const out = Buffer.from(await res.arrayBuffer());
    expect(Buffer.compare(out, FIXTURE)).toBe(0);

    // A verbatim export still stamps exportedAt (the seller downloaded the file).
    const listed = await prisma.flashProductList.findUnique({ where: { id: listId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('marks exported:true in the list after an export', async () => {
    const ctx = await setupStore();
    const listId = await importFile(ctx, FIXTURE);
    await app.request(exportRequest(ctx, listId));

    const list = (await (
      await app.request(`/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/flash-products`, {
        headers: { Authorization: bearer(ctx.accessToken) },
      })
    ).json()) as { data: { id: string; exported: boolean }[] };
    expect(list.data.find((l) => l.id === listId)?.exported).toBe(true);
  });

  it('returns 409 when the list has no stored source file', async () => {
    const ctx = await setupStore();
    // Seed a list directly, so no source file was ever stored.
    const list = await prisma.flashProductList.create({
      data: { organizationId: ctx.orgId, storeId: ctx.storeId, name: 'No Source Flash List' },
    });

    const res = await app.request(exportRequest(ctx, list.id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('CONFLICT');
  });
});
