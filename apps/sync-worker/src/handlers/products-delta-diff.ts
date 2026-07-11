// Pure in-memory diff for the PRODUCTS_DELTA handler. Given the variants on
// one inventory-and-price page and the current DB state for those variants,
// it returns the subset whose quantity OR sale/list price drifted, the
// distinct products those changed variants belong to (so the handler can
// re-aggregate totalStock / min-max sale price), and a count of variants the
// page carried that we have never catalogued. No I/O — unit-tested in
// isolation, so it takes plain values (never a Prisma row or Decimal).

import { Decimal } from 'decimal.js';

/** One variant as returned by the inventory-and-price fetcher. */
export interface FetchedVariant {
  platformVariantId: bigint;
  quantity: number;
  /** 2-dp decimal string from the fetcher — never a float. */
  salePrice: string;
  /** 2-dp decimal string from the fetcher — never a float. */
  listPrice: string;
}

/**
 * The current DB state of a variant, keyed by platformVariantId. Prices are
 * the Prisma Decimal rendered to a string (`row.salePrice.toString()`), so
 * this module has no Prisma/Decimal-column coupling.
 */
export interface ExistingVariantState {
  id: string;
  productId: string;
  quantity: number;
  salePrice: string;
  listPrice: string;
  /**
   * The row's current delistedAt (the raw Prisma value, `Date | null`). A
   * non-null value means the full scan's absence pass previously marked this
   * variant delisted. Its presence in this inventory-and-price feed proves it is
   * listed again, so the diff forces an update that clears it — even when
   * quantity/prices are unchanged.
   */
  delistedAt: Date | null;
}

/** A variant that must be written back because at least one field drifted. */
export interface VariantUpdate {
  id: string;
  productId: string;
  quantity: number;
  salePrice: string;
  listPrice: string;
  /**
   * True when the DB row carried a stale delistedAt that this update must clear.
   * The handler translates it to `delistedAt: null` in the write; false leaves
   * the column untouched. The delta never SETS delistedAt.
   */
  clearDelistedAt: boolean;
}

export interface VariantChangeSet {
  updates: VariantUpdate[];
  affectedProductIds: string[];
  unknownCount: number;
}

// Compare two decimal strings by value, never by float. `.equals` treats
// "100" and "100.00" as equal, so a DB Decimal rendered without trailing
// zeros never registers as a phantom change against the fetcher's 2-dp string.
function priceDiffers(a: string, b: string): boolean {
  return !new Decimal(a).equals(new Decimal(b));
}

export function computeVariantChanges(
  fetched: readonly FetchedVariant[],
  existingByVariantId: ReadonlyMap<bigint, ExistingVariantState>,
): VariantChangeSet {
  const updates: VariantUpdate[] = [];
  const affectedProductIds = new Set<string>();
  let unknownCount = 0;

  for (const variant of fetched) {
    const existing = existingByVariantId.get(variant.platformVariantId);
    if (existing === undefined) {
      unknownCount += 1;
      continue;
    }

    const quantityChanged = existing.quantity !== variant.quantity;
    const saleChanged = priceDiffers(existing.salePrice, variant.salePrice);
    const listChanged = priceDiffers(existing.listPrice, variant.listPrice);
    // Reappearance in the feed of a row still stamped delisted is itself a
    // change that must be written back to clear the stale stamp, regardless of
    // whether stock or price drifted.
    const wasDelisted = existing.delistedAt !== null;
    if (!quantityChanged && !saleChanged && !listChanged && !wasDelisted) {
      continue;
    }

    updates.push({
      id: existing.id,
      productId: existing.productId,
      quantity: variant.quantity,
      salePrice: variant.salePrice,
      listPrice: variant.listPrice,
      clearDelistedAt: wasDelisted,
    });
    affectedProductIds.add(existing.productId);
  }

  return {
    updates,
    affectedProductIds: [...affectedProductIds],
    unknownCount,
  };
}
