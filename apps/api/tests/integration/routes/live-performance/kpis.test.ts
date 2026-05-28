import { getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../../helpers/factories';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** A real instant `hours` into today's business day (well inside the window). */
function todayAt(hours: number): Date {
  return new Date(getBusinessDayRange().start.getTime() + hours * 60 * 60 * 1000);
}

/** A real instant `hours` into yesterday's business day. */
function yesterdayAt(hours: number): Date {
  const range = getBusinessDayRange(new Date(Date.now() - ONE_DAY_MS));
  return new Date(range.start.getTime() + hours * 60 * 60 * 1000);
}

interface KpisBody {
  revenueToday: string;
  revenueYesterday: string;
  netProfitToday: string;
  netProfitYesterday: string;
  orderCountToday: number;
  orderCountYesterday: number;
  marginToday: string;
  marginYesterday: string;
}

describe('GET /v1/.../live-performance/kpis', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('aggregates today vs. yesterday revenue, profit, count, and margin', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await createOrder(org.id, store.id, {
      orderDate: todayAt(12),
      saleSubtotalNet: '100.00',
      estimatedNetProfit: '20.00',
    });
    await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(12),
      saleSubtotalNet: '80.00',
      estimatedNetProfit: '15.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    expect(body.revenueToday).toBe('100.00');
    expect(body.revenueYesterday).toBe('80.00');
    expect(body.netProfitToday).toBe('20.00');
    expect(body.netProfitYesterday).toBe('15.00');
    expect(body.orderCountToday).toBe(1);
    expect(body.orderCountYesterday).toBe(1);
    expect(body.marginToday).toBe('20.00');
    expect(body.marginYesterday).toBe('18.75');
  });

  it('returns zeroes (not an error) for a store with no orders', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    expect(body.revenueToday).toBe('0.00');
    expect(body.orderCountToday).toBe(0);
    expect(body.marginToday).toBe('0.00');
  });
});
