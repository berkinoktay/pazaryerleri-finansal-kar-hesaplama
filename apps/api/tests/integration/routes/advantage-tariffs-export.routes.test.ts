// Round-trip tests for the Advantage import -> select -> export chain, plus the
// no-source 409.
//
// Export is the proof that matters: import Trendyol's real Advantage file (which
// keeps the raw bytes as the source), pick a tier + custom price for a product,
// export, and assert the route returns the patched .xlsx (a file the seller can
// re-upload to Trendyol) and marks the tariff exported. A tariff with no stored
// source file returns 409.

import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { cellText } from '@/lib/xlsx-grid-cells';
import { resolveAdvantageTariffLayout } from '@/services/advantage-tariff-layout';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const FIXTURE = readFileSync(
  new URL(
    '../../../../../docs/excel-examples/trendyol_avantajli_urun_etiketleri.xlsx',
    import.meta.url,
  ),
);
const SHEET_NAME = 'YıldızlıÜrünEtiketleri';
const XLSX_MIME = 'spreadsheetml';
const NEW_PRICE = '250.00';

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
  form.append(
    'file',
    new Blob([new Uint8Array(FIXTURE)]),
    'trendyol_avantajli_urun_etiketleri.xlsx',
  );
  const res = await app.request(
    new Request(
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/advantage-tariffs/import`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
    ),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { tariffId: string }).tariffId;
}

describe('advantage-tariff export', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('exports a re-uploadable .xlsx after a product tier is chosen', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx);

    // Pick a tier + custom price for the first item so the export has something to
    // patch into the "YENİ TSF" column.
    const item = await prisma.advantageTariffItem.findFirst({
      where: { storeId: ctx.storeId, tariffId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(item).not.toBeNull();
    await prisma.advantageTariffItem.update({
      where: { id: item?.id },
      data: { selectedTier: 'tier1', customPrice: NEW_PRICE },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/advantage-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_MIME);

    // A real, non-empty .xlsx byte stream (PK zip magic) came back.
    const out = Buffer.from(await res.arrayBuffer());
    expect(out.length).toBeGreaterThan(0);
    expect(out.subarray(0, 2).toString('ascii')).toBe('PK');

    // Round-trip the exported file back through the reader and assert the chosen
    // new price was patched into the "YENİ TSF (FİYAT GÜNCELLE)" cell for the row.
    const grid = await readWorkbookGrid(out, { sheetName: SHEET_NAME });
    const layout = resolveAdvantageTariffLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();
    const dataRow = grid.slice(1).find((r) => cellText(r, layout?.barcode ?? -1) === item?.barcode);
    expect(dataRow).toBeDefined();
    // Numeric cell: compare by value (trailing zeros normalize on read).
    expect(Number(cellText(dataRow ?? [], layout?.newTsf ?? -1))).toBe(Number(NEW_PRICE));

    // The tariff is now marked exported.
    const listed = await prisma.advantageTariff.findUnique({ where: { id: tariffId } });
    expect(listed?.exportedAt).not.toBeNull();
  });

  it('marks exported:true in the list after an export', async () => {
    const ctx = await setupStore();
    const tariffId = await importFixture(ctx);
    const item = await prisma.advantageTariffItem.findFirst({
      where: { storeId: ctx.storeId, tariffId },
      orderBy: { sortOrder: 'asc' },
    });
    await prisma.advantageTariffItem.update({
      where: { id: item?.id },
      data: { selectedTier: 'tier1', customPrice: NEW_PRICE },
    });
    await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/advantage-tariffs/${tariffId}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );

    const list = (await (
      await app.request(`/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/advantage-tariffs`, {
        headers: { Authorization: bearer(ctx.accessToken) },
      })
    ).json()) as { data: { id: string; exported: boolean }[] };
    expect(list.data.find((t) => t.id === tariffId)?.exported).toBe(true);
  });

  it('returns 409 when the tariff has no stored source file', async () => {
    const ctx = await setupStore();
    // Seed a tariff directly, so no source file was ever stored.
    const tariff = await prisma.advantageTariff.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: 'No Source Advantage Tariff',
      },
    });

    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/advantage-tariffs/${tariff.id}/export`,
      { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('CONFLICT');
  });
});
