import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { computeParcelProfit } from '@pazarsync/profit';
import { getBusinessDateAnchor } from '@pazarsync/utils';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { seedCalculableTrendyolOrder } from '../../../helpers/calculable-order';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrder,
  createOrganization,
  createProfitStatement,
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
      saleGross: '149.90',
      status: 'PROCESSING',
    });
    // Profit is served from the order's ESTIMATE statement (net 38.40), not the
    // legacy order column.
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '38.40',
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
      status: 'PROCESSING',
      // A directly-written order (never buffered) is not a promotion.
      isPromotion: false,
    });
  });

  it('orders source: isPromotion true when the order graduated from the buffer', async () => {
    const { user, org, store } = await ownerWithStore();
    const order = await createOrder(org.id, store.id, {
      orderDate: new Date(),
      saleGross: '75.00',
      status: 'PROCESSING',
      promotedFromBufferAt: new Date(),
    });
    // A stored (not-yet-computable) estimate statement keeps the read off the
    // in-request fallback; this test only asserts the promotion/status flags.
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'NOT_COMPUTABLE',
      netProfit: null,
    });

    const res = await get(org.id, store.id, 'orders', order.id, user.accessToken);
    const body = await res.json();
    expect(body.isPromotion).toBe(true);
    expect(body.status).toBe('PROCESSING');
  });

  it('orders source: pending costStatus + null profit when estimate is null', async () => {
    const { user, org, store } = await ownerWithStore();
    const order = await createOrder(org.id, store.id, {
      orderDate: new Date(),
      saleGross: '50.00',
    });
    // A stored estimate statement that never reached ESTIMATED -> pending, null profit.
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'NOT_COMPUTABLE',
      netProfit: null,
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
      saleGross: '10.00',
    });
    // A stored estimate statement keeps the read off the in-request fallback; this
    // test only asserts the isToday gate.
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'NOT_COMPUTABLE',
      netProfit: null,
    });

    const res = await get(org.id, store.id, 'orders', order.id, user.accessToken);
    const body = await res.json();
    expect(body.isToday).toBe(false);
  });

  it('computes the notification profit in the request when the statement is not written yet', async () => {
    const { user, org, store } = await ownerWithStore();
    // A real, calculable Trendyol order with no stored statement yet: the summary
    // computes its profit read-only in the request (owner decision 2026-11-04).
    const orderId = await seedCalculableTrendyolOrder(org.id, store.id);

    const res = await get(org.id, store.id, 'orders', orderId, user.accessToken);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The served profit matches a fresh read-only computation of the same parcel.
    const computed = await computeParcelProfit(prisma, { organizationId: org.id, orderId });
    const expectedNet = computed.estimate.netProfit;
    if (expectedNet === null) throw new Error('estimate net profit unexpectedly null');
    expect(body.profit).toBe(expectedNet.toFixed(2));
    expect(body.costStatus).toBe('costed');

    // The request wrote nothing: no statement or line rows exist afterwards.
    expect(await prisma.orderProfitStatement.count({ where: { orderId } })).toBe(0);
    expect(await prisma.profitLine.count({ where: { orderId } })).toBe(0);
  });

  it('buffer source: revenue from mappedOrder, null profit, pending, isToday from anchor', async () => {
    const { user, org, store } = await ownerWithStore();
    const entry = await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      platformOrderNumber: 'TY-BUF-1',
      mappedOrder: { saleGross: '500.00', lines: [] },
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
      // A buffer entry is not yet an order: no status, never a promotion.
      status: null,
      isPromotion: false,
    });
  });

  it('buffer source: isToday false for a past-day buffer entry', async () => {
    const { user, org, store } = await ownerWithStore();
    const entry = await createBufferEntry(org.id, store.id, {
      orderDate: new Date('2020-01-01T00:00:00.000Z'),
      mappedOrder: { saleGross: '12.00', lines: [] },
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
