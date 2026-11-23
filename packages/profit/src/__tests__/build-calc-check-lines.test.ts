/**
 * Integration tests for buildCalcCheckLines (plan PR-2c, Gorev 3; PR-3b cost rule):
 * each order line is resolved by barcode inside its store and carries the cost of a
 * link in force at `at` (attached by then, its profile's version at `at` not an
 * archive version), its effective desi (seller override, else the Trendyol desi;
 * empty when neither exists; 0 is a real desi) and its digital flag, all read in the
 * one variant query.
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import { getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildCalcCheckLines } from '../build-calc-check-lines';
import {
  attachCostProfile,
  createAdditionalStore,
  ensureDbReachable,
  truncateAll,
} from '../persistence/__tests__/helpers/melontik-parcel';

async function createOrg(): Promise<string> {
  const org = await prisma.organization.create({
    data: { name: 'Calc Check Org', slug: `calc-check-${randomUUID().slice(0, 8)}` },
  });
  return org.id;
}

async function createVariant(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly barcode: string;
  readonly syncedDimensionalWeight: string | null;
  readonly dimensionalWeightOverride?: string | null;
  readonly isDigital?: boolean;
}): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1e9)),
      productMainId: `pm-${params.barcode}-${randomUUID().slice(0, 6)}`,
      title: `Calc ${params.barcode}`,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1e12)),
      barcode: params.barcode,
      stockCode: `sk-${params.barcode}`,
      salePrice: '100',
      listPrice: '100',
      syncedDimensionalWeight: params.syncedDimensionalWeight,
      dimensionalWeightOverride: params.dimensionalWeightOverride ?? null,
      isDigital: params.isDigital ?? false,
    },
  });
  return variant.id;
}

/**
 * Archives a profile the way the cost-profile service does: the profile row is
 * stamped and an archive version (archivedAt = effectiveFrom = the archive instant)
 * is appended after the existing ones.
 */
async function archiveProfile(profileId: string, archivedAt: Date): Promise<void> {
  const profile = await prisma.costProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: { versions: { select: { version: true } } },
  });
  const nextVersion = Math.max(0, ...profile.versions.map((v) => v.version)) + 1;
  await prisma.costProfileVersion.create({
    data: {
      profileId,
      organizationId: profile.organizationId,
      version: nextVersion,
      name: profile.name,
      type: profile.type,
      amountGross: profile.amountGross,
      vatRate: profile.vatRate,
      archivedAt,
      changedFields: ['archivedAt'],
      changedAt: archivedAt,
      effectiveFrom: archivedAt,
    },
  });
  await prisma.costProfile.update({ where: { id: profileId }, data: { archivedAt } });
}

// The decision time of today's order: the end of today's business day.
function todayDecisionTime(): Date {
  return getBusinessDayRange(new Date()).end;
}

// A fixed past business day's end, for the attach/archive timing cases.
const PAST_AT = getBusinessDayRange(new Date('2026-06-05T08:00:00Z')).end;
const ONE_MINUTE_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('buildCalcCheckLines', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('carries the effective desi (override ?? synced), an empty desi as null and 0 as a real desi', async () => {
    const organizationId = await createOrg();
    const storeId = await createAdditionalStore({ organizationId, name: 'Store A' });
    const overrideId = await createVariant({
      organizationId,
      storeId,
      barcode: 'OVR',
      syncedDimensionalWeight: '1',
      dimensionalWeightOverride: '2.5',
    });
    const syncedId = await createVariant({
      organizationId,
      storeId,
      barcode: 'SYN',
      syncedDimensionalWeight: '1.5',
    });
    const zeroId = await createVariant({
      organizationId,
      storeId,
      barcode: 'ZERO',
      syncedDimensionalWeight: '0',
    });
    const overrideZeroId = await createVariant({
      organizationId,
      storeId,
      barcode: 'OVR-ZERO',
      syncedDimensionalWeight: '3',
      dimensionalWeightOverride: '0',
    });
    const noneId = await createVariant({
      organizationId,
      storeId,
      barcode: 'NONE',
      syncedDimensionalWeight: null,
    });
    await attachCostProfile({
      organizationId,
      storeId,
      productVariantId: overrideId,
      amountGross: '40.00',
      vatRate: '20',
    });

    const lines = await buildCalcCheckLines(prisma, {
      organizationId,
      storeId,
      lines: [
        { barcode: 'OVR' },
        { barcode: 'SYN' },
        { barcode: 'ZERO' },
        { barcode: 'OVR-ZERO' },
        { barcode: 'NONE' },
      ],
      at: todayDecisionTime(),
    });

    expect(lines).toEqual([
      {
        barcode: 'OVR',
        variantId: overrideId,
        unitCostSnapshotNet: '40',
        unitDesi: '2.5',
        isDigital: false,
      },
      {
        barcode: 'SYN',
        variantId: syncedId,
        unitCostSnapshotNet: null,
        unitDesi: '1.5',
        isDigital: false,
      },
      {
        barcode: 'ZERO',
        variantId: zeroId,
        unitCostSnapshotNet: null,
        unitDesi: '0',
        isDigital: false,
      },
      {
        barcode: 'OVR-ZERO',
        variantId: overrideZeroId,
        unitCostSnapshotNet: null,
        unitDesi: '0',
        isDigital: false,
      },
      {
        barcode: 'NONE',
        variantId: noneId,
        unitCostSnapshotNet: null,
        unitDesi: null,
        isDigital: false,
      },
    ]);
  });

  it('carries the digital flag of the variant', async () => {
    const organizationId = await createOrg();
    const storeId = await createAdditionalStore({ organizationId, name: 'Store A' });
    const digitalId = await createVariant({
      organizationId,
      storeId,
      barcode: 'DIG',
      syncedDimensionalWeight: null,
      isDigital: true,
    });

    const [lineResult] = await buildCalcCheckLines(prisma, {
      organizationId,
      storeId,
      lines: [{ barcode: 'DIG' }],
      at: todayDecisionTime(),
    });

    expect(lineResult).toEqual({
      barcode: 'DIG',
      variantId: digitalId,
      unitCostSnapshotNet: null,
      unitDesi: null,
      isDigital: true,
    });
  });

  it('an unresolved line (unknown barcode, or a barcode of another store) has no variant, desi or digital flag', async () => {
    const organizationId = await createOrg();
    const storeId = await createAdditionalStore({ organizationId, name: 'Store A' });
    const otherStoreId = await createAdditionalStore({ organizationId, name: 'Store B' });
    await createVariant({
      organizationId,
      storeId: otherStoreId,
      barcode: 'OTHER-STORE',
      syncedDimensionalWeight: '2',
      isDigital: true,
    });

    const lines = await buildCalcCheckLines(prisma, {
      organizationId,
      storeId,
      lines: [{ barcode: 'UNKNOWN' }, { barcode: 'OTHER-STORE' }],
      at: todayDecisionTime(),
    });

    expect(lines).toEqual([
      {
        barcode: 'UNKNOWN',
        variantId: null,
        unitCostSnapshotNet: null,
        unitDesi: null,
        isDigital: false,
      },
      {
        barcode: 'OTHER-STORE',
        variantId: null,
        unitCostSnapshotNet: null,
        unitDesi: null,
        isDigital: false,
      },
    ]);
  });

  it("does not resolve another organization's variant, even with that store id and barcode", async () => {
    const ownOrganizationId = await createOrg();
    const otherOrganizationId = await createOrg();
    const otherStoreId = await createAdditionalStore({
      organizationId: otherOrganizationId,
      name: 'Other Org Store',
    });
    const otherVariantId = await createVariant({
      organizationId: otherOrganizationId,
      storeId: otherStoreId,
      barcode: 'OTHER-ORG',
      syncedDimensionalWeight: '2',
    });
    await attachCostProfile({
      organizationId: otherOrganizationId,
      storeId: otherStoreId,
      productVariantId: otherVariantId,
      amountGross: '40.00',
      vatRate: '20',
    });

    const lines = await buildCalcCheckLines(prisma, {
      organizationId: ownOrganizationId,
      storeId: otherStoreId,
      lines: [{ barcode: 'OTHER-ORG' }],
      at: todayDecisionTime(),
    });

    expect(lines).toEqual([
      {
        barcode: 'OTHER-ORG',
        variantId: null,
        unitCostSnapshotNet: null,
        unitDesi: null,
        isDigital: false,
      },
    ]);

    // Positive control: the owning organization resolves the same line.
    const [ownedLine] = await buildCalcCheckLines(prisma, {
      organizationId: otherOrganizationId,
      storeId: otherStoreId,
      lines: [{ barcode: 'OTHER-ORG' }],
      at: todayDecisionTime(),
    });
    expect(ownedLine?.variantId).toBe(otherVariantId);
  });

  describe('cost links in force at the decision time', () => {
    async function seedStoreVariant(
      barcode: string,
    ): Promise<{ organizationId: string; storeId: string; variantId: string }> {
      const organizationId = await createOrg();
      const storeId = await createAdditionalStore({ organizationId, name: 'Store A' });
      const variantId = await createVariant({
        organizationId,
        storeId,
        barcode,
        syncedDimensionalWeight: '1',
      });
      return { organizationId, storeId, variantId };
    }

    it('a variant whose only linked profile is archived has no cost', async () => {
      const { organizationId, storeId, variantId } = await seedStoreVariant('ARCHIVED');
      const profileId = await attachCostProfile({
        organizationId,
        storeId,
        productVariantId: variantId,
        amountGross: '40.00',
        vatRate: '20',
      });
      await archiveProfile(profileId, new Date(Date.now() - ONE_DAY_MS));

      const [line] = await buildCalcCheckLines(prisma, {
        organizationId,
        storeId,
        lines: [{ barcode: 'ARCHIVED' }],
        at: todayDecisionTime(),
      });

      expect(line).toEqual({
        barcode: 'ARCHIVED',
        variantId,
        unitCostSnapshotNet: null,
        unitDesi: '1',
        isDigital: false,
      });
    });

    it('an older active link counts when the newest link is archived', async () => {
      const { organizationId, storeId, variantId } = await seedStoreVariant('OLDER');
      await attachCostProfile({
        organizationId,
        storeId,
        productVariantId: variantId,
        amountGross: '30.00',
        vatRate: '20',
        attachedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const newerProfileId = await attachCostProfile({
        organizationId,
        storeId,
        productVariantId: variantId,
        amountGross: '50.00',
        vatRate: '20',
        attachedAt: new Date('2026-02-01T00:00:00Z'),
      });
      await archiveProfile(newerProfileId, new Date(Date.now() - ONE_DAY_MS));

      const [line] = await buildCalcCheckLines(prisma, {
        organizationId,
        storeId,
        lines: [{ barcode: 'OLDER' }],
        at: todayDecisionTime(),
      });

      expect(line?.unitCostSnapshotNet).toBe('30');
    });

    it('a link attached after `at` does not count', async () => {
      const { organizationId, storeId, variantId } = await seedStoreVariant('LATE-LINK');
      await attachCostProfile({
        organizationId,
        storeId,
        productVariantId: variantId,
        amountGross: '40.00',
        vatRate: '20',
        attachedAt: new Date(PAST_AT.getTime() + ONE_MINUTE_MS),
      });

      const [line] = await buildCalcCheckLines(prisma, {
        organizationId,
        storeId,
        lines: [{ barcode: 'LATE-LINK' }],
        at: PAST_AT,
      });

      expect(line?.variantId).toBe(variantId);
      expect(line?.unitCostSnapshotNet).toBeNull();
    });

    it('a profile with no version row does not count', async () => {
      const { organizationId, storeId, variantId } = await seedStoreVariant('NO-VERSION');
      const profile = await prisma.costProfile.create({
        data: {
          organizationId,
          storeId,
          name: `COGS ${randomUUID().slice(0, 8)}`,
          type: 'COGS',
          amountGross: '40.00',
          vatRate: '20',
        },
      });
      await prisma.productVariantCostProfile.create({
        data: {
          organizationId,
          productVariantId: variantId,
          profileId: profile.id,
          attachedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });

      const [line] = await buildCalcCheckLines(prisma, {
        organizationId,
        storeId,
        lines: [{ barcode: 'NO-VERSION' }],
        at: todayDecisionTime(),
      });

      expect(line?.variantId).toBe(variantId);
      expect(line?.unitCostSnapshotNet).toBeNull();
    });

    it('a profile archived after `at` still counts', async () => {
      const { organizationId, storeId, variantId } = await seedStoreVariant('LATE-ARCHIVE');
      const profileId = await attachCostProfile({
        organizationId,
        storeId,
        productVariantId: variantId,
        amountGross: '40.00',
        vatRate: '20',
      });
      await archiveProfile(profileId, new Date(PAST_AT.getTime() + ONE_MINUTE_MS));

      const [line] = await buildCalcCheckLines(prisma, {
        organizationId,
        storeId,
        lines: [{ barcode: 'LATE-ARCHIVE' }],
        at: PAST_AT,
      });

      expect(line?.unitCostSnapshotNet).toBe('40');
    });
  });
});
