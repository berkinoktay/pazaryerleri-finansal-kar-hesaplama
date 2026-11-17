// Round-trip tests for the Plus import -> select -> export chain, plus the
// no-source 409 and the variable period count (a 3-Gün + 4-Gün split week).
//
// Export is the proof that matters: import Trendyol's real Plus file (which keeps
// the raw bytes as the source), opt products into Plus, export, and assert the route
// returns the patched file(s) — a lone .xlsx or a .zip of window files — that the
// seller can re-upload to Trendyol. A split week where the two sub-periods carry
// DIFFERENT prices yields a 3-gunluk + 4-gunluk zip, each patched with its own window
// label + that period's reduced commission; the SAME price in both collapses to a
// single 7-gunluk file carrying both periods' commission cells. A tariff with no
// stored source file returns 409. At import, a value the export would write back is
// checked as the export writes it: an Excel float residue offer is stored and exported
// rounded, a negative Plus price ceiling is refused with 422 and nothing is stored. A
// product joined without a custom price whose Plus price ceiling is unknown (NULL) refuses
// the export with 409 SELECTION_PRICE_UNKNOWN; a custom price is still written, and an
// unjoined row with an unknown ceiling is left as the file had it.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  cellText,
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  type CellPatch,
  type ColumnIndex,
  type ColumnKey,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import { trendyolPlusCommissionTariffLayout } from '@/workbooks/formats/trendyol/plus-commission-tariff.layout';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const FIXTURE_SINGLE = readFileSync(
  new URL('../../fixtures/trendyol-plus-tariff.xlsx', import.meta.url),
);
const FIXTURE_MULTI = readFileSync(
  new URL('../../fixtures/trendyol-plus-tariff-3ve4.xlsx', import.meta.url),
);
const SHEET_NAME = 'TyPlusÜrünleri';
const XLSX_MIME_FRAGMENT = 'spreadsheetml';
const ZIP_MIME_FRAGMENT = 'zip';

// Single-period (7-day) fixture: first product, its shared Plus ceiling + 7-day offer.
const SINGLE_BARCODE = '85697423698';
// Split-week (3-Gün + 4-Gün) fixture: a product present in both sub-periods. Its Plus
// ceiling (shared column) is 740.77; its per-period offers are 10.7% / 13.1%.
const MULTI_BARCODE = '2902003000019';
const MULTI_CEILING = 740.77;
const MULTI_OFFER_3DAY = 10.7;
const MULTI_OFFER_4DAY = 13.1;

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

async function importFixture(ctx: Ctx, file: Buffer, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), name);
  const res = await app.request(
    new Request(
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { tariffId: string }).tariffId;
}

async function exportTariff(ctx: Ctx, tariffId: string): Promise<Response> {
  return app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/${tariffId}/export`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
  );
}

// Opts a barcode's item in the given period into Plus (with an optional custom price).
async function optIn(
  ctx: Ctx,
  tariffId: string,
  dayCount: number,
  barcode: string,
  customPrice: string | null = null,
): Promise<void> {
  const period = await prisma.plusCommissionTariffPeriod.findFirst({
    where: { storeId: ctx.storeId, tariff: { id: tariffId }, dayCount },
  });
  const item = await prisma.plusCommissionTariffItem.findFirst({
    where: { periodId: period?.id, barcode },
  });
  expect(item).not.toBeNull();
  await prisma.plusCommissionTariffItem.update({
    where: { id: item?.id },
    data: { plusSelected: true, customPrice },
  });
}

type PlusColumn = ColumnKey<typeof trendyolPlusCommissionTariffLayout>;

// One period block of the resolved layout: its day count (the block tag), its date-range
// label column and its computed commission column (null when that header is absent).
interface PeriodColumns {
  readonly dayCount: number;
  readonly labelCol: number;
  readonly computedCommissionCol: ColumnIndex;
}

async function readParsed(buf: Buffer): Promise<{ grid: SheetData; layout: ResolvedLayout }> {
  const grid = await readWorkbookGrid(buf, { sheetName: SHEET_NAME });
  const layout = resolveLayout(trendyolPlusCommissionTariffLayout, grid);
  if (layout === null) throw new Error('unreadable Plus export');
  return { grid, layout };
}

// A named column of the Plus layout; null when an optional column is absent.
function column(layout: ResolvedLayout, key: PlusColumn): ColumnIndex {
  return columnIndex(trendyolPlusCommissionTariffLayout, layout, key);
}

// The period blocks of the Plus layout, in column order.
function periodsOf(layout: ResolvedLayout): readonly PeriodColumns[] {
  return (layout.blocks.get('periods') ?? []).map((period) => {
    const labelCol = period.columns.get('label');
    if (labelCol === undefined) throw new Error('Plus period block without a label column');
    return {
      dayCount: period.tag,
      labelCol,
      computedCommissionCol: period.lookups.get('computedCommission') ?? null,
    };
  });
}

function rowFor(
  grid: SheetData,
  layout: ResolvedLayout,
  barcode: string,
): readonly unknown[] | undefined {
  return grid.slice(1).find((r) => cellText(r, column(layout, 'barcode')) === barcode);
}

function num(row: readonly unknown[] | undefined, col: ColumnIndex): number {
  return Number(cellText(row ?? [], col));
}

// Decodes the RFC 5987 `filename*=UTF-8''…` the export route stamps on the download.
function contentDispositionFilename(res: Response): string {
  const header = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''(.+)$/.exec(header);
  if (match?.[1] === undefined) throw new Error(`no RFC 5987 filename in: ${header}`);
  return decodeURIComponent(match[1]);
}

describe('plus-commission-tariff export', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('exports a single-period tariff as one 7-gunluk file with the four opt-in cells', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_SINGLE, 'trendyol-plus-tariff.xlsx');

    // Opt the 7-day period's product into Plus (no custom price → the ceiling).
    const item = await prisma.plusCommissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, barcode: SINGLE_BARCODE },
    });
    expect(item).not.toBeNull();
    await prisma.plusCommissionTariffItem.update({
      where: { id: item?.id },
      data: { plusSelected: true },
    });

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME_FRAGMENT);
    // A lone file still carries the self-describing base name + its window.
    expect(res.headers.get('content-disposition')).toContain('plus-komisyon-tarifesi-7-gunluk');

    const out = Buffer.from(await res.arrayBuffer());
    expect(out.subarray(0, 2).toString('ascii')).toBe('PK');

    const { grid, layout } = await readParsed(out);
    const row = rowFor(grid, layout, SINGLE_BARCODE);
    expect(row).toBeDefined();
    // Four cells: Plus price = ceiling, marker, the single-period commission, "Hayır".
    expect(num(row, column(layout, 'plusPriceSelection'))).toBe(Number(item?.plusPriceUpperLimit));
    expect(cellText(row ?? [], column(layout, 'tariffSelection'))).toBe('7 Günlük Fiyat');
    expect(num(row, periodsOf(layout)[0]?.computedCommissionCol ?? null)).toBe(
      Number(item?.plusCommissionPct),
    );
    expect(cellText(row ?? [], column(layout, 'cancelled'))).toBe('Hayır');

    const listed = await prisma.plusCommissionTariff.findUnique({ where: { id: tariffId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('splits a week into a 3-gunluk + 4-gunluk zip when the sub-periods carry different prices', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_MULTI, 'trendyol-plus-tariff-3ve4.xlsx');

    // Different custom price per sub-period → the product lands in BOTH window files.
    await optIn(ctx, tariffId, 3, MULTI_BARCODE, '700.00');
    await optIn(ctx, tariffId, 4, MULTI_BARCODE, '650.00');

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(ZIP_MIME_FRAGMENT);
    // The zip drops the per-window suffix and is named after the tariff itself.
    expect(contentDispositionFilename(res)).toBe('plus-komisyon-tarifesi.zip');

    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(entries).sort();
    expect(names).toEqual([
      'plus-komisyon-tarifesi-3-gunluk.xlsx',
      'plus-komisyon-tarifesi-4-gunluk.xlsx',
    ]);

    // 3-gunluk file: price 700, "3 Günlük Fiyat", ONLY the 3-Gün commission (10.7),
    // the 4-Gün commission cell left at its fixture default (0).
    const three = await readParsed(
      Buffer.from(entries['plus-komisyon-tarifesi-3-gunluk.xlsx'] ?? new Uint8Array()),
    );
    const r3 = rowFor(three.grid, three.layout, MULTI_BARCODE);
    expect(num(r3, column(three.layout, 'plusPriceSelection'))).toBe(700);
    expect(cellText(r3 ?? [], column(three.layout, 'tariffSelection'))).toBe('3 Günlük Fiyat');
    expect(num(r3, periodsOf(three.layout)[0]?.computedCommissionCol ?? null)).toBe(
      MULTI_OFFER_3DAY,
    );
    expect(num(r3, periodsOf(three.layout)[1]?.computedCommissionCol ?? null)).toBe(0);

    // 4-gunluk file: price 650, "4 Günlük Fiyat", ONLY the 4-Gün commission (13.1).
    const four = await readParsed(
      Buffer.from(entries['plus-komisyon-tarifesi-4-gunluk.xlsx'] ?? new Uint8Array()),
    );
    const r4 = rowFor(four.grid, four.layout, MULTI_BARCODE);
    expect(num(r4, column(four.layout, 'plusPriceSelection'))).toBe(650);
    expect(cellText(r4 ?? [], column(four.layout, 'tariffSelection'))).toBe('4 Günlük Fiyat');
    expect(num(r4, periodsOf(four.layout)[1]?.computedCommissionCol ?? null)).toBe(
      MULTI_OFFER_4DAY,
    );
    expect(num(r4, periodsOf(four.layout)[0]?.computedCommissionCol ?? null)).toBe(0);
  });

  it("collapses a same-price product into one 7-gunluk file carrying BOTH periods' commission cells", async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_MULTI, 'trendyol-plus-tariff-3ve4.xlsx');

    // Same price (the shared ceiling) in BOTH sub-periods = whole week → a lone
    // 7-gunluk file (3 + 4 = 7), NOT a zip.
    await optIn(ctx, tariffId, 3, MULTI_BARCODE);
    await optIn(ctx, tariffId, 4, MULTI_BARCODE);

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME_FRAGMENT);
    expect(res.headers.get('content-disposition')).toContain('plus-komisyon-tarifesi-7-gunluk');

    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    const row = rowFor(grid, layout, MULTI_BARCODE);
    expect(num(row, column(layout, 'plusPriceSelection'))).toBe(MULTI_CEILING);
    expect(cellText(row ?? [], column(layout, 'tariffSelection'))).toBe('7 Günlük Fiyat');
    // One price, but a commission cell per sub-period, each at its OWN percent.
    expect(num(row, periodsOf(layout)[0]?.computedCommissionCol ?? null)).toBe(MULTI_OFFER_3DAY);
    expect(num(row, periodsOf(layout)[1]?.computedCommissionCol ?? null)).toBe(MULTI_OFFER_4DAY);
    expect(cellText(row ?? [], column(layout, 'cancelled'))).toBe('Hayır');

    // A product NOT opted in keeps its opt-in cells at the fixture defaults (untouched).
    const other = grid.slice(1).find((r) => {
      const bc = cellText(r, column(layout, 'barcode'));
      return bc !== null && bc !== MULTI_BARCODE;
    });
    expect(cellText(other ?? [], column(layout, 'plusPriceSelection'))).toBeNull();
    expect(cellText(other ?? [], column(layout, 'tariffSelection'))).toBeNull();
  });

  it('writes the commission into the layout column matched by dayCount, not by position, when import drops a period', async () => {
    const ctx = await setupStore();

    // Blank the FIRST period block's (3 Gün) date label on the first data row, so import's
    // "present" filter drops it. The surviving DB period (4 Gün) is then a SUBSEQUENCE of
    // the raw layout's two periods: a positional layout lookup would land the commission
    // in the 3-Gün column, whereas the dayCount match must put it in the 4-Gün column.
    const { grid: fixtureGrid, layout: fixtureLayout } = await readParsed(FIXTURE_MULTI);
    const firstPeriod = periodsOf(fixtureLayout)[0];
    const secondPeriod = periodsOf(fixtureLayout)[1];
    expect(firstPeriod).toBeDefined();
    expect(secondPeriod).toBeDefined();
    if (firstPeriod === undefined || secondPeriod === undefined) return;

    // The 3-Gün commission column's value in the untouched source, to prove export never
    // overwrites it (the fixture default here is a literal 0, not an empty cell).
    const originalThreeCommission = cellText(
      rowFor(fixtureGrid, fixtureLayout, MULTI_BARCODE) ?? [],
      firstPeriod.computedCommissionCol,
    );

    const blankFirstLabel: CellPatch[] = [
      { excelRow: 2, col: firstPeriod.labelCol, value: { kind: 'text', value: '' } },
    ];
    const blanked = patchFixture(FIXTURE_MULTI, blankFirstLabel, {
      sheet: { by: 'name', name: SHEET_NAME },
    });
    const tariffId = await importFixture(ctx, blanked, 'trendyol-plus-tariff-3ve4.xlsx');

    // Exactly the second (4 Gün) period survived import.
    const periods = await prisma.plusCommissionTariffPeriod.findMany({
      where: { storeId: ctx.storeId },
    });
    expect(periods).toHaveLength(1);
    expect(periods[0]?.dayCount).toBe(secondPeriod.dayCount);

    // Opt the surviving period's product into Plus (no custom price → the ceiling).
    await optIn(ctx, tariffId, secondPeriod.dayCount, MULTI_BARCODE);
    const item = await prisma.plusCommissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, barcode: MULTI_BARCODE },
    });
    expect(item).not.toBeNull();

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);

    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    const row = rowFor(grid, layout, MULTI_BARCODE);
    expect(row).toBeDefined();

    // The commission lands in the SURVIVING period's (4 Gün, col W) "Hesaplanan Komisyon"
    // column at its own percent — NOT the positional first (3 Gün, col V) column.
    expect(num(row, secondPeriod.computedCommissionCol)).toBe(Number(item?.plusCommissionPct));
    // The 3-Gün column is left exactly as the source had it — never overwritten with the
    // surviving period's commission (which the old positional lookup would have done).
    expect(cellText(row ?? [], firstPeriod.computedCommissionCol)).toBe(originalThreeCommission);
  });

  it('lets the higher-sortOrder row win when a period repeats a barcode, whatever the insert order', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_SINGLE, 'trendyol-plus-tariff.xlsx');

    // A single-period tariff whose period lists the same barcode TWICE, both opted into
    // Plus with a different custom price. The rows are inserted in REVERSE sortOrder (1
    // first, then 0), so insertion/heap order alone would let the sortOrder-0 row win the
    // barcode -> price map. The export's item orderBy (sortOrder asc, as the detail screen
    // lists them) must make the sortOrder-1 row, listed last, the one that is written.
    const periods = await prisma.plusCommissionTariffPeriod.findMany({ where: { tariffId } });
    expect(periods).toHaveLength(1);
    const periodId = periods[0]?.id;
    if (periodId === undefined) return;
    await prisma.plusCommissionTariffItem.deleteMany({ where: { periodId } });
    const mkItem = async (sortOrder: number, customPrice: string): Promise<void> => {
      await prisma.plusCommissionTariffItem.create({
        data: {
          organizationId: ctx.orgId,
          storeId: ctx.storeId,
          periodId,
          barcode: SINGLE_BARCODE,
          productTitle: 'Test',
          sortOrder,
          currentPrice: '300.00',
          commissionBasePrice: '300.00',
          currentCommissionPct: '19',
          plusPriceUpperLimit: '300.00',
          plusCommissionPct: '15',
          plusCommissionBasePrice: '300.00',
          plusSelected: true,
          customPrice,
        },
      });
    };
    await mkItem(1, '250.00');
    await mkItem(0, '200.00');

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME_FRAGMENT);

    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    const row = rowFor(grid, layout, SINGLE_BARCODE);
    expect(row).toBeDefined();
    expect(num(row, column(layout, 'plusPriceSelection'))).toBe(250);
  });

  it('exports the source verbatim (one xlsx, no 409) when nothing is opted in', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_SINGLE, 'trendyol-plus-tariff.xlsx');

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME_FRAGMENT);

    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    const row = rowFor(grid, layout, SINGLE_BARCODE);
    // Nothing patched: the Plus opt-in cell stays empty.
    expect(cellText(row ?? [], column(layout, 'plusPriceSelection'))).toBeNull();
    // Still marked exported (a re-download is a legitimate no-op export).
    const listed = await prisma.plusCommissionTariff.findUnique({ where: { id: tariffId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('returns 409 when the tariff has no stored source file', async () => {
    const ctx = await setupStore();
    // Seed a tariff directly, so no source file was ever stored.
    const tariff = await prisma.plusCommissionTariff.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: 'No Source Plus Tariff',
      },
    });

    const res = await exportTariff(ctx, tariff.id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('STORED_FILE_MISSING');
  });

  it('returns 409 when the stored source file is unreadable', async () => {
    const ctx = await setupStore();
    // Seed a tariff directly with stored bytes that are not a workbook at all.
    const tariff = await prisma.plusCommissionTariff.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: 'Unreadable Source Plus Tariff',
        sourceFile: new Uint8Array(Buffer.from('not a workbook')),
      },
    });

    const res = await exportTariff(ctx, tariff.id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('STORED_FILE_UNREADABLE');
  });
});

const ProblemSchema = z.object({
  code: z.string(),
  errors: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
});

describe('plus-commission-tariff import: a value the export writes back', () => {
  // Sheet row 2, the first kept row of the single-period fixture, is SINGLE_BARCODE's.
  const FIRST_KEPT_ROW = 2;

  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  /** The single-period fixture with one number cell of its first kept row replaced. */
  async function singleWithCell(
    col: (layout: ResolvedLayout) => ColumnIndex,
    value: string,
  ): Promise<Buffer> {
    const { grid, layout } = await readParsed(FIXTURE_SINGLE);
    expect(cellText(grid[FIRST_KEPT_ROW - 1] ?? [], column(layout, 'barcode'))).toBe(
      SINGLE_BARCODE,
    );
    const target = col(layout);
    if (target === null) throw new Error('the fixture has no such column');
    return patchFixture(
      FIXTURE_SINGLE,
      [{ excelRow: FIRST_KEPT_ROW, col: target, value: { kind: 'number', value } }],
      { sheet: { by: 'name', name: SHEET_NAME } },
    );
  }

  function offerColumn(layout: ResolvedLayout): ColumnIndex {
    return layout.blocks.get('periods')?.[0]?.columns.get('offer') ?? null;
  }

  it('stores an Excel float residue offer rounded to four decimals and exports the rounded value', async () => {
    const ctx = await setupStore();
    const file = await singleWithCell(offerColumn, '15.400000000000002');

    const tariffId = await importFixture(ctx, file, 'trendyol-plus-tariff.xlsx');
    const item = await prisma.plusCommissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, barcode: SINGLE_BARCODE },
    });
    expect(item?.plusCommissionPct.toString()).toBe('15.4');
    await prisma.plusCommissionTariffItem.update({
      where: { id: item?.id },
      data: { plusSelected: true },
    });

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    const row = rowFor(grid, layout, SINGLE_BARCODE);
    expect(cellText(row ?? [], periodsOf(layout)[0]?.computedCommissionCol ?? null)).toBe('15.4');
  });

  it('refuses a negative Plus price ceiling with 422 MALFORMED_SHEET and stores nothing', async () => {
    const ctx = await setupStore();
    const file = await singleWithCell((layout) => column(layout, 'plusPriceUpperLimit'), '-5');

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), 'trendyol-plus-tariff.xlsx');
    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/import`,
        { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
      ),
    );

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    expect(
      await prisma.plusCommissionTariff.count({
        where: { organizationId: ctx.orgId, storeId: ctx.storeId },
      }),
    ).toBe(0);
  });
});

describe('plus-commission-tariff export: an unknown Plus price upper limit', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
    // With these cases the file sends more imports than RATE_LIMITS.FILE_IMPORT allows per
    // minute with the same pooled user; give each test a fresh bucket.
    _resetRateLimitStoreForTests();
  });

  // Gives the imported SINGLE_BARCODE item an unknown Plus price upper limit (NULL: the
  // file's cell was blank, unreadable or 0, and so is the Plus commission base it falls
  // back to) and the given opt-in.
  async function withUnknownCeiling(
    ctx: Ctx,
    data: { readonly plusSelected: boolean; readonly customPrice: string | null },
  ): Promise<void> {
    const item = await prisma.plusCommissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, barcode: SINGLE_BARCODE },
    });
    expect(item).not.toBeNull();
    await prisma.plusCommissionTariffItem.update({
      where: { id: item?.id },
      data: {
        plusPriceUpperLimit: null,
        plusCommissionBasePrice: null,
        plusSelected: data.plusSelected,
        customPrice: data.customPrice,
      },
    });
  }

  async function exportedAt(tariffId: string): Promise<Date | null | undefined> {
    const stored = await prisma.plusCommissionTariff.findUnique({ where: { id: tariffId } });
    return stored?.exportedAt;
  }

  it('answers 409 SELECTION_PRICE_UNKNOWN for a joined item with no custom price and an unknown ceiling, and does not mark the tariff exported', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_SINGLE, 'trendyol-plus-tariff.xlsx');

    // Joined at the ceiling, but the ceiling is unknown: the export must refuse instead of
    // writing a made-up 0.00.
    await withUnknownCeiling(ctx, { plusSelected: true, customPrice: null });

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(409);
    expect(ProblemSchema.parse(await res.json()).code).toBe('SELECTION_PRICE_UNKNOWN');

    // No file was built, so the tariff is not marked exported.
    expect(await exportedAt(tariffId)).toBeNull();
  });

  it('exports the custom price of an item whose ceiling is unknown', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_SINGLE, 'trendyol-plus-tariff.xlsx');

    // The same unknown ceiling as the 409 case, but the seller typed a custom price: the
    // custom price is what the export writes.
    await withUnknownCeiling(ctx, { plusSelected: true, customPrice: '512.34' });

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME_FRAGMENT);

    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    const row = rowFor(grid, layout, SINGLE_BARCODE);
    expect(row).toBeDefined();
    expect(cellText(row ?? [], column(layout, 'plusPriceSelection'))).toBe('512.34');
    expect(await exportedAt(tariffId)).not.toBeNull();
  });

  it('exports the other products normally when an item with an unknown ceiling is not joined', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_SINGLE, 'trendyol-plus-tariff.xlsx');

    // SINGLE_BARCODE has an unknown ceiling and is not joined; another product, whose
    // ceiling the file gives, is joined at its ceiling.
    await withUnknownCeiling(ctx, { plusSelected: false, customPrice: null });
    const other = await prisma.plusCommissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, barcode: { not: SINGLE_BARCODE } },
      orderBy: { sortOrder: 'asc' },
    });
    expect(other).not.toBeNull();
    if (other === null) return;
    expect(other.plusPriceUpperLimit).not.toBeNull();
    if (other.plusPriceUpperLimit === null) return;
    await prisma.plusCommissionTariffItem.update({
      where: { id: other.id },
      data: { plusSelected: true, customPrice: null },
    });

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME_FRAGMENT);

    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    // The joined product carries its ceiling.
    const joined = rowFor(grid, layout, other.barcode);
    expect(joined).toBeDefined();
    expect(num(joined, column(layout, 'plusPriceSelection'))).toBe(
      Number(other.plusPriceUpperLimit),
    );
    // The product with the unknown ceiling is left exactly as the source file had it: no
    // price written (no 0.00), its opt-in cells untouched.
    const source = await readParsed(FIXTURE_SINGLE);
    const sourceRow = rowFor(source.grid, source.layout, SINGLE_BARCODE) ?? [];
    const unknown = rowFor(grid, layout, SINGLE_BARCODE);
    expect(unknown).toBeDefined();
    expect(cellText(unknown ?? [], column(layout, 'plusPriceSelection'))).toBeNull();
    const optInColumns: readonly PlusColumn[] = [
      'plusPriceSelection',
      'tariffSelection',
      'cancelled',
    ];
    for (const key of optInColumns) {
      expect(cellText(unknown ?? [], column(layout, key))).toBe(
        cellText(sourceRow, column(source.layout, key)),
      );
    }
    expect(await exportedAt(tariffId)).not.toBeNull();
  });
});
