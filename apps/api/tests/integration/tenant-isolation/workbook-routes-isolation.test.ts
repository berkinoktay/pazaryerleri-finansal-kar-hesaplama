// Tenant isolation of the workbook routes on the generic pipeline, one row per page
// (each vertical adds its row as it moves; the export cases arrive with the generic
// export). The import gate:
//   - a non-member of the organization is refused with 403 before the engine reads a
//     byte of the file;
//   - another organization's store under the caller's organization path, and a store
//     of the caller's own organization the caller holds no grant for, are 404
//     (SECURITY.md 3, existence non-disclosure) and write nothing;
//   - the rightful member's import of the same file succeeds, so the 404s are the
//     tenant gate and not a file that could never import.

import { readFileSync } from 'node:fs';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

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

// The engine itself, with its grid read wrapped in a spy: a refused request must never
// reach it.
vi.mock('@pazarsync/spreadsheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pazarsync/spreadsheet')>();
  return { ...actual, readWorkbookGrid: vi.fn(actual.readWorkbookGrid) };
});

const app = createApp();

interface IsolationRow {
  readonly segment: string;
  readonly fixture: string;
  readonly form: Readonly<Record<string, string>>;
}

const ISOLATION_ROWS: readonly IsolationRow[] = [
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
  },
];

function importRequest(
  accessToken: string,
  path: { orgId: string; storeId: string },
  row: IsolationRow,
): Request {
  const form = new FormData();
  const file = readFileSync(new URL(`../../fixtures/${row.fixture}`, import.meta.url));
  form.append('file', new Blob([new Uint8Array(file)]), 'upload.xlsx');
  for (const [key, value] of Object.entries(row.form)) form.append(key, value);
  return new Request(
    `http://local/v1/organizations/${path.orgId}/stores/${path.storeId}/${row.segment}/import`,
    { method: 'POST', headers: { Authorization: bearer(accessToken) }, body: form },
  );
}

/** Rows of the six workbook parent tables and their item tables. */
async function workbookRowCounts(): Promise<readonly number[]> {
  return Promise.all([
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
}

const engineRead = vi.mocked(readWorkbookGrid);

beforeEach(() => {
  _resetRateLimitStoreForTests();
  engineRead.mockClear();
});

describe.each(ISOLATION_ROWS)('workbook import isolation: $segment', (row) => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('refuses a non-member with 403 before the engine reads the file', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      importRequest(outsider.accessToken, { orgId: org.id, storeId: store.id }, row),
    );

    expect(res.status).toBe(403);
    expect(engineRead).not.toHaveBeenCalled();
  });

  it("answers another organization's store under the caller's path with 404 and writes nothing", async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const before = await workbookRowCounts();

    const res = await app.request(
      importRequest(user.accessToken, { orgId: orgA.id, storeId: storeB.id }, row),
    );

    expect(res.status).toBe(404);
    expect(engineRead).not.toHaveBeenCalled();
    expect(await workbookRowCounts()).toEqual(before);
  });

  it('answers a store of its own organization without a grant with 404 and writes nothing', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const granted = await createStore(org.id);
    const ungranted = await createStore(org.id);
    await createMemberStoreAccess(org.id, member.id, granted.id);
    const before = await workbookRowCounts();

    const res = await app.request(
      importRequest(user.accessToken, { orgId: org.id, storeId: ungranted.id }, row),
    );

    expect(res.status).toBe(404);
    expect(engineRead).not.toHaveBeenCalled();
    expect(await workbookRowCounts()).toEqual(before);
  });

  it("imports the same file into the member's granted store", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const granted = await createStore(org.id);
    await createMemberStoreAccess(org.id, member.id, granted.id);

    const res = await app.request(
      importRequest(user.accessToken, { orgId: org.id, storeId: granted.id }, row),
    );

    expect(res.status).toBe(201);
    expect(engineRead).toHaveBeenCalled();
  });
});
