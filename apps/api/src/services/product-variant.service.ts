import { prisma } from '@pazarsync/db';
import type { ProductVariant } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { enqueueProfitRecomputeForVariants } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';

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

export async function setDimensionalWeight(opts: {
  organizationId: string;
  storeId: string;
  variantId: string;
  value: string | null;
}): Promise<Pick<ProductVariant, 'id' | 'dimensionalWeightOverride' | 'syncedDimensionalWeight'>> {
  const { organizationId, storeId, variantId, value } = opts;

  // One transaction: write the override + queue a profit recompute for every
  // order carrying this variant (REFERENCE_CHANGED). The desi drives the
  // shipping estimate, so a change here is a backdated profit input.
  return prisma.$transaction(async (tx) => {
    const result = await tx.productVariant.updateMany({
      where: { id: variantId, organizationId, storeId },
      data: { dimensionalWeightOverride: value },
    });

    if (result.count === 0) {
      throw new NotFoundError('ProductVariant', variantId);
    }

    await enqueueProfitRecomputeForVariants(tx, {
      organizationId,
      variantIds: [variantId],
      reason: ProfitRecomputeReason.REFERENCE_CHANGED,
    });

    // updateMany doesn't return rows; fetch the canonical state to
    // serialize back to the client. The where-clause is the same tenant
    // filter, so a successful update guarantees this read returns a row.
    return tx.productVariant.findFirstOrThrow({
      where: { id: variantId, organizationId, storeId },
      select: { id: true, dimensionalWeightOverride: true, syncedDimensionalWeight: true },
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

export async function bulkSetDimensionalWeight(opts: {
  organizationId: string;
  storeId: string;
  variantIds: string[];
  value: string | null;
}): Promise<{ updated: number }> {
  const { organizationId, storeId, variantIds, value } = opts;

  if (variantIds.length === 0) return { updated: 0 };

  // One transaction: write the overrides + queue a profit recompute for every
  // order carrying any of these variants (REFERENCE_CHANGED). The enqueue is
  // organization-filtered, so cross-tenant ids in the array pull no orders.
  return prisma.$transaction(async (tx) => {
    const result = await tx.productVariant.updateMany({
      where: { id: { in: variantIds }, organizationId, storeId },
      data: { dimensionalWeightOverride: value },
    });

    await enqueueProfitRecomputeForVariants(tx, {
      organizationId,
      variantIds,
      reason: ProfitRecomputeReason.REFERENCE_CHANGED,
    });

    return { updated: result.count };
  });
}
