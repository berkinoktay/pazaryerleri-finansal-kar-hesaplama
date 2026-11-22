/**
 * Integration tests for buildCalcCheckLines (plan PR-2c, Gorev 3): each order line
 * is resolved by barcode inside its store and carries the variant's latest cost,
 * its effective desi (seller override, else the Trendyol desi; empty when neither
 * exists; 0 is a real desi) and its digital flag, all read in the one variant query.
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
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
    });
    expect(ownedLine?.variantId).toBe(otherVariantId);
  });
});
