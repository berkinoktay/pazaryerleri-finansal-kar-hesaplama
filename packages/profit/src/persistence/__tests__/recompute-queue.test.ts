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

import { prisma } from '@pazarsync/db';
import {
  Platform,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PROFIT_ENGINE_VERSION } from '../../core/engine-version';
import {
  type ClaimedRecompute,
  claimProfitRecomputeRequests,
  drainProfitRecomputeQueue,
  enqueueProfitRecompute,
  enqueueProfitRecomputeForBarcodes,
  enqueueProfitRecomputeForStore,
  enqueueProfitRecomputeForVariants,
  enqueueStaleProfitStatements,
  processClaimedRecompute,
} from '../recompute-queue';
import {
  createAdditionalStore,
  ensureDbReachable,
  MELONTIK,
  seedBareOrder,
  seedMelontikParcel,
  truncateAll,
} from './helpers/melontik-parcel';

/** Resolves after `ms`, used to force two clock_timestamp() values onto different ms. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

/** The window a disjoint claim gets before we treat it as blocked on a held lock. */
const CONCURRENT_CLAIM_WAIT_MS = 8000;

/** A promise with its resolver exposed, to coordinate the concurrent-claim holder. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

/** Builds a Deferred; the executor runs synchronously, so `resolve` is always set. */
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
      commissionRate: '19',
      commissionGross: '0',
      commissionVatRate: '20',
    },
  });
}

/** Adds one order item carrying just a barcode (no variant), for the barcode-scope tests. */
async function addOrderItemWithBarcode(params: {
  readonly orderId: string;
  readonly organizationId: string;
  readonly barcode: string;
}): Promise<void> {
  await prisma.orderItem.create({
    data: {
      orderId: params.orderId,
      organizationId: params.organizationId,
      quantity: 1,
      barcode: params.barcode,
      commissionRate: '19',
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

  describe('enqueueProfitRecomputeForBarcodes', () => {
    it('queues the store order whose item carries a listed barcode, with the reason', async () => {
      const parcel = await seedMelontikParcel();

      const count = await enqueueProfitRecomputeForBarcodes(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        reason: ProfitRecomputeReason.REFERENCE_CHANGED,
        barcodes: [MELONTIK.items.a.barcode],
      });

      expect(count).toBe(1);
      expect(await queuedOrderIds()).toEqual([parcel.orderId]);
      const row = await prisma.profitRecomputeRequest.findUnique({
        where: { orderId: parcel.orderId },
      });
      expect(row?.reason).toBe(ProfitRecomputeReason.REFERENCE_CHANGED);
    });

    it('does not queue a sibling store order of the same organization carrying the barcode', async () => {
      const parcel = await seedMelontikParcel();
      const siblingStoreId = await createAdditionalStore({ organizationId: parcel.organizationId });
      const siblingOrderId = await seedBareOrder({
        organizationId: parcel.organizationId,
        storeId: siblingStoreId,
      });
      await addOrderItemWithBarcode({
        orderId: siblingOrderId,
        organizationId: parcel.organizationId,
        barcode: MELONTIK.items.a.barcode,
      });

      const count = await enqueueProfitRecomputeForBarcodes(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        reason: ProfitRecomputeReason.REFERENCE_CHANGED,
        barcodes: [MELONTIK.items.a.barcode],
      });

      expect(count).toBe(1);
      expect(await queuedOrderIds()).toEqual([parcel.orderId]);
      const siblingRow = await prisma.profitRecomputeRequest.findUnique({
        where: { orderId: siblingOrderId },
      });
      expect(siblingRow).toBeNull();
    });

    it('does not queue another organization order carrying the same barcode', async () => {
      const parcel = await seedMelontikParcel();
      // A second organization whose variant carries the same barcode string.
      const other = await seedMelontikParcel();

      const count = await enqueueProfitRecomputeForBarcodes(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        reason: ProfitRecomputeReason.REFERENCE_CHANGED,
        barcodes: [MELONTIK.items.a.barcode],
      });

      expect(count).toBe(1);
      expect(await queuedOrderIds()).toEqual([parcel.orderId]);
      const otherRow = await prisma.profitRecomputeRequest.findUnique({
        where: { orderId: other.orderId },
      });
      expect(otherRow).toBeNull();
    });

    it('leaves out an order of the store whose items carry none of the barcodes', async () => {
      const parcel = await seedMelontikParcel();
      const otherOrderId = await seedBareOrder({
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
      });
      await addOrderItemWithBarcode({
        orderId: otherOrderId,
        organizationId: parcel.organizationId,
        barcode: 'bc-unrelated',
      });

      const count = await enqueueProfitRecomputeForBarcodes(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        reason: ProfitRecomputeReason.REFERENCE_CHANGED,
        barcodes: [MELONTIK.items.a.barcode],
      });

      expect(count).toBe(1);
      expect(await queuedOrderIds()).toEqual([parcel.orderId]);
    });

    it('returns 0 and writes no row for an empty barcode list', async () => {
      const parcel = await seedMelontikParcel();

      const count = await enqueueProfitRecomputeForBarcodes(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        reason: ProfitRecomputeReason.REFERENCE_CHANGED,
        barcodes: [],
      });

      expect(count).toBe(0);
      expect(await queuedOrderIds()).toEqual([]);
    });
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
