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
// stored source file returns 409.

import { readFileSync } from 'node:fs';

import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid, type SheetData } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { cellText } from '@/lib/xlsx-grid-cells';
import { patchXlsxCells, type XlsxCellValue } from '@/lib/xlsx-patch';
import {
  resolvePlusTariffLayout,
  type PlusTariffLayout,
} from '@/services/plus-commission-tariff-layout';

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

async function readParsed(buf: Buffer): Promise<{ grid: SheetData; layout: PlusTariffLayout }> {
  const grid = await readWorkbookGrid(buf, { sheetName: SHEET_NAME });
  const layout = resolvePlusTariffLayout(grid[0] ?? []);
  if (layout === null) throw new Error('unreadable Plus export');
  return { grid, layout };
}

function rowFor(
  grid: SheetData,
  layout: PlusTariffLayout,
  barcode: string,
): readonly unknown[] | undefined {
  return grid.slice(1).find((r) => cellText(r, layout.barcode) === barcode);
}

function num(row: readonly unknown[] | undefined, col: number): number {
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
    expect(num(row, layout.plusPriceSelection)).toBe(Number(item?.plusPriceUpperLimit));
    expect(cellText(row ?? [], layout.tariffSelection)).toBe('7 Günlük Fiyat');
    expect(num(row, layout.periods[0]?.computedCommissionCol ?? -1)).toBe(
      Number(item?.plusCommissionPct),
    );
    expect(cellText(row ?? [], layout.cancelled)).toBe('Hayır');

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
    expect(num(r3, three.layout.plusPriceSelection)).toBe(700);
    expect(cellText(r3 ?? [], three.layout.tariffSelection)).toBe('3 Günlük Fiyat');
    expect(num(r3, three.layout.periods[0]?.computedCommissionCol ?? -1)).toBe(MULTI_OFFER_3DAY);
    expect(num(r3, three.layout.periods[1]?.computedCommissionCol ?? -1)).toBe(0);

    // 4-gunluk file: price 650, "4 Günlük Fiyat", ONLY the 4-Gün commission (13.1).
    const four = await readParsed(
      Buffer.from(entries['plus-komisyon-tarifesi-4-gunluk.xlsx'] ?? new Uint8Array()),
    );
    const r4 = rowFor(four.grid, four.layout, MULTI_BARCODE);
    expect(num(r4, four.layout.plusPriceSelection)).toBe(650);
    expect(cellText(r4 ?? [], four.layout.tariffSelection)).toBe('4 Günlük Fiyat');
    expect(num(r4, four.layout.periods[1]?.computedCommissionCol ?? -1)).toBe(MULTI_OFFER_4DAY);
    expect(num(r4, four.layout.periods[0]?.computedCommissionCol ?? -1)).toBe(0);
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
    expect(num(row, layout.plusPriceSelection)).toBe(MULTI_CEILING);
    expect(cellText(row ?? [], layout.tariffSelection)).toBe('7 Günlük Fiyat');
    // One price, but a commission cell per sub-period, each at its OWN percent.
    expect(num(row, layout.periods[0]?.computedCommissionCol ?? -1)).toBe(MULTI_OFFER_3DAY);
    expect(num(row, layout.periods[1]?.computedCommissionCol ?? -1)).toBe(MULTI_OFFER_4DAY);
    expect(cellText(row ?? [], layout.cancelled)).toBe('Hayır');

    // A product NOT opted in keeps its opt-in cells at the fixture defaults (untouched).
    const other = grid.slice(1).find((r) => {
      const bc = cellText(r, layout.barcode);
      return bc !== null && bc !== MULTI_BARCODE;
    });
    expect(cellText(other ?? [], layout.plusPriceSelection)).toBeNull();
    expect(cellText(other ?? [], layout.tariffSelection)).toBeNull();
  });

  it('writes the commission into the layout column matched by dayCount, not by position, when import drops a period', async () => {
    const ctx = await setupStore();

    // Blank the FIRST period block's (3 Gün) date label on the first data row, so import's
    // "present" filter drops it. The surviving DB period (4 Gün) is then a SUBSEQUENCE of
    // the raw layout's two periods: a positional layout lookup would land the commission
    // in the 3-Gün column, whereas the dayCount match must put it in the 4-Gün column.
    const { grid: fixtureGrid, layout: fixtureLayout } = await readParsed(FIXTURE_MULTI);
    const firstPeriod = fixtureLayout.periods[0];
    const secondPeriod = fixtureLayout.periods[1];
    expect(firstPeriod).toBeDefined();
    expect(secondPeriod).toBeDefined();
    if (firstPeriod === undefined || secondPeriod === undefined) return;

    // The 3-Gün commission column's value in the untouched source, to prove export never
    // overwrites it (the fixture default here is a literal 0, not an empty cell).
    const originalThreeCommission = cellText(
      rowFor(fixtureGrid, fixtureLayout, MULTI_BARCODE) ?? [],
      firstPeriod.computedCommissionCol,
    );

    const blankFirstLabel = new Map<number, Map<number, XlsxCellValue>>([
      [
        2,
        new Map<number, XlsxCellValue>([[firstPeriod.labelCol, { kind: 'inlineStr', value: '' }]]),
      ],
    ]);
    const blanked = patchXlsxCells(FIXTURE_MULTI, blankFirstLabel);
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

  it('exports the source verbatim (one xlsx, no 409) when nothing is opted in', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_SINGLE, 'trendyol-plus-tariff.xlsx');

    const res = await exportTariff(ctx, tariffId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME_FRAGMENT);

    const { grid, layout } = await readParsed(Buffer.from(await res.arrayBuffer()));
    const row = rowFor(grid, layout, SINGLE_BARCODE);
    // Nothing patched: the Plus opt-in cell stays empty.
    expect(cellText(row ?? [], layout.plusPriceSelection)).toBeNull();
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
    expect(((await res.json()) as { code: string }).code).toBe('CONFLICT');
  });
});
