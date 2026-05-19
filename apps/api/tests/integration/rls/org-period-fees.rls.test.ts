import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrgPeriodFee,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * org_period_fees: org-scoped via denormalized organization_id.
 * Reklam Bedeli / Penalty / Notification / PSF-Stopaj audit kayıtları.
 * Sipariş kar hesabını ETKİLEMEZ — yalnız audit/transparency için tutulur.
 */
describe('RLS — org_period_fees', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only OrgPeriodFee rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    const [feeA] = await Promise.all([
      createOrgPeriodFee(orgA.id, storeA.id),
      createOrgPeriodFee(orgB.id, storeB.id),
    ]);

    const { data, error } = await client.from('org_period_fees').select('id,fee_type');

    expect(error).toBeNull();
    expect(data?.map((f) => f.id)).toEqual([feeA.id]);
  });
});
