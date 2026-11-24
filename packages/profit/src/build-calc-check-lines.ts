import type { Prisma } from '@pazarsync/db';

import { compareText } from './core/compare-text';
import { chooseOrderCostVersion } from './core/seller-costs/cost-profile-in-force';
import {
  loadSellerInputsAt,
  resolveDesiAtDayEnd,
  type SellerInputsAt,
} from './persistence/seller-inputs-at';
import type { OrderLineForCalcCheck } from './resolve-order-calculability';

interface InputLine {
  barcode: string;
}

/**
 * Resolve order-line variants by barcode within a store and attach each
 * variant's cost presence, its effective desi and its digital flag. Two reads, never
 * per line: the barcode -> variant query below, then one `loadSellerInputsAt` for
 * the resolved variants. Returns the shape the calculability gate
 * (`resolveOrderCalculability`) consumes.
 *
 * Seller inputs at `at` (same-day edit window, plan PR-1; Berkin 2026-11-23): the
 * cost links and the desi are the ones in force at `at`, rebuilt by the one day-end
 * loader (`loadSellerInputsAt`) from the live rows and the seller-input history logs.
 * Callers pass `costDecisionTime(orderDate)`, the end of the order's business day,
 * never the app clock: a detach, a desi change or a new desi stamped after that day
 * end does not reach the line, while every change during the day does. For today's
 * order `at` is still ahead, so the line reads the live state.
 *
 * Cost rule (plan PR-3b): a variant has a cost when one of its links at `at` is in
 * force (`chooseOrderCostVersion` picks a version): attached on or before `at`, with
 * a profile version in force at `at` that is not an archive version. An archived or
 * detached profile, a link attached after `at` and a profile without any version row
 * never count. `unitCostSnapshotNet` is the gross amount of that version, of the
 * newest such link, used only as a presence signal.
 *
 * Tenant scope: the variant query filters on BOTH `organizationId` and `storeId`
 * (SECURITY.md), so a store id or barcode of another organization never resolves;
 * the loader filters every read on `organizationId` too.
 *
 * Effective desi (plan PR-2c): the seller's override at `at`, else the Trendyol desi
 * at `at` (`resolveDesiAtDayEnd`); null when neither exists. Any value is kept, a
 * stored 0 included (a seller desi is at least 1).
 *
 * GROSS konvansiyon (2026-06-16): cost amounts are GROSS (KDV-dahil). The
 * calculability gate only checks presence (non-null) — gross vs net is
 * irrelevant here; it routes full-profit vs cost-missing, never computes profit.
 *
 * Accepts the Prisma client OR an interactive-transaction client (the loader's read
 * order keeps a concurrent detach visible on the plain client). `(storeId, barcode)`
 * is non-unique by design, so a barcode may match multiple variants; we take the
 * first match per line in variant-id order (the lowest id), within the
 * organization's store. The order-line resolvers make the same choice through
 * `findFirstVariantByBarcode` (its JSDoc lists them), so the variant this gate
 * checks is the one the stored order item names. This gate resolves all lines in the
 * one query below instead of calling it per line.
 */
export async function buildCalcCheckLines(
  db: Prisma.TransactionClient,
  args: { organizationId: string; storeId: string; lines: InputLine[]; at: Date },
): Promise<OrderLineForCalcCheck[]> {
  const barcodes = args.lines.map((line) => line.barcode);
  const variants = await db.productVariant.findMany({
    where: {
      organizationId: args.organizationId,
      storeId: args.storeId,
      barcode: { in: barcodes },
    },
    // Deterministic first match per barcode (lowest variant id), mirrored by the
    // live-performance today-products table and by `findFirstVariantByBarcode` (the
    // order-line variant resolvers), so all of them name the same variant.
    orderBy: { id: 'asc' },
    select: { id: true, barcode: true, isDigital: true },
  });
  const variantByLine = args.lines.map((inputLine) =>
    variants.find((variant) => variant.barcode === inputLine.barcode),
  );
  const inputsByVariant = await loadSellerInputsAt(db, {
    organizationId: args.organizationId,
    variantIds: variantByLine
      .filter((variant) => variant !== undefined)
      .map((variant) => variant.id),
    at: args.at,
  });

  return args.lines.map((inputLine, index) => {
    const variant = variantByLine[index];
    if (variant === undefined) {
      return {
        barcode: inputLine.barcode,
        variantId: null,
        unitCostSnapshotNet: null,
        unitDesi: null,
        isDigital: false,
      };
    }
    const inputs = inputsByVariant.get(variant.id);
    return {
      barcode: inputLine.barcode,
      variantId: variant.id,
      unitCostSnapshotNet: costAmountAt(inputs, args.at),
      unitDesi: inputs === undefined ? null : desiText(inputs),
      isDigital: variant.isDigital,
    };
  });
}

/**
 * The gross amount, as a decimal string, of the version in force at `at` of the
 * newest link in force at `at` (latest `attachedAt`, then profile id, so the pick
 * never depends on read order); null when no link is in force then.
 */
function costAmountAt(inputs: SellerInputsAt | undefined, at: Date): string | null {
  const links = [...(inputs?.costProfiles ?? [])].sort(
    (a, b) =>
      b.attachedAt.getTime() - a.attachedAt.getTime() || compareText(a.profileId, b.profileId),
  );
  for (const link of links) {
    const version = chooseOrderCostVersion(link, { at });
    if (version !== null) {
      return version.amountGross.toString();
    }
  }
  return null;
}

/** The effective desi at the day end as a decimal string, null when there is none. */
function desiText(inputs: SellerInputsAt): string | null {
  return resolveDesiAtDayEnd(inputs.desi).value?.toString() ?? null;
}
