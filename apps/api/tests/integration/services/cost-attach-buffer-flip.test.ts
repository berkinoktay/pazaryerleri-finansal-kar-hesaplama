import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';
import { getBusinessDateAnchor } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  attachCostProfiles,
  replaceCostProfilesForVariants,
} from '../../../src/services/cost-profile-attachment.service';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createOrganization,
  createStore,
} from '../../helpers/factories';

/** Minimal MappedOrder-shaped buffer payload — the flip only reads lines[].barcode. */
function buildMappedOrder(barcodes: string[]): Prisma.InputJsonValue {
  return { lines: barcodes.map((barcode) => ({ barcode })) } as unknown as Prisma.InputJsonValue;
}

/** A cost-MISSING variant (resolves by barcode, no cost profile attached yet). */
async function seedVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
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
});
