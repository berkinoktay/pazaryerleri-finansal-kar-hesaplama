// Multi-tenancy isolation for the overrideMissing=cost and overrideMissing=desi
// list filters and the facets overrideCounts (docs/SECURITY.md, section 9
// checklist). Both orgs hold cost-missing and desi-missing data; each user
// queries their own store and must see only their own rows and counts. A MEMBER
// must not read a store they were not granted, through any of these endpoints.

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
  overrideCounts: { missingCost: number; missingDesi: number; total: number };
}

interface ListBody {
  data: { title: string }[];
}

// Seeds `missing` products whose only variant has no cost profile, then
// `costed` products whose only variant has an active profile. The last
// `withDesi` products (default 0) get a synced desi; every other product misses
// desi (no synced desi, no override). Titles carry the tag so a leaked row is
// easy to spot.
interface SeedCounts {
  missing: number;
  costed: number;
  withDesi?: number;
}

async function seedProducts(
  orgId: string,
  storeId: string,
  tag: string,
  counts: SeedCounts,
): Promise<void> {
  const total = counts.missing + counts.costed;
  const firstWithDesi = total - (counts.withDesi ?? 0);
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
        syncedDimensionalWeight: i >= firstWithDesi ? '2' : null,
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

async function makeTenant(tag: string, counts: SeedCounts): Promise<Tenant> {
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

function desiTabUrl(orgId: string, storeId: string): string {
  return `/v1/organizations/${orgId}/stores/${storeId}/products?overrideMissing=desi`;
}

describe('Tenant isolation: overrideCounts and overrideMissing=cost/desi', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("each org's overrideCounts count only its own store's products", async () => {
    const a = await makeTenant('A', { missing: 2, costed: 1, withDesi: 2 });
    const b = await makeTenant('B', { missing: 1, costed: 3, withDesi: 1 });

    const facetsA = await getJson<FacetsBody>(a.accessToken, facetsUrl(a.orgId, a.storeId));
    const facetsB = await getJson<FacetsBody>(b.accessToken, facetsUrl(b.orgId, b.storeId));

    expect(facetsA.status).toBe(200);
    expect(facetsA.body.overrideCounts).toEqual({ missingCost: 2, missingDesi: 1, total: 3 });
    expect(facetsB.status).toBe(200);
    expect(facetsB.body.overrideCounts).toEqual({ missingCost: 1, missingDesi: 3, total: 4 });
  });

  it('an empty org sees zero counts while another org holds cost- and desi-missing products', async () => {
    await makeTenant('A', { missing: 2, costed: 0 });
    const b = await makeTenant('B', { missing: 0, costed: 0 });

    const facets = await getJson<FacetsBody>(b.accessToken, facetsUrl(b.orgId, b.storeId));

    expect(facets.status).toBe(200);
    expect(facets.body.overrideCounts).toEqual({ missingCost: 0, missingDesi: 0, total: 0 });
  });

  it('the overrideMissing=cost list returns only the caller org cost-missing products', async () => {
    const a = await makeTenant('A', { missing: 2, costed: 1 });
    const b = await makeTenant('B', { missing: 1, costed: 0 });

    const listA = await getJson<ListBody>(a.accessToken, costTabUrl(a.orgId, a.storeId));
    const listB = await getJson<ListBody>(b.accessToken, costTabUrl(b.orgId, b.storeId));

    expect(listA.body.data.map((p) => p.title).sort()).toEqual(['A-product-0', 'A-product-1']);
    expect(listB.body.data.map((p) => p.title)).toEqual(['B-product-0']);
  });

  it('the overrideMissing=desi list returns only the caller org desi-missing products', async () => {
    // A: products 0 and 1 miss desi, product 2 has a synced desi.
    // B: product 0 misses desi, product 1 has a synced desi.
    const a = await makeTenant('A', { missing: 0, costed: 3, withDesi: 1 });
    const b = await makeTenant('B', { missing: 0, costed: 2, withDesi: 1 });

    const listA = await getJson<ListBody>(a.accessToken, desiTabUrl(a.orgId, a.storeId));
    const listB = await getJson<ListBody>(b.accessToken, desiTabUrl(b.orgId, b.storeId));

    expect(listA.status).toBe(200);
    expect(listA.body.data.map((p) => p.title).sort()).toEqual(['A-product-0', 'A-product-1']);
    expect(listB.status).toBe(200);
    expect(listB.body.data.map((p) => p.title)).toEqual(['B-product-0']);
  });

  it('a cross-org path for the cost tab, the desi tab and the facets 404s (no existence disclosure)', async () => {
    const a = await makeTenant('A', { missing: 1, costed: 0 });
    const b = await makeTenant('B', { missing: 1, costed: 0 });

    const list = await getJson<unknown>(a.accessToken, costTabUrl(a.orgId, b.storeId));
    const desiList = await getJson<unknown>(a.accessToken, desiTabUrl(a.orgId, b.storeId));
    const facets = await getJson<unknown>(a.accessToken, facetsUrl(a.orgId, b.storeId));

    expect(list.status).toBe(404);
    expect(desiList.status).toBe(404);
    expect(facets.status).toBe(404);
  });

  it('a MEMBER without a grant on a store gets 404 for its cost tab, desi tab and facets', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const membership = await createMembership(org.id, user.id, 'MEMBER');
    const grantedStore = await createStore(org.id);
    const hiddenStore = await createStore(org.id);
    await createMemberStoreAccess(org.id, membership.id, grantedStore.id);
    await seedProducts(org.id, hiddenStore.id, 'HIDDEN', { missing: 2, costed: 0 });

    const list = await getJson<unknown>(user.accessToken, costTabUrl(org.id, hiddenStore.id));
    const desiList = await getJson<unknown>(user.accessToken, desiTabUrl(org.id, hiddenStore.id));
    const facets = await getJson<unknown>(user.accessToken, facetsUrl(org.id, hiddenStore.id));
    const own = await getJson<FacetsBody>(user.accessToken, facetsUrl(org.id, grantedStore.id));

    expect(list.status).toBe(404);
    expect(desiList.status).toBe(404);
    expect(facets.status).toBe(404);
    expect(own.status).toBe(200);
    expect(own.body.overrideCounts).toEqual({ missingCost: 0, missingDesi: 0, total: 0 });
  });
});
