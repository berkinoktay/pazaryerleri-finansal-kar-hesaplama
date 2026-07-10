// Backoff schedule integration test for markRetryable (spec §12 T4).
//
// The schedule is defined inline in markRetryable as
//   nextAttemptAt = now() + min(30s × 2^(attemptCount - 1), 30 min).
// Locking it with a parameterized test ensures a future tweak (e.g.
// switching to base-3, or raising the ceiling) shows up as a test
// failure rather than a silent SLA change.

import { prisma } from '@pazarsync/db';
import { SyncErrorCode } from '@pazarsync/db/enums';
import { LostLeaseError, syncLogService } from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

describe('syncLogService.markRetryable backoff schedule', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function setupRunningRow(attemptCount: number): Promise<string> {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const row = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        attemptCount,
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
      },
    });
    return row.id;
  }

  it.each([
    { attempt: 1, expectedBackoffSec: 30 },
    { attempt: 2, expectedBackoffSec: 60 },
    { attempt: 3, expectedBackoffSec: 120 },
    { attempt: 4, expectedBackoffSec: 240 },
    { attempt: 5, expectedBackoffSec: 480 },
    { attempt: 6, expectedBackoffSec: 960 },
    { attempt: 10, expectedBackoffSec: 1800 }, // capped at 30 min
  ])(
    'attempt $attempt → next attempt in ~$expectedBackoffSec s',
    async ({ attempt, expectedBackoffSec }) => {
      const id = await setupRunningRow(attempt);
      const before = Date.now();

      await syncLogService.markRetryable(
        id,
        attempt,
        SyncErrorCode.MARKETPLACE_UNREACHABLE,
        'simulated transient',
        'worker-test',
      );

      const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });

      // Status, error, and claim ownership must be reset so the next
      // tryClaimNext can pick the row up after the backoff.
      expect(after.status).toBe('FAILED_RETRYABLE');
      expect(after.errorCode).toBe(SyncErrorCode.MARKETPLACE_UNREACHABLE);
      expect(after.errorMessage).toBe('simulated transient');
      expect(after.claimedAt).toBeNull();
      expect(after.claimedBy).toBeNull();
      expect(after.nextAttemptAt).not.toBeNull();

      // ±2s tolerance — the difference between Date.now() captured here
      // and the wall clock inside markRetryable is well under that, but
      // wider would mask a real bug. Widen only if CI proves flaky.
      const actualSec = (after.nextAttemptAt!.getTime() - before) / 1000;
      expect(actualSec).toBeGreaterThan(expectedBackoffSec - 2);
      expect(actualSec).toBeLessThan(expectedBackoffSec + 2);
    },
  );

  it('complete() clears stale error fields left behind by a recovered retryable run', async () => {
    const id = await setupRunningRow(3);
    // Simulate the transient-failure → backoff arc: markRetryable releases
    // the claim (status FAILED_RETRYABLE, claimedBy null).
    await syncLogService.markRetryable(
      id,
      3,
      SyncErrorCode.MARKETPLACE_UNREACHABLE,
      'simulated transient',
      'worker-test',
    );

    // Re-claim: a later poll picks the row back up (RUNNING, claimed by this
    // worker) — complete() is lease-fenced, so the row must be RUNNING under
    // 'worker-test' again before the success write lands.
    await prisma.syncLog.update({
      where: { id },
      data: {
        status: 'RUNNING',
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
      },
    });

    await syncLogService.complete(id, 42, 'worker-test');

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('COMPLETED');
    expect(after.recordsProcessed).toBe(42);
    // A COMPLETED row must not advertise the error of an attempt it survived.
    expect(after.errorCode).toBeNull();
    expect(after.errorMessage).toBeNull();
  });
});

describe('syncLogService.recordSkippedPageAndContinue', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function setupExhaustedRow(): Promise<string> {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    // recordSkippedPageAndContinue is lease-fenced and runs while the worker
    // still HOLDS the claim (handleRunError fires it from the run's catch
    // block before the claim is released), so the row is RUNNING + claimed.
    const row = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 5,
        progressCurrent: 2500,
        progressTotal: 5624,
        pageCursor: { kind: 'page', n: 25 },
      },
    });
    return row.id;
  }

  it('records the skipped page, advances cursor, resets attempt count, and returns row to PENDING — progressCurrent left untouched', async () => {
    const id = await setupExhaustedRow();
    const skipEntry = {
      page: 25,
      attemptedAt: new Date('2026-04-29T08:53:55Z').toISOString(),
      errorCode: SyncErrorCode.MARKETPLACE_UNREACHABLE,
      httpStatus: 500,
      xRequestId: 'test-req-abc',
      responseBodySnippet: '{"error":"INTERNAL"}',
    };

    await syncLogService.recordSkippedPageAndContinue(
      id,
      skipEntry,
      { kind: 'page', n: 26 },
      'worker-test',
    );

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('PENDING');
    expect(after.attemptCount).toBe(0);
    // progressCurrent MUST NOT be bumped here. The next chunk reads this
    // value and computes `progressCurrent + batch.length` — bumping
    // would double-count and inflate the final `recordsProcessed` past
    // the real upsert count.
    expect(after.progressCurrent).toBe(2500);
    expect(after.pageCursor).toEqual({ kind: 'page', n: 26 });
    expect(after.skippedPages).toEqual([skipEntry]);
    expect(after.claimedAt).toBeNull();
    expect(after.claimedBy).toBeNull();
    expect(after.errorCode).toBeNull();
    expect(after.errorMessage).toBeNull();
    expect(after.nextAttemptAt).toBeNull();
  });

  it('appends to an existing skippedPages array — two consecutive skips both end up recorded', async () => {
    const id = await setupExhaustedRow();
    const firstSkip = {
      page: 25,
      attemptedAt: new Date('2026-04-29T08:53:55Z').toISOString(),
      errorCode: SyncErrorCode.MARKETPLACE_UNREACHABLE,
      httpStatus: 500,
    };
    const secondSkip = {
      page: 47,
      attemptedAt: new Date('2026-04-29T09:11:08Z').toISOString(),
      errorCode: SyncErrorCode.MARKETPLACE_UNREACHABLE,
      httpStatus: 502,
    };

    await syncLogService.recordSkippedPageAndContinue(
      id,
      firstSkip,
      { kind: 'page', n: 26 },
      'worker-test',
    );
    // The first skip returned the row to PENDING (claim released). Production
    // re-claims it before the next chunk fails again — re-establish the held
    // RUNNING claim so the second fenced skip write matches.
    await prisma.syncLog.update({
      where: { id },
      data: {
        status: 'RUNNING',
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
      },
    });
    await syncLogService.recordSkippedPageAndContinue(
      id,
      secondSkip,
      { kind: 'page', n: 48 },
      'worker-test',
    );

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.skippedPages).toEqual([firstSkip, secondSkip]);
    expect(after.pageCursor).toEqual({ kind: 'page', n: 48 });
    // Both skips left progressCurrent untouched (still the seed value).
    expect(after.progressCurrent).toBe(2500);
  });
});

// Lease fencing: a claim-holder write only lands while the row is still
// RUNNING under the writer's own worker id. A peer (or the watchdog reaper)
// that took the row over must never have its state clobbered by the old
// owner — the fenced helper throws LostLeaseError and changes nothing.
describe('syncLogService lease fencing', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function setupClaimedRow(claimedBy: string): Promise<string> {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const row = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        attemptCount: 1,
        claimedAt: new Date(),
        claimedBy,
        lastTickAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    return row.id;
  }

  it('a fenced write with the wrong workerId changes nothing and throws LostLeaseError', async () => {
    const id = await setupClaimedRow('worker-owner');

    await expect(syncLogService.heartbeat(id, 'worker-impostor')).rejects.toBeInstanceOf(
      LostLeaseError,
    );

    // The row is untouched: still RUNNING, still owned by worker-owner, and
    // the heartbeat timestamp was NOT advanced by the rejected write.
    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('RUNNING');
    expect(after.claimedBy).toBe('worker-owner');
    expect(after.lastTickAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('a fenced write with the correct workerId succeeds', async () => {
    const id = await setupClaimedRow('worker-owner');

    await expect(syncLogService.heartbeat(id, 'worker-owner')).resolves.toBeUndefined();

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('RUNNING');
    // The heartbeat advanced lastTickAt past the seeded value.
    expect(after.lastTickAt?.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('a fenced write on a row already reaped to FAILED throws LostLeaseError', async () => {
    const id = await setupClaimedRow('worker-owner');
    // Simulate the watchdog reaper terminating an attempt-exhausted claim:
    // status leaves RUNNING, so even the rightful owner is now fenced out.
    await prisma.syncLog.update({
      where: { id },
      data: { status: 'FAILED', claimedAt: null, claimedBy: null },
    });

    await expect(syncLogService.complete(id, 10, 'worker-owner')).rejects.toBeInstanceOf(
      LostLeaseError,
    );

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('FAILED');
  });
});

// Graceful release: the shutdown path hands a still-healthy claim back to
// PENDING. Because it is only reachable after a chunk completed cleanly, it
// also RESETS attemptCount so rolling redeploys can never burn a progressing
// sync toward terminal FAILED.
describe('syncLogService.releaseToPending', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the row to PENDING, clears the claim, preserves the cursor, and resets attemptCount to 0', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const row = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        attemptCount: 3,
        claimedAt: new Date(),
        claimedBy: 'worker-owner',
        lastTickAt: new Date(),
        pageCursor: { kind: 'page', n: 7 },
      },
    });

    await syncLogService.releaseToPending(row.id, 'worker-owner');

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('PENDING');
    expect(after.claimedAt).toBeNull();
    expect(after.claimedBy).toBeNull();
    // A clean hand-off cannot mask a poison job, so the attempt budget resets.
    expect(after.attemptCount).toBe(0);
    // Cursor is intentionally preserved so the next claimer resumes mid-run.
    expect(after.pageCursor).toEqual({ kind: 'page', n: 7 });
  });
});
