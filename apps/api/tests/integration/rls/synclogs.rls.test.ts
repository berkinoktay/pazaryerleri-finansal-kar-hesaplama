import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — sync_logs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function twoTenantsSetup() {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    return { userA, client, orgA, orgB, storeA, storeB };
  }

  it('sync_logs: member sees only own store logs', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const [logA] = await Promise.all([
      prisma.syncLog.create({
        data: {
          organizationId: orgA.id,
          storeId: storeA.id,
          syncType: 'ORDERS',
          status: 'COMPLETED',
          startedAt: new Date(),
        },
      }),
      prisma.syncLog.create({
        data: {
          organizationId: orgB.id,
          storeId: storeB.id,
          syncType: 'ORDERS',
          status: 'COMPLETED',
          startedAt: new Date(),
        },
      }),
    ]);

    const { data, error } = await client.from('sync_logs').select('id');

    expect(error).toBeNull();
    expect(data?.map((l) => l.id)).toEqual([logA.id]);
  });
});
