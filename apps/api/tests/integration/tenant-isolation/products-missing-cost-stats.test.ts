/**
 * Multi-tenancy isolation tests for GET /products/missing-cost-stats (Task 6.2).
 *
 * Per SECURITY.md §3: every org-scoped endpoint MUST enforce the org boundary.
 * An authenticated user from Org A MUST NOT see Org B's variant counts.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

async function seedVariant(organizationId: string, storeId: string) {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Isolation Test Product',
    },
  });
  return prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: `BC-${randomUUID().slice(0, 8)}`,
      stockCode: `STK-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('100.00'),
      listPrice: new Decimal('100.00'),
    },
  });
}

describe('Tenant isolation — products/missing-cost-stats', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Org A user sees only Org A variant counts, not Org B', async () => {
    // Set up Org A with a member
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    // 1 variant in Org A with no profiles
    await seedVariant(orgA.id, storeA.id);

    // Set up Org B (no member for userA) with 10 variants
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    for (let i = 0; i < 10; i++) {
      await seedVariant(orgB.id, storeB.id);
    }

    const res = await app.request(`/v1/organizations/${orgA.id}/products/missing-cost-stats`, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      totalVariants: number;
    };

    // Org A user should see only Org A's 1 variant — Org B's 10 are invisible
    expect(body.totalVariants).toBe(1);
    expect(body.count).toBe(1);
  });

  it('MEMBER granted only store A sees store A stats, never store B (byStore narrowed)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const membership = await createMembership(org.id, user.id, 'MEMBER');
    const storeA = await createStore(org.id);
    const storeB = await createStore(org.id);
    // MEMBER is granted access to store A only.
    await createMemberStoreAccess(org.id, membership.id, storeA.id);

    // 1 profile-less variant in store A, 3 in store B.
    await seedVariant(org.id, storeA.id);
    for (let i = 0; i < 3; i++) {
      await seedVariant(org.id, storeB.id);
    }

    const res = await app.request(`/v1/organizations/${org.id}/products/missing-cost-stats`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      totalVariants: number;
      byStore: { storeId: string; missingCount: number }[];
    };

    // Only store A's single variant is counted; store B is invisible to this
    // member — no store-B id leaks in byStore, and its 3 variants don't inflate
    // the totals.
    expect(body.totalVariants).toBe(1);
    expect(body.count).toBe(1);
    expect(body.byStore.map((b) => b.storeId)).toEqual([storeA.id]);
  });

  it('Org A user gets 403 when querying Org B endpoint directly', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();

    const res = await app.request(`/v1/organizations/${orgB.id}/products/missing-cost-stats`, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    // Not a member of Org B → 403
    expect(res.status).toBe(403);
  });
});
