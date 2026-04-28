import { prisma } from '@pazarsync/db';
import { tryClaimNext } from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { sweepStaleClaims } from '../../src/watchdog';

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
});
