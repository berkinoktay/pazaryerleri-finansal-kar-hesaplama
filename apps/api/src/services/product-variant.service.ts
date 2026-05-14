import { prisma } from '@pazarsync/db';
import type { ProductVariant } from '@pazarsync/db';

import { NotFoundError } from '../lib/errors';

// ─── setDimensionalWeight ──────────────────────────────────────────────
// User-override mutation. Writes ONLY to the `dimensionalWeight` column.
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
}): Promise<Pick<ProductVariant, 'id' | 'dimensionalWeight' | 'syncedDimensionalWeight'>> {
  const { organizationId, storeId, variantId, value } = opts;

  const result = await prisma.productVariant.updateMany({
    where: { id: variantId, organizationId, storeId },
    data: { dimensionalWeight: value },
  });

  if (result.count === 0) {
    throw new NotFoundError('ProductVariant', variantId);
  }

  // updateMany doesn't return rows; fetch the canonical state to
  // serialize back to the client. The where-clause is the same tenant
  // filter, so a successful update guarantees this read returns a row.
  const updated = await prisma.productVariant.findFirstOrThrow({
    where: { id: variantId, organizationId, storeId },
    select: { id: true, dimensionalWeight: true, syncedDimensionalWeight: true },
  });
  return updated;
}

// ─── bulkSetDimensionalWeight ──────────────────────────────────────────
// Applies one user-override value (or null to clear) to every variant in
// `variantIds`. Same single-column-write invariant as setDimensionalWeight
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

  const result = await prisma.productVariant.updateMany({
    where: { id: { in: variantIds }, organizationId, storeId },
    data: { dimensionalWeight: value },
  });

  return { updated: result.count };
}
