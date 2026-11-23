import { prisma } from '@pazarsync/db';
import type { ProductVariant } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { enqueueProfitRecomputeForVariants } from '@pazarsync/profit';
import { SELLER_INPUT_TX_OPTIONS } from '@pazarsync/utils';

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
//
// Profit recompute (owner rule, Berkin 2026-11-23): an order's desi is the
// value in force at the end of its business day, so every write, a clear
// included, queues the variant's orders whose seller inputs are not final yet
// (DESI_CHANGED); the recompute re-derives their desi at their day end. Lock
// order: the product_variants row (and the desi log row its trigger writes),
// then the buffer rows, then the queue rows; no order_items row is written.
//
// Bounded transaction (D6): the desi write stamps seller-input history (the trigger's
// desi change row), so it runs with SELLER_INPUT_TX_OPTIONS; the short timeout keeps a
// write stamped before a business-day end from committing after that day is settled.

export async function setDimensionalWeight(opts: {
  organizationId: string;
  storeId: string;
  variantId: string;
  value: string | null;
}): Promise<
  Pick<ProductVariant, 'id' | 'dimensionalWeightOverride' | 'syncedDimensionalWeight' | 'isDigital'>
> {
  const { organizationId, storeId, variantId, value } = opts;

  // The write reaches the variant's non-final stored orders through the queue,
  // its buffered orders through the flip, and the catalog estimate directly.
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

    await enqueueProfitRecomputeForVariants(tx, {
      organizationId,
      variantIds: [variantId],
      reason: ProfitRecomputeReason.DESI_CHANGED,
    });

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
  }, SELLER_INPUT_TX_OPTIONS);
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
//
// Profit recompute: the setDimensionalWeight enqueue (every write, a clear
// included), for the same touched ids only, so a filtered-out id never queues
// another store's or org's order. Same lock order and the same bounded transaction
// (SELLER_INPUT_TX_OPTIONS) as setDimensionalWeight.

export async function bulkSetDimensionalWeight(opts: {
  organizationId: string;
  storeId: string;
  variantIds: string[];
  value: string | null;
}): Promise<{ updated: number }> {
  const { organizationId, storeId, variantIds, value } = opts;

  if (variantIds.length === 0) return { updated: 0 };

  // The writes reach the written variants' non-final stored orders through the
  // queue, their buffered orders through the flip, and the catalog estimate
  // directly.
  return prisma.$transaction(async (tx) => {
    const written = await tx.productVariant.updateManyAndReturn({
      where: { id: { in: variantIds }, organizationId, storeId },
      data: { dimensionalWeightOverride: value },
      select: { id: true },
    });
    const writtenIds = written.map((variant) => variant.id);

    if (value !== null && writtenIds.length > 0) {
      await flipBufferForVariants(tx, { organizationId, storeId, variantIds: writtenIds });
    }

    // An empty id list enqueues nothing (it returns without a query).
    await enqueueProfitRecomputeForVariants(tx, {
      organizationId,
      variantIds: writtenIds,
      reason: ProfitRecomputeReason.DESI_CHANGED,
    });

    return { updated: written.length };
  }, SELLER_INPUT_TX_OPTIONS);
}
