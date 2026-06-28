/**
 * Happy-path integration tests for the return-scenario profit fields on the
 * order API endpoints.
 *
 * Asserts that:
 *  - GET /orders/:orderId  → profitBreakdown.returnScenarioNetProfit is a string (not null)
 *                            when the estimate ran (cost profile attached).
 *  - GET /orders           → list items expose returnScenarioNetProfit (string or null, field present).
 *
 * Tenant isolation for the new fields is covered by the existing orders-isolation.test.ts
 * (the org+store filter that prevents cross-org leakage is already tested there;
 * the new column rides the same query path).
 */

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('Order return-scenario profit fields', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /**
   * Seed an order with a non-null estimatedReturnScenarioNetProfit so we can
   * assert the API surfaces it correctly. We write the value directly (the
   * estimate engine is exercised by its own integration tests; here we only
   * verify the service/validator/wire layer).
   */
  async function seedOrderWithReturnScenario(orgId: string, storeId: string) {
    const order = await prisma.order.create({
      data: {
        organizationId: orgId,
        storeId,
        platformOrderId: `test-rs-${Date.now()}`,
        platformOrderNumber: `ON-RS-${Date.now()}`,
        orderDate: new Date('2026-06-01T10:00:00Z'),
        status: 'DELIVERED',
        saleGross: new Decimal('300.00'),
        saleVat: new Decimal('50.00'),
        estimatedNetProfit: new Decimal('80.00'),
        estimatedNetVat: new Decimal('30.00'),
        estimatedSaleMarginPct: new Decimal('26.67'),
        // İade senaryosu: iade kargosu + forward fee'ler sonrası zarar
        estimatedReturnScenarioNetProfit: new Decimal('-45.00'),
        estimatedReturnScenarioMarginPct: new Decimal('-15.0000'),
      },
    });
    return order;
  }

  /**
   * Seed an order WITHOUT a return scenario (e.g. profit-excluded or already returned).
   */
  async function seedOrderWithoutReturnScenario(orgId: string, storeId: string) {
    const order = await prisma.order.create({
      data: {
        organizationId: orgId,
        storeId,
        platformOrderId: `test-rs-null-${Date.now()}`,
        platformOrderNumber: `ON-RS-NULL-${Date.now()}`,
        orderDate: new Date('2026-06-02T10:00:00Z'),
        status: 'DELIVERED',
        saleGross: new Decimal('200.00'),
        saleVat: new Decimal('33.33'),
        estimatedNetProfit: new Decimal('50.00'),
        estimatedNetVat: new Decimal('20.00'),
        estimatedSaleMarginPct: new Decimal('25.00'),
        // Senaryo yok (zaten iadeli / kâr-dışı durumunu simüle)
        estimatedReturnScenarioNetProfit: null,
        estimatedReturnScenarioMarginPct: null,
      },
    });
    return order;
  }

  // ─── Detail endpoint ───────────────────────────────────────────────────────

  describe('GET /v1/organizations/:orgId/stores/:storeId/orders/:orderId', () => {
    it('serves returnScenarioNetProfit as a string in profitBreakdown when the estimate was computed', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await seedOrderWithReturnScenario(org.id, store.id);

      // Need at least one OrderItem so the breakdown builder has items to iterate.
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: '8680000000099',
          platformLineId: BigInt(9900),
          quantity: 1,
          commissionRate: '10.00',
          commissionGross: '30.00',
          unitCostSnapshotGross: '120.00',
          unitCostSnapshotVatRate: '20.00',
        },
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profitBreakdown: {
          netProfit: string;
          returnScenarioNetProfit: string | null;
          returnScenarioMarginPct: string | null;
        } | null;
      };

      expect(body.profitBreakdown).not.toBeNull();
      // Wire'da 2-ondalik string (backend formatlar, frontend türetmez).
      expect(body.profitBreakdown?.returnScenarioNetProfit).toBe('-45.00');
      expect(body.profitBreakdown?.returnScenarioMarginPct).toBe('-15.00');
    });

    it('serves returnScenarioNetProfit as null in profitBreakdown when no scenario was computed', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      const order = await seedOrderWithoutReturnScenario(org.id, store.id);

      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          productVariantId: null,
          barcode: '8680000000100',
          platformLineId: BigInt(9901),
          quantity: 1,
          commissionRate: '10.00',
          commissionGross: '20.00',
          unitCostSnapshotGross: '80.00',
          unitCostSnapshotVatRate: '20.00',
        },
      });

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/orders/${order.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profitBreakdown: {
          returnScenarioNetProfit: string | null;
          returnScenarioMarginPct: string | null;
        } | null;
      };

      expect(body.profitBreakdown).not.toBeNull();
      expect(body.profitBreakdown?.returnScenarioNetProfit).toBeNull();
      expect(body.profitBreakdown?.returnScenarioMarginPct).toBeNull();
    });
  });

  // ─── List endpoint ─────────────────────────────────────────────────────────

  describe('GET /v1/organizations/:orgId/stores/:storeId/orders', () => {
    it('includes returnScenarioNetProfit on list items (string when present, null when absent)', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const withScenario = await seedOrderWithReturnScenario(org.id, store.id);
      const withoutScenario = await seedOrderWithoutReturnScenario(org.id, store.id);

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { id: string; returnScenarioNetProfit: string | null }[];
      };

      const byId = new Map(body.data.map((o) => [o.id, o.returnScenarioNetProfit]));

      // Order with a scenario: string value on the wire.
      expect(byId.get(withScenario.id)).toBe('-45.00');
      // Order without a scenario: null.
      expect(byId.get(withoutScenario.id)).toBeNull();
    });

    it('returnScenarioNetProfit field is present on every list item (not undefined)', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);
      await seedOrderWithReturnScenario(org.id, store.id);

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/orders`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Record<string, unknown>[];
      };

      expect(body.data).toHaveLength(1);
      // The key must exist (even when null) — undefined would mean the field is missing.
      expect('returnScenarioNetProfit' in (body.data[0] ?? {})).toBe(true);
    });
  });
});
