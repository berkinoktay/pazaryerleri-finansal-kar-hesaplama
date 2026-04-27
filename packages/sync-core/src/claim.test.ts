import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { tryClaimNext } from './claim';

// Reuses apps/api test helpers — packages/sync-core does not yet have its own DB factories.
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../apps/api/tests/helpers/db';

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
});
