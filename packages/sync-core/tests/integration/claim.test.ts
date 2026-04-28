import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { tryClaimNext } from '../../src/claim';

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
