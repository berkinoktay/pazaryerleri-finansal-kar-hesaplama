/**
 * Multi-tenancy isolation tests for cost-profile attachment routes (PR 3).
 *
 * Per spec §9.3: the service-layer cross-org guard must reject any attempt to
 * attach/detach/replace when either the profile or the variant belongs to a
 * different organization than the authenticated user's org.
 *
 * The route layer enforces org membership (403) BEFORE the service guard.
 * These tests operate as Org A users acting against Org B resources, with
 * User A being a valid member of Org A.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('Tenant isolation — cost-profile attachment routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Shared seed helpers ──────────────────────────────────────────────────────

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

  async function setupOrgAUser() {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    return { userA, orgA, storeA };
  }

  async function setupOrgB() {
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    return { orgB, storeB };
  }

  // ─── §9.3 Case 1: Org A attaches Org B's profile to Org A's variant ─────────
  // Expected: 404 COST_PROFILE_NOT_FOUND (Org B's profile is invisible to Org A's guard)

  it('Case 1: Org A cannot attach Org B profile to Org A variant → 404 COST_PROFILE_NOT_FOUND', async () => {
    const { userA, orgA, storeA } = await setupOrgAUser();
    const { orgB } = await setupOrgB();

    const profileB = await seedProfile(orgB.id);
    const variantA = await seedVariant(orgA.id, storeA.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [profileB.id], variantIds: [variantA.id] }),
    });

    expect(res.status).toBe(404);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_NOT_FOUND');
  });

  // ─── §9.3 Case 2: Org A attaches Org A's profile to Org B's variant ─────────
  // Expected: 422 COST_PROFILE_VARIANT_ORG_MISMATCH (Org B variant is invisible to Org A)

  it('Case 2: Org A cannot attach Org A profile to Org B variant → 422 COST_PROFILE_VARIANT_ORG_MISMATCH', async () => {
    const { userA, orgA, storeA } = await setupOrgAUser();
    const { orgB, storeB } = await setupOrgB();

    const profileA = await seedProfile(orgA.id);
    const variantB = await seedVariant(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [profileA.id], variantIds: [variantB.id] }),
    });

    expect(res.status).toBe(422);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_VARIANT_ORG_MISMATCH');
  });

  // ─── §9.3 Case 3: Org A cannot detach Org B's link ───────────────────────────
  // The detach guard checks profileIds belong to orgA first.
  // Org B's profile is not visible to orgA → 404.

  it('Case 3: Org A cannot detach Org B link — profile guard returns 404', async () => {
    const { userA, orgA, storeA } = await setupOrgAUser();
    const { orgB, storeB } = await setupOrgB();

    const profileB = await seedProfile(orgB.id);
    const variantB = await seedVariant(orgB.id, storeB.id);

    // Create the link as Org B (bypassing auth)
    await prisma.productVariantCostProfile.create({
      data: { profileId: profileB.id, productVariantId: variantB.id, organizationId: orgB.id },
    });

    // Org A user tries to detach via their own org URL (Org B profile → invisible to Org A)
    const variantA = await seedVariant(orgA.id, storeA.id);
    const res = await app.request(`/v1/organizations/${orgA.id}/cost-profile-attachments/detach`, {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [profileB.id], variantIds: [variantA.id] }),
    });

    expect(res.status).toBe(404);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_NOT_FOUND');
  });

  // ─── §9.3 Case 4: Org A cannot read Org B variant's cost profiles ─────────────
  // GET /variants/:variantId/cost-profiles — Org B variant is invisible to Org A
  // Expected: 422 COST_PROFILE_VARIANT_ORG_MISMATCH (variant not found for org)

  it('Case 4: Org A cannot read Org B variant cost profiles → 422 COST_PROFILE_VARIANT_ORG_MISMATCH', async () => {
    const { userA, orgA } = await setupOrgAUser();
    const { orgB, storeB } = await setupOrgB();

    const profileB = await seedProfile(orgB.id);
    const variantB = await seedVariant(orgB.id, storeB.id);

    // Attach profile to variant in Org B
    await prisma.productVariantCostProfile.create({
      data: { profileId: profileB.id, productVariantId: variantB.id, organizationId: orgB.id },
    });

    // Org A tries to read Org B's variant's cost profiles
    const res = await app.request(
      `/v1/organizations/${orgA.id}/variants/${variantB.id}/cost-profiles`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );

    expect(res.status).toBe(422);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_VARIANT_ORG_MISMATCH');
  });

  // ─── Non-member access: Org A user tries Org B URL directly ──────────────────
  // Expected: 403 FORBIDDEN (ensureOrgMember fires before service guard)

  it('Non-member: Org A user gets 403 accessing Org B URL for attach directly', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const { orgB } = await setupOrgB();

    const res = await app.request(`/v1/organizations/${orgB.id}/cost-profile-attachments/attach`, {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileIds: [randomUUID()], variantIds: [randomUUID()] }),
    });

    expect(res.status).toBe(403);
  });

  it('Non-member: Org A user gets 403 accessing Org B URL for GET variant cost-profiles', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const { orgB, storeB } = await setupOrgB();
    const variantB = await seedVariant(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgB.id}/variants/${variantB.id}/cost-profiles`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );

    expect(res.status).toBe(403);
  });
});
