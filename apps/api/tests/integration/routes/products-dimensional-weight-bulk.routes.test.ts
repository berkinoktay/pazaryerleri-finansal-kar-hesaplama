/**
 * Integration tests for PATCH .../products/variants/dimensional-weight (bulk).
 *
 * Covers:
 *   1. Happy path: every variant in the array gets the override.
 *   2. Cross-tenant IDs are silently filtered out (never mutated).
 *   3. Null body clears overrides across all listed variants.
 *   4. Empty / oversized / malformed input → 422.
 *   5. Every write (clear included) queues the non-final orders of the written
 *      variants only (DESI_CHANGED).
 *   6. Entering a desi promotes today's PENDING Live Performance buffer entries of
 *      the written variants only (never another store's entries).
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setupCtx(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

async function seedVariant(
  ctx: Ctx,
  opts: {
    syncedDimensionalWeight?: string | null;
    dimensionalWeightOverride?: string | null;
    barcode?: string;
  } = {},
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Bulk Desi Test',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: opts.barcode ?? `BC-${randomUUID().slice(0, 8)}`,
      stockCode: `STK-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('100.00'),
      listPrice: new Decimal('100.00'),
      ...(opts.syncedDimensionalWeight !== undefined
        ? { syncedDimensionalWeight: opts.syncedDimensionalWeight }
        : {}),
      ...(opts.dimensionalWeightOverride !== undefined
        ? { dimensionalWeightOverride: opts.dimensionalWeightOverride }
        : {}),
    },
  });
  return variant.id;
}

/** Links a cost profile to the variant directly (the attach service runs its own flip). */
async function linkCost(orgId: string, storeId: string, variantId: string): Promise<void> {
  const profile = await createCostProfile(orgId, { storeId, amountGross: '50.00' });
  await prisma.productVariantCostProfile.create({
    data: { productVariantId: variantId, profileId: profile.id, organizationId: orgId },
  });
}

async function bufferStatus(platformOrderId: string): Promise<string> {
  const entry = await prisma.livePerformanceBuffer.findFirstOrThrow({
    where: { platformOrderId },
  });
  return entry.status;
}

function bulkUrl(ctx: Ctx): string {
  return `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products/variants/dimensional-weight`;
}

async function bulkPatch(ctx: Ctx, body: unknown): Promise<Response> {
  return app.request(bulkUrl(ctx), {
    method: 'PATCH',
    headers: {
      Authorization: bearer(ctx.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH .../products/variants/dimensional-weight (bulk)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('applies the value to every listed variant and returns the updated count', async () => {
    const ctx = await setupCtx();
    const v1 = await seedVariant(ctx, { syncedDimensionalWeight: '1.00' });
    const v2 = await seedVariant(ctx, { syncedDimensionalWeight: '2.00' });
    const v3 = await seedVariant(ctx, { syncedDimensionalWeight: '3.00' });

    const res = await bulkPatch(ctx, { variantIds: [v1, v2, v3], dimensionalWeight: '7.50' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(3);

    const rows = await prisma.productVariant.findMany({
      where: { id: { in: [v1, v2, v3] } },
      orderBy: { syncedDimensionalWeight: 'asc' },
    });
    for (const r of rows) {
      expect(r.dimensionalWeightOverride?.toString()).toBe('7.5');
    }
    // Synced column untouched.
    expect(rows.map((r) => r.syncedDimensionalWeight?.toString())).toEqual(['1', '2', '3']);
  });

  it('null body clears overrides across all listed variants', async () => {
    const ctx = await setupCtx();
    const v1 = await seedVariant(ctx, {
      syncedDimensionalWeight: '1.00',
      dimensionalWeightOverride: '9.00',
    });
    const v2 = await seedVariant(ctx, {
      syncedDimensionalWeight: '2.00',
      dimensionalWeightOverride: '9.00',
    });

    const res = await bulkPatch(ctx, { variantIds: [v1, v2], dimensionalWeight: null });
    expect(res.status).toBe(200);

    const rows = await prisma.productVariant.findMany({ where: { id: { in: [v1, v2] } } });
    for (const r of rows) {
      expect(r.dimensionalWeightOverride).toBeNull();
    }
  });

  it('silently filters cross-tenant IDs — never mutates the other org', async () => {
    const ctxA = await setupCtx();
    const ctxB = await setupCtx();
    const v1A = await seedVariant(ctxA, { syncedDimensionalWeight: '1.00' });
    const v1B = await seedVariant(ctxB, {
      syncedDimensionalWeight: '5.00',
      dimensionalWeightOverride: null,
    });

    // Org A submits its own variant + Org B's variant. Only A's should land.
    const res = await bulkPatch(ctxA, {
      variantIds: [v1A, v1B],
      dimensionalWeight: '4.00',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(1);

    const aRow = await prisma.productVariant.findFirstOrThrow({ where: { id: v1A } });
    const bRow = await prisma.productVariant.findFirstOrThrow({ where: { id: v1B } });
    expect(aRow.dimensionalWeightOverride?.toString()).toBe('4');
    expect(bRow.dimensionalWeightOverride).toBeNull(); // Org B untouched.
  });

  // Owner rule (Berkin 2026-11-23): an order's desi is the value in force at the end
  // of its business day, so a desi write (clear included) queues the non-final orders
  // of the variants the write actually touched, and only those.
  it("queues only the written variants' non-final orders, a clear included", async () => {
    const ctx = await setupCtx();
    const otherStore = await createStore(ctx.orgId, { name: 'Other Store' });
    const ownVariant = await seedVariant(ctx, { syncedDimensionalWeight: '1.00' });
    // Same organization, another store: the write filters it out, so its order must
    // not be queued either (the queue scope alone is organization-wide).
    const foreignVariant = await seedVariant(
      { ...ctx, storeId: otherStore.id },
      { syncedDimensionalWeight: '1.00' },
    );
    const ownOrder = await createOrder(ctx.orgId, ctx.storeId);
    await createOrderItem(ownOrder.id, ctx.orgId, { productVariantId: ownVariant });
    const foreignOrder = await createOrder(ctx.orgId, otherStore.id);
    await createOrderItem(foreignOrder.id, ctx.orgId, { productVariantId: foreignVariant });

    const requestReason = async (orderId: string): Promise<ProfitRecomputeReason | undefined> =>
      (await prisma.profitRecomputeRequest.findUnique({ where: { orderId } }))?.reason;

    for (const dimensionalWeight of ['3.00', null]) {
      await prisma.profitRecomputeRequest.deleteMany({ where: { orderId: ownOrder.id } });
      const res = await bulkPatch(ctx, {
        variantIds: [ownVariant, foreignVariant],
        dimensionalWeight,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: 1 });
      expect(await requestReason(ownOrder.id)).toBe(ProfitRecomputeReason.DESI_CHANGED);
      expect(await requestReason(foreignOrder.id)).toBeUndefined();
    }
  });

  it('rejects empty variantIds with 422 INVALID_VARIANT_IDS_EMPTY', async () => {
    const ctx = await setupCtx();
    const res = await bulkPatch(ctx, { variantIds: [], dimensionalWeight: '1.00' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors.some((e) => e.code === 'INVALID_VARIANT_IDS_EMPTY')).toBe(true);
  });

  it('rejects > 200 variantIds with 422 INVALID_VARIANT_IDS_TOO_MANY', async () => {
    const ctx = await setupCtx();
    const variantIds = Array.from({ length: 201 }, () => randomUUID());
    const res = await bulkPatch(ctx, { variantIds, dimensionalWeight: '1.00' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors.some((e) => e.code === 'INVALID_VARIANT_IDS_TOO_MANY')).toBe(true);
  });

  it('rejects out-of-range dimensionalWeight with 422 (below 1 or above the cap); 1 is the valid floor', async () => {
    const ctx = await setupCtx();
    const v = await seedVariant(ctx);

    // Above the cap: TOO_LARGE.
    const tooLarge = await bulkPatch(ctx, { variantIds: [v], dimensionalWeight: '1500.00' });
    expect(tooLarge.status).toBe(422);
    const tooLargeBody = (await tooLarge.json()) as { errors: { code: string }[] };
    expect(tooLargeBody.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE')).toBe(
      true,
    );

    // Owner rule (Berkin 2026-11-23): a seller desi is at least 1, replacing the
    // 2026-11-22 rule that a seller 0 is a real desi. 0 and 0.99 are TOO_SMALL.
    for (const below of ['0', '0.99']) {
      const tooSmall = await bulkPatch(ctx, { variantIds: [v], dimensionalWeight: below });
      expect(tooSmall.status).toBe(422);
      const tooSmallBody = (await tooSmall.json()) as { errors: { code: string }[] };
      expect(
        tooSmallBody.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL'),
      ).toBe(true);
    }
    const untouched = await prisma.productVariant.findFirstOrThrow({
      where: { id: v, organizationId: ctx.orgId },
    });
    expect(untouched.dimensionalWeightOverride).toBeNull();

    // 1 is the floor: accepted.
    const floor = await bulkPatch(ctx, { variantIds: [v], dimensionalWeight: '1' });
    expect(floor.status).toBe(200);
    const row = await prisma.productVariant.findFirstOrThrow({
      where: { id: v, organizationId: ctx.orgId },
    });
    expect(row.dimensionalWeightOverride?.toString()).toBe('1');
  });
});

describe('PATCH .../products/variants/dimensional-weight (bulk): Live Performance buffer', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("promotes today's pending entries of every written variant that has a cost", async () => {
    const ctx = await setupCtx();
    const v1 = await seedVariant(ctx, { syncedDimensionalWeight: null, barcode: 'BC-1' });
    const v2 = await seedVariant(ctx, { syncedDimensionalWeight: null, barcode: 'BC-2' });
    const v3 = await seedVariant(ctx, { syncedDimensionalWeight: null, barcode: 'BC-3' });
    await linkCost(ctx.orgId, ctx.storeId, v1);
    await linkCost(ctx.orgId, ctx.storeId, v2);
    // v3 has no cost: its order stays pending after the desi is entered.
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-1',
      mappedOrder: { lines: [{ barcode: 'BC-1' }] },
    });
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-2',
      mappedOrder: { lines: [{ barcode: 'BC-2' }] },
    });
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-3',
      mappedOrder: { lines: [{ barcode: 'BC-3' }] },
    });

    const res = await bulkPatch(ctx, { variantIds: [v1, v2, v3], dimensionalWeight: '1.50' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 3 });
    expect(await bufferStatus('pkg-1')).toBe('PROMOTING');
    expect(await bufferStatus('pkg-2')).toBe('PROMOTING');
    expect(await bufferStatus('pkg-3')).toBe('PENDING');
  });

  it("a variant id of another store never promotes that store's buffer entry", async () => {
    const ctx = await setupCtx();
    const otherStore = await createStore(ctx.orgId, { name: 'Other Store' });
    const ownVariant = await seedVariant(ctx, {
      syncedDimensionalWeight: null,
      barcode: 'BC-OWN',
    });
    await linkCost(ctx.orgId, ctx.storeId, ownVariant);
    // The other store's variant is fully calculable (cost + desi), so any re-check
    // of its buffer entry would promote it.
    const foreignVariant = await seedVariant(
      { ...ctx, storeId: otherStore.id },
      { syncedDimensionalWeight: '1.00', barcode: 'BC-FOREIGN' },
    );
    await linkCost(ctx.orgId, otherStore.id, foreignVariant);
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-own',
      mappedOrder: { lines: [{ barcode: 'BC-OWN' }] },
    });
    await createBufferEntry(ctx.orgId, otherStore.id, {
      platformOrderId: 'pkg-foreign',
      mappedOrder: { lines: [{ barcode: 'BC-FOREIGN' }] },
    });

    const res = await bulkPatch(ctx, {
      variantIds: [ownVariant, foreignVariant],
      dimensionalWeight: '2.00',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(await bufferStatus('pkg-own')).toBe('PROMOTING');
    expect(await bufferStatus('pkg-foreign')).toBe('PENDING');
    const foreignRow = await prisma.productVariant.findFirstOrThrow({
      where: { id: foreignVariant },
    });
    expect(foreignRow.dimensionalWeightOverride).toBeNull();
  });

  it('clearing the desi does not re-check the buffer', async () => {
    const ctx = await setupCtx();
    const v = await seedVariant(ctx, { syncedDimensionalWeight: '1.00', barcode: 'BC-CLEAR' });
    await linkCost(ctx.orgId, ctx.storeId, v);
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-clear',
      mappedOrder: { lines: [{ barcode: 'BC-CLEAR' }] },
    });

    const res = await bulkPatch(ctx, { variantIds: [v], dimensionalWeight: null });

    expect(res.status).toBe(200);
    expect(await bufferStatus('pkg-clear')).toBe('PENDING');
  });
});
