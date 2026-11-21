// Order profit snapshot columns (tariff versioning PR-2, task 1).
//
// orders and order_items gain snapshot_* columns that freeze an order's product,
// seller and carrier inputs the first time it enters the profit computation
// (captureOrderProfitSnapshot, task 2). This migration only adds them: a freshly
// written order and item carry no snapshot yet (every column null, the cost
// version list empty), and deleting a carrier an order's snapshot points at
// clears the pointer (ON DELETE SET NULL) instead of blocking the delete or
// cascading into the order.
//
// Runs against the isolated test DB (vitest.config.ts remaps DATABASE_URL). The
// test creates its own org/store/order rows and its own TEST-coded carrier, and
// deletes them afterwards; the shared reference tables are never truncated.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/index';

// A TEST-prefixed code: ensureShippingReferenceData() prunes it if it ever leaks.
const TEST_CARRIER_CODE = 'TEST_SNAPSHOT_CARRIER';
const TEST_CARRIER_EXTERNAL_ID = 990_901;

interface SeededStore {
  orgId: string;
  storeId: string;
}

async function seedStore(): Promise<SeededStore> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `Snapshot Org ${suffix}`, slug: `snapshot-${suffix}` },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Snapshot Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      credentials: 'test-blob',
    },
  });
  return { orgId: org.id, storeId: store.id };
}

async function seedOrder(store: SeededStore, snapshotCarrierId?: string): Promise<string> {
  const order = await prisma.order.create({
    data: {
      organizationId: store.orgId,
      storeId: store.storeId,
      platformOrderId: `snap-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'PENDING',
      ...(snapshotCarrierId === undefined ? {} : { snapshotCarrierId }),
    },
  });
  return order.id;
}

async function deleteTestCarrier(): Promise<void> {
  await prisma.shippingCarrier.deleteMany({
    where: { platform: 'TRENDYOL', code: TEST_CARRIER_CODE },
  });
}

describe('order profit snapshot columns', () => {
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    // A carrier leaked by an earlier failed run would collide on (platform, code).
    await deleteTestCarrier();
  });

  afterAll(async () => {
    // Org delete cascades to its stores, orders and order items.
    for (const orgId of createdOrgIds) {
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await deleteTestCarrier();
  });

  it('a new order and item start with every snapshot column empty and an empty cost list', async () => {
    const store = await seedStore();
    createdOrgIds.push(store.orgId);
    const orderId = await seedOrder(store);
    const item = await prisma.orderItem.create({
      data: { orderId, organizationId: store.orgId, quantity: 1 },
    });

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        snapshotCarrierId: true,
        snapshotCargoProviderName: true,
        snapshotShippingTariffSource: true,
        profitSnapshotAt: true,
      },
    });
    expect(order).toEqual({
      snapshotCarrierId: null,
      snapshotCargoProviderName: null,
      snapshotShippingTariffSource: null,
      profitSnapshotAt: null,
    });

    const storedItem = await prisma.orderItem.findUniqueOrThrow({
      where: { id: item.id },
      select: {
        snapshotProductVariantId: true,
        snapshotUnitDesi: true,
        snapshotDesiSource: true,
        snapshotIsDigital: true,
        snapshotCategoryId: true,
        snapshotBrandId: true,
        snapshotSyncedCommissionRatePct: true,
        snapshotCategoryRatePct: true,
        snapshotCategoryBrandRatePct: true,
        snapshotCostProfileVersionIds: true,
        profitSnapshotAt: true,
      },
    });
    expect(storedItem).toEqual({
      snapshotProductVariantId: null,
      snapshotUnitDesi: null,
      snapshotDesiSource: null,
      snapshotIsDigital: null,
      snapshotCategoryId: null,
      snapshotBrandId: null,
      snapshotSyncedCommissionRatePct: null,
      snapshotCategoryRatePct: null,
      snapshotCategoryBrandRatePct: null,
      snapshotCostProfileVersionIds: [],
      profitSnapshotAt: null,
    });
  });

  it("deleting a carrier clears the order's snapshot carrier", async () => {
    const carrier = await prisma.shippingCarrier.create({
      data: {
        platform: 'TRENDYOL',
        externalId: TEST_CARRIER_EXTERNAL_ID,
        code: TEST_CARRIER_CODE,
        displayName: 'Test Snapshot Kargo',
      },
    });
    const store = await seedStore();
    createdOrgIds.push(store.orgId);
    const orderId = await seedOrder(store, carrier.id);

    const before = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { snapshotCarrierId: true },
    });
    expect(before.snapshotCarrierId).toBe(carrier.id);

    await prisma.shippingCarrier.delete({ where: { id: carrier.id } });

    const after = await prisma.order.findUnique({
      where: { id: orderId },
      select: { snapshotCarrierId: true },
    });
    // The order survives the carrier delete; only its snapshot pointer is cleared.
    expect(after).toEqual({ snapshotCarrierId: null });
  });
});
