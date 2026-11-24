// Multi-tenancy isolation for the GET /products + /facets surface.
// Pattern matches docs/SECURITY.md §9: two orgs, both with data,
// query as one user, assert nothing leaks from the other.

import { z } from '@hono/zod-openapi';
import { prisma } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

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

interface TenantSetup {
  user: { id: string; accessToken: string };
  orgId: string;
  storeId: string;
}

async function makeTenantWithProducts(brandSeed: number): Promise<TenantSetup> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Tenant Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: `seller-${brandSeed.toString()}`,
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'k',
        apiSecret: 's',
      }),
    },
  });
  // Seed two products under this org so list and facets return non-empty.
  for (let i = 1; i <= 2; i += 1) {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(brandSeed * 1000 + i),
        productMainId: `pm-${brandSeed.toString()}-${i.toString()}`,
        title: `Tenant ${brandSeed.toString()} Product ${i.toString()}`,
        brandId: BigInt(brandSeed),
        brandName: `Brand-${brandSeed.toString()}`,
        categoryId: BigInt(brandSeed * 10),
        categoryName: `Cat-${brandSeed.toString()}`,
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(brandSeed * 10000 + i),
        barcode: `bc-${brandSeed.toString()}-${i.toString()}`,
        stockCode: `sk-${brandSeed.toString()}-${i.toString()}`,
        salePrice: '50.00',
        listPrice: '50.00',
      },
    });
  }
  return { user: { id: user.id, accessToken: user.accessToken }, orgId: org.id, storeId: store.id };
}

const VariantCostSchema = z.object({
  id: z.string(),
  currentCostTry: z.string().nullable(),
  profileCount: z.number(),
  costStatus: z.string(),
});

const ProductsCostBodySchema = z.object({
  data: z.array(z.object({ variants: z.array(VariantCostSchema) })),
});

/** The cost fields of one variant as GET /products returns them to the tenant. */
async function listVariantCost(
  tenant: TenantSetup,
  variantId: string,
): Promise<z.infer<typeof VariantCostSchema>> {
  const res = await app.request(
    `/v1/organizations/${tenant.orgId}/stores/${tenant.storeId}/products`,
    { headers: { Authorization: bearer(tenant.user.accessToken) } },
  );
  expect(res.status).toBe(200);
  const body = ProductsCostBodySchema.parse(await res.json());
  const variant = body.data.flatMap((p) => p.variants).find((v) => v.id === variantId);
  if (variant === undefined) throw new Error(`variant ${variantId} is missing from the list`);
  return variant;
}

describe('Tenant isolation — GET /products + /facets', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("user A's GET /products under their own store sees only their own data", async () => {
    const a = await makeTenantWithProducts(1);
    await makeTenantWithProducts(2);

    const res = await app.request(`/v1/organizations/${a.orgId}/stores/${a.storeId}/products`, {
      headers: { Authorization: bearer(a.user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { title: string }[] };
    expect(body.data).toHaveLength(2);
    for (const product of body.data) {
      expect(product.title).toMatch(/^Tenant 1 /);
    }
  });

  it("user A cannot list user B's products via cross-org path (404, not 200-empty)", async () => {
    const a = await makeTenantWithProducts(1);
    const b = await makeTenantWithProducts(2);

    // orgA + storeB — store gate trips, 404 with no existence disclosure.
    const res = await app.request(`/v1/organizations/${a.orgId}/stores/${b.storeId}/products`, {
      headers: { Authorization: bearer(a.user.accessToken) },
    });
    expect(res.status).toBe(404);

    // orgB + storeB with A's token — org-membership gate trips, 403.
    const res2 = await app.request(`/v1/organizations/${b.orgId}/stores/${b.storeId}/products`, {
      headers: { Authorization: bearer(a.user.accessToken) },
    });
    expect(res2.status).toBe(403);
  });

  it("user A's facets do not include user B's brands or categories", async () => {
    const a = await makeTenantWithProducts(1);
    await makeTenantWithProducts(2);

    const res = await app.request(
      `/v1/organizations/${a.orgId}/stores/${a.storeId}/products/facets`,
      { headers: { Authorization: bearer(a.user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      brands: { name: string }[];
      categories: { name: string }[];
    };
    expect(body.brands.map((b) => b.name)).toEqual(['Brand-1']);
    expect(body.categories.map((c) => c.name)).toEqual(['Cat-1']);
  });

  it("user A cannot read user B's facets via cross-org path", async () => {
    const a = await makeTenantWithProducts(1);
    const b = await makeTenantWithProducts(2);

    const res = await app.request(
      `/v1/organizations/${a.orgId}/stores/${b.storeId}/products/facets`,
      { headers: { Authorization: bearer(a.user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  it("a link to another organization's cost profile is never summed into the caller's variant cost", async () => {
    const a = await makeTenantWithProducts(1);
    const orgB = await createOrganization();
    const variantA = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: a.orgId, storeId: a.storeId, barcode: 'bc-1-1' },
    });
    const profileB = await createCostProfile(orgB.id, { amountGross: '99.00' });
    // A row no writer produces (the attach guard refuses it): the link carries org A,
    // the profile belongs to org B. No foreign key or trigger forbids it, so only the
    // aggregate's organization predicate on the profile keeps org B's amount out.
    await prisma.productVariantCostProfile.create({
      data: { organizationId: a.orgId, productVariantId: variantA.id, profileId: profileB.id },
    });

    const leaked = await listVariantCost(a, variantA.id);
    expect(leaked.currentCostTry).toBeNull();
    expect(leaked.profileCount).toBe(0);
    expect(leaked.costStatus).toBe('NO_PROFILES');

    // Positive control: org A's own profile on the same variant is summed.
    const profileA = await createCostProfile(a.orgId, {
      storeId: a.storeId,
      amountGross: '40.00',
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: a.orgId, productVariantId: variantA.id, profileId: profileA.id },
    });

    const own = await listVariantCost(a, variantA.id);
    expect(own.currentCostTry).toBe('40.00');
    expect(own.profileCount).toBe(1);
    expect(own.costStatus).toBe('OK');
  });
});

const STATUS_FILTER_VALUES = [...Object.values(ProductVariantStatus), 'DELISTED'];

// One product per call carrying a variant in every ProductVariantStatus plus a
// delisted one, so every status filter value matches it.
async function seedEveryStatus(orgId: string, storeId: string, contentId: bigint): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: contentId,
      productMainId: `pm-all-${contentId.toString()}`,
      title: `Every status ${contentId.toString()}`,
    },
  });
  const variants = [
    ...Object.values(ProductVariantStatus).map((status) => ({ status, delistedAt: null })),
    { status: ProductVariantStatus.ON_SALE, delistedAt: new Date() },
  ];
  for (const [index, variant] of variants.entries()) {
    await prisma.productVariant.create({
      data: {
        organizationId: orgId,
        storeId,
        productId: product.id,
        platformVariantId: contentId * 100n + BigInt(index),
        barcode: `bc-${contentId.toString()}-${index.toString()}`,
        stockCode: `sk-${contentId.toString()}-${index.toString()}`,
        salePrice: '50.00',
        listPrice: '50.00',
        status: variant.status,
        delistedAt: variant.delistedAt,
      },
    });
  }
}

describe('Tenant isolation: status filter values and the default listing scope', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("the default scope's list total and facets total count only the caller's org", async () => {
    const a = await makeTenantWithProducts(1);
    const b = await makeTenantWithProducts(2);
    await seedEveryStatus(b.orgId, b.storeId, 2900n);

    const list = await app.request(`/v1/organizations/${a.orgId}/stores/${a.storeId}/products`, {
      headers: { Authorization: bearer(a.user.accessToken) },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { pagination: { total: number } };
    expect(listBody.pagination.total).toBe(2);

    const facets = await app.request(
      `/v1/organizations/${a.orgId}/stores/${a.storeId}/products/facets`,
      { headers: { Authorization: bearer(a.user.accessToken) } },
    );
    expect(facets.status).toBe(200);
    const facetsBody = (await facets.json()) as { overrideCounts: { total: number } };
    expect(facetsBody.overrideCounts.total).toBe(2);
  });

  it('every status value returns only the caller org products', async () => {
    const a = await makeTenantWithProducts(1);
    const b = await makeTenantWithProducts(2);
    await seedEveryStatus(a.orgId, a.storeId, 1900n);
    await seedEveryStatus(b.orgId, b.storeId, 2900n);
    const ownTitles = ['Tenant 1 Product 1', 'Tenant 1 Product 2', 'Every status 1900'];

    for (const status of STATUS_FILTER_VALUES) {
      const res = await app.request(
        `/v1/organizations/${a.orgId}/stores/${a.storeId}/products?status=${status}`,
        { headers: { Authorization: bearer(a.user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { title: string }[] };
      for (const product of body.data) {
        expect(ownTitles).toContain(product.title);
      }
      expect(body.data.map((p) => p.title)).toContain('Every status 1900');
    }
  });

  it('a MEMBER without a grant on store B gets 404 there for every status value', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const membership = await createMembership(org.id, user.id, 'MEMBER');
    const storeA = await createStore(org.id);
    const storeB = await createStore(org.id);
    await createMemberStoreAccess(org.id, membership.id, storeA.id);
    await seedEveryStatus(org.id, storeA.id, 3900n);
    await seedEveryStatus(org.id, storeB.id, 4900n);

    for (const status of STATUS_FILTER_VALUES) {
      const granted = await app.request(
        `/v1/organizations/${org.id}/stores/${storeA.id}/products?status=${status}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(granted.status).toBe(200);
      const ungranted = await app.request(
        `/v1/organizations/${org.id}/stores/${storeB.id}/products?status=${status}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(ungranted.status).toBe(404);
    }
  });
});
