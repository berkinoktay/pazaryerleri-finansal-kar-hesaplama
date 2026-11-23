/**
 * Integration tests for PATCH .../variants/:variantId/dimensional-weight.
 *
 * Verifies:
 *   1. Happy path: setting a valid decimal updates ONLY dimensional_weight_override,
 *      leaves synced_dimensional_weight untouched.
 *   2. Null body clears the override; effective value falls back to synced.
 *   3. Invalid bodies (bad format, out-of-range) → 422 VALIDATION_ERROR.
 *   4. 404 when the variant doesn't exist.
 *   5. Every desi write (clear included) queues the variant's non-final orders for a
 *      profit recompute (DESI_CHANGED); a final order is never queued.
 *   6. Entering a desi promotes today's PENDING Live Performance buffer entries of
 *      the variant once their order is fully calculable (cost + desi).
 *
 * Cross-org isolation lives in tests/integration/tenant-isolation/.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  ProfitIssueCode,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import { drainProfitRecomputeQueue, recomputeParcelProfit } from '@pazarsync/profit';
import { getBusinessDateAnchor } from '@pazarsync/utils';

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
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

/**
 * The cargo name of a carrier in the shipping reference seed (SENDEOMP), part of the
 * test database template and never truncated: an order naming it has a recognized
 * carrier whose desi tariff prices it.
 */
const SEEDED_CARGO_PROVIDER_NAME = 'Kolay Gelsin Marketplace';

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
  variantId: string;
  barcode: string;
}

// Omitted `syncedDimensionalWeight` keeps the column default 0 (a real desi);
// null is a variant Trendyol sent no desi for.
async function setup(
  opts: { syncedDimensionalWeight?: string | null; isDigital?: boolean } = {},
): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Desi Test Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: `BC-${randomUUID().slice(0, 8)}`,
      stockCode: `STK-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('100.00'),
      listPrice: new Decimal('100.00'),
      ...(opts.syncedDimensionalWeight !== undefined
        ? { syncedDimensionalWeight: opts.syncedDimensionalWeight }
        : {}),
      isDigital: opts.isDigital ?? false,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    variantId: variant.id,
    barcode: variant.barcode,
  };
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

function patchUrl(ctx: Ctx): string {
  return `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products/variants/${ctx.variantId}/dimensional-weight`;
}

async function patchDesi(ctx: Ctx, body: unknown): Promise<Response> {
  return app.request(patchUrl(ctx), {
    method: 'PATCH',
    headers: {
      Authorization: bearer(ctx.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH .../variants/:variantId/dimensional-weight', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('happy path: sets the user override, leaves synced column untouched', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });

    const res = await patchDesi(ctx, { dimensionalWeight: '2.50' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      dimensionalWeight: string;
      syncedDimensionalWeight: string;
      isDimensionalWeightOverridden: boolean;
      isDimensionalWeightMissing: boolean;
    };
    expect(body.id).toBe(ctx.variantId);
    expect(body.dimensionalWeight).toBe('2.5');
    expect(body.syncedDimensionalWeight).toBe('1.2');
    expect(body.isDimensionalWeightOverridden).toBe(true);
    expect(body.isDimensionalWeightMissing).toBe(false);

    // DB-level assertion: synced column is the EXACT same row as before.
    const row = await prisma.productVariant.findFirstOrThrow({ where: { id: ctx.variantId } });
    expect(row.dimensionalWeightOverride?.toString()).toBe('2.5');
    expect(row.syncedDimensionalWeight?.toString()).toBe('1.2');
  });

  it('null body clears the override; effective value falls back to synced', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });
    // First, set an override
    await prisma.productVariant.update({
      where: { id: ctx.variantId },
      data: { dimensionalWeightOverride: '5.00' },
    });

    const res = await patchDesi(ctx, { dimensionalWeight: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dimensionalWeight: string;
      isDimensionalWeightOverridden: boolean;
      isDimensionalWeightMissing: boolean;
    };
    expect(body.dimensionalWeight).toBe('1.2'); // fell back to synced
    expect(body.isDimensionalWeightOverridden).toBe(false);
    // Trendyol has a desi for this variant, so clearing does not make it missing.
    expect(body.isDimensionalWeightMissing).toBe(false);

    const row = await prisma.productVariant.findFirstOrThrow({ where: { id: ctx.variantId } });
    expect(row.dimensionalWeightOverride).toBeNull();
    expect(row.syncedDimensionalWeight?.toString()).toBe('1.2');
  });

  it('isDimensionalWeightMissing follows the missing-desi rule on a variant Trendyol sent no desi for', async () => {
    const ctx = await setup({ syncedDimensionalWeight: null });

    // A seller desi (at least 1, Berkin 2026-11-23) is a desi, so it is not missing.
    const setFloor = await patchDesi(ctx, { dimensionalWeight: '1' });
    expect(setFloor.status).toBe(200);
    expect(await setFloor.json()).toMatchObject({
      dimensionalWeight: '1',
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });

    // Clearing the override leaves no desi at all: back to the missing-desi state.
    const cleared = await patchDesi(ctx, { dimensionalWeight: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
    });
  });

  it('a synced desi of 0 is a real desi: clearing the override over it is not missing', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '0' });
    await prisma.productVariant.update({
      where: { id: ctx.variantId },
      data: { dimensionalWeightOverride: '3.00' },
    });

    const cleared = await patchDesi(ctx, { dimensionalWeight: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      dimensionalWeight: '0',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
  });

  it('a digital variant needs no desi: clearing its override is not missing', async () => {
    const ctx = await setup({ syncedDimensionalWeight: null, isDigital: true });
    await prisma.productVariant.update({
      where: { id: ctx.variantId },
      data: { dimensionalWeightOverride: '3.00' },
    });

    const cleared = await patchDesi(ctx, { dimensionalWeight: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
  });

  it('returns 422 INVALID_DIMENSIONAL_WEIGHT_FORMAT for a non-decimal string', async () => {
    const ctx = await setup();

    const res = await patchDesi(ctx, { dimensionalWeight: 'not-a-number' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      errors: { field: string; code: string }[];
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_FORMAT')).toBe(true);
  });

  it.each(['1.234', '-1', '.5'])(
    'a malformed desi %s reports only INVALID_DIMENSIONAL_WEIGHT_FORMAT',
    async (dimensionalWeight) => {
      const ctx = await setup();

      const res = await patchDesi(ctx, { dimensionalWeight });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { errors: { field: string; code: string }[] };
      // The range checks pass a malformed value, so no contradictory TOO_SMALL /
      // TOO_LARGE pair joins the format error.
      expect(body.errors.map((e) => e.code)).toEqual(['INVALID_DIMENSIONAL_WEIGHT_FORMAT']);
    },
  );

  it('keeps the range error for a well-formed desi below 1', async () => {
    const ctx = await setup();

    const res = await patchDesi(ctx, { dimensionalWeight: '0.5' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { field: string; code: string }[] };
    expect(body.errors.map((e) => e.code)).toEqual(['INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL']);
  });

  it('returns 422 INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE when value exceeds the soft cap', async () => {
    const ctx = await setup();

    const res = await patchDesi(ctx, { dimensionalWeight: '1500.00' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE')).toBe(true);
  });

  // Owner rule (Berkin 2026-11-23): a seller desi is at least 1. This replaces
  // the 2026-11-22 rule that a seller 0 is a real desi, so 0 is now refused.
  it('rejects 0 and 0.99 with 422 INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL and leaves the override unset', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });

    for (const below of ['0', '0.99']) {
      const res = await patchDesi(ctx, { dimensionalWeight: below });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string; errors: { code: string }[] };
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL')).toBe(true);
    }

    const row = await prisma.productVariant.findFirstOrThrow({
      where: { id: ctx.variantId, organizationId: ctx.orgId },
    });
    expect(row.dimensionalWeightOverride).toBeNull();
  });

  it('accepts 1 (the floor) as a valid desi override; rejects negatives as a format error', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });

    // 1 is the floor: a valid override.
    const ok = await patchDesi(ctx, { dimensionalWeight: '1' });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      dimensionalWeight: string;
      isDimensionalWeightOverridden: boolean;
    };
    expect(okBody.dimensionalWeight).toBe('1');
    expect(okBody.isDimensionalWeightOverridden).toBe(true);
    const row = await prisma.productVariant.findFirstOrThrow({
      where: { id: ctx.variantId, organizationId: ctx.orgId },
    });
    expect(row.dimensionalWeightOverride?.toString()).toBe('1');

    // A negative is impossible: the format regex admits no minus sign, so it is
    // a FORMAT error, never reaching the DB CHECK floor.
    const neg = await patchDesi(ctx, { dimensionalWeight: '-1' });
    expect(neg.status).toBe(422);
    const negBody = (await neg.json()) as { errors: { code: string }[] };
    expect(negBody.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_FORMAT')).toBe(true);
  });

  it('returns 404 NOT_FOUND when the variant does not exist within the store', async () => {
    const ctx = await setup();
    const fakeVariantId = randomUUID();
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products/variants/${fakeVariantId}/dimensional-weight`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(ctx.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dimensionalWeight: '1.00' }),
      },
    );
    expect(res.status).toBe(404);
  });

  // Owner rule (Berkin 2026-11-23), replacing "desi frozen at intake, no queue row":
  // an order's desi is the value in force at the end of its business day, so every
  // desi write (set, change and clear) queues the variant's orders whose seller inputs
  // are not final yet; an order the day-close pass made final is never queued.
  it("queues the variant's non-final order on every desi write (set, change, clear), never a final one", async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });

    const order = await createOrder(ctx.orgId, ctx.storeId);
    await createOrderItem(order.id, ctx.orgId, { productVariantId: ctx.variantId });
    const finalOrder = await createOrder(ctx.orgId, ctx.storeId, {
      sellerInputsFinalAt: new Date(),
    });
    await createOrderItem(finalOrder.id, ctx.orgId, { productVariantId: ctx.variantId });

    const requestReason = async (orderId: string): Promise<ProfitRecomputeReason | undefined> =>
      (await prisma.profitRecomputeRequest.findUnique({ where: { orderId } }))?.reason;

    // set, change, clear: the mark is removed before each write, so each write must
    // queue the order on its own (the enqueue refreshes an existing row in place).
    for (const dimensionalWeight of ['4.50', '6.00', null]) {
      await prisma.profitRecomputeRequest.deleteMany({ where: { orderId: order.id } });
      const res = await patchDesi(ctx, { dimensionalWeight });
      expect(res.status).toBe(200);
      expect(await requestReason(order.id)).toBe(ProfitRecomputeReason.DESI_CHANGED);
      expect(await requestReason(finalOrder.id)).toBeUndefined();
    }
  });

  it("clearing the desi of today's calculated order makes it not computable; entering it again makes it computable", async () => {
    // A non-digital variant Trendyol sent no desi for, with a cost and a seller desi.
    const ctx = await setup({ syncedDimensionalWeight: null });
    await ensureFeeDefinitions();
    await linkCost(ctx.orgId, ctx.storeId, ctx.variantId);
    await prisma.productVariant.update({
      where: { id: ctx.variantId },
      data: { dimensionalWeightOverride: '2.00' },
    });

    // Today's order (marker NULL) on a recognized seeded carrier.
    const order = await createOrder(ctx.orgId, ctx.storeId, {
      status: 'DELIVERED',
      saleGross: '240.00',
      saleVat: '40.00',
    });
    await prisma.order.update({
      where: { id: order.id },
      data: {
        listGross: '240.00',
        sellerDiscountGross: '0.00',
        cargoProviderName: SEEDED_CARGO_PROVIDER_NAME,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: ctx.orgId,
        productVariantId: ctx.variantId,
        quantity: 1,
        barcode: ctx.barcode,
        lineListGross: '240.00',
        lineSaleGross: '240.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '20.00',
        orderCommissionRatePct: '19.00',
      },
    });
    await prisma.$transaction(
      (tx) => recomputeParcelProfit(tx, { organizationId: ctx.orgId, orderId: order.id }),
      { maxWait: 15_000, timeout: 30_000 },
    );
    const bestKnown = async (): Promise<{ status: string; issues: unknown }> =>
      prisma.orderProfitStatement.findFirstOrThrow({
        where: {
          organizationId: ctx.orgId,
          orderId: order.id,
          view: ProfitStatementView.BEST_KNOWN,
        },
        select: { status: true, issues: true },
      });
    expect((await bestKnown()).status).toBe(ProfitStatus.ESTIMATED);

    // The seller clears the desi: the order is queued and, drained, has no desi.
    const cleared = await patchDesi(ctx, { dimensionalWeight: null });
    expect(cleared.status).toBe(200);
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const missing = await bestKnown();
    expect(missing.status).toBe(ProfitStatus.NOT_COMPUTABLE);
    expect(missing.issues).toContainEqual(
      expect.objectContaining({
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        detail: 'UNKNOWN_DESI',
      }),
    );

    // The seller enters it again: computable again after the next drain.
    const entered = await patchDesi(ctx, { dimensionalWeight: '2.00' });
    expect(entered.status).toBe(200);
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect((await bestKnown()).status).toBe(ProfitStatus.ESTIMATED);
  });
});

describe('PATCH .../variants/:variantId/dimensional-weight: Live Performance buffer', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("promotes today's pending entry of a costed variant once its missing desi is entered", async () => {
    const ctx = await setup({ syncedDimensionalWeight: null });
    await linkCost(ctx.orgId, ctx.storeId, ctx.variantId);
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-today',
      orderDate: getBusinessDateAnchor(),
      mappedOrder: { lines: [{ barcode: ctx.barcode }] },
    });

    const res = await patchDesi(ctx, { dimensionalWeight: '2.00' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: ctx.variantId,
      dimensionalWeight: '2',
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
    expect(await bufferStatus('pkg-today')).toBe('PROMOTING');
  });

  // Owner rule (Berkin 2026-11-23): a seller desi is at least 1, replacing the
  // 2026-11-22 rule that a seller 0 is a real desi that promotes the entry.
  it('a seller desi of 0 is refused and promotes nothing; the floor 1 promotes the entry', async () => {
    const ctx = await setup({ syncedDimensionalWeight: null });
    await linkCost(ctx.orgId, ctx.storeId, ctx.variantId);
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-zero',
      mappedOrder: { lines: [{ barcode: ctx.barcode }] },
    });

    const zero = await patchDesi(ctx, { dimensionalWeight: '0' });
    expect(zero.status).toBe(422);
    expect(await bufferStatus('pkg-zero')).toBe('PENDING');

    const floor = await patchDesi(ctx, { dimensionalWeight: '1' });
    expect(floor.status).toBe(200);
    expect(await bufferStatus('pkg-zero')).toBe('PROMOTING');
  });

  it('keeps the entry pending while the variant still has no cost', async () => {
    const ctx = await setup({ syncedDimensionalWeight: null });
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-no-cost',
      mappedOrder: { lines: [{ barcode: ctx.barcode }] },
    });

    const first = await patchDesi(ctx, { dimensionalWeight: '2.00' });
    expect(first.status).toBe(200);
    expect(await bufferStatus('pkg-no-cost')).toBe('PENDING');

    // Positive control: once the cost is in place, the next desi entry promotes it.
    await linkCost(ctx.orgId, ctx.storeId, ctx.variantId);
    const second = await patchDesi(ctx, { dimensionalWeight: '2.00' });
    expect(second.status).toBe(200);
    expect(await bufferStatus('pkg-no-cost')).toBe('PROMOTING');
  });

  it('does not promote a past-day entry; the day-end flush owns it', async () => {
    const ctx = await setup({ syncedDimensionalWeight: null });
    await linkCost(ctx.orgId, ctx.storeId, ctx.variantId);
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-today',
      orderDate: getBusinessDateAnchor(),
      mappedOrder: { lines: [{ barcode: ctx.barcode }] },
    });
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-pastday',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      mappedOrder: { lines: [{ barcode: ctx.barcode }] },
    });

    const res = await patchDesi(ctx, { dimensionalWeight: '2.00' });

    expect(res.status).toBe(200);
    expect(await bufferStatus('pkg-today')).toBe('PROMOTING');
    expect(await bufferStatus('pkg-pastday')).toBe('PENDING');
  });

  it('clearing the desi does not re-check the buffer', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.00' });
    await linkCost(ctx.orgId, ctx.storeId, ctx.variantId);
    await createBufferEntry(ctx.orgId, ctx.storeId, {
      platformOrderId: 'pkg-clear',
      mappedOrder: { lines: [{ barcode: ctx.barcode }] },
    });

    const res = await patchDesi(ctx, { dimensionalWeight: null });

    expect(res.status).toBe(200);
    expect(await bufferStatus('pkg-clear')).toBe('PENDING');
  });
});
