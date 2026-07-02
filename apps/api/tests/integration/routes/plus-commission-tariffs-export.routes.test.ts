// Round-trip tests for the Plus import -> select -> export chain, plus the
// no-source 409.
//
// Export is the proof that matters: import Trendyol's real Plus file (which keeps
// the raw bytes as the source), opt one product into Plus, export, and assert the
// route returns the patched .xlsx (a file the seller can re-upload to Trendyol)
// and marks the tariff exported. A tariff with no stored source file returns 409.

import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { cellText } from '@/lib/xlsx-grid-cells';
import { resolvePlusTariffLayout } from '@/services/plus-commission-tariff-layout';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const FIXTURE = readFileSync(new URL('../../fixtures/trendyol-plus-tariff.xlsx', import.meta.url));
const XLSX_MIME = 'spreadsheetml';

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

async function importFixture(ctx: Ctx): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(FIXTURE)]), 'trendyol-plus-tariff.xlsx');
  const res = await app.request(
    new Request(
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { tariffId: string }).tariffId;
}

describe('plus-commission-tariff export', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('exports a re-uploadable .xlsx after a product is opted into Plus', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx);

    // Opt the first item into Plus so the export has something to patch.
    const item = await prisma.plusCommissionTariffItem.findFirst({
      where: { storeId: ctx.storeId, tariffId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(item).not.toBeNull();
    await prisma.plusCommissionTariffItem.update({
      where: { id: item?.id },
      data: { plusSelected: true },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME);

    // A real, non-empty .xlsx byte stream (PK zip magic) came back.
    const out = Buffer.from(await res.arrayBuffer());
    expect(out.length).toBeGreaterThan(0);
    expect(out.subarray(0, 2).toString('ascii')).toBe('PK');

    // Round-trip the exported file back through the reader and assert the four
    // opted-in cells match Trendyol's filled-export format (confirmed from the
    // melontik sample): Plus Fiyat Seçimi = the ceiling price, Tarife Seçimi =
    // "7 Günlük Fiyat", Hesaplanan Komisyon = the Plus commission, İptal = "Hayır".
    const grid = await readWorkbookGrid(out, { sheetName: 'TyPlusÜrünleri' });
    const layout = resolvePlusTariffLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();
    const dataRow = grid.slice(1).find((r) => cellText(r, layout?.barcode ?? -1) === item?.barcode);
    expect(dataRow).toBeDefined();
    const row = dataRow ?? [];
    // Numeric cells: compare by value (trailing zeros normalize on read).
    expect(Number(cellText(row, layout?.plusPriceSelection ?? -1))).toBe(
      Number(item?.plusPriceUpperLimit),
    );
    expect(Number(cellText(row, layout?.computedCommission ?? -1))).toBe(
      Number(item?.plusCommissionPct),
    );
    // String cells: exact.
    expect(cellText(row, layout?.tariffSelection ?? -1)).toBe('7 Günlük Fiyat');
    expect(cellText(row, layout?.cancelled ?? -1)).toBe('Hayır');

    // The tariff is now marked exported.
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
        dateRangeLabel: '30 Haziran - 7 Temmuz',
      },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/${tariff.id}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('CONFLICT');
  });
});
