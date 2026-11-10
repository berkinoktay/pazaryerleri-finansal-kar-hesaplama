import type { MappedOrder } from '@pazarsync/marketplace';
import { intakeOrder } from '@pazarsync/order-sync';
import { computeParcelProfit } from '@pazarsync/profit';
import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/app';
import { LIVE_IN_REQUEST_ESTIMATE_LIMIT } from '@/services/live-performance.service';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { seedCalculableTrendyolOrder } from '../../../helpers/calculable-order';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
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

const GRADUATE_BARCODE = 'EAN13-KPIS-GRADUATE';

// A single-line MappedOrder (real Date objects -- intakeOrder receives the in-memory
// DTO) for driving the buffer -> cost-attach -> re-delivery flow end-to-end.
function buildMapped(platformOrderId: string, orderDate: Date): MappedOrder {
  return {
    platformOrderId,
    platformOrderNumber: `ord-${platformOrderId}`,
    orderDate,
    lastModifiedDate: orderDate,
    status: 'PROCESSING',
    dematerialized: false,
    packagePending: false,
    saleGross: '100.00',
    saleVat: '15.25',
    listGross: '100.00',
    sellerDiscountGross: '0.00',
    promotionDisplays: null,
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    actualShipDate: null,
    fastDelivery: false,
    fastDeliveryType: null,
    micro: false,
    estimatedDeliveryStartDate: null,
    estimatedDeliveryEndDate: null,
    cargoProviderName: null,
    cargoTrackingNumber: null,
    cargoDeci: null,
    usesSellerCargoAgreement: false,
    platformCreatedBy: null,
    originShipmentDate: null,
    lines: [
      {
        barcode: GRADUATE_BARCODE,
        quantity: 1,
        platformLineId: null,
        lineListGross: '100.00',
        lineSaleGross: '100.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '18',
        commissionRate: '15',
        commissionGross: '15.00',
        refundedCommissionGross: '0.00',
        commissionVatRate: '20',
        categoryId: null,
        commissionKnown: true,
      },
    ],
  };
}

// A cost-MISSING variant (resolves by barcode, no cost profile attached yet) so the
// first intake routes to the buffer.
async function seedCostMissingVariant(
  orgId: string,
  storeId: string,
  barcode: string,
): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'KPIs Graduate Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
    },
  });
}

// Attach a cost profile to the variant, flipping it from cost-missing to calculable.
async function attachCost(orgId: string, storeId: string, barcode: string): Promise<void> {
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { storeId, barcode } });
  const profile = await createCostProfile(orgId, { storeId, amountGross: '40.00' });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: orgId, productVariantId: variant.id, profileId: profile.id },
  });
}

interface KpisBody {
  revenueToday: string;
  revenueYesterday: string;
  orderCountToday: number;
  orderCountYesterday: number;
  unitsSoldToday: number;
  unitsSoldYesterday: number;
  netProfitToday: string;
  netProfitYesterday: string | null;
  marginToday: string | null;
  marginYesterday: string | null;
  profitCostRatioToday: string | null;
  profitCostRatioYesterday: string | null;
  pendingRevenueToday: string;
  pendingOrderCountToday: number;
}

const LIMIT_WARNING = '[profit-read] live in-request estimate limit reached';
const PROFIT_READ_FAILURE = '[profit-read] in-request profit computation failed';

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
      saleGross: '100.00',
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
      saleGross: '200.00',
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
      saleGross: '100.00',
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

    // Two statement-less orders (writer has not caught up yet): the request tries to
    // compute each, both computations fail here and are logged together in ONE line, so
    // the orders stay volume + pending only and the KPIs still answer 200.
    const statementless = await createOrder(org.id, store.id, {
      orderDate: todayAt(11),
      saleGross: '30.00',
    });
    await createOrderItem(statementless.id, org.id, { quantity: 1 });
    const secondStatementless = await createOrder(org.id, store.id, {
      orderDate: todayAt(13),
      saleGross: '20.00',
    });
    await createOrderItem(secondStatementless.id, org.id, { quantity: 1 });

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as KpisBody;
      // Volume counts all four orders.
      expect(body.revenueToday).toBe('200.00');
      expect(body.orderCountToday).toBe(4);
      // Profit family counts only the ESTIMATED one.
      expect(body.netProfitToday).toBe('20.00');
      expect(body.marginToday).toBe('20.00'); // 20 / 100 costed revenue
      expect(body.profitCostRatioToday).toBe('33.33'); // 20 / 60 costed cost
      // Pending = universe - costed = the three uncosted orders (100, 3 orders).
      expect(body.pendingRevenueToday).toBe('100.00');
      expect(body.pendingOrderCountToday).toBe(3);

      // The failed in-request computations are logged once per request, not per order.
      const failureLogs = error.mock.calls.filter((call) => call[0] === PROFIT_READ_FAILURE);
      expect(failureLogs).toHaveLength(1);
      expect(failureLogs[0]?.[1]).toMatchObject({
        surface: 'live-performance',
        organizationId: org.id,
        orderId: null,
        failedCount: 2,
      });
    } finally {
      error.mockRestore();
    }
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

  it('returns zeroes and null ratios (not an error) for a store with no orders', async () => {
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
    // No costed order -> no denominator, so the ratios are null rather than a fake 0.
    expect(body.marginToday).toBeNull();
    expect(body.profitCostRatioToday).toBeNull();
    expect(body.pendingRevenueToday).toBe('0.00');
    expect(body.pendingOrderCountToday).toBe(0);
  });

  it('counts an order once after a re-delivery makes it calculable', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    await seedCostMissingVariant(org.id, store.id, GRADUATE_BARCODE);

    // Noon UTC (15:00 Istanbul) so the order falls unambiguously inside today's window.
    const todayInstant = new Date(getBusinessDayRange().start.getTime() + 12 * 60 * 60 * 1000);
    const mapped = buildMapped('kpis-graduate', todayInstant);

    // 1. Cost-missing today -> buffered.
    const first = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    expect(first).toEqual({ kind: 'buffered' });

    // 2. Cost attached -> calculable. 3. The same order re-delivers -> it persists and
    //    its buffer row is graduated away. Before the fix the order sat in BOTH `orders`
    //    and the buffer, so getKpis (which unions the two for today) counted its 100.00
    //    revenue, its order and its unit twice (revenue 200.00, count 2, units 2).
    await attachCost(org.id, store.id, GRADUATE_BARCODE);
    const second = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    expect(second).toEqual({ kind: 'persisted', reason: 'calculable' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    // Counted exactly once: the graduated order in `orders`, no lingering buffer row.
    expect(body.revenueToday).toBe('100.00');
    expect(body.orderCountToday).toBe(1);
    expect(body.unitsSoldToday).toBe(1);
  });

  it('computes a costed order in the request when its statement is not written yet', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    // A calculable order dated now (today) with no stored statement: the writer has not
    // caught up yet, so the KPIs compute its profit read-only in the request.
    const orderId = await seedCalculableTrendyolOrder(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;

    // The served profit matches a fresh read-only computation of the same parcel.
    const computed = await computeParcelProfit(prisma, { organizationId: org.id, orderId });
    const expectedNet = computed.estimate.netProfit;
    if (expectedNet === null) throw new Error('estimate net profit unexpectedly null');
    expect(expectedNet.isZero()).toBe(false);
    expect(body.netProfitToday).toBe(expectedNet.toFixed(2));
    expect(body.orderCountToday).toBe(1);
    expect(body.pendingOrderCountToday).toBe(0);

    // The request wrote nothing: no statement row exists afterwards.
    expect(await prisma.orderProfitStatement.count({ where: { orderId } })).toBe(0);
  });

  it('stops computing in the request past the limit and counts the rest as pending', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    // One more statement-less calculable order than a request may compute (first deploy
    // backlog): the overflow order stays pending instead of being computed.
    const orderCount = LIVE_IN_REQUEST_ESTIMATE_LIMIT + 1;
    for (let index = 0; index < orderCount; index += 1) {
      await seedCalculableTrendyolOrder(org.id, store.id);
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as KpisBody;
      expect(body.orderCountToday).toBe(orderCount);
      expect(body.pendingOrderCountToday).toBe(1);
      // The skipped overflow is logged once per request, not once per order.
      const limitWarnings = warn.mock.calls.filter((call) => call[0] === LIMIT_WARNING);
      expect(limitWarnings).toHaveLength(1);
      expect(limitWarnings[0]?.[1]).toEqual({
        organizationId: org.id,
        storeId: store.id,
        skipped: 1,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('divides the margin by the statement sale after a return', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // The order sold 280 but half came back: the statement's sale is 140 and its profit
    // already carries the return. The margin must divide by the 140 the profit was
    // computed from, while revenue keeps the order's own 280.
    const order = await createOrder(org.id, store.id, {
      orderDate: todayAt(12),
      saleGross: '280.00',
    });
    await createOrderItem(order.id, org.id, { quantity: 2 });
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      saleGross: '140.00',
      netProfit: '-188.56',
      costGross: '100.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/kpis`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as KpisBody;
    expect(body.revenueToday).toBe('280.00');
    expect(body.netProfitToday).toBe('-188.56');
    expect(body.marginToday).toBe('-134.69'); // -188.56 / 140 statement sale
    expect(body.profitCostRatioToday).toBe('-188.56'); // -188.56 / 100 statement cost
    // The costed order is not pending, whatever its statement sale.
    expect(body.pendingRevenueToday).toBe('0.00');
    expect(body.pendingOrderCountToday).toBe(0);
  });

  it('returns null profit metrics for a day without a costed order', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Yesterday's only order is profit-excluded: volume counts, profit has no source.
    const excluded = await createOrder(org.id, store.id, {
      orderDate: yesterdayAt(10),
      saleGross: '80.00',
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
    expect(body.revenueYesterday).toBe('80.00');
    expect(body.netProfitYesterday).toBeNull();
    expect(body.marginYesterday).toBeNull();
    expect(body.profitCostRatioYesterday).toBeNull();
    // Today has no order at all: the net stays a zero sum, the ratios have no base.
    expect(body.netProfitToday).toBe('0.00');
    expect(body.marginToday).toBeNull();
    expect(body.profitCostRatioToday).toBeNull();
  });
});
