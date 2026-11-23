// Multi-tenancy isolation for PATCH .../variants/:variantId/dimensional-weight.
// Pattern matches docs/SECURITY.md §9: org A owns a variant; org B's user
// attempts to set its dimensional weight; the request must fail without
// mutating org A's data, and must not leak the variant's existence in any
// other way than a generic 404.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

async function desiRequest(url: string, accessToken: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method: 'PATCH',
    headers: { Authorization: bearer(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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
    expect(after.dimensionalWeightOverride).toBeNull(); // override never landed
    expect(after.syncedDimensionalWeight?.toString()).toBe('1');
  });

  it("Org B's desi writes on Org A's variant never promote Org A's Live Performance buffer entry", async () => {
    // Org A: a fully calculable variant (cost + desi) with a PENDING entry of today,
    // so any re-check of that entry would promote it.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    const productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: BigInt(7002),
        productMainId: `pm-${randomUUID().slice(0, 8)}`,
        title: 'Org A Buffered Product',
      },
    });
    const variantA = await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: productA.id,
        platformVariantId: BigInt(7102),
        barcode: 'BA-TI-BUF',
        stockCode: 'SA-TI-BUF',
        salePrice: new Decimal('100.00'),
        listPrice: new Decimal('100.00'),
        syncedDimensionalWeight: '1.00',
      },
    });
    const profileA = await createCostProfile(orgA.id, { storeId: storeA.id });
    await prisma.productVariantCostProfile.create({
      data: { productVariantId: variantA.id, profileId: profileA.id, organizationId: orgA.id },
    });
    await createBufferEntry(orgA.id, storeA.id, {
      platformOrderId: 'pkg-org-a',
      mappedOrder: { lines: [{ barcode: 'BA-TI-BUF' }] },
    });

    // Org B: its own user and store.
    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await createStore(orgB.id);

    const single = await desiRequest(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products/variants/${variantA.id}/dimensional-weight`,
      userB.accessToken,
      { dimensionalWeight: '3.00' },
    );
    expect(single.status).toBe(404);

    const bulk = await desiRequest(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products/variants/dimensional-weight`,
      userB.accessToken,
      { variantIds: [variantA.id], dimensionalWeight: '3.00' },
    );
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toEqual({ updated: 0 });

    const entry = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { platformOrderId: 'pkg-org-a' },
    });
    expect(entry.status).toBe('PENDING');

    // Positive control: Org A's own desi write re-checks and promotes the entry.
    const own = await desiRequest(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/products/variants/${variantA.id}/dimensional-weight`,
      userA.accessToken,
      { dimensionalWeight: '3.00' },
    );
    expect(own.status).toBe(200);
    const promoted = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { platformOrderId: 'pkg-org-a' },
    });
    expect(promoted.status).toBe('PROMOTING');
  });

  it("Org B's desi writes on Org A's variant never queue Org A's non-final order", async () => {
    // Org A: a variant carried by an order whose seller inputs still follow its day,
    // so any desi write on the variant would queue it.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    const productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: BigInt(7003),
        productMainId: `pm-${randomUUID().slice(0, 8)}`,
        title: 'Org A Queued Product',
      },
    });
    const variantA = await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: productA.id,
        platformVariantId: BigInt(7103),
        barcode: 'BA-TI-Q',
        stockCode: 'SA-TI-Q',
        salePrice: new Decimal('100.00'),
        listPrice: new Decimal('100.00'),
        syncedDimensionalWeight: '1.00',
      },
    });
    const orderA = await createOrder(orgA.id, storeA.id);
    await createOrderItem(orderA.id, orgA.id, { productVariantId: variantA.id });

    // Org B: its own user and store.
    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await createStore(orgB.id);

    const single = await desiRequest(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products/variants/${variantA.id}/dimensional-weight`,
      userB.accessToken,
      { dimensionalWeight: '3.00' },
    );
    expect(single.status).toBe(404);

    const bulk = await desiRequest(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products/variants/dimensional-weight`,
      userB.accessToken,
      { variantIds: [variantA.id], dimensionalWeight: null },
    );
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toEqual({ updated: 0 });

    expect(await prisma.profitRecomputeRequest.count()).toBe(0);

    // Positive control: Org A's own desi write queues its non-final order.
    const own = await desiRequest(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/products/variants/${variantA.id}/dimensional-weight`,
      userA.accessToken,
      { dimensionalWeight: '3.00' },
    );
    expect(own.status).toBe(200);
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderA.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.DESI_CHANGED);
  });
});
