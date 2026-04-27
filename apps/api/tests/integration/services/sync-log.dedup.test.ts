import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';

describe('sync_logs partial unique index', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects a second active row for the same (storeId, syncType)', async () => {
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
      },
    });

    await expect(
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'PRODUCTS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a new active row after the previous one is COMPLETED', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const first = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });
    await prisma.syncLog.update({
      where: { id: first.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    await expect(
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'PRODUCTS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('allows different syncTypes for the same store concurrently', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    await expect(
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'ORDERS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ syncType: 'ORDERS' });
  });

  it('rejects a new active row when an existing row is FAILED_RETRYABLE', async () => {
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
        attemptCount: 1,
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'PRODUCTS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
