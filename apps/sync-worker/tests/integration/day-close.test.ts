// Day-close tick integration test (same-day edit window, plan P1-18; notes NB5).
//
// Owner rule (Berkin 2026-11-23): an order's cost and desi are the values in force at
// the end of its Istanbul business day T; changes during the day reach all of that
// day's orders; at 00:00 the seller inputs become final. The day-close tick finalises
// every non-final order whose day is settled by the database clock
// (resolveSettledCutoff), each in its own transaction under its own organization and
// store, and keeps a failing order from stalling the others.
//
// Orders are dated yesterday (T = today's start) unless a test says otherwise; every
// tick gets an injected database clock.
//
// Requires: `supabase start` + `pnpm db:test-setup`.
// Run: pnpm --filter @pazarsync/sync-worker exec vitest run tests/integration/day-close.test.ts

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  OrderStatus,
  ProfitExclusionReason,
  ProfitLineType,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import { finalizeOrderSellerInputs, intakeOrder } from '@pazarsync/order-sync';
import {
  captureOrderProfitSnapshot,
  drainProfitRecomputeQueue,
  PROFIT_RECOMPUTE_BATCH_SIZE,
  PROFIT_RECOMPUTE_TX_MAX_WAIT_MS,
  PROFIT_RECOMPUTE_TX_TIMEOUT_MS,
  recomputeParcelProfit,
  resetSettledCutoffMemo,
} from '@pazarsync/profit';
import {
  getBusinessDayRange,
  previousDayStart,
  SELLER_INPUT_SETTLE_CAP_MS,
  SELLER_INPUT_SETTLE_MS,
} from '@pazarsync/utils';

import { processDayClose, resetDayCloseBackoff } from '../../src/handlers/day-close';

import { seedCalculableTrendyolOrder } from '../../../../apps/api/tests/helpers/calculable-order';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  COST_FIXTURE_EPOCH,
  createCostProfile,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';
import { backdateSellerInputHistory } from '../../../../apps/api/tests/helpers/seller-input-history';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** The end T of yesterday's orders: today's business-day start. */
function dayEnd(): Date {
  return getBusinessDayRange(new Date()).start;
}

/** T plus `ms`: an injected database clock. */
function afterDayEnd(ms: number): Date {
  return new Date(dayEnd().getTime() + ms);
}

/** Five minutes before T: a seller-input change stamped inside yesterday. */
function beforeDayEnd(): Date {
  return new Date(dayEnd().getTime() - 5 * MINUTE_MS);
}

interface Tenant {
  readonly orgId: string;
  readonly storeId: string;
}

async function seedTenant(): Promise<Tenant> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  return { orgId: org.id, storeId: store.id };
}

/** A non-digital catalog variant with a synced desi of 2, written by the insert. */
async function seedVariant(tenant: Tenant): Promise<string> {
  const tag = Math.floor(Math.random() * 1e9).toString();
  const product = await prisma.product.create({
    data: {
      organizationId: tenant.orgId,
      storeId: tenant.storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1e9)),
      productMainId: `pm-${tag}`,
      title: 'Day Close Tick Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: tenant.orgId,
      storeId: tenant.storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1e12)),
      barcode: `BC-${tag}`,
      stockCode: `SC-${tag}`,
      salePrice: '100.00',
      listPrice: '120.00',
      syncedDimensionalWeight: '2',
    },
  });
  return variant.id;
}

/** A cost profile with its version 1, both from the fixture epoch, linked to the variant. */
async function attachCost(
  tenant: Tenant,
  variantId: string,
): Promise<{ readonly profileId: string; readonly versionId: string }> {
  const profile = await createCostProfile(tenant.orgId, {
    storeId: tenant.storeId,
    amountGross: '40.00',
    seedVersion: false,
  });
  const version = await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: tenant.orgId,
      version: 1,
      name: profile.name,
      type: profile.type,
      amountGross: profile.amountGross,
      vatRate: profile.vatRate,
      changedFields: [],
      effectiveFrom: COST_FIXTURE_EPOCH,
    },
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: tenant.orgId,
      productVariantId: variantId,
      profileId: profile.id,
      attachedAt: COST_FIXTURE_EPOCH,
    },
  });
  return { profileId: profile.id, versionId: version.id };
}

/**
 * An order with one item of `variantId`, dated an hour before `dayEndOf` (default T)
 * and first stored an hour before that, inside its own day, unless `createdAt` is given.
 */
async function seedOrder(
  tenant: Tenant,
  variantId: string | null,
  opts: {
    readonly dayEndOf?: Date;
    readonly createdAt?: Date;
    readonly status?: OrderStatus;
    readonly sellerInputsFinalAt?: Date;
  } = {},
): Promise<string> {
  const end = opts.dayEndOf ?? dayEnd();
  const order = await createOrder(tenant.orgId, tenant.storeId, {
    orderDate: new Date(end.getTime() - HOUR_MS),
    status: opts.status ?? OrderStatus.DELIVERED,
    sellerInputsFinalAt: opts.sellerInputsFinalAt ?? null,
  });
  await createOrderItem(order.id, tenant.orgId, { productVariantId: variantId });
  await prisma.order.update({
    where: { id: order.id },
    data: { createdAt: opts.createdAt ?? new Date(end.getTime() - 2 * HOUR_MS) },
  });
  return order.id;
}

/**
 * The calculable digital-product order of the shared helper, re-dated to yesterday and
 * stored inside its day. Returns its order id and its cost link's profile id.
 */
async function seedCalculableYesterdayOrder(
  tenant: Tenant,
): Promise<{ readonly orderId: string; readonly variantId: string; readonly profileId: string }> {
  const orderId = await seedCalculableTrendyolOrder(tenant.orgId, tenant.storeId);
  await prisma.order.update({
    where: { id: orderId },
    data: {
      orderDate: new Date(dayEnd().getTime() - HOUR_MS),
      createdAt: new Date(dayEnd().getTime() - 2 * HOUR_MS),
    },
  });
  // The helper seeds exactly one variant and one cost link for the organization.
  const link = await prisma.productVariantCostProfile.findFirstOrThrow({
    where: { organizationId: tenant.orgId },
    select: { productVariantId: true, profileId: true },
  });
  return { orderId, variantId: link.productVariantId, profileId: link.profileId };
}

async function detachCost(tenant: Tenant, variantId: string, profileId: string): Promise<void> {
  await prisma.productVariantCostProfile.deleteMany({
    where: { organizationId: tenant.orgId, productVariantId: variantId, profileId },
  });
}

async function readOrder(orderId: string): Promise<{
  readonly sellerInputsFinalAt: Date | null;
  readonly profitExcludedAt: Date | null;
  readonly profitExclusionReason: ProfitExclusionReason | null;
}> {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { sellerInputsFinalAt: true, profitExcludedAt: true, profitExclusionReason: true },
  });
}

async function bestKnown(
  orderId: string,
): Promise<{ readonly status: string; readonly netProfit: string | null }> {
  const statement = await prisma.orderProfitStatement.findFirstOrThrow({
    where: { orderId, view: ProfitStatementView.BEST_KNOWN },
    select: { status: true, netProfit: true },
  });
  return { status: statement.status, netProfit: statement.netProfit?.toString() ?? null };
}

async function drainQueue(): Promise<void> {
  for (;;) {
    const pass = await drainProfitRecomputeQueue(prisma, {
      batchSize: PROFIT_RECOMPUTE_BATCH_SIZE,
    });
    if (pass.claimed === 0) {
      return;
    }
  }
}

/** A tick result with no work and the given cutoff. */
function idleTick(cutoff: Date): {
  readonly skipped: false;
  readonly cutoff: Date;
  readonly finalized: 0;
  readonly excluded: 0;
  readonly busy: 0;
  readonly failed: 0;
} {
  return { skipped: false, cutoff, finalized: 0, excluded: 0, busy: 0, failed: 0 };
}

/** A real MappedOrder of one line, for driving intakeOrder directly. */
function buildMappedOrder(over: {
  readonly platformOrderId: string;
  readonly orderDate: Date;
  readonly status: MappedOrder['status'];
}): MappedOrder {
  return {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: `ord-${over.platformOrderId}`,
    orderDate: over.orderDate,
    lastModifiedDate: over.orderDate,
    status: over.status,
    dematerialized: false,
    packagePending: false,
    saleGross: '100.00',
    saleVat: '15.25',
    listGross: '100.00',
    sellerDiscountGross: '0.00',
    promotionDisplays: null,
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    actualShipDate: null,
    fastDelivery: false,
    fastDeliveryType: null,
    isExportSale: false,
    estimatedDeliveryStartDate: null,
    estimatedDeliveryEndDate: null,
    cargoProviderName: null,
    cargoTrackingNumber: null,
    cargoDeci: null,
    usesSellerCargoAgreement: false,
    platformCreatedBy: null,
    originShipmentDate: null,
    lines: [
      {
        barcode: `EAN-${over.platformOrderId}`,
        quantity: 1,
        platformLineId: null,
        lineListGross: '100.00',
        lineSaleGross: '100.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '18',
        commissionRate: '15',
        commissionKnown: true,
      },
    ],
  };
}

interface HeldTransaction {
  /** Commits the held transaction. */
  readonly release: () => Promise<void>;
}

/**
 * Opens a transaction on another pooled connection, runs one statement in it and keeps
 * it open until `release`: an open seller-input writer that began before the day end.
 */
async function holdOpenTransaction(): Promise<HeldTransaction> {
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let markReleased: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      markStarted();
      await released;
    },
    { timeout: 30_000 },
  );
  try {
    await Promise.race([
      started,
      holder.then(() => {
        throw new Error('the held transaction ended before it started');
      }),
    ]);
    return {
      release: async () => {
        markReleased();
        await holder;
      },
    };
  } catch (err) {
    markReleased();
    await holder.catch(() => undefined);
    throw err;
  }
}

describe('day-close tick', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    resetSettledCutoffMemo();
    resetDayCloseBackoff();
  });

  it('finalises every settled non-final order and reports the counts', async () => {
    const tenant = await seedTenant();
    const costedVariant = await seedVariant(tenant);
    await attachCost(tenant, costedVariant);
    const detachedVariant = await seedVariant(tenant);
    const detached = await attachCost(tenant, detachedVariant);
    await detachCost(tenant, detachedVariant, detached.profileId);
    await backdateSellerInputHistory(tenant.orgId, beforeDayEnd());
    const costed = await seedOrder(tenant, costedVariant);
    const costGap = await seedOrder(tenant, detachedVariant);
    const cancelled = await seedOrder(tenant, await seedVariant(tenant), {
      status: OrderStatus.CANCELLED,
    });

    const result = await processDayClose({ dbNow: afterDayEnd(SELLER_INPUT_SETTLE_MS) });

    expect(result).toEqual({
      skipped: false,
      cutoff: dayEnd(),
      finalized: 3,
      excluded: 1,
      busy: 0,
      failed: 0,
    });
    expect(
      await prisma.order.count({
        where: { sellerInputsFinalAt: null, orderDate: { lt: dayEnd() } },
      }),
    ).toBe(0);
    expect((await readOrder(costed)).profitExclusionReason).toBeNull();
    expect((await readOrder(costGap)).profitExclusionReason).toBe(
      ProfitExclusionReason.COST_DEADLINE_MISSED,
    );
    expect((await readOrder(cancelled)).profitExclusionReason).toBeNull();
  });

  it('one second before the settle delay nothing is finalised', async () => {
    const tenant = await seedTenant();
    const orderId = await seedOrder(tenant, await seedVariant(tenant));

    const early = await processDayClose({ dbNow: afterDayEnd(SELLER_INPUT_SETTLE_MS - 1_000) });

    expect(early).toEqual(idleTick(previousDayStart(dayEnd())));
    expect((await readOrder(orderId)).sellerInputsFinalAt).toBeNull();
    // Positive control: at the settle delay the same order is finalised.
    const settled = await processDayClose({ dbNow: afterDayEnd(SELLER_INPUT_SETTLE_MS) });
    expect(settled.finalized).toBe(1);
    expect((await readOrder(orderId)).sellerInputsFinalAt).toEqual(
      afterDayEnd(SELLER_INPUT_SETTLE_MS),
    );
  });

  it('a stale captured list is re-derived at T when the pass first runs ten hours late', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const cost = await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    await prisma.$transaction((tx) =>
      captureOrderProfitSnapshot(tx, { organizationId: tenant.orgId, orderId }),
    );
    // An amount edit stamped five minutes before T; the worker was down, so no
    // recompute ran after it.
    const profile = await prisma.costProfile.findUniqueOrThrow({ where: { id: cost.profileId } });
    const edited = await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: tenant.orgId,
        version: 2,
        name: profile.name,
        type: profile.type,
        amountGross: '70.00',
        vatRate: profile.vatRate,
        changedFields: ['amountGross'],
        effectiveFrom: beforeDayEnd(),
      },
    });
    const item = () =>
      prisma.orderItem.findFirstOrThrow({
        where: { orderId },
        select: { snapshotCostProfileVersionIds: true },
      });
    expect((await item()).snapshotCostProfileVersionIds).toEqual([cost.versionId]);

    const result = await processDayClose({ dbNow: afterDayEnd(10 * HOUR_MS) });

    expect(result.finalized).toBe(1);
    expect((await item()).snapshotCostProfileVersionIds).toEqual([edited.id]);
    expect((await readOrder(orderId)).sellerInputsFinalAt).toEqual(afterDayEnd(10 * HOUR_MS));
  });

  it('a detach stamped after T leaves the cost line in place', async () => {
    const tenant = await seedTenant();
    const seeded = await seedCalculableYesterdayOrder(tenant);
    // A real detach now: its removal is stamped after T.
    await detachCost(tenant, seeded.variantId, seeded.profileId);

    const result = await processDayClose({ dbNow: afterDayEnd(SELLER_INPUT_SETTLE_MS) });
    await drainQueue();

    expect(result).toMatchObject({ finalized: 1, excluded: 0 });
    const statement = await bestKnown(seeded.orderId);
    expect(statement.netProfit).not.toBeNull();
    expect(
      await prisma.profitLine.count({
        where: {
          orderId: seeded.orderId,
          organizationId: tenant.orgId,
          type: ProfitLineType.COST_COGS,
        },
      }),
    ).toBe(1);
  });

  it('a stamped order loses its net profit after its DAY_CLOSE recompute', async () => {
    const tenant = await seedTenant();
    const seeded = await seedCalculableYesterdayOrder(tenant);
    await prisma.$transaction(
      (tx) => recomputeParcelProfit(tx, { organizationId: tenant.orgId, orderId: seeded.orderId }),
      { maxWait: PROFIT_RECOMPUTE_TX_MAX_WAIT_MS, timeout: PROFIT_RECOMPUTE_TX_TIMEOUT_MS },
    );
    // Positive control: during its day the order had a net profit.
    expect((await bestKnown(seeded.orderId)).netProfit).not.toBeNull();
    await detachCost(tenant, seeded.variantId, seeded.profileId);
    await backdateSellerInputHistory(tenant.orgId, beforeDayEnd());

    const result = await processDayClose({ dbNow: afterDayEnd(SELLER_INPUT_SETTLE_MS) });
    await drainQueue();

    expect(result).toMatchObject({ finalized: 1, excluded: 1 });
    expect(await bestKnown(seeded.orderId)).toEqual({
      status: ProfitStatus.EXCLUDED,
      netProfit: null,
    });
  });

  it('an open pre-midnight transaction delays the pass and the cap releases it', async () => {
    const tenant = await seedTenant();
    // The day under test is today, closed by an injected clock at tomorrow's start: the
    // transaction held below began before that day end.
    const tomorrowStart = getBusinessDayRange(new Date()).end;
    const orderId = await seedOrder(tenant, await seedVariant(tenant), {
      dayEndOf: tomorrowStart,
      createdAt: new Date(),
    });
    const writer = await holdOpenTransaction();
    try {
      const held = await processDayClose({
        dbNow: new Date(tomorrowStart.getTime() + SELLER_INPUT_SETTLE_MS),
      });
      expect(held).toEqual(idleTick(previousDayStart(tomorrowStart)));
      expect((await readOrder(orderId)).sellerInputsFinalAt).toBeNull();

      const forced = await processDayClose({
        dbNow: new Date(tomorrowStart.getTime() + SELLER_INPUT_SETTLE_CAP_MS),
      });
      expect(forced).toMatchObject({ cutoff: tomorrowStart, finalized: 1 });
      expect((await readOrder(orderId)).sellerInputsFinalAt).not.toBeNull();
    } finally {
      await writer.release();
    }
  });

  it('an order that throws is skipped on the next tick and does not block the others', async () => {
    const tenant = await seedTenant();
    const failing = await seedOrder(tenant, await seedVariant(tenant));
    const others = [
      await seedOrder(tenant, await seedVariant(tenant)),
      await seedOrder(tenant, await seedVariant(tenant)),
    ];
    const calls: string[] = [];
    const flaky: typeof finalizeOrderSellerInputs = (tx, params) => {
      calls.push(params.orderId);
      if (params.orderId === failing) {
        return Promise.reject(new Error('finaliser failure under test'));
      }
      return finalizeOrderSellerInputs(tx, params);
    };
    const dbNow = afterDayEnd(SELLER_INPUT_SETTLE_MS);

    const first = await processDayClose({ dbNow, finalize: flaky });
    expect(first).toMatchObject({ finalized: 2, failed: 1 });
    for (const id of others) {
      expect((await readOrder(id)).sellerInputsFinalAt).not.toBeNull();
    }
    expect((await readOrder(failing)).sellerInputsFinalAt).toBeNull();

    calls.length = 0;
    const second = await processDayClose({ dbNow, finalize: flaky });
    expect(second).toEqual(idleTick(dayEnd()));
    expect(calls).not.toContain(failing);

    resetDayCloseBackoff();
    const third = await processDayClose({ dbNow });
    expect(third).toMatchObject({ finalized: 1, failed: 0 });
    expect((await readOrder(failing)).sellerInputsFinalAt).not.toBeNull();
  });

  it('a second run changes nothing', async () => {
    const tenant = await seedTenant();
    const orderId = await seedOrder(tenant, await seedVariant(tenant));
    const dbNow = afterDayEnd(SELLER_INPUT_SETTLE_MS);
    // Positive control: the first run finalises the order.
    expect(await processDayClose({ dbNow })).toMatchObject({ finalized: 1, excluded: 1 });
    const first = await readOrder(orderId);
    await prisma.profitRecomputeRequest.deleteMany({ where: { orderId } });

    expect(await processDayClose({ dbNow })).toEqual(idleTick(dayEnd()));
    expect(await readOrder(orderId)).toEqual(first);
    expect(await prisma.profitRecomputeRequest.count({ where: { orderId } })).toBe(0);
  });

  it("an old final order and today's order are never selected", async () => {
    const tenant = await seedTenant();
    const oldFinal = await seedOrder(tenant, await seedVariant(tenant), {
      dayEndOf: previousDayStart(previousDayStart(dayEnd())),
      sellerInputsFinalAt: previousDayStart(dayEnd()),
    });
    const today = await seedOrder(tenant, await seedVariant(tenant), {
      dayEndOf: getBusinessDayRange(new Date()).end,
      createdAt: new Date(),
    });
    const yesterday = await seedOrder(tenant, await seedVariant(tenant));
    const calls: string[] = [];
    const recording: typeof finalizeOrderSellerInputs = (tx, params) => {
      calls.push(params.orderId);
      return finalizeOrderSellerInputs(tx, params);
    };

    const result = await processDayClose({
      dbNow: afterDayEnd(SELLER_INPUT_SETTLE_MS),
      finalize: recording,
    });

    // Positive control: yesterday's non-final order is the one finalised.
    expect(calls).toEqual([yesterday]);
    expect(result.finalized).toBe(1);
    expect(calls).not.toContain(oldFinal);
    expect(calls).not.toContain(today);
    expect((await readOrder(today)).sellerInputsFinalAt).toBeNull();
  });

  it('orders of two organizations are each finalised under their own scope', async () => {
    const first = await seedTenant();
    const second = await seedTenant();
    const firstOrder = await seedOrder(first, await seedVariant(first));
    const secondOrder = await seedOrder(second, await seedVariant(second));

    const result = await processDayClose({ dbNow: afterDayEnd(SELLER_INPUT_SETTLE_MS) });

    expect(result).toMatchObject({ finalized: 2 });
    const rows = await prisma.profitRecomputeRequest.findMany({
      where: { orderId: { in: [firstOrder, secondOrder] } },
      select: { orderId: true, organizationId: true, storeId: true, reason: true },
      orderBy: { orderId: 'asc' },
    });
    expect(rows).toEqual(
      [
        {
          orderId: firstOrder,
          organizationId: first.orgId,
          storeId: first.storeId,
          reason: ProfitRecomputeReason.DAY_CLOSE,
        },
        {
          orderId: secondOrder,
          organizationId: second.orgId,
          storeId: second.storeId,
          reason: ProfitRecomputeReason.DAY_CLOSE,
        },
      ].sort((a, b) => (a.orderId < b.orderId ? -1 : 1)),
    );
  });

  it('a cancelled past-day order created non-final after its day settled ends up final via the pass', async () => {
    const tenant = await seedTenant();
    const dbNow = afterDayEnd(SELLER_INPUT_SETTLE_MS);
    const outcome = await intakeOrder({
      storeId: tenant.storeId,
      organizationId: tenant.orgId,
      mapped: buildMappedOrder({
        platformOrderId: 'day-close-cancelled',
        orderDate: new Date(dayEnd().getTime() - HOUR_MS),
        status: OrderStatus.CANCELLED,
      }),
      dbNow,
    });
    expect(outcome).toEqual({ kind: 'persisted', reason: 'cancelled_audit' });
    const cancelled = await prisma.order.findFirstOrThrow({
      where: { organizationId: tenant.orgId, platformOrderId: 'day-close-cancelled' },
      select: { id: true, createdAt: true },
    });
    // The intake's cancelled branch writes no marker, although the day is settled.
    expect((await readOrder(cancelled.id)).sellerInputsFinalAt).toBeNull();
    expect(cancelled.createdAt.getTime()).toBeGreaterThan(dayEnd().getTime());
    // Control: an uncosted, non-cancelled order first stored after T.
    const lateArrival = await seedOrder(tenant, await seedVariant(tenant), {
      createdAt: afterDayEnd(30_000),
    });

    const result = await processDayClose({ dbNow });

    expect(result).toMatchObject({ finalized: 2, excluded: 1 });
    expect(await readOrder(cancelled.id)).toEqual({
      sellerInputsFinalAt: dbNow,
      profitExcludedAt: null,
      profitExclusionReason: null,
    });
    expect((await readOrder(lateArrival)).profitExclusionReason).toBe(
      ProfitExclusionReason.LATE_UNCOSTED_ARRIVAL,
    );
  });
});
