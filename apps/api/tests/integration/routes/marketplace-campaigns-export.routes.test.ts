// The marketplace campaign export through its route, end to end on the real Trendyol
// file imported through the import route:
//   - a MAX and a CUSTOM selection write their prices into the campaign price cells,
//     and every other cell of the sheet reads as in the stored file;
//   - a campaign with no selection streams the stored bytes back;
//   - an item whose barcode no longer matches its row is 409 ROW_MISMATCH, and the
//     campaign is not marked exported;
//   - a viewer granted the store may not export;
//   - a file whose maximum price MAX could not write is refused at import.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { CampaignPriceSelection } from '@pazarsync/db/enums';
import { cellDecimal, columnIndex, readWorkbookGrid, resolveLayout } from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import { trendyolMarketplaceCampaignListFormat } from '@/workbooks/formats/trendyol/marketplace-campaign-list.format';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

const FIXTURE = readFileSync(
  new URL('../../fixtures/marketplace-campaign-sample.xlsx', import.meta.url),
);
const format = trendyolMarketplaceCampaignListFormat;

const IMPORT_CONFIG = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '10',
  trendyolFundingPct: '40',
  startsAt: '2026-09-10T09:00:00.000Z',
  endsAt: '2026-09-14T09:00:00.000Z',
} as const;

/** The seller's own price for the CUSTOM item, below that row's maximum price. */
const CUSTOM_PRICE = '599.90';

const ImportSchema = z.object({ campaignId: z.string() });
const ProblemSchema = z.object({
  code: z.string(),
  errors: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
});

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

function importRequest(ctx: Ctx, file: Buffer = FIXTURE): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), 'trendyol_kampanya.xlsx');
  for (const [key, value] of Object.entries(IMPORT_CONFIG)) form.append(key, value);
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/marketplace-campaigns/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

async function importCampaign(ctx: Ctx): Promise<string> {
  const res = await app.request(importRequest(ctx));
  expect(res.status).toBe(201);
  return ImportSchema.parse(await res.json()).campaignId;
}

function exportRequest(accessToken: string, ctx: Ctx, campaignId: string): Request {
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/marketplace-campaigns/${campaignId}/export`,
    { method: 'POST', headers: { Authorization: bearer(accessToken) } },
  );
}

async function storedCampaign(
  ctx: Ctx,
  campaignId: string,
): Promise<{ exportedAt: Date | null; sourceFile: Uint8Array | null }> {
  const campaign = await prisma.marketplaceCampaignList.findFirst({
    where: { id: campaignId, organizationId: ctx.orgId, storeId: ctx.storeId },
    select: { exportedAt: true, sourceFile: true },
  });
  if (campaign === null) throw new Error('the campaign is gone');
  return campaign;
}

/** The campaign's items in sheet order. */
async function itemsOf(ctx: Ctx, campaignId: string) {
  return prisma.marketplaceCampaignItem.findMany({
    where: { listId: campaignId, organizationId: ctx.orgId, storeId: ctx.storeId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, barcode: true, maxPrice: true },
  });
}

async function updateItem(
  ctx: Ctx,
  itemId: string,
  data: { selection?: CampaignPriceSelection; customPrice?: Decimal; barcode?: string },
): Promise<void> {
  const { count } = await prisma.marketplaceCampaignItem.updateMany({
    where: { id: itemId, organizationId: ctx.orgId, storeId: ctx.storeId },
    data,
  });
  expect(count).toBe(1);
}

beforeEach(() => {
  _resetRateLimitStoreForTests();
});

describe('POST .../marketplace-campaigns/{campaignId}/export', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('writes the MAX and CUSTOM prices and leaves every other cell as stored', async () => {
    const ctx = await setupStore();
    const campaignId = await importCampaign(ctx);
    const [maxItem, customItem] = await itemsOf(ctx, campaignId);
    if (maxItem === undefined || customItem === undefined) throw new Error('too few items');
    await updateItem(ctx, maxItem.id, { selection: CampaignPriceSelection.MAX });
    await updateItem(ctx, customItem.id, {
      selection: CampaignPriceSelection.CUSTOM,
      customPrice: new Decimal(CUSTOM_PRICE),
    });

    const res = await app.request(exportRequest(ctx.accessToken, ctx, campaignId));

    expect(res.status).toBe(200);
    const source = await readWorkbookGrid(FIXTURE, { sheet: format.sheet });
    const exported = await readWorkbookGrid(Buffer.from(await res.arrayBuffer()), {
      sheet: format.sheet,
    });
    const layout = resolveLayout(format.layout, source);
    if (layout === null) throw new Error('the fixture layout does not resolve');
    const priceCol = columnIndex(format.layout, layout, 'campaignPrice');
    const anchorCol = columnIndex(format.layout, layout, 'barcode');
    // Items follow the kept rows in sheet order, and every row of the file is kept.
    const written = new Map<number, string>([
      [1, maxItem.maxPrice.toFixed(2)],
      [2, CUSTOM_PRICE],
    ]);
    expect(source[1]?.[anchorCol ?? -1]).toBe(maxItem.barcode);
    expect(source[2]?.[anchorCol ?? -1]).toBe(customItem.barcode);

    expect(exported).toHaveLength(source.length);
    for (const [index, sourceRow] of source.entries()) {
      const exportedRow = exported[index] ?? [];
      const width = Math.max(sourceRow.length, exportedRow.length);
      for (let col = 0; col < width; col += 1) {
        const price = col === priceCol ? written.get(index) : undefined;
        if (price === undefined) {
          expect(exportedRow[col] ?? null).toEqual(sourceRow[col] ?? null);
          continue;
        }
        expect(sourceRow[col] ?? null).toBeNull();
        const cell = cellDecimal(exportedRow, col, 'plain');
        expect(cell === null ? null : new Decimal(cell).toFixed(2)).toBe(price);
      }
    }
    expect((await storedCampaign(ctx, campaignId)).exportedAt).not.toBeNull();
  });

  it('streams the stored bytes back when no item is selected', async () => {
    const ctx = await setupStore();
    const campaignId = await importCampaign(ctx);

    const res = await app.request(exportRequest(ctx.accessToken, ctx, campaignId));

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    const stored = (await storedCampaign(ctx, campaignId)).sourceFile;
    if (stored === null) throw new Error('the import stored no file');
    expect(Buffer.compare(body, Buffer.from(stored))).toBe(0);
    expect(Buffer.compare(body, FIXTURE)).toBe(0);
  });

  it('answers an item whose barcode no longer matches its row with 409 ROW_MISMATCH', async () => {
    const ctx = await setupStore();
    const campaignId = await importCampaign(ctx);
    const [first] = await itemsOf(ctx, campaignId);
    if (first === undefined) throw new Error('the import stored no item');
    await updateItem(ctx, first.id, {
      barcode: 'CHANGED-BARCODE',
      selection: CampaignPriceSelection.MAX,
    });

    const res = await app.request(exportRequest(ctx.accessToken, ctx, campaignId));

    expect(res.status).toBe(409);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('ROW_MISMATCH');
    expect((await storedCampaign(ctx, campaignId)).exportedAt).toBeNull();
  });

  it('refuses a viewer granted the store with 403', async () => {
    const ctx = await setupStore();
    const campaignId = await importCampaign(ctx);
    const viewer = await createAuthenticatedTestUser();
    const member = await createMembership(ctx.orgId, viewer.id, 'VIEWER');
    await createMemberStoreAccess(ctx.orgId, member.id, ctx.storeId);

    const res = await app.request(exportRequest(viewer.accessToken, ctx, campaignId));

    expect(res.status).toBe(403);
    expect(ProblemSchema.parse(await res.json()).code).toBe('FORBIDDEN');
    expect((await storedCampaign(ctx, campaignId)).exportedAt).toBeNull();
  });

  // A list whose MAX export could not be written is never stored.
  it('refuses at import a negative maximum price with 422 MALFORMED_SHEET and stores nothing', async () => {
    const ctx = await setupStore();
    const layout = resolveLayout(
      format.layout,
      await readWorkbookGrid(FIXTURE, { sheet: format.sheet }),
    );
    if (layout === null) throw new Error('the fixture layout does not resolve');
    const maxPriceCol = columnIndex(format.layout, layout, 'maxPrice');
    if (maxPriceCol === null) throw new Error('the fixture has no maximum price column');
    // Sheet row 2 is the first kept row.
    const file = patchFixture(
      FIXTURE,
      [{ excelRow: 2, col: maxPriceCol, value: { kind: 'number', value: '-5' } }],
      { sheet: format.sheet },
    );

    const res = await app.request(importRequest(ctx, file));

    expect(res.status).toBe(422);
    const body = ProblemSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    expect(
      await prisma.marketplaceCampaignList.count({
        where: { organizationId: ctx.orgId, storeId: ctx.storeId },
      }),
    ).toBe(0);
  });
});
