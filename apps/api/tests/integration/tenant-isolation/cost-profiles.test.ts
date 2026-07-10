/**
 * Multi-tenancy isolation tests for cost-profile routes (PR 2).
 *
 * Per spec §9.3: Org A user receives 404 (not 403) when trying to access
 * Org B's profile or any of its sub-resources. 404 is used instead of 403
 * to avoid information disclosure (existence non-disclosure, SECURITY.md §3).
 *
 * Org A user cannot list Org B's profiles (the list response only includes
 * profiles from the org derived from the URL + membership check).
 */

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('Tenant isolation — cost-profile routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Shared seed ─────────────────────────────────────────────────────────────

  async function seedOrgBProfile() {
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        name: 'Org B COGS',
        type: 'COGS',
        amountGross: new Decimal('15.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: orgB.id,
        version: 1,
        name: profile.name,
        type: profile.type,
        amountGross: profile.amountGross,
        currency: profile.currency,
        vatRate: profile.vatRate,
        fxRateMode: profile.fxRateMode,
        changedFields: [],
      },
    });
    return { orgB, profile };
  }

  async function setupOrgAUser() {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    return { userA, orgA };
  }

  // ─── GET /cost-profiles (list) — Org A cannot see Org B's profiles ────────

  it("Org A list does not include Org B's profiles", async () => {
    const { userA, orgA } = await setupOrgAUser();
    const storeA = await createStore(orgA.id);
    await seedOrgBProfile();

    // Create one profile in Org A to confirm the list still works for own profiles
    await prisma.costProfile.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'Org A COGS',
        type: 'COGS',
        amountGross: new Decimal('10.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/cost-profiles?storeId=${storeA.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string }[] };
    // Only Org A's profile should appear
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe('Org A COGS');
  });

  // ─── GET /cost-profiles/:id — 404, not 403 ───────────────────────────────────

  it("Org A user gets 404 (not 403) when accessing Org B's profile via Org A URL", async () => {
    const { userA, orgA } = await setupOrgAUser();
    const { profile: profileB } = await seedOrgBProfile();

    // User A is a member of Org A; they try to read Org B's profile via Org A's URL
    const res = await app.request(`/v1/organizations/${orgA.id}/cost-profiles/${profileB.id}`, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(res.status).toBe(404);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_NOT_FOUND');
  });

  // ─── PATCH /cost-profiles/:id — 404 for cross-org ───────────────────────────

  it("Org A user gets 404 when PATCHing Org B's profile", async () => {
    const { userA, orgA } = await setupOrgAUser();
    const { profile: profileB } = await seedOrgBProfile();

    const res = await app.request(`/v1/organizations/${orgA.id}/cost-profiles/${profileB.id}`, {
      method: 'PATCH',
      headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
      // GROSS konvansiyon: çapraz-org PATCH gross para alanını dener; yine 404
      // (route org filtresinde reddeder, gövde işlenmeden önce — sızıntı yok).
      body: JSON.stringify({ name: 'Hijacked', amountGross: '999.00' }),
    });
    expect(res.status).toBe(404);
  });

  // ─── POST /cost-profiles/:id/archive — 404 for cross-org ────────────────────

  it("Org A user gets 404 when archiving Org B's profile", async () => {
    const { userA, orgA } = await setupOrgAUser();
    const { profile: profileB } = await seedOrgBProfile();

    const res = await app.request(
      `/v1/organizations/${orgA.id}/cost-profiles/${profileB.id}/archive`,
      { method: 'POST', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  // ─── POST /cost-profiles/:id/restore — 404 for cross-org ───────────────────

  it("Org A user gets 404 when restoring Org B's profile", async () => {
    const { userA, orgA } = await setupOrgAUser();
    const { orgB, profile: profileB } = await seedOrgBProfile();

    // First archive Org B's profile (as Prisma, bypassing RLS)
    await prisma.costProfile.update({
      where: { id: profileB.id, organizationId: orgB.id },
      data: { archivedAt: new Date() },
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/cost-profiles/${profileB.id}/restore`,
      { method: 'POST', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  // ─── GET /cost-profiles/:id/versions — 404 for cross-org ─────────────────────

  it("Org A user gets 404 when listing Org B's profile versions", async () => {
    const { userA, orgA } = await setupOrgAUser();
    const { profile: profileB } = await seedOrgBProfile();

    const res = await app.request(
      `/v1/organizations/${orgA.id}/cost-profiles/${profileB.id}/versions`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  // ─── GET /cost-profiles/:id/attached-variants — 404 for cross-org ────────────

  it("Org A user gets 404 when listing Org B's attached variants", async () => {
    const { userA, orgA } = await setupOrgAUser();
    const { profile: profileB } = await seedOrgBProfile();

    const res = await app.request(
      `/v1/organizations/${orgA.id}/cost-profiles/${profileB.id}/attached-variants`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  // ─── Non-member access to Org B routes directly ───────────────────────────────

  it('Org A user gets 403 (not 404) when accessing Org B URL directly (not a member)', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const { orgB, profile: profileB } = await seedOrgBProfile();

    // User A is NOT a member of Org B — ensureOrgMember returns 403 before
    // the service gets a chance to run. This is the correct first line of defence.
    const res = await app.request(`/v1/organizations/${orgB.id}/cost-profiles/${profileB.id}`, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(res.status).toBe(403);
  });
});
