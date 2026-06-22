// Route-layer authorization + tenant isolation for POST .../product-pricing/price
// — the Trendyol price write. The endpoint is org+store-scoped AND restricted to
// OWNER/ADMIN, so the invariants are:
//
//   - cross-org storeId → 404 (existence non-disclosure, SECURITY.md §3)
//   - non-member of the org → 403
//   - no token → 401
//   - MEMBER/VIEWER (member of the org but not OWNER/ADMIN) → 403
//   - quoting another org's variantId through your OWN store path → 404
//     (the service does a store-scoped findFirst — the row is simply not found,
//      no cross-tenant data path is opened, and NO marketplace call is made)
//
// None of these cases reaches the marketplace, so no fetch mock is needed: every
// rejection happens at the auth / store-access / role gate or at the
// store-scoped variant lookup, all BEFORE credentials are decrypted.

import type { MemberRole } from '@pazarsync/db';
import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createMemberStoreAccess,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

function priceWritePath(orgId: string, storeId: string): string {
  return `/v1/organizations/${orgId}/stores/${storeId}/product-pricing/price`;
}

function priceBody(variantId: string): string {
  return JSON.stringify({ variantId, salePrice: '750.00' });
}

describe('product-pricing price write: route-layer authorization + isolation', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("Org A member writing to Org B's storeId returns 404 (no existence leak)", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(priceWritePath(orgA.id, storeB.id), {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
      body: priceBody(crypto.randomUUID()),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('non-member writing returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(priceWritePath(org.id, store.id), {
      method: 'POST',
      headers: { Authorization: bearer(outsider.accessToken), 'Content-Type': 'application/json' },
      body: priceBody(crypto.randomUUID()),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('no token writing returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(priceWritePath(org.id, store.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: priceBody(crypto.randomUUID()),
    });
    expect(res.status).toBe(401);
  });

  it.each<MemberRole>(['MEMBER', 'VIEWER'])(
    'a %s member of the org (not OWNER/ADMIN) returns 403',
    async (role) => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      const member = await createMembership(org.id, user.id, role);
      const store = await createStore(org.id);
      // Grant store access so they clear requireStoreAccess (gate 3) and the 403
      // they get is specifically the OWNER/ADMIN role gate — the invariant here.
      await createMemberStoreAccess(org.id, member.id, store.id);

      const res = await app.request(priceWritePath(org.id, store.id), {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: priceBody(crypto.randomUUID()),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('FORBIDDEN');
    },
  );

  it("Org A OWNER writing Org B's variantId through Org A's store returns 404 (no leak, no marketplace call)", async () => {
    // Org A OWNER + Org A store — valid access path, OWNER role.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id, 'OWNER');
    const storeA = await createStore(orgA.id);

    // Org B variant — a real variant that exists in Org B's store.
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const productB = await prisma.product.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        platformContentId: 9901n,
        productMainId: 'pm-b-9901',
        title: 'Org B Secret Product',
      },
    });
    const variantB = await prisma.productVariant.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        productId: productB.id,
        platformVariantId: 99010n,
        barcode: 'BC-B-9901',
        stockCode: 'STK-B-9901',
        salePrice: new Decimal('200.00'),
        listPrice: new Decimal('200.00'),
      },
    });

    // Writing Org B's variantId through Org A's store path — the service does a
    // store-scoped findFirst, so the variant is not found → 404. The variant's
    // sale price in Org B must be untouched (no cross-tenant write).
    const res = await app.request(priceWritePath(orgA.id, storeA.id), {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
      body: priceBody(variantB.id),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');

    // Org B's variant unchanged, and no audit row written anywhere.
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantB.id } });
    expect(after.salePrice.toString()).toBe('200');
    const logCount = await prisma.priceChangeLog.count();
    expect(logCount).toBe(0);
  });
});
