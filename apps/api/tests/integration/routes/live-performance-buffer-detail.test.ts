import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  COST_FIXTURE_EPOCH,
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
    // Fixed variant id, for tests that depend on id order.
    id?: string;
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
      id: opts.id,
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

    // The links predate the order's day, so the gate (judging links at that day's
    // end) counts them.
    const profile = await createCostProfile(org.id, { storeId: store.id });
    for (const productVariantId of [readyId, costOnlyId]) {
      await prisma.productVariantCostProfile.create({
        data: {
          organizationId: org.id,
          productVariantId,
          profileId: profile.id,
          attachedBy: user.id,
          attachedAt: COST_FIXTURE_EPOCH,
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

  it('flags a line whose only cost profile is archived as cost-missing, as the gate does', async () => {
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
        attachedAt: COST_FIXTURE_EPOCH,
      },
    });
    // Archived before the order's day, the way the cost-profile service does it: the
    // profile row is stamped and an archive version is appended.
    const archivedAt = new Date('2026-06-01T09:00:00.000Z');
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: org.id,
        version: 2,
        name: profile.name,
        type: profile.type,
        amountGross: profile.amountGross,
        vatRate: profile.vatRate,
        archivedAt,
        changedFields: ['archivedAt'],
        effectiveFrom: archivedAt,
      },
    });
    await prisma.costProfile.update({
      where: { id: profile.id },
      data: { archivedAt },
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
    // The gate (buildCalcCheckLines) ignores an archived profile (plan PR-3b), so this
    // line holds the order and the flag names it.
    expect(body.lines[0]).toMatchObject({ variantId, isCostMissing: true });
  });

  it('describes one variant per line when two variants share the barcode', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    // The higher id is inserted first, so only an explicit id order (not the
    // insertion order) picks the lower one.
    const costedId = await seedVariant(org.id, store.id, {
      title: 'Shared Costed',
      barcode: 'BC-SHARED',
      seq: 40,
      syncedDimensionalWeight: '2.00',
      id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
    });
    const bareId = await seedVariant(org.id, store.id, {
      title: 'Shared Bare',
      barcode: 'BC-SHARED',
      seq: 41,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      id: '00000000-0000-4000-8000-000000000001',
    });
    // Postgres orders uuid by bytes, the same as comparing the lowercase strings.
    expect(bareId < costedId).toBe(true);
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
    // The gate takes the first match by variant id; the name, the desi and the
    // cost flag all describe that same variant.
    expect(body.lines[0]).toMatchObject({
      variantId: bareId,
      productName: 'Shared Bare',
      isCostMissing: true,
      dimensionalWeight: null,
      isDimensionalWeightMissing: true,
    });
  });

  it('reports a seller desi of 0 and a digital line as not missing', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, {
      title: 'Zero Desi Line',
      barcode: 'BC-ZERO',
      seq: 50,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: '0',
    });
    await seedVariant(org.id, store.id, {
      title: 'Digital Line',
      barcode: 'BC-DIGITAL',
      seq: 51,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      isDigital: true,
    });
    const bufferEntry = await createBufferEntry(org.id, store.id, {
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '200.00',
        lines: [
          { barcode: 'BC-ZERO', quantity: 1, lineSaleGross: '100.00' },
          { barcode: 'BC-DIGITAL', quantity: 1, lineSaleGross: '100.00' },
        ],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines).toHaveLength(2);
    // A seller desi of 0 is a real desi.
    expect(body.lines[0]).toMatchObject({
      barcode: 'BC-ZERO',
      dimensionalWeight: '0',
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
    // A digital product needs no desi.
    expect(body.lines[1]).toMatchObject({
      barcode: 'BC-DIGITAL',
      dimensionalWeight: null,
      isDimensionalWeightMissing: false,
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
