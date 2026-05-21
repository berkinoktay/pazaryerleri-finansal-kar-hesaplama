import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
  createUserProfile,
} from '../helpers/factories';

describe('cost snapshot immutability trigger', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function buildOrderItem() {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        productMainId: `main-${randomUUID().slice(0, 8)}`,
        title: 'Test Product',
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        barcode: randomUUID().slice(0, 13),
        stockCode: `SKU-${randomUUID().slice(0, 8)}`,
        salePrice: new Decimal('199.99'),
        listPrice: new Decimal('249.99'),
      },
    });

    const order = await createOrder(org.id, store.id);

    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productVariantId: variant.id,
        organizationId: org.id,
        quantity: 1,
        unitPrice: new Decimal('199.99'),
        commissionRate: new Decimal('12.50'),
        commissionAmount: new Decimal('25.00'),
      },
    });

    return { item };
  }

  it('rejects UPDATE that changes a non-null unit_cost_snapshot', async () => {
    const { item } = await buildOrderItem();

    // null → value is allowed (first write)
    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        unitCostSnapshotNet: new Decimal('100.00'),
        snapshotCapturedAt: new Date(),
      },
    });

    // value → different value must be rejected by the trigger
    await expect(
      prisma.orderItem.update({
        where: { id: item.id },
        data: { unitCostSnapshotNet: new Decimal('110.00') },
      }),
    ).rejects.toThrow(/write-once/);
  });

  it('rejects UPDATE that changes a non-null snapshot_captured_at', async () => {
    const { item } = await buildOrderItem();

    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        unitCostSnapshotNet: new Decimal('100.00'),
        snapshotCapturedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    await expect(
      prisma.orderItem.update({
        where: { id: item.id },
        data: { snapshotCapturedAt: new Date('2026-02-01T00:00:00Z') },
      }),
    ).rejects.toThrow(/write-once/);
  });

  it('allows UPDATE that does not touch snapshot fields', async () => {
    const { item } = await buildOrderItem();

    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        unitCostSnapshotNet: new Decimal('100.00'),
        snapshotCapturedAt: new Date(),
      },
    });

    // Updating an unrelated field must succeed — trigger only guards the snapshot fields
    await expect(
      prisma.orderItem.update({
        where: { id: item.id },
        data: { quantity: 5 },
      }),
    ).resolves.toBeDefined();
  });
});
