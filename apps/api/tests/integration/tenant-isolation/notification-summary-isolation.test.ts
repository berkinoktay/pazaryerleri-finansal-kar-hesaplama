import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';

describe('Tenant isolation: notification-summary', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it("a member of org A cannot read org B's order summary", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id, 'OWNER');

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const orderB = await createOrder(orgB.id, storeB.id, { saleSubtotalNet: '99.00' });

    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/live-performance/notification-summary?source=orders&id=${orderB.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect([403, 404]).toContain(res.status);
  });

  it("a member of org A cannot read org B's buffer summary", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id, 'OWNER');

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const entryB = await createBufferEntry(orgB.id, storeB.id, {
      mappedOrder: { saleSubtotalNet: '10.00', lines: [] },
    });

    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/live-performance/notification-summary?source=buffer&id=${entryB.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect([403, 404]).toContain(res.status);
  });
});
