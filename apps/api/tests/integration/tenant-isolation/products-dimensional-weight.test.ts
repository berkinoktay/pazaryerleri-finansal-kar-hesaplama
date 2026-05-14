// Multi-tenancy isolation for PATCH .../variants/:variantId/dimensional-weight.
// Pattern matches docs/SECURITY.md §9: org A owns a variant; org B's user
// attempts to set its dimensional weight; the request must fail without
// mutating org A's data, and must not leak the variant's existence in any
// other way than a generic 404.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

describe('Tenant isolation: PATCH variant dimensional-weight', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("Org B's user cannot mutate Org A's variant's dimensional weight", async () => {
    // Org A: owns a variant with a known synced desi and no user override.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    const productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: BigInt(7001),
        productMainId: `pm-${randomUUID().slice(0, 8)}`,
        title: 'Org A Product',
      },
    });
    const variantA = await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: productA.id,
        platformVariantId: BigInt(7101),
        barcode: 'BA-TI',
        stockCode: 'SA-TI',
        salePrice: new Decimal('100.00'),
        listPrice: new Decimal('100.00'),
        syncedDimensionalWeight: '1.00',
      },
    });

    // Org B: a separate org with its own user, store, but trying to touch Org A.
    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await createStore(orgB.id);

    // Attack vector 1: Use Org B's path but Org A's variant id.
    const resBPath = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products/variants/${variantA.id}/dimensional-weight`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(userB.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dimensionalWeight: '99.99' }),
      },
    );
    // Must be 404 — never let B learn that the variant exists somewhere.
    expect(resBPath.status).toBe(404);

    // Attack vector 2: Use Org A's path but Org B's token.
    const resAPath = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/products/variants/${variantA.id}/dimensional-weight`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(userB.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dimensionalWeight: '99.99' }),
      },
    );
    // ensureOrgMember rejects this with 403 (not a member of org A).
    expect(resAPath.status).toBe(403);

    // The variant in Org A is unchanged.
    const after = await prisma.productVariant.findFirstOrThrow({ where: { id: variantA.id } });
    expect(after.dimensionalWeight).toBeNull(); // override never landed
    expect(after.syncedDimensionalWeight?.toString()).toBe('1');
  });
});
