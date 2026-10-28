// Multi-tenancy isolation for the overrideMissing=cost list filter and the
// facets overrideCounts (docs/SECURITY.md, section 9 checklist). Both orgs hold
// cost-missing data; each user queries their own store and must see only their
// own rows and counts. A MEMBER must not read a store they were not granted,
// through either endpoint.

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

interface Tenant {
  accessToken: string;
  orgId: string;
  storeId: string;
}

interface FacetsBody {
  overrideCounts: { missingCost: number; total: number };
}

interface ListBody {
  data: { title: string }[];
}

// Seeds `missing` products whose only variant has no cost profile, then
// `costed` products whose only variant has an active profile. Titles carry the
// tag so a leaked row is easy to spot.
async function seedProducts(
  orgId: string,
  storeId: string,
  tag: string,
  counts: { missing: number; costed: number },
): Promise<void> {
  const total = counts.missing + counts.costed;
  for (let i = 0; i < total; i += 1) {
    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        storeId,
        platformContentId: BigInt(7000 + i),
        productMainId: `pm-${tag}-${i.toString()}`,
        title: `${tag}-product-${i.toString()}`,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: orgId,
        storeId,
        productId: product.id,
        platformVariantId: BigInt(70000 + i),
        barcode: `bc-${tag}-${i.toString()}`,
        stockCode: `sk-${tag}-${i.toString()}`,
        salePrice: '10.00',
        listPrice: '10.00',
      },
    });
    if (i >= counts.missing) {
      const profile = await createCostProfile(orgId, { storeId });
      await prisma.productVariantCostProfile.create({
        data: { organizationId: orgId, productVariantId: variant.id, profileId: profile.id },
      });
    }
  }
}

async function makeTenant(
  tag: string,
  counts: { missing: number; costed: number },
): Promise<Tenant> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  await seedProducts(org.id, store.id, tag, counts);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

async function getJson<T>(accessToken: string, url: string): Promise<{ status: number; body: T }> {
  const res = await app.request(url, { headers: { Authorization: bearer(accessToken) } });
  return { status: res.status, body: (await res.json()) as T };
}

function facetsUrl(orgId: string, storeId: string): string {
  return `/v1/organizations/${orgId}/stores/${storeId}/products/facets`;
}

function costTabUrl(orgId: string, storeId: string): string {
  return `/v1/organizations/${orgId}/stores/${storeId}/products?overrideMissing=cost`;
}

describe('Tenant isolation: overrideCounts and overrideMissing=cost', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("each org's overrideCounts count only its own store's products", async () => {
    const a = await makeTenant('A', { missing: 2, costed: 1 });
    const b = await makeTenant('B', { missing: 1, costed: 3 });

    const facetsA = await getJson<FacetsBody>(a.accessToken, facetsUrl(a.orgId, a.storeId));
    const facetsB = await getJson<FacetsBody>(b.accessToken, facetsUrl(b.orgId, b.storeId));

    expect(facetsA.status).toBe(200);
    expect(facetsA.body.overrideCounts).toEqual({ missingCost: 2, total: 3 });
    expect(facetsB.status).toBe(200);
    expect(facetsB.body.overrideCounts).toEqual({ missingCost: 1, total: 4 });
  });

  it('an empty org sees zero counts while another org holds cost-missing products', async () => {
    await makeTenant('A', { missing: 2, costed: 0 });
    const b = await makeTenant('B', { missing: 0, costed: 0 });

    const facets = await getJson<FacetsBody>(b.accessToken, facetsUrl(b.orgId, b.storeId));

    expect(facets.status).toBe(200);
    expect(facets.body.overrideCounts).toEqual({ missingCost: 0, total: 0 });
  });

  it('the overrideMissing=cost list returns only the caller org cost-missing products', async () => {
    const a = await makeTenant('A', { missing: 2, costed: 1 });
    const b = await makeTenant('B', { missing: 1, costed: 0 });

    const listA = await getJson<ListBody>(a.accessToken, costTabUrl(a.orgId, a.storeId));
    const listB = await getJson<ListBody>(b.accessToken, costTabUrl(b.orgId, b.storeId));

    expect(listA.body.data.map((p) => p.title).sort()).toEqual(['A-product-0', 'A-product-1']);
    expect(listB.body.data.map((p) => p.title)).toEqual(['B-product-0']);
  });

  it('a cross-org path for the cost tab and the facets 404s (no existence disclosure)', async () => {
    const a = await makeTenant('A', { missing: 1, costed: 0 });
    const b = await makeTenant('B', { missing: 1, costed: 0 });

    const list = await getJson<unknown>(a.accessToken, costTabUrl(a.orgId, b.storeId));
    const facets = await getJson<unknown>(a.accessToken, facetsUrl(a.orgId, b.storeId));

    expect(list.status).toBe(404);
    expect(facets.status).toBe(404);
  });

  it('a MEMBER without a grant on a store gets 404 for its cost tab and facets', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const membership = await createMembership(org.id, user.id, 'MEMBER');
    const grantedStore = await createStore(org.id);
    const hiddenStore = await createStore(org.id);
    await createMemberStoreAccess(org.id, membership.id, grantedStore.id);
    await seedProducts(org.id, hiddenStore.id, 'HIDDEN', { missing: 2, costed: 0 });

    const list = await getJson<unknown>(user.accessToken, costTabUrl(org.id, hiddenStore.id));
    const facets = await getJson<unknown>(user.accessToken, facetsUrl(org.id, hiddenStore.id));
    const own = await getJson<FacetsBody>(user.accessToken, facetsUrl(org.id, grantedStore.id));

    expect(list.status).toBe(404);
    expect(facets.status).toBe(404);
    expect(own.status).toBe(200);
    expect(own.body.overrideCounts).toEqual({ missingCost: 0, total: 0 });
  });
});
