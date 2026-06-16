import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

describe('Cost profile routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Shared seed helper ─────────────────────────────────────────────────────

  async function seedProfile(orgId: string, name = 'Test COGS') {
    return prisma.costProfile.create({
      data: {
        organizationId: orgId,
        name,
        type: 'COGS',
        amountGross: new Decimal('25.50'),
        currency: 'TRY',
        vatRate: 18,
        fxRateMode: 'AUTO',
      },
    });
  }

  // ─── GET /v1/organizations/:orgId/cost-profiles ─────────────────────────────

  describe('GET /v1/organizations/:orgId/cost-profiles', () => {
    it('returns 401 without a token', async () => {
      const org = await createOrganization();
      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles`);
      expect(res.status).toBe(401);
    });

    it('returns 403 when not a member', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(403);
    });

    it('returns an empty list for an org with no profiles', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { nextCursor: string | null } };
      expect(body.data).toEqual([]);
      expect(body.meta.nextCursor).toBeNull();
    });

    it('returns active profiles and excludes archived ones by default', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      await seedProfile(org.id, 'Active COGS');
      const archived = await seedProfile(org.id, 'Archived COGS');
      await prisma.costProfile.update({
        where: { id: archived.id },
        data: { archivedAt: new Date() },
      });

      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { name: string }[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.name).toBe('Active COGS');
    });
  });

  // ─── POST /v1/organizations/:orgId/cost-profiles ────────────────────────────

  describe('POST /v1/organizations/:orgId/cost-profiles', () => {
    it('creates a profile and returns 201', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles`, {
        method: 'POST',
        headers: {
          Authorization: bearer(user.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Hammadde COGS',
          type: 'COGS',
          amountGross: '25.50',
          currency: 'TRY',
          vatRate: 18,
          fxRateMode: 'AUTO',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; name: string; amountGross: string };
      expect(body.name).toBe('Hammadde COGS');
      expect(body.amountGross).toBe('25.5');

      // Verify version was seeded
      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: body.id },
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]?.version).toBe(1);
      expect(versions[0]?.changedFields).toEqual([]);
    });

    it('returns 409 when name is already taken', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const createBody = JSON.stringify({
        name: 'Duplicate',
        type: 'PACKAGING',
        amountGross: '10.00',
      });

      const first = await app.request(`/v1/organizations/${org.id}/cost-profiles`, {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: createBody,
      });
      expect(first.status).toBe(201);

      const second = await app.request(`/v1/organizations/${org.id}/cost-profiles`, {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: createBody,
      });
      expect(second.status).toBe(409);
      const err = (await second.json()) as { code: string };
      expect(err.code).toBe('COST_PROFILE_NAME_TAKEN');
    });

    it('returns 422 when MANUAL fxRateMode is missing manualFxRate', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles`, {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'X',
          type: 'COGS',
          amountGross: '10.00',
          currency: 'USD',
          fxRateMode: 'MANUAL',
        }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /v1/organizations/:orgId/cost-profiles/:id ─────────────────────────

  describe('GET /v1/organizations/:orgId/cost-profiles/:id', () => {
    it('returns 200 with the profile', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const profile = await seedProfile(org.id);

      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles/${profile.id}`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(profile.id);
    });

    it('returns 404 for unknown id', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/cost-profiles/00000000-0000-0000-0000-000000000000`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(404);
      const err = (await res.json()) as { code: string };
      expect(err.code).toBe('COST_PROFILE_NOT_FOUND');
    });
  });

  // ─── PATCH /v1/organizations/:orgId/cost-profiles/:id ───────────────────────

  describe('PATCH /v1/organizations/:orgId/cost-profiles/:id', () => {
    it('updates fields and returns 200', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const profile = await seedProfile(org.id);

      const res = await app.request(`/v1/organizations/${org.id}/cost-profiles/${profile.id}`, {
        method: 'PATCH',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name', vatRate: 20 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; vatRate: number };
      expect(body.name).toBe('Updated Name');
      expect(body.vatRate).toBe(20);
    });
  });

  // ─── POST .../archive ────────────────────────────────────────────────────────

  describe('POST /v1/organizations/:orgId/cost-profiles/:id/archive', () => {
    it('archives the profile and returns 200 with non-null archivedAt', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const profile = await seedProfile(org.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/cost-profiles/${profile.id}/archive`,
        { method: 'POST', headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { archivedAt: string | null };
      expect(body.archivedAt).not.toBeNull();
    });
  });

  // ─── POST .../restore ────────────────────────────────────────────────────────

  describe('POST /v1/organizations/:orgId/cost-profiles/:id/restore', () => {
    it('restores an archived profile and returns 200 with null archivedAt', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const profile = await seedProfile(org.id);

      // Archive first
      await prisma.costProfile.update({
        where: { id: profile.id },
        data: { archivedAt: new Date() },
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/cost-profiles/${profile.id}/restore`,
        { method: 'POST', headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { archivedAt: string | null };
      expect(body.archivedAt).toBeNull();
    });
  });

  // ─── GET .../versions ────────────────────────────────────────────────────────

  describe('GET /v1/organizations/:orgId/cost-profiles/:id/versions', () => {
    it('returns 200 with the version list', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const profile = await seedProfile(org.id);

      // Seed a version manually
      await prisma.costProfileVersion.create({
        data: {
          profileId: profile.id,
          organizationId: org.id,
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

      const res = await app.request(
        `/v1/organizations/${org.id}/cost-profiles/${profile.id}/versions`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { version: number }[] };
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]?.version).toBe(1);
    });

    it('returns 404 for a profile that does not belong to the org', async () => {
      const user = await createAuthenticatedTestUser();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);

      const res = await app.request(
        `/v1/organizations/${orgA.id}/cost-profiles/00000000-0000-0000-0000-000000000000/versions`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── GET .../attached-variants ───────────────────────────────────────────────

  describe('GET /v1/organizations/:orgId/cost-profiles/:id/attached-variants', () => {
    it('returns 200 with an empty list when no variants are attached', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const profile = await seedProfile(org.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/cost-profiles/${profile.id}/attached-variants`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('returns 404 when profile does not belong to the org', async () => {
      const user = await createAuthenticatedTestUser();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);

      const res = await app.request(
        `/v1/organizations/${orgA.id}/cost-profiles/00000000-0000-0000-0000-000000000000/attached-variants`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(404);
    });
  });
});
