import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('POST /v1/organizations/:orgId/cost-profile-attachments/replace', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Seed helpers ───────────────────────────────────────────────────────────

  async function seedProfile(orgId: string) {
    return prisma.costProfile.create({
      data: {
        organizationId: orgId,
        name: `Profile-${randomUUID().slice(0, 8)}`,
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
    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantIds: [randomUUID()], profileIds: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('replaces profile set and returns variantsAffected and finalProfilesPerVariant', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const [profile1, profile2] = await Promise.all([seedProfile(org.id), seedProfile(org.id)]);
    const variant = await seedVariant(org.id, store.id);

    // Attach profile1 first
    await prisma.productVariantCostProfile.create({
      data: { profileId: profile1!.id, productVariantId: variant.id, organizationId: org.id },
    });

    // Replace with profile2
    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/replace`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantIds: [variant.id], profileIds: [profile2!.id] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      variantsAffected: number;
      finalProfilesPerVariant: number;
    };
    expect(body.variantsAffected).toBe(1);
    expect(body.finalProfilesPerVariant).toBe(1);

    const links = await prisma.productVariantCostProfile.findMany({
      where: { productVariantId: variant.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]?.profileId).toBe(profile2!.id);
  });

  it('clears all profiles when profileIds is empty', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const profile = await seedProfile(org.id);
    const variant = await seedVariant(org.id, store.id);

    await prisma.productVariantCostProfile.create({
      data: { profileId: profile.id, productVariantId: variant.id, organizationId: org.id },
    });

    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/replace`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantIds: [variant.id], profileIds: [] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      variantsAffected: number;
      finalProfilesPerVariant: number;
    };
    expect(body.finalProfilesPerVariant).toBe(0);

    const links = await prisma.productVariantCostProfile.findMany({
      where: { productVariantId: variant.id },
    });
    expect(links).toHaveLength(0);
  });

  it('returns 409 when replacing with an archived profile', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const archived = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        name: 'Archived',
        type: 'COGS',
        amount: new Decimal('10.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
        archivedAt: new Date(),
      },
    });
    const variant = await seedVariant(org.id, store.id);

    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/replace`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantIds: [variant.id], profileIds: [archived.id] }),
    });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_ARCHIVED_CANNOT_ATTACH');
  });
});
