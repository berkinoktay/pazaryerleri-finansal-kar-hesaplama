// The upload quota's queries against the real tables, inside a transaction as the
// import runs them: the stored bytes of a store over all six workbook parent tables,
// never another organization's or a sibling store's, and the two limits. And the store
// quota lock: a quota check waits while another transaction holds the store's lock, then
// counts the bytes that transaction committed; another store's lock never makes it wait.

import { z } from '@hono/zod-openapi';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma, type Prisma } from '@pazarsync/db';

import { ImportBusyError, WorkbookConflictError } from '@/lib/errors';
import type { StoreScope } from '@/workbooks/adapter';
import {
  acquireStoreQuotaLock,
  assertUploadQuota,
  quotaLockKey,
  storedUploadBytes,
  storedUploadBytesSql,
  WORKBOOK_PARENT_TABLES,
  WORKBOOK_QUOTA_LOCK_SEED,
} from '@/workbooks/upload-quota';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore } from '../../helpers/factories';

// A distinct byte length per table, so a table the sum misses changes the total.
const BYTES_PER_TABLE = {
  commission_tariffs: 11,
  plus_commission_tariffs: 23,
  advantage_tariffs: 37,
  flash_product_lists: 41,
  discount_lists: 53,
  marketplace_campaign_lists: 67,
} as const;
const TOTAL_BYTES = Object.values(BYTES_PER_TABLE).reduce((sum, n) => sum + n, 0);

const LIMITS = { maxLists: 3, maxBytes: 1000 } as const;

// The lock tests: a peer import's file and an incoming file that each fit the byte limit
// alone and cross it together.
const PEER_BYTES = 600;
const INCOMING_BYTES = 500;

// The holder transaction outlives the waiter's poll; Prisma's default 5 s could end it
// while the test still needs the lock held.
const LOCK_HOLDER_TIMEOUT_MS = 60_000;
// A waiter that never gets the lock fails at this bound, short of the test timeout.
const LOCK_WAITER_TIMEOUT_MS = 10_000;
// How often, and how many times, the test polls pg_locks for a waiting transaction.
const LOCK_WAIT_POLL_INTERVAL_MS = 25;
const LOCK_WAIT_MAX_POLLS = 200;
// A lock wait bound short enough that the waiter gives up while the holder still holds
// the lock.
const SHORT_LOCK_TIMEOUT_MS = 300;

const LockTimeoutSchema = z.array(z.object({ lockTimeout: z.string() }));

/** The transaction's current lock_timeout, as Postgres prints it. */
async function lockTimeoutOf(tx: Prisma.TransactionClient): Promise<string> {
  const rows = LockTimeoutSchema.parse(
    await tx.$queryRaw`SELECT current_setting('lock_timeout') AS "lockTimeout"`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('current_setting returned no row');
  return row.lockTimeout;
}

const LockCountSchema = z.array(z.object({ locks: z.number() }));

function bytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(1);
}

/** One parent row per table for `scope`, each with its table's byte length. */
async function seedEveryTable(scope: StoreScope): Promise<void> {
  const base = { ...scope, name: 'Seeded' };
  await prisma.commissionTariff.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.commission_tariffs) },
  });
  await prisma.plusCommissionTariff.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.plus_commission_tariffs) },
  });
  await prisma.advantageTariff.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.advantage_tariffs) },
  });
  await prisma.flashProductList.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.flash_product_lists) },
  });
  await prisma.discountList.create({
    data: {
      ...base,
      discountType: 'NET',
      sourceFile: bytes(BYTES_PER_TABLE.discount_lists),
    },
  });
  await prisma.marketplaceCampaignList.create({
    data: {
      ...base,
      discountType: 'NET',
      sourceFile: bytes(BYTES_PER_TABLE.marketplace_campaign_lists),
    },
  });
}

/** One discount list holding `length` stored bytes. */
async function seedDiscountBytes(scope: StoreScope, length: number): Promise<void> {
  await prisma.discountList.create({
    data: { ...scope, name: 'Seeded', discountType: 'NET', sourceFile: bytes(length) },
  });
}

async function newScope(organizationId?: string): Promise<StoreScope> {
  const orgId = organizationId ?? (await createOrganization()).id;
  const store = await createStore(orgId);
  return { organizationId: orgId, storeId: store.id };
}

function storedBytes(scope: StoreScope): Promise<number> {
  return prisma.$transaction((tx) => storedUploadBytes(tx, scope));
}

async function quotaReason(
  scope: StoreScope,
  input: { listCount: number; incomingBytes: number },
): Promise<string | null> {
  try {
    await prisma.$transaction((tx) => assertUploadQuota(tx, scope, input, LIMITS));
    return null;
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.reason;
    throw err;
  }
}

/** The meta of the quota refusal, or null when the quota passes. */
async function quotaMeta(
  scope: StoreScope,
  input: { listCount: number; incomingBytes: number },
): Promise<Readonly<Record<string, string | number>> | null> {
  try {
    await prisma.$transaction((tx) => assertUploadQuota(tx, scope, input, LIMITS));
    return null;
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.meta;
    throw err;
  }
}

// The store quota lock, held by another transaction.

/** How a quota check under the store quota lock ended; it never rejects. */
type LockedQuotaOutcome =
  | { readonly kind: 'passed' }
  | {
      readonly kind: 'refused';
      readonly reason: string;
      readonly meta: Readonly<Record<string, string | number>>;
    }
  | { readonly kind: 'failed'; readonly error: unknown };

/**
 * One transaction as the import runs it: the store quota lock, then the quota with no
 * list yet on the page. Settles to its outcome instead of rejecting, so it can be
 * started without an await and never leaves an unhandled rejection.
 */
async function quotaUnderLock(
  scope: StoreScope,
  incomingBytes: number,
): Promise<LockedQuotaOutcome> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await acquireStoreQuotaLock(tx, scope);
        await assertUploadQuota(tx, scope, { listCount: 0, incomingBytes }, LIMITS);
      },
      { timeout: LOCK_WAITER_TIMEOUT_MS },
    );
    return { kind: 'passed' };
  } catch (err) {
    if (err instanceof WorkbookConflictError) {
      return { kind: 'refused', reason: err.reason, meta: err.meta };
    }
    return { kind: 'failed', error: err };
  }
}

/** The advisory locks on the store quota key of `scope` in this database, granted or waiting. */
async function quotaLockCount(scope: StoreScope, granted: boolean): Promise<number> {
  const key = quotaLockKey(scope);
  const rows = LockCountSchema.parse(
    await prisma.$queryRaw`
      WITH "h" AS (SELECT hashtextextended(${key}, ${WORKBOOK_QUOTA_LOCK_SEED}::int8) AS "v")
      SELECT count(*)::int AS "locks"
      FROM pg_locks, "h"
      WHERE locktype = 'advisory'
        AND granted = ${granted}
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid::bigint = (("h"."v" >> 32) & 4294967295)
        AND objid::bigint = ("h"."v" & 4294967295)
        AND objsubid = 1`,
  );
  return rows[0]?.locks ?? 0;
}

/**
 * Polls pg_locks until one transaction waits for the store quota lock of `scope`, and
 * fails after LOCK_WAIT_MAX_POLLS polls. The pause between polls is not the proof; the
 * lock row that is not granted is.
 */
async function expectQuotaLockWaiter(scope: StoreScope): Promise<void> {
  for (let poll = 0; poll < LOCK_WAIT_MAX_POLLS; poll += 1) {
    const waiting = await quotaLockCount(scope, false);
    if (waiting > 0) {
      expect(waiting).toBe(1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_INTERVAL_MS));
  }
  throw new Error(`No transaction waited for the store quota lock in ${LOCK_WAIT_MAX_POLLS} polls`);
}

interface HeldQuotaLock {
  /** Commits the holder transaction, which releases the lock. */
  readonly release: () => Promise<void>;
}

/**
 * Takes ONLY the store quota lock of `scope` in another transaction (the same SQL and
 * seed as the import), runs `inside` there uncommitted, and resolves once both are done.
 * The transaction stays open until `release`.
 */
async function holdQuotaLock(
  scope: StoreScope,
  inside: (tx: Prisma.TransactionClient) => Promise<void> = async () => undefined,
): Promise<HeldQuotaLock> {
  const key = quotaLockKey(scope);
  let signalLocked: () => void = () => undefined;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${WORKBOOK_QUOTA_LOCK_SEED}::int8))`;
      await inside(tx);
      signalLocked();
      await released;
    },
    { timeout: LOCK_HOLDER_TIMEOUT_MS },
  );
  try {
    await Promise.race([
      locked,
      holder.then(() => {
        throw new Error('The lock holder ended before it took the lock');
      }),
    ]);
    expect(await quotaLockCount(scope, true)).toBe(1);
  } catch (err) {
    // Ends the holder before the next test truncates; the first failure is the one reported.
    release();
    await holder.catch(() => undefined);
    throw err;
  }
  return {
    release: async () => {
      release();
      await holder;
    },
  };
}

/**
 * Starts the quota under the store quota lock while `holder` holds it, polls until that
 * transaction waits for the lock, then releases the holder and returns the outcome. The
 * holder is released and the waiter settled on every path, so no transaction outlives
 * the test.
 */
async function quotaAfterRelease(
  holder: HeldQuotaLock,
  scope: StoreScope,
  incomingBytes: number,
): Promise<LockedQuotaOutcome> {
  const waiter = quotaUnderLock(scope, incomingBytes);
  try {
    await expectQuotaLockWaiter(scope);
  } finally {
    await holder.release();
    await waiter;
  }
  return waiter;
}

describe('storedUploadBytes', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sums the stored source bytes of every workbook table of the store', async () => {
    const scope = await newScope();
    await seedEveryTable(scope);

    expect(await storedBytes(scope)).toBe(TOTAL_BYTES);
  });

  it('is 0 for a store with no stored file', async () => {
    expect(await storedBytes(await newScope())).toBe(0);
  });

  it("never counts another organization's or a sibling store's rows, in any table", async () => {
    const scope = await newScope();
    const sibling = await newScope(scope.organizationId);
    const foreign = await newScope();
    await seedEveryTable(scope);
    await seedEveryTable(sibling);
    await seedEveryTable(foreign);

    expect(await storedBytes(scope)).toBe(TOTAL_BYTES);
    expect(await storedBytes(sibling)).toBe(TOTAL_BYTES);
    expect(await storedBytes(foreign)).toBe(TOTAL_BYTES);
  });

  it('names exactly the six workbook parent tables in its query', () => {
    const sql = storedUploadBytesSql({ organizationId: 'org', storeId: 'store' }).sql;
    const tables = [...sql.matchAll(/FROM "([a-z_]+)"/g)].map((match) => match[1]);

    expect(tables).toEqual([...WORKBOOK_PARENT_TABLES]);
  });
});

describe('assertUploadQuota', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('passes a file that fills the byte limit exactly', async () => {
    const scope = await newScope();
    await seedDiscountBytes(scope, 900);

    expect(await quotaReason(scope, { listCount: 1, incomingBytes: 100 })).toBeNull();
  });

  it('refuses the file that would cross the byte limit', async () => {
    const scope = await newScope();
    await seedDiscountBytes(scope, 900);

    expect(await quotaReason(scope, { listCount: 1, incomingBytes: 101 })).toBe(
      'UPLOAD_QUOTA_EXCEEDED',
    );
    expect(await quotaMeta(scope, { listCount: 1, incomingBytes: 101 })).toEqual({
      limit: 'bytes',
      maxBytes: LIMITS.maxBytes,
    });
  });

  it('refuses a list once the page holds the maximum number of lists', async () => {
    const scope = await newScope();

    expect(await quotaReason(scope, { listCount: LIMITS.maxLists, incomingBytes: 1 })).toBe(
      'UPLOAD_QUOTA_EXCEEDED',
    );
    expect(await quotaMeta(scope, { listCount: LIMITS.maxLists, incomingBytes: 1 })).toEqual({
      limit: 'lists',
      maxLists: LIMITS.maxLists,
    });
    expect(
      await quotaReason(scope, { listCount: LIMITS.maxLists - 1, incomingBytes: 1 }),
    ).toBeNull();
  });

  it("does not count another store's bytes", async () => {
    const scope = await newScope();
    await seedDiscountBytes(scope, 900);
    await seedDiscountBytes(await newScope(scope.organizationId), 5000);
    await seedDiscountBytes(await newScope(), 5000);

    expect(await quotaReason(scope, { listCount: 1, incomingBytes: 100 })).toBeNull();
  });
});

describe('acquireStoreQuotaLock', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("waits for a peer import's lock, then counts the bytes the peer committed", async () => {
    const scope = await newScope();
    // A peer import of another page: its list is written but not committed yet.
    const holder = await holdQuotaLock(scope, async (tx) => {
      await tx.discountList.create({
        data: { ...scope, name: 'Peer', discountType: 'NET', sourceFile: bytes(PEER_BYTES) },
      });
    });

    const outcome = await quotaAfterRelease(holder, scope, INCOMING_BYTES);

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'UPLOAD_QUOTA_EXCEEDED',
      meta: { limit: 'bytes', maxBytes: LIMITS.maxBytes },
    });
  });

  it('passes the same file with no holder and no peer (control)', async () => {
    const scope = await newScope();

    expect(await quotaUnderLock(scope, INCOMING_BYTES)).toEqual({ kind: 'passed' });
  });

  // Prisma's transaction timeout cancels no running statement, so the wait is bounded on
  // the server: past lock_timeout the waiter answers the retryable IMPORT_BUSY at once,
  // while the holder still holds the lock, and leaves the lock queue.
  it('answers IMPORT_BUSY past its lock wait bound while the holder still holds the lock', async () => {
    const scope = await newScope();
    const holder = await holdQuotaLock(scope);

    try {
      const error = await prisma
        .$transaction(
          async (tx) => {
            await acquireStoreQuotaLock(tx, scope, SHORT_LOCK_TIMEOUT_MS);
          },
          { timeout: LOCK_WAITER_TIMEOUT_MS },
        )
        .then(
          (): unknown => null,
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(ImportBusyError);
      expect(await quotaLockCount(scope, true)).toBe(1);
      expect(await quotaLockCount(scope, false)).toBe(0);
    } finally {
      await holder.release();
    }
  });

  it('gives the rest of the transaction its default lock_timeout back', async () => {
    const scope = await newScope();

    const [before, after] = await prisma.$transaction(async (tx) => {
      const defaultTimeout = await lockTimeoutOf(tx);
      await acquireStoreQuotaLock(tx, scope, SHORT_LOCK_TIMEOUT_MS);
      return [defaultTimeout, await lockTimeoutOf(tx)];
    });

    expect(after).toBe(before);
  });

  it("never waits for another store's lock", async () => {
    const held = await newScope();
    const sibling = await newScope(held.organizationId);
    const holder = await holdQuotaLock(held);

    try {
      // Awaited while the holder still holds the first store's lock.
      expect(await quotaUnderLock(sibling, INCOMING_BYTES)).toEqual({ kind: 'passed' });
      expect(await quotaLockCount(held, true)).toBe(1);
    } finally {
      await holder.release();
    }
  });
});
