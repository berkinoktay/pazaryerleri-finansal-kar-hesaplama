import { OrderStatus } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { openBusinessDayInstant } from '../../helpers/completed-day';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const SECTIONS = ['kpis', 'chart', 'today-products', 'orders'] as const;

interface CancelledFeedBody {
  data: { orderId: string | null; platformOrderId: string }[];
  // Optional so a missing field fails on the assertion, not on the read.
  counts?: { cancelled?: number };
}

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
        saleGross: '1000.00',
      });

      const res = await app.request(
        `/v1/organizations/${orgB.id}/stores/${storeB.id}/live-performance/${section}`,
        { headers: { Authorization: bearer(userA.accessToken) } },
      );

      // 403 (not a member of org B). Never 200 with org B's data.
      expect([403, 404]).toContain(res.status);
    });
  }

  it("/orders?filter=cancelled never lists another tenant's or another store's cancelled order", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // Today's cancels of another tenant and of another store of the same tenant.
    await createOrder(orgB.id, storeB.id, {
      orderDate: openBusinessDayInstant(),
      platformOrderId: 'B-CAN',
      status: OrderStatus.CANCELLED,
    });
    await createOrder(orgA.id, storeA2.id, {
      orderDate: openBusinessDayInstant(),
      platformOrderId: 'A2-CAN',
      status: OrderStatus.CANCELLED,
    });

    const url = `/v1/organizations/${orgA.id}/stores/${storeA1.id}/live-performance/orders?filter=cancelled`;
    const before = await app.request(url, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(before.status).toBe(200);
    const beforeBody: CancelledFeedBody = await before.json();
    expect(beforeBody.counts?.cancelled).toBe(0);
    expect(beforeBody.data).toEqual([]);

    // Positive control: the queried store's own cancel of today is listed, and only it.
    const own = await createOrder(orgA.id, storeA1.id, {
      orderDate: openBusinessDayInstant(),
      platformOrderId: 'A1-CAN',
      status: OrderStatus.CANCELLED,
    });
    const after = await app.request(url, { headers: { Authorization: bearer(userA.accessToken) } });
    expect(after.status).toBe(200);
    const afterBody: CancelledFeedBody = await after.json();
    expect(afterBody.counts?.cancelled).toBe(1);
    expect(afterBody.data.map((row) => [row.orderId, row.platformOrderId])).toEqual([
      [own.id, 'A1-CAN'],
    ]);
  });
});
