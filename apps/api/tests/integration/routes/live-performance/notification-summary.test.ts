import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getBusinessDateAnchor } from '@pazarsync/utils';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../../helpers/factories';

describe('GET live-performance/notification-summary', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function ownerWithStore() {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    return { user, org, store };
  }

  function get(orgId: string, storeId: string, source: string, id: string, token: string) {
    return app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/live-performance/notification-summary?source=${source}&id=${id}`,
      { headers: { Authorization: bearer(token) } },
    );
  }

  it('orders source: returns costed revenue + profit when estimate is set', async () => {
    const { user, org, store } = await ownerWithStore();
    const order = await createOrder(org.id, store.id, {
      orderDate: new Date(),
      platformOrderNumber: 'TY-100',
      saleSubtotalNet: '149.90',
      estimatedNetProfit: '38.40',
    });

    const res = await get(org.id, store.id, 'orders', order.id, user.accessToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      source: 'orders',
      orderId: order.id,
      bufferId: null,
      platformOrderNumber: 'TY-100',
      revenue: '149.90',
      profit: '38.40',
      costStatus: 'costed',
      isToday: true,
    });
  });

  it('orders source: pending costStatus + null profit when estimate is null', async () => {
    const { user, org, store } = await ownerWithStore();
    const order = await createOrder(org.id, store.id, {
      orderDate: new Date(),
      saleSubtotalNet: '50.00',
      estimatedNetProfit: null,
    });

    const res = await get(org.id, store.id, 'orders', order.id, user.accessToken);
    const body = await res.json();
    expect(body.costStatus).toBe('pending');
    expect(body.profit).toBeNull();
    expect(body.revenue).toBe('50.00');
  });

  it('orders source: isToday false for a historical order', async () => {
    const { user, org, store } = await ownerWithStore();
    const order = await createOrder(org.id, store.id, {
      orderDate: new Date('2020-01-01T08:00:00.000Z'),
      saleSubtotalNet: '10.00',
    });

    const res = await get(org.id, store.id, 'orders', order.id, user.accessToken);
    const body = await res.json();
    expect(body.isToday).toBe(false);
  });

  it('buffer source: revenue from mappedOrder, null profit, pending, isToday from anchor', async () => {
    const { user, org, store } = await ownerWithStore();
    const entry = await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      platformOrderNumber: 'TY-BUF-1',
      mappedOrder: { saleSubtotalNet: '500.00', lines: [] },
    });

    const res = await get(org.id, store.id, 'buffer', entry.id, user.accessToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      source: 'buffer',
      orderId: null,
      bufferId: entry.id,
      platformOrderNumber: 'TY-BUF-1',
      revenue: '500.00',
      profit: null,
      costStatus: 'pending',
      isToday: true,
    });
  });

  it('buffer source: isToday false for a past-day buffer entry', async () => {
    const { user, org, store } = await ownerWithStore();
    const entry = await createBufferEntry(org.id, store.id, {
      orderDate: new Date('2020-01-01T00:00:00.000Z'),
      mappedOrder: { saleSubtotalNet: '12.00', lines: [] },
    });

    const res = await get(org.id, store.id, 'buffer', entry.id, user.accessToken);
    const body = await res.json();
    expect(body.isToday).toBe(false);
  });

  it('returns 404 for an unknown id', async () => {
    const { user, org, store } = await ownerWithStore();
    const res = await get(
      org.id,
      store.id,
      'orders',
      '00000000-0000-0000-0000-000000000000',
      user.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it('returns 422 for an invalid source', async () => {
    const { user, org, store } = await ownerWithStore();
    const res = await get(
      org.id,
      store.id,
      'bogus',
      '00000000-0000-0000-0000-000000000000',
      user.accessToken,
    );
    expect(res.status).toBe(422);
  });
});
