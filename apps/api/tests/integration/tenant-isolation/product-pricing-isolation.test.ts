// Route-layer authorization for GET .../product-pricing. The endpoint is
// org+store-scoped: the storeId in the path MUST belong to the caller's org.
//
// SECURITY.md §3 — existence non-disclosure: a cross-org storeId returns 404
// (not 403), so an attacker cannot probe whether a store id exists in another
// tenant. A non-member of the org gets 403, and a request with no token gets
// 401. These three cases are the multi-tenancy invariant for this surface.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

describe('product-pricing list: route-layer authorization', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Case 1: cross-org storeId returns 404 (no existence leak) ──────────────

  it("Org A member calling Org B's storeId returns 404, not 200 + data", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/product-pricing`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    // 404 instead of 403: the store path does not match Org A's tenant boundary,
    // and 403 would leak that the store id exists in another org.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  // ─── Case 2: non-member of the org returns 403 ─────────────────────────────

  it('a user who is not a member of the org returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();

    const org = await createOrganization();
    const store = await createStore(org.id);
    // `outsider` has NO membership in `org`.

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/product-pricing`,
      { headers: { Authorization: bearer(outsider.accessToken) } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  // ─── Case 3: no token returns 401 ──────────────────────────────────────────

  it('a request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/product-pricing`);
    expect(res.status).toBe(401);
  });

  // ─── Cross-tenant data scoping: a member of their OWN org never sees another
  // org's variants, even though both stores exist. Pins that the service filters
  // by organizationId + storeId, not just storeId.

  it("a member listing their own store never sees another org's variants", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    // Org B has a product+variant under ITS OWN store — must never appear in A's list.
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const productB = await prisma.product.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        platformContentId: 7001n,
        productMainId: 'pm-b-7001',
        title: 'Org B Product',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        productId: productB.id,
        platformVariantId: 70010n,
        barcode: 'BC-B-0001',
        stockCode: 'STK-B-0001',
        salePrice: '100.00',
        listPrice: '100.00',
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/product-pricing`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { variantId: string }[] };
    // Org A's store has no products → empty list, and Org B's variant is absent.
    expect(body.data).toHaveLength(0);
  });
});
