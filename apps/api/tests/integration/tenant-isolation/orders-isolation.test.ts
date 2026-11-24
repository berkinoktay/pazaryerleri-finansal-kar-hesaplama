import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason, ProfitStatementView } from '@pazarsync/db/enums';
import { getBusinessDateAnchor } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { completedBusinessDayInstant, openBusinessDayInstant } from '../../helpers/completed-day';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrder,
  createOrganization,
  createProfitStatement,
  createStore,
} from '../../helpers/factories';

interface OpenDayBody {
  finalizing: boolean;
  todayOrderCount: number;
  matches: { source: string; id: string; orderNumber: string; cancelled: boolean }[];
}

// Optional so a missing field fails on the assertion, not on the read.
interface ListBodyWithOpenDay {
  openDay?: OpenDayBody;
}

/**
 * Multi-tenancy invariant: an authenticated member of org A MUST NOT see orders
 * that belong to org B — even if A guesses B's storeId or orderId.
 *
 * Two boundaries are exercised:
 *   1. Org-level check: caller passes orgB in the URL → 403 FORBIDDEN.
 *   2. Cross-tenant store/order: caller passes orgA in the URL but a storeId/
 *      orderId that lives under orgB → 404 NOT_FOUND (existence non-disclosure).
 */
describe('Orders — tenant isolation', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('LIST: returns 403 when caller targets an org they do not belong to', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(`/v1/organizations/${orgB.id}/stores/${storeB.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it('LIST: returns 404 when caller targets their own org but a storeId that lives in another org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await createOrder(orgB.id, storeB.id, { orderDate: completedBusinessDayInstant() });

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeB.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    // Existence non-disclosure — caller learns nothing about orgB.
    expect(res.status).toBe(404);
  });

  it('SUMMARY: returns 403 when caller targets an org they do not belong to', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/orders/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(403);
  });

  it('SUMMARY: orgB orders never aggregate into orgA summary', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    // orgB carries a sale and a loss-making best-known statement on a completed business
    // day (the summary shows completed days only, so a today order would be hidden by
    // the date clamp and the test would pass without the tenant filter): without the
    // tenant filter, revenue, net profit, the loss count and its denominator would all
    // pick them up.
    const orderB = await createOrder(orgB.id, storeB.id, {
      saleGross: '999.00',
      orderDate: completedBusinessDayInstant(),
    });
    await createProfitStatement(orderB.id, orgB.id, storeB.id, {
      view: 'BEST_KNOWN',
      saleGross: '999.00',
      netProfit: '-50.00',
    });
    // Positive control: orgA's own completed-day order, with no statement, is counted
    // through the revenue fallback.
    await createOrder(orgA.id, storeA.id, {
      saleGross: '100.00',
      orderDate: completedBusinessDayInstant(),
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/orders/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body: {
      totalRevenueGross: string;
      netProfitGross: string;
      lossOrderRate: { lossCount: number; totalCount: number };
    } = await res.json();
    // Own order counted, orgB's 999 not.
    expect(body.totalRevenueGross).toBe('100');
    expect(body.lossOrderRate).toMatchObject({ lossCount: 0, totalCount: 0 });
    expect(body.netProfitGross).toBe('0');
  });

  it("GET: returns 404 when caller targets a sibling org's storeId via their own org", async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const orderB = await createOrder(orgB.id, storeB.id, {
      orderDate: completedBusinessDayInstant(),
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/orders/${orderB.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  it("GET: returns 404 when caller targets their own org/store with a sibling org's orderId", async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const orderB = await createOrder(orgB.id, storeB.id, {
      orderDate: completedBusinessDayInstant(),
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/orders/${orderB.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  it('LIST: a member of two orgs only sees orders for the org they query', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    await createMembership(orgB.id, user.id);

    const storeA = await createStore(orgA.id);
    const storeB = await createStore(orgB.id);
    const orderA = await createOrder(orgA.id, storeA.id, {
      orderDate: completedBusinessDayInstant(),
    });
    await createOrder(orgB.id, storeB.id, { orderDate: completedBusinessDayInstant() });

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeA.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((o) => o.id)).toEqual([orderA.id]);
  });

  it("GET: vendorMissing does not leak — org B's identical barcode is false when only org A has the miss row", async () => {
    // Both orgs have an unmatched line carrying the SAME printed barcode, but
    // only org A's store has a CatalogBarcodeMiss{vendorMissing:true} row. The
    // derivation join is org+store scoped, so org B must read vendorMissing=false
    // (no cross-tenant leak of A's confirmed catalog gap).
    const barcode = 'SHARED-GAP-BC';

    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    const orderA = await createOrder(orgA.id, storeA.id, {
      orderDate: completedBusinessDayInstant(),
    });
    await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        organizationId: orgA.id,
        productVariantId: null,
        barcode,
        platformLineId: 9301n,
        quantity: 1,
      },
    });
    // A stored best-known statement keeps the detail on its read path rather than
    // computing in-request; this test only exercises vendorMissing, not profit.
    await createProfitStatement(orderA.id, orgA.id, storeA.id, { view: 'BEST_KNOWN' });
    await prisma.catalogBarcodeMiss.create({
      data: { organizationId: orgA.id, storeId: storeA.id, barcode, vendorMissing: true },
    });

    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await createStore(orgB.id);
    const orderB = await createOrder(orgB.id, storeB.id, {
      orderDate: completedBusinessDayInstant(),
    });
    await prisma.orderItem.create({
      data: {
        orderId: orderB.id,
        organizationId: orgB.id,
        productVariantId: null,
        barcode,
        platformLineId: 9302n,
        quantity: 1,
      },
    });
    await createProfitStatement(orderB.id, orgB.id, storeB.id, { view: 'BEST_KNOWN' });

    // Org A sees its own confirmed gap as true.
    const resA = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/orders/${orderA.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as { items: { vendorMissing: boolean }[] };
    expect(bodyA.items[0]?.vendorMissing).toBe(true);

    // Org B has the identical barcode but no miss row of its own → false.
    const resB = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/orders/${orderB.id}`,
      { headers: { Authorization: bearer(userB.accessToken) } },
    );
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as { items: { vendorMissing: boolean }[] };
    expect(bodyB.items[0]?.vendorMissing).toBe(false);
  });

  it('LIST: counts reflect only the queried org, never a sibling org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    // Not stamped → "calculated" tab (decision 3 — the stamp is the segment key).
    await createOrder(orgA.id, storeA.id, { orderDate: completedBusinessDayInstant() });
    const excludedA = await createOrder(orgA.id, storeA.id, {
      orderDate: completedBusinessDayInstant(),
    });
    await prisma.order.update({
      where: { id: excludedA.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    for (let i = 0; i < 5; i += 1) {
      const excludedB = await createOrder(orgB.id, storeB.id, {
        orderDate: completedBusinessDayInstant(),
      });
      await prisma.order.update({
        where: { id: excludedB.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'LATE_UNCOSTED_ARRIVAL' },
      });
    }

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeA.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: { calculated: number; excluded: number } };
    expect(body.counts).toEqual({ calculated: 1, excluded: 1 });
  });

  it('ignores a statement row filed under another organization', async () => {
    // Another organization carries a fully-settled best-known statement with a 999
    // net profit on its own order. Every list/summary query filters statements by
    // org A, so org B's statement must never be read into org A's profit fields or
    // totals. (Mis-attributing a statement onto org A's own order is impossible now:
    // the composite tenant FK rejects it -- see the profit-row-tenant-fk db test.)
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const orderA = await createOrder(orgA.id, storeA.id, {
      orderDate: completedBusinessDayInstant(),
      status: 'DELIVERED',
      saleGross: '240.00',
    });
    const orderB = await createOrder(orgB.id, storeB.id, {
      orderDate: completedBusinessDayInstant(),
      status: 'DELIVERED',
      saleGross: '999.00',
    });
    await createProfitStatement(orderB.id, orgB.id, storeB.id, {
      view: 'BEST_KNOWN',
      status: 'SETTLED',
      saleGross: '999.00',
      netProfit: '999.00',
      saleMarginPct: '99.00',
      reconciliationStatus: 'FULLY_SETTLED',
    });

    const listRes = await app.request(`/v1/organizations/${orgA.id}/stores/${storeA.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: {
        id: string;
        estimatedNetProfit: string | null;
        settledNetProfit: string | null;
        saleMarginPct: string | null;
        saleGross: string | null;
        reconciliationStatus: string;
      }[];
    };
    const row = listBody.data.find((o) => o.id === orderA.id);
    expect(row?.estimatedNetProfit).toBeNull();
    expect(row?.settledNetProfit).toBeNull();
    expect(row?.saleMarginPct).toBeNull();
    // Falls back to the order's own sale, never the foreign 999.
    expect(row?.saleGross).toBe('240');
    expect(row?.reconciliationStatus).toBe('NOT_SETTLED');

    const summaryRes = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/orders/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(summaryRes.status).toBe(200);
    const summaryBody = (await summaryRes.json()) as {
      totalRevenueGross: string;
      netProfitGross: string;
    };
    // The foreign 999 never enters org A's totals; revenue falls back to 240.
    expect(summaryBody.netProfitGross).toBe('0');
    expect(summaryBody.totalRevenueGross).toBe('240');
  });

  it('ignores a foreign-organization statement in the margin sort', async () => {
    // Another organization carries a best-known statement with a 99 margin on its own
    // order. The margin sort partitions statements by org A (segment 1, ordered by
    // margin) and org A orders with no best-known statement (segment 2, ordered by id).
    // Org B's statement must count for neither: under sort=-marginPct org A's order
    // lands in segment 2 and reads its own sale, never the foreign 999/99. (A statement
    // mis-attributed onto org A's own order is impossible now: the composite tenant FK
    // rejects it -- see the profit-row-tenant-fk db test.)
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const orderA = await createOrder(orgA.id, storeA.id, {
      orderDate: completedBusinessDayInstant(),
      status: 'DELIVERED',
      saleGross: '240.00',
    });
    const orderB = await createOrder(orgB.id, storeB.id, {
      orderDate: completedBusinessDayInstant(),
      status: 'DELIVERED',
      saleGross: '999.00',
    });
    await createProfitStatement(orderB.id, orgB.id, storeB.id, {
      view: 'BEST_KNOWN',
      status: 'SETTLED',
      saleGross: '999.00',
      netProfit: '999.00',
      saleMarginPct: '99.00',
      reconciliationStatus: 'FULLY_SETTLED',
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/orders?sort=-marginPct`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; saleGross: string | null; saleMarginPct: string | null }[];
    };
    expect(body.data.map((o) => o.id)).toEqual([orderA.id]);
    const row = body.data.find((o) => o.id === orderA.id);
    // Falls back to the order's own sale and a null margin, never the foreign 999/99.
    expect(row?.saleGross).toBe('240');
    expect(row?.saleMarginPct).toBeNull();
  });

  // --- openDay: every source is read for the queried organization and store only ---

  async function openDayOf(
    accessToken: string,
    orgId: string,
    storeId: string,
    query = '',
  ): Promise<OpenDayBody | undefined> {
    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/orders${query}`, {
      headers: { Authorization: bearer(accessToken) },
    });
    expect(res.status).toBe(200);
    const body: ListBodyWithOpenDay = await res.json();
    return body.openDay;
  }

  // A queued profit recompute for an order (no factory for the queue).
  async function queueRecompute(
    orgId: string,
    storeId: string,
    orderId: string,
    reason: ProfitRecomputeReason,
  ) {
    await prisma.profitRecomputeRequest.create({
      data: { organizationId: orgId, storeId, orderId, reason },
    });
  }

  async function createFinalOrder(orgId: string, storeId: string) {
    return createOrder(orgId, storeId, {
      orderDate: completedBusinessDayInstant(),
      sellerInputsFinalAt: new Date(),
    });
  }

  // A final completed-day order that already has its best-known figures.
  async function createFinalOrderWithFigures(orgId: string, storeId: string) {
    const order = await createFinalOrder(orgId, storeId);
    await createProfitStatement(order.id, orgId, storeId, { view: ProfitStatementView.BEST_KNOWN });
    return order;
  }

  // Every source of `finalizing` for one store: a non-final completed-day order, a past-day
  // buffer row waiting for graduation, a queued DAY_CLOSE recompute of a final order with
  // figures, and a born-final order whose first recompute (another reason) is still queued.
  async function seedFinalizingSources(orgId: string, storeId: string): Promise<void> {
    await createOrder(orgId, storeId, { orderDate: completedBusinessDayInstant() });
    await createBufferEntry(orgId, storeId, {
      orderDate: getBusinessDateAnchor(completedBusinessDayInstant()),
    });
    const closedOrder = await createFinalOrderWithFigures(orgId, storeId);
    await queueRecompute(orgId, storeId, closedOrder.id, ProfitRecomputeReason.DAY_CLOSE);
    const bornFinalOrder = await createFinalOrder(orgId, storeId);
    await queueRecompute(orgId, storeId, bornFinalOrder.id, ProfitRecomputeReason.ORDER_CHANGED);
  }

  it('LIST: finalizing reflects only the queried store', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // Each source would set store A1's flag without its tenant and store filters.
    await seedFinalizingSources(orgB.id, storeB.id);
    await seedFinalizingSources(orgA.id, storeA2.id);
    // Store A1 itself has only a final order with figures and nothing queued.
    const finalA1 = await createFinalOrderWithFigures(orgA.id, storeA1.id);

    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id))?.finalizing).toBe(false);

    // Positive controls, one source at a time, each seeded for store A1 itself.
    const ownBuffer = await createBufferEntry(orgA.id, storeA1.id, {
      orderDate: getBusinessDateAnchor(completedBusinessDayInstant()),
    });
    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id))?.finalizing).toBe(true);
    await prisma.livePerformanceBuffer.delete({ where: { id: ownBuffer.id } });

    await queueRecompute(orgA.id, storeA1.id, finalA1.id, ProfitRecomputeReason.DAY_CLOSE);
    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id))?.finalizing).toBe(true);
    await prisma.profitRecomputeRequest.delete({ where: { orderId: finalA1.id } });

    const bornFinalA1 = await createFinalOrder(orgA.id, storeA1.id);
    await queueRecompute(orgA.id, storeA1.id, bornFinalA1.id, ProfitRecomputeReason.ORDER_CHANGED);
    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id))?.finalizing).toBe(true);
    await prisma.profitRecomputeRequest.delete({ where: { orderId: bornFinalA1.id } });

    await createOrder(orgA.id, storeA1.id, { orderDate: completedBusinessDayInstant() });
    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id))?.finalizing).toBe(true);
  });

  it('LIST: todayOrderCount counts only the queried store', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // Today's stored order and buffer row in org B and in store A2 of org A.
    for (const scope of [
      { orgId: orgB.id, storeId: storeB.id },
      { orgId: orgA.id, storeId: storeA2.id },
    ]) {
      await createOrder(scope.orgId, scope.storeId, { orderDate: openBusinessDayInstant() });
      await createBufferEntry(scope.orgId, scope.storeId, { orderDate: getBusinessDateAnchor() });
    }

    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id))?.todayOrderCount).toBe(0);

    // Positive control: store A1's own order and buffer row of today are counted.
    await createOrder(orgA.id, storeA1.id, { orderDate: openBusinessDayInstant() });
    await createBufferEntry(orgA.id, storeA1.id, { orderDate: getBusinessDateAnchor() });
    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id))?.todayOrderCount).toBe(2);
  });

  it("LIST: search never returns another tenant's open-day match", async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // Today's order and buffer entry with the searched number, in org B and in store A2.
    for (const scope of [
      { orgId: orgB.id, storeId: storeB.id },
      { orgId: orgA.id, storeId: storeA2.id },
    ]) {
      await createOrder(scope.orgId, scope.storeId, {
        orderDate: openBusinessDayInstant(),
        platformOrderNumber: 'SHARED-123',
      });
      await createBufferEntry(scope.orgId, scope.storeId, {
        orderDate: getBusinessDateAnchor(),
        platformOrderNumber: 'SHARED-123',
      });
    }

    const query = '?q=SHARED-123';
    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id, query))?.matches).toEqual([]);

    // Positive control: store A1's own order and buffer entry of today match.
    const ownOrder = await createOrder(orgA.id, storeA1.id, {
      orderDate: openBusinessDayInstant(),
      platformOrderNumber: 'SHARED-123-A',
    });
    const ownBuffer = await createBufferEntry(orgA.id, storeA1.id, {
      orderDate: getBusinessDateAnchor(),
      platformOrderNumber: 'SHARED-123-B',
    });
    expect((await openDayOf(user.accessToken, orgA.id, storeA1.id, query))?.matches).toEqual([
      { source: 'orders', id: ownOrder.id, orderNumber: 'SHARED-123-A', cancelled: false },
      { source: 'buffer', id: ownBuffer.id, orderNumber: 'SHARED-123-B', cancelled: false },
    ]);
  });
});
