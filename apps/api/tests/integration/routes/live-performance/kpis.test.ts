import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createProfitStatement,
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

    // A costed order today: 100 revenue, 20 profit, 60 cost over 2 units. The costed
    // numbers now come from the order's ESTIMATE statement, not the legacy columns.
    const costed = await createOrder(org.id, store.id, {
      orderDate: todayAt(12),
      saleGross: '100.00',
    });
    await createOrderItem(costed.id, org.id, { quantity: 2 });
    await createProfitStatement(costed.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '20.00',
      costGross: '60.00',
      saleMarginPct: '20.00',
    });

    // A cost-missing order in today's buffer: ₺60 revenue, 3 units, no profit yet.
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '60.00',
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

  it('excludes CANCELLED orders from every today aggregate (no payout, no revenue)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A live costed order: ₺100 revenue, ₺20 profit.
    const live = await createOrder(org.id, store.id, {
      orderDate: todayAt(11),
      saleGross: '100.00',
    });
    await createOrderItem(live.id, org.id, { quantity: 1 });
    await createProfitStatement(live.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '20.00',
      costGross: '30.00',
      saleMarginPct: '20.00',
    });

    // A cancelled order the same day -- must not move any number, even though its
    // estimate statement is ESTIMATED. (Both real cancels and leaked UnPacked
    // split-ghosts land on this status.)
    const cancelled = await createOrder(org.id, store.id, {
      orderDate: todayAt(12),
      saleGross: '500.00',
      status: 'CANCELLED',
    });
    await createOrderItem(cancelled.id, org.id, { quantity: 4 });
    await createProfitStatement(cancelled.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '90.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    expect(body.revenueToday).toBe('100.00');
    expect(body.orderCountToday).toBe(1);
    expect(body.unitsSoldToday).toBe(1);
    expect(body.netProfitToday).toBe('20.00');
  });

  it('yesterday: complete in orders (Slice 0 payoff) — counts null-profit orders for volume, excludes them from profit', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A costed order yesterday: 200 revenue, 50 profit, 80 cost.
    const costed = await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(10),
      saleGross: '200.00',
    });
    await createOrderItem(costed.id, org.id, { quantity: 1 });
    await createProfitStatement(costed.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '50.00',
      costGross: '80.00',
      saleMarginPct: '25.00',
    });

    // A persisted null-profit order yesterday (Slice 0): 80 revenue, 2 units, no
    // profit -- its estimate statement never reached ESTIMATED.
    const nullProfit = await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(14),
      saleGross: '80.00',
    });
    await createOrderItem(nullProfit.id, org.id, { quantity: 2 });
    await createProfitStatement(nullProfit.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'NOT_COMPUTABLE',
      netProfit: null,
    });

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

  it('counts only orders whose estimate statement is ESTIMATED as costed', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Costed: an ESTIMATED estimate statement (100 sale, 20 profit, 60 cost).
    const costed = await createOrder(org.id, store.id, {
      orderDate: todayAt(9),
      saleGross: '100.00',
    });
    await createOrderItem(costed.id, org.id, { quantity: 1 });
    await createProfitStatement(costed.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '20.00',
      costGross: '60.00',
      saleMarginPct: '20.00',
    });

    // Not computable: the estimate statement exists but never reached ESTIMATED, so
    // it adds to volume + pending but never to the profit family.
    const notComputable = await createOrder(org.id, store.id, {
      orderDate: todayAt(10),
      saleGross: '50.00',
    });
    await createOrderItem(notComputable.id, org.id, { quantity: 1 });
    await createProfitStatement(notComputable.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'NOT_COMPUTABLE',
      netProfit: null,
    });

    // Statement-less (writer has not caught up yet): volume + pending only.
    const statementless = await createOrder(org.id, store.id, {
      orderDate: todayAt(11),
      saleGross: '30.00',
    });
    await createOrderItem(statementless.id, org.id, { quantity: 1 });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    // Volume counts all three orders.
    expect(body.revenueToday).toBe('180.00');
    expect(body.orderCountToday).toBe(3);
    // Profit family counts only the ESTIMATED one.
    expect(body.netProfitToday).toBe('20.00');
    expect(body.marginToday).toBe('20.00'); // 20 / 100 costed revenue
    expect(body.profitCostRatioToday).toBe('33.33'); // 20 / 60 costed cost
    // Pending = universe - costed = the two uncosted orders (80, 2 orders).
    expect(body.pendingRevenueToday).toBe('80.00');
    expect(body.pendingOrderCountToday).toBe(2);
  });

  it("never adds an excluded order to yesterday's profit", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A costed order yesterday: 200 revenue, 50 profit.
    const costed = await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(10),
      saleGross: '200.00',
    });
    await createOrderItem(costed.id, org.id, { quantity: 1 });
    await createProfitStatement(costed.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '50.00',
      costGross: '80.00',
      saleMarginPct: '25.00',
    });

    // A stamped, profit-excluded order yesterday: its estimate statement is EXCLUDED
    // with a null net. Its revenue still counts; its (absent) profit never does.
    const excluded = await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(14),
      saleGross: '80.00',
    });
    await prisma.order.update({
      where: { id: excluded.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });
    await createOrderItem(excluded.id, org.id, { quantity: 1 });
    await createProfitStatement(excluded.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'EXCLUDED',
      netProfit: null,
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    expect(body.revenueYesterday).toBe('280.00');
    expect(body.orderCountYesterday).toBe(2);
    expect(body.netProfitYesterday).toBe('50.00');
  });

  it('does not count a CANCELLED estimate statement as costed', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // The order itself is live (not cancelled), but its ESTIMATE statement is CANCELLED.
    // The costed gate is the statement status, not the order status, so this order adds
    // to volume but never to the profit family -- even with a non-null net profit.
    const order = await createOrder(org.id, store.id, {
      orderDate: todayAt(10),
      saleGross: '100.00',
      status: 'DELIVERED',
    });
    await createOrderItem(order.id, org.id, { quantity: 1 });
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'CANCELLED',
      netProfit: '90.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    // Volume counts the order.
    expect(body.revenueToday).toBe('100.00');
    expect(body.orderCountToday).toBe(1);
    expect(body.unitsSoldToday).toBe(1);
    // Profit family does not -- the CANCELLED statement is not costed.
    expect(body.netProfitToday).toBe('0.00');
    expect(body.pendingRevenueToday).toBe('100.00');
    expect(body.pendingOrderCountToday).toBe(1);
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
