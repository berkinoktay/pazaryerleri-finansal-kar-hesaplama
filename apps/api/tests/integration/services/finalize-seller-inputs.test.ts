/**
 * The day-close finaliser of one order (same-day edit window, plan P1-17; notes B3, D8,
 * amendment C1). Owner rule (Berkin 2026-11-23): an order's cost and desi are the
 * values in force at the end of its Istanbul business day T; changes during the day
 * reach all of that day's orders; at 00:00 the seller inputs become final.
 *
 * `finalizeOrderSellerInputs` re-derives the order's items at T, marks the order final,
 * stamps a past-day exclusion when the items show a cost or desi gap at T, and enqueues a
 * DAY_CLOSE recompute. Lock order: parcel advisory try-lock -> orders row
 * (FOR NO KEY UPDATE SKIP LOCKED) -> order_items -> orders row -> queue row.
 *
 * Orders here are dated yesterday, so T is today's start; the finaliser gets
 * `cutoff = T` and `dbNow = T + SELLER_INPUT_SETTLE_MS`. History "before T" is written
 * with explicit stamps (or a real write whose log row is backdated); history "after T"
 * is a real write, stamped now.
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma, type Prisma } from '@pazarsync/db';
import {
  OrderStatus,
  Platform,
  ProfitExclusionReason,
  ProfitRecomputeReason,
} from '@pazarsync/db/enums';
import { finalizeOrderSellerInputs, type FinalizeOutcome } from '@pazarsync/order-sync';
import {
  acquireParcelProfitLock,
  captureOrderProfitSnapshot,
  enqueueProfitRecompute,
  PROFIT_RECOMPUTE_TX_MAX_WAIT_MS,
  PROFIT_RECOMPUTE_TX_TIMEOUT_MS,
  recomputeParcelProfit,
} from '@pazarsync/profit';
import { getBusinessDayRange, previousDayStart, SELLER_INPUT_SETTLE_MS } from '@pazarsync/utils';

import { postgresSqlState } from '@/lib/postgres-sql-state';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  COST_FIXTURE_EPOCH,
  createCostProfile,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';
import { backdateSellerInputHistory } from '../../helpers/seller-input-history';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** A barrier step that has not happened by then is reported as not seen. */
const BARRIER_POLL_MS = 10_000;
/** A call that must not wait on a lock resolves well within this. */
const NO_WAIT_DEADLINE_MS = 2_000;
/** Held transactions outlive every wait in a test. */
const HOLDER_TIMEOUT_MS = 30_000;
/** Postgres SQLSTATE deadlock_detected. */
const DEADLOCK_DETECTED = '40P01';
/** Postgres SQLSTATE lock_not_available: a NOWAIT lock request met a held lock. */
const LOCK_NOT_AVAILABLE = '55P03';

/** The end T of yesterday's orders: today's business-day start. */
function dayEnd(): Date {
  return getBusinessDayRange(new Date()).start;
}

/** The tick's database clock: T plus the settle delay. */
function settledNow(): Date {
  return new Date(dayEnd().getTime() + SELLER_INPUT_SETTLE_MS);
}

/** Five minutes before T: a seller-input change stamped inside yesterday. */
function beforeDayEnd(): Date {
  return new Date(dayEnd().getTime() - 5 * MINUTE_MS);
}

interface Tenant {
  readonly orgId: string;
  readonly storeId: string;
}

async function seedTenant(platform: Platform = Platform.TRENDYOL): Promise<Tenant> {
  const org = await createOrganization();
  const store = await createStore(org.id, { platform });
  return { orgId: org.id, storeId: store.id };
}

/** Another store of the same organization. */
async function seedSiblingStore(tenant: Tenant): Promise<Tenant> {
  const store = await createStore(tenant.orgId);
  return { orgId: tenant.orgId, storeId: store.id };
}

/**
 * A catalog variant with the given desi columns, written by the insert (no history row).
 * Default: a non-digital variant with a synced desi of 2 and no seller desi.
 */
async function seedVariant(
  tenant: Tenant,
  desi: {
    readonly synced?: string | null;
    readonly override?: string | null;
    readonly isDigital?: boolean;
  } = {},
): Promise<string> {
  const tag = Math.floor(Math.random() * 1e9).toString();
  const product = await prisma.product.create({
    data: {
      organizationId: tenant.orgId,
      storeId: tenant.storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1e9)),
      productMainId: `pm-${tag}`,
      title: 'Day Close Product',
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
      isDigital: desi.isDigital ?? false,
      syncedDimensionalWeight: desi.synced === undefined ? '2' : desi.synced,
      dimensionalWeightOverride: desi.override ?? null,
    },
  });
  return variant.id;
}

/** A cost profile with its version 1, linked to the variant at `attachedAt`. */
async function attachCost(
  tenant: Tenant,
  variantId: string,
  opts: { readonly attachedAt?: Date; readonly effectiveFrom?: Date } = {},
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
      effectiveFrom: opts.effectiveFrom ?? COST_FIXTURE_EPOCH,
    },
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: tenant.orgId,
      productVariantId: variantId,
      profileId: profile.id,
      attachedAt: opts.attachedAt ?? COST_FIXTURE_EPOCH,
    },
  });
  return { profileId: profile.id, versionId: version.id };
}

/** A later version of the profile, in force from `effectiveFrom`: an amount edit. */
async function addCostVersion(
  tenant: Tenant,
  profileId: string,
  version: number,
  effectiveFrom: Date,
): Promise<string> {
  const profile = await prisma.costProfile.findUniqueOrThrow({ where: { id: profileId } });
  const row = await prisma.costProfileVersion.create({
    data: {
      profileId,
      organizationId: tenant.orgId,
      version,
      name: profile.name,
      type: profile.type,
      amountGross: '70.00',
      vatRate: profile.vatRate,
      changedFields: ['amountGross'],
      effectiveFrom,
    },
  });
  return row.id;
}

/** Deletes the variant's link to the profile (the trigger logs the removal, stamped now). */
async function detachCost(tenant: Tenant, variantId: string, profileId: string): Promise<void> {
  await prisma.productVariantCostProfile.deleteMany({
    where: { organizationId: tenant.orgId, productVariantId: variantId, profileId },
  });
}

/**
 * Yesterday's order with one item of `variantId` (null = an unmatched line). By default
 * it was first stored an hour before T, inside its own day.
 */
async function seedOrder(
  tenant: Tenant,
  variantId: string | null,
  opts: { readonly createdAt?: Date; readonly status?: OrderStatus } = {},
): Promise<string> {
  const order = await createOrder(tenant.orgId, tenant.storeId, {
    orderDate: new Date(dayEnd().getTime() - HOUR_MS),
    status: opts.status ?? OrderStatus.DELIVERED,
  });
  await createOrderItem(order.id, tenant.orgId, { productVariantId: variantId });
  await prisma.order.update({
    where: { id: order.id },
    data: { createdAt: opts.createdAt ?? new Date(dayEnd().getTime() - 2 * HOUR_MS) },
  });
  return order.id;
}

/** The capture a recompute made during the order's day. */
async function capture(tenant: Tenant, orderId: string): Promise<void> {
  await prisma.$transaction((tx) =>
    captureOrderProfitSnapshot(tx, { organizationId: tenant.orgId, orderId }),
  );
}

/** One finaliser call in its own transaction, as the day-close tick runs it. */
async function finalize(
  tenant: Tenant,
  orderId: string,
  opts: { readonly cutoff?: Date; readonly stampMissingDesi?: boolean } = {},
): Promise<FinalizeOutcome> {
  return prisma.$transaction(
    (tx) =>
      finalizeOrderSellerInputs(tx, {
        organizationId: tenant.orgId,
        storeId: tenant.storeId,
        orderId,
        cutoff: opts.cutoff ?? dayEnd(),
        dbNow: settledNow(),
        ...(opts.stampMissingDesi !== undefined && { stampMissingDesi: opts.stampMissingDesi }),
      }),
    { maxWait: PROFIT_RECOMPUTE_TX_MAX_WAIT_MS, timeout: PROFIT_RECOMPUTE_TX_TIMEOUT_MS },
  );
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

async function readItem(orderId: string): Promise<{
  readonly snapshotCostProfileVersionIds: string[];
  readonly snapshotUnitDesi: Prisma.Decimal | null;
}> {
  return prisma.orderItem.findFirstOrThrow({
    where: { orderId },
    select: { snapshotCostProfileVersionIds: true, snapshotUnitDesi: true },
  });
}

async function queueRows(
  orderId: string,
): Promise<readonly { readonly reason: ProfitRecomputeReason; readonly organizationId: string }[]> {
  return prisma.profitRecomputeRequest.findMany({
    where: { orderId },
    select: { reason: true, organizationId: true },
  });
}

/** Asserts a finalised order: marked final at the tick's clock, stamped with `reason` or not at all. */
async function expectFinal(orderId: string, reason: ProfitExclusionReason | null): Promise<void> {
  const order = await readOrder(orderId);
  expect(order.sellerInputsFinalAt).toEqual(settledNow());
  expect(order.profitExclusionReason).toBe(reason);
  expect(order.profitExcludedAt).toEqual(reason === null ? null : settledNow());
}

interface OpenTransaction {
  /** Resolves with the backend pid once `work` has run inside the open transaction. */
  readonly ready: Promise<number>;
  /** Lets the transaction commit and waits for it to end (rethrows its error). */
  readonly release: () => Promise<void>;
}

/**
 * Opens a transaction on another pooled connection, runs `work` in it and keeps it open
 * until `release`. `ready` stays pending while `work` waits on a lock, so a caller can
 * assert that it does not wait. Every caller releases it in a `finally`.
 */
function openTransaction(
  work: (tx: Prisma.TransactionClient) => Promise<unknown>,
): OpenTransaction {
  let markReady: (pid: number) => void = () => undefined;
  const started = new Promise<number>((resolve) => {
    markReady = resolve;
  });
  let markReleased: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await work(tx);
      markReady(rows[0]?.pid ?? -1);
      await released;
    },
    { timeout: HOLDER_TIMEOUT_MS },
  );
  const ready = Promise.race([
    started,
    holder.then(() => {
      throw new Error('the held transaction ended before its work finished');
    }),
  ]);
  // A failure surfaces through `release`; this keeps an unawaited `ready` quiet.
  void ready.catch(() => undefined);
  return {
    ready,
    release: async () => {
      markReleased();
      await holder;
    },
  };
}

/** True when `work` settles within `ms`; false when it is still pending then. */
async function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true,
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls `probe` every 50 ms until it is true or `BARRIER_POLL_MS` passed. */
async function pollUntil(probe: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + BARRIER_POLL_MS;
  while (Date.now() < deadline) {
    if (await probe()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** True when backend `pid` waits for a relation lock on order_items. */
async function waitsOnOrderItems(pid: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
    SELECT count(*)::int AS waiting
      FROM pg_locks
     WHERE pid = ${pid}
       AND locktype = 'relation'
       AND relation = 'order_items'::regclass
       AND NOT granted`;
  return (rows[0]?.waiting ?? 0) > 0;
}

/** True when backend `pid` waits for another transaction to end (a transactionid lock). */
async function waitsOnTransaction(pid: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
    SELECT count(*)::int AS waiting
      FROM pg_locks
     WHERE pid = ${pid}
       AND locktype = 'transactionid'
       AND NOT granted`;
  return (rows[0]?.waiting ?? 0) > 0;
}

/** The SQLSTATE a `FOR NO KEY UPDATE NOWAIT` on the order meets from another connection, or null. */
async function nowaitOrderLockSqlState(tenant: Tenant, orderId: string): Promise<string | null> {
  try {
    await prisma.$queryRaw`
      SELECT id FROM orders
       WHERE id = ${orderId}::uuid AND organization_id = ${tenant.orgId}::uuid
       FOR NO KEY UPDATE NOWAIT`;
    return null;
  } catch (err) {
    return postgresSqlState(err);
  }
}

/** The SQLSTATE of a rejection, recorded for the no-deadlock assertion. */
function recordSqlState(sqlStates: string[]): (err: unknown) => never {
  return (err: unknown) => {
    sqlStates.push(postgresSqlState(err) ?? 'none');
    throw err;
  };
}

describe('finalizeOrderSellerInputs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('only cost detached before T -> COST_DEADLINE_MISSED, final, DAY_CLOSE queue row', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const cost = await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    expect((await readItem(orderId)).snapshotCostProfileVersionIds).toEqual([cost.versionId]);
    await detachCost(tenant, variantId, cost.profileId);
    await backdateSellerInputHistory(tenant.orgId, beforeDayEnd());

    const outcome = await finalize(tenant, orderId);

    expect(outcome).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
    await expectFinal(orderId, ProfitExclusionReason.COST_DEADLINE_MISSED);
    expect((await readItem(orderId)).snapshotCostProfileVersionIds).toEqual([]);
    expect(await queueRows(orderId)).toEqual([
      { reason: ProfitRecomputeReason.DAY_CLOSE, organizationId: tenant.orgId },
    ]);
  });

  it('cost detached after T -> final, not stamped, the captured cost list is kept', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const cost = await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    // A real detach now: its removal is stamped after T.
    await detachCost(tenant, variantId, cost.profileId);

    const outcome = await finalize(tenant, orderId);

    expect(outcome).toEqual({ kind: 'finalized', exclusion: null });
    await expectFinal(orderId, null);
    expect((await readItem(orderId)).snapshotCostProfileVersionIds).toEqual([cost.versionId]);
  });

  it('a stale captured list is re-derived at T', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const first = await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    // A second profile attached before T; no recompute ran after it.
    const second = await attachCost(tenant, variantId, { attachedAt: beforeDayEnd() });
    expect((await readItem(orderId)).snapshotCostProfileVersionIds).toEqual([first.versionId]);

    const outcome = await finalize(tenant, orderId);

    expect(outcome).toEqual({ kind: 'finalized', exclusion: null });
    await expectFinal(orderId, null);
    expect((await readItem(orderId)).snapshotCostProfileVersionIds).toEqual(
      [first.versionId, second.versionId].sort(),
    );
  });

  it('an amount edit stamped before T that no recompute applied is pinned at finalisation', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const cost = await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    // The worker was down: the edit is stamped before T, and nothing recomputed after it.
    const edited = await addCostVersion(tenant, cost.profileId, 2, beforeDayEnd());

    const outcome = await finalize(tenant, orderId);

    expect(outcome).toEqual({ kind: 'finalized', exclusion: null });
    await expectFinal(orderId, null);
    expect((await readItem(orderId)).snapshotCostProfileVersionIds).toEqual([edited]);
  });

  it('desi cleared before T with the switch on -> DESI_DEADLINE_MISSED', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant, { synced: null, override: '3' });
    await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    expect((await readItem(orderId)).snapshotUnitDesi?.toString()).toBe('3');
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { dimensionalWeightOverride: null },
    });
    await backdateSellerInputHistory(tenant.orgId, beforeDayEnd());

    const outcome = await finalize(tenant, orderId, { stampMissingDesi: true });

    expect(outcome).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.DESI_DEADLINE_MISSED,
    });
    await expectFinal(orderId, ProfitExclusionReason.DESI_DEADLINE_MISSED);
    expect((await readItem(orderId)).snapshotUnitDesi).toBeNull();
  });

  it('seller clears the override before T and the variant never had a Trendyol desi: the order is final and stamped DESI_DEADLINE_MISSED', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant, { synced: null, override: '3' });
    await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    const switchOffTwin = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    await capture(tenant, switchOffTwin);
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { dimensionalWeightOverride: null },
    });
    await backdateSellerInputHistory(tenant.orgId, beforeDayEnd());

    // The default: the switch is ON (amendment C1).
    const outcome = await finalize(tenant, orderId);

    expect(outcome).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.DESI_DEADLINE_MISSED,
    });
    await expectFinal(orderId, ProfitExclusionReason.DESI_DEADLINE_MISSED);
    expect((await readItem(orderId)).snapshotUnitDesi).toBeNull();
    // The switch stays the one isolated place: off, the same order is final, has no
    // desi and is not stamped.
    expect(await finalize(tenant, switchOffTwin, { stampMissingDesi: false })).toEqual({
      kind: 'finalized',
      exclusion: null,
    });
    await expectFinal(switchOffTwin, null);
    expect((await readItem(switchOffTwin)).snapshotUnitDesi).toBeNull();
  });

  it('both missing -> the cost reason, with the switch on and off', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant, { synced: null, override: null });
    const switchOn = await seedOrder(tenant, variantId);
    const switchOff = await seedOrder(tenant, variantId);

    expect(await finalize(tenant, switchOn, { stampMissingDesi: true })).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
    expect(await finalize(tenant, switchOff, { stampMissingDesi: false })).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
    await expectFinal(switchOn, ProfitExclusionReason.COST_DEADLINE_MISSED);
    await expectFinal(switchOff, ProfitExclusionReason.COST_DEADLINE_MISSED);
  });

  it('an order first stored after T without a cost -> LATE_UNCOSTED_ARRIVAL', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const orderId = await seedOrder(tenant, variantId, {
      createdAt: new Date(dayEnd().getTime() + 30_000),
    });

    const outcome = await finalize(tenant, orderId);

    expect(outcome).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.LATE_UNCOSTED_ARRIVAL,
    });
    await expectFinal(orderId, ProfitExclusionReason.LATE_UNCOSTED_ARRIVAL);
  });

  it('a Trendyol desi filled before T on an item captured without one -> priced, not stamped', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant, { synced: null, override: null });
    await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    expect((await readItem(orderId)).snapshotUnitDesi).toBeNull();
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { syncedDimensionalWeight: '4' },
    });
    await backdateSellerInputHistory(tenant.orgId, beforeDayEnd());

    const outcome = await finalize(tenant, orderId);

    expect(outcome).toEqual({ kind: 'finalized', exclusion: null });
    await expectFinal(orderId, null);
    expect((await readItem(orderId)).snapshotUnitDesi?.toString()).toBe('4');
  });

  it("cutoff before the order's T -> skipped/not_settled, nothing written", async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const orderId = await seedOrder(tenant, variantId);

    const outcome = await finalize(tenant, orderId, { cutoff: previousDayStart(dayEnd()) });

    expect(outcome).toEqual({ kind: 'skipped', reason: 'not_settled' });
    expect(await readOrder(orderId)).toEqual({
      sellerInputsFinalAt: null,
      profitExcludedAt: null,
      profitExclusionReason: null,
    });
    expect(await queueRows(orderId)).toEqual([]);
    // Positive control: with the cutoff at T the same uncosted order is finalised.
    expect(await finalize(tenant, orderId)).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
  });

  it('after finalisation a seller change plus a recompute leaves the items unchanged', async () => {
    await ensureFeeDefinitions();
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const cost = await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    const nonFinalTwin = await seedOrder(tenant, variantId);
    await capture(tenant, orderId);
    await capture(tenant, nonFinalTwin);
    expect(await finalize(tenant, orderId)).toEqual({ kind: 'finalized', exclusion: null });

    // A seller change that a non-final order of the day picks up: an amount version in
    // force before T, and a desi correction stamped before T.
    const edited = await addCostVersion(tenant, cost.profileId, 2, beforeDayEnd());
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { dimensionalWeightOverride: '7' },
    });
    await backdateSellerInputHistory(tenant.orgId, beforeDayEnd());
    for (const id of [orderId, nonFinalTwin]) {
      await prisma.$transaction(
        (tx) => recomputeParcelProfit(tx, { organizationId: tenant.orgId, orderId: id }),
        { maxWait: PROFIT_RECOMPUTE_TX_MAX_WAIT_MS, timeout: PROFIT_RECOMPUTE_TX_TIMEOUT_MS },
      );
    }

    const finalItem = await readItem(orderId);
    expect(finalItem.snapshotCostProfileVersionIds).toEqual([cost.versionId]);
    expect(finalItem.snapshotUnitDesi?.toString()).toBe('2');
    // Positive control: the non-final twin re-derived both.
    const twinItem = await readItem(nonFinalTwin);
    expect(twinItem.snapshotCostProfileVersionIds).toEqual([edited]);
    expect(twinItem.snapshotUnitDesi?.toString()).toBe('7');
  });

  it('finaliser skips an order whose row intake holds, then finalises it unstamped once the cancel commits', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const orderId = await seedOrder(tenant, variantId);
    const uncancelledTwin = await seedOrder(tenant, variantId);
    const sqlStates: string[] = [];

    // Intake's update of the orders row, not committed yet.
    const intake = openTransaction((tx) =>
      tx.$executeRaw`
        UPDATE orders SET status = 'CANCELLED'
         WHERE id = ${orderId}::uuid AND organization_id = ${tenant.orgId}::uuid`.catch(
        recordSqlState(sqlStates),
      ),
    );
    try {
      await intake.ready;
      const busy = finalize(tenant, orderId).catch(recordSqlState(sqlStates));
      expect(await settlesWithin(busy, NO_WAIT_DEADLINE_MS)).toBe(true);
      expect(await busy).toEqual({ kind: 'skipped', reason: 'busy' });
      expect((await readOrder(orderId)).sellerInputsFinalAt).toBeNull();
    } finally {
      await intake.release().catch(recordSqlState(sqlStates));
    }

    expect(await finalize(tenant, orderId)).toEqual({ kind: 'finalized', exclusion: null });
    await expectFinal(orderId, null);
    // Positive control: the uncancelled twin with no cost is stamped.
    expect(await finalize(tenant, uncancelledTwin)).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
    expect(sqlStates).not.toContain(DEADLOCK_DETECTED);
  });

  it("a writer's fresh queue insert for the same order neither blocks on the finaliser's row lock nor deadlocks with it", async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    await attachCost(tenant, variantId);
    const orderId = await seedOrder(tenant, variantId);
    expect(await queueRows(orderId)).toEqual([]);
    const sqlStates: string[] = [];

    // (a) The blocker holds order_items, so the finaliser stops at its capture.
    const blocker = openTransaction(
      (tx) => tx.$executeRaw`LOCK TABLE order_items IN ACCESS EXCLUSIVE MODE`,
    );
    let writer: OpenTransaction | null = null;
    let finaliser: Promise<FinalizeOutcome> | null = null;
    try {
      await blocker.ready;
      // (b) The finaliser takes the orders row, then waits on order_items.
      let markPid: (pid: number) => void = () => undefined;
      const finaliserPid = new Promise<number>((resolve) => {
        markPid = resolve;
      });
      finaliser = prisma
        .$transaction(
          async (tx) => {
            const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
            markPid(rows[0]?.pid ?? -1);
            return finalizeOrderSellerInputs(tx, {
              organizationId: tenant.orgId,
              storeId: tenant.storeId,
              orderId,
              cutoff: dayEnd(),
              dbNow: settledNow(),
            });
          },
          { maxWait: PROFIT_RECOMPUTE_TX_MAX_WAIT_MS, timeout: PROFIT_RECOMPUTE_TX_TIMEOUT_MS },
        )
        .catch(recordSqlState(sqlStates));
      // Keeps an early rejection from surfacing unhandled before it is awaited below.
      void finaliser.catch(() => undefined);
      const pid = await finaliserPid;
      expect(await pollUntil(() => waitsOnOrderItems(pid))).toBe(true);
      // Control: the finaliser holds the orders row while it waits.
      expect(await nowaitOrderLockSqlState(tenant, orderId)).toBe(LOCK_NOT_AVAILABLE);

      // (c) A seller-input writer's fresh queue insert for the same order: its foreign-key
      // check takes a key-share lock on the orders row, which must not wait.
      const openWriter = openTransaction((tx) =>
        enqueueProfitRecompute(tx, {
          organizationId: tenant.orgId,
          storeId: tenant.storeId,
          orderIds: [orderId],
          reason: ProfitRecomputeReason.DESI_CHANGED,
        }).catch(recordSqlState(sqlStates)),
      );
      writer = openWriter;
      expect(await settlesWithin(openWriter.ready, NO_WAIT_DEADLINE_MS)).toBe(true);

      // (d) Release order_items: the finaliser runs on to its own queue insert and waits
      // there for the writer's uncommitted row.
      await blocker.release().catch(recordSqlState(sqlStates));
      expect(await pollUntil(() => waitsOnTransaction(pid))).toBe(true);

      // (e) The writer commits; the finaliser finishes.
      writer = null;
      await openWriter.release().catch(recordSqlState(sqlStates));
      expect(await finaliser).toEqual({ kind: 'finalized', exclusion: null });
      expect(await queueRows(orderId)).toEqual([
        { reason: ProfitRecomputeReason.DAY_CLOSE, organizationId: tenant.orgId },
      ]);
    } finally {
      await blocker.release().catch(() => undefined);
      if (writer !== null) {
        await writer.release().catch(() => undefined);
      }
      if (finaliser !== null) {
        await finaliser.catch(() => undefined);
      }
    }
    expect(sqlStates).not.toContain(DEADLOCK_DETECTED);
  });

  it('a held parcel advisory lock -> skipped/busy', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const orderId = await seedOrder(tenant, variantId);

    const recompute = openTransaction((tx) => acquireParcelProfitLock(tx, orderId));
    try {
      await recompute.ready;
      expect(await finalize(tenant, orderId)).toEqual({ kind: 'skipped', reason: 'busy' });
      expect((await readOrder(orderId)).sellerInputsFinalAt).toBeNull();
    } finally {
      await recompute.release();
    }
    // Positive control: once the recompute ended, the order is finalised.
    expect(await finalize(tenant, orderId)).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
  });

  it('a cancelled order is finalised without a stamp', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const cancelled = await seedOrder(tenant, variantId, { status: OrderStatus.CANCELLED });
    const delivered = await seedOrder(tenant, variantId);

    expect(await finalize(tenant, cancelled)).toEqual({ kind: 'finalized', exclusion: null });
    await expectFinal(cancelled, null);
    expect(await queueRows(cancelled)).toEqual([
      { reason: ProfitRecomputeReason.DAY_CLOSE, organizationId: tenant.orgId },
    ]);
    // Positive control: the same uncosted order, not cancelled, is stamped.
    expect(await finalize(tenant, delivered)).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
  });

  it('a second call returns already_final and writes nothing', async () => {
    const tenant = await seedTenant();
    const variantId = await seedVariant(tenant);
    const orderId = await seedOrder(tenant, variantId);
    expect(await finalize(tenant, orderId)).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
    await prisma.profitRecomputeRequest.deleteMany({ where: { orderId } });
    const first = await readOrder(orderId);

    expect(await finalize(tenant, orderId)).toEqual({ kind: 'skipped', reason: 'already_final' });
    expect(await readOrder(orderId)).toEqual(first);
    expect(await queueRows(orderId)).toEqual([]);
  });

  it('an order of a non-Trendyol store is marked final without a stamp', async () => {
    const tenant = await seedTenant(Platform.HEPSIBURADA);
    const variantId = await seedVariant(tenant);
    const orderId = await seedOrder(tenant, variantId);

    expect(await finalize(tenant, orderId)).toEqual({ kind: 'finalized', exclusion: null });
    await expectFinal(orderId, null);
    // The engine cannot compute the platform: no capture and no recompute request.
    expect((await readItem(orderId)).snapshotCostProfileVersionIds).toEqual([]);
    expect(await queueRows(orderId)).toEqual([]);
  });

  it('a call scoped to another store or organization skips that order and leaves it untouched', async () => {
    const tenant = await seedTenant();
    const sibling = await seedSiblingStore(tenant);
    const stranger = await seedTenant();
    const own = await seedOrder(tenant, await seedVariant(tenant));
    const siblingOrder = await seedOrder(sibling, await seedVariant(sibling));
    const strangerOrder = await seedOrder(stranger, await seedVariant(stranger));

    expect(await finalize(tenant, siblingOrder)).toEqual({ kind: 'skipped', reason: 'busy' });
    expect(await finalize(tenant, strangerOrder)).toEqual({ kind: 'skipped', reason: 'busy' });
    for (const id of [siblingOrder, strangerOrder]) {
      expect(await readOrder(id)).toEqual({
        sellerInputsFinalAt: null,
        profitExcludedAt: null,
        profitExclusionReason: null,
      });
      expect(await queueRows(id)).toEqual([]);
    }
    // Positive control: the caller's own order is finalised.
    expect(await finalize(tenant, own)).toEqual({
      kind: 'finalized',
      exclusion: ProfitExclusionReason.COST_DEADLINE_MISSED,
    });
  });
});
