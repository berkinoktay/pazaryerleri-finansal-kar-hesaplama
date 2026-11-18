import type { Prisma } from '@pazarsync/db';

export interface VariantLookupScope {
  readonly organizationId: string;
  readonly storeId: string;
}

/**
 * The seller's variant id for each of the given barcodes, in ONE query scoped to the
 * organization and the store. The single copy of the campaign pages' matching rule: an
 * exact barcode match. `(storeId, barcode)` is not unique, so when several variants of
 * the store share a barcode a variant still in the feed (delistedAt null) beats a
 * delisted one, then the oldest wins (createdAt, then id). The order is total and
 * deterministic for a given catalog state, so the import and a read made at the same
 * catalog state pick the same row; later reads follow the catalog (a delisting or a new
 * duplicate can change the pick). A barcode with no variant is absent from the map. An
 * empty input issues no query. Errors are not caught: the caller decides (a campaign
 * screen read logs and degrades, `resolveScreenVariantIds`).
 */
export async function resolveVariantIdsByBarcode(
  client: Prisma.TransactionClient,
  scope: VariantLookupScope,
  barcodes: Iterable<string>,
): Promise<ReadonlyMap<string, string>> {
  const distinct = [...new Set(barcodes)];
  if (distinct.length === 0) return new Map<string, string>();

  const variants = await client.productVariant.findMany({
    where: {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      barcode: { in: distinct },
    },
    // Oldest first. The delisting time is deliberately not part of the order: the
    // catalog sync stamps each copy on the day it leaves the feed, so ordering by it
    // would let a later duplicate take over once both are delisted.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, barcode: true, delistedAt: true },
  });

  const idByBarcode = new Map<string, string>();
  const listedBarcodes = new Set<string>();
  for (const variant of variants) {
    // Rows arrive oldest first: the first listed row per barcode wins, and a delisted
    // row is kept only while no row of that barcode has been seen yet.
    if (listedBarcodes.has(variant.barcode)) continue;
    if (variant.delistedAt === null) {
      idByBarcode.set(variant.barcode, variant.id);
      listedBarcodes.add(variant.barcode);
      continue;
    }
    if (!idByBarcode.has(variant.barcode)) idByBarcode.set(variant.barcode, variant.id);
  }
  return idByBarcode;
}
