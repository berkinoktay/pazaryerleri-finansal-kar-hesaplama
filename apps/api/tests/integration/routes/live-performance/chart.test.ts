import { computeParcelProfit } from '@pazarsync/profit';
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

    // Costed order at hour 9: 50 revenue, 10 profit (from its ESTIMATE statement).
    const costed = await createOrder(org.id, store.id, {
      orderDate: todayAtHour(9),
      saleGross: '50.00',
    });
    await createProfitStatement(costed.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '10.00',
      saleMarginPct: '20.00',
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

  it("adds a statement-less calculable order's in-request profit to today's curve", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    // Dated now (today), no stored statement yet: the chart computes its profit in the
    // request rather than leaving it out of the curve.
    const orderId = await seedCalculableTrendyolOrder(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/chart`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ChartBody;
    const computed = await computeParcelProfit(prisma, { organizationId: org.id, orderId });
    const expectedNet = computed.estimate.netProfit;
    if (expectedNet === null) throw new Error('estimate net profit unexpectedly null');
    expect(expectedNet.isZero()).toBe(false);
    expect(body.today[23]?.cumulativeProfit).toBe(expectedNet.toFixed(2));
  });
});
