import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../../helpers/factories';

/** A real instant `hours` into today's business day (well inside the window). */
function todayAt(hours: number): Date {
  return new Date(getBusinessDayRange().start.getTime() + hours * 60 * 60 * 1000);
}

interface TodayProductsBody {
  data: {
    variantId: string;
    barcode: string;
    stockCode: string;
    productName: string;
    thumbUrl: string | null;
    orderCount: number;
    unitsSold: number;
    revenue: string;
    costStatus: 'costed' | 'missing';
    unitCost: string | null;
  }[];
}

async function createVariant(
  orgId: string,
  storeId: string,
  opts: { title: string; barcode: string; seq: number },
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(910000 + opts.seq),
      productMainId: `PM-${opts.seq}`,
      title: opts.title,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(810000 + opts.seq),
      barcode: opts.barcode,
      stockCode: `SC-${opts.seq}`,
      salePrice: '100.00',
      listPrice: '120.00',
    },
  });
  return variant.id;
}

/** Create `count` of today's orders, each selling one unit of `variantId`. */
async function sellInOrders(
  orgId: string,
  storeId: string,
  variantId: string,
  opts: { count: number; unitPriceNet: string; unitCostSnapshotNet?: string },
): Promise<void> {
  for (let i = 0; i < opts.count; i += 1) {
    const order = await createOrder(orgId, storeId, {
      orderDate: todayAt(10),
      saleSubtotalNet: opts.unitPriceNet,
      estimatedNetProfit: opts.unitCostSnapshotNet !== undefined ? '5.00' : null,
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: orgId,
        productVariantId: variantId,
        quantity: 1,
        unitPrice: '120.00',
        commissionRate: '10.00',
        commissionAmount: '12.00',
        unitPriceNet: opts.unitPriceNet,
        unitCostSnapshotNet: opts.unitCostSnapshotNet ?? null,
      },
    });
  }
}

describe('GET /v1/.../live-performance/today-products', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('merges orders and buffer into a single row per barcode', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Pamuklu Tişört',
      barcode: 'BC-MERGE',
      seq: 1,
    });

    // Two orders today (2 units, ₺80 revenue) + one buffer entry (3 units, ₺150).
    await sellInOrders(org.id, store.id, variantId, { count: 2, unitPriceNet: '40.00' });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleSubtotalNet: '150.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'BC-MERGE', quantity: 3, unitPriceNet: '50.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.variantId).toBe(variantId);
    expect(row?.barcode).toBe('BC-MERGE');
    expect(row?.stockCode).toBe('SC-1');
    expect(row?.productName).toBe('Pamuklu Tişört');
    expect(row?.orderCount).toBe(3); // 2 orders + 1 buffer entry
    expect(row?.unitsSold).toBe(5); // 2 + 3
    expect(row?.revenue).toBe('230.00'); // 80 + 150
    // No cost profile attached → missing.
    expect(row?.costStatus).toBe('missing');
    expect(row?.unitCost).toBeNull();
  });

  it('marks variants with an active cost profile as costed and surfaces the snapshot unit cost', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Costed variant: an active profile + a today order carrying a net snapshot.
    const costedId = await createVariant(org.id, store.id, {
      title: 'Costed Variant',
      barcode: 'BC-COSTED',
      seq: 2,
    });
    const profile = await createCostProfile(org.id);
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: costedId,
        profileId: profile.id,
        attachedBy: user.id,
      },
    });
    await sellInOrders(org.id, store.id, costedId, {
      count: 1,
      unitPriceNet: '60.00',
      unitCostSnapshotNet: '30.00',
    });

    // Cost-missing variant: buffer only, no profile.
    const missingId = await createVariant(org.id, store.id, {
      title: 'Missing Variant',
      barcode: 'BC-MISSING',
      seq: 3,
    });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleSubtotalNet: '90.00',
        orderDate: todayAt(12).toISOString(),
        lines: [{ barcode: 'BC-MISSING', quantity: 1, unitPriceNet: '90.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(2);

    const costed = body.data.find((r) => r.variantId === costedId);
    expect(costed?.costStatus).toBe('costed');
    expect(costed?.unitCost).toBe('30.00');

    const missing = body.data.find((r) => r.variantId === missingId);
    expect(missing?.costStatus).toBe('missing');
    expect(missing?.unitCost).toBeNull();
  });

  it('reports costed with a null unitCost when the order-item carries no snapshot', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Active cost profile attached, but today's order-item has no net snapshot
    // (omitting unitCostSnapshotNet stores null). Cost status is authoritative
    // from the profile; the displayed unit cost stays null.
    const costedId = await createVariant(org.id, store.id, {
      title: 'Costed No-Snapshot Variant',
      barcode: 'BC-NO-SNAPSHOT',
      seq: 4,
    });
    const profile = await createCostProfile(org.id);
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: costedId,
        profileId: profile.id,
        attachedBy: user.id,
      },
    });
    await sellInOrders(org.id, store.id, costedId, { count: 1, unitPriceNet: '50.00' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(1);

    const row = body.data[0];
    expect(row?.variantId).toBe(costedId);
    expect(row?.costStatus).toBe('costed');
    expect(row?.unitCost).toBeNull();
  });
});
