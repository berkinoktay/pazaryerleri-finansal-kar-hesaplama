// The wire contract every workbook route keeps on the generic pipeline, one row per page
// (each vertical adds its row as it moves): on import, bytes that are not an xlsx, and
// another page's real file, are refused on `file` without writing a row; on export, a
// viewer may not download; both routes are in the OpenAPI document.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

interface ContractRow {
  readonly segment: string;
  /** The record id's path parameter of the export route. */
  readonly idParam: string;
  readonly fixture: string;
  readonly form: Readonly<Record<string, string>>;
  /** A real file of another page, and the page this route must name for it. */
  readonly otherPageFixture: string;
  readonly otherPage: string;
}

const CONTRACT_ROWS: readonly ContractRow[] = [
  {
    segment: 'discount-lists',
    idParam: 'listId',
    fixture: 'trendyol-discount-products.xlsx',
    form: {
      discountType: 'NET',
      valueKind: 'AMOUNT',
      value: '50',
      startsAt: '2026-07-21T05:00:00.000Z',
      endsAt: '2026-07-28T04:59:00.000Z',
    },
    otherPageFixture: 'trendyol-plus-tariff.xlsx',
    otherPage: 'PLUS_COMMISSION_TARIFF',
  },
  {
    segment: 'marketplace-campaigns',
    idParam: 'campaignId',
    fixture: 'marketplace-campaign-sample.xlsx',
    form: {
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      trendyolFundingPct: '40',
      startsAt: '2026-09-10T09:00:00.000Z',
      endsAt: '2026-09-14T09:00:00.000Z',
    },
    otherPageFixture: 'trendyol-discount-products.xlsx',
    otherPage: 'DISCOUNT_LIST',
  },
  {
    segment: 'flash-products',
    idParam: 'listId',
    fixture: 'trendyol-flash-products.xlsx',
    form: {},
    // The flash sheet is read by name; the campaign file has none of that name, so the
    // diagnosis reads its first sheet, the campaign product sheet.
    otherPageFixture: 'marketplace-campaign-sample.xlsx',
    otherPage: 'MARKETPLACE_CAMPAIGN_LIST',
  },
  {
    segment: 'advantage-tariffs',
    idParam: 'tariffId',
    fixture: 'trendyol-advantage-tariff.xlsx',
    form: {},
    // The advantage sheet is read by name; the flash file has none of that name, so the
    // diagnosis reads its first sheet, the flash offer sheet.
    otherPageFixture: 'trendyol-flash-products.xlsx',
    otherPage: 'FLASH_PRODUCT_LIST',
  },
  {
    segment: 'plus-commission-tariffs',
    idParam: 'tariffId',
    fixture: 'trendyol-plus-tariff.xlsx',
    form: {},
    // The Plus sheet is read by name; the advantage file has none of that name, so the
    // diagnosis reads its first sheet, the star label sheet.
    otherPageFixture: 'trendyol-advantage-tariff.xlsx',
    otherPage: 'ADVANTAGE_TARIFF',
  },
  {
    segment: 'commission-tariffs',
    idParam: 'tariffId',
    fixture: 'trendyol-commission-tariff.xlsx',
    form: {},
    // The commission sheet is read by name; the Plus file has none of that name, so the
    // diagnosis reads its first sheet, the Plus product sheet.
    otherPageFixture: 'trendyol-plus-tariff.xlsx',
    otherPage: 'PLUS_COMMISSION_TARIFF',
  },
];

/**
 * The two tariff pages share headers (barcode, current price, tariff selection), so each
 * page's real file is also tried on the other page's route, both directions: the
 * diagnosis must still name the right page.
 */
const TARIFF_CROSS_ROWS: readonly ContractRow[] = [
  {
    segment: 'plus-commission-tariffs',
    idParam: 'tariffId',
    fixture: 'trendyol-plus-tariff.xlsx',
    form: {},
    otherPageFixture: 'trendyol-commission-tariff.xlsx',
    otherPage: 'COMMISSION_TARIFF',
  },
  {
    segment: 'commission-tariffs',
    idParam: 'tariffId',
    fixture: 'trendyol-commission-tariff.xlsx',
    form: {},
    otherPageFixture: 'trendyol-plus-tariff-3ve4.xlsx',
    otherPage: 'PLUS_COMMISSION_TARIFF',
  },
];

const NOT_XLSX = Buffer.from('this is plain text, not a zip archive');

const IssuesSchema = z.object({
  code: z.string(),
  errors: z.array(
    z.object({
      field: z.string(),
      code: z.string(),
      meta: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

function fixture(name: string): Buffer {
  return readFileSync(new URL(`../../fixtures/${name}`, import.meta.url));
}

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

function importRequest(ctx: Ctx, row: ContractRow, file: Buffer): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), 'upload.xlsx');
  for (const [key, value] of Object.entries(row.form)) form.append(key, value);
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/${row.segment}/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

/** Rows of the six workbook parent tables and their item tables. */
async function workbookRowCounts(): Promise<Record<string, number>> {
  const [
    commission,
    commissionItems,
    plus,
    plusItems,
    advantage,
    advantageItems,
    flash,
    flashItems,
    discount,
    discountItems,
    campaign,
    campaignItems,
  ] = await Promise.all([
    prisma.commissionTariff.count(),
    prisma.commissionTariffItem.count(),
    prisma.plusCommissionTariff.count(),
    prisma.plusCommissionTariffItem.count(),
    prisma.advantageTariff.count(),
    prisma.advantageTariffItem.count(),
    prisma.flashProductList.count(),
    prisma.flashProductItem.count(),
    prisma.discountList.count(),
    prisma.discountListItem.count(),
    prisma.marketplaceCampaignList.count(),
    prisma.marketplaceCampaignItem.count(),
  ]);
  return {
    commission,
    commissionItems,
    plus,
    plusItems,
    advantage,
    advantageItems,
    flash,
    flashItems,
    discount,
    discountItems,
    campaign,
    campaignItems,
  };
}

const OPENAPI_INFO = { openapi: '3.1.0', info: { title: 'contract', version: '1' } } as const;

beforeEach(() => {
  _resetRateLimitStoreForTests();
});

describe.each(CONTRACT_ROWS)('workbook import contract: $segment', (row) => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('refuses bytes that are not an xlsx with 422 NOT_XLSX and writes nothing', async () => {
    const ctx = await setupStore();
    const before = await workbookRowCounts();

    const res = await app.request(importRequest(ctx, row, NOT_XLSX));

    expect(res.status).toBe(422);
    const body = IssuesSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual([{ field: 'file', code: 'NOT_XLSX' }]);
    expect(await workbookRowCounts()).toEqual(before);
  });

  it("names another page's real file and writes nothing", async () => {
    const ctx = await setupStore();
    const before = await workbookRowCounts();

    const res = await app.request(importRequest(ctx, row, fixture(row.otherPageFixture)));

    expect(res.status).toBe(422);
    const body = IssuesSchema.parse(await res.json());
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.field).toBe('file');
    expect(body.errors[0]?.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(body.errors[0]?.meta?.['detectedPage']).toBe(row.otherPage);
    expect(body.errors[0]?.meta?.['detectedFormatId']).toMatch(/.+/);
    expect(await workbookRowCounts()).toEqual(before);
  });

  it('imports its own real file', async () => {
    const ctx = await setupStore();

    const res = await app.request(importRequest(ctx, row, fixture(row.fixture)));

    expect(res.status).toBe(201);
  });

  it('is in the OpenAPI document', () => {
    const document = app.getOpenAPI31Document(OPENAPI_INFO);
    const path =
      document.paths?.[`/v1/organizations/{orgId}/stores/{storeId}/${row.segment}/import`];

    expect(path?.post).toBeDefined();
  });

  it('refuses a viewer granted the store on the export route with 403', async () => {
    const viewer = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const member = await createMembership(org.id, viewer.id, 'VIEWER');
    const store = await createStore(org.id);
    await createMemberStoreAccess(org.id, member.id, store.id);

    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${org.id}/stores/${store.id}/${row.segment}/${crypto.randomUUID()}/export`,
        { method: 'POST', headers: { Authorization: bearer(viewer.accessToken) } },
      ),
    );

    expect(res.status).toBe(403);
  });

  it('has the export route in the OpenAPI document', () => {
    const document = app.getOpenAPI31Document(OPENAPI_INFO);
    const path =
      document.paths?.[
        `/v1/organizations/{orgId}/stores/{storeId}/${row.segment}/{${row.idParam}}/export`
      ];

    expect(path?.post).toBeDefined();
  });
});

describe.each(TARIFF_CROSS_ROWS)(
  'workbook import contract: the other tariff page file on $segment',
  (row) => {
    beforeAll(async () => {
      await ensureDbReachable();
    });

    beforeEach(async () => {
      await truncateAll();
    });

    it(`names ${row.otherPage} and writes nothing`, async () => {
      const ctx = await setupStore();
      const before = await workbookRowCounts();

      const res = await app.request(importRequest(ctx, row, fixture(row.otherPageFixture)));

      expect(res.status).toBe(422);
      const body = IssuesSchema.parse(await res.json());
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0]?.field).toBe('file');
      expect(body.errors[0]?.code).toBe('WRONG_FILE_FOR_PAGE');
      expect(body.errors[0]?.meta?.['detectedPage']).toBe(row.otherPage);
      expect(await workbookRowCounts()).toEqual(before);
    });
  },
);
