import type { Prisma } from '@pazarsync/db';

import { isCostLinkInForce } from './core/seller-costs/cost-profile-in-force';
import type { OrderLineForCalcCheck } from './resolve-order-calculability';

interface InputLine {
  barcode: string;
}

/**
 * Resolve order-line variants by barcode within a store and attach each
 * variant's cost presence, its effective desi and its digital flag, all from the
 * ONE variant query below (no N+1: the links and their profiles' versions are
 * nested selects of that query). Returns the shape the calculability gate
 * (`resolveOrderCalculability`) consumes.
 *
 * Cost rule (plan PR-3b, Berkin 2026-11-23): a variant has a cost when one of its
 * cost-profile links is in force at `at` (`isCostLinkInForce`): attached on or
 * before `at`, with a profile version in force at `at` that is not an archive
 * version. An archived or detached profile, a link attached after `at` and a profile
 * without any version row never count. Callers pass `costDecisionTime(orderDate)`,
 * the end of the order's business day, never the app clock. `unitCostSnapshotNet` is
 * the profile's current `amountGross` of the newest link in force, used only as a
 * presence signal.
 *
 * Tenant scope: the variant query filters on BOTH `organizationId` and `storeId`
 * (SECURITY.md), so a store id or barcode of another organization never resolves;
 * the nested links and their profiles are filtered on `organizationId` too.
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
 * variants; we take the first match per line in variant-id order (the lowest
 * id), within the organization's store. The order-line resolvers make the same
 * choice through `findFirstVariantByBarcode` (its JSDoc lists them), so the
 * variant this gate checks is the one the stored order item names. This gate
 * resolves all lines in the one query below instead of calling it per line.
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
    select: {
      id: true,
      barcode: true,
      isDigital: true,
      dimensionalWeightOverride: true,
      syncedDimensionalWeight: true,
      costProfileLinks: {
        where: {
          organizationId: args.organizationId,
          profile: { organizationId: args.organizationId },
        },
        orderBy: { attachedAt: 'desc' },
        select: {
          attachedAt: true,
          profile: {
            select: {
              amountGross: true,
              // Only the version in force at `at` (the highest version number effective
              // by then): the in-force rule reads nothing else.
              versions: {
                where: { effectiveFrom: { lte: args.at } },
                orderBy: { version: 'desc' },
                take: 1,
                select: { effectiveFrom: true, version: true, archivedAt: true },
              },
            },
          },
        },
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
    const costLink = variant.costProfileLinks.find((link) =>
      isCostLinkInForce(
        {
          attachedAt: link.attachedAt,
          versions: link.profile.versions.map((version) => ({
            effectiveFrom: version.effectiveFrom,
            versionNumber: version.version,
            archivedAt: version.archivedAt,
          })),
        },
        args.at,
      ),
    );
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
