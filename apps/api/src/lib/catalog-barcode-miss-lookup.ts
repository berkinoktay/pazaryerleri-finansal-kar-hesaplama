import { prisma } from '@pazarsync/db';

/**
 * Resolve which of the given barcodes are CONFIRMED catalog gaps (a
 * `CatalogBarcodeMiss` row with `vendorMissing = true`) for one org+store.
 *
 * Shared by `order.service` (order-detail items) and `live-performance.service`
 * (today-products / buffer lines): both surface a derived `vendorMissing`
 * boolean on UNMATCHED lines so the frontend can render "Trendyol kataloğunda
 * yok" instead of "eşleşme bekliyor". The backend derives it — the frontend
 * never computes it.
 *
 * `vendorMissing = true` means the barcode is permanently absent from the
 * seller's Trendyol approved catalog (a catalog gap), not a transient fetch
 * error. The query filters by `organizationId` AND `storeId` (tenant rule) plus
 * `vendorMissing: true`, and runs ONCE over the distinct barcodes of a request's
 * unmatched lines — no N+1. An empty input short-circuits to an empty set.
 */
export async function resolveVendorMissingBarcodes(
  orgId: string,
  storeId: string,
  barcodes: readonly string[],
): Promise<Set<string>> {
  const distinct = [...new Set(barcodes)];
  if (distinct.length === 0) return new Set<string>();

  const rows = await prisma.catalogBarcodeMiss.findMany({
    where: {
      organizationId: orgId,
      storeId,
      vendorMissing: true,
      barcode: { in: distinct },
    },
    select: { barcode: true },
  });
  return new Set(rows.map((row) => row.barcode));
}
