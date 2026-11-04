import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { listOrders } from '../../../src/services/order.service';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderClaim,
  createOrderClaimItem,
  createOrderFee,
  createOrganization,
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

    it('returns the order with its fees and claims', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await seedSimpleOrder(org.id, store.id);

      await createOrderFee(order.id, org.id, {
        feeType: 'PLATFORM_SERVICE',
        source: 'ESTIMATE',
        amountGross: '13.19', // KDV-dahil (eski net 10.99 + KDV 2.20)
        vatRate: '20.00',
      });
      await createOrderFee(order.id, org.id, {
        feeType: 'STOPPAGE',
        source: 'ESTIMATE',
        amountGross: '2.00',
        vatRate: '0.00',
      });

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
          commissionRate: '10.00',
          commissionGross: '12.00',
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
        fees: { feeType: string; amountGross: string }[];
        claims: { trendyolClaimId: string; items: { reasonCode: string }[] }[];
        saleGross: string | null;
        items: { barcode: string | null; variant: unknown }[];
        profitExcludedAt: string | null;
        profitExclusionReason: string | null;
      };
      expect(body.id).toBe(order.id);
      expect(body.store.id).toBe(store.id);
      expect(body.saleGross).toBe('240');
      expect(body.fees).toHaveLength(2);
      expect(body.fees.map((f) => f.feeType).sort()).toEqual(['PLATFORM_SERVICE', 'STOPPAGE']);
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
          commissionRate: '10.00',
          commissionGross: '12.00',
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
          commissionRate: '10.00',
          commissionGross: '12.00',
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
          commissionRate: '10.00',
          commissionGross: '12.00',
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
      // Kâr-dışı → backend-hesaplı kâr dökümü de yok.
      expect(body.profitBreakdown).toBeNull();
    });

    it('returns the backend-computed profitBreakdown for a calculable order', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await createOrder(org.id, store.id, { status: 'DELIVERED' });
      await prisma.order.update({
        where: { id: order.id },
        data: {
          // GROSS konvansiyon: saleGross = KDV-dahil (200 net + 40 KDV = 240);
          // listGross = saleGross + satıcı indirimi brüt (240 + 30 = 270);
          // sellerDiscountGross = 30 (display-only, netProfit'i etkilemez).
          // Persist edilen skalarlar, eklenen kalem+fee'lerden computeProfit'in
          // ÜRETECEĞİ değerlerle TUTARLI (drift değil). STOPAJ kâr dökümünde
          // GÖSTERİLMEZ (ProfitBreakdown wire'da yok) → setup'tan çıkarıldı, böylece
          // döküm kendi alt-çizgisine (netProfit) toplanır:
          // netProfit = 240−60−24−0−13.19−23.80 = 119.01; netVat = 40−10−4−2.20 = 23.80.
          saleGross: new Decimal('240.00'),
          saleVat: new Decimal('40.00'),
          listGross: new Decimal('270.00'),
          sellerDiscountGross: new Decimal('30.00'),
          estimatedNetProfit: new Decimal('119.01'),
          estimatedNetVat: new Decimal('23.80'),
        },
      });
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: '8680000000002',
          quantity: 1,
          commissionRate: '10.00',
          // GROSS konvansiyon: komisyon brüt = eski net 20 + KDV 4 = 24.
          commissionGross: '24.00',
          // Maliyet snapshot brüt = eski net 50 + KDV 10 = 60 (KDV oranı %20).
          unitCostSnapshotGross: '60.00',
          unitCostSnapshotVatRate: '20.00',
          // Satıcı indirimi brüt = eski net 25 + KDV 5 = 30 (display-only; netProfit'i
          // ETKİLEMEZ — saleGross zaten effectiveSale). listGross = 240 + 30 = 270.
          lineSellerDiscountGross: '30.00',
        },
      });
      // ESTIMATE fee (SETTLEMENT/CARGO değil) → tahmini basis dökümüne girer.
      // amountGross = KDV-dahil (eski net 10.99 + KDV 2.20 = 13.19). STOPAJ fee'si
      // EKLENMEZ: kâr dökümü (ProfitBreakdown) stopajı GÖSTERMEZ (wire'da alan yok),
      // bu yüzden setup'tan çıkarıldı → döküm kendi alt-çizgisine temiz toplanır.
      await createOrderFee(order.id, org.id, {
        feeType: 'PLATFORM_SERVICE',
        source: 'ESTIMATE',
        amountGross: '13.19',
        vatRate: '20.00',
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profitBreakdown: {
          listGross: string;
          sellerDiscountGross: string;
          saleGross: string;
          costGross: string;
          commissionGross: string;
          shippingGross: string;
          platformServiceGross: string;
          netVat: string;
          netProfit: string;
        } | null;
      };
      const b = body.profitBreakdown;
      if (b === null) throw new Error('profitBreakdown beklenmedik şekilde null');
      // Brüt (KDV-dahil) toplamlar backend'de hesaplandı; netVat/netProfit persist'ten.
      expect(b.saleGross).toBe('240.00'); // 200 + 40 (KDV-dahil)
      expect(b.costGross).toBe('60.00'); // (50 + 10) × 1
      expect(b.commissionGross).toBe('24.00'); // 20 + 4
      expect(b.shippingGross).toBe('0.00'); // kargo fee yok
      expect(b.platformServiceGross).toBe('13.19'); // 10.99 + 2.20
      expect(b.netVat).toBe('23.80'); // persist edilen estimatedNetVat
      expect(b.netProfit).toBe('119.01'); // persist edilen estimatedNetProfit (stopajsız)
      // Satıcı indirimi şeffaflığı (display-only; netProfit'i ETKİLEMEZ).
      expect(b.sellerDiscountGross).toBe('30.00'); // 25 + 5
      expect(b.listGross).toBe('270.00'); // 240 + 30
      // Çekirdek invariant: döküm kendi alt-çizgisine (netProfit) toplanmalı.
      // Stopaj dökümde GÖSTERİLMEZ → setup'tan çıkarıldığı için netProfit stopajsız.
      const sum = new Decimal(b.saleGross)
        .sub(b.costGross)
        .sub(b.commissionGross)
        .sub(b.shippingGross)
        .sub(b.platformServiceGross)
        .sub(b.netVat);
      expect(sum.toFixed(2)).toBe(b.netProfit);
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
