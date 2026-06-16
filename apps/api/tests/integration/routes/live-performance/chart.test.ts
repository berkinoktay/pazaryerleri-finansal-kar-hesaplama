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

/** A real instant at business hour `hour` today. */
function todayAtHour(hour: number): Date {
  return new Date(getBusinessDayRange().start.getTime() + hour * 60 * 60 * 1000);
}

interface ChartPointBody {
  hour: number;
  cumulativeRevenue: string;
  cumulativeProfit: string;
}
interface ChartBody {
  today: ChartPointBody[];
  yesterday: ChartPointBody[];
}

describe('GET /v1/.../live-performance/chart', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns cumulative revenue (orders + buffer) and cumulative profit (costed) per business hour', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Costed order at hour 9: ₺50 revenue, ₺10 profit.
    await createOrder(org.id, store.id, {
      orderDate: todayAtHour(9),
      saleGross: '50.00',
      estimatedNetProfit: '10.00',
    });
    // Cost-missing buffer order at hour 10: ₺60 revenue, no profit.
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '60.00',
        orderDate: todayAtHour(10).toISOString(),
        lines: [{ barcode: '8690000000001', quantity: 1 }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/chart`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ChartBody;
    expect(body.today).toHaveLength(24);
    expect(body.yesterday).toHaveLength(24);

    // Revenue: flat 0 before hour 9, +50 at 9 (order), +60 at 10 (buffer), then flat.
    expect(body.today[8]?.cumulativeRevenue).toBe('0.00');
    expect(body.today[9]?.cumulativeRevenue).toBe('50.00');
    expect(body.today[10]?.cumulativeRevenue).toBe('110.00');
    expect(body.today[23]?.cumulativeRevenue).toBe('110.00');
    // Profit: only the costed order contributes; the buffer adds nothing.
    expect(body.today[9]?.cumulativeProfit).toBe('10.00');
    expect(body.today[10]?.cumulativeProfit).toBe('10.00');
    expect(body.today[23]?.cumulativeProfit).toBe('10.00');
    // Empty yesterday → flat 0 on both series.
    expect(body.yesterday[23]?.cumulativeRevenue).toBe('0.00');
    expect(body.yesterday[23]?.cumulativeProfit).toBe('0.00');
  });
});
