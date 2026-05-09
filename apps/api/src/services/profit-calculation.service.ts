/**
 * Order profit computation service.
 *
 * Per spec §5.4. Write-once: only sets Order.netProfit when:
 *   1. order.netProfit is currently null (never overwrite a sealed value), AND
 *   2. every OrderItem for this order has a non-null unitCostSnapshot.
 *
 * If either condition fails, this is a no-op — the caller can safely call
 * this after every sync event without worrying about double-computation.
 *
 * Profit formula (all values NET of VAT, matching profile.amount convention):
 *   netProfit = totalAmount − commissionAmount − shippingCost − platformFee
 *             − Σ(orderItem.unitCostSnapshot × orderItem.quantity)
 *
 * `vatAmount` is not subtracted: it is a pass-through tax collected on behalf
 * of the government. The seller's economics are on the NET amounts.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderRow {
  id: string;
  totalAmount: Decimal;
  commissionAmount: Decimal;
  shippingCost: Decimal;
  platformFee: Decimal;
  netProfit: Decimal | null;
}

interface OrderItemRow {
  unitCostSnapshot: Decimal | null;
  quantity: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Core profit calculation. Accepts Decimal values already resolved.
 * Separated so it can be unit-tested independently of the DB layer.
 */
export function computeProfit(order: OrderRow, items: OrderItemRow[]): Decimal {
  const totalCost = items.reduce((acc, item) => {
    // unitCostSnapshot is guaranteed non-null by the caller's allHaveSnapshot check.
    return acc.add(new Decimal(item.unitCostSnapshot!).mul(item.quantity));
  }, new Decimal(0));

  return new Decimal(order.totalAmount)
    .sub(order.commissionAmount)
    .sub(order.shippingCost)
    .sub(order.platformFee)
    .sub(totalCost);
}

// ─── Service function ─────────────────────────────────────────────────────────

/**
 * Compute and persist Order.netProfit when all preconditions are met.
 *
 * Idempotent — safe to call multiple times; exits early if netProfit is
 * already set or if any item snapshot is still missing.
 *
 * @param orderId - The order to (potentially) update
 * @param tx      - Active Prisma transaction client
 */
export async function recomputeOrderProfit(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const order = await tx.order.findUnique({ where: { id: orderId } });

  if (!order) {
    return;
  }

  // Write-once: do nothing if profit was already computed.
  if (order.netProfit !== null) {
    return;
  }

  // Wait for all items to have snapshots before computing profit.
  const allHaveSnapshot = items.every((i) => i.unitCostSnapshot !== null);
  if (!allHaveSnapshot) {
    return;
  }

  const netProfit = computeProfit(order, items);

  await tx.order.update({
    where: { id: orderId },
    data: { netProfit },
  });
}
