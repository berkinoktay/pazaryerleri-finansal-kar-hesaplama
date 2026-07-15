// Round-trip integration test for POST .../discount-lists/import using an anonymized
// Trendyol "İndirimler" (Promosyon > İndirimler) product-selection sheet as a fixture.
//
// Proves the whole import chain on the vendor sheet (sheet `Ürünler`): header-name
// column mapping, the "250 ₺" TEXT price parse (currency-aware), barcode → variant
// matching, per-row persistence, and the participation init ("Evet" → included=true).
// The discount CONFIG (type + parameters) is NOT in the file — it rides in on the
// multipart form and is validated by the shared config validator, so the invalid-config
// cases exercise that gate too. The corrupt-format case blanks the required "Barkod"
// header via `patchXlsxCells` (the byte-preserving cell patcher used by the export tests).

import { readFileSync } from 'node:fs';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { patchXlsxCells, type XlsxCellValue } from '@/lib/xlsx-patch';

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
  new URL('../../fixtures/trendyol-discount-products.xlsx', import.meta.url),
);

// Facts of the fixture (4 data rows, barcodes DISC-BC-1..4, all priced "250 ₺",
// only the last row already marked "Evet" in the source file).
const TOTAL_ROWS = 4;
const MATCHED_BARCODE = 'DISC-BC-1';
const INCLUDED_BARCODE = 'DISC-BC-4';

// 0-based grid column of the required "Barkod" header (Excel row 1).
const COL_BARCODE = 4;

// A valid NET config that passes the shared refinement.
const NET_CONFIG = { discountType: 'NET', valueKind: 'AMOUNT', value: '50' } as const;

interface ImportWire {
  listId: string;
  name: string;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

interface ProblemWire {
  code: string;
  errors?: { field: string; code: string }[];
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

function importRequest(ctx: Ctx, file: Buffer, config: Record<string, string>): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), 'trendyol_indirimler.xlsx');
  for (const [key, value] of Object.entries(config)) form.append(key, value);
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/discount-lists/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

async function importFile(
  ctx: Ctx,
  file: Buffer,
  config: Record<string, string>,
): Promise<ImportWire> {
  const res = await app.request(importRequest(ctx, file, config));
  expect(res.status).toBe(201);
  return (await res.json()) as ImportWire;
}

/** Builds a one-row cell patch for the byte-preserving fixture manipulation. */
function rowPatch(
  excelRow: number,
  cells: [number, XlsxCellValue][],
): Map<number, Map<number, XlsxCellValue>> {
  return new Map([[excelRow, new Map(cells)]]);
}

describe('POST .../discount-lists/import - happy path', () => {
  let ctx: Ctx;
  let imported: ImportWire;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    ctx = await setupStore(true);
    imported = await importFile(ctx, FIXTURE, { ...NET_CONFIG });
  });

  it('imports every product row and matches only the catalog barcode', () => {
    expect(imported.itemCount).toBe(TOTAL_ROWS);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(TOTAL_ROWS - 1);
    expect(imported.skippedRows).toBe(0);
    expect(imported.name).not.toBe('');
  });

  it('persists the list (with the raw file + config) and one item per row', async () => {
    const list = await prisma.discountList.findUnique({
      where: { id: imported.listId },
      select: { storeId: true, sourceFile: true, discountType: true, valueKind: true, value: true },
    });
    expect(list?.storeId).toBe(ctx.storeId);
    expect(list?.sourceFile).not.toBeNull();
    expect(list?.discountType).toBe('NET');
    expect(list?.valueKind).toBe('AMOUNT');
    expect(Number(list?.value)).toBe(50);

    const itemCount = await prisma.discountListItem.count({ where: { listId: imported.listId } });
    expect(itemCount).toBe(imported.itemCount);
  });

  it('parses the "250 ₺" text price and matches the catalog variant', async () => {
    const first = await prisma.discountListItem.findFirst({
      where: { listId: imported.listId, barcode: MATCHED_BARCODE },
    });
    expect(Number(first?.currentPrice)).toBe(250);
    expect(first?.productVariantId).not.toBeNull();
  });

  it('initializes included from the source "Evet"/"Hayır" column', async () => {
    const included = await prisma.discountListItem.findFirst({
      where: { listId: imported.listId, barcode: INCLUDED_BARCODE },
    });
    expect(included?.included).toBe(true);

    const notIncluded = await prisma.discountListItem.findFirst({
      where: { listId: imported.listId, barcode: MATCHED_BARCODE },
    });
    expect(notIncluded?.included).toBe(false);

    const includedCount = await prisma.discountListItem.count({
      where: { listId: imported.listId, included: true },
    });
    expect(includedCount).toBe(1);
  });
});

describe('POST .../discount-lists/import - rejects invalid input', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('rejects a config missing a required field (NET without value) with 422 VALUE_REQUIRED', async () => {
    const ctx = await setupStore(false);
    const res = await app.request(
      importRequest(ctx, FIXTURE, { discountType: 'NET', valueKind: 'AMOUNT' }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'value', code: 'VALUE_REQUIRED' })]),
    );
  });

  it('rejects a BUY_X_PAY_Y config with buy=0/pay=0 (pay >= buy) with 422', async () => {
    const ctx = await setupStore(false);
    const res = await app.request(
      importRequest(ctx, FIXTURE, {
        discountType: 'BUY_X_PAY_Y',
        buyQuantity: '0',
        payQuantity: '0',
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'payQuantity', code: 'PAY_MUST_BE_LESS_THAN_BUY' }),
      ]),
    );
  });

  it('rejects a file whose header layout is not the İndirimler export with 422 INVALID_DISCOUNT_FORMAT', async () => {
    const ctx = await setupStore(false);
    // Blank the required "Barkod" header so the layout no longer resolves.
    const corrupt = patchXlsxCells(
      FIXTURE,
      rowPatch(1, [[COL_BARCODE, { kind: 'inlineStr', value: 'Bozuk' }]]),
    );
    const res = await app.request(importRequest(ctx, corrupt, { ...NET_CONFIG }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'file', code: 'INVALID_DISCOUNT_FORMAT' }),
      ]),
    );
  });
});
