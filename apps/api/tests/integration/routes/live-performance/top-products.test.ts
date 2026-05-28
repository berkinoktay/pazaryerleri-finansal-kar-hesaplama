import { getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../../helpers/factories';

function todayAt(hours: number): Date {
  return new Date(getBusinessDayRange().start.getTime() + hours * 60 * 60 * 1000);
}

interface TopProductsBody {
  data: {
    rank: number;
    variantId: string;
    productName: string;
    orderCount: number;
    revenue: string;
    profit: string | null;
  }[];
}

/** Create a variant and `count` of today's orders that each sell one unit of it. */
async function sellVariant(
  orgId: string,
  storeId: string,
  opts: { title: string; seq: number; count: number },
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(700000 + opts.seq),
      productMainId: `PM-${opts.seq}`,
      title: opts.title,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(600000 + opts.seq),
      barcode: `BC-${opts.seq}`,
      stockCode: `SC-${opts.seq}`,
      salePrice: '50.00',
      listPrice: '60.00',
    },
  });

  for (let i = 0; i < opts.count; i++) {
    const order = await createOrder(orgId, storeId, {
      orderDate: todayAt(10),
      saleSubtotalNet: '40.00',
      estimatedNetProfit: '5.00',
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: orgId,
        productVariantId: variant.id,
        quantity: 1,
        unitPrice: '48.00',
        commissionRate: '10.00',
        commissionAmount: '4.80',
        unitPriceNet: '40.00',
      },
    });
  }

  return variant.id;
}

describe('GET /v1/.../live-performance/top-products', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('ranks the top 3 variants by order count with revenue and profit', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const topId = await sellVariant(org.id, store.id, { title: 'Best Seller', seq: 1, count: 3 });
    const midId = await sellVariant(org.id, store.id, { title: 'Runner Up', seq: 2, count: 2 });
    const lowId = await sellVariant(org.id, store.id, { title: 'Third', seq: 3, count: 1 });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/top-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TopProductsBody;
    expect(body.data).toHaveLength(3);

    expect(body.data[0]?.rank).toBe(1);
    expect(body.data[0]?.variantId).toBe(topId);
    expect(body.data[0]?.orderCount).toBe(3);
    expect(body.data[0]?.revenue).toBe('120.00'); // 3 × 40.00
    expect(body.data[0]?.profit).toBe('15.00'); // 3 × 5.00

    expect(body.data[1]?.rank).toBe(2);
    expect(body.data[1]?.variantId).toBe(midId);
    expect(body.data[1]?.orderCount).toBe(2);

    expect(body.data[2]?.rank).toBe(3);
    expect(body.data[2]?.variantId).toBe(lowId);
    expect(body.data[2]?.orderCount).toBe(1);
  });
});
