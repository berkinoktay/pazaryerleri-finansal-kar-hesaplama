// Tenant isolation of the workbook routes on the generic pipeline, one row per page
// (each vertical adds its row as it moves). The import gate:
//   - a non-member of the organization is refused with 403 before the engine reads a
//     byte of the file;
//   - another organization's store under the caller's organization path, and a store
//     of the caller's own organization the caller holds no grant for, are 404
//     (SECURITY.md 3, existence non-disclosure) and write nothing;
//   - the rightful member's import of the same file succeeds, so the 404s are the
//     tenant gate and not a file that could never import.
// The export gate, on a victim list seeded through the import route with the real file:
//   - another organization's record id, and a sibling store's record id, under the
//     caller's OWN store path are 404 and leave the victim unexported: this is the
//     request that reaches the adapter's `load`, scoped by the store record;
//   - another organization's store path, and a store without a grant, are 404; a
//     non-member is 403;
//   - the rightful member's export succeeds and marks the list exported;
//   - at the adapter level, `load`, `touchExported` and `countLists` see nothing of
//     another organization or a sibling store.
// The advantage upload's commission source: a commission tariff of another organization
// or of a sibling store is refused on the field, and nothing is stored.

import { readFileSync } from 'node:fs';

import { z } from '@hono/zod-openapi';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';
import type { StoreScope } from '@/workbooks/adapter';
import { advantageTariffAdapter } from '@/workbooks/verticals/advantage-tariff.adapter';
import { discountListAdapter } from '@/workbooks/verticals/discount-list.adapter';
import { flashProductListAdapter } from '@/workbooks/verticals/flash-product-list.adapter';
import { marketplaceCampaignListAdapter } from '@/workbooks/verticals/marketplace-campaign-list.adapter';
import { plusCommissionTariffAdapter } from '@/workbooks/verticals/plus-commission-tariff.adapter';

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
  /** The record id of an import response. */
  readonly importedId: (body: unknown) => string;
  /** The adapter's scoped reads and writes, narrowed to what the export cases call. */
  readonly load: (scope: StoreScope, id: string) => Promise<unknown>;
  readonly touchExported: (scope: StoreScope, id: string) => Promise<{ count: number }>;
  readonly countLists: (scope: StoreScope) => Promise<number>;
  /** The record's `exportedAt`, read by id for the assertions only. */
  readonly exportedAt: (id: string) => Promise<Date | null>;
}

const DiscountImportSchema = z.object({ listId: z.string() });
const CampaignImportSchema = z.object({ campaignId: z.string() });
const FlashImportSchema = z.object({ listId: z.string() });
const AdvantageImportSchema = z.object({ tariffId: z.string() });
const PlusImportSchema = z.object({ tariffId: z.string() });

const ADVANTAGE_ROW: IsolationRow = {
  segment: 'advantage-tariffs',
  fixture: 'trendyol-advantage-tariff.xlsx',
  form: {},
  importedId: (body) => AdvantageImportSchema.parse(body).tariffId,
  load: (scope, id) => advantageTariffAdapter.load(scope, id),
  touchExported: (scope, id) => advantageTariffAdapter.touchExported(scope, id),
  countLists: (scope) => prisma.$transaction((tx) => advantageTariffAdapter.countLists(tx, scope)),
  exportedAt: async (id) =>
    (await prisma.advantageTariff.findUnique({ where: { id }, select: { exportedAt: true } }))
      ?.exportedAt ?? null,
};

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
    importedId: (body) => DiscountImportSchema.parse(body).listId,
    load: (scope, id) => discountListAdapter.load(scope, id),
    touchExported: (scope, id) => discountListAdapter.touchExported(scope, id),
    countLists: (scope) => prisma.$transaction((tx) => discountListAdapter.countLists(tx, scope)),
    exportedAt: async (id) =>
      (await prisma.discountList.findUnique({ where: { id }, select: { exportedAt: true } }))
        ?.exportedAt ?? null,
  },
  {
    segment: 'marketplace-campaigns',
    fixture: 'marketplace-campaign-sample.xlsx',
    form: {
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      trendyolFundingPct: '40',
      startsAt: '2026-09-10T09:00:00.000Z',
      endsAt: '2026-09-14T09:00:00.000Z',
    },
    importedId: (body) => CampaignImportSchema.parse(body).campaignId,
    load: (scope, id) => marketplaceCampaignListAdapter.load(scope, id),
    touchExported: (scope, id) => marketplaceCampaignListAdapter.touchExported(scope, id),
    countLists: (scope) =>
      prisma.$transaction((tx) => marketplaceCampaignListAdapter.countLists(tx, scope)),
    exportedAt: async (id) =>
      (
        await prisma.marketplaceCampaignList.findUnique({
          where: { id },
          select: { exportedAt: true },
        })
      )?.exportedAt ?? null,
  },
  {
    segment: 'flash-products',
    fixture: 'trendyol-flash-products.xlsx',
    form: {},
    importedId: (body) => FlashImportSchema.parse(body).listId,
    load: (scope, id) => flashProductListAdapter.load(scope, id),
    touchExported: (scope, id) => flashProductListAdapter.touchExported(scope, id),
    countLists: (scope) =>
      prisma.$transaction((tx) => flashProductListAdapter.countLists(tx, scope)),
    exportedAt: async (id) =>
      (await prisma.flashProductList.findUnique({ where: { id }, select: { exportedAt: true } }))
        ?.exportedAt ?? null,
  },
  ADVANTAGE_ROW,
  {
    segment: 'plus-commission-tariffs',
    fixture: 'trendyol-plus-tariff.xlsx',
    form: {},
    importedId: (body) => PlusImportSchema.parse(body).tariffId,
    load: (scope, id) => plusCommissionTariffAdapter.load(scope, id),
    touchExported: (scope, id) => plusCommissionTariffAdapter.touchExported(scope, id),
    countLists: (scope) =>
      prisma.$transaction((tx) => plusCommissionTariffAdapter.countLists(tx, scope)),
    exportedAt: async (id) =>
      (
        await prisma.plusCommissionTariff.findUnique({
          where: { id },
          select: { exportedAt: true },
        })
      )?.exportedAt ?? null,
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

function exportRequest(
  accessToken: string,
  path: { orgId: string; storeId: string },
  row: IsolationRow,
  recordId: string,
): Request {
  return new Request(
    `http://local/v1/organizations/${path.orgId}/stores/${path.storeId}/${row.segment}/${recordId}/export`,
    { method: 'POST', headers: { Authorization: bearer(accessToken) } },
  );
}

interface Tenant {
  readonly accessToken: string;
  readonly orgId: string;
  readonly storeId: string;
}

/** A user who owns a new organization with one store. */
async function ownerTenant(): Promise<Tenant> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

/** The victim record, imported through the route with the real file. */
async function seedVictim(tenant: Tenant, row: IsolationRow): Promise<string> {
  const res = await app.request(importRequest(tenant.accessToken, tenant, row));
  expect(res.status).toBe(201);
  return row.importedId(await res.json());
}

const ProblemCodeSchema = z.object({ code: z.string() });

/**
 * A 404 problem response that offers no download: a JSON NOT_FOUND body (the app
 * sends every problem as `application/json`), no spreadsheet and no attachment.
 */
async function expectNotFoundProblem(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type') ?? '').toContain('application/json');
  expect(res.headers.get('content-disposition')).toBeNull();
  const raw = Buffer.from(await res.arrayBuffer());
  expect(raw.subarray(0, 2).toString('latin1')).not.toBe('PK');
  expect(ProblemCodeSchema.parse(JSON.parse(raw.toString('utf8'))).code).toBe('NOT_FOUND');
}

describe.each(ISOLATION_ROWS)('workbook export isolation: $segment', (row) => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("answers another organization's record id under the caller's own store path with 404", async () => {
    const victim = await ownerTenant();
    const victimId = await seedVictim(victim, row);
    const attacker = await ownerTenant();

    const res = await app.request(exportRequest(attacker.accessToken, attacker, row, victimId));

    await expectNotFoundProblem(res);
    expect(await row.exportedAt(victimId)).toBeNull();
  });

  it("answers a sibling store's record id under the caller's other store path with 404", async () => {
    const owner = await ownerTenant();
    const victimId = await seedVictim(owner, row);
    const sibling = await createStore(owner.orgId);

    const res = await app.request(
      exportRequest(owner.accessToken, { orgId: owner.orgId, storeId: sibling.id }, row, victimId),
    );

    await expectNotFoundProblem(res);
    expect(await row.exportedAt(victimId)).toBeNull();
  });

  it("answers another organization's store path with 404", async () => {
    const victim = await ownerTenant();
    const victimId = await seedVictim(victim, row);
    const attacker = await ownerTenant();

    const res = await app.request(
      exportRequest(
        attacker.accessToken,
        { orgId: attacker.orgId, storeId: victim.storeId },
        row,
        victimId,
      ),
    );

    await expectNotFoundProblem(res);
    expect(await row.exportedAt(victimId)).toBeNull();
  });

  it('answers a store of its own organization without a grant with 404', async () => {
    const owner = await ownerTenant();
    const victimId = await seedVictim(owner, row);
    const user = await createAuthenticatedTestUser();
    const member = await createMembership(owner.orgId, user.id, 'MEMBER');
    const granted = await createStore(owner.orgId);
    await createMemberStoreAccess(owner.orgId, member.id, granted.id);

    const res = await app.request(exportRequest(user.accessToken, owner, row, victimId));

    await expectNotFoundProblem(res);
    expect(await row.exportedAt(victimId)).toBeNull();
  });

  it('refuses a non-member with 403', async () => {
    const owner = await ownerTenant();
    const victimId = await seedVictim(owner, row);
    const outsider = await createAuthenticatedTestUser();

    const res = await app.request(exportRequest(outsider.accessToken, owner, row, victimId));

    expect(res.status).toBe(403);
    expect(await row.exportedAt(victimId)).toBeNull();
  });

  it("exports the rightful member's record and marks it exported", async () => {
    const owner = await ownerTenant();
    const victimId = await seedVictim(owner, row);

    const res = await app.request(exportRequest(owner.accessToken, owner, row, victimId));

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(await row.exportedAt(victimId)).not.toBeNull();
  });

  it('scopes the adapter reads and writes to the store record', async () => {
    const owner = await ownerTenant();
    const victimId = await seedVictim(owner, row);
    const sibling = await createStore(owner.orgId);
    const other = await ownerTenant();
    const ownScope: StoreScope = { organizationId: owner.orgId, storeId: owner.storeId };
    const foreignScope: StoreScope = { organizationId: other.orgId, storeId: other.storeId };
    // The victim's organization with a store that does not hold the record.
    const siblingScope: StoreScope = { organizationId: owner.orgId, storeId: sibling.id };
    // The victim's store under another organization's id.
    const crossedScope: StoreScope = { organizationId: other.orgId, storeId: owner.storeId };

    expect(await row.load(ownScope, victimId)).not.toBeNull();
    for (const scope of [foreignScope, siblingScope, crossedScope]) {
      expect(await row.load(scope, victimId)).toBeNull();
      expect(await row.touchExported(scope, victimId)).toEqual({ count: 0 });
      expect(await row.countLists(scope)).toBe(0);
    }
    expect(await row.exportedAt(victimId)).toBeNull();
    expect(await row.countLists(ownScope)).toBe(1);
  });
});

const IssuesSchema = z.object({
  code: z.string(),
  errors: z.array(z.object({ field: z.string(), code: z.string() })),
});

/** A commission tariff of one store: the week an advantage upload may name as its source. */
async function commissionTariffOf(organizationId: string, storeId: string): Promise<string> {
  const tariff = await prisma.commissionTariff.create({
    data: { organizationId, storeId, name: 'Commission source' },
    select: { id: true },
  });
  return tariff.id;
}

function advantageImportWithSource(tenant: Tenant, commissionSourceTariffId: string): Request {
  return importRequest(tenant.accessToken, tenant, {
    ...ADVANTAGE_ROW,
    form: { commissionSourceTariffId },
  });
}

async function expectInvalidCommissionSource(res: Response): Promise<void> {
  expect(res.status).toBe(422);
  const body = IssuesSchema.parse(await res.json());
  expect(body.code).toBe('VALIDATION_ERROR');
  expect(body.errors).toEqual([
    { field: 'commissionSourceTariffId', code: 'INVALID_COMMISSION_SOURCE' },
  ]);
}

// The advantage upload names the commission tariff (week) whose bands supply the reduced
// commission. The adapter's `inspect` looks it up with the store record's scope, so a
// tariff of another organization, or of a sibling store, is a field error under the
// caller's OWN store path (the request that reaches the lookup), and nothing is stored.
describe('workbook import isolation: advantage-tariffs commission source', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("refuses another organization's commission tariff with 422 and writes nothing", async () => {
    const owner = await ownerTenant();
    const other = await ownerTenant();
    const foreignSource = await commissionTariffOf(other.orgId, other.storeId);
    const before = await workbookRowCounts();

    const res = await app.request(advantageImportWithSource(owner, foreignSource));

    await expectInvalidCommissionSource(res);
    expect(await workbookRowCounts()).toEqual(before);
  });

  it("refuses a sibling store's commission tariff with 422 and writes nothing", async () => {
    // An OWNER may reach both stores of the organization; the lookup is still scoped to
    // the store the upload is for.
    const owner = await ownerTenant();
    const sibling = await createStore(owner.orgId);
    const siblingSource = await commissionTariffOf(owner.orgId, sibling.id);
    const before = await workbookRowCounts();

    const res = await app.request(advantageImportWithSource(owner, siblingSource));

    await expectInvalidCommissionSource(res);
    expect(await workbookRowCounts()).toEqual(before);
  });

  it("stores the commission tariff of the caller's own store", async () => {
    const owner = await ownerTenant();
    const ownSource = await commissionTariffOf(owner.orgId, owner.storeId);

    const res = await app.request(advantageImportWithSource(owner, ownSource));

    expect(res.status).toBe(201);
    const id = ADVANTAGE_ROW.importedId(await res.json());
    const stored = await prisma.advantageTariff.findUnique({
      where: { id },
      select: { commissionSourceTariffId: true },
    });
    expect(stored?.commissionSourceTariffId).toBe(ownSource);
  });
});
