import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
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
  createOrderItem,
  createOrganization,
  createStore,
} from '../../helpers/factories';

/**
 * Builds an order with `orderUnits` total units (single line) and a claim
 * covering `claimUnits` of them. Item statuses drive derivedStatus. Product
 * + variant are inline (no factory exists); everything else uses factories.
 */
async function createClaimFixture(args: {
  orgId: string;
  storeId: string;
  orderUnits: number;
  claimUnits: number;
  itemStatuses: string[];
  resolved: boolean;
  claimDate?: Date;
  reasonName?: string;
  productTitle?: string;
  platformOrderNumber?: string;
}): Promise<{ orderId: string; claimId: string }> {
  const order = await createOrder(args.orgId, args.storeId, {
    platformOrderNumber: args.platformOrderNumber ?? null,
  });

  const product = await prisma.product.create({
    data: {
      organizationId: args.orgId,
      storeId: args.storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `main-${randomUUID().slice(0, 8)}`,
      title: args.productTitle ?? 'Boyunluk',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: args.orgId,
      storeId: args.storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: `EAN13-${randomUUID().slice(0, 8)}`,
      stockCode: `SKU-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('120.00'),
      listPrice: new Decimal('120.00'),
    },
  });
  const orderItem = await createOrderItem(order.id, args.orgId, {
    quantity: args.orderUnits,
    productVariantId: variant.id,
  });

  const claim = await createOrderClaim(args.orgId, args.storeId, order.id, {
    claimDate: args.claimDate,
    resolved: args.resolved,
  });
  for (const status of args.itemStatuses.slice(0, args.claimUnits)) {
    await createOrderClaimItem(claim.id, {
      orderItemId: orderItem.id,
      status,
      reasonName: args.reasonName ?? 'Hasarlı ürün',
      resolved: args.resolved,
    });
  }

  return { orderId: order.id, claimId: claim.id };
}

describe('Claims routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('LIST: returns claims sorted by claimDate desc with pagination meta and status counts', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const older = await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Accepted'],
      resolved: true,
      claimDate: new Date('2026-06-01T10:00:00Z'),
    });
    const newer = await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Created'],
      resolved: false,
      claimDate: new Date('2026-06-10T10:00:00Z'),
    });

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; derivedStatus: string }[];
      pagination: { total: number };
      counts: { all: number; open: number; resolved: number };
    };
    expect(body.data.map((c) => c.id)).toEqual([newer.claimId, older.claimId]);
    expect(body.pagination.total).toBe(2);
    expect(body.counts).toEqual({ all: 2, open: 1, resolved: 1 });
  });

  it('LIST: paginates — perPage=10&page=2 returns the oldest row with full meta', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // perPage is LOCKED to {10, 25, 50, 100} (TABLE_PER_PAGE_OPTIONS — any
    // other value is a 422), so overflowing the smallest page takes 11 rows.
    // Bare claims (order + claim only) keep this cheap; pagination meta does
    // not depend on the derive fields.
    const claimIds: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const order = await createOrder(org.id, store.id);
      const claim = await createOrderClaim(org.id, store.id, order.id, {
        claimDate: new Date(Date.UTC(2026, 5, 1, 10, i)),
        resolved: false,
      });
      claimIds.push(claim.id);
    }
    const oldest = claimIds[0];

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/claims?perPage=10&page=2`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string }[];
      pagination: { page: number; perPage: number; total: number; totalPages: number };
    };
    expect(body.data.map((c) => c.id)).toEqual([oldest]);
    expect(body.pagination).toEqual({ page: 2, perPage: 10, total: 11, totalPages: 2 });
  });

  it('LIST: status=open filters rows but counts stay tab-independent', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Created'],
      resolved: false,
    });
    await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Accepted'],
      resolved: true,
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/claims?status=open`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { resolved: boolean }[];
      counts: { all: number; open: number; resolved: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.resolved).toBe(false);
    expect(body.counts).toEqual({ all: 2, open: 1, resolved: 1 });
  });

  it('LIST: q matches the order platformOrderNumber', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Created'],
      resolved: false,
      platformOrderNumber: '11101228439',
    });
    await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Created'],
      resolved: false,
      platformOrderNumber: '22202339549',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/claims?q=1110122`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    const body = (await res.json()) as { data: { platformOrderNumber: string | null }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.platformOrderNumber).toBe('11101228439');
  });

  it('LIST: derives status, scope and summaries per row', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    // qty=2 order, 1 unit claimed, resolved all-Accepted → ACCEPTED + PARTIAL.
    await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 2,
      claimUnits: 1,
      itemStatuses: ['Accepted'],
      resolved: true,
      productTitle: 'Kemer',
      reasonName: 'Yanlış ürün',
    });

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    const body = (await res.json()) as {
      data: {
        derivedStatus: string;
        scope: string;
        itemCount: number;
        productSummary: { firstName: string | null; units: number; otherCount: number };
        reasonSummary: { first: string; otherCount: number };
      }[];
    };
    expect(body.data[0]).toMatchObject({
      derivedStatus: 'ACCEPTED',
      scope: 'PARTIAL',
      itemCount: 1,
      productSummary: { firstName: 'Kemer', units: 1, otherCount: 0 },
      reasonSummary: { first: 'Yanlış ürün', otherCount: 0 },
    });
  });

  it('SUMMARY: aggregates the return trio to the kuruş and counts claims', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const { orderId } = await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Accepted'],
      resolved: true,
    });
    await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Created'],
      resolved: false,
    });

    // Return trio on the resolved claim's order — captured now (in period).
    // amountGross = KDV-dahil (eski amountNet + vatAmount): 100+20, 10+2, 40+8.
    const trio = [
      { feeType: 'REFUND_DEDUCTION', direction: 'DEBIT', amountGross: '120.00' },
      { feeType: 'COMMISSION_REFUND', direction: 'CREDIT', amountGross: '12.00' },
      { feeType: 'COST_RETURN', direction: 'CREDIT', amountGross: '48.00' },
    ] as const;
    for (const leg of trio) {
      await createOrderFee(orderId, org.id, {
        feeType: leg.feeType,
        source: 'SETTLEMENT',
        direction: leg.direction,
        amountGross: leg.amountGross,
        vatRate: '20.00',
        trendyolTransactionId: '725041340',
      });
    }

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/claims/summary`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      openCount: 1,
      resolvedInPeriod: 1,
      refundDeductionGross: '120.00',
      commissionRefundGross: '12.00',
      costReturnGross: '48.00',
      // −120 + 12 + 48
      netImpactGross: '-60.00',
    });
  });

  it('SUMMARY: defaults the period when from/to are absent and excludes out-of-period fees', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const { orderId } = await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Accepted'],
      resolved: true,
      claimDate: new Date('2026-01-01T00:00:00Z'), // 30g penceresi DIŞI
    });
    await createOrderFee(orderId, org.id, {
      feeType: 'REFUND_DEDUCTION',
      source: 'SETTLEMENT',
      direction: 'DEBIT',
      amountGross: '120.00', // KDV-dahil (eski amountNet 100 + vatAmount 20)
      vatRate: '20.00',
      trendyolTransactionId: '725041399',
      capturedAt: new Date('2026-01-02T00:00:00Z'), // pencere DIŞI
    });

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/claims/summary`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      openCount: 0,
      resolvedInPeriod: 0, // claimDate pencere dışında
      refundDeductionGross: '0.00',
      commissionRefundGross: '0.00',
      costReturnGross: '0.00',
      netImpactGross: '0.00',
    });
  });
});
