import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderClaim,
  createOrderClaimItem,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * order_claim_items: no direct organization_id; reach via parent OrderClaim.
 * EXISTS walk pattern (settlement_items / order_items mirror).
 */
describe('RLS — order_claim_items', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only OrderClaimItem rows of claims in own org', async () => {
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
    const [claimA, claimB] = await Promise.all([
      createOrderClaim(orgA.id, orderA.id),
      createOrderClaim(orgB.id, orderB.id),
    ]);
    const [itemA] = await Promise.all([
      createOrderClaimItem(claimA.id),
      createOrderClaimItem(claimB.id),
    ]);

    const { data, error } = await client.from('order_claim_items').select('id,reason_code');

    expect(error).toBeNull();
    expect(data?.map((i) => i.id)).toEqual([itemA.id]);
  });
});
