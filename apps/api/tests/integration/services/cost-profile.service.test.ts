import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import {
  archiveCostProfile,
  createCostProfile,
  getCostProfile,
  updateCostProfile,
} from '@/services/cost-profile.service';

import { CostProfileNameTakenError, CostProfileNotFoundError } from '@/lib/errors';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../helpers/factories';

const BASE_INPUT = {
  name: 'Hammadde COGS',
  type: 'COGS' as const,
  amountGross: '25.50',
  currency: 'TRY' as const,
  vatRate: 18,
  fxRateMode: 'AUTO' as const,
};

describe('cost-profile service', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── createCostProfile ──────────────────────────────────────────────────────

  describe('createCostProfile', () => {
    it('creates profile and seeds version 1 with changedFields: []', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, BASE_INPUT, user.id);

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('Hammadde COGS');
      expect(profile.amountGross.toFixed(2)).toBe('25.50');
      expect(profile.organizationId).toBe(org.id);

      // Verify version row was created in the same transaction
      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]?.version).toBe(1);
      expect(versions[0]?.changedFields).toEqual([]);
      expect(versions[0]?.changedBy).toBe(user.id);
    });

    it('persists amountGross and vatRate correctly, version row matches', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, BASE_INPUT, user.id);

      // BASE_INPUT: amountGross 25.50, vatRate 18 (GROSS convention — KDV-dahil)
      expect(profile.amountGross.toFixed(2)).toBe('25.50');
      expect(Number(profile.vatRate)).toBe(18);

      // Version row carries the same gross values
      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
      });
      expect(versions[0]?.amountGross?.toFixed(2)).toBe('25.50');
      expect(Number(versions[0]?.vatRate)).toBe(18);
    });

    it('throws CostProfileNameTakenError on duplicate name within the org', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      await createCostProfile(org.id, BASE_INPUT, user.id);

      await expect(createCostProfile(org.id, BASE_INPUT, user.id)).rejects.toBeInstanceOf(
        CostProfileNameTakenError,
      );
    });

    it('allows the same name in a different org', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);
      const orgB = await createOrganization();

      await expect(createCostProfile(orgA.id, BASE_INPUT, user.id)).resolves.toBeDefined();
      await expect(createCostProfile(orgB.id, BASE_INPUT, user.id)).resolves.toBeDefined();
    });
  });

  // ─── updateCostProfile ──────────────────────────────────────────────────────

  describe('updateCostProfile', () => {
    it('appends a version with the correct changedFields diff', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, BASE_INPUT, user.id);

      const updated = await updateCostProfile(
        org.id,
        profile.id,
        { name: 'Updated COGS', amountGross: '30.00' },
        user.id,
      );

      expect(updated.name).toBe('Updated COGS');
      expect(updated.amountGross.toFixed(2)).toBe('30.00');

      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
        orderBy: { version: 'asc' },
      });
      expect(versions).toHaveLength(2);
      expect(versions[1]?.version).toBe(2);
      expect(versions[1]?.changedFields).toContain('name');
      expect(versions[1]?.changedFields).toContain('amountGross');
      expect(versions[1]?.changedFields).not.toContain('vatRate');
    });

    it('updates amountGross correctly (GROSS convention, KDV-dahil)', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, BASE_INPUT, user.id);
      const updated = await updateCostProfile(
        org.id,
        profile.id,
        { amountGross: '100.00' },
        user.id,
      );

      // amountGross updated directly — KDV-dahil tutar
      expect(updated.amountGross.toFixed(2)).toBe('100.00');
    });

    it('updates vatRate correctly when changed independently', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, BASE_INPUT, user.id);
      const updated = await updateCostProfile(org.id, profile.id, { vatRate: 20 }, user.id);

      // vatRate stored as-is; amountGross unchanged
      expect(Number(updated.vatRate)).toBe(20);
      expect(updated.amountGross.toFixed(2)).toBe('25.50');
    });

    it('throws CostProfileNotFoundError for cross-org access', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);
      const orgB = await createOrganization();

      const profile = await createCostProfile(orgA.id, BASE_INPUT, user.id);

      await expect(
        updateCostProfile(orgB.id, profile.id, { name: 'Hijack' }, user.id),
      ).rejects.toBeInstanceOf(CostProfileNotFoundError);
    });
  });

  // ─── archiveCostProfile ─────────────────────────────────────────────────────

  describe('archiveCostProfile', () => {
    it('sets archivedAt and appends version with changedFields: [archivedAt]', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, BASE_INPUT, user.id);
      const archived = await archiveCostProfile(org.id, profile.id, user.id);

      expect(archived.archivedAt).not.toBeNull();

      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
        orderBy: { version: 'asc' },
      });
      expect(versions).toHaveLength(2);
      expect(versions[1]?.version).toBe(2);
      expect(versions[1]?.changedFields).toEqual(['archivedAt']);
    });
  });

  // ─── getCostProfile — cross-org isolation ───────────────────────────────────

  describe('getCostProfile', () => {
    it('throws CostProfileNotFoundError for cross-org access (non-disclosure)', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);
      const orgB = await createOrganization();

      const profile = await createCostProfile(orgA.id, BASE_INPUT, user.id);

      // Org B should NOT see Org A's profile
      await expect(getCostProfile(orgB.id, profile.id)).rejects.toBeInstanceOf(
        CostProfileNotFoundError,
      );
    });
  });

  // ─── Concurrent update race protection ──────────────────────────────────────

  describe('concurrent updates', () => {
    it('serializes concurrent PATCHes via SELECT FOR UPDATE — version numbers are monotonically increasing', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, BASE_INPUT, user.id);

      // Fire two concurrent updates. Because the service uses SELECT FOR UPDATE,
      // one will block until the other commits, ensuring both succeed and produce
      // distinct, non-colliding version numbers.
      await Promise.all([
        updateCostProfile(org.id, profile.id, { name: 'Race A' }, user.id),
        updateCostProfile(org.id, profile.id, { vatRate: 20 }, user.id),
      ]);

      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
        orderBy: { version: 'asc' },
      });

      // Version 1 (create) + 2 updates = 3 total. All version numbers distinct.
      expect(versions).toHaveLength(3);
      const vNums = versions.map((v) => v.version);
      expect(new Set(vNums).size).toBe(3);
      // Monotonically increasing
      expect(vNums[0]).toBeLessThan(vNums[1]!);
      expect(vNums[1]).toBeLessThan(vNums[2]!);
    });
  });
});
