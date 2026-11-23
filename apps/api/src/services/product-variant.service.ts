import { prisma } from '@pazarsync/db';
import type { ProductVariant } from '@pazarsync/db';

import { NotFoundError } from '../lib/errors';
import { flipBufferForVariants } from './live-performance-buffer-flip.service';

// ─── setDimensionalWeight ──────────────────────────────────────────────
// User-override mutation. Writes ONLY to the `dimensionalWeightOverride`
// column (DB: dimensional_weight_override).
// The sister column `syncedDimensionalWeight` is never touched here —
// the sync worker owns it. See packages/db/prisma/schema.prisma
// (ProductVariant) for the two-column split rationale.
//
// `value === null` clears the override, after which the read path
// automatically falls back to `syncedDimensionalWeight` via the
// VariantSummary mapper's `??` cascade.
//
// Tenant guard: the updateMany filter includes organizationId AND
// storeId, so a caller from org A cannot mutate a variant in org B even
// if they guess a valid UUID. A zero-affected-rows result becomes a
// NotFoundError to avoid disclosing whether the variant exists in
// another org.
//
// Live Performance buffer (plan PR-2c, decision 7): entering a desi (any
// non-null value; a seller desi is at least 1) re-checks the variant's PENDING buffer
// entries of today in the same transaction, store-scoped, and flips those
// whose order is now fully calculable (cost + desi) to PROMOTING. Clearing
// the override (null) cannot make an order calculable, so it skips the check.

export async function setDimensionalWeight(opts: {
  organizationId: string;
  storeId: string;
  variantId: string;
  value: string | null;
}): Promise<
  Pick<ProductVariant, 'id' | 'dimensionalWeightOverride' | 'syncedDimensionalWeight' | 'isDigital'>
> {
  const { organizationId, storeId, variantId, value } = opts;

  // A stored order keeps the desi captured at intake, so the override reaches
  // only new orders, buffered orders not yet in `orders`, and the catalog
  // estimate; no stored order is queued.
  return prisma.$transaction(async (tx) => {
    const result = await tx.productVariant.updateMany({
      where: { id: variantId, organizationId, storeId },
      data: { dimensionalWeightOverride: value },
    });

    if (result.count === 0) {
      throw new NotFoundError('ProductVariant', variantId);
    }

    if (value !== null) {
      await flipBufferForVariants(tx, { organizationId, storeId, variantIds: [variantId] });
    }

    // updateMany doesn't return rows; fetch the canonical state to
    // serialize back to the client. The where-clause is the same tenant
    // filter, so a successful update guarantees this read returns a row.
    // isDigital feeds the missing-desi flag (a digital variant needs no desi).
    return tx.productVariant.findFirstOrThrow({
      where: { id: variantId, organizationId, storeId },
      select: {
        id: true,
        dimensionalWeightOverride: true,
        syncedDimensionalWeight: true,
        isDigital: true,
      },
    });
  });
}

// ─── bulkSetDimensionalWeight ──────────────────────────────────────────
// Applies one user-override value (or null to clear) to every variant in
// `variantIds`, writing only dimensionalWeightOverride. Same
// single-column-write invariant as setDimensionalWeight
// — syncedDimensionalWeight is never touched.
//
// Tenant guard: updateMany filters on (organizationId, storeId, id IN
// variantIds), so cross-tenant IDs in the array are silently filtered out
// rather than mutated. The returned `updated` count tells the caller how
// many in their selection actually applied; a mismatch hints at stale
// state (variants deleted or moved stores between selection and submit)
// but is not surfaced as an error — the UX is "apply what we can."
//
// Live Performance buffer: the setDimensionalWeight re-check, run only for
// the ids the write actually touched (this store's variants), so a filtered-out
// id of another store or org never triggers a flip.

export async function bulkSetDimensionalWeight(opts: {
  organizationId: string;
  storeId: string;
  variantIds: string[];
  value: string | null;
}): Promise<{ updated: number }> {
  const { organizationId, storeId, variantIds, value } = opts;

  if (variantIds.length === 0) return { updated: 0 };

  // A stored order keeps the desi captured at intake, so the overrides reach
  // only new orders, buffered orders not yet in `orders`, and the catalog
  // estimate; no stored order is queued.
  return prisma.$transaction(async (tx) => {
    const written = await tx.productVariant.updateManyAndReturn({
      where: { id: { in: variantIds }, organizationId, storeId },
      data: { dimensionalWeightOverride: value },
      select: { id: true },
    });

    if (value !== null && written.length > 0) {
      await flipBufferForVariants(tx, {
        organizationId,
        storeId,
        variantIds: written.map((variant) => variant.id),
      });
    }

    return { updated: written.length };
  });
}
