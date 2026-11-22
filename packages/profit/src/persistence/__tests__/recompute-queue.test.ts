/**
 * Integration tests for the profit recompute queue (Phase 3B, Gorev 2). They run
 * against the isolated test database. The enqueue tests pin tenant isolation and
 * de-duplication; the drain tests pin that a recompute writes statements, that a
 * request re-requested while computing survives, that a failing request backs off
 * without blocking the others, that two concurrent claims take disjoint rows, and
 * that a vanished order's request is dropped.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { randomUUID } from 'node:crypto';

import { prisma, type Prisma } from '@pazarsync/db';
import {
  type OrderStatus,
  Platform,
  ProfitExclusionReason,
  ProfitIssueCode,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PROFIT_ENGINE_VERSION } from '../../core/engine-version';
import { parseStoredIssues } from '../../read/stored-issues';
import {
  type ClaimedRecompute,
  claimProfitRecomputeRequests,
  drainProfitRecomputeQueue,
  enqueueCarrierGapRecomputes,
  enqueueProfitRecompute,
  enqueueProfitRecomputeForStore,
  enqueueProfitRecomputeForVariants,
  enqueueReferenceDataGapRecomputes,
  enqueueStaleProfitStatements,
  processClaimedRecompute,
} from '../recompute-queue';
import { deferred, delay } from './helpers/concurrency';
import {
  createAdditionalStore,
  ensureDbReachable,
  MELONTIK,
  type MelontikParcel,
  seedBareOrder,
  seedMelontikParcel,
  truncateAll,
  upsertCarrierWithTariffs,
} from './helpers/melontik-parcel';

/** The window a disjoint claim gets before we treat it as blocked on a held lock. */
const CONCURRENT_CLAIM_WAIT_MS = 8000;

/** Adds one more order item pointing at an existing variant (same-variant line). */
async function addOrderItemForVariant(params: {
  readonly orderId: string;
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly barcode: string;
}): Promise<void> {
  await prisma.orderItem.create({
    data: {
      orderId: params.orderId,
      organizationId: params.organizationId,
      productVariantId: params.productVariantId,
      quantity: 1,
      barcode: params.barcode,
      lineListGross: '100',
      lineSaleGross: '100',
      lineSellerDiscountGross: '0',
      saleVatRate: '10',
    },
  });
}

/** Inserts one BEST_KNOWN statement with a given engine version for the sweep test. */
async function insertBestKnownStatement(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly engineVersion: number;
}): Promise<void> {
  await prisma.orderProfitStatement.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      orderId: params.orderId,
      view: ProfitStatementView.BEST_KNOWN,
      status: ProfitStatus.ESTIMATED,
      saleGross: '0',
      costGross: '0',
      vatOutput: '0',
      vatInput: '0',
      vatNet: '0',
      vatEffective: '0',
      stoppageGross: '0',
      stoppageIncluded: false,
      netProfit: null,
      saleMarginPct: null,
      costMarkupPct: null,
      issues: [],
      settingsSnapshot: {},
      engineVersion: params.engineVersion,
      contentHash: randomUUID(),
      computedAt: new Date(),
    },
  });
}

/** The queue rows (by order) currently present, for isolation assertions. */
async function queuedOrderIds(): Promise<string[]> {
  const rows = await prisma.profitRecomputeRequest.findMany({ select: { orderId: true } });
  return rows.map((row) => row.orderId).sort();
}

describe('profit recompute queue', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('enqueues only the given orders of the organization and store', async () => {
    const parcel = await seedMelontikParcel();
    const other = await seedMelontikParcel();

    const count = await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      // The other organization's order id is passed too; the org/store filter drops it.
      orderIds: [parcel.orderId, other.orderId],
    });

    expect(count).toBe(1);
    expect(await queuedOrderIds()).toEqual([parcel.orderId]);
  });

  it('bumps an existing request instead of duplicating it', async () => {
    const parcel = await seedMelontikParcel();

    await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [parcel.orderId],
    });

    // Age the request and dirty it, so the bump has something to reset.
    const past = new Date('2020-01-01T00:00:00.000Z');
    await prisma.profitRecomputeRequest.update({
      where: { orderId: parcel.orderId },
      data: { requestedAt: past, attempts: 5, lastError: 'boom' },
    });

    const count = await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.COST_CHANGED,
      orderIds: [parcel.orderId],
    });

    expect(count).toBe(1);
    const rows = await prisma.profitRecomputeRequest.findMany({
      where: { orderId: parcel.orderId },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error('expected a queue row');
    }
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
    expect(row.reason).toBe(ProfitRecomputeReason.COST_CHANGED);
    expect(row.requestedAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it('enqueues the orders that contain the given variants within the organization', async () => {
    const parcel = await seedMelontikParcel();
    // A second line of the same variant: the enqueue must still touch the row once.
    await addOrderItemForVariant({
      orderId: parcel.orderId,
      organizationId: parcel.organizationId,
      productVariantId: parcel.variantA,
      barcode: MELONTIK.items.a.barcode,
    });

    // Another organization whose variant carries the same barcode string.
    const other = await seedMelontikParcel();

    const count = await enqueueProfitRecomputeForVariants(prisma, {
      organizationId: parcel.organizationId,
      reason: ProfitRecomputeReason.COST_CHANGED,
      variantIds: [parcel.variantA],
    });

    expect(count).toBe(1);
    expect(await queuedOrderIds()).toEqual([parcel.orderId]);
    // The other org's order never enters the queue even though it shares a barcode.
    const otherRow = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: other.orderId },
    });
    expect(otherRow).toBeNull();
  });

  it('never enqueues another organization order even when its variant id is passed', async () => {
    const parcel = await seedMelontikParcel();
    const other = await seedMelontikParcel();

    // The organization filter is the only tenant guard of the variants scope: even a
    // variant id that genuinely belongs to another org must not pull its order in.
    const count = await enqueueProfitRecomputeForVariants(prisma, {
      organizationId: parcel.organizationId,
      reason: ProfitRecomputeReason.COST_CHANGED,
      variantIds: [parcel.variantA, other.variantA],
    });

    expect(count).toBe(1);
    expect(await queuedOrderIds()).toEqual([parcel.orderId]);
  });

  it('enqueues every order of a store and nothing of its sibling store', async () => {
    const parcel = await seedMelontikParcel();
    const siblingStoreId = await createAdditionalStore({ organizationId: parcel.organizationId });
    const siblingOrderId = await seedBareOrder({
      organizationId: parcel.organizationId,
      storeId: siblingStoreId,
    });
    const extraInStore = await seedBareOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });

    const count = await enqueueProfitRecomputeForStore(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.REFERENCE_CHANGED,
    });

    expect(count).toBe(2);
    expect(await queuedOrderIds()).toEqual([parcel.orderId, extraInStore].sort());
    const siblingRow = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: siblingOrderId },
    });
    expect(siblingRow).toBeNull();
  });

  it('sweeps orders without a statement or with an old engine version, up to the limit', async () => {
    // order0 is the newest; the sweep orders by order_date DESC.
    const parcel = await seedMelontikParcel(); // order0: no statement -> eligible
    const org = parcel.organizationId;
    const store = parcel.storeId;

    const order1 = await seedBareOrder({
      organizationId: org,
      storeId: store,
      orderDate: new Date('2026-10-27T09:00:00Z'),
    }); // no statement -> eligible
    const order2 = await seedBareOrder({
      organizationId: org,
      storeId: store,
      orderDate: new Date('2026-10-26T09:00:00Z'),
    });
    await insertBestKnownStatement({
      organizationId: org,
      storeId: store,
      orderId: order2,
      engineVersion: 0,
    }); // old engine version -> eligible
    const order3 = await seedBareOrder({
      organizationId: org,
      storeId: store,
      orderDate: new Date('2026-10-25T09:00:00Z'),
    });
    await insertBestKnownStatement({
      organizationId: org,
      storeId: store,
      orderId: order3,
      engineVersion: PROFIT_ENGINE_VERSION,
    }); // up-to-date -> never swept
    const order4 = await seedBareOrder({
      organizationId: org,
      storeId: store,
      orderDate: new Date('2026-10-24T09:00:00Z'),
    });
    await enqueueProfitRecompute(prisma, {
      organizationId: org,
      storeId: store,
      reason: ProfitRecomputeReason.MANUAL,
      orderIds: [order4],
    }); // already queued -> skipped

    // First sweep: three orders are eligible (order0, order1, order2) but the limit
    // takes only the two newest.
    const firstSwept = await enqueueStaleProfitStatements(prisma, { limit: 2 });
    expect(firstSwept).toBe(2);
    expect(await queuedOrderIds()).toEqual([parcel.orderId, order1, order4].sort());

    // Second sweep: order0 and order1 now carry a queue row, so only the old-version
    // order2 is left; order3 (up-to-date) and order4 (queued) stay out.
    const secondSwept = await enqueueStaleProfitStatements(prisma, { limit: 10 });
    expect(secondSwept).toBe(1);
    expect(await queuedOrderIds()).toEqual([parcel.orderId, order1, order2, order4].sort());
    const order3Row = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order3 },
    });
    expect(order3Row).toBeNull();
  });

  it('drains a request: writes the statements and deletes the request', async () => {
    const parcel = await seedMelontikParcel({
      storeProfitSettings: { includeStopaj: true, includeNegativeNetVat: true },
    });
    await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [parcel.orderId],
    });

    const result = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(result.claimed).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.failed).toBe(0);

    const bestKnown = await prisma.orderProfitStatement.findFirst({
      where: { orderId: parcel.orderId, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(bestKnown?.netProfit?.toFixed(2)).toBe('191.79');

    expect(await prisma.profitRecomputeRequest.count()).toBe(0);
  });

  it('keeps a request that was re-requested while it was being computed', async () => {
    const parcel = await seedMelontikParcel();
    await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [parcel.orderId],
    });

    const claimed = await claimProfitRecomputeRequests(prisma, { batchSize: 1 });
    expect(claimed).toHaveLength(1);
    const request = claimed[0];
    if (request === undefined) {
      throw new Error('expected a claimed request');
    }

    // A new request arrives while the claimed one is "being computed": clock_timestamp()
    // is millisecond-stored, so wait long enough that requested_at genuinely moves.
    await delay(10);
    await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.CLAIM_CHANGED,
      orderIds: [parcel.orderId],
    });

    const outcome = await processClaimedRecompute(prisma, request);
    expect(outcome).toBe('CHANGED');

    // The re-request's requested_at no longer matches the claimed value, so the row
    // survives for another pass and carries the newer request.
    const row = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: parcel.orderId },
    });
    if (row === null) {
      throw new Error('expected the re-requested row to survive');
    }
    expect(row.requestedAt.getTime()).toBeGreaterThan(request.requestedAt.getTime());
    expect(row.reason).toBe(ProfitRecomputeReason.CLAIM_CHANGED);

    // The compute still happened: the statements are written.
    expect(await prisma.orderProfitStatement.count({ where: { orderId: parcel.orderId } })).toBe(2);
  });

  it('backs off a failing request and still drains the others', async () => {
    const good = await seedMelontikParcel();
    // A seller discount larger than the list drives the computed sale negative, so the
    // snapshot assertion rejects the parcel and the recompute throws.
    const bad = await seedMelontikParcel({ lineSellerDiscountGrossA: '600.00' });

    await enqueueProfitRecompute(prisma, {
      organizationId: good.organizationId,
      storeId: good.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [good.orderId],
    });
    await enqueueProfitRecompute(prisma, {
      organizationId: bad.organizationId,
      storeId: bad.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [bad.orderId],
    });

    const result = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(result.claimed).toBe(2);
    expect(result.changed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failedOrderIds).toEqual([bad.orderId]);

    // The good order drained: statement written, request gone.
    const goodStmt = await prisma.orderProfitStatement.findFirst({
      where: { orderId: good.orderId, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(goodStmt?.netProfit?.toFixed(2)).toBe('191.79');
    const goodRow = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: good.orderId },
    });
    expect(goodRow).toBeNull();

    // The bad order backed off: attempts 1, an error recorded, ~30s in the future.
    const badRow = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: bad.orderId },
    });
    if (badRow === null) {
      throw new Error('expected the failing request to remain queued');
    }
    expect(badRow.attempts).toBe(1);
    expect(badRow.lastError).not.toBeNull();
    expect(badRow.lastError ?? '').toContain('saleGross');
    const firstDelayMs = badRow.nextAttemptAt.getTime() - Date.now();
    expect(firstDelayMs).toBeGreaterThan(20_000);
    expect(firstDelayMs).toBeLessThan(40_000);

    // A second failure doubles the delay. Make the row claimable again first.
    await prisma.profitRecomputeRequest.update({
      where: { orderId: bad.orderId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const secondResult = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(secondResult.failed).toBe(1);

    const badRowAgain = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: bad.orderId },
    });
    if (badRowAgain === null) {
      throw new Error('expected the failing request to remain queued after the second attempt');
    }
    expect(badRowAgain.attempts).toBe(2);
    const secondDelayMs = badRowAgain.nextAttemptAt.getTime() - Date.now();
    expect(secondDelayMs).toBeGreaterThan(50_000);
    expect(secondDelayMs).toBeLessThan(70_000);
  });

  it('does not back off a request that was re-requested while its computation failed', async () => {
    // A seller discount larger than the list drives the computed sale negative, so the
    // snapshot assertion rejects the parcel and the recompute throws.
    const bad = await seedMelontikParcel({ lineSellerDiscountGrossA: '600.00' });
    await enqueueProfitRecompute(prisma, {
      organizationId: bad.organizationId,
      storeId: bad.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [bad.orderId],
    });

    const claimed = await claimProfitRecomputeRequests(prisma, { batchSize: 1 });
    expect(claimed).toHaveLength(1);
    const request = claimed[0];
    if (request === undefined) {
      throw new Error('expected a claimed request');
    }

    // A new request arrives while the claimed one is "being computed": clock_timestamp()
    // is millisecond-stored, so wait long enough that requested_at genuinely moves.
    await delay(10);
    await enqueueProfitRecompute(prisma, {
      organizationId: bad.organizationId,
      storeId: bad.storeId,
      reason: ProfitRecomputeReason.CLAIM_CHANGED,
      orderIds: [bad.orderId],
    });

    // The claimed computation fails, but the failure must not demote the newer request.
    const outcome = await processClaimedRecompute(prisma, request);
    expect(outcome).toBe('FAILED');

    // The failure UPDATE's requested_at guard no longer matches, so the fresh request
    // stays untouched: attempts 0, no error, claimable now.
    const row = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: bad.orderId },
    });
    if (row === null) {
      throw new Error('expected the re-requested row to survive');
    }
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
    expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row.reason).toBe(ProfitRecomputeReason.CLAIM_CHANGED);
  });

  it('lets two concurrent claims take disjoint requests', async () => {
    const parcel = await seedMelontikParcel();
    for (let i = 0; i < 9; i += 1) {
      await seedBareOrder({
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        orderDate: new Date(`2026-10-${(10 + i).toString()}T09:00:00Z`),
      });
    }
    const enqueued = await enqueueProfitRecomputeForStore(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.REFERENCE_CHANGED,
    });
    expect(enqueued).toBe(10);

    // A first "worker" claim-locks five rows exactly the way claimProfitRecomputeRequests
    // does and holds them in an open transaction. The Prisma client pools connections,
    // so the real claim below runs on a different connection, genuinely concurrent with
    // the held lock -- the only setup under which FOR UPDATE SKIP LOCKED is observable.
    const held = deferred<string[]>();
    const releaseGate = deferred<void>();
    const holder = prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM profit_recompute_queue
          WHERE next_attempt_at <= clock_timestamp()
          ORDER BY next_attempt_at, id
          LIMIT 5
          FOR UPDATE SKIP LOCKED`;
        held.resolve(rows.map((row) => row.id));
        await releaseGate.promise;
      },
      { maxWait: 15000, timeout: 30000 },
    );

    let claimPromise: Promise<ClaimedRecompute[]> | undefined;
    try {
      const heldIds = await held.promise;
      expect(heldIds).toHaveLength(5);

      // The real claim must take the five rows the holder did NOT lock. With SKIP
      // LOCKED it skips the locked five and settles fast; without it, it blocks on a
      // held row and never settles inside the window -- which fails the test.
      claimPromise = claimProfitRecomputeRequests(prisma, { batchSize: 10 });
      const settled = await Promise.race([
        claimPromise.then(
          (rows) => ({ kind: 'ok' as const, rows }),
          (error: unknown) => ({ kind: 'error' as const, error }),
        ),
        delay(CONCURRENT_CLAIM_WAIT_MS).then(() => ({ kind: 'timeout' as const })),
      ]);

      if (settled.kind === 'timeout') {
        throw new Error(
          'the claim blocked on a row held by another transaction: FOR UPDATE SKIP LOCKED is missing',
        );
      }
      if (settled.kind === 'error') {
        throw settled.error instanceof Error ? settled.error : new Error(String(settled.error));
      }

      const claimedIds = settled.rows.map((request) => request.id);
      const heldSet = new Set(heldIds);
      expect(claimedIds).toHaveLength(5);
      // Disjoint from the held five...
      expect(claimedIds.filter((id) => heldSet.has(id))).toEqual([]);
      // ...and together the two claims cover all ten requests exactly once.
      expect(new Set([...claimedIds, ...heldIds]).size).toBe(10);
    } finally {
      // Always release the holder and drain both, so a failed assertion never leaks
      // the held lock or hangs the suite on a pending transaction.
      releaseGate.resolve();
      await holder.catch(() => undefined);
      if (claimPromise !== undefined) {
        await claimPromise.catch(() => undefined);
      }
    }
  }, 30000);

  it('deletes the request of an order that no longer exists', async () => {
    const parcel = await seedMelontikParcel();
    await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [parcel.orderId],
    });

    const claimed = await claimProfitRecomputeRequests(prisma, { batchSize: 1 });
    const request = claimed[0];
    if (request === undefined) {
      throw new Error('expected a claimed request');
    }

    // The order is deleted between claim and process. The queue FK cascades, so the
    // request is already gone; the processor must still report ORDER_GONE and not throw.
    await prisma.order.delete({ where: { id: parcel.orderId } });

    const outcome = await processClaimedRecompute(prisma, request);
    expect(outcome).toBe('ORDER_GONE');
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);
  });

  it('drops the mark of an order whose platform the engine cannot compute', async () => {
    const parcel = await seedMelontikParcel();
    // The engine has no Hepsiburada writer yet; flip the store's platform so the
    // recompute throws UnsupportedPlatformError.
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: { platform: Platform.HEPSIBURADA },
    });
    await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [parcel.orderId],
    });

    const result = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(result.unsupported).toBe(1);
    expect(result.failed).toBe(0);

    // The mark is dropped (no backoff) and no statement was written for the order.
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);
    expect(await prisma.orderProfitStatement.count({ where: { orderId: parcel.orderId } })).toBe(0);
  });

  it('writes statements and drops the marks when a fee definition is missing on the order date', async () => {
    // Formerly FeeDefinitionNotFoundError: no statement at all (not even an excluded or a
    // cancelled one) and a mark retried forever. Now the missing definition is a blocking
    // REFERENCE_DATA_MISSING issue: every order gets its statement and its mark is deleted.
    // Exclusion and cancellation still win over the blocking issue.
    const open = await seedMelontikParcel();
    const excluded = await seedMelontikParcel();
    const cancelled = await seedMelontikParcel({ status: 'CANCELLED' });
    await prisma.order.update({
      where: { id: excluded.orderId },
      data: {
        profitExcludedAt: new Date(),
        profitExclusionReason: ProfitExclusionReason.COST_DEADLINE_MISSED,
      },
    });
    await prisma.feeDefinition.deleteMany({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE' },
    });
    for (const parcel of [open, excluded, cancelled]) {
      await enqueueProfitRecompute(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        reason: ProfitRecomputeReason.ORDER_CHANGED,
        orderIds: [parcel.orderId],
      });
    }

    const result = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(result.claimed).toBe(3);
    expect(result.changed).toBe(3);
    expect(result.failed).toBe(0);
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);

    const expectedStatus = new Map([
      [open.orderId, ProfitStatus.NOT_COMPUTABLE],
      [excluded.orderId, ProfitStatus.EXCLUDED],
      [cancelled.orderId, ProfitStatus.CANCELLED],
    ]);
    for (const [orderId, status] of expectedStatus) {
      const statements = await prisma.orderProfitStatement.findMany({ where: { orderId } });
      expect(statements.map((statement) => statement.view).sort()).toEqual([
        ProfitStatementView.BEST_KNOWN,
        ProfitStatementView.ESTIMATE,
      ]);
      for (const statement of statements) {
        expect(statement.status).toBe(status);
      }
    }

    const openBestKnown = await prisma.orderProfitStatement.findFirst({
      where: { orderId: open.orderId, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(openBestKnown?.netProfit).toBeNull();
    expect(parseStoredIssues(openBestKnown?.issues ?? null)).toContainEqual({
      code: ProfitIssueCode.REFERENCE_DATA_MISSING,
      orderItemId: null,
      detail: 'FEE:PLATFORM_SERVICE',
    });
  });

  it('does not sweep orders of a platform the engine cannot compute', async () => {
    const trendyol = await seedMelontikParcel();
    const hepsiStoreId = await createAdditionalStore({ organizationId: trendyol.organizationId });
    await prisma.store.update({
      where: { id: hepsiStoreId },
      data: { platform: Platform.HEPSIBURADA },
    });
    const hepsiOrderId = await seedBareOrder({
      organizationId: trendyol.organizationId,
      storeId: hepsiStoreId,
    });

    // Neither order has a statement, so both are sweep-eligible except for the platform
    // gate: only the Trendyol order may be queued.
    const swept = await enqueueStaleProfitStatements(prisma, { limit: 10 });
    expect(swept).toBe(1);
    expect(await queuedOrderIds()).toEqual([trendyol.orderId]);
    const hepsiRow = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: hepsiOrderId },
    });
    expect(hepsiRow).toBeNull();
  });
});

/** The test carrier the carrier gap test maps a new cargo name to (deleted after each test). */
const GAP_FILL_CARRIER = {
  code: 'TEST_QUEUE_GAP_FILL',
  externalId: 990_501,
  displayName: 'Test Queue Gap Fill Kargo',
} as const;

/** The cargo name no carrier claims until the carrier gap test maps it. */
const NEW_CARGO_NAME = 'Test Yeni Kargo Marketplace';

/** The same name in capitals with a Turkish dotted I: recognised through the normaliser. */
const NEW_CARGO_NAME_CAPITALS = 'TEST YENİ KARGO MARKETPLACE';

/** An instant well before any test row, for backdating the seeded fee definitions. */
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');

/** Upserts the gap-fill test carrier with a melontik-priced desi tariff and the given order names. */
function upsertGapFillCarrier(orderCargoNames: readonly string[]): Promise<string> {
  return upsertCarrierWithTariffs({
    ...GAP_FILL_CARRIER,
    orderCargoNames,
    desiRows: [
      { desi: 1, priceNet: MELONTIK.desiNet },
      { desi: 2, priceNet: MELONTIK.desiNet },
    ],
    baremRows: [],
  });
}

/** Seeds a melontik parcel whose order carries `cargoProviderName` (and the given flags). */
async function seedParcelWithCargoName(params: {
  readonly cargoProviderName: string;
  readonly status?: OrderStatus;
  readonly usesSellerCargoAgreement?: boolean;
}): Promise<MelontikParcel> {
  const parcel = await seedMelontikParcel(
    params.status === undefined ? {} : { status: params.status },
  );
  await prisma.order.update({
    where: { id: parcel.orderId },
    data: {
      cargoProviderName: params.cargoProviderName,
      usesSellerCargoAgreement: params.usesSellerCargoAgreement ?? false,
    },
  });
  return parcel;
}

/**
 * Enqueues and drains the given parcels, so every order is captured and gets its
 * statements. Asserts the queue is empty afterwards: a failed recompute would keep its
 * mark, and a queued order is never a sweep candidate, which would mask the filter under
 * test.
 */
async function computeParcels(parcels: readonly MelontikParcel[]): Promise<void> {
  for (const parcel of parcels) {
    await enqueueProfitRecompute(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      reason: ProfitRecomputeReason.ORDER_CHANGED,
      orderIds: [parcel.orderId],
    });
  }
  const result = await drainProfitRecomputeQueue(prisma, { batchSize: 50 });
  expect(result.failed).toBe(0);
  expect(await prisma.profitRecomputeRequest.count()).toBe(0);
}

/** The order's statement of one view; throws when it is missing. */
function readStatement(
  orderId: string,
  view: ProfitStatementView,
): Promise<{
  readonly status: ProfitStatus;
  readonly issues: Prisma.JsonValue;
  readonly updatedAt: Date;
}> {
  return prisma.orderProfitStatement.findUniqueOrThrow({
    where: { orderId_view: { orderId, view } },
    select: { status: true, issues: true, updatedAt: true },
  });
}

/** The issue codes of the order's best-known statement. */
async function bestKnownIssueCodes(orderId: string): Promise<ProfitIssueCode[]> {
  const statement = await readStatement(orderId, ProfitStatementView.BEST_KNOWN);
  return parseStoredIssues(statement.issues).map((issue) => issue.code);
}

/** A queue row's order, tenant scope and reason. */
interface QueueRow {
  readonly orderId: string;
  readonly organizationId: string;
  readonly storeId: string;
  readonly reason: ProfitRecomputeReason;
}

/** Orders queue rows by order id (plain code-unit compare, no locale collation). */
function byOrderId(a: QueueRow, b: QueueRow): number {
  if (a.orderId === b.orderId) {
    return 0;
  }
  return a.orderId < b.orderId ? -1 : 1;
}

/** Every queue row with its tenant scope and reason, ordered by order id. */
async function queueRows(): Promise<QueueRow[]> {
  const rows = await prisma.profitRecomputeRequest.findMany({
    select: { orderId: true, organizationId: true, storeId: true, reason: true },
  });
  return rows.sort(byOrderId);
}

/** The queue row a gap sweep should write for a parcel: the order's own tenant scope. */
function expectedGapRow(parcel: MelontikParcel): QueueRow {
  return {
    orderId: parcel.orderId,
    organizationId: parcel.organizationId,
    storeId: parcel.storeId,
    reason: ProfitRecomputeReason.REFERENCE_CHANGED,
  };
}

/** Creates a Trendyol platform service fee definition with an explicit creation instant. */
async function createPlatformServiceFee(params: {
  readonly effectiveFrom: Date;
  readonly createdAt: Date;
}): Promise<void> {
  await prisma.feeDefinition.create({
    data: {
      platform: 'TRENDYOL',
      feeType: 'PLATFORM_SERVICE',
      displayName: 'Platform Hizmet Bedeli',
      calculationKind: 'FIXED',
      fixedAmountNet: '10.99',
      defaultVatRate: '20.00',
      effectiveFrom: params.effectiveFrom,
      createdAt: params.createdAt,
    },
  });
}

describe('gap-fill sweeps', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(async () => {
    await prisma.shippingCarrier.deleteMany({
      where: { platform: Platform.TRENDYOL, code: GAP_FILL_CARRIER.code },
    });
  });

  it('enqueues only the waiting orders whose cargo name a carrier now claims, each in its own tenant scope', async () => {
    const gapCarrierId = await upsertGapFillCarrier([]);

    // Two waiting orders in two organizations; the second writes the name in capitals.
    const waitingA = await seedParcelWithCargoName({ cargoProviderName: NEW_CARGO_NAME });
    const waitingB = await seedParcelWithCargoName({ cargoProviderName: NEW_CARGO_NAME_CAPITALS });
    // Same name, but never a candidate: seller's own agreement, excluded, cancelled.
    const sellerAgreement = await seedParcelWithCargoName({
      cargoProviderName: NEW_CARGO_NAME,
      usesSellerCargoAgreement: true,
    });
    const excluded = await seedParcelWithCargoName({ cargoProviderName: NEW_CARGO_NAME });
    const cancelled = await seedParcelWithCargoName({
      cargoProviderName: NEW_CARGO_NAME,
      status: 'CANCELLED',
    });
    // Same name, never captured: no snapshot, so the regular producers own it.
    const uncaptured = await seedParcelWithCargoName({ cargoProviderName: NEW_CARGO_NAME });
    // A recognised carrier on the capture: never re-resolved.
    const recognised = await seedMelontikParcel();

    await computeParcels([waitingA, waitingB, sellerAgreement, excluded, cancelled, recognised]);
    await prisma.order.update({
      where: { id: excluded.orderId },
      data: {
        profitExcludedAt: new Date(),
        profitExclusionReason: ProfitExclusionReason.COST_DEADLINE_MISSED,
      },
    });

    for (const parcel of [waitingA, waitingB]) {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: parcel.orderId },
        select: { snapshotCarrierId: true, profitSnapshotAt: true },
      });
      expect(order.snapshotCarrierId).toBeNull();
      expect(order.profitSnapshotAt).not.toBeNull();
      const bestKnown = await readStatement(parcel.orderId, ProfitStatementView.BEST_KNOWN);
      expect(bestKnown.status).toBe(ProfitStatus.NOT_COMPUTABLE);
      expect(await bestKnownIssueCodes(parcel.orderId)).toContain(
        ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
      );
    }

    // No carrier claims the name yet: nothing to fill.
    expect(await enqueueCarrierGapRecomputes(prisma, { limit: 10 })).toBe(0);
    expect(await queueRows()).toEqual([]);

    // The name is mapped to a carrier: only the two waiting orders are enqueued, each
    // with its own organization and store. The uncaptured, seller-agreement, excluded,
    // cancelled and recognised orders stay out.
    await upsertGapFillCarrier([NEW_CARGO_NAME]);
    expect(await enqueueCarrierGapRecomputes(prisma, { limit: 10 })).toBe(2);
    const queued = await queueRows();
    expect(queued).toEqual([expectedGapRow(waitingA), expectedGapRow(waitingB)].sort(byOrderId));
    expect(queued.map((row) => row.orderId)).not.toContain(uncaptured.orderId);

    // The drain recognises the carrier on the capture and the order becomes computable.
    const drained = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(drained).toMatchObject({ claimed: 2, changed: 2, failed: 0 });
    for (const parcel of [waitingA, waitingB]) {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: parcel.orderId },
        select: { snapshotCarrierId: true },
      });
      expect(order.snapshotCarrierId).toBe(gapCarrierId);
      for (const view of [ProfitStatementView.BEST_KNOWN, ProfitStatementView.ESTIMATE]) {
        const statement = await readStatement(parcel.orderId, view);
        expect(statement.status).not.toBe(ProfitStatus.NOT_COMPUTABLE);
      }
    }

    // Filled orders leave the candidates: the next sweep finds nothing.
    expect(await enqueueCarrierGapRecomputes(prisma, { limit: 10 })).toBe(0);
  });

  it('honours the limit of the carrier gap sweep', async () => {
    await upsertGapFillCarrier([]);
    const first = await seedParcelWithCargoName({ cargoProviderName: NEW_CARGO_NAME });
    const second = await seedParcelWithCargoName({ cargoProviderName: NEW_CARGO_NAME });
    await computeParcels([first, second]);
    await upsertGapFillCarrier([NEW_CARGO_NAME]);

    expect(await enqueueCarrierGapRecomputes(prisma, { limit: 1 })).toBe(1);
    expect(await enqueueCarrierGapRecomputes(prisma, { limit: 1 })).toBe(1);
    expect((await queueRows()).map((row) => row.orderId).sort()).toEqual(
      [first.orderId, second.orderId].sort(),
    );
  });

  it('re-enqueues an order missing reference data once per newer definition, until it is filled', async () => {
    // Every parcel is seeded before the definition is deleted: a later seed would put
    // it back.
    const open = await seedMelontikParcel();
    const excluded = await seedMelontikParcel();
    const cancelled = await seedMelontikParcel({ status: 'CANCELLED' });
    await prisma.order.update({
      where: { id: excluded.orderId },
      data: {
        profitExcludedAt: new Date(),
        profitExclusionReason: ProfitExclusionReason.COST_DEADLINE_MISSED,
      },
    });
    await prisma.feeDefinition.deleteMany({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE' },
    });
    // The remaining definitions predate every statement, whatever the clocks say.
    await prisma.feeDefinition.updateMany({ data: { createdAt: LONG_AGO } });
    await computeParcels([open, excluded, cancelled]);

    expect(await bestKnownIssueCodes(open.orderId)).toContain(
      ProfitIssueCode.REFERENCE_DATA_MISSING,
    );
    const written = await readStatement(open.orderId, ProfitStatementView.BEST_KNOWN);
    expect(written.status).toBe(ProfitStatus.NOT_COMPUTABLE);

    // No definition newer than the statement: nothing to fill.
    expect(await enqueueReferenceDataGapRecomputes(prisma, { limit: 10 })).toBe(0);

    // A definition that does not cover the order date (it starts later): the order is
    // taken once, recomputed without change, and not taken again.
    await createPlatformServiceFee({
      effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      createdAt: new Date(written.updatedAt.getTime() + 1000),
    });
    expect(await enqueueReferenceDataGapRecomputes(prisma, { limit: 10 })).toBe(1);
    expect(await queueRows()).toEqual([expectedGapRow(open)]);
    const unchanged = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(unchanged).toMatchObject({ claimed: 1, unchanged: 1, failed: 0 });
    expect(await enqueueReferenceDataGapRecomputes(prisma, { limit: 10 })).toBe(0);

    // A definition that covers the order date: taken once, the order becomes computable,
    // and it is not taken again.
    const rechecked = await readStatement(open.orderId, ProfitStatementView.BEST_KNOWN);
    expect(rechecked.status).toBe(ProfitStatus.NOT_COMPUTABLE);
    await createPlatformServiceFee({
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
      createdAt: new Date(rechecked.updatedAt.getTime() + 1000),
    });
    expect(await enqueueReferenceDataGapRecomputes(prisma, { limit: 10 })).toBe(1);
    expect(await queueRows()).toEqual([expectedGapRow(open)]);
    const filled = await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(filled).toMatchObject({ claimed: 1, changed: 1, failed: 0 });
    const bestKnown = await readStatement(open.orderId, ProfitStatementView.BEST_KNOWN);
    expect(bestKnown.status).not.toBe(ProfitStatus.NOT_COMPUTABLE);
    expect(await bestKnownIssueCodes(open.orderId)).not.toContain(
      ProfitIssueCode.REFERENCE_DATA_MISSING,
    );
    expect(await enqueueReferenceDataGapRecomputes(prisma, { limit: 10 })).toBe(0);
  });
});
