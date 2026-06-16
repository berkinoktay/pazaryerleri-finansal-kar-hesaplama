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
        // GROSS konvansiyon: saleGross = KDV-dahil satış (eski net 200 + KDV 40).
        saleGross: new Decimal('240.00'),
        saleVat: new Decimal('40.00'),
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
});
