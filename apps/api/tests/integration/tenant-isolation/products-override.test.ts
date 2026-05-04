// Multi-tenancy isolation for the new overrideMissing filter and the
// overrideCounts field on the facets endpoint. Pattern matches
// docs/SECURITY.md §9: org A has data with NULL costs/vats, query as
// org B's user, assert nothing leaks.

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

describe('Tenant isolation: override counts and overrideMissing filter', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("Org A's missing-cost variant does NOT surface in Org B's overrideCounts", async () => {
    // Org A — has one product with a variant missing cost
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await prisma.store.create({
      data: {
        organizationId: orgA.id,
        name: 'Store A',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '6001',
        credentials: encryptCredentials({
          supplierId: '6001',
          apiKey: 'k',
          apiSecret: 's',
        }),
      },
    });
    const pA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: BigInt(6001),
        productMainId: 'PA',
        title: 'A',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: pA.id,
        platformVariantId: BigInt(6101),
        barcode: 'BA',
        stockCode: 'SA',
        salePrice: '10',
        listPrice: '10',
      },
    });

    // Org B — empty
    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '6002',
        credentials: encryptCredentials({
          supplierId: '6002',
          apiKey: 'k',
          apiSecret: 's',
        }),
      },
    });

    // User B queries Store B's facets — should see zero across the board
    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products/facets`,
      { headers: { Authorization: bearer(userB.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      overrideCounts: { missingCost: number; missingVat: number; total: number };
    };
    expect(body.overrideCounts).toEqual({ missingCost: 0, missingVat: 0, total: 0 });
  });

  it("Org A's missing-cost product does NOT appear in Org B's overrideMissing=cost list", async () => {
    // Same shape: A has the data, B should see none.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await prisma.store.create({
      data: {
        organizationId: orgA.id,
        name: 'Store A',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '7001',
        credentials: encryptCredentials({
          supplierId: '7001',
          apiKey: 'k',
          apiSecret: 's',
        }),
      },
    });
    const pA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: BigInt(7001),
        productMainId: 'PA',
        title: 'A',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: pA.id,
        platformVariantId: BigInt(7101),
        barcode: 'BA',
        stockCode: 'SA',
        salePrice: '10',
        listPrice: '10',
      },
    });

    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '7002',
        credentials: encryptCredentials({
          supplierId: '7002',
          apiKey: 'k',
          apiSecret: 's',
        }),
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products?overrideMissing=cost`,
      { headers: { Authorization: bearer(userB.accessToken) } },
    );
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
