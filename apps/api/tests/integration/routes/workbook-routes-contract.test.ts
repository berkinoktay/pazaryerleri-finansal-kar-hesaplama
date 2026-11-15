// The wire contract every workbook import route keeps on the generic pipeline, one row
// per page (each vertical adds its row as it moves): bytes that are not an xlsx, and
// another page's real file, are refused on `file` without writing a row, and the route
// is in the OpenAPI document.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

interface ContractRow {
  readonly segment: string;
  readonly fixture: string;
  readonly form: Readonly<Record<string, string>>;
  /** A real file of another page, and what this route answers for it. */
  readonly otherPageFixture: string;
  readonly otherPage: string;
  readonly wrongFileCode: string;
}

const CONTRACT_ROWS: readonly ContractRow[] = [
  {
    segment: 'discount-lists',
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
    wrongFileCode: 'INVALID_DISCOUNT_FORMAT',
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
    expect(body.errors[0]?.code).toBe(row.wrongFileCode);
    expect(body.errors[0]?.meta?.['detectedPage']).toBe(row.otherPage);
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
});
