import { OrderStatus } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { openBusinessDayInstant } from '../../helpers/completed-day';
import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

const SECTIONS = ['kpis', 'chart', 'today-products', 'orders'] as const;

interface CancelledFeedBody {
  data: { orderId: string | null; platformOrderId: string }[];
  // Optional so a missing field fails on the assertion, not on the read.
  counts?: { cancelled?: number };
}

interface TodayProductsCostBody {
  data: {
    variantId: string | null;
    costStatus: 'costed' | 'missing';
    // Optional so a missing field fails on the assertion, not on the read.
    currentCostTry?: string | null;
    profileCount?: number;
  }[];
}

/** A product variant of `storeId` sold once in one of today's orders of that store. */
async function variantSoldToday(orgId: string, storeId: string): Promise<string> {
  const product = await createProduct(orgId, storeId);
  const variant = await createProductVariant(orgId, storeId, product.id);
  const order = await createOrder(orgId, storeId, {
    orderDate: openBusinessDayInstant(),
    saleGross: '100.00',
  });
  await createOrderItem(order.id, orgId, {
    productVariantId: variant.id,
    lineSaleGross: '100.00',
  });
  return variant.id;
}

describe('Tenant isolation: live-performance endpoints', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  for (const section of SECTIONS) {
    it(`/${section}: a member of org A cannot read org B's store`, async () => {
      const userA = await createAuthenticatedTestUser();
      const orgA = await createOrganization();
      await createMembership(orgA.id, userA.id);
      await createStore(orgA.id);

      const userB = await createAuthenticatedTestUser();
      const orgB = await createOrganization();
      await createMembership(orgB.id, userB.id);
      const storeB = await createStore(orgB.id);

      // Org B has real data that must never leak to org A.
      await createOrder(orgB.id, storeB.id, {
        orderDate: new Date(),
        saleGross: '1000.00',
      });

      const res = await app.request(
        `/v1/organizations/${orgB.id}/stores/${storeB.id}/live-performance/${section}`,
        { headers: { Authorization: bearer(userA.accessToken) } },
      );

      // 403 (not a member of org B). Never 200 with org B's data.
      expect([403, 404]).toContain(res.status);
    });
  }

  it("/orders?filter=cancelled never lists another tenant's or another store's cancelled order", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // Today's cancels of another tenant and of another store of the same tenant.
    await createOrder(orgB.id, storeB.id, {
      orderDate: openBusinessDayInstant(),
      platformOrderId: 'B-CAN',
      status: OrderStatus.CANCELLED,
    });
    await createOrder(orgA.id, storeA2.id, {
      orderDate: openBusinessDayInstant(),
      platformOrderId: 'A2-CAN',
      status: OrderStatus.CANCELLED,
    });

    const url = `/v1/organizations/${orgA.id}/stores/${storeA1.id}/live-performance/orders?filter=cancelled`;
    const before = await app.request(url, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(before.status).toBe(200);
    const beforeBody: CancelledFeedBody = await before.json();
    expect(beforeBody.counts?.cancelled).toBe(0);
    expect(beforeBody.data).toEqual([]);

    // Positive control: the queried store's own cancel of today is listed, and only it.
    const own = await createOrder(orgA.id, storeA1.id, {
      orderDate: openBusinessDayInstant(),
      platformOrderId: 'A1-CAN',
      status: OrderStatus.CANCELLED,
    });
    const after = await app.request(url, { headers: { Authorization: bearer(userA.accessToken) } });
    expect(after.status).toBe(200);
    const afterBody: CancelledFeedBody = await after.json();
    expect(afterBody.counts?.cancelled).toBe(1);
    expect(afterBody.data.map((row) => [row.orderId, row.platformOrderId])).toEqual([
      [own.id, 'A1-CAN'],
    ]);
  });

  it("/today-products never sums another tenant's cost profile or lists another store's product", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();

    // V1 in store A1, linked to org B's profile by a row no writer produces (the attach
    // guard refuses it): the link carries org A, the profile belongs to org B.
    const v1 = await variantSoldToday(orgA.id, storeA1.id);
    const profileB = await createCostProfile(orgB.id, { amountGross: '99.00' });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: orgA.id, productVariantId: v1, profileId: profileB.id },
    });

    // V2 in store A2 with its own profile, sold today in A2.
    const v2 = await variantSoldToday(orgA.id, storeA2.id);
    const profileA2 = await createCostProfile(orgA.id, {
      storeId: storeA2.id,
      amountGross: '55.00',
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: orgA.id, productVariantId: v2, profileId: profileA2.id },
    });

    const url = `/v1/organizations/${orgA.id}/stores/${storeA1.id}/live-performance/today-products`;
    const before = await app.request(url, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(before.status).toBe(200);
    const beforeBody: TodayProductsCostBody = await before.json();
    // A2's product is absent (the order and buffer reads are store-scoped).
    expect(beforeBody.data.map((row) => row.variantId)).toEqual([v1]);
    expect(beforeBody.data[0]).toMatchObject({
      costStatus: 'missing',
      currentCostTry: null,
      profileCount: 0,
    });

    // Positive control: org A's own profile on V1 is summed.
    const profileA1 = await createCostProfile(orgA.id, {
      storeId: storeA1.id,
      amountGross: '40.00',
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: orgA.id, productVariantId: v1, profileId: profileA1.id },
    });
    const after = await app.request(url, { headers: { Authorization: bearer(userA.accessToken) } });
    expect(after.status).toBe(200);
    const afterBody: TodayProductsCostBody = await after.json();
    expect(afterBody.data.map((row) => row.variantId)).toEqual([v1]);
    expect(afterBody.data[0]).toMatchObject({
      costStatus: 'costed',
      currentCostTry: '40.00',
      profileCount: 1,
    });
  });
});
