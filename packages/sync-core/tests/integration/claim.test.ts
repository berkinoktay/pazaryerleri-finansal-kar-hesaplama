import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_SYNC_ATTEMPTS, tryClaimNext } from '../../src/claim';

// Reuses apps/api test helpers — packages/sync-core does not yet have its own DB factories.
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

describe('tryClaimNext', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns null when no PENDING rows exist', async () => {
    const result = await tryClaimNext('worker-test-1');
    expect(result).toBeNull();
  });

  it('claims a PENDING row and transitions it to RUNNING with worker id', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    const claimed = await tryClaimNext('worker-test-1');
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(log.id);
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.claimedBy).toBe('worker-test-1');
    expect(claimed?.claimedAt).not.toBeNull();
    expect(claimed?.lastTickAt).not.toBeNull();
    expect(claimed?.attemptCount).toBe(1);
  });

  it('claims a FAILED_RETRYABLE row when nextAttemptAt has passed', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(),
        attemptCount: 2,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    const claimed = await tryClaimNext('worker-test-2');
    expect(claimed?.id).toBe(log.id);
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.attemptCount).toBe(3);
  });

  it('skips FAILED_RETRYABLE rows whose nextAttemptAt is in the future', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(),
        attemptCount: 2,
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });

    const claimed = await tryClaimNext('worker-test-3');
    expect(claimed).toBeNull();
  });

  // ─── Earliest-run + fair ordering (Paket C2) ─────────────────────────
  // started_at doubles as an earliest-run time (claim WHERE started_at <=
  // now()), and ordering is by COALESCE(next_attempt_at, started_at) so a
  // retry's priority is when its backoff elapsed — an old FAILED_RETRYABLE
  // row must not permanently outrank fresh PENDING work.

  it('does not claim a PENDING row whose started_at is in the future', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        // Staggered fan-out: enqueued now but not runnable until +1 min.
        startedAt: new Date(Date.now() + 60_000),
      },
    });

    const claimed = await tryClaimNext('worker-future');
    expect(claimed).toBeNull();
  });

  it('orders by COALESCE(next_attempt_at, started_at): an elapsed retry with an old started_at does not outrank fresher PENDING work', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    // Three distinct stores so the per-(store, sync_type) active-slot unique
    // index admits all three rows at once.
    const [storeA, storeB, storeC] = await Promise.all([
      createStore(org.id),
      createStore(org.id),
      createStore(org.id),
    ]);
    const now = Date.now();

    // FAILED_RETRYABLE with the OLDEST started_at but a JUST-elapsed
    // next_attempt_at → COALESCE priority = next_attempt_at (now - 1s), the
    // most recent of the three. Under the old `ORDER BY started_at` this row
    // (ancient started_at) would have been claimed FIRST; under COALESCE it
    // must be claimed LAST.
    const retry = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: storeA.id,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(now - 1_000_000),
        attemptCount: 2,
        nextAttemptAt: new Date(now - 1_000),
      },
    });
    // Two PENDING rows whose started_at (COALESCE priority, next_attempt_at is
    // null) both PREDATE the retry's next_attempt_at → both outrank the retry.
    const pendingOldest = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(now - 500_000),
      },
    });
    const pendingMiddle = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: storeC.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(now - 250_000),
      },
    });

    // Claim three times in a row; each claim takes the next-ready row.
    const first = await tryClaimNext('worker-order-1');
    const second = await tryClaimNext('worker-order-2');
    const third = await tryClaimNext('worker-order-3');

    // Ascending COALESCE priority: pendingOldest (now-500s) < pendingMiddle
    // (now-250s) < retry (now-1s). The FAILED_RETRYABLE row, despite the
    // oldest started_at, is claimed LAST.
    expect(first?.id).toBe(pendingOldest.id);
    expect(second?.id).toBe(pendingMiddle.id);
    expect(third?.id).toBe(retry.id);
  });

  // ─── Attempt cap (lease-hardening) ───────────────────────────────────
  // Rows that have burned every attempt are unclaimable — the cap on
  // tryClaimNext stops a worker from picking one back up (the watchdog
  // reaper terminates it instead so it never starves the slot).

  it('does not claim a PENDING row whose attempt_count has reached MAX_SYNC_ATTEMPTS', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
        attemptCount: MAX_SYNC_ATTEMPTS,
      },
    });

    const claimed = await tryClaimNext('worker-cap');
    expect(claimed).toBeNull();
  });

  it('claims a row one attempt below the cap and bumps it to the final attempt', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
        attemptCount: MAX_SYNC_ATTEMPTS - 1,
      },
    });

    // attempt_count 4 < 5 → claimable; the claim increments it to exactly
    // MAX_SYNC_ATTEMPTS, which is the legitimate "executing its final
    // attempt" state the watchdog must leave alone while fresh.
    const claimed = await tryClaimNext('worker-final');
    expect(claimed?.id).toBe(log.id);
    expect(claimed?.attemptCount).toBe(MAX_SYNC_ATTEMPTS);
  });

  // ─── Multi-worker race coverage (spec §12 T2) ────────────────────────
  // The "scale out by adding workers" claim hinges on
  // SELECT … FOR UPDATE SKIP LOCKED working correctly across concurrent
  // sessions. These cases prove it against the real DB.

  it('two simultaneous tryClaimNext calls cannot both claim the same PENDING row', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    // Promise.all kicks both claim queries off before either resolves;
    // under SKIP LOCKED exactly one acquires the row, the other returns
    // null without blocking on the lock.
    const [a, b] = await Promise.all([tryClaimNext('worker-A'), tryClaimNext('worker-B')]);

    const winners = [a, b].filter((x): x is NonNullable<typeof x> => x !== null);
    const losers = [a, b].filter((x) => x === null);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]?.id).toBe(log.id);
    expect(['worker-A', 'worker-B']).toContain(winners[0]?.claimedBy);
  });

  it('concurrent claims across 5 workers + 5 PENDING rows distribute correctly', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    // Five different stores × one PENDING row each — same syncType is
    // fine because the partial-unique index is per (storeId, syncType).
    const stores = await Promise.all(Array.from({ length: 5 }, () => createStore(org.id)));
    await Promise.all(
      stores.map((s) =>
        prisma.syncLog.create({
          data: {
            organizationId: org.id,
            storeId: s.id,
            syncType: 'PRODUCTS',
            status: 'PENDING',
            startedAt: new Date(),
          },
        }),
      ),
    );

    const claimed = await Promise.all(['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => tryClaimNext(id)));
    const successes = claimed.filter((x): x is NonNullable<typeof x> => x !== null);
    expect(successes).toHaveLength(5);

    // Every worker claimed a distinct row.
    const ids = new Set(successes.map((s) => s.id));
    expect(ids.size).toBe(5);
  });
});
