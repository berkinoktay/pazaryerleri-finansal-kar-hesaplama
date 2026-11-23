import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';
import { getBusinessDateAnchor } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  attachCostProfiles,
  replaceCostProfilesForVariants,
} from '../../../src/services/cost-profile-attachment.service';
import { archiveCostProfile, restoreCostProfile } from '../../../src/services/cost-profile.service';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  COST_FIXTURE_EPOCH,
  createBufferEntry,
  createCostProfile,
  createOrganization,
  createStore,
} from '../../helpers/factories';

/** Minimal MappedOrder-shaped buffer payload — the flip only reads lines[].barcode. */
function buildMappedOrder(barcodes: string[]): Prisma.InputJsonValue {
  return { lines: barcodes.map((barcode) => ({ barcode })) } as unknown as Prisma.InputJsonValue;
}

/**
 * A cost-MISSING variant (resolves by barcode, no cost profile attached yet). An
 * omitted desi keeps the column default 0 (a real desi); null is a variant with no desi.
 */
async function seedVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
  syncedDimensionalWeight?: string | null,
): Promise<{ id: string }> {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: `Product ${barcode}`,
    },
  });
  return prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      ...(syncedDimensionalWeight !== undefined ? { syncedDimensionalWeight } : {}),
    },
    select: { id: true },
  });
}

describe('cost attach — Live Performance buffer flip (full-calculability)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('flips single-line PENDING entries to PROMOTING when the variant gets cost', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variant = await seedVariant(org.id, store.id, 'BC-1');
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    for (const platformOrderId of ['pkg-1', 'pkg-2', 'pkg-3']) {
      await createBufferEntry(org.id, store.id, {
        platformOrderId,
        status: 'PENDING',
        mappedOrder: buildMappedOrder(['BC-1']),
      });
    }

    const result = await attachCostProfiles(org.id, [profile.id], [variant.id], randomUUID(), null);

    expect(result.bufferEntriesPromoted).toBe(3);
    const entries = await prisma.livePerformanceBuffer.findMany({ where: { storeId: store.id } });
    expect(entries.every((e) => e.status === 'PROMOTING')).toBe(true);
  });

  it('skips a malformed buffer entry instead of failing the cost attach', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variant = await seedVariant(org.id, store.id, 'BC-1');
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    const good = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-good',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-1']),
    });
    // One line carries the barcode, another has none: it can never become calculable.
    const missingBarcode = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-no-barcode',
      status: 'PENDING',
      mappedOrder: { lines: [{ barcode: 'BC-1', quantity: 1 }, { quantity: 1 }] },
    });
    // Lines stored as an object instead of an array must not raise in the scan.
    const linesNotArray = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-lines-object',
      status: 'PENDING',
      mappedOrder: { lines: { barcode: 'BC-1', quantity: 1 } },
    });

    const result = await attachCostProfiles(org.id, [profile.id], [variant.id], randomUUID(), null);

    expect(result.bufferEntriesPromoted).toBe(1);
    const statusOf = async (id: string): Promise<string | undefined> =>
      (await prisma.livePerformanceBuffer.findUnique({ where: { id } }))?.status;
    expect(await statusOf(good.id)).toBe('PROMOTING');
    expect(await statusOf(missingBarcode.id)).toBe('PENDING');
    expect(await statusOf(linesNotArray.id)).toBe('PENDING');
  });

  it('does NOT flip a multi-line order until EVERY line is cost-attached', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const vA = await seedVariant(org.id, store.id, 'BC-A');
    const vB = await seedVariant(org.id, store.id, 'BC-B');
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    // One PENDING entry whose order has BOTH lines (A + B), both cost-missing.
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-multi',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-A', 'BC-B']),
    });

    // Attach cost to A only → B still missing → order not yet calculable → no flip.
    const r1 = await attachCostProfiles(org.id, [profile.id], [vA.id], randomUUID(), null);
    expect(r1.bufferEntriesPromoted).toBe(0);
    expect(
      (await prisma.livePerformanceBuffer.findFirstOrThrow({ where: { storeId: store.id } }))
        .status,
    ).toBe('PENDING');

    // Now attach cost to B → all lines calculable → flips.
    const r2 = await attachCostProfiles(org.id, [profile.id], [vB.id], randomUUID(), null);
    expect(r2.bufferEntriesPromoted).toBe(1);
    expect(
      (await prisma.livePerformanceBuffer.findFirstOrThrow({ where: { storeId: store.id } }))
        .status,
    ).toBe('PROMOTING');
  });

  it('does not flip entries whose order does not contain the attached barcode', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variant = await seedVariant(org.id, store.id, 'BC-1');
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-other',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-OTHER']),
    });

    const result = await attachCostProfiles(org.id, [profile.id], [variant.id], randomUUID(), null);

    expect(result.bufferEntriesPromoted).toBe(0);
    expect(
      (await prisma.livePerformanceBuffer.findFirstOrThrow({ where: { storeId: store.id } }))
        .status,
    ).toBe('PENDING');
  });

  it('cross-store isolation: attaching cost in store A does not flip store B buffer', async () => {
    const org = await createOrganization();
    const storeA = await createStore(org.id, { name: 'A' });
    const storeB = await createStore(org.id, { name: 'B' });
    const vA = await seedVariant(org.id, storeA.id, 'BC-1');
    await seedVariant(org.id, storeB.id, 'BC-1'); // same barcode, different store

    // Profile is store-scoped: it lives in store A alongside the variant it attaches to.
    const profile = await createCostProfile(org.id, { storeId: storeA.id, amountGross: '50.00' });

    await createBufferEntry(org.id, storeB.id, {
      platformOrderId: 'pkg-storeB',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-1']),
    });

    const result = await attachCostProfiles(org.id, [profile.id], [vA.id], randomUUID(), null);

    expect(result.bufferEntriesPromoted).toBe(0);
    expect(
      (await prisma.livePerformanceBuffer.findFirstOrThrow({ where: { storeId: storeB.id } }))
        .status,
    ).toBe('PENDING');
  });

  it('replaceCostProfilesForVariants also flips a now-calculable entry', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variant = await seedVariant(org.id, store.id, 'BC-R');
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-r',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-R']),
    });

    const result = await replaceCostProfilesForVariants(
      org.id,
      [variant.id],
      [profile.id],
      randomUUID(),
      null,
    );

    expect(result.bufferEntriesPromoted).toBe(1);
    expect(
      (await prisma.livePerformanceBuffer.findFirstOrThrow({ where: { storeId: store.id } }))
        .status,
    ).toBe('PROMOTING');
  });

  it('flips only same-day pending buffer rows when a cost is attached', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variant = await seedVariant(org.id, store.id, 'BC-DAY');
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    // Two PENDING entries for the same barcode: one from today's business day, one
    // from a past day. Attaching the cost makes both calculable, but the flip must
    // touch only the same-day row. A past-day row's cost window is already closed, so
    // the day-end flush -- not a late cost attach -- graduates it under the cost-window
    // rule (defense in depth for the promote-tick exclusion check).
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-today',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-DAY']),
    });
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-pastday',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-DAY']),
    });

    const result = await attachCostProfiles(org.id, [profile.id], [variant.id], randomUUID(), null);

    expect(result.bufferEntriesPromoted).toBe(1);
    const today = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { platformOrderId: 'pkg-today' },
    });
    expect(today.status).toBe('PROMOTING');
    const pastday = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { platformOrderId: 'pkg-pastday' },
    });
    expect(pastday.status).toBe('PENDING');
  });

  it('a cost attach leaves an entry whose product has no desi PENDING and promotes the one with a desi', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const noDesi = await seedVariant(org.id, store.id, 'BC-NO-DESI', null);
    const withDesi = await seedVariant(org.id, store.id, 'BC-DESI', '1.50');
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-no-desi',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-NO-DESI']),
    });
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-desi',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-DESI']),
    });

    const result = await attachCostProfiles(
      org.id,
      [profile.id],
      [noDesi.id, withDesi.id],
      randomUUID(),
      null,
    );

    expect(result.bufferEntriesPromoted).toBe(1);
    const desiless = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { platformOrderId: 'pkg-no-desi' },
    });
    expect(desiless.status).toBe('PENDING');
    const desiPresent = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { platformOrderId: 'pkg-desi' },
    });
    expect(desiPresent.status).toBe('PROMOTING');
  });

  it('replaceCostProfilesForVariants also leaves a desiless entry PENDING', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const noDesi = await seedVariant(org.id, store.id, 'BC-R-NO-DESI', null);
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });

    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-r-no-desi',
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-R-NO-DESI']),
    });

    const result = await replaceCostProfilesForVariants(
      org.id,
      [noDesi.id],
      [profile.id],
      randomUUID(),
      null,
    );

    expect(result.bufferEntriesPromoted).toBe(0);
    expect(
      (await prisma.livePerformanceBuffer.findFirstOrThrow({ where: { storeId: store.id } }))
        .status,
    ).toBe('PENDING');
  });
});

/**
 * A variant with a desi whose only cost profile was archived through the service:
 * version 1 and the link date from COST_FIXTURE_EPOCH, then archiveCostProfile
 * appends the archive version, so the buffer gate reads the variant as cost-missing.
 */
async function seedArchivedCostVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
): Promise<{ variantId: string; profileId: string }> {
  const variant = await seedVariant(organizationId, storeId, barcode, '1.50');
  const profile = await createCostProfile(organizationId, { storeId, amountGross: '45.00' });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId,
      profileId: profile.id,
      productVariantId: variant.id,
      attachedAt: COST_FIXTURE_EPOCH,
    },
  });
  await archiveCostProfile(organizationId, profile.id, randomUUID());
  return { variantId: variant.id, profileId: profile.id };
}

async function bufferStatus(entryId: string): Promise<string> {
  return (await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entryId } })).status;
}

describe('cost profile restore - Live Performance buffer flip', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("restoring an archived profile flips today's waiting buffer entry to PROMOTING", async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const { profileId } = await seedArchivedCostVariant(org.id, store.id, 'BC-RESTORE');
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-restore',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-RESTORE']),
    });

    await restoreCostProfile(org.id, profileId, randomUUID());

    expect(await bufferStatus(entry.id)).toBe('PROMOTING');
  });

  it('a past-day waiting entry stays PENDING on restore', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const { profileId } = await seedArchivedCostVariant(org.id, store.id, 'BC-RESTORE-DAY');
    // Positive control: today's entry of the same barcode is flipped by the same restore.
    const today = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-restore-today',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-RESTORE-DAY']),
    });
    const pastDay = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-restore-pastday',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-RESTORE-DAY']),
    });

    await restoreCostProfile(org.id, profileId, randomUUID());

    expect(await bufferStatus(today.id)).toBe('PROMOTING');
    expect(await bufferStatus(pastDay.id)).toBe('PENDING');
  });

  it("a restore in organization A never flips organization B's buffer entry with the same barcode", async () => {
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const { profileId } = await seedArchivedCostVariant(orgA.id, storeA.id, 'BC-SHARED');

    // Organization B: the same barcode with a desi and its own active cost, so its
    // waiting entry is calculable and only the tenant scope keeps it PENDING.
    const variantB = await seedVariant(orgB.id, storeB.id, 'BC-SHARED', '1.50');
    const profileB = await createCostProfile(orgB.id, { storeId: storeB.id, amountGross: '30.00' });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: orgB.id,
        profileId: profileB.id,
        productVariantId: variantB.id,
        attachedAt: COST_FIXTURE_EPOCH,
      },
    });

    const entryA = await createBufferEntry(orgA.id, storeA.id, {
      platformOrderId: 'pkg-shared-a',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-SHARED']),
    });
    const entryB = await createBufferEntry(orgB.id, storeB.id, {
      platformOrderId: 'pkg-shared-b',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-SHARED']),
    });

    await restoreCostProfile(orgA.id, profileId, randomUUID());

    expect(await bufferStatus(entryA.id)).toBe('PROMOTING');
    expect(await bufferStatus(entryB.id)).toBe('PENDING');
  });

  it('a multi-line entry with another line still uncosted stays PENDING', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const { profileId } = await seedArchivedCostVariant(org.id, store.id, 'BC-ML-A');
    // Has a desi but no cost profile at all.
    await seedVariant(org.id, store.id, 'BC-ML-B', '1.50');

    const multi = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-ml-both',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-ML-A', 'BC-ML-B']),
    });
    // Positive control: a single-line entry of the restored barcode is flipped.
    const single = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-ml-single',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder(['BC-ML-A']),
    });

    await restoreCostProfile(org.id, profileId, randomUUID());

    expect(await bufferStatus(single.id)).toBe('PROMOTING');
    expect(await bufferStatus(multi.id)).toBe('PENDING');
  });
});
