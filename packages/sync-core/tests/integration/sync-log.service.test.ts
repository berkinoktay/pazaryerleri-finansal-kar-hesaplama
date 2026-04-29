// Backoff schedule integration test for markRetryable (spec §12 T4).
//
// The schedule is defined inline in markRetryable as
//   nextAttemptAt = now() + min(30s × 2^(attemptCount - 1), 30 min).
// Locking it with a parameterized test ensures a future tweak (e.g.
// switching to base-3, or raising the ceiling) shows up as a test
// failure rather than a silent SLA change.

import { prisma } from '@pazarsync/db';
import { syncLogService } from '@pazarsync/sync-core';
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

      await syncLogService.markRetryable(id, attempt, 'TEST_TRANSIENT', 'simulated transient');

      const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });

      // Status, error, and claim ownership must be reset so the next
      // tryClaimNext can pick the row up after the backoff.
      expect(after.status).toBe('FAILED_RETRYABLE');
      expect(after.errorCode).toBe('TEST_TRANSIENT');
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
    const row = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(),
        attemptCount: 5,
        progressCurrent: 2500,
        progressTotal: 5624,
        pageCursor: { kind: 'page', n: 25 },
        errorCode: 'MARKETPLACE_UNREACHABLE',
        errorMessage: 'Marketplace unreachable (500) — upstream issue (max retries reached)',
        nextAttemptAt: new Date(Date.now() + 30_000),
      },
    });
    return row.id;
  }

  it('records the skipped page, advances cursor, resets attempt count, and returns row to PENDING — progressCurrent left untouched', async () => {
    const id = await setupExhaustedRow();
    const skipEntry = {
      page: 25,
      attemptedAt: new Date('2026-04-29T08:53:55Z').toISOString(),
      errorCode: 'MARKETPLACE_UNREACHABLE',
      httpStatus: 500,
      xRequestId: 'test-req-abc',
      responseBodySnippet: '{"error":"INTERNAL"}',
    };

    await syncLogService.recordSkippedPageAndContinue(id, skipEntry, { kind: 'page', n: 26 });

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
      errorCode: 'MARKETPLACE_UNREACHABLE',
      httpStatus: 500,
    };
    const secondSkip = {
      page: 47,
      attemptedAt: new Date('2026-04-29T09:11:08Z').toISOString(),
      errorCode: 'MARKETPLACE_UNREACHABLE',
      httpStatus: 502,
    };

    await syncLogService.recordSkippedPageAndContinue(id, firstSkip, { kind: 'page', n: 26 });
    await syncLogService.recordSkippedPageAndContinue(id, secondSkip, { kind: 'page', n: 48 });

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.skippedPages).toEqual([firstSkip, secondSkip]);
    expect(after.pageCursor).toEqual({ kind: 'page', n: 48 });
    // Both skips left progressCurrent untouched (still the seed value).
    expect(after.progressCurrent).toBe(2500);
  });
});
