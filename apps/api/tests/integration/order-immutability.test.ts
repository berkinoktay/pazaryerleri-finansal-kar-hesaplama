/**
 * PR-9 second half — Order.estimated_net_profit write-once trigger
 * (`orders_estimated_net_profit_write_once`).
 *
 * Spec §8.3 / line 1369: T+0 estimate is immutable; settlements reconcile by
 * writing settled_net_profit instead. The trigger uses IS DISTINCT FROM so a
 * no-op UPDATE (same value re-assigned) is allowed.
 *
 * Edge case coverage matrix (suggested by user review on 2026-05-21):
 *   null → 0         allowed (zero-margin estimate is a valid first write)
 *   null → 100       allowed (normal first write)
 *   100 → 100        allowed (no-op; IS DISTINCT FROM = false)
 *   100 → 150        rejected (value → different value)
 *   100 → 0          rejected (zero is a value, not unset)
 *   100 → null       rejected (write-once means no unset)
 *   0 → 100          rejected (zero is a value; boundary is strict)
 */

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../helpers/db';
import { createOrder, createOrganization, createStore } from '../helpers/factories';

async function buildOrder(estimatedNetProfit: Decimal | null) {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const order = await createOrder(org.id, store.id);

  if (estimatedNetProfit !== null) {
    await prisma.order.update({
      where: { id: order.id },
      data: { estimatedNetProfit },
    });
  }
  return { orderId: order.id };
}

describe('Order.estimated_net_profit write-once trigger', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Allowed transitions ─────────────────────────────────────────────────

  it('allows first write: null → 0 (zero-margin estimate)', async () => {
    const { orderId } = await buildOrder(null);

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('0.00') },
      }),
    ).resolves.toBeDefined();
  });

  it('allows first write: null → 100 (normal first write)', async () => {
    const { orderId } = await buildOrder(null);

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('100.00') },
      }),
    ).resolves.toBeDefined();
  });

  it('allows no-op UPDATE: 100 → 100 (IS DISTINCT FROM = false)', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('100.00') },
      }),
    ).resolves.toBeDefined();
  });

  it('allows UPDATE that does not touch estimated_net_profit', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'DELIVERED' },
      }),
    ).resolves.toBeDefined();
  });

  // ─── Rejected transitions ────────────────────────────────────────────────

  it('rejects 100 → 150 (value → different value)', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('150.00') },
      }),
    ).rejects.toThrow(/estimated_net_profit is write-once/);
  });

  it('rejects 100 → 0 (zero is a value, not unset)', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('0.00') },
      }),
    ).rejects.toThrow(/estimated_net_profit is write-once/);
  });

  it('rejects 100 → null (write-once means no unset)', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: null },
      }),
    ).rejects.toThrow(/estimated_net_profit is write-once/);
  });

  it('rejects 0 → 100 (zero is a value; boundary is strict)', async () => {
    const { orderId } = await buildOrder(new Decimal('0.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('100.00') },
      }),
    ).rejects.toThrow(/estimated_net_profit is write-once/);
  });
});
