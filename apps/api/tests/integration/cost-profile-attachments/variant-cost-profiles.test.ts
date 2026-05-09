import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('GET /v1/organizations/:orgId/variants/:variantId/cost-profiles', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Seed helpers ───────────────────────────────────────────────────────────

  async function seedProfile(orgId: string, name?: string) {
    return prisma.costProfile.create({
      data: {
        organizationId: orgId,
        name: name ?? `Profile-${randomUUID().slice(0, 8)}`,
        type: 'COGS',
        amount: new Decimal('25.50'),
        currency: 'TRY',
        vatRate: 18,
        fxRateMode: 'AUTO',
      },
    });
  }

  async function seedVariant(orgId: string, storeId: string) {
    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        storeId,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        productMainId: `main-${randomUUID().slice(0, 8)}`,
        title: 'Test Product',
      },
    });
    return prisma.productVariant.create({
      data: {
        organizationId: orgId,
        storeId,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        barcode: randomUUID().slice(0, 13),
        stockCode: `SKU-${randomUUID().slice(0, 8)}`,
        salePrice: new Decimal('199.99'),
        listPrice: new Decimal('249.99'),
      },
    });
  }

  it('returns 401 without a token', async () => {
    const org = await createOrganization();
    const res = await app.request(
      `/v1/organizations/${org.id}/variants/${randomUUID()}/cost-profiles`,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when not a member', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const res = await app.request(
      `/v1/organizations/${org.id}/variants/${randomUUID()}/cost-profiles`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 with an empty list when no profiles are attached', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const variant = await seedVariant(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/variants/${variant.id}/cost-profiles`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns attached profiles ordered by attachedAt DESC', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const profile1 = await seedProfile(org.id, 'Profile Alpha');
    const profile2 = await seedProfile(org.id, 'Profile Beta');
    const variant = await seedVariant(org.id, store.id);

    // Attach in order: alpha first, then beta
    await prisma.productVariantCostProfile.create({
      data: { profileId: profile1.id, productVariantId: variant.id, organizationId: org.id },
    });
    await prisma.productVariantCostProfile.create({
      data: { profileId: profile2.id, productVariantId: variant.id, organizationId: org.id },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/variants/${variant.id}/cost-profiles`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; name: string }[] };
    expect(body.data).toHaveLength(2);
    // Beta was attached later so it comes first (DESC)
    expect(body.data[0]?.id).toBe(profile2.id);
    expect(body.data[1]?.id).toBe(profile1.id);
  });

  it('returns 422 when variant does not belong to the org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const variantB = await seedVariant(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/variants/${variantB.id}/cost-profiles`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(422);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_VARIANT_ORG_MISMATCH');
  });
});
