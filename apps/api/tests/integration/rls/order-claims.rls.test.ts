import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderClaim,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * order_claims: org-scoped via denormalized organization_id (design §3.6).
 * Tasarım kararı: child table bile olsa orgId denormalize edilir, EXISTS
 * walk yerine flat is_org_member() — products / variants pattern'i.
 */
describe('RLS — order_claims', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only OrderClaim rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    const [orderA, orderB] = await Promise.all([
      createOrder(orgA.id, storeA.id),
      createOrder(orgB.id, storeB.id),
    ]);
    const [claimA] = await Promise.all([
      createOrderClaim(orgA.id, orderA.id),
      createOrderClaim(orgB.id, orderB.id),
    ]);

    const { data, error } = await client.from('order_claims').select('id,trendyol_claim_id');

    expect(error).toBeNull();
    expect(data?.map((c) => c.id)).toEqual([claimA.id]);
  });
});
