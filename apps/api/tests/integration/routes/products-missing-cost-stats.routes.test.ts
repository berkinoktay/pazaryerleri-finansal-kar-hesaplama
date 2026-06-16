/**
 * Integration tests for GET /v1/organizations/:orgId/products/missing-cost-stats (Task 6.2).
 *
 * Returns { count, totalVariants, byStore: [{ storeId, missingCount }] }
 * where count = number of variants with 0 active attached profiles.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedVariant(organizationId: string, storeId: string) {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Test Product',
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

async function attachProfile(organizationId: string, variantId: string) {
  const profile = await prisma.costProfile.create({
    data: {
      organizationId,
      name: `Profile ${randomUUID().slice(0, 6)}`,
      type: 'COGS',
      amountGross: new Decimal('10.00'),
      currency: 'TRY',
      vatRate: 0,
      fxRateMode: 'AUTO',
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId, profileId: profile.id, productVariantId: variantId },
  });
}

type MissingStatsBody = {
  count: number;
  totalVariants: number;
  byStore: { storeId: string; missingCount: number }[];
};

async function callStats(
  accessToken: string,
  orgId: string,
): Promise<{ status: number; body: MissingStatsBody }> {
  const res = await app.request(`/v1/organizations/${orgId}/products/missing-cost-stats`, {
    headers: { Authorization: bearer(accessToken) },
  });
  const body = (await res.json()) as MissingStatsBody;
  return { status: res.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /v1/organizations/:orgId/products/missing-cost-stats', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const org = await createOrganization();
    const res = await app.request(`/v1/organizations/${org.id}/products/missing-cost-stats`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not a member', async () => {
    const user = await createAuthenticatedTestUser();
    const otherOrg = await createOrganization();
    const { status } = await callStats(user.accessToken, otherOrg.id);
    expect(status).toBe(403);
  });

  it('returns zeroes when org has no variants', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const { status, body } = await callStats(user.accessToken, org.id);
    expect(status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.totalVariants).toBe(0);
    expect(body.byStore).toEqual([]);
  });

  it('counts variants with no profiles as missing', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await seedVariant(org.id, store.id);
    await seedVariant(org.id, store.id);

    const { status, body } = await callStats(user.accessToken, org.id);
    expect(status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.totalVariants).toBe(2);
    const storeRow = body.byStore.find((r) => r.storeId === store.id);
    expect(storeRow?.missingCount).toBe(2);
  });

  it('does not count variants that have an active profile attached', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variant1 = await seedVariant(org.id, store.id);
    const variant2 = await seedVariant(org.id, store.id);
    // Attach a profile to variant1 — it should NOT be counted as missing
    await attachProfile(org.id, variant1.id);

    const { status, body } = await callStats(user.accessToken, org.id);
    expect(status).toBe(200);
    expect(body.count).toBe(1); // only variant2 is missing
    expect(body.totalVariants).toBe(2);
    const storeRow = body.byStore.find((r) => r.storeId === store.id);
    expect(storeRow?.missingCount).toBe(1);
    // Silence unused var warning
    void variant2;
  });

  it('groups missing counts by store when there are multiple stores', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const storeA = await createStore(org.id);
    const storeB = await createStore(org.id);

    await seedVariant(org.id, storeA.id);
    await seedVariant(org.id, storeA.id);
    const v = await seedVariant(org.id, storeB.id);
    await attachProfile(org.id, v.id);

    const { status, body } = await callStats(user.accessToken, org.id);
    expect(status).toBe(200);
    expect(body.count).toBe(2); // storeA has 2 missing; storeB has 0
    expect(body.totalVariants).toBe(3);
    const rowA = body.byStore.find((r) => r.storeId === storeA.id);
    const rowB = body.byStore.find((r) => r.storeId === storeB.id);
    expect(rowA?.missingCount).toBe(2);
    expect(rowB?.missingCount).toBe(0);
  });
});
