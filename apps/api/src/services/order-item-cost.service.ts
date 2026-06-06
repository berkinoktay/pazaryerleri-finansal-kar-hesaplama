import { prisma } from '@pazarsync/db';
import { applyEstimateOnOrderCreate } from '@pazarsync/profit';
import { mapPrismaError } from '@pazarsync/sync-core';
import { Decimal } from 'decimal.js';

import { ConflictError, InvalidReferenceError, NotFoundError } from '../lib/errors';
import type { OrderDetailResponse, SetOrderItemCostBody } from '../validators/order.validator';
import { resolveFxRateForSnapshot } from './fx-rates.service';
import { getOrderById } from './order.service';

/**
 * Structural detector for the order_items_snapshot_immutable trigger's
 * SQLSTATE 42501 (write-once violation), resilient to Prisma 7 driver-adapter
 * error wrapping. The app-layer guard in setOrderItemCost handles the clean
 * already-costed case; this maps the TOCTOU race (two concurrent PATCHes) so a
 * second write surfaces as ConflictError, not 500.
 */
export function isWriteOnceViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  const has42501 = (e: unknown): boolean => {
    if (e === null || typeof e !== 'object' || seen.has(e)) return false;
    seen.add(e);
    const rec = e as Record<string, unknown>;
    if (rec['code'] === '42501') return true;
    if (typeof rec['message'] === 'string' && /write-once|42501/.test(rec['message'])) return true;
    return has42501(rec['cause']) || has42501(rec['meta']);
  };
  if (err instanceof Error && /write-once|42501/.test(err.message)) return true;
  return has42501(err);
}

export async function setOrderItemCost(args: {
  orgId: string;
  storeId: string;
  orderId: string;
  itemId: string;
  body: SetOrderItemCostBody;
}): Promise<OrderDetailResponse> {
  await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({
      where: {
        id: args.itemId,
        orderId: args.orderId,
        order: { organizationId: args.orgId, storeId: args.storeId },
      },
      select: { id: true, unitCostSnapshotNet: true },
    });
    if (item === null) {
      throw new NotFoundError('OrderItem', args.itemId);
    }
    // App-layer write-once guard (frozen, no edit) - primary, deterministic path.
    if (item.unitCostSnapshotNet !== null) {
      throw new ConflictError(`OrderItem ${args.itemId} is already costed - snapshots are frozen`);
    }

    let net: Decimal;
    let vatRate: Decimal;
    let vatAmount: Decimal;

    if (args.body.source === 'manual') {
      net = new Decimal(args.body.netAmount);
      vatRate = new Decimal(args.body.vatRate);
      vatAmount = net.mul(vatRate).div(100).toDecimalPlaces(2);
    } else {
      const profile = await tx.costProfile.findFirst({
        // org-scoped + active only (archived profiles can't be applied - mirrors
        // the cost-profiles list route's `archivedAt: null` guard).
        where: { id: args.body.profileId, organizationId: args.orgId, archivedAt: null },
      });
      if (profile === null) {
        throw new InvalidReferenceError('profileId', args.body.profileId);
      }
      const fx = await resolveFxRateForSnapshot(profile, tx);
      if (fx === null) {
        throw new ConflictError(
          `FX rate unavailable for cost profile ${profile.id} (${profile.currency}) - cost not applied`,
        );
      }
      const amountNet = new Decimal(profile.amount);
      const vatNative =
        profile.vatAmount !== null
          ? new Decimal(profile.vatAmount)
          : amountNet.mul(profile.vatRate).div(100);
      net = amountNet.mul(fx.rate).toDecimalPlaces(2);
      vatAmount = vatNative.mul(fx.rate).toDecimalPlaces(2);
      vatRate = new Decimal(profile.vatRate); // VAT rate is currency-invariant
    }

    try {
      await tx.orderItem.update({
        where: { id: args.itemId },
        data: {
          unitCostSnapshotNet: net,
          unitCostSnapshotVatRate: vatRate,
          unitCostSnapshotVatAmount: vatAmount,
          snapshotCapturedAt: new Date(),
        },
      });
    } catch (err) {
      // Race-only defense: the app-layer guard above handles the deterministic
      // already-costed case. A concurrent second write trips the
      // order_items_snapshot_immutable trigger (SQLSTATE 42501) -> map to 409.
      if (isWriteOnceViolation(err)) {
        throw new ConflictError(
          `OrderItem ${args.itemId} is already costed - snapshots are frozen`,
        );
      }
      mapPrismaError(err); // P-codes -> domain errors; rethrows anything else. Has `: never`.
    }

    // Idempotent + write-once-guarded - fills estimatedNetProfit only once
    // ALL items are costed and sale totals are present; no-op otherwise.
    await applyEstimateOnOrderCreate(args.orderId, tx);
  });

  // getOrderById re-verifies store-in-org (ensureStoreInOrg) - defense-in-depth.
  return getOrderById(args.orgId, args.storeId, args.orderId);
}
