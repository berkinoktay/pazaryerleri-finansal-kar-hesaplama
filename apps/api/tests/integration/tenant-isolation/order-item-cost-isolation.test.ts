import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
} from '../../helpers/factories';

describe('Tenant isolation: PATCH order item cost', () => {
  const app = createApp();
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it("a member of org A cannot cost org B's order item", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id, 'OWNER');

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const orderB = await createOrder(orgB.id, storeB.id);
    const itemB = await createOrderItem(orderB.id, orgB.id, { unitCostSnapshotNet: null });

    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/orders/${orderB.id}/items/${itemB.id}/cost`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'manual', netAmount: '42.00', vatRate: 20 }),
      },
    );
    expect([403, 404]).toContain(res.status);
  });
});
