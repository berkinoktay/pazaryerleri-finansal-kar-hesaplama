import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  buildStatementBreakdown,
  computeParcelProfit,
  recomputeParcelProfit,
  statementTotalsFromStatement,
} from '@pazarsync/profit';

import { createApp } from '../../../src/app';
import { listOrders } from '../../../src/services/order.service';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { seedCalculableTrendyolOrder } from '../../helpers/calculable-order';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderClaim,
  createOrderClaimItem,
  createOrganization,
  createProfitLine,
  createProfitStatement,
  createStore,
} from '../../helpers/factories';

describe('Order routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Seed helpers ─────────────────────────────────────────────────────────

  // Seeds an order plus its estimate + best-known statements (net 60, margin 25
  // by default) so the list reads its profit fields from the statements, not the
  // legacy columns. Overrides shape the best-known view the list surfaces.
  async function seedSimpleOrder(
    orgId: string,
    storeId: string,
    overrides: {
      status?: 'DELIVERED' | 'PROCESSING' | 'CANCELLED' | 'RETURNED' | 'SHIPPED' | 'PENDING';
      platformOrderNumber?: string;
      orderDate?: Date;
      netProfit?: string;
      saleMarginPct?: string;
      costMarkupPct?: string | null;
    } = {},
  ) {
    const base = await createOrder(orgId, storeId, { status: overrides.status ?? 'DELIVERED' });
    const order = await prisma.order.update({
      where: { id: base.id },
      data: {
        platformOrderNumber: overrides.platformOrderNumber ?? `ON-${randomUUID().slice(0, 6)}`,
        orderDate: overrides.orderDate ?? base.orderDate,
        // GROSS konvansiyon: saleGross = KDV-dahil satış (eski net 200 + KDV 40).
        saleGross: new Decimal('240.00'),
        saleVat: new Decimal('40.00'),
      },
    });

    const netProfit = overrides.netProfit ?? '60.00';
    const saleMarginPct = overrides.saleMarginPct ?? '25.00';
    await createProfitStatement(order.id, orgId, storeId, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      saleGross: '240.00',
      netProfit,
      saleMarginPct,
    });
    await createProfitStatement(order.id, orgId, storeId, {
      view: 'BEST_KNOWN',
      status: 'ESTIMATED',
      saleGross: '240.00',
      netProfit,
      saleMarginPct,
      costMarkupPct: overrides.costMarkupPct ?? null,
    });

    return order;
  }

  // ─── GET /v1/organizations/:orgId/stores/:storeId/orders ──────────────────

  describe('GET /v1/organizations/:orgId/stores/:storeId/orders', () => {
    it('returns 401 without a token', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`);
      expect(res.status).toBe(401);
    });

    it('returns costMarkupPct (ROI) on list items', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      await seedSimpleOrder(org.id, store.id, { costMarkupPct: '38.40' });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // ROI reads the best-known statement's cost markup.
      expect(body.data[0].costMarkupPct).toBe('38.4');
    });

    it('lossOnly=true returns only orders whose consumed net profit is negative', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const profitable = await seedSimpleOrder(org.id, store.id);
      const losing = await seedSimpleOrder(org.id, store.id, { netProfit: '-50.00' });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?lossOnly=true`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = body.data.map((o: { id: string }) => o.id);
      expect(ids).toContain(losing.id);
      expect(ids).not.toContain(profitable.id);
    });

    it('lossOnly ignores an excluded order with no net profit', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const losing = await createOrder(org.id, store.id);
      await createProfitStatement(losing.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '240.00',
        netProfit: '-30.00',
        saleMarginPct: '-12.50',
      });
      // Excluded order: the best-known net profit is null, so the lossOnly filter
      // (best-known net < 0) must never match it, even though it carries no profit.
      const excluded = await createOrder(org.id, store.id);
      await prisma.order.update({
        where: { id: excluded.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
      });
      await createProfitStatement(excluded.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'EXCLUDED',
        saleGross: '240.00',
        netProfit: null,
        saleMarginPct: null,
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?lossOnly=true`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string }[] };
      const ids = body.data.map((o) => o.id);
      expect(ids).toContain(losing.id);
      expect(ids).not.toContain(excluded.id);
    });

    it('returns 403 when caller is not a member of the org', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      const store = await createStore(org.id);
      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when the store does not belong to the org', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const otherOrg = await createOrganization();
      const otherStore = await createStore(otherOrg.id);

      const res = await app.request(`/v1/organizations/${org.id}/stores/${otherStore.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(404);
    });

    it('returns an empty page for a store with no orders', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: unknown[];
        pagination: { page: number; perPage: number; total: number; totalPages: number };
      };
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
      expect(body.pagination.totalPages).toBe(0);
    });

    it('returns orders sorted by orderDate desc with itemCount', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const older = await seedSimpleOrder(org.id, store.id, {
        orderDate: new Date('2026-04-01T10:00:00Z'),
      });
      const newer = await seedSimpleOrder(org.id, store.id, {
        orderDate: new Date('2026-04-15T10:00:00Z'),
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { id: string; orderDate: string; itemCount: number }[];
      };
      expect(body.data.map((o) => o.id)).toEqual([newer.id, older.id]);
      expect(body.data[0]?.itemCount).toBe(0);
    });

    it('exposes saleMarginPct from the best-known statement', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const a = await seedSimpleOrder(org.id, store.id, {
        orderDate: new Date('2026-04-02T10:00:00Z'),
        saleMarginPct: '18.50',
      });
      const b = await seedSimpleOrder(org.id, store.id, {
        orderDate: new Date('2026-04-01T10:00:00Z'),
        saleMarginPct: '17.25',
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string; saleMarginPct: string | null }[] };
      const byId = new Map(body.data.map((o) => [o.id, o.saleMarginPct]));
      expect(byId.get(a.id)).toBe('18.5');
      expect(byId.get(b.id)).toBe('17.25');
    });

    it('serves promotionDisplays on list rows (null when the order has no promotion)', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const withPromo = await createOrder(org.id, store.id, {
        orderDate: new Date('2026-04-02T10:00:00Z'),
        promotionDisplays: [{ displayName: 'Sepette İndirim', amountGross: '20.00' }],
      });
      const noPromo = await createOrder(org.id, store.id, {
        orderDate: new Date('2026-04-01T10:00:00Z'),
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: {
          id: string;
          promotionDisplays: { displayName: string; amountGross: string }[] | null;
        }[];
      };
      const byId = new Map(body.data.map((o) => [o.id, o.promotionDisplays]));
      expect(byId.get(withPromo.id)).toEqual([
        { displayName: 'Sepette İndirim', amountGross: '20.00' },
      ]);
      // No promotion → null (the frontend hides the indicator).
      expect(byId.get(noPromo.id)).toBeNull();
    });

    it('sorts by saleMarginPct ascending and descending via sort=marginPct', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const low = await seedSimpleOrder(org.id, store.id, { saleMarginPct: '5.00' });
      const mid = await seedSimpleOrder(org.id, store.id, { saleMarginPct: '15.00' });
      const high = await seedSimpleOrder(org.id, store.id, { saleMarginPct: '40.00' });

      const asc = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?sort=marginPct`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const ascBody = (await asc.json()) as { data: { id: string }[] };
      expect(ascBody.data.map((o) => o.id)).toEqual([low.id, mid.id, high.id]);

      const desc = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?sort=-marginPct`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const descBody = (await desc.json()) as { data: { id: string }[] };
      expect(descBody.data.map((o) => o.id)).toEqual([high.id, mid.id, low.id]);
    });

    it('returns the estimated and settled net profit from the two statements', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // Reconciliation started → settled net profit surfaces (the best-known net).
      const settled = await createOrder(org.id, store.id, {
        orderDate: new Date('2026-04-02T10:00:00Z'),
      });
      await createProfitStatement(settled.id, org.id, store.id, {
        view: 'ESTIMATE',
        status: 'ESTIMATED',
        saleGross: '240.00',
        netProfit: '60.00',
      });
      await createProfitStatement(settled.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'PARTIALLY_SETTLED',
        saleGross: '240.00',
        netProfit: '55.00',
        reconciliationStatus: 'PARTIALLY_SETTLED',
      });

      // Best-known still NOT_SETTLED → settled net profit stays null (decision 1).
      const unsettled = await createOrder(org.id, store.id, {
        orderDate: new Date('2026-04-01T10:00:00Z'),
      });
      await createProfitStatement(unsettled.id, org.id, store.id, {
        view: 'ESTIMATE',
        status: 'ESTIMATED',
        saleGross: '240.00',
        netProfit: '70.00',
      });
      await createProfitStatement(unsettled.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'ESTIMATED',
        saleGross: '240.00',
        netProfit: '70.00',
        reconciliationStatus: 'NOT_SETTLED',
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { id: string; estimatedNetProfit: string | null; settledNetProfit: string | null }[];
      };
      const byId = new Map(body.data.map((o) => [o.id, o]));
      expect(byId.get(settled.id)?.estimatedNetProfit).toBe('60');
      expect(byId.get(settled.id)?.settledNetProfit).toBe('55');
      expect(byId.get(unsettled.id)?.estimatedNetProfit).toBe('70');
      expect(byId.get(unsettled.id)?.settledNetProfit).toBeNull();
    });

    it('filters by reconciliationStatus from the best-known statement', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const partial = await createOrder(org.id, store.id);
      await createProfitStatement(partial.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '240.00',
        netProfit: '55.00',
        reconciliationStatus: 'PARTIALLY_SETTLED',
      });
      const notSettled = await createOrder(org.id, store.id);
      await createProfitStatement(notSettled.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '240.00',
        netProfit: '60.00',
        reconciliationStatus: 'NOT_SETTLED',
      });
      const noStatement = await createOrder(org.id, store.id);

      const notSettledRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?reconciliationStatus=NOT_SETTLED`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const notSettledBody = (await notSettledRes.json()) as { data: { id: string }[] };
      const notSettledIds = notSettledBody.data.map((o) => o.id);
      // NOT_SETTLED includes the statement-less order (decision 2).
      expect(notSettledIds).toContain(notSettled.id);
      expect(notSettledIds).toContain(noStatement.id);
      expect(notSettledIds).not.toContain(partial.id);

      const partialRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?reconciliationStatus=PARTIALLY_SETTLED`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const partialBody = (await partialRes.json()) as { data: { id: string }[] };
      expect(partialBody.data.map((o) => o.id)).toEqual([partial.id]);
    });

    it('filters by reconciliationStatus FULLY_SETTLED', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const fully = await createOrder(org.id, store.id);
      await createProfitStatement(fully.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'SETTLED',
        saleGross: '240.00',
        netProfit: '50.00',
        reconciliationStatus: 'FULLY_SETTLED',
      });
      const partial = await createOrder(org.id, store.id);
      await createProfitStatement(partial.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '240.00',
        netProfit: '55.00',
        reconciliationStatus: 'PARTIALLY_SETTLED',
      });
      const notSettled = await createOrder(org.id, store.id);
      await createProfitStatement(notSettled.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '240.00',
        netProfit: '60.00',
        reconciliationStatus: 'NOT_SETTLED',
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?reconciliationStatus=FULLY_SETTLED`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string }[] };
      // Only the fully-settled best-known statement matches; partial and not-settled drop.
      expect(body.data.map((o) => o.id)).toEqual([fully.id]);
    });

    it('breaks equal margins by order id across the segment boundary', async () => {
      // Three orders share the same best-known margin, so segment 1 falls back to
      // its order-id-descending tiebreaker; a fourth order has no statement and
      // lands in segment 2 (also order id descending). perPage 2 forces the two
      // segments to meet mid-page, proving the tiebreaker is stable across the
      // boundary with no repeat or gap.
      const org = await createOrganization();
      const store = await createStore(org.id);

      const withStatement: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const order = await createOrder(org.id, store.id);
        await createProfitStatement(order.id, org.id, store.id, {
          view: 'BEST_KNOWN',
          saleGross: '100.00',
          netProfit: '10.00',
          saleMarginPct: '10.00',
        });
        withStatement.push(order.id);
      }
      const noStatement = await createOrder(org.id, store.id);

      // Segment 1 shares one margin → order id descending; segment 2 follows.
      const expected = [...[...withStatement].sort().reverse(), noStatement.id];

      for (const sort of ['marginPct', '-marginPct'] as const) {
        const paged: string[] = [];
        for (let page = 1; page <= 2; page += 1) {
          const result = await listOrders(org.id, store.id, { page, perPage: 2, sort });
          for (const row of result.data) paged.push(row.id);
        }
        expect(paged).toEqual(expected);
        expect(new Set(paged).size).toBe(4);
      }
    });

    it('pages a margin sort across orders with and without a statement', async () => {
      // perPage 2 forces the segment-1 (has a statement) / segment-2 (none)
      // boundary mid-page, so it exercises listOrders directly (the wire schema
      // locks perPage to {10,25,50,100}).
      const org = await createOrganization();
      const store = await createStore(org.id);

      const m5 = await createOrder(org.id, store.id);
      await createProfitStatement(m5.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '100.00',
        netProfit: '5.00',
        saleMarginPct: '5.00',
      });
      const m15 = await createOrder(org.id, store.id);
      await createProfitStatement(m15.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '100.00',
        netProfit: '15.00',
        saleMarginPct: '15.00',
      });
      const mNull = await createOrder(org.id, store.id);
      await createProfitStatement(mNull.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '100.00',
        netProfit: null,
        saleMarginPct: null,
      });
      const noStmtA = await createOrder(org.id, store.id);
      const noStmtB = await createOrder(org.id, store.id);

      // Segment 2 is ordered by order id descending in both directions.
      const segment2Desc = [noStmtA.id, noStmtB.id].sort().reverse();

      for (const sort of ['marginPct', '-marginPct'] as const) {
        const segment1 =
          sort === 'marginPct' ? [m5.id, m15.id, mNull.id] : [m15.id, m5.id, mNull.id];
        const expected = [...segment1, ...segment2Desc];

        const paged: string[] = [];
        for (let page = 1; page <= 3; page += 1) {
          const result = await listOrders(org.id, store.id, { page, perPage: 2, sort });
          for (const row of result.data) paged.push(row.id);
        }
        expect(paged).toEqual(expected);
        expect(new Set(paged).size).toBe(5);
      }
    });

    it('reports the best-known sale and zero for a cancelled order', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // Return-adjusted order → the best-known statement's sale wins.
      const withReturn = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
      });
      await createProfitStatement(withReturn.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '180.00',
        netProfit: '40.00',
      });
      // Cancelled order, no statement → sale is 0 (rule B5).
      const cancelled = await createOrder(org.id, store.id, {
        status: 'CANCELLED',
        saleGross: '240.00',
      });
      // Plain order, no statement → its own sale.
      const plain = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '150.00',
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string; saleGross: string | null }[] };
      const byId = new Map(body.data.map((o) => [o.id, o.saleGross]));
      expect(byId.get(withReturn.id)).toBe('180');
      expect(byId.get(cancelled.id)).toBe('0');
      expect(byId.get(plain.id)).toBe('150');
    });

    it('never shows a profit for an excluded order', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const normal = await seedSimpleOrder(org.id, store.id); // best-known net 60, sale 240
      const excluded = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '100.00',
      });
      await prisma.order.update({
        where: { id: excluded.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
      });
      await createProfitStatement(excluded.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'EXCLUDED',
        saleGross: '100.00',
        netProfit: null,
        saleMarginPct: null,
        costMarkupPct: null,
      });

      const listRes = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      const listBody = (await listRes.json()) as {
        data: {
          id: string;
          estimatedNetProfit: string | null;
          settledNetProfit: string | null;
          saleMarginPct: string | null;
          costMarkupPct: string | null;
          saleGross: string | null;
        }[];
      };
      const row = listBody.data.find((o) => o.id === excluded.id);
      expect(row?.estimatedNetProfit).toBeNull();
      expect(row?.settledNetProfit).toBeNull();
      expect(row?.saleMarginPct).toBeNull();
      expect(row?.costMarkupPct).toBeNull();
      // Revenue still counts even though profit is excluded.
      expect(row?.saleGross).toBe('100');

      const summaryRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/summary`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const summaryBody = (await summaryRes.json()) as {
        totalRevenueGross: string;
        netProfitGross: string;
      };
      // Net profit excludes the stamped order (null net); revenue includes it.
      expect(summaryBody.netProfitGross).toBe('60');
      expect(summaryBody.totalRevenueGross).toBe('340');
      expect(normal.id).not.toBe(excluded.id);
    });

    it('hides the profit of a cancelled order without a penalty line', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // Cancelled with no penalty: both views are CANCELLED with a zero net profit.
      // Reconciliation has finished, so without the rule the settled net would show 0.
      const order = await createOrder(org.id, store.id, {
        status: 'CANCELLED',
        saleGross: '240.00',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'ESTIMATE',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '0',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '0',
        reconciliationStatus: 'FULLY_SETTLED',
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body: {
        data: {
          id: string;
          estimatedNetProfit: string | null;
          settledNetProfit: string | null;
          saleGross: string | null;
        }[];
      } = await res.json();
      const row = body.data.find((o) => o.id === order.id);
      expect(row?.estimatedNetProfit).toBeNull();
      expect(row?.settledNetProfit).toBeNull();
      expect(row?.saleGross).toBe('0');
    });

    it('shows the profit of a cancelled order that carries a penalty', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // The engine writes no estimate line for a cancellation, so the estimate view is a
      // zero-net CANCELLED view. The penalty arrives with the settlement on the best-known
      // view: its non-zero net profit stays visible as the settled profit.
      const order = await createOrder(org.id, store.id, {
        status: 'CANCELLED',
        saleGross: '240.00',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'ESTIMATE',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '0',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '-15.00',
        reconciliationStatus: 'FULLY_SETTLED',
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body: {
        data: { id: string; estimatedNetProfit: string | null; settledNetProfit: string | null }[];
      } = await res.json();
      const row = body.data.find((o) => o.id === order.id);
      expect(row?.estimatedNetProfit).toBeNull();
      expect(row?.settledNetProfit).toBe('-15');
    });

    it('reads the sale VAT from the best-known statement', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // The order column holds the pre-return VAT (36.06); the best-known statement's
      // output VAT (12.73) is what remains after the return, alongside its sale (140).
      const withStatement = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
        saleVat: '36.06',
      });
      await createProfitStatement(withStatement.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '140.00',
        vatOutput: '12.73',
        netProfit: '20.00',
      });
      // Cancelled, no statement: VAT is 0 like its sale (rule B5).
      const cancelled = await createOrder(org.id, store.id, {
        status: 'CANCELLED',
        saleGross: '240.00',
        saleVat: '36.06',
      });
      // Open, no statement: the order's own VAT column.
      const open = await createOrder(org.id, store.id, {
        status: 'PROCESSING',
        saleGross: '240.00',
        saleVat: '36.06',
      });

      const listRes = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(listRes.status).toBe(200);
      const listBody: { data: { id: string; saleGross: string | null; saleVat: string | null }[] } =
        await listRes.json();
      const byId = new Map(listBody.data.map((o) => [o.id, o]));
      expect(byId.get(withStatement.id)?.saleGross).toBe('140');
      expect(byId.get(withStatement.id)?.saleVat).toBe('12.73');
      expect(byId.get(cancelled.id)?.saleVat).toBe('0');
      expect(byId.get(open.id)?.saleVat).toBe('36.06');

      const detailRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${withStatement.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(detailRes.status).toBe(200);
      const detailBody: { saleVat: string | null } = await detailRes.json();
      expect(detailBody.saleVat).toBe('12.73');
    });

    it('filters by status', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const delivered = await seedSimpleOrder(org.id, store.id, { status: 'DELIVERED' });
      await seedSimpleOrder(org.id, store.id, { status: 'CANCELLED' });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?status=DELIVERED`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string }[] };
      expect(body.data.map((o) => o.id)).toEqual([delivered.id]);
    });

    it('filters by orderDate range', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const inWindow = await seedSimpleOrder(org.id, store.id, {
        orderDate: new Date('2026-04-10T10:00:00Z'),
      });
      await seedSimpleOrder(org.id, store.id, {
        orderDate: new Date('2026-03-01T10:00:00Z'),
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?from=2026-04-01&to=2026-04-30`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string }[] };
      expect(body.data.map((o) => o.id)).toEqual([inWindow.id]);
    });

    it('filters by substring search on platformOrderNumber', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const match = await seedSimpleOrder(org.id, store.id, {
        platformOrderNumber: 'TY-2024-AB',
      });
      await seedSimpleOrder(org.id, store.id, { platformOrderNumber: 'HB-9999' });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?q=TY-2024`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string }[] };
      expect(body.data.map((o) => o.id)).toEqual([match.id]);
    });

    it('paginates with page + perPage', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // Seed 7 orders with descending orderDate so the natural sort matches index order.
      const orders = [];
      for (let i = 0; i < 7; i += 1) {
        orders.push(
          await seedSimpleOrder(org.id, store.id, {
            orderDate: new Date(`2026-04-${(20 - i).toString().padStart(2, '0')}T10:00:00Z`),
          }),
        );
      }

      const page1 = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?page=1&perPage=10`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const body1 = (await page1.json()) as {
        data: { id: string }[];
        pagination: { total: number; totalPages: number };
      };
      expect(body1.pagination.total).toBe(7);
      expect(body1.pagination.totalPages).toBe(1);
      expect(body1.data).toHaveLength(7);
    });

    it('costStatus=excluded returns only profit-excluded orders; costStatus=calculated only profit-known', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const calc = await seedSimpleOrder(org.id, store.id, { platformOrderNumber: 'CALC-1' });
      const excluded = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      await prisma.order.update({
        where: { id: excluded.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
      });

      const excludedRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?costStatus=excluded`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(excludedRes.status).toBe(200);
      const excludedBody = (await excludedRes.json()) as { data: { id: string }[] };
      expect(excludedBody.data.map((o) => o.id)).toEqual([excluded.id]);

      const calcRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?costStatus=calculated`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const calcBody = (await calcRes.json()) as { data: { id: string }[] };
      expect(calcBody.data.map((o) => o.id)).toEqual([calc.id]);
    });

    it('returns counts honoring sibling filters but ignoring costStatus', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      await seedSimpleOrder(org.id, store.id, { status: 'DELIVERED' }); // calc + delivered
      const exDelivered = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      const exCancelled = await createOrder(org.id, store.id, { status: 'CANCELLED' });
      await prisma.order.updateMany({
        where: { id: { in: [exDelivered.id, exCancelled.id] } },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'LATE_UNCOSTED_ARRIVAL' },
      });

      const allRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?costStatus=calculated`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const allBody = (await allRes.json()) as {
        counts: { calculated: number; excluded: number };
        data: unknown[];
      };
      expect(allBody.counts).toEqual({ calculated: 1, excluded: 2 });
      expect(allBody.data).toHaveLength(1);

      const deliveredRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?costStatus=excluded&status=DELIVERED`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const deliveredBody = (await deliveredRes.json()) as {
        counts: { calculated: number; excluded: number };
        data: unknown[];
      };
      expect(deliveredBody.counts).toEqual({ calculated: 1, excluded: 1 });
      expect(deliveredBody.data).toHaveLength(1);

      // Flipping ONLY the segment (same scope, no sibling filter change) must
      // leave the counts identical — the user-facing invariant "both tabs show
      // the same honest totals regardless of which segment is active".
      const excludedRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?costStatus=excluded`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      const excludedBody = (await excludedRes.json()) as {
        counts: { calculated: number; excluded: number };
        data: unknown[];
      };
      expect(excludedBody.counts).toEqual(allBody.counts);
      expect(excludedBody.data).toHaveLength(2);
    });

    it('rejects an invalid perPage value at the Zod boundary', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders?perPage=7`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /v1/organizations/:orgId/stores/:storeId/orders/:orderId ─────────

  describe('GET /v1/organizations/:orgId/stores/:storeId/orders/:orderId', () => {
    it('returns 404 for an unknown order id', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${randomUUID()}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(404);
    });

    it('returns the order with its claims and no fee or payment-order fields', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await seedSimpleOrder(org.id, store.id);

      const claim = await createOrderClaim(org.id, store.id, order.id, { resolved: false });
      await createOrderClaimItem(claim.id, {
        reasonCode: 'DAMAGEDITEM',
        reasonName: 'Üründe hasar var',
        status: 'WaitingInAction',
        acceptedBySeller: false,
        resolved: false,
      });

      // Unmatched line (PR-1 always-persist): variant null, item-level barcode
      // is the only product trace until variant resolution links it (#315).
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: '8680000000001',
          platformLineId: 9001n,
          quantity: 1,
        },
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        store: { id: string; platform: string };
        claims: { trendyolClaimId: string; items: { reasonCode: string }[] }[];
        saleGross: string | null;
        items: { barcode: string | null; variant: unknown }[];
        profitExcludedAt: string | null;
        profitExclusionReason: string | null;
      };
      expect(body.id).toBe(order.id);
      expect(body.store.id).toBe(store.id);
      expect(body.saleGross).toBe('240');
      // The fee list and the payment-order fields left the wire contract.
      expect(body).not.toHaveProperty('fees');
      expect(body).not.toHaveProperty('paymentOrderId');
      expect(body).not.toHaveProperty('paymentDate');
      expect(body.claims).toHaveLength(1);
      expect(body.claims[0]?.items[0]?.reasonCode).toBe('DAMAGEDITEM');
      // Unmatched line: variant null, the item-level barcode carries the trace.
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.variant).toBeNull();
      expect(body.items[0]?.barcode).toBe('8680000000001');
      // Calculated order: exclusion fields present and null (spec 2026-06-12).
      expect(body.profitExcludedAt).toBeNull();
      expect(body.profitExclusionReason).toBeNull();
    });

    it('derives vendorMissing on unmatched lines from CatalogBarcodeMiss (true only for a confirmed gap)', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await seedSimpleOrder(org.id, store.id);

      // Unmatched line A: barcode is a CONFIRMED catalog gap (vendorMissing=true).
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'GAP-CONFIRMED',
          platformLineId: 9101n,
          quantity: 1,
        },
      });
      // Unmatched line B: barcode has NO miss row → vendorMissing=false.
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'AWAITING-MATCH',
          platformLineId: 9102n,
          quantity: 1,
        },
      });
      await prisma.catalogBarcodeMiss.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          barcode: 'GAP-CONFIRMED',
          vendorMissing: true,
        },
      });
      // A transient-miss row (vendorMissing=false) must NOT flip the badge.
      await prisma.catalogBarcodeMiss.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          barcode: 'AWAITING-MATCH',
          vendorMissing: false,
        },
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { barcode: string | null; variant: unknown; vendorMissing: boolean }[];
      };
      const byBarcode = new Map(body.items.map((i) => [i.barcode, i.vendorMissing]));
      expect(byBarcode.get('GAP-CONFIRMED')).toBe(true);
      // No miss row OR a transient miss → false.
      expect(byBarcode.get('AWAITING-MATCH')).toBe(false);
    });

    it('reports vendorMissing=false on a matched line even if its barcode has a vendor-missing row', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await seedSimpleOrder(org.id, store.id);

      // A matched line (variant resolved) — vendorMissing is meaningless here and
      // must be false, even though a stale miss row exists for the same barcode.
      const product = await prisma.product.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          platformContentId: 970001n,
          productMainId: 'PM-VM',
          title: 'Eşleşmiş Ürün',
        },
      });
      const variant = await prisma.productVariant.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          platformVariantId: 870001n,
          barcode: 'MATCHED-BC',
          stockCode: 'SC-VM',
          salePrice: '100.00',
          listPrice: '120.00',
        },
      });
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: variant.id,
          barcode: 'MATCHED-BC',
          platformLineId: 9201n,
          quantity: 1,
        },
      });
      await prisma.catalogBarcodeMiss.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          barcode: 'MATCHED-BC',
          vendorMissing: true,
        },
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { variant: unknown; vendorMissing: boolean }[];
      };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.variant).not.toBeNull();
      expect(body.items[0]?.vendorMissing).toBe(false);
    });

    it('returns the exclusion fields for a profit-excluded order', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await createOrder(org.id, store.id);
      await prisma.order.update({
        where: { id: order.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
      });
      // An excluded best-known statement carries no net profit, so the detail serves a
      // null breakdown and null estimated profit even though the statement exists.
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'EXCLUDED',
        saleGross: '100.00',
        netProfit: null,
        saleMarginPct: null,
        costMarkupPct: null,
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profitExcludedAt: string | null;
        profitExclusionReason: string | null;
        estimatedNetProfit: string | null;
        profitBreakdown: unknown;
      };
      expect(body.profitExcludedAt).not.toBeNull();
      expect(body.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
      expect(body.estimatedNetProfit).toBeNull();
      // Profit-excluded → no backend-computed breakdown.
      expect(body.profitBreakdown).toBeNull();
    });

    it('returns the profit breakdown from the best-known statement', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const orderId = await seedCalculableTrendyolOrder(org.id, store.id);

      // Run the writer so the detail reads the stored best-known statement + lines.
      await prisma.$transaction(
        (tx) => recomputeParcelProfit(tx, { organizationId: org.id, orderId }),
        {
          maxWait: 15000,
          timeout: 30000,
        },
      );

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${orderId}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profitBreakdown: {
          saleGross: string;
          costGross: string;
          shippingGross: string;
          platformServiceGross: string;
          internationalServiceGross: string;
          overseasReturnOperationGross: string;
          returnShippingGross: string;
          marketplaceFeesGross: string;
          taxesGross: string;
          netProfit: string;
        } | null;
      };
      const b = body.profitBreakdown;
      if (b === null) throw new Error('profitBreakdown unexpectedly null');
      expect(b.saleGross).toBe('240.00');
      expect(b.costGross).toBe('60.00');
      // A digital parcel ships nothing and pays no PSF; the micro/return rows are
      // absent too, so every absent row is exactly "0.00".
      expect(b.shippingGross).toBe('0.00');
      expect(b.platformServiceGross).toBe('0.00');
      expect(b.internationalServiceGross).toBe('0.00');
      expect(b.overseasReturnOperationGross).toBe('0.00');
      expect(b.returnShippingGross).toBe('0.00');
      // The four display groups close to the sale to the kurus (decision 6).
      const closed = new Decimal(b.costGross)
        .add(b.marketplaceFeesGross)
        .add(b.taxesGross)
        .add(b.netProfit);
      expect(closed.toFixed(2)).toBe(b.saleGross);
    });

    it('computes the breakdown in the request when no statement is stored yet', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const orderId = await seedCalculableTrendyolOrder(org.id, store.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${orderId}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { profitBreakdown: unknown };

      // The detail must match a fresh read-only computation of the same parcel; its
      // list price and discount come from the SALE line (the order line's 240 / 0).
      const computed = await computeParcelProfit(prisma, { organizationId: org.id, orderId });
      const expected = buildStatementBreakdown({
        totals: statementTotalsFromStatement(computed.bestKnown),
        selectedLines: computed.bestKnown.selectedLines,
      });
      expect(body.profitBreakdown).toEqual(expected);
      expect(expected?.listGross).toBe('240.00');
      expect(expected?.sellerDiscountGross).toBe('0.00');

      // The request wrote nothing: no statement or line rows exist afterwards.
      expect(await prisma.orderProfitStatement.count({ where: { orderId } })).toBe(0);
      expect(await prisma.profitLine.count({ where: { orderId } })).toBe(0);
    });

    it('keeps the list sale on the detail while the statement is not stored yet', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const orderId = await seedCalculableTrendyolOrder(org.id, store.id);

      // The order carries no stored best-known statement, so both the list row and the
      // detail top-level sale must read the order's own recorded sale. Give that column a
      // value distinct from the 240 the engine computes from the single line, so the
      // parity check also proves the detail no longer surfaces the computed statement's
      // sale -- exactly the divergence an accepted return produces.
      await prisma.order.update({ where: { id: orderId }, data: { saleGross: '180.00' } });

      const listRes = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        data: { id: string; saleGross: string | null }[];
      };
      const listRow = listBody.data.find((o) => o.id === orderId);
      expect(listRow?.saleGross).toBe('180');

      const detailRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${orderId}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(detailRes.status).toBe(200);
      const detailBody = (await detailRes.json()) as {
        saleGross: string | null;
        profitBreakdown: { saleGross: string } | null;
      };

      // Top-level sale matches the list row (the order's own sale), not the computed
      // statement's sale.
      expect(detailBody.saleGross).toBe(listRow?.saleGross);
      expect(detailBody.saleGross).toBe('180');
      // The breakdown is still computed in the request and keeps the engine's own sale
      // (240 from the single line), so only the top-level sale took the list value.
      expect(detailBody.profitBreakdown).not.toBeNull();
      expect(detailBody.profitBreakdown?.saleGross).toBe('240.00');

      // The request wrote nothing: no statement rows exist afterwards.
      expect(await prisma.orderProfitStatement.count({ where: { orderId } })).toBe(0);
    });

    it('returns no breakdown and null item rates for a platform the engine cannot compute', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      // Hepsiburada has no profit computer yet, so a request with no stored statement
      // returns a null breakdown instead of raising a 500.
      const store = await createStore(org.id, { platform: 'HEPSIBURADA' });
      const order = await createOrder(org.id, store.id);
      // The legacy item columns hold a rate and amount; with no line context the
      // detail must not fall back to them.
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-HB-1',
          platformLineId: 7901n,
          quantity: 1,
        },
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profitBreakdown: unknown;
        items: {
          id: string;
          commissionGross: string;
          commissionRate: string | null;
          commissionVatRate: string | null;
          refundedCommissionGross: string;
        }[];
      };
      expect(body.profitBreakdown).toBeNull();
      const hbItem = body.items.find((i) => i.id === item.id);
      expect(hbItem?.commissionRate).toBeNull();
      expect(hbItem?.commissionVatRate).toBeNull();
      expect(hbItem?.commissionGross).toBe('0.00');
      expect(hbItem?.refundedCommissionGross).toBe('0.00');
    });

    it('returns item cost and commission from the profit lines', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      await prisma.order.update({
        where: { id: order.id },
        data: { saleGross: '240.00', saleVat: '40.00' },
      });

      // Item 1 has a cost line and two commission lines (an estimate carrying the rate,
      // and a marketplace-record actual carrying the settled amount). Item 2 is named
      // by a MISSING_COST issue, so its unit cost reads null.
      const item1 = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-ITEM-1',
          platformLineId: 7001n,
          quantity: 2,
        },
      });
      const item2 = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-ITEM-2',
          platformLineId: 7002n,
          quantity: 1,
        },
      });

      await createProfitLine(order.id, org.id, store.id, {
        orderItemId: item1.id,
        type: 'COST_COGS',
        certainty: 'ESTIMATE',
        source: 'SELLER_INPUT',
        amountGross: '100.00',
        amountVat: '16.67',
        vatRatePct: '20',
      });
      await createProfitLine(order.id, org.id, store.id, {
        orderItemId: item1.id,
        type: 'COMMISSION',
        certainty: 'ESTIMATE',
        source: 'RULE',
        amountGross: '20.00',
        amountVat: '3.33',
        vatRatePct: '20',
        inputs: { ratePct: '19' },
      });
      await createProfitLine(order.id, org.id, store.id, {
        orderItemId: item1.id,
        type: 'COMMISSION',
        certainty: 'ACTUAL',
        source: 'MARKETPLACE_RECORD',
        amountGross: '24.00',
        amountVat: '4.00',
        vatRatePct: '20',
        externalRecordId: 'settle-1',
        externalRecordType: 'Sale',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'NOT_COMPUTABLE',
        saleGross: '240.00',
        netProfit: null,
        issues: [{ code: 'MISSING_COST', orderItemId: item2.id, detail: null }],
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: {
          id: string;
          unitCostSnapshotGross: string | null;
          unitCostSnapshotVatRate: string | null;
          commissionGross: string;
          commissionRate: string | null;
          commissionVatRate: string | null;
          estimatedCommissionGross: string | null;
          settledCommissionGross: string | null;
        }[];
      };
      const byId = new Map(body.items.map((i) => [i.id, i]));
      const i1 = byId.get(item1.id);
      const i2 = byId.get(item2.id);
      // Unit cost: the cost line's gross divided by the quantity (100 / 2).
      expect(i1?.unitCostSnapshotGross).toBe('50.00');
      expect(i1?.unitCostSnapshotVatRate).toBe('20');
      // Amount from the best-known (actual) line; rate from the estimate's inputs.ratePct
      // and the commission VAT rate from that same estimate line.
      expect(i1?.commissionGross).toBe('24.00');
      expect(i1?.commissionRate).toBe('19');
      expect(i1?.commissionVatRate).toBe('20');
      expect(i1?.estimatedCommissionGross).toBe('20.00');
      expect(i1?.settledCommissionGross).toBe('24.00');
      // MISSING_COST names item 2 → its unit cost is null.
      expect(i2?.unitCostSnapshotGross).toBeNull();
    });

    it('opens the detail without profit when the in-request computation fails', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // A bare Trendyol order with no stored statement and no fee reference data (every
      // test truncates it): the in-request computation throws when it resolves the
      // platform fees, so the detail must still open with an empty profit section.
      const order = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-NOFEES-1',
          platformLineId: 7301n,
          quantity: 1,
        },
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await app.request(
          `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
          { headers: { Authorization: bearer(user.accessToken) } },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          items: { id: string }[];
          profitBreakdown: unknown;
          estimatedNetProfit: string | null;
        };
        // Items still render; the profit section is empty.
        expect(body.items).toHaveLength(1);
        expect(body.items[0]?.id).toBe(item.id);
        expect(body.profitBreakdown).toBeNull();
        expect(body.estimatedNetProfit).toBeNull();

        // The deliberate fallback logged exactly one [profit-read] error carrying the
        // order id (owner decision 2026-11-04).
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
          '[profit-read] in-request profit computation failed',
          expect.objectContaining({ surface: 'order-detail', orderId: order.id }),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('opens the detail without profit when a stored profit line is corrupt', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // An order with a stored best-known statement and a profit line whose `inputs` is a
      // nested object -- a shape the reader rejects. Rebuilding the stored rows throws, so
      // the detail must still open with an empty profit section (owner decision 2026-11-04).
      const order = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-CORRUPT-1',
          platformLineId: 7501n,
          quantity: 1,
        },
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'ESTIMATED',
        saleGross: '240.00',
        netProfit: '60.00',
      });
      await createProfitLine(order.id, org.id, store.id, {
        orderItemId: item.id,
        type: 'COST_COGS',
        certainty: 'ESTIMATE',
        source: 'SELLER_INPUT',
        amountGross: '30.00',
        amountVat: '5.00',
        vatRatePct: '20',
        // A nested object is not a flat string/boolean/null input -- the reader throws.
        inputs: { nested: { reason: 'corrupt' } },
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await app.request(
          `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
          { headers: { Authorization: bearer(user.accessToken) } },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          items: { id: string }[];
          profitBreakdown: unknown;
          estimatedNetProfit: string | null;
        };
        // Items still render; the profit section is empty.
        expect(body.items).toHaveLength(1);
        expect(body.items[0]?.id).toBe(item.id);
        expect(body.profitBreakdown).toBeNull();
        expect(body.estimatedNetProfit).toBeNull();

        // The deliberate fallback logged exactly one [profit-read] error carrying the
        // order id (owner decision 2026-11-04).
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
          '[profit-read] in-request profit computation failed',
          expect.objectContaining({ surface: 'order-detail', orderId: order.id }),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('opens the detail of a cancelled order with zero sale', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // Cancelled, no statement: the sale is 0 even though the order column holds 240
      // (rule B5). No fee reference data, so the in-request computation fails and logs;
      // the page still opens. Silence the expected log so it does not look like a break.
      const cancelled = await createOrder(org.id, store.id, {
        status: 'CANCELLED',
        saleGross: '240.00',
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await app.request(
          `/v1/organizations/${org.id}/stores/${store.id}/orders/${cancelled.id}`,
          { headers: { Authorization: bearer(user.accessToken) } },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { saleGross: string | null };
        expect(body.saleGross).toBe('0');
      } finally {
        errorSpy.mockRestore();
      }

      // Cancelled but with a best-known statement: the sale follows the statement.
      const settled = await createOrder(org.id, store.id, {
        status: 'CANCELLED',
        saleGross: '240.00',
      });
      await createProfitStatement(settled.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '180.00',
        netProfit: '40.00',
      });
      const settledRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${settled.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(settledRes.status).toBe(200);
      const settledBody = (await settledRes.json()) as { saleGross: string | null };
      expect(settledBody.saleGross).toBe('180');
    });

    it('returns no breakdown for an excluded order even when cost lines exist', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const order = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-EXCLUDED-1',
          platformLineId: 7401n,
          quantity: 2,
        },
      });
      // A cost line survives the exclusion, so the item's unit cost is still shown.
      await createProfitLine(order.id, org.id, store.id, {
        orderItemId: item.id,
        type: 'COST_COGS',
        certainty: 'ESTIMATE',
        source: 'SELLER_INPUT',
        amountGross: '100.00',
        amountVat: '16.67',
        vatRatePct: '20',
      });
      // An excluded best-known statement carries no net profit -- the breakdown is null.
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'EXCLUDED',
        saleGross: '240.00',
        netProfit: null,
        saleMarginPct: null,
        costMarkupPct: null,
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profitBreakdown: unknown;
        items: { id: string; unitCostSnapshotGross: string | null }[];
      };
      // Excluded -- no breakdown, even though cost lines exist.
      expect(body.profitBreakdown).toBeNull();
      const excludedItem = body.items.find((i) => i.id === item.id);
      // Unit cost still reads from the line (100 / 2).
      expect(excludedItem?.unitCostSnapshotGross).toBe('50.00');
    });

    it('shows the settled profit once the best-known statement started reconciling', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const order = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'ESTIMATE',
        status: 'ESTIMATED',
        saleGross: '240.00',
        netProfit: '60.00',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'PARTIALLY_SETTLED',
        saleGross: '240.00',
        netProfit: '55.00',
        reconciliationStatus: 'PARTIALLY_SETTLED',
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        estimatedNetProfit: string | null;
        settledNetProfit: string | null;
        reconciliationStatus: string;
      };
      // Estimate stays the estimate's net; the settled net surfaces because
      // reconciliation has started (decision 1).
      expect(body.estimatedNetProfit).toBe('60');
      expect(body.settledNetProfit).toBe('55');
      expect(body.reconciliationStatus).toBe('PARTIALLY_SETTLED');
    });

    it('returns the same sale on the detail as on the list', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // The order column holds 240, but a return shrank the best-known statement's sale
      // to 180 -- the list row and the detail must agree on the latter.
      const order = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '180.00',
        netProfit: '40.00',
      });

      const listRes = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        data: { id: string; saleGross: string | null }[];
      };
      const listRow = listBody.data.find((o) => o.id === order.id);

      const detailRes = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(detailRes.status).toBe(200);
      const detailBody = (await detailRes.json()) as { saleGross: string | null };

      expect(detailBody.saleGross).toBe('180');
      expect(detailBody.saleGross).toBe(listRow?.saleGross);
    });

    it('returns the item commission refund from the profit lines', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '280.00',
      });

      // Both items carry a stale legacy refund column (8.40, the discount's commission).
      // Only the returned item has a COMMISSION_REFUND line.
      const returnedItem = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-REFUND-1',
          platformLineId: 7501n,
          quantity: 1,
        },
      });
      const keptItem = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-REFUND-2',
          platformLineId: 7502n,
          quantity: 1,
        },
      });
      for (const item of [returnedItem, keptItem]) {
        await createProfitLine(order.id, org.id, store.id, {
          orderItemId: item.id,
          type: 'COMMISSION',
          certainty: 'ESTIMATE',
          source: 'RULE',
          amountGross: '28.00',
          amountVat: '4.67',
          vatRatePct: '20',
          inputs: { ratePct: '20' },
        });
      }
      await createProfitLine(order.id, org.id, store.id, {
        orderItemId: returnedItem.id,
        type: 'COMMISSION_REFUND',
        certainty: 'ESTIMATE',
        source: 'RULE',
        amountGross: '28.00',
        amountVat: '4.67',
        vatRatePct: '20',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '140.00',
        netProfit: '30.00',
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body: { items: { id: string; refundedCommissionGross: string }[] } = await res.json();
      const byId = new Map(body.items.map((i) => [i.id, i]));
      expect(byId.get(returnedItem.id)?.refundedCommissionGross).toBe('28.00');
      expect(byId.get(keptItem.id)?.refundedCommissionGross).toBe('0.00');
    });

    it('does not fall back to the legacy commission on a cancelled order with a statement', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await createOrder(org.id, store.id, {
        status: 'CANCELLED',
        saleGross: '140.00',
      });

      // The legacy column still holds the pre-cancel commission (28); the statement has
      // no commission line, so the item's commission is zero and its rate null, never
      // the column.
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: 'BC-CANCEL-1',
          platformLineId: 7601n,
          quantity: 1,
        },
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'ESTIMATE',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '0',
      });
      await createProfitStatement(order.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '0',
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body: {
        items: { id: string; commissionGross: string; commissionRate: string | null }[];
      } = await res.json();
      const cancelledItem = body.items.find((i) => i.id === item.id);
      expect(cancelledItem?.commissionGross).toBe('0.00');
      // No estimate commission line supplies a rate, so it is null.
      expect(cancelledItem?.commissionRate).toBeNull();
    });

    it('lists the profit issues of the best-known statement', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const carrierIssue = {
        code: 'CARRIER_NOT_RECOGNIZED',
        orderItemId: null,
        detail: 'Alternative Delivery',
      };

      // Warned: the stored issue is returned as it is.
      const warned = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      await createProfitStatement(warned.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '140.00',
        netProfit: '30.00',
        issues: [carrierIssue],
      });
      // Plain: no stored issue.
      const plain = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      await createProfitStatement(plain.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '140.00',
        netProfit: '30.00',
      });
      // Invoiced: the same issue, but a cargo-invoice actual shipping line is selected,
      // so the warning no longer applies and is hidden.
      const invoiced = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      await createProfitLine(invoiced.id, org.id, store.id, {
        orderItemId: null,
        type: 'SHIPPING',
        level: 'PARCEL',
        certainty: 'ACTUAL',
        source: 'CARGO_INVOICE',
        amountGross: '42.00',
        amountVat: '7.00',
        vatRatePct: '20',
      });
      await createProfitStatement(invoiced.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        saleGross: '140.00',
        netProfit: '30.00',
        issues: [carrierIssue],
      });

      const issuesOf = async (orderId: string): Promise<unknown> => {
        const res = await app.request(
          `/v1/organizations/${org.id}/stores/${store.id}/orders/${orderId}`,
          { headers: { Authorization: bearer(user.accessToken) } },
        );
        expect(res.status).toBe(200);
        const body: { profitIssues: unknown } = await res.json();
        return body.profitIssues;
      };

      expect(await issuesOf(warned.id)).toEqual([carrierIssue]);
      expect(await issuesOf(plain.id)).toEqual([]);
      expect(await issuesOf(invoiced.id)).toEqual([]);
    });
  });

  describe('GET /v1/organizations/:orgId/stores/:storeId/orders/summary', () => {
    it('aggregates revenue, net profit and loss rate honoring filters', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      await seedSimpleOrder(org.id, store.id);
      await seedSimpleOrder(org.id, store.id);
      await seedSimpleOrder(org.id, store.id, { netProfit: '-40.00', saleMarginPct: '-16.67' });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/summary`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalRevenueGross).toBe('720'); // 3 × 240
      expect(body.netProfitGross).toBe('80'); // 60 + 60 − 40
      expect(body.lossOrderRate).toMatchObject({ lossCount: 1, totalCount: 3 });
    });

    it('leaves cancelled orders out of the loss-rate denominator', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      await seedSimpleOrder(org.id, store.id);
      await seedSimpleOrder(org.id, store.id);
      await seedSimpleOrder(org.id, store.id, { netProfit: '-40.00', saleMarginPct: '-16.67' });

      // Cancelled with a zero net: not a sold order, so not in the denominator (rule B5).
      const cancelled = await createOrder(org.id, store.id, { status: 'CANCELLED' });
      await createProfitStatement(cancelled.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '0',
      });
      // Cancelled with a penalty (a loss): still not a sale, so it enters neither the
      // denominator nor the loss count -- the count stays a subset of the denominator.
      const penalized = await createOrder(org.id, store.id, { status: 'CANCELLED' });
      await createProfitStatement(penalized.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '-15.00',
      });
      // Excluded with no net profit: an order without a profit stays out of the rate.
      const excluded = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      await createProfitStatement(excluded.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'EXCLUDED',
        saleGross: '100.00',
        netProfit: null,
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/summary`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body: { lossOrderRate: { lossCount: number; totalCount: number } } = await res.json();
      expect(body.lossOrderRate).toMatchObject({ lossCount: 1, totalCount: 3 });
    });

    it('reports a zero loss rate when the only loss is a penalized cancellation', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const penalized = await createOrder(org.id, store.id, { status: 'CANCELLED' });
      await createProfitStatement(penalized.id, org.id, store.id, {
        view: 'BEST_KNOWN',
        status: 'CANCELLED',
        saleGross: '0',
        netProfit: '-15.00',
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/summary`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body: { lossOrderRate: { lossCount: number; totalCount: number; pct: string } } =
        await res.json();
      expect(body.lossOrderRate).toEqual({ lossCount: 0, totalCount: 0, pct: '0' });
    });

    it('averages the best-known margins', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      for (const margin of ['10.00', '20.00', '30.00']) {
        const order = await createOrder(org.id, store.id);
        await createProfitStatement(order.id, org.id, store.id, {
          view: 'BEST_KNOWN',
          saleGross: '240.00',
          netProfit: '48.00',
          saleMarginPct: margin,
        });
      }

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/summary`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { avgMarginPct: string | null };
      expect(body.avgMarginPct).toBe('20'); // avg(10, 20, 30)
    });
  });
});
