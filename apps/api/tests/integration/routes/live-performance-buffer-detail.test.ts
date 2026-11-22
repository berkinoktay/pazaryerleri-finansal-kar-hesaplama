import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

async function seedVariant(
  orgId: string,
  storeId: string,
  opts: {
    title: string;
    barcode: string;
    seq: number;
    // Passed through as-is: undefined keeps the column default (synced 0), an
    // explicit null stores an empty desi.
    syncedDimensionalWeight?: string | null;
    dimensionalWeightOverride?: string | null;
    isDigital?: boolean;
  },
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(920000 + opts.seq),
      productMainId: `PM-${opts.seq}`,
      title: opts.title,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(820000 + opts.seq),
      barcode: opts.barcode,
      stockCode: `SC-${opts.seq}`,
      salePrice: '100.00',
      listPrice: '120.00',
      syncedDimensionalWeight: opts.syncedDimensionalWeight,
      dimensionalWeightOverride: opts.dimensionalWeightOverride,
      isDigital: opts.isDigital,
    },
  });
  return variant.id;
}

describe('GET live-performance/buffer/{bufferId}', () => {
  const app = createApp();
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the enriched buffer detail (productName via barcode to variant)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const variantId = await seedVariant(org.id, store.id, {
      title: 'Cotton Tee',
      barcode: 'BC-1',
      seq: 1,
    });

    const bufferEntry = await createBufferEntry(org.id, store.id, {
      platformOrderNumber: 'TY-123',
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '200.00',
        lines: [{ barcode: 'BC-1', quantity: 2, lineSaleGross: '200.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platformOrderNumber).toBe('TY-123');
    expect(body.saleGross).toBe('200.00');
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      barcode: 'BC-1',
      productName: 'Cotton Tee',
      quantity: 2,
      lineSaleGross: '200.00',
      variantId,
      stockCode: 'SC-1',
    });
  });

  it('falls back gracefully when a barcode has no matching variant (variantId null, name = barcode)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const bufferEntry = await createBufferEntry(org.id, store.id, {
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '50.00',
        lines: [{ barcode: 'BC-NONE', quantity: 1, lineSaleGross: '50.00' }],
      },
    });
    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines[0]).toMatchObject({
      barcode: 'BC-NONE',
      productName: 'BC-NONE',
      variantId: null,
      thumbUrl: null,
      stockCode: null,
      // The calculability gate reads an unresolved barcode as cost-missing; the
      // line has no variant, so no desi state.
      isCostMissing: true,
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
  });

  it('flags per line what the order waits for', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);

    // (a) cost linked + desi present.
    const readyId = await seedVariant(org.id, store.id, {
      title: 'Ready Line',
      barcode: 'BC-READY',
      seq: 10,
      syncedDimensionalWeight: '1.50',
      dimensionalWeightOverride: null,
    });
    // (b) no cost + no desi.
    await seedVariant(org.id, store.id, {
      title: 'Bare Line',
      barcode: 'BC-BARE',
      seq: 11,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      isDigital: false,
    });
    // (c) cost linked + no desi.
    const costOnlyId = await seedVariant(org.id, store.id, {
      title: 'Cost Only Line',
      barcode: 'BC-COST-ONLY',
      seq: 12,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      isDigital: false,
    });

    const profile = await createCostProfile(org.id, { storeId: store.id });
    for (const productVariantId of [readyId, costOnlyId]) {
      await prisma.productVariantCostProfile.create({
        data: {
          organizationId: org.id,
          productVariantId,
          profileId: profile.id,
          attachedBy: user.id,
        },
      });
    }

    const bufferEntry = await createBufferEntry(org.id, store.id, {
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '300.00',
        lines: [
          { barcode: 'BC-READY', quantity: 1, lineSaleGross: '100.00' },
          { barcode: 'BC-BARE', quantity: 1, lineSaleGross: '100.00' },
          { barcode: 'BC-COST-ONLY', quantity: 1, lineSaleGross: '100.00' },
        ],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines).toHaveLength(3);
    expect(body.lines[0]).toMatchObject({
      barcode: 'BC-READY',
      isCostMissing: false,
      dimensionalWeight: '1.5',
      syncedDimensionalWeight: '1.5',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
    expect(body.lines[1]).toMatchObject({
      barcode: 'BC-BARE',
      isCostMissing: true,
      dimensionalWeight: null,
      isDimensionalWeightMissing: true,
    });
    expect(body.lines[2]).toMatchObject({
      barcode: 'BC-COST-ONLY',
      isCostMissing: false,
      dimensionalWeight: null,
      isDimensionalWeightMissing: true,
    });
  });

  it('counts a line whose only cost profile is archived as costed, as the gate does', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const variantId = await seedVariant(org.id, store.id, {
      title: 'Archived Cost Line',
      barcode: 'BC-ARCHIVED',
      seq: 30,
      syncedDimensionalWeight: '1.00',
    });
    const profile = await createCostProfile(org.id, { storeId: store.id });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: variantId,
        profileId: profile.id,
        attachedBy: user.id,
      },
    });
    await prisma.costProfile.update({
      where: { id: profile.id },
      data: { archivedAt: new Date() },
    });
    const bufferEntry = await createBufferEntry(org.id, store.id, {
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '100.00',
        lines: [{ barcode: 'BC-ARCHIVED', quantity: 1, lineSaleGross: '100.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The gate (buildCalcCheckLines) reads the latest linked profile whether or not it
    // is archived, so this line does not hold the order; the flag names the gate's gap.
    expect(body.lines[0]).toMatchObject({ variantId, isCostMissing: false });
  });

  it('describes one variant per line when two variants share the barcode', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const costedId = await seedVariant(org.id, store.id, {
      title: 'Shared Costed',
      barcode: 'BC-SHARED',
      seq: 40,
      syncedDimensionalWeight: '2.00',
    });
    const bareId = await seedVariant(org.id, store.id, {
      title: 'Shared Bare',
      barcode: 'BC-SHARED',
      seq: 41,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
    });
    const profile = await createCostProfile(org.id, { storeId: store.id });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: costedId,
        profileId: profile.id,
        attachedBy: user.id,
      },
    });
    const bufferEntry = await createBufferEntry(org.id, store.id, {
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '100.00',
        lines: [{ barcode: 'BC-SHARED', quantity: 1, lineSaleGross: '100.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const line = body.lines[0];
    expect([costedId, bareId]).toContain(line.variantId);
    // The gate picks one of the two; the name, the desi and the cost flag must all
    // describe that same variant.
    const isCosted = line.variantId === costedId;
    expect(line).toMatchObject({
      productName: isCosted ? 'Shared Costed' : 'Shared Bare',
      isCostMissing: !isCosted,
      isDimensionalWeightMissing: !isCosted,
    });
  });

  it('404 when the buffer entry does not exist for this store', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/00000000-0000-0000-0000-000000000000`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });
});
