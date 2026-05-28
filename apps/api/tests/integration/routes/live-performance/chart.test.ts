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

/** A real instant at business hour `hour` today. */
function todayAtHour(hour: number): Date {
  return new Date(getBusinessDayRange().start.getTime() + hour * 60 * 60 * 1000);
}

interface ChartBody {
  today: { hour: number; cumulativeProfit: string }[];
  yesterday: { hour: number; cumulativeProfit: string }[];
}

describe('GET /v1/.../live-performance/chart', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('buckets profit by business hour and returns a running cumulative', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await createOrder(org.id, store.id, {
      orderDate: todayAtHour(9),
      saleSubtotalNet: '50.00',
      estimatedNetProfit: '10.00',
    });
    await createOrder(org.id, store.id, {
      orderDate: todayAtHour(14),
      saleSubtotalNet: '70.00',
      estimatedNetProfit: '15.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/chart`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ChartBody;
    expect(body.today).toHaveLength(24);
    expect(body.yesterday).toHaveLength(24);

    // Before any sale the curve is flat at 0.
    expect(body.today[8]?.cumulativeProfit).toBe('0.00');
    // First sale lands at hour 9.
    expect(body.today[9]?.cumulativeProfit).toBe('10.00');
    expect(body.today[13]?.cumulativeProfit).toBe('10.00');
    // Second sale at hour 14 lifts the running total.
    expect(body.today[14]?.cumulativeProfit).toBe('25.00');
    expect(body.today[23]?.cumulativeProfit).toBe('25.00');
    // No orders yesterday → flat 0 throughout.
    expect(body.yesterday[23]?.cumulativeProfit).toBe('0.00');
  });
});
