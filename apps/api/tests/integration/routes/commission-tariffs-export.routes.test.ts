// Round-trip tests for the import → select → export chain, plus the variable
// period count (a 1-period competitor file).
//
// Export round-trip is the proof that matters: import Trendyol's real 2-period
// file, select a band for one product, export, then re-parse the produced file
// and assert ONLY that product's "YENİ TSF" + "Tarife Seçimi" cells changed (to
// the band price + "{N} Günlük Fiyat") and every other row is untouched — i.e. a
// file the seller can re-upload to Trendyol verbatim.

import { readFileSync } from 'node:fs';

import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { resolveTariffLayout as resolveLayout } from '@/services/commission-tariff-layout';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const FIXTURE_2P = readFileSync(
  new URL('../../fixtures/trendyol-commission-tariff.xlsx', import.meta.url),
);
const FIXTURE_1P = readFileSync(
  new URL('../../fixtures/trendyol-tariff-1period.xlsx', import.meta.url),
);
const MATCHED_BARCODE = 'TB200X300A';

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
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { tariffId: string }).tariffId;
}

function text(row: readonly unknown[] | undefined, idx: number): string | null {
  const v = row?.[idx];
  if (v === null || v === undefined) return null;
  return String(v);
}

interface BandSel {
  readonly band: string;
  readonly price: string;
}

// Reshape an imported tariff into a genuine 2-period (3-Gün + 4-Gün) tariff with a
// single selected product, to exercise the split-export path. No commission fixture
// imports as two periods (the real 2-period file's 3-Gün block carries no date data,
// so import keeps only one), and export patches only the source xlsx's single
// YENİ TSF / Tarife Seçimi columns — present in any tariff file — so reshaping the
// DB periods is a faithful stand-in. 3-Gün is sortOrder 0 (the "main" window).
async function reshapeToTwoPeriods(
  ctx: Ctx,
  tariffId: string,
  sel: { p3: BandSel | null; p4: BandSel | null },
): Promise<void> {
  await prisma.commissionTariffPeriod.deleteMany({ where: { tariffId } });
  const mk = async (dayCount: number, sortOrder: number, s: BandSel | null): Promise<void> => {
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        tariffId,
        dateRangeLabel: `${dayCount} Gün`,
        dayCount,
        sortOrder,
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        periodId: period.id,
        barcode: MATCHED_BARCODE,
        productTitle: 'Test',
        currentPrice: '285.00',
        currentCommissionPct: '0.19',
        bands: s === null ? [] : [{ key: s.band, upperLimit: s.price, commissionPct: '19' }],
        selectedBand: s?.band ?? null,
      },
    });
  };
  await mk(3, 0, sel.p3);
  await mk(4, 1, sel.p4);
}

describe('commission-tariff export + variable periods', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('imports a 1-period (7-day) competitor file with shifted columns', async () => {
    const ctx = await setupStore();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(FIXTURE_1P)]), 'melontik.xlsx');
    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/import`,
        { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { periodCount: number; productCount: number };
    expect(body.periodCount).toBe(1);
    expect(body.productCount).toBeGreaterThan(40);

    const period = await prisma.commissionTariffPeriod.findFirst({
      where: { storeId: ctx.storeId },
    });
    expect(period?.dayCount).toBe(7);
  });

  it('exports a re-uploadable file with the selected band patched into YENİ TSF + Tarife Seçimi', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_2P, 'tariff.xlsx');

    // Select band2 for the matched product (its 2.Fiyat Üst Limiti = 777.09).
    const item = await prisma.commissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, barcode: MATCHED_BARCODE },
    });
    expect(item).not.toBeNull();
    await prisma.commissionTariffItem.update({
      where: { id: item?.id },
      data: { selectedBand: 'band2' },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    // Even a lone (non-zip) file uses the fixed, self-describing base name + its window
    // so the seller can't mix files up (not the opaque uploaded Trendyol filename).
    expect(res.headers.get('content-disposition')).toContain('urun-komisyon-tarifesi-4-gunluk');

    // Re-parse the produced file and verify the patch landed on the right row.
    const out = Buffer.from(await res.arrayBuffer());
    const grid = await readWorkbookGrid(out);
    const layout = resolveLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();
    if (layout === null) return;

    const dataRows = grid.slice(1);
    const patched = dataRows.find((r) => text(r, layout.fixed.barcode) === MATCHED_BARCODE);
    expect(Number(text(patched, layout.newTsf))).toBe(777.09);
    expect(text(patched, layout.tariffSelection)).toBe('4 Günlük Fiyat');

    // A different, unselected product keeps an empty YENİ TSF.
    const untouched = dataRows.find(
      (r) =>
        text(r, layout.fixed.barcode) !== MATCHED_BARCODE && text(r, layout.fixed.barcode) !== null,
    );
    expect(text(untouched, layout.newTsf)).toBeNull();

    // The tariff is now marked exported.
    const listed = await prisma.commissionTariff.findUnique({ where: { id: tariffId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('exports the source verbatim (one xlsx, no 409) when nothing is selected', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_2P, 'tariff.xlsx');

    // No band/custom selection at all — a re-download must still return the original
    // file, not error, matching the pre-per-period behavior.
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');

    const grid = await readWorkbookGrid(Buffer.from(await res.arrayBuffer()));
    const layout = resolveLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();
    if (layout === null) return;
    const matched = grid.slice(1).find((r) => text(r, layout.fixed.barcode) === MATCHED_BARCODE);
    // Untouched: no YENİ TSF written for any product.
    expect(text(matched, layout.newTsf)).toBeNull();
  });

  it('exports band 1 lower limit ("ve üzeri" boundary), not the current price', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_2P, 'tariff.xlsx');

    // band1 is open-topped ("X ve üzeri", no upper limit). Give the matched item a band1
    // whose lower limit (600) sits ABOVE its current price (285), then select band1: the
    // export must write band1's shown floor (600) — the boundary the seller sees — NOT the
    // current price. Writing the current price here was the bug.
    const item = await prisma.commissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, barcode: MATCHED_BARCODE },
    });
    expect(item).not.toBeNull();
    await prisma.commissionTariffItem.update({
      where: { id: item?.id },
      data: {
        currentPrice: '285.00',
        selectedBand: 'band1',
        bands: [{ key: 'band1', lowerLimit: '600.00', commissionPct: '19' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);

    const out = Buffer.from(await res.arrayBuffer());
    const grid = await readWorkbookGrid(out);
    const layout = resolveLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();
    if (layout === null) return;
    const patched = grid.slice(1).find((r) => text(r, layout.fixed.barcode) === MATCHED_BARCODE);
    expect(Number(text(patched, layout.newTsf))).toBe(600.0);
  });

  // Reads the matched product's patched (newTsf, tariffSelection) from one zip entry.
  async function readEntry(
    entries: Record<string, Uint8Array>,
    name: string | undefined,
  ): Promise<{ newTsf: number; selection: string | null }> {
    if (name === undefined) throw new Error('expected zip entry missing');
    const grid = await readWorkbookGrid(Buffer.from(entries[name] ?? new Uint8Array()));
    const layout = resolveLayout(grid[0] ?? []);
    if (layout === null) throw new Error('unreadable export');
    const row = grid.slice(1).find((r) => text(r, layout.fixed.barcode) === MATCHED_BARCODE);
    return {
      newTsf: Number(text(row, layout.newTsf)),
      selection: text(row, layout.tariffSelection),
    };
  }

  it('splits a week into one zipped file PER sub-period, each labelled for its window', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_2P, 'tariff.xlsx');

    // Different price per sub-period (3-Gün → 777.09, 4-Gün → 900.00). Each period gets
    // its OWN file so the seller re-uploads each to its tab; the two are zipped together.
    await reshapeToTwoPeriods(ctx, tariffId, {
      p3: { band: 'band2', price: '777.09' },
      p4: { band: 'band3', price: '900.00' },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('zip');

    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(entries);
    expect(names.sort()).toEqual([
      'urun-komisyon-tarifesi-3-gunluk.xlsx',
      'urun-komisyon-tarifesi-4-gunluk.xlsx',
    ]);

    const three = await readEntry(
      entries,
      names.find((n) => /-3-gunluk\.xlsx$/i.test(n)),
    );
    expect(three.newTsf).toBe(777.09);
    expect(three.selection).toBe('3 Günlük Fiyat');

    const four = await readEntry(
      entries,
      names.find((n) => /-4-gunluk\.xlsx$/i.test(n)),
    );
    expect(four.newTsf).toBe(900.0);
    expect(four.selection).toBe('4 Günlük Fiyat');
  });

  it('collapses a same-price product into a single "7 Günlük Fiyat" file', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx, FIXTURE_2P, 'tariff.xlsx');

    // Same price (777.09) marked in BOTH sub-periods = whole-week → one "7 Günlük Fiyat"
    // file (a lone xlsx, not a zip); the product does NOT appear in the 3-/4-gün files.
    await reshapeToTwoPeriods(ctx, tariffId, {
      p3: { band: 'band2', price: '777.09' },
      p4: { band: 'band2', price: '777.09' },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toContain('7-gunluk');

    const grid = await readWorkbookGrid(Buffer.from(await res.arrayBuffer()));
    const layout = resolveLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();
    if (layout === null) return;
    const patched = grid.slice(1).find((r) => text(r, layout.fixed.barcode) === MATCHED_BARCODE);
    expect(Number(text(patched, layout.newTsf))).toBe(777.09);
    expect(text(patched, layout.tariffSelection)).toBe('7 Günlük Fiyat');
  });
});
