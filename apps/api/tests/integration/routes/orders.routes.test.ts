import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderClaim,
  createOrderClaimItem,
  createOrderFee,
  createOrganization,
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

  async function seedSimpleOrder(
    orgId: string,
    storeId: string,
    overrides: {
      status?: 'DELIVERED' | 'PROCESSING' | 'CANCELLED' | 'RETURNED' | 'SHIPPED' | 'PENDING';
      platformOrderNumber?: string;
      orderDate?: Date;
    } = {},
  ) {
    const base = await createOrder(orgId, storeId, { status: overrides.status ?? 'DELIVERED' });
    return prisma.order.update({
      where: { id: base.id },
      data: {
        platformOrderNumber: overrides.platformOrderNumber ?? `ON-${randomUUID().slice(0, 6)}`,
        orderDate: overrides.orderDate ?? base.orderDate,
        saleSubtotalNet: new Decimal('200.00'),
        saleVatTotal: new Decimal('40.00'),
        estimatedNetProfit: new Decimal('60.00'),
      },
    });
  }

  // ─── GET /v1/organizations/:orgId/stores/:storeId/orders ──────────────────

  describe('GET /v1/organizations/:orgId/stores/:storeId/orders', () => {
    it('returns 401 without a token', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`);
      expect(res.status).toBe(401);
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
        amountNet: '10.99',
        vatRate: '20.00',
        vatAmount: '2.20',
      });
      await createOrderFee(order.id, org.id, {
        feeType: 'STOPPAGE',
        source: 'ESTIMATE',
        amountNet: '2.00',
        vatRate: '0.00',
        vatAmount: '0.00',
      });

      const claim = await createOrderClaim(org.id, order.id, { resolved: false });
      await createOrderClaimItem(claim.id, {
        reasonCode: 'DAMAGEDITEM',
        reasonName: 'Üründe hasar var',
        status: 'WaitingInAction',
        acceptedBySeller: false,
        resolved: false,
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        store: { id: string; platform: string };
        fees: { feeType: string; amountNet: string }[];
        claims: { trendyolClaimId: string; items: { reasonCode: string }[] }[];
        saleSubtotalNet: string | null;
        items: unknown[];
      };
      expect(body.id).toBe(order.id);
      expect(body.store.id).toBe(store.id);
      expect(body.saleSubtotalNet).toBe('200');
      expect(body.fees).toHaveLength(2);
      expect(body.fees.map((f) => f.feeType).sort()).toEqual(['PLATFORM_SERVICE', 'STOPPAGE']);
      expect(body.claims).toHaveLength(1);
      expect(body.claims[0]?.items[0]?.reasonCode).toBe('DAMAGEDITEM');
      expect(body.items).toEqual([]);
    });
  });

  // ─── POST /v1/organizations/:orgId/stores/:storeId/orders/sync ────────────

  describe('POST /v1/organizations/:orgId/stores/:storeId/orders/sync', () => {
    it('returns 401 without an auth token', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders/sync`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 when the caller is not a member of the org', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      const store = await createStore(org.id);
      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders/sync`, {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when the storeId belongs to a different org (no existence disclosure)', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const otherOrg = await createOrganization();
      const otherStore = await createStore(otherOrg.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${otherStore.id}/orders/sync`,
        { method: 'POST', headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns 202 with syncLogId and inserts a PENDING ORDERS SyncLog row', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders/sync`, {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as {
        syncLogId: string;
        status: string;
        enqueuedAt: string;
      };
      expect(body.status).toBe('PENDING');
      expect(body.syncLogId).toMatch(/^[0-9a-f-]{36}$/);

      const logRow = await prisma.syncLog.findUniqueOrThrow({ where: { id: body.syncLogId } });
      expect(logRow.storeId).toBe(store.id);
      expect(logRow.syncType).toBe('ORDERS');
      expect(logRow.status).toBe('PENDING');
    });

    it('returns 409 SYNC_IN_PROGRESS with existingSyncLogId when an ORDERS sync is already active', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const existing = await prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'ORDERS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders/sync`, {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; meta?: Record<string, unknown> };
      expect(body.code).toBe('SYNC_IN_PROGRESS');
      expect(body.meta?.['syncType']).toBe('ORDERS');
      expect(body.meta?.['storeId']).toBe(store.id);
      expect(body.meta?.['existingSyncLogId']).toBe(existing.id);
    });

    it('allows ORDERS sync even when a PRODUCTS sync is active for the same store', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // Active PRODUCTS slot — should NOT block an ORDERS enqueue, the
      // partial unique index is per (storeId, syncType).
      await prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'PRODUCTS',
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders/sync`, {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(202);
    });
  });
});
