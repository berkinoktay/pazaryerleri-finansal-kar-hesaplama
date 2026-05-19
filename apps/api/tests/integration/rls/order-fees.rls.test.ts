import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderFee,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * order_fees: org-scoped via denormalized organization_id.
 * Pattern matches stores / orders / products — flat is_org_member() check.
 */
describe('RLS — order_fees', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only OrderFee rows from own org', async () => {
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
    const [feeA] = await Promise.all([
      createOrderFee(orderA.id, orgA.id),
      createOrderFee(orderB.id, orgB.id),
    ]);

    const { data, error } = await client.from('order_fees').select('id,fee_type');

    expect(error).toBeNull();
    expect(data?.map((f) => f.id)).toEqual([feeA.id]);
  });
});
