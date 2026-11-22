import type { Prisma } from '@pazarsync/db';

import type { OrderLineForCalcCheck } from './resolve-order-calculability';

interface InputLine {
  barcode: string;
}

/**
 * Resolve order-line variants by barcode within a store and attach each
 * variant's most-recent cost-profile-link amount, its effective desi and its
 * digital flag, all from the ONE variant query below (no N+1). Returns the shape
 * the calculability gate (`resolveOrderCalculability`) consumes.
 *
 * Effective desi (plan PR-2c): the seller's override, else the Trendyol desi;
 * null when neither exists. `??` (never `||`) so a desi of 0, a real desi, is kept.
 *
 * GROSS konvansiyon (2026-06-16): `CostProfile.amountGross` is GROSS (KDV-dahil).
 * The calculability gate only checks presence (non-null) — gross vs net is
 * irrelevant here; it routes full-profit vs cost-missing, never computes profit.
 *
 * Accepts the Prisma client OR an interactive-transaction client. `(storeId,
 * barcode)` is non-unique by design, so a barcode may match multiple
 * variants; we take the first match per line, mirroring how the order-item
 * upsert resolves variants by barcode.
 */
export async function buildCalcCheckLines(
  db: Prisma.TransactionClient,
  args: { storeId: string; lines: InputLine[] },
): Promise<OrderLineForCalcCheck[]> {
  const barcodes = args.lines.map((line) => line.barcode);
  const variants = await db.productVariant.findMany({
    where: { storeId: args.storeId, barcode: { in: barcodes } },
    select: {
      id: true,
      barcode: true,
      isDigital: true,
      dimensionalWeightOverride: true,
      syncedDimensionalWeight: true,
      costProfileLinks: {
        orderBy: { attachedAt: 'desc' },
        take: 1,
        select: { profile: { select: { amountGross: true } } },
      },
    },
  });

  return args.lines.map((inputLine) => {
    const variant = variants.find((v) => v.barcode === inputLine.barcode);
    if (variant === undefined) {
      return {
        barcode: inputLine.barcode,
        variantId: null,
        unitCostSnapshotNet: null,
        unitDesi: null,
        isDigital: false,
      };
    }
    const costLink = variant.costProfileLinks[0];
    const effectiveDesi = variant.dimensionalWeightOverride ?? variant.syncedDimensionalWeight;
    return {
      barcode: inputLine.barcode,
      variantId: variant.id,
      unitCostSnapshotNet: costLink?.profile.amountGross.toString() ?? null,
      unitDesi: effectiveDesi?.toString() ?? null,
      isDigital: variant.isDigital,
    };
  });
}
