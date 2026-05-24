import type { Prisma } from '@pazarsync/db';

import type { OrderLineForCalcCheck } from './resolve-order-calculability';

interface InputLine {
  barcode: string;
}

/**
 * Resolve order-line variants by barcode within a store and attach each
 * variant's most-recent cost-profile-link net amount. Returns the shape the
 * calculability gate (`resolveOrderCalculability`) consumes.
 *
 * `CostProfile.amount` is NET (KDV hariç) — that is `unitCostSnapshotNet`.
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
      costProfileLinks: {
        orderBy: { attachedAt: 'desc' },
        take: 1,
        select: { profile: { select: { amount: true } } },
      },
    },
  });

  return args.lines.map((inputLine) => {
    const variant = variants.find((v) => v.barcode === inputLine.barcode);
    if (variant === undefined) {
      return { barcode: inputLine.barcode, variantId: null, unitCostSnapshotNet: null };
    }
    const costLink = variant.costProfileLinks[0];
    return {
      barcode: inputLine.barcode,
      variantId: variant.id,
      unitCostSnapshotNet: costLink?.profile.amount.toString() ?? null,
    };
  });
}
