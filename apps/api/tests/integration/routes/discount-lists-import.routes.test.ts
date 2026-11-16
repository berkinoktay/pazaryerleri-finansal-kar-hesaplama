// Round-trip integration test for POST .../discount-lists/import using an anonymized
// Trendyol "İndirimler" (Promosyon > İndirimler) product-selection sheet as a fixture.
//
// Proves the whole import chain on the vendor sheet (sheet `Ürünler`): header-name
// column mapping, the "250 ₺" TEXT price parse (currency-aware), barcode → variant
// matching, per-row persistence, and the participation init ("Evet" → included=true).
// The discount CONFIG (type + parameters) is NOT in the file — it rides in on the
// multipart form and is validated by the shared config validator, so the invalid-config
// cases exercise that gate too. The corrupt-format case blanks the required "Barkod"
// header via `patchFixture` (the engine's test-only run of the export patch path).

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { type CellPatch, type CellPatchValue, type SheetSelector } from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';

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

// 0-based grid columns of the "Barkod" and "Güncel Satış Fiyatı" headers (Excel row 1).
const COL_BARCODE = 4;
const COL_PRICE = 6;

// The fixture holds a single sheet; the fixture patcher selects it strictly by position.
const FIRST_SHEET: SheetSelector = { by: 'index', index: 0 };

// Both campaign dates are required on every config write.
const START_AT = '2026-07-21T05:00:00.000Z';
const END_AT = '2026-07-28T04:59:00.000Z';

// A valid NET config that passes the shared refinement.
const NET_CONFIG = {
  discountType: 'NET',
  valueKind: 'AMOUNT',
  value: '50',
  startsAt: START_AT,
  endsAt: END_AT,
} as const;

interface ImportWire {
  listId: string;
  name: string;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
  prefilledRows: number;
}

interface ProblemWire {
  code: string;
  errors?: { field: string; code: string }[];
}

// The whole body of a 422, field issues as sent (meta included).
const RawValidationSchema = z.object({ code: z.string(), errors: z.array(z.unknown()) });

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
function rowPatch(excelRow: number, cells: [number, CellPatchValue][]): CellPatch[] {
  return cells.map(([col, value]) => ({ excelRow, col, value }));
}

// This file sends more imports than RATE_LIMITS.FILE_IMPORT allows per minute with the
// same pooled user; reset the in-memory limiter so each test starts with a fresh bucket.
beforeEach(() => {
  _resetRateLimitStoreForTests();
});

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

  it('answers prefilledRows 0: its one write column is seeded from the source', () => {
    expect(imported.prefilledRows).toBe(0);
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

  it('rejects a config without a start date with 422 START_REQUIRED', async () => {
    const ctx = await setupStore(false);
    const res = await app.request(
      importRequest(ctx, FIXTURE, {
        discountType: 'NET',
        valueKind: 'AMOUNT',
        value: '50',
        endsAt: END_AT,
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'startsAt', code: 'START_REQUIRED' }),
      ]),
    );
  });

  it('rejects a config without an end date with 422 END_REQUIRED', async () => {
    const ctx = await setupStore(false);
    const res = await app.request(
      importRequest(ctx, FIXTURE, {
        discountType: 'NET',
        valueKind: 'AMOUNT',
        value: '50',
        startsAt: START_AT,
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'endsAt', code: 'END_REQUIRED' })]),
    );
  });

  it('rejects an end date in the year 0 with 422 DATE_OUT_OF_RANGE on endsAt and stores nothing', async () => {
    const ctx = await setupStore(false);
    const res = await app.request(
      importRequest(ctx, FIXTURE, { ...NET_CONFIG, endsAt: '0000-01-01T00:00:00Z' }),
    );
    expect(res.status).toBe(422);
    const body = RawValidationSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    // The window rule may add END_BEFORE_START beside it.
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'endsAt', code: 'DATE_OUT_OF_RANGE' }),
      ]),
    );
    expect(body.errors).not.toContainEqual(expect.objectContaining({ field: 'file' }));
    expect(await prisma.discountList.count()).toBe(0);
  });

  it('rejects a file whose header layout is not the İndirimler export with 422 WRONG_FILE_FOR_PAGE', async () => {
    const ctx = await setupStore(false);
    // Blank the required "Barkod" header so the layout no longer resolves.
    const corrupt = patchFixture(
      FIXTURE,
      rowPatch(1, [[COL_BARCODE, { kind: 'text', value: 'Bozuk' }]]),
      { sheet: FIRST_SHEET },
    );
    const res = await app.request(importRequest(ctx, corrupt, { ...NET_CONFIG }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'file', code: 'WRONG_FILE_FOR_PAGE' }),
      ]),
    );
  });
});

describe('POST .../discount-lists/import - skips unparseable rows', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('counts a row with an unparseable price in skippedRows instead of persisting it', async () => {
    const ctx = await setupStore(true);
    // Break the SECOND data row's (unmatched DISC-BC-2) price cell — the matched row survives.
    const broken = patchFixture(
      FIXTURE,
      rowPatch(3, [[COL_PRICE, { kind: 'text', value: 'fiyat yok' }]]),
      { sheet: FIRST_SHEET },
    );
    const imported = await importFile(ctx, broken, { ...NET_CONFIG });
    expect(imported.skippedRows).toBe(1);
    expect(imported.itemCount).toBe(TOTAL_ROWS - 1);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(TOTAL_ROWS - 2);
    const persisted = await prisma.discountListItem.count({
      where: { listId: imported.listId, barcode: 'DISC-BC-2' },
    });
    expect(persisted).toBe(0);
  });
});

describe('POST .../discount-lists/import - BUY_X_PAY_Y quantity bounds', () => {
  const BUY_PAY_BASE = { discountType: 'BUY_X_PAY_Y', startsAt: START_AT, endsAt: END_AT } as const;

  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  async function importBuyPay(
    config: Record<string, string>,
  ): Promise<{ status: number; body: ProblemWire }> {
    const ctx = await setupStore(false);
    const res = await app.request(importRequest(ctx, FIXTURE, { ...BUY_PAY_BASE, ...config }));
    return { status: res.status, body: (await res.json()) as ProblemWire };
  }

  it('rejects buyQuantity below 2 with 422 BUY_QUANTITY_OUT_OF_RANGE', async () => {
    const { status, body } = await importBuyPay({ buyQuantity: '1', payQuantity: '1' });
    expect(status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'buyQuantity', code: 'BUY_QUANTITY_OUT_OF_RANGE' }),
      ]),
    );
  });

  it('rejects buyQuantity above 5 with 422 BUY_QUANTITY_OUT_OF_RANGE', async () => {
    const { status, body } = await importBuyPay({ buyQuantity: '6', payQuantity: '1' });
    expect(status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'buyQuantity', code: 'BUY_QUANTITY_OUT_OF_RANGE' }),
      ]),
    );
  });

  it('rejects payQuantity below 1 with 422 PAY_QUANTITY_TOO_SMALL', async () => {
    const { status, body } = await importBuyPay({ buyQuantity: '3', payQuantity: '0' });
    expect(status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'payQuantity', code: 'PAY_QUANTITY_TOO_SMALL' }),
      ]),
    );
  });

  it('rejects payQuantity >= buyQuantity with 422 PAY_MUST_BE_LESS_THAN_BUY', async () => {
    const { status, body } = await importBuyPay({ buyQuantity: '3', payQuantity: '3' });
    expect(status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'payQuantity', code: 'PAY_MUST_BE_LESS_THAN_BUY' }),
      ]),
    );
  });

  it('accepts an in-range buy=4/pay=2 config with 201', async () => {
    const ctx = await setupStore(false);
    const res = await app.request(
      importRequest(ctx, FIXTURE, { ...BUY_PAY_BASE, buyQuantity: '4', payQuantity: '2' }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImportWire;
    expect(body.itemCount).toBe(TOTAL_ROWS);
  });
});
