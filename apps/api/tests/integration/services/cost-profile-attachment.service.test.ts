import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import {
  attachCostProfiles,
  detachCostProfiles,
  listCostProfilesForVariant,
  replaceCostProfilesForVariants,
} from '@/services/cost-profile-attachment.service';
import {
  CostProfileArchivedCannotAttachError,
  CostProfileNotFoundError,
  CostProfileVariantOrgMismatchError,
} from '@/lib/errors';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore, createUserProfile } from '../../helpers/factories';

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedProfile(orgId: string, opts: { archived?: boolean; name?: string } = {}) {
  return prisma.costProfile.create({
    data: {
      organizationId: orgId,
      name: opts.name ?? `Profile-${randomUUID().slice(0, 8)}`,
      type: 'COGS',
      amount: new Decimal('25.50'),
      currency: 'TRY',
      vatRate: 18,
      fxRateMode: 'AUTO',
      archivedAt: opts.archived === true ? new Date() : null,
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

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('cost-profile-attachment service', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── attachCostProfiles ───────────────────────────────────────────────────

  describe('attachCostProfiles', () => {
    it('attaches profiles to variants and returns count', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const profile = await seedProfile(org.id);
      const variant = await seedVariant(org.id, store.id);

      const result = await attachCostProfiles(org.id, [profile.id], [variant.id], user.id);

      expect(result.attached).toBe(1);

      const links = await prisma.productVariantCostProfile.findMany({
        where: { productVariantId: variant.id },
      });
      expect(links).toHaveLength(1);
      expect(links[0]?.profileId).toBe(profile.id);
      expect(links[0]?.attachedBy).toBe(user.id);
    });

    it('is idempotent: re-attaching the same profile returns 0 (no new rows)', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const profile = await seedProfile(org.id);
      const variant = await seedVariant(org.id, store.id);

      // First attach
      const first = await attachCostProfiles(org.id, [profile.id], [variant.id], user.id);
      expect(first.attached).toBe(1);

      // Second attach — same pair, should be a no-op
      const second = await attachCostProfiles(org.id, [profile.id], [variant.id], user.id);
      expect(second.attached).toBe(0);

      // DB must still have exactly one link row
      const links = await prisma.productVariantCostProfile.findMany({
        where: { productVariantId: variant.id },
      });
      expect(links).toHaveLength(1);
    });

    it('attaches Cartesian product (2 profiles × 2 variants = 4 links)', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const [profile1, profile2] = await Promise.all([seedProfile(org.id), seedProfile(org.id)]);
      const [variant1, variant2] = await Promise.all([
        seedVariant(org.id, store.id),
        seedVariant(org.id, store.id),
      ]);

      const result = await attachCostProfiles(
        org.id,
        [profile1!.id, profile2!.id],
        [variant1!.id, variant2!.id],
        user.id,
      );

      expect(result.attached).toBe(4);
    });

    it('throws CostProfileArchivedCannotAttachError for an archived profile', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const archived = await seedProfile(org.id, { archived: true });
      const variant = await seedVariant(org.id, store.id);

      await expect(
        attachCostProfiles(org.id, [archived.id], [variant.id], user.id),
      ).rejects.toBeInstanceOf(CostProfileArchivedCannotAttachError);
    });

    it('throws CostProfileNotFoundError for a cross-org profile', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      const orgB = await createOrganization();
      const storeA = await createStore(orgA.id);

      const profileB = await seedProfile(orgB.id);
      const variantA = await seedVariant(orgA.id, storeA.id);

      await expect(
        attachCostProfiles(orgA.id, [profileB.id], [variantA.id], user.id),
      ).rejects.toBeInstanceOf(CostProfileNotFoundError);
    });

    it('throws CostProfileVariantOrgMismatchError for a cross-org variant', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      const orgB = await createOrganization();
      const storeB = await createStore(orgB.id);

      const profileA = await seedProfile(orgA.id);
      const variantB = await seedVariant(orgB.id, storeB.id);

      await expect(
        attachCostProfiles(orgA.id, [profileA.id], [variantB.id], user.id),
      ).rejects.toBeInstanceOf(CostProfileVariantOrgMismatchError);
    });
  });

  // ─── detachCostProfiles ───────────────────────────────────────────────────

  describe('detachCostProfiles', () => {
    it('removes links and returns count', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const profile = await seedProfile(org.id);
      const variant = await seedVariant(org.id, store.id);

      await attachCostProfiles(org.id, [profile.id], [variant.id], user.id);

      const result = await detachCostProfiles(org.id, [profile.id], [variant.id]);
      expect(result.detached).toBe(1);

      const links = await prisma.productVariantCostProfile.findMany({
        where: { productVariantId: variant.id },
      });
      expect(links).toHaveLength(0);
    });

    it('throws CostProfileNotFoundError when detaching a cross-org profile', async () => {
      const orgA = await createOrganization();
      const orgB = await createOrganization();
      const storeA = await createStore(orgA.id);

      const profileB = await seedProfile(orgB.id);
      const variantA = await seedVariant(orgA.id, storeA.id);

      await expect(
        detachCostProfiles(orgA.id, [profileB.id], [variantA.id]),
      ).rejects.toBeInstanceOf(CostProfileNotFoundError);
    });

    it('throws CostProfileVariantOrgMismatchError when detaching from a cross-org variant', async () => {
      const orgA = await createOrganization();
      const orgB = await createOrganization();
      const storeB = await createStore(orgB.id);

      const profileA = await seedProfile(orgA.id);
      const variantB = await seedVariant(orgB.id, storeB.id);

      await expect(
        detachCostProfiles(orgA.id, [profileA.id], [variantB.id]),
      ).rejects.toBeInstanceOf(CostProfileVariantOrgMismatchError);
    });
  });

  // ─── replaceCostProfilesForVariants ──────────────────────────────────────

  describe('replaceCostProfilesForVariants', () => {
    it('replaces profile set for a variant with exactly the provided profileIds', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const [profile1, profile2, profile3] = await Promise.all([
        seedProfile(org.id),
        seedProfile(org.id),
        seedProfile(org.id),
      ]);
      const variant = await seedVariant(org.id, store.id);

      // Attach profiles 1 and 2 initially
      await attachCostProfiles(org.id, [profile1!.id, profile2!.id], [variant.id], user.id);

      // Replace with just profile 3
      const result = await replaceCostProfilesForVariants(
        org.id,
        [variant.id],
        [profile3!.id],
        user.id,
      );

      expect(result.variantsAffected).toBe(1);
      expect(result.finalProfilesPerVariant).toBe(1);

      const links = await prisma.productVariantCostProfile.findMany({
        where: { productVariantId: variant.id },
      });
      expect(links).toHaveLength(1);
      expect(links[0]?.profileId).toBe(profile3!.id);
    });

    it('clears all profiles for variants when profileIds is empty', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const profile = await seedProfile(org.id);
      const variant = await seedVariant(org.id, store.id);

      await attachCostProfiles(org.id, [profile.id], [variant.id], user.id);

      const result = await replaceCostProfilesForVariants(org.id, [variant.id], [], user.id);

      expect(result.variantsAffected).toBe(1);
      expect(result.finalProfilesPerVariant).toBe(0);

      const links = await prisma.productVariantCostProfile.findMany({
        where: { productVariantId: variant.id },
      });
      expect(links).toHaveLength(0);
    });

    it('variant ends with EXACTLY profileIds — no old links survive', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const [profileA, profileB, profileC] = await Promise.all([
        seedProfile(org.id),
        seedProfile(org.id),
        seedProfile(org.id),
      ]);
      const variant = await seedVariant(org.id, store.id);

      // Attach A and B
      await attachCostProfiles(org.id, [profileA!.id, profileB!.id], [variant.id], user.id);

      // Replace with B and C — A must disappear, B survives, C appears
      await replaceCostProfilesForVariants(
        org.id,
        [variant.id],
        [profileB!.id, profileC!.id],
        user.id,
      );

      const links = await prisma.productVariantCostProfile.findMany({
        where: { productVariantId: variant.id },
        orderBy: { profileId: 'asc' },
      });
      const profileIds = links.map((l) => l.profileId).sort();
      expect(profileIds).toEqual([profileB!.id, profileC!.id].sort());
    });

    it('throws CostProfileArchivedCannotAttachError when replacing with an archived profile', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const archived = await seedProfile(org.id, { archived: true });
      const variant = await seedVariant(org.id, store.id);

      await expect(
        replaceCostProfilesForVariants(org.id, [variant.id], [archived.id], user.id),
      ).rejects.toBeInstanceOf(CostProfileArchivedCannotAttachError);
    });

    it('throws CostProfileVariantOrgMismatchError for a cross-org variant', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      const orgB = await createOrganization();
      const storeB = await createStore(orgB.id);

      const profileA = await seedProfile(orgA.id);
      const variantB = await seedVariant(orgB.id, storeB.id);

      await expect(
        replaceCostProfilesForVariants(orgA.id, [variantB.id], [profileA.id], user.id),
      ).rejects.toBeInstanceOf(CostProfileVariantOrgMismatchError);
    });
  });

  // ─── listCostProfilesForVariant ───────────────────────────────────────────

  describe('listCostProfilesForVariant', () => {
    it('returns attached non-archived profiles ordered by attachedAt DESC', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      const store = await createStore(org.id);

      const [profile1, profile2] = await Promise.all([
        seedProfile(org.id, { name: 'Profile One' }),
        seedProfile(org.id, { name: 'Profile Two' }),
      ]);
      const variant = await seedVariant(org.id, store.id);

      await attachCostProfiles(org.id, [profile1!.id], [variant.id], user.id);
      await attachCostProfiles(org.id, [profile2!.id], [variant.id], user.id);

      const profiles = await listCostProfilesForVariant(org.id, variant.id);

      expect(profiles).toHaveLength(2);
      // Results ordered by attachedAt DESC — profile2 was attached later
      expect(profiles[0]?.id).toBe(profile2!.id);
      expect(profiles[1]?.id).toBe(profile1!.id);
    });

    it('returns empty list when no profiles are attached', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const variant = await seedVariant(org.id, store.id);

      const profiles = await listCostProfilesForVariant(org.id, variant.id);
      expect(profiles).toHaveLength(0);
    });

    it('throws CostProfileVariantOrgMismatchError for a cross-org variant', async () => {
      const orgA = await createOrganization();
      const orgB = await createOrganization();
      const storeB = await createStore(orgB.id);

      const variantB = await seedVariant(orgB.id, storeB.id);

      await expect(listCostProfilesForVariant(orgA.id, variantB.id)).rejects.toBeInstanceOf(
        CostProfileVariantOrgMismatchError,
      );
    });
  });
});
