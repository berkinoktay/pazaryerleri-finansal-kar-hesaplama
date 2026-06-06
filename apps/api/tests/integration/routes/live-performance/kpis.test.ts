import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrder,
  createOrderItem,
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
  orderCountToday: number;
  orderCountYesterday: number;
  unitsSoldToday: number;
  unitsSoldYesterday: number;
  netProfitToday: string;
  netProfitYesterday: string;
  marginToday: string;
  marginYesterday: string;
  profitCostRatioToday: string;
  profitCostRatioYesterday: string;
  pendingRevenueToday: string;
  pendingOrderCountToday: number;
}

describe('GET /v1/.../live-performance/kpis', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('today: volume counts orders + buffer; profit/margin/ratio only the costed subset; pending == buffer', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A costed order today: ₺100 revenue, ₺20 profit, 1 line × qty 2 @ ₺30 cost = ₺60 cost.
    const costed = await createOrder(org.id, store.id, {
      orderDate: todayAt(12),
      saleSubtotalNet: '100.00',
      estimatedNetProfit: '20.00',
    });
    await createOrderItem(costed.id, org.id, { quantity: 2, unitCostSnapshotNet: '30.00' });

    // A cost-missing order in today's buffer: ₺60 revenue, 3 units, no profit yet.
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleSubtotalNet: '60.00',
        orderDate: todayAt(10).toISOString(),
        lines: [{ barcode: '8690000000001', quantity: 3 }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    // Volume = universe (orders + buffer).
    expect(body.revenueToday).toBe('160.00');
    expect(body.orderCountToday).toBe(2);
    expect(body.unitsSoldToday).toBe(5);
    // Profit family = costed subset only.
    expect(body.netProfitToday).toBe('20.00');
    expect(body.marginToday).toBe('20.00'); // 20 / 100 costed revenue
    expect(body.profitCostRatioToday).toBe('33.33'); // 20 / 60 costed cost
    // Pending gap = universe − costed = the buffer.
    expect(body.pendingRevenueToday).toBe('60.00');
    expect(body.pendingOrderCountToday).toBe(1);
  });

  it('yesterday: complete in orders (Slice 0 payoff) — counts null-profit orders for volume, excludes them from profit', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A costed order yesterday: ₺200 revenue, ₺50 profit, 1 line × qty 1 @ ₺80 cost.
    const costed = await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(10),
      saleSubtotalNet: '200.00',
      estimatedNetProfit: '50.00',
    });
    await createOrderItem(costed.id, org.id, { quantity: 1, unitCostSnapshotNet: '80.00' });

    // A persisted null-profit order yesterday (Slice 0): ₺80 revenue, 2 units, no profit.
    const nullProfit = await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(14),
      saleSubtotalNet: '80.00',
      estimatedNetProfit: null,
    });
    await createOrderItem(nullProfit.id, org.id, { quantity: 2, unitCostSnapshotNet: null });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    // Volume counts BOTH orders.
    expect(body.revenueYesterday).toBe('280.00');
    expect(body.orderCountYesterday).toBe(2);
    expect(body.unitsSoldYesterday).toBe(3);
    // Profit family counts only the costed one.
    expect(body.netProfitYesterday).toBe('50.00');
    expect(body.marginYesterday).toBe('25.00'); // 50 / 200 costed revenue
    expect(body.profitCostRatioYesterday).toBe('62.50'); // 50 / 80 costed cost
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
    expect(body.unitsSoldToday).toBe(0);
    expect(body.marginToday).toBe('0.00');
    expect(body.profitCostRatioToday).toBe('0.00');
    expect(body.pendingRevenueToday).toBe('0.00');
    expect(body.pendingOrderCountToday).toBe(0);
  });
});
