import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createFinanceRecord,
  createMembership,
  createOrder,
  createOrderClaim,
  createOrderClaimItem,
  createOrderItem,
  createOrganization,
  createProfitLine,
  createStore,
} from '../../helpers/factories';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seeds one order + item with the return-related profit lines the summary
 * reads, plus the SETTLEMENT finance record a SALE_RETURN / COMMISSION_REFUND
 * line is dated by. `recordTransactionDate` places that record in or out of the
 * period; an omitted amount skips that line. The COST_RETURN line carries no
 * record and is counted only when the same item also gets a SALE_RETURN line.
 */
async function seedReturnLines(args: {
  orgId: string;
  storeId: string;
  recordTransactionDate: Date;
  saleReturnGross?: string;
  commissionRefundGross?: string;
  costReturnGross?: string;
}): Promise<void> {
  const order = await createOrder(args.orgId, args.storeId);
  const orderItem = await createOrderItem(order.id, args.orgId, { quantity: 1 });
  const recordId = `rec-${randomUUID().slice(0, 8)}`;
  await createFinanceRecord(args.orgId, args.storeId, {
    recordId,
    transactionDate: args.recordTransactionDate,
  });

  if (args.saleReturnGross !== undefined) {
    await createProfitLine(order.id, args.orgId, args.storeId, {
      orderItemId: orderItem.id,
      type: 'SALE_RETURN',
      certainty: 'ACTUAL',
      source: 'MARKETPLACE_RECORD',
      amountGross: args.saleReturnGross,
      externalRecordId: recordId,
    });
  }
  if (args.commissionRefundGross !== undefined) {
    await createProfitLine(order.id, args.orgId, args.storeId, {
      orderItemId: orderItem.id,
      type: 'COMMISSION_REFUND',
      certainty: 'ACTUAL',
      source: 'MARKETPLACE_RECORD',
      amountGross: args.commissionRefundGross,
      externalRecordId: recordId,
    });
  }
  if (args.costReturnGross !== undefined) {
    await createProfitLine(order.id, args.orgId, args.storeId, {
      orderItemId: orderItem.id,
      type: 'COST_RETURN',
      amountGross: args.costReturnGross,
    });
  }
}

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
    await createClaimFixture({
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

    // Return trio on one item, dated by an in-period settlement record: a
    // SALE_RETURN (120) and COMMISSION_REFUND (12) from ACTUAL marketplace-record
    // lines, plus a COST_RETURN (48) counted because the same item has that
    // dated SALE_RETURN.
    await seedReturnLines({
      orgId: org.id,
      storeId: store.id,
      recordTransactionDate: new Date(),
      saleReturnGross: '120.00',
      commissionRefundGross: '12.00',
      costReturnGross: '48.00',
    });

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
    await createClaimFixture({
      orgId: org.id,
      storeId: store.id,
      orderUnits: 1,
      claimUnits: 1,
      itemStatuses: ['Accepted'],
      resolved: true,
      claimDate: new Date(Date.now() - 400 * DAY_MS), // 30g penceresi DIŞI
    });
    // SALE_RETURN line dated by an out-of-period settlement record: its own
    // write time is irrelevant, so the money stays out of the summary.
    await seedReturnLines({
      orgId: org.id,
      storeId: store.id,
      recordTransactionDate: new Date(Date.now() - 400 * DAY_MS),
      saleReturnGross: '120.00',
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

  it("dates the money by the return record's transaction date", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Both SALE_RETURN lines are written now; only the one whose settlement
    // record falls in the period is summed.
    await seedReturnLines({
      orgId: org.id,
      storeId: store.id,
      recordTransactionDate: new Date(),
      saleReturnGross: '120.00',
    });
    await seedReturnLines({
      orgId: org.id,
      storeId: store.id,
      recordTransactionDate: new Date(Date.now() - 400 * DAY_MS),
      saleReturnGross: '999.00',
    });

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/claims/summary`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      refundDeductionGross: '120.00',
      commissionRefundGross: '0.00',
      costReturnGross: '0.00',
      netImpactGross: '-120.00',
    });
  });

  it('counts a cost return only with a dated return record of the same item', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Item A has a dated SALE_RETURN, so its COST_RETURN (48) counts.
    await seedReturnLines({
      orgId: org.id,
      storeId: store.id,
      recordTransactionDate: new Date(),
      saleReturnGross: '120.00',
      costReturnGross: '48.00',
    });
    // Item B has a COST_RETURN but no SALE_RETURN record, so its 30 is ignored.
    await seedReturnLines({
      orgId: org.id,
      storeId: store.id,
      recordTransactionDate: new Date(),
      costReturnGross: '30.00',
    });

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/claims/summary`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      refundDeductionGross: '120.00',
      commissionRefundGross: '0.00',
      costReturnGross: '48.00',
      netImpactGross: '-72.00',
    });
  });
});
