import { computeParcelProfit, roundPercent } from '@pazarsync/profit';
import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

function todayAt(hours: number): Date {
  return new Date(getBusinessDayRange().start.getTime() + hours * 60 * 60 * 1000);
}

interface OrdersBody {
  data: {
    source: 'orders' | 'buffer';
    platformOrderId: string;
    orderId: string | null;
    bufferId: string | null;
    status: string;
    revenue: string;
    profit: string | null;
    margin: string | null;
  }[];
  total: number;
  counts: { all: number; calculated: number; pending: number };
}

async function seed(): Promise<{
  orgId: string;
  storeId: string;
  token: string;
  orderId: string;
  bufferId: string;
}> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const order = await createOrder(org.id, store.id, {
    orderDate: todayAt(10),
    platformOrderId: 'ORD-1',
    saleGross: '100.00',
  });
  // Profit + margin are served from the order's ESTIMATE statement (net 20, margin
  // 20 / 100 * 100 = 20 pct) -- the live feed no longer reads the legacy order columns.
  await createProfitStatement(order.id, org.id, store.id, {
    view: 'ESTIMATE',
    status: 'ESTIMATED',
    netProfit: '20.00',
    saleMarginPct: '20.00',
  });
  const bufferEntry = await createBufferEntry(org.id, store.id, {
    orderDate: getBusinessDateAnchor(),
    platformOrderId: 'BUF-1',
    mappedOrder: {
      status: 'PENDING',
      orderDate: todayAt(10).toISOString(),
      saleGross: '50.00',
      lines: [],
    },
  });

  return {
    orgId: org.id,
    storeId: store.id,
    token: user.accessToken,
    orderId: order.id,
    bufferId: bufferEntry.id,
  };
}

describe('GET /v1/.../live-performance/orders', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('unions calculated orders and cost-missing buffer for today (filter=all)', async () => {
    const { orgId, storeId, token, orderId, bufferId } = await seed();

    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/live-performance/orders?filter=all`,
      { headers: { Authorization: bearer(token) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as OrdersBody;
    expect(body.total).toBe(2);
    expect(body.counts).toEqual({ all: 2, calculated: 1, pending: 1 });

    const calculated = body.data.find((row) => row.source === 'orders');
    const pending = body.data.find((row) => row.source === 'buffer');
    expect(calculated?.platformOrderId).toBe('ORD-1');
    expect(calculated?.revenue).toBe('100.00');
    expect(calculated?.profit).toBe('20.00');
    expect(calculated?.margin).toBe('20.00');
    expect(pending?.platformOrderId).toBe('BUF-1');
    expect(pending?.revenue).toBe('50.00');
    expect(pending?.profit).toBeNull();
    expect(pending?.margin).toBeNull();
    expect(pending?.status).toBe('PENDING');

    // Identity bridge - orderId/bufferId for deep-link to detail sheet
    const ordersRow = body.data.find((r) => r.source === 'orders');
    expect(ordersRow?.orderId).toBe(orderId);
    expect(ordersRow?.bufferId).toBeNull();
    const bufferRow = body.data.find((r) => r.source === 'buffer');
    expect(bufferRow?.bufferId).toBe(bufferId);
    expect(bufferRow?.orderId).toBeNull();
  });

  it('filter=calculated returns only orders rows; counts stay complete', async () => {
    const { orgId, storeId, token } = await seed();

    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/live-performance/orders?filter=calculated`,
      { headers: { Authorization: bearer(token) } },
    );

    const body = (await res.json()) as OrdersBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.source).toBe('orders');
    expect(body.counts).toEqual({ all: 2, calculated: 1, pending: 1 });
  });

  it('filter=pending returns only buffer rows', async () => {
    const { orgId, storeId, token } = await seed();

    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/live-performance/orders?filter=pending`,
      { headers: { Authorization: bearer(token) } },
    );

    const body = (await res.json()) as OrdersBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.source).toBe('buffer');
  });

  it('lists an order without a costed estimate under pending, not calculated', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A stored estimate that never reached ESTIMATED: the KPIs count it as pending, so
    // the feed must too (decision 10) -- it is not a calculated row.
    const order = await createOrder(org.id, store.id, {
      orderDate: todayAt(10),
      platformOrderId: 'ORD-NC',
      saleGross: '75.00',
    });
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'NOT_COMPUTABLE',
      netProfit: null,
    });

    const pendingRes = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/orders?filter=pending`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(pendingRes.status).toBe(200);
    const pendingBody = (await pendingRes.json()) as OrdersBody;
    expect(pendingBody.counts).toEqual({ all: 1, calculated: 0, pending: 1 });
    expect(pendingBody.data).toHaveLength(1);
    expect(pendingBody.data[0]).toMatchObject({
      source: 'orders',
      platformOrderId: 'ORD-NC',
      orderId: order.id,
      bufferId: null,
      revenue: '75.00',
      profit: null,
      margin: null,
    });

    const allRes = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/orders?filter=all`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    const allBody = (await allRes.json()) as OrdersBody;
    expect(allBody.data).toHaveLength(1);
    expect(allBody.data[0]?.profit).toBeNull();
  });

  it('lists an order computed in the request as calculated', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    // A calculable order dated today with no stored statement: the writer has not caught
    // up yet, so the feed computes its profit read-only in the request.
    const orderId = await seedCalculableTrendyolOrder(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/orders?filter=calculated`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as OrdersBody;

    // The served row matches a fresh read-only computation of the same parcel, its margin
    // rounded to the stored column scale first (as the writer stores it), then to two
    // decimals -- the same string a stored statement would serve.
    const computed = await computeParcelProfit(prisma, { organizationId: org.id, orderId });
    const { netProfit, saleMarginPct } = computed.estimate;
    if (netProfit === null || saleMarginPct === null) {
      throw new Error('estimate net profit or margin unexpectedly null');
    }
    expect(body.counts).toEqual({ all: 1, calculated: 1, pending: 0 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      source: 'orders',
      orderId,
      profit: netProfit.toFixed(2),
      margin: roundPercent(saleMarginPct).toFixed(2),
    });

    // The request wrote nothing: no statement row exists afterwards.
    expect(await prisma.orderProfitStatement.count({ where: { orderId } })).toBe(0);
  });
});
