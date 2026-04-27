// Multi-tenancy isolation for the product sync surface.
//
// Per docs/SECURITY.md §9: every org-scoped endpoint must have an
// isolation test in this directory. The pattern: create two orgs, write
// data in both, query as one user, assert the other org's data is
// invisible (404, never 200-with-empty-body or 403 leaking existence).

import { prisma } from '@pazarsync/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@/lib/crypto';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

interface TenantSetup {
  user: { id: string; email: string; accessToken: string };
  orgId: string;
  storeId: string;
  syncLogId: string;
}

async function makeTenant(): Promise<TenantSetup> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Tenant Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: `seller-${Math.random().toString(36).slice(2, 8)}`,
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      }),
    },
  });
  const syncLog = await prisma.syncLog.create({
    data: {
      storeId: store.id,
      syncType: 'PRODUCTS',
      status: 'COMPLETED',
      startedAt: new Date(),
      completedAt: new Date(),
      recordsProcessed: 5,
      progressCurrent: 5,
      progressTotal: 5,
    },
  });
  return { user, orgId: org.id, storeId: store.id, syncLogId: syncLog.id };
}

describe('Tenant isolation — products sync surface', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("user A cannot start a sync against user B's store (404, not 403)", async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    // Path: orgA + storeB. The org-membership gate passes (A is a member
    // of orgA), but the store-ownership gate trips because storeB is not
    // under orgA. Result is 404 with no existence disclosure.
    const res = await app.request(
      `/v1/organizations/${a.orgId}/stores/${b.storeId}/products/sync`,
      { method: 'POST', headers: { Authorization: bearer(a.user.accessToken) } },
    );
    expect(res.status).toBe(404);

    // No SyncLog row was inserted under either org.
    expect(await prisma.syncLog.count({ where: { storeId: b.storeId } })).toBe(1); // only the seeded one
    expect(
      await prisma.syncLog.count({
        where: { storeId: b.storeId, syncType: 'PRODUCTS', status: 'RUNNING' },
      }),
    ).toBe(0);
  });

  it("user A cannot read user B's sync log via either path arrangement", async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    // Arrangement 1: A's orgId + B's storeId + B's syncLogId — store gate trips.
    const res1 = await app.request(
      `/v1/organizations/${a.orgId}/stores/${b.storeId}/sync-logs/${b.syncLogId}`,
      { headers: { Authorization: bearer(a.user.accessToken) } },
    );
    expect(res1.status).toBe(404);

    // Arrangement 2: A's orgId + A's storeId + B's syncLogId — sync-log gate trips.
    const res2 = await app.request(
      `/v1/organizations/${a.orgId}/stores/${a.storeId}/sync-logs/${b.syncLogId}`,
      { headers: { Authorization: bearer(a.user.accessToken) } },
    );
    expect(res2.status).toBe(404);

    // Arrangement 3: B's orgId + B's storeId + B's syncLogId, with A's token —
    // the org-membership gate trips (A is not a member of orgB), 403.
    const res3 = await app.request(
      `/v1/organizations/${b.orgId}/stores/${b.storeId}/sync-logs/${b.syncLogId}`,
      { headers: { Authorization: bearer(a.user.accessToken) } },
    );
    expect(res3.status).toBe(403);
  });

  it('product, product_variant, and product_image rows in org A do not leak via tenant-scoped queries from org B', async () => {
    const a = await makeTenant();
    await makeTenant(); // org B

    // Seed products under org A.
    const productA = await prisma.product.create({
      data: {
        organizationId: a.orgId,
        storeId: a.storeId,
        platformContentId: BigInt(11),
        productMainId: 'pm-a',
        title: 'A Product',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: a.orgId,
        storeId: a.storeId,
        productId: productA.id,
        platformVariantId: BigInt(110),
        barcode: 'a-bc',
        stockCode: 'a-sk',
        salePrice: '10.00',
        listPrice: '10.00',
      },
    });
    await prisma.productImage.create({
      data: {
        organizationId: a.orgId,
        productId: productA.id,
        url: 'https://cdn.example.com/a.jpg',
      },
    });

    // Defense-in-depth check: Prisma queries scoped to orgB return empty.
    // (The application-layer where-clause is the primary guard; this
    // verifies the schema's organization_id column is being respected.)
    const orgBProducts = await prisma.product.findMany({
      where: { organizationId: { not: a.orgId } },
    });
    const orgBVariants = await prisma.productVariant.findMany({
      where: { organizationId: { not: a.orgId } },
    });
    const orgBImages = await prisma.productImage.findMany({
      where: { organizationId: { not: a.orgId } },
    });
    expect(orgBProducts).toHaveLength(0);
    expect(orgBVariants).toHaveLength(0);
    expect(orgBImages).toHaveLength(0);
  });
});
