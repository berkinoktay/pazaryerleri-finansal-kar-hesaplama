import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('POST /v1/organizations/:orgId/cost-profile-attachments/attach', () => {
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
        amountGross: new Decimal('25.50'),
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
    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [randomUUID()], variantIds: [randomUUID()] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when not a member', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [randomUUID()], variantIds: [randomUUID()] }),
    });
    expect(res.status).toBe(403);
  });

  it('attaches profiles to variants and returns { attached } count', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const profile = await seedProfile(org.id);
    const variant = await seedVariant(org.id, store.id);

    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [profile.id], variantIds: [variant.id] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { attached: number };
    expect(body.attached).toBe(1);

    // Verify the link exists in DB
    const links = await prisma.productVariantCostProfile.findMany({
      where: { productVariantId: variant.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]?.profileId).toBe(profile.id);
  });

  it('is idempotent: re-attaching returns 0', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const profile = await seedProfile(org.id);
    const variant = await seedVariant(org.id, store.id);

    const body = JSON.stringify({ profileIds: [profile.id], variantIds: [variant.id] });
    const headers = { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' };
    const path = `/v1/organizations/${org.id}/cost-profile-attachments/attach`;

    await app.request(path, { method: 'POST', headers, body });
    const second = await app.request(path, { method: 'POST', headers, body });

    expect(second.status).toBe(200);
    const result = (await second.json()) as { attached: number };
    expect(result.attached).toBe(0);
  });

  it('returns 409 COST_PROFILE_ARCHIVED_CANNOT_ATTACH for an archived profile', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const archived = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        name: 'Archived',
        type: 'COGS',
        amountGross: new Decimal('10.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
        archivedAt: new Date(),
      },
    });
    const variant = await seedVariant(org.id, store.id);

    const res = await app.request(`/v1/organizations/${org.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [archived.id], variantIds: [variant.id] }),
    });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_ARCHIVED_CANNOT_ATTACH');
  });

  it('returns 422 COST_PROFILE_VARIANT_ORG_MISMATCH for a cross-org variant', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const profileA = await seedProfile(orgA.id);
    const variantB = await seedVariant(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [profileA.id], variantIds: [variantB.id] }),
    });
    expect(res.status).toBe(422);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_VARIANT_ORG_MISMATCH');
  });
});
