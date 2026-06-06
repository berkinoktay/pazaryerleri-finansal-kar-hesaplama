import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const PATH = (o: string, s: string, ord: string, item: string) =>
  `/v1/organizations/${o}/stores/${s}/orders/${ord}/items/${item}/cost`;

const patch = (url: string, token: string, body: unknown) =>
  createApp().request(url, {
    method: 'PATCH',
    headers: { Authorization: bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Seed a fully-specified single-item order with the item's cost snapshot NULL
 *  (mirrors apply-estimate-on-order-create.test.ts createOrderWithItem). */
async function seedEstimateOrder(
  orgId: string,
  storeId: string,
): Promise<{ orderId: string; itemId: string }> {
  const base = await createOrder(orgId, storeId, {
    status: 'DELIVERED',
    saleSubtotalNet: '100.00',
    saleVatTotal: '20.00',
  });
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(930000 + Math.floor(Math.random() * 50000)),
      productMainId: `PM-${base.id.slice(0, 8)}`,
      title: 'Estimate Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(830000 + Math.floor(Math.random() * 50000)),
      barcode: `bc-${base.id.slice(0, 6)}`,
      stockCode: `sk-${base.id.slice(0, 6)}`,
      salePrice: '100',
      listPrice: '120',
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: base.id,
      organizationId: orgId,
      productVariantId: variant.id,
      quantity: 1,
      unitPrice: '120',
      commissionRate: '10',
      commissionAmount: '12',
      grossCommissionAmountNet: '10',
      grossCommissionVatAmount: '2',
      unitCostSnapshotNet: null,
      unitCostSnapshotVatAmount: null, // cost MISSING -> estimate null
    },
  });
  return { orderId: base.id, itemId: item.id };
}

describe('PATCH order item cost', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('manual: writes the frozen snapshot columns', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id, {
      saleSubtotalNet: null,
      saleVatTotal: null,
    });
    const item = await createOrderItem(order.id, org.id, {
      quantity: 1,
      unitCostSnapshotNet: null,
    });

    const res = await patch(PATH(org.id, store.id, order.id, item.id), user.accessToken, {
      source: 'manual',
      netAmount: '42.00',
      vatRate: 20,
    });
    expect(res.status).toBe(200);

    const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(new Decimal(updated.unitCostSnapshotNet!).toString()).toBe('42');
    expect(new Decimal(updated.unitCostSnapshotVatRate!).toString()).toBe('20');
    expect(new Decimal(updated.unitCostSnapshotVatAmount!).toString()).toBe('8.4'); // 42 * 20 / 100
    expect(updated.snapshotCapturedAt).not.toBeNull();
  });

  it('profile (TRY): writes net + vat from the chosen profile', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id, {
      saleSubtotalNet: null,
      saleVatTotal: null,
    });
    const item = await createOrderItem(order.id, org.id, {
      quantity: 1,
      unitCostSnapshotNet: null,
    });
    const profile = await createCostProfile(org.id, { amount: '50.00' }); // vatRate 20, vatAmount '10.00', TRY

    const res = await patch(PATH(org.id, store.id, order.id, item.id), user.accessToken, {
      source: 'profile',
      profileId: profile.id,
    });
    expect(res.status).toBe(200);

    const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(new Decimal(updated.unitCostSnapshotNet!).toString()).toBe('50');
    expect(new Decimal(updated.unitCostSnapshotVatAmount!).toString()).toBe('10');
    expect(new Decimal(updated.unitCostSnapshotVatRate!).toString()).toBe('20');
  });

  it('already-costed item -> 409 CONFLICT (frozen, no edit)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(order.id, org.id, { unitCostSnapshotNet: '10.00' });

    const res = await patch(PATH(org.id, store.id, order.id, item.id), user.accessToken, {
      source: 'manual',
      netAmount: '42.00',
      vatRate: 20,
    });
    expect(res.status).toBe(409);
  });

  it('unknown / archived cost profile -> 422 INVALID_REFERENCE', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(order.id, org.id, { unitCostSnapshotNet: null });

    const res = await patch(PATH(org.id, store.id, order.id, item.id), user.accessToken, {
      source: 'profile',
      profileId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(422);
  });

  it('recomputes estimatedNetProfit once the last item is costed', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    const { orderId, itemId } = await seedEstimateOrder(org.id, store.id);

    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(before.estimatedNetProfit).toBeNull();

    const res = await patch(PATH(org.id, store.id, orderId, itemId), user.accessToken, {
      source: 'manual',
      netAmount: '50.00',
      vatRate: 20,
    });
    expect(res.status).toBe(200);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(new Decimal(after.estimatedNetProfit!).toString()).toBe('28.01'); // 100 - 50 - 10 - 10.99 - 1
  });

  it("cross-store item -> 404 (item belongs to another store's order)", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const storeA = await createStore(org.id);
    const storeB = await createStore(org.id);
    const orderB = await createOrder(org.id, storeB.id);
    const itemB = await createOrderItem(orderB.id, org.id, { unitCostSnapshotNet: null });

    // Same org, but the item's order lives under storeB - addressing it via storeA's path must 404.
    const res = await patch(PATH(org.id, storeA.id, orderB.id, itemB.id), user.accessToken, {
      source: 'manual',
      netAmount: '42.00',
      vatRate: 20,
    });
    expect(res.status).toBe(404);
  });
});
