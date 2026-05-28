import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const SECTIONS = ['kpis', 'chart', 'missing-cost', 'top-products', 'orders'] as const;

describe('Tenant isolation: live-performance endpoints', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  for (const section of SECTIONS) {
    it(`/${section}: a member of org A cannot read org B's store`, async () => {
      const userA = await createAuthenticatedTestUser();
      const orgA = await createOrganization();
      await createMembership(orgA.id, userA.id);
      await createStore(orgA.id);

      const userB = await createAuthenticatedTestUser();
      const orgB = await createOrganization();
      await createMembership(orgB.id, userB.id);
      const storeB = await createStore(orgB.id);

      // Org B has real data that must never leak to org A.
      await createOrder(orgB.id, storeB.id, {
        orderDate: new Date(),
        saleSubtotalNet: '1000.00',
        estimatedNetProfit: '300.00',
      });

      const res = await app.request(
        `/v1/organizations/${orgB.id}/stores/${storeB.id}/live-performance/${section}`,
        { headers: { Authorization: bearer(userA.accessToken) } },
      );

      // 403 (not a member of org B). Never 200 with org B's data.
      expect([403, 404]).toContain(res.status);
    });
  }
});
