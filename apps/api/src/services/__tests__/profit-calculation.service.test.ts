/**
 * Unit tests for recomputeOrderProfit.
 *
 * All Prisma calls are mocked via vi.fn(). No DB required.
 * Per spec §5.4: write-once enforced — only sets netProfit when:
 *   1. order.netProfit is currently null, AND
 *   2. all order items have a non-null unitCostSnapshot
 *
 * Profit formula: revenue − commission − shipping − platformFee − Σ(unitCostSnapshot × quantity)
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { recomputeOrderProfit } from '../profit-calculation.service';

// ─── Mock factory helpers ────────────────────────────────────────────────────

const BASE_ORDER = {
  id: 'order-1',
  totalAmount: new Decimal('200.00'),
  commissionAmount: new Decimal('20.00'),
  shippingCost: new Decimal('10.00'),
  platformFee: new Decimal('5.00'),
  vatAmount: new Decimal('0.00'),
  netProfit: null,
};

function makeItem(unitCostSnapshot: Decimal | null, quantity = 1) {
  return {
    id: `item-${Math.random()}`,
    orderId: 'order-1',
    unitCostSnapshot,
    quantity,
    unitPrice: new Decimal('100.00'),
    commissionRate: new Decimal('10.00'),
    commissionAmount: new Decimal('10.00'),
  };
}

function makeTx(overrides: { order?: object; items?: object[] }) {
  const order = overrides.order ?? BASE_ORDER;
  const items = overrides.items ?? [makeItem(new Decimal('30.00'))];

  return {
    orderItem: {
      findMany: vi.fn().mockResolvedValue(items),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('recomputeOrderProfit', () => {
  it('sets netProfit when currently null and all items have snapshots', async () => {
    // order: 200 revenue - 20 commission - 10 shipping - 5 platformFee - 30 cost = 135
    const tx = makeTx({
      items: [makeItem(new Decimal('30.00'), 1)],
    });

    await recomputeOrderProfit('order-1', tx as never);

    expect(tx.order.update).toHaveBeenCalledOnce();
    const call = tx.order.update.mock.calls[0]![0];
    expect(call.data.netProfit.toFixed(2)).toBe('135.00');
  });

  it('handles multiple items and multiplies unitCostSnapshot by quantity', async () => {
    // item1: cost=50 × qty=2 → 100 TRY
    // item2: cost=10 × qty=3 → 30 TRY
    // total cost = 130 TRY
    // profit = 200 - 20 - 10 - 5 - 130 = 35
    const tx = makeTx({
      items: [makeItem(new Decimal('50.00'), 2), makeItem(new Decimal('10.00'), 3)],
    });

    await recomputeOrderProfit('order-1', tx as never);

    expect(tx.order.update).toHaveBeenCalledOnce();
    const call = tx.order.update.mock.calls[0]![0];
    expect(call.data.netProfit.toFixed(2)).toBe('35.00');
  });

  it('is a no-op when order.netProfit is already non-null (write-once)', async () => {
    const tx = makeTx({
      order: { ...BASE_ORDER, netProfit: new Decimal('100.00') },
      items: [makeItem(new Decimal('30.00'))],
    });

    await recomputeOrderProfit('order-1', tx as never);

    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('is a no-op when any item has a null unitCostSnapshot (incomplete data)', async () => {
    const tx = makeTx({
      items: [makeItem(new Decimal('30.00')), makeItem(null)],
    });

    await recomputeOrderProfit('order-1', tx as never);

    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('is a no-op when order is not found', async () => {
    const tx = makeTx({});
    tx.order.findUnique = vi.fn().mockResolvedValue(null);

    await recomputeOrderProfit('order-1', tx as never);

    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
