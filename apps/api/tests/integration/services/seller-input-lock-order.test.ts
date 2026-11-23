/**
 * Lock-order guard for the seller-input writers (same-day edit window, plan P1-13;
 * notes D11 and G6). No seller-input writer locks or writes an order_items row: while
 * another transaction holds an order_items row lock, a desi write, a cost PATCH and a
 * cost detach for that item's variant each commit without waiting. The enqueue reads
 * order_items with a plain EXISTS (no lock), which a row lock never blocks.
 *
 * Green today as well; it exists to fail the day someone adds an order_items lock or
 * write to a writer, which would re-open the deadlock cycle with order intake
 * (orders row -> order_items -> product_variants).
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';

import { postgresSqlState } from '@/lib/postgres-sql-state';
import { detachCostProfiles } from '@/services/cost-profile-attachment.service';
import { createCostProfile, updateCostProfile } from '@/services/cost-profile.service';
import { setDimensionalWeight } from '@/services/product-variant.service';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
  createUserProfile,
} from '../../helpers/factories';

/** A writer that has not committed by then is waiting on the held row lock. */
const WRITER_DEADLINE_MS = 3_000;
/** The holder transaction's own timeout: well past every wait in the test. */
const HOLDER_TIMEOUT_MS = 30_000;
/** Postgres SQLSTATE lock_not_available: a NOWAIT lock request met a held lock. */
const LOCK_NOT_AVAILABLE = '55P03';

interface HeldRowLock {
  /** The backend pid of the holder transaction. */
  readonly pid: number;
  /** Commits the holder transaction, which releases the row lock. */
  readonly release: () => Promise<void>;
}

/**
 * Takes `SELECT ... FOR UPDATE` on one order_items row in another transaction and keeps
 * that transaction open until `release`.
 */
async function holdOrderItemRowLock(organizationId: string, itemId: string): Promise<HeldRowLock> {
  let signalLocked: (pid: number) => void = () => undefined;
  const locked = new Promise<number>((resolve) => {
    signalLocked = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM order_items
         WHERE id = ${itemId}::uuid AND organization_id = ${organizationId}::uuid
         FOR UPDATE`;
      if (rows.length !== 1) {
        throw new Error('the order item to lock was not found');
      }
      const backend = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      signalLocked(backend[0]?.pid ?? -1);
      await released;
    },
    { timeout: HOLDER_TIMEOUT_MS },
  );
  try {
    const pid = await Promise.race([
      locked,
      holder.then(() => {
        throw new Error('the lock holder ended before it took the row lock');
      }),
    ]);
    return {
      pid,
      release: async () => {
        release();
        await holder;
      },
    };
  } catch (err) {
    // Ends the holder before the next test truncates; the first failure is the one reported.
    release();
    await holder.catch(() => undefined);
    throw err;
  }
}

/** Granted row-share locks the holder pid has on order_items (a `FOR UPDATE` takes one). */
async function orderItemRowShareLocks(pid: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ held: number }>>`
    SELECT count(*)::int AS held
      FROM pg_locks
     WHERE pid = ${pid}
       AND locktype = 'relation'
       AND relation = 'order_items'::regclass
       AND mode = 'RowShareLock'
       AND granted`;
  return rows[0]?.held ?? 0;
}

/** The SQLSTATE a `FOR UPDATE NOWAIT` on the item meets from a third connection, or null. */
async function nowaitLockSqlState(organizationId: string, itemId: string): Promise<string | null> {
  try {
    await prisma.$queryRaw`
      SELECT id FROM order_items
       WHERE id = ${itemId}::uuid AND organization_id = ${organizationId}::uuid
       FOR UPDATE NOWAIT`;
    return null;
  } catch (err) {
    return postgresSqlState(err);
  }
}

/** True when `work` settles within `ms`; false when it is still pending then. */
async function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([work.then(() => true), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function queuedReason(
  organizationId: string,
  orderId: string,
): Promise<ProfitRecomputeReason | undefined> {
  const request = await prisma.profitRecomputeRequest.findFirst({
    where: { organizationId, orderId },
    select: { reason: true },
  });
  return request?.reason;
}

async function clearQueue(organizationId: string, orderId: string): Promise<void> {
  await prisma.profitRecomputeRequest.deleteMany({ where: { organizationId, orderId } });
}

describe('seller-input writers never wait on an order_items row lock (D11, G6)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('a desi write, a cost PATCH and a cost detach commit while another transaction holds an order_items row lock', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const product = await createProduct(org.id, store.id);
    const variant = await createProductVariant(org.id, store.id, product.id);
    const profile = await createCostProfile(
      org.id,
      {
        name: 'Lock order COGS',
        type: 'COGS',
        amountGross: '25.50',
        vatRate: 20,
        storeId: store.id,
      },
      user.id,
    );
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
    });
    // A non-final order carrying the variant: every writer below reaches it through
    // the queue, so each one reads the item's table while its row is locked.
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(order.id, org.id, { productVariantId: variant.id });

    const held = await holdOrderItemRowLock(org.id, item.id);
    const writers: Promise<unknown>[] = [];
    try {
      // Positive control: the row lock is really held, seen in pg_locks and by a
      // third connection whose NOWAIT request is refused.
      expect(await orderItemRowShareLocks(held.pid)).toBe(1);
      expect(await nowaitLockSqlState(org.id, item.id)).toBe(LOCK_NOT_AVAILABLE);

      const desiWrite = setDimensionalWeight({
        organizationId: org.id,
        storeId: store.id,
        variantId: variant.id,
        value: '2.50',
      });
      writers.push(desiWrite);
      expect(await settlesWithin(desiWrite, WRITER_DEADLINE_MS)).toBe(true);
      await desiWrite;
      expect(await queuedReason(org.id, order.id)).toBe(ProfitRecomputeReason.DESI_CHANGED);
      await clearQueue(org.id, order.id);

      const costPatch = updateCostProfile(org.id, profile.id, { amountGross: '30.00' }, user.id);
      writers.push(costPatch);
      expect(await settlesWithin(costPatch, WRITER_DEADLINE_MS)).toBe(true);
      await costPatch;
      expect(await queuedReason(org.id, order.id)).toBe(ProfitRecomputeReason.COST_CHANGED);
      await clearQueue(org.id, order.id);

      // Last: the detach removes the link the PATCH above needs to reach the order.
      const costDetach = detachCostProfiles(org.id, [profile.id], [variant.id], null);
      writers.push(costDetach);
      expect(await settlesWithin(costDetach, WRITER_DEADLINE_MS)).toBe(true);
      expect(await costDetach).toEqual({ detached: 1 });
      expect(await queuedReason(org.id, order.id)).toBe(ProfitRecomputeReason.COST_CHANGED);

      // The three writers committed while the row lock was still held.
      expect(await nowaitLockSqlState(org.id, item.id)).toBe(LOCK_NOT_AVAILABLE);
    } finally {
      // Release first, then drain every writer, so no transaction outlives the test.
      await held.release();
      await Promise.allSettled(writers);
    }
  });
});
