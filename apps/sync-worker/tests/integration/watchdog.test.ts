import { prisma } from '@pazarsync/db';
import { MAX_SYNC_ATTEMPTS, tryClaimNext } from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { sweepStaleClaims } from '../../src/watchdog';

const STALE_TICK = new Date(Date.now() - 2 * 60_000); // 2 min ago (threshold 90s)
const FRESH_TICK = new Date();
const REAPER_MESSAGE = 'attempt limit exhausted (watchdog reaper)';

async function seedStore(): Promise<{ orgId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { orgId: org.id, storeId: store.id };
}

describe('sweepStaleClaims', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('requeues a RUNNING row whose lastTickAt is older than the threshold', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'x',
        credentials: 'opaque',
      },
    });

    const stale = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5 * 60_000),
        claimedAt: new Date(Date.now() - 5 * 60_000),
        claimedBy: 'worker-dead',
        lastTickAt: new Date(Date.now() - 2 * 60_000), // 2 min ago, threshold 90s
        attemptCount: 1,
      },
    });

    const reaped = await sweepStaleClaims();
    expect(reaped).toBe(1);

    const reaped_row = await prisma.syncLog.findUniqueOrThrow({ where: { id: stale.id } });
    expect(reaped_row.status).toBe('PENDING');
    expect(reaped_row.claimedAt).toBeNull();
    expect(reaped_row.claimedBy).toBeNull();
  });

  it('does not touch fresh RUNNING rows', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'x',
        credentials: 'opaque',
      },
    });

    const fresh = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-alive',
        lastTickAt: new Date(),
        attemptCount: 1,
      },
    });

    expect(await sweepStaleClaims()).toBe(0);

    const unchanged = await prisma.syncLog.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(unchanged.status).toBe('RUNNING');
  });

  // ─── Resume after reap (spec §12 T3) ─────────────────────────────────
  // The watchdog test above proves stale RUNNING → PENDING. This case
  // proves the *resume* half: pageCursor and progress survive the reap,
  // and the next claim picks up where the dead worker left off.

  it('after watchdog reaps a stale RUNNING row, tryClaimNext resumes from saved cursor', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'x',
        credentials: 'opaque',
      },
    });

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5 * 60_000),
        claimedAt: new Date(Date.now() - 5 * 60_000),
        claimedBy: 'worker-dead',
        lastTickAt: new Date(Date.now() - 2 * 60_000), // 2 min ago, threshold 90s
        attemptCount: 1,
        progressCurrent: 500,
        progressTotal: 1000,
        pageCursor: { kind: 'page', n: 5 },
      },
    });

    // Watchdog reaps the dead worker's claim back to PENDING.
    expect(await sweepStaleClaims()).toBe(1);

    const reaped = await prisma.syncLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(reaped.status).toBe('PENDING');
    expect(reaped.pageCursor).toEqual({ kind: 'page', n: 5 }); // ← cursor preserved
    expect(reaped.progressCurrent).toBe(500);

    // A replacement worker claims it next; the saved cursor and progress
    // ride along to the new claim, attemptCount is bumped.
    const claimed = await tryClaimNext('worker-replacement');
    expect(claimed?.id).toBe(log.id);
    expect(claimed?.pageCursor).toEqual({ kind: 'page', n: 5 });
    expect(claimed?.progressCurrent).toBe(500);
    expect(claimed?.attemptCount).toBe(2);
  });

  // ─── Attempt-exhausted reaper (lease-hardening) ──────────────────────
  // The sweep is a three-way split on attempt_count:
  //   (a) stale RUNNING at the cap   → terminal FAILED (reaper message)
  //   (b) stale RUNNING below the cap → PENDING (covered above)
  //   (c) unclaimable PENDING/FAILED_RETRYABLE at the cap → terminal FAILED
  // Fresh RUNNING at exactly the cap is a legitimate final attempt and must
  // NOT be touched.

  it('terminates a stale RUNNING row that has reached the attempt cap (case a)', async () => {
    const { orgId, storeId } = await seedStore();
    const stale = await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5 * 60_000),
        claimedAt: new Date(Date.now() - 5 * 60_000),
        claimedBy: 'worker-dead',
        lastTickAt: STALE_TICK,
        attemptCount: MAX_SYNC_ATTEMPTS,
      },
    });

    expect(await sweepStaleClaims()).toBe(1);

    const reaped = await prisma.syncLog.findUniqueOrThrow({ where: { id: stale.id } });
    expect(reaped.status).toBe('FAILED');
    expect(reaped.errorCode).toBe('INTERNAL_ERROR');
    expect(reaped.errorMessage).toBe(REAPER_MESSAGE);
    expect(reaped.completedAt).not.toBeNull();
    expect(reaped.claimedAt).toBeNull();
    expect(reaped.claimedBy).toBeNull();
  });

  it('terminates a PENDING row stuck at the attempt cap so it stops starving the slot (case c)', async () => {
    const { orgId, storeId } = await seedStore();
    const stuck = await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
        attemptCount: MAX_SYNC_ATTEMPTS,
      },
    });

    expect(await sweepStaleClaims()).toBe(1);

    const reaped = await prisma.syncLog.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(reaped.status).toBe('FAILED');
    expect(reaped.errorCode).toBe('INTERNAL_ERROR');
    expect(reaped.errorMessage).toBe(REAPER_MESSAGE);
  });

  it('terminates a FAILED_RETRYABLE row stuck at the attempt cap (case c)', async () => {
    const { orgId, storeId } = await seedStore();
    const stuck = await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(),
        attemptCount: MAX_SYNC_ATTEMPTS,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    expect(await sweepStaleClaims()).toBe(1);

    const reaped = await prisma.syncLog.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(reaped.status).toBe('FAILED');
    expect(reaped.errorMessage).toBe(REAPER_MESSAGE);
  });

  it('leaves a FRESH RUNNING row at the attempt cap alone (final attempt in flight)', async () => {
    const { orgId, storeId } = await seedStore();
    const fresh = await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-alive',
        lastTickAt: FRESH_TICK,
        attemptCount: MAX_SYNC_ATTEMPTS,
      },
    });

    expect(await sweepStaleClaims()).toBe(0);

    const unchanged = await prisma.syncLog.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(unchanged.status).toBe('RUNNING');
    expect(unchanged.claimedBy).toBe('worker-alive');
  });

  it('reaps mixed cases in one sweep and returns the total count', async () => {
    const { orgId, storeId } = await seedStore();
    // One stale RUNNING below the cap → PENDING (case b).
    await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-dead',
        lastTickAt: STALE_TICK,
        attemptCount: 1,
      },
    });
    // One PENDING at the cap → FAILED (case c). Different store keeps the
    // per-(store, type) active-slot unique index happy.
    const store2 = await createStore(orgId);
    await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId: store2.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
        attemptCount: MAX_SYNC_ATTEMPTS,
      },
    });

    // Both branches fire → total reaped count is 2.
    expect(await sweepStaleClaims()).toBe(2);
  });
});
