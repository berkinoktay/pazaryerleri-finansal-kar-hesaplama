// Round-trip tests for the import → select → export chain, plus the variable
// period count (a 1-period competitor file).
//
// Export round-trip is the proof that matters: import Trendyol's real 2-period
// file, select a band for one product, export, then re-parse the produced file
// and assert ONLY that product's "YENİ TSF" + "Tarife Seçimi" cells changed (to
// the band price + "{N} Günlük Fiyat") and every other row is untouched — i.e. a
// file the seller can re-upload to Trendyol verbatim.

import { readFileSync } from 'node:fs';

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
});
