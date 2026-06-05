import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
    saleSubtotalNet: '100.00',
    estimatedNetProfit: '20.00',
  });
  const bufferEntry = await createBufferEntry(org.id, store.id, {
    orderDate: getBusinessDateAnchor(),
    platformOrderId: 'BUF-1',
    mappedOrder: {
      status: 'PENDING',
      orderDate: todayAt(10).toISOString(),
      saleSubtotalNet: '50.00',
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
});
