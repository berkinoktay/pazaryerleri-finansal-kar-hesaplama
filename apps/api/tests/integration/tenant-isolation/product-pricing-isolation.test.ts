// Route-layer authorization for GET .../product-pricing and
// POST .../product-pricing/quote. Both endpoints are org+store-scoped: the
// storeId in the path MUST belong to the caller's org.
//
// SECURITY.md §3 — existence non-disclosure: a cross-org storeId returns 404
// (not 403), so an attacker cannot probe whether a store id exists in another
// tenant. A non-member of the org gets 403, and a request with no token gets
// 401. These three cases are the multi-tenancy invariant for this surface.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

// Shared helper to build a minimal quote request body for a given variantId.
function quoteBody(variantId: string) {
  return JSON.stringify({ variantId, target: { type: 'margin', value: '20' } });
}

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

  // ─── New filter param does not open a cross-tenant data path ─────────────
  // Pins that adding ?profitStatus=profitable (Slice 2.5) does not create
  // a route through which org A's variants surface in an org B request.
  // Setup: org A has a profitable variant (high salePrice, no cost → calculable:false,
  // so it won't be in the profitable set anyway, but the filter MUST NOT cause
  // the service to skip its org+store WHERE clause). Org B's user queries
  // their own empty store with the new filter → result is empty, not org A's data.

  it('profitStatus filter does not expose cross-tenant variants', async () => {
    // Org A: create a member + store + variant with a positive salePrice.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    const productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: 8001n,
        productMainId: 'pm-a-8001',
        title: 'Org A Profitable Product',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: productA.id,
        platformVariantId: 80010n,
        barcode: 'BC-A-0001',
        stockCode: 'STK-A-0001',
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
      },
    });

    // Org B: independent member + store (empty — no variants).
    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await createStore(orgB.id);

    // Org B queries its own (empty) store with ?profitStatus=profitable.
    // Must return an empty list — not org A's variant.
    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/product-pricing?profitStatus=profitable`,
      { headers: { Authorization: bearer(userB.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { variantId: string }[] };
    expect(body.data).toHaveLength(0);
  });
});

// ─── Quote isolation ──────────────────────────────────────────────────────────
//
// POST .../product-pricing/quote carries the same isolation invariants as the
// list. Additionally: a variantId that belongs to org B must return 422
// INVALID_REFERENCE (not a data leak) when quoted via org A's path, because the
// service does a store-scoped findFirst — the row is simply not found.

describe('product-pricing quote: route-layer authorization', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("Org A member quoting with Org B's storeId returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // Use a random UUID as variantId — the store check happens first
    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/product-pricing/quote`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(userA.accessToken),
          'Content-Type': 'application/json',
        },
        body: quoteBody(crypto.randomUUID()),
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('non-member quoting returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/product-pricing/quote`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: quoteBody(crypto.randomUUID()),
      },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('no token quoting returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/product-pricing/quote`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: quoteBody(crypto.randomUUID()),
      },
    );
    expect(res.status).toBe(401);
  });

  it("Org A member quoting Org B's variantId via Org A's store returns 422 INVALID_REFERENCE", async () => {
    // Org A member + Org A store — valid access path.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
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

    // Quoting Org B's variantId through Org A's store path — the service does a
    // store-scoped findFirst, so the variant is not found → 422 INVALID_REFERENCE.
    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/product-pricing/quote`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(userA.accessToken),
          'Content-Type': 'application/json',
        },
        body: quoteBody(variantB.id),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_REFERENCE');
  });
});
