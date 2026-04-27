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

describe('RLS — settlements/sync_logs', () => {
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

  it('settlements: member sees only own org', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const period = { periodStart: new Date(), periodEnd: new Date() };
    const [setA] = await Promise.all([
      prisma.settlement.create({
        data: {
          ...period,
          organizationId: orgA.id,
          storeId: storeA.id,
          grossAmount: '100',
          netAmount: '80',
        },
      }),
      prisma.settlement.create({
        data: {
          ...period,
          organizationId: orgB.id,
          storeId: storeB.id,
          grossAmount: '200',
          netAmount: '150',
        },
      }),
    ]);

    const { data, error } = await client.from('settlements').select('id,gross_amount');

    expect(error).toBeNull();
    expect(data?.map((s) => s.id)).toEqual([setA.id]);
  });

  it('settlement_items: member sees only items of settlements in own org', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const period = { periodStart: new Date(), periodEnd: new Date() };
    const [setA, setB] = await Promise.all([
      prisma.settlement.create({
        data: {
          ...period,
          organizationId: orgA.id,
          storeId: storeA.id,
          grossAmount: '100',
          netAmount: '80',
        },
      }),
      prisma.settlement.create({
        data: {
          ...period,
          organizationId: orgB.id,
          storeId: storeB.id,
          grossAmount: '200',
          netAmount: '150',
        },
      }),
    ]);
    const [itemA] = await Promise.all([
      prisma.settlementItem.create({
        data: { settlementId: setA.id, amount: '50', type: 'SALE' },
      }),
      prisma.settlementItem.create({
        data: { settlementId: setB.id, amount: '75', type: 'SALE' },
      }),
    ]);

    const { data, error } = await client.from('settlement_items').select('id');

    expect(error).toBeNull();
    expect(data?.map((i) => i.id)).toEqual([itemA.id]);
  });

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
