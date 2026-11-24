/**
 * Integration tests for the settled cutoff (same-day edit window, plan P1-14; notes
 * B4). A business day's seller inputs are settled once the database clock is at or
 * past its end T plus SELLER_INPUT_SETTLE_MS and no other client backend of this
 * database still has a transaction open that began before T (+ 1 ms, for the
 * millisecond rounding of the stamps). A session whose activity the reader's role
 * cannot see counts as open (fail closed). Past the cap an open transaction no longer
 * holds the cutoff back and the result is forced.
 *
 * The day end under test is a business-day start at least one day ahead (`futureDayStart`),
 * injected through `dbNow`: every transaction a test opens began before it, so no case
 * can straddle a real midnight.
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { randomUUID } from 'node:crypto';

import { prisma, type Prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';
import {
  getBusinessDayRange,
  previousDayStart,
  SELLER_INPUT_SETTLE_CAP_MS,
  SELLER_INPUT_SETTLE_MS,
} from '@pazarsync/utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findTransactionsOpenSince,
  readDbNow,
  resetSettledCutoffMemo,
  resolveSettledCutoff,
  type OpenWriter,
} from '../db-clock';
import { deferred } from './helpers/concurrency';
import { ensureDbReachable } from './helpers/melontik-parcel';

const ONE_DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Europe/Istanbul is UTC+3 all year (no daylight saving time). */
const ISTANBUL_OFFSET_MS = 3 * HOUR_MS;
/** The holder transaction's own timeout: well past every step of a test. */
const HOLDER_TIMEOUT_MS = 30_000;

/** A business-day start at least one day after now: later than any transaction a test opens. */
function futureDayStart(): Date {
  return getBusinessDayRange(new Date(Date.now() + ONE_DAY_MS)).end;
}

function shift(instant: Date, ms: number): Date {
  return new Date(instant.getTime() + ms);
}

function pidsOf(writers: readonly OpenWriter[]): number[] {
  return writers.map((writer) => writer.pid);
}

interface HeldTransaction {
  /** The backend pid of the held transaction. */
  readonly pid: number;
  /** Commits the held transaction. */
  readonly release: () => Promise<void>;
}

/**
 * Opens a transaction on another pooled connection, runs one statement in it (its
 * pg_backend_pid) and keeps it open until `release`.
 */
async function holdOpenTransaction(): Promise<HeldTransaction> {
  const started = deferred<number>();
  const released = deferred<void>();
  const holder = prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      started.resolve(rows[0]?.pid ?? -1);
      await released.promise;
    },
    { timeout: HOLDER_TIMEOUT_MS },
  );
  try {
    const pid = await Promise.race([
      started.promise,
      holder.then(() => {
        throw new Error('the held transaction ended before it started');
      }),
    ]);
    return {
      pid,
      release: async () => {
        released.resolve();
        await holder;
      },
    };
  } catch (err) {
    released.resolve();
    await holder.catch(() => undefined);
    throw err;
  }
}

describe('findTransactionsOpenSince', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(() => {
    resetSettledCutoffMemo();
  });

  it("the predicate sees another session's open transaction", async () => {
    const held = await holdOpenTransaction();
    try {
      // Role-visibility tripwire: this role reads another session's xact_start. If it
      // ever cannot, the predicate fails closed: every hidden session counts as open,
      // so each day settles only at the cap, forced and logged (plan P1-14).
      const visibility = await prisma.$queryRaw<Array<{ visible: boolean }>>`
        SELECT xact_start IS NOT NULL AS visible FROM pg_stat_activity WHERE pid = ${held.pid}`;
      expect(visibility[0]?.visible).toBe(true);

      const open = await findTransactionsOpenSince(prisma, {
        dayEnd: new Date(Date.now() + MINUTE_MS),
      });
      expect(pidsOf(open)).toContain(held.pid);
    } finally {
      await held.release();
    }

    const afterCommit = await findTransactionsOpenSince(prisma, { dayEnd: futureDayStart() });
    expect(pidsOf(afterCommit)).not.toContain(held.pid);
  });

  it("the test's own session is never counted", async () => {
    const dayEnd = futureDayStart();
    await prisma.$transaction(async (tx) => {
      const own = await tx.$queryRaw<Array<{ pid: number; open: boolean }>>`
        SELECT pid, xact_start IS NOT NULL AS open
          FROM pg_stat_activity WHERE pid = pg_backend_pid()`;
      // Positive control: this session has an open transaction that began before the
      // day end, so the predicate would count it if it did not exclude its own pid.
      expect(own[0]?.open).toBe(true);
      const ownPid = own[0]?.pid ?? -1;

      expect(pidsOf(await findTransactionsOpenSince(tx, { dayEnd }))).not.toContain(ownPid);
      const settle = await resolveSettledCutoff(tx, {
        dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_MS),
      });
      expect(settle.cutoff).toEqual(dayEnd);
      expect(pidsOf(settle.openWriters)).not.toContain(ownPid);
    });
  });

  it("the open-writer predicate and xact_start are UTC under SET LOCAL TIME ZONE 'Europe/Istanbul'", async () => {
    const held = await holdOpenTransaction();
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Istanbul'`;
        // Positive control: the session zone took effect (local wall clock is UTC + 3 h).
        const offset = await tx.$queryRaw<Array<{ offset_hours: number }>>`
          SELECT (extract(epoch FROM (now()::timestamp - timezone('utc', now()))) / 3600)::int
            AS offset_hours`;
        expect(offset[0]?.offset_hours).toBe(3);

        // Both day ends lie within an hour of now, so a 3 h shift of either side of
        // the comparison flips one of the two answers.
        const soon = await findTransactionsOpenSince(tx, {
          dayEnd: new Date(Date.now() + MINUTE_MS),
        });
        const writer = soon.find((candidate) => candidate.pid === held.pid);
        expect(writer).toBeDefined();
        expect(Math.abs((writer?.xactStart?.getTime() ?? 0) - Date.now())).toBeLessThan(5_000);

        const anHourAgo = await findTransactionsOpenSince(tx, {
          dayEnd: new Date(Date.now() - HOUR_MS),
        });
        expect(pidsOf(anHourAgo)).not.toContain(held.pid);
      });
    } finally {
      await held.release();
    }
  });
});

describe('resolveSettledCutoff', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(() => {
    resetSettledCutoffMemo();
  });

  it('an open transaction that began before the day end holds the settled cutoff back', async () => {
    const dayEnd = futureDayStart();
    const dbNow = shift(dayEnd, SELLER_INPUT_SETTLE_MS);
    const held = await holdOpenTransaction();
    try {
      const settle = await resolveSettledCutoff(prisma, { dbNow });
      expect(settle.dbNow).toEqual(dbNow);
      expect(settle.cutoff).toEqual(previousDayStart(dayEnd));
      expect(settle.forced).toBe(false);
      expect(pidsOf(settle.openWriters)).toContain(held.pid);
    } finally {
      await held.release();
    }

    const afterCommit = await resolveSettledCutoff(prisma, { dbNow });
    expect(afterCommit.cutoff).toEqual(dayEnd);
    expect(afterCommit.forced).toBe(false);
    expect(afterCommit.openWriters).toEqual([]);
  });

  it('past the cap an open transaction no longer blocks and the result is forced', async () => {
    const dayEnd = futureDayStart();
    const held = await holdOpenTransaction();
    try {
      // One millisecond before the cap the open transaction still holds the cutoff back.
      const beforeCap = await resolveSettledCutoff(prisma, {
        dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS - 1),
      });
      expect(beforeCap.cutoff).toEqual(previousDayStart(dayEnd));
      expect(beforeCap.forced).toBe(false);

      const atCap = await resolveSettledCutoff(prisma, {
        dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS),
      });
      expect(atCap.cutoff).toEqual(dayEnd);
      expect(atCap.forced).toBe(true);
      expect(pidsOf(atCap.openWriters)).toContain(held.pid);
    } finally {
      await held.release();
    }
  });

  it('a forced cutoff is logged once per day with the open writers', async () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const forcedWarnings = (): unknown[] =>
      warn.mock.calls
        .filter(([event]) => event === 'seller-input.settle-forced')
        .map(([, ctx]) => ctx);
    const dayEnd = futureDayStart();
    const held = await holdOpenTransaction();
    try {
      // Positive control: held back before the cap, and that is not a forced result.
      const beforeCap = await resolveSettledCutoff(prisma, {
        dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS - 1),
      });
      expect(beforeCap.forced).toBe(false);
      expect(forcedWarnings()).toHaveLength(0);

      const atCap = await resolveSettledCutoff(prisma, {
        dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS),
      });
      expect(atCap.forced).toBe(true);
      const warnings = forcedWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        dayEnd: dayEnd.toISOString(),
        openWriters: expect.arrayContaining([{ pid: held.pid, xactStart: expect.any(String) }]),
      });

      // The same day again: the memo answers, no second warning.
      const later = await resolveSettledCutoff(prisma, {
        dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS + MINUTE_MS),
      });
      expect(later.cutoff).toEqual(dayEnd);
      expect(later.forced).toBe(false);
      expect(forcedWarnings()).toHaveLength(1);
    } finally {
      await held.release();
      warn.mockRestore();
    }
  });

  it('two callers started in the same tick past the cap log the forced cutoff once', async () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const forcedCount = (): number =>
      warn.mock.calls.filter(([event]) => event === 'seller-input.settle-forced').length;
    const dayEnd = futureDayStart();
    const held = await holdOpenTransaction();
    try {
      const atCap = shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS);
      // The buffer promote and the past-day flush start in one worker tick without
      // awaiting each other, so both pass the memo check before either writes it.
      const [first, second] = await Promise.all([
        resolveSettledCutoff(prisma, { dbNow: atCap }),
        resolveSettledCutoff(prisma, { dbNow: atCap }),
      ]);
      expect(first.cutoff).toEqual(dayEnd);
      expect(second.cutoff).toEqual(dayEnd);
      expect([first.forced, second.forced].filter(Boolean)).toHaveLength(1);
      expect(forcedCount()).toBe(1);
    } finally {
      await held.release();
      warn.mockRestore();
    }
  });

  it("before the settle delay the cutoff is the previous day's start even with no writer", async () => {
    const dayEnd = futureDayStart();

    const early = await resolveSettledCutoff(prisma, {
      dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_MS - 1),
    });
    expect(early.cutoff).toEqual(previousDayStart(dayEnd));
    expect(early.forced).toBe(false);
    expect(early.openWriters).toEqual([]);

    // Positive control: at the settle delay, with no open writer, the day is settled.
    const settled = await resolveSettledCutoff(prisma, {
      dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_MS),
    });
    expect(settled.cutoff).toEqual(dayEnd);
  });

  it('after a clean result the view is not read again for that day', async () => {
    const dayEnd = futureDayStart();
    const dbNow = shift(dayEnd, SELLER_INPUT_SETTLE_MS);

    const clean = await resolveSettledCutoff(prisma, { dbNow });
    expect(clean.cutoff).toEqual(dayEnd);

    const held = await holdOpenTransaction();
    try {
      const memoised = await resolveSettledCutoff(prisma, { dbNow });
      expect(memoised.cutoff).toEqual(dayEnd);
      expect(memoised.openWriters).toEqual([]);

      resetSettledCutoffMemo();
      const reread = await resolveSettledCutoff(prisma, { dbNow });
      expect(reread.cutoff).toEqual(previousDayStart(dayEnd));
      expect(pidsOf(reread.openWriters)).toContain(held.pid);
    } finally {
      await held.release();
    }
  });
});

/** A role name that is safe to splice into DDL: lower-case letters, digits, underscores. */
const SAFE_ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

describe('a reader whose role cannot see other sessions', () => {
  // Roles are cluster-wide: a unique name keeps parallel runs apart, afterAll drops it.
  // The role is not a member of pg_read_all_stats, not a superuser and not the role
  // of any other session, so pg_stat_activity hides every other session from it.
  const blindRole = `pazarsync_blind_reader_${randomUUID().replaceAll('-', '')}`;
  let roleCreated = false;

  beforeAll(async () => {
    await ensureDbReachable();
    if (!SAFE_ROLE_NAME.test(blindRole)) {
      throw new Error(`unsafe test role name: ${blindRole}`);
    }
    await prisma.$transaction(async (tx) => {
      // The creating role gets SET on the new role, so a transaction can switch to it.
      await tx.$executeRawUnsafe(`SET LOCAL createrole_self_grant = 'set'`);
      await tx.$executeRawUnsafe(`CREATE ROLE "${blindRole}" NOLOGIN`);
    });
    roleCreated = true;
  });

  afterAll(async () => {
    if (roleCreated) {
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${blindRole}"`);
    }
  });

  beforeEach(() => {
    resetSettledCutoffMemo();
  });

  /**
   * Runs `fn` in a transaction whose current role is the blind role. pg_stat_activity
   * decides visibility by the current role, so this reads the view exactly as a
   * session logged in as that role would.
   */
  async function asBlindReader<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${blindRole}"`);
        return fn(tx);
      },
      { timeout: HOLDER_TIMEOUT_MS },
    );
  }

  it('a session whose activity is hidden from the reader counts as an open writer with no start instant', async () => {
    const held = await holdOpenTransaction();
    try {
      await asBlindReader(async (tx) => {
        // Positive control: the reader cannot see the held session's state or start
        // instant, so the visible-transaction branch of the predicate cannot match it.
        const seen = await tx.$queryRaw<
          Array<{ state_hidden: boolean; xact_start_hidden: boolean }>
        >`
          SELECT state IS NULL AS state_hidden, xact_start IS NULL AS xact_start_hidden
            FROM pg_stat_activity WHERE pid = ${held.pid}`;
        expect(seen[0]).toEqual({ state_hidden: true, xact_start_hidden: true });

        const open = await findTransactionsOpenSince(tx, { dayEnd: futureDayStart() });
        expect(pidsOf(open)).toContain(held.pid);
        expect(open.find((writer) => writer.pid === held.pid)?.xactStart).toBeNull();
      });
    } finally {
      await held.release();
    }
  });

  it('a hidden session holds the cutoff back until the cap, then the cutoff is forced and logged as hidden', async () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const forcedWarnings = (): unknown[] =>
      warn.mock.calls
        .filter(([event]) => event === 'seller-input.settle-forced')
        .map(([, ctx]) => ctx);
    const dayEnd = futureDayStart();
    const held = await holdOpenTransaction();
    try {
      await asBlindReader(async (tx) => {
        const beforeCap = await resolveSettledCutoff(tx, {
          dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS - 1),
        });
        expect(beforeCap.cutoff).toEqual(previousDayStart(dayEnd));
        expect(beforeCap.forced).toBe(false);
        expect(pidsOf(beforeCap.openWriters)).toContain(held.pid);
        expect(forcedWarnings()).toHaveLength(0);

        const atCap = await resolveSettledCutoff(tx, {
          dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_CAP_MS),
        });
        expect(atCap.cutoff).toEqual(dayEnd);
        expect(atCap.forced).toBe(true);
        const warnings = forcedWarnings();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
          dayEnd: dayEnd.toISOString(),
          openWriters: expect.arrayContaining([{ pid: held.pid, hidden: true }]),
        });
      });
    } finally {
      await held.release();
      warn.mockRestore();
    }
  });

  it('with only idle sessions the blind reader still holds the cutoff back (fails closed)', async () => {
    const dayEnd = futureDayStart();
    await asBlindReader(async (tx) => {
      // The reader's connection is checked out, so this committed transaction ran on
      // another session and left it idle in the pool.
      const finished = await holdOpenTransaction();
      await finished.release();

      // Positive control: the reader cannot tell that session is idle.
      const seen = await tx.$queryRaw<Array<{ state_hidden: boolean }>>`
        SELECT state IS NULL AS state_hidden FROM pg_stat_activity WHERE pid = ${finished.pid}`;
      expect(seen[0]).toEqual({ state_hidden: true });

      const settle = await resolveSettledCutoff(tx, {
        dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_MS),
      });
      expect(settle.cutoff).toEqual(previousDayStart(dayEnd));
      expect(settle.forced).toBe(false);
      expect(pidsOf(settle.openWriters)).toContain(finished.pid);
    });
  });

  it('for a reader that sees every session an idle session does not hold the cutoff back', async () => {
    const dayEnd = futureDayStart();
    await prisma.$transaction(
      async (tx) => {
        // The reader's connection is checked out, so this committed transaction ran on
        // another session and left it idle in the pool.
        const finished = await holdOpenTransaction();
        await finished.release();

        // Positive control: the idle session is there and visible, with no open
        // transaction, so a predicate that counted every session without a start
        // instant (or every session at all) would match it.
        const idle = await tx.$queryRaw<Array<{ state: string | null; open: boolean }>>`
          SELECT state, xact_start IS NOT NULL AS open
            FROM pg_stat_activity WHERE pid = ${finished.pid}`;
        expect(idle[0]).toEqual({ state: 'idle', open: false });

        expect(pidsOf(await findTransactionsOpenSince(tx, { dayEnd }))).not.toContain(finished.pid);
        const settle = await resolveSettledCutoff(tx, {
          dbNow: shift(dayEnd, SELLER_INPUT_SETTLE_MS),
        });
        expect(settle.cutoff).toEqual(dayEnd);
        expect(settle.forced).toBe(false);
        expect(settle.openWriters).toEqual([]);
      },
      { timeout: HOLDER_TIMEOUT_MS },
    );
  });
});

describe('readDbNow', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('readDbNow is within one second of the test clock', async () => {
    const dbNow = await readDbNow(prisma);
    expect(Math.abs(dbNow.getTime() - Date.now())).toBeLessThan(1_000);
  });

  it("the database clock is UTC under SET LOCAL TIME ZONE 'Europe/Istanbul'", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Istanbul'`;
      const dbNow = await readDbNow(tx);
      expect(Math.abs(dbNow.getTime() - Date.now())).toBeLessThan(1_000);

      // Positive control: a bare now()::timestamp read through the same client is the
      // Istanbul wall clock, about 3 h ahead.
      const local = await tx.$queryRaw<Array<{ local_now: Date }>>`
        SELECT now()::timestamp AS local_now`;
      const localNow = local[0]?.local_now;
      expect(localNow).toBeInstanceOf(Date);
      expect(Math.abs((localNow?.getTime() ?? 0) - Date.now() - ISTANBUL_OFFSET_MS)).toBeLessThan(
        1_000,
      );
    });
  });
});
