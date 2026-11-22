import { prisma } from '@pazarsync/db';
import type { CostProfile } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { enqueueProfitRecomputeForVariants } from '@pazarsync/profit';

import {
  CostProfileArchivedCannotAttachError,
  CostProfileNotFoundError,
  CostProfileVariantOrgMismatchError,
} from '../lib/errors';
import { flipBufferForVariants } from './live-performance-buffer-flip.service';

// ─── Cross-org guard helpers ─────────────────────────────────────────────────

/**
 * Verify all profileIds belong to `orgId`, are in a store the caller may access,
 * and are not archived.
 *
 * `accessibleStoreIds` is `null` for OWNER/ADMIN (every store, no narrowing) or
 * the caller's granted store-id list for MEMBER/VIEWER. When non-null, a profile
 * in an ungranted store is filtered out and treated as missing — the SAME 404 as
 * a nonexistent/cross-org profile. This keeps non-disclosure uniform with the
 * by-id routes: without it, attaching a real in-org/ungranted-store profile
 * returned 422 (via assertSameStore) while a nonexistent one returned 404, a
 * bounded existence oracle over profile UUIDs.
 *
 * Throws:
 *  - `CostProfileArchivedCannotAttachError` for the first archived profile found.
 *  - `CostProfileNotFoundError` for the first missing, cross-org, or
 *    ungranted-store profile.
 *
 * The backend uses the postgres service role which bypasses RLS, so this
 * check is the service-layer enforcement (SECURITY.md §3).
 */
async function guardProfiles(
  orgId: string,
  profileIds: string[],
  accessibleStoreIds: string[] | null,
): Promise<void> {
  const rows = await prisma.costProfile.findMany({
    where: {
      id: { in: profileIds },
      organizationId: orgId,
      ...(accessibleStoreIds !== null ? { storeId: { in: accessibleStoreIds } } : {}),
    },
    select: { id: true, archivedAt: true },
  });

  // First check for archived profiles among those we found
  const archived = rows.find((r) => r.archivedAt !== null);
  if (archived !== undefined) {
    throw new CostProfileArchivedCannotAttachError(archived.id);
  }

  // Missing = nonexistent, cross-org, OR in an ungranted store (filtered above).
  if (rows.length !== profileIds.length) {
    const foundIds = new Set(rows.map((r) => r.id));
    const missingId = profileIds.find((id) => !foundIds.has(id));
    throw new CostProfileNotFoundError(missingId ?? profileIds[0]!);
  }
}

/**
 * Verify all variantIds belong to `orgId` AND — for a MEMBER/VIEWER caller — to
 * a store the caller has been granted access to.
 *
 * `accessibleStoreIds` is `null` for OWNER/ADMIN (see access every store, no
 * narrowing) or the caller's granted store-id list for MEMBER/VIEWER. When
 * non-null, a variant in an ungranted store fails the count and is rejected
 * exactly like a cross-org variant — non-disclosure: an ungranted store's
 * variant is indistinguishable from one that doesn't exist. This is the
 * store-access counterpart to the org guard; without it a MEMBER granted only
 * store A could attach/detach/replace cost profiles on store B's variants
 * (mutating store B's profit figures) just by knowing the variant UUIDs.
 *
 * Throws `CostProfileVariantOrgMismatchError` if any variant is missing, in a
 * different org, or in an ungranted store. HTTP 422 per spec §6.7.
 */
async function guardVariants(
  orgId: string,
  variantIds: string[],
  accessibleStoreIds: string[] | null,
): Promise<void> {
  const count = await prisma.productVariant.count({
    where: {
      id: { in: variantIds },
      organizationId: orgId,
      ...(accessibleStoreIds !== null ? { storeId: { in: accessibleStoreIds } } : {}),
    },
  });

  if (count !== variantIds.length) {
    throw new CostProfileVariantOrgMismatchError('(multiple)', '(multiple)');
  }
}

/**
 * Cost profiles are store-scoped: a profile may only attach to variants IN ITS
 * OWN store. Attach/replace produce the Cartesian product of profiles × variants,
 * so every profile AND every variant must resolve to a SINGLE common store. This
 * fetches the distinct storeIds of both sets and rejects (422, reusing the
 * variant-mismatch error — the frontend already localizes it) unless the union
 * collapses to one store. Guards against attaching store A's profile onto store
 * B's variant even within one org. (guardProfiles/guardVariants run first, so by
 * here every id is a real in-org profile/variant.)
 *
 * Returns the variants' single store id (null only when no variant resolved), so
 * the Live Performance buffer flip runs store-scoped on exactly that store.
 */
async function assertSameStore(
  orgId: string,
  profileIds: string[],
  variantIds: string[],
): Promise<string | null> {
  const [profiles, variants] = await Promise.all([
    prisma.costProfile.findMany({
      where: { id: { in: profileIds }, organizationId: orgId },
      select: { storeId: true },
      distinct: ['storeId'],
    }),
    prisma.productVariant.findMany({
      where: { id: { in: variantIds }, organizationId: orgId },
      select: { storeId: true },
      distinct: ['storeId'],
    }),
  ]);
  const stores = new Set([...profiles.map((p) => p.storeId), ...variants.map((v) => v.storeId)]);
  if (stores.size > 1) {
    throw new CostProfileVariantOrgMismatchError('(cross-store)', '(cross-store)');
  }
  return variants[0]?.storeId ?? null;
}

// ─── Service functions ───────────────────────────────────────────────────────

/**
 * Attach cost profiles to product variants (Cartesian product, idempotent).
 *
 * Cross-org guard: verifies all profileIds and variantIds belong to `orgId`
 * before inserting. Archived profiles are rejected (409). Cross-org IDs are
 * rejected (422).
 *
 * Returns `{ attached }` — the number of new link rows created (skipDuplicates
 * means re-attaching the same pair counts as 0).
 */
export async function attachCostProfiles(
  orgId: string,
  profileIds: string[],
  variantIds: string[],
  actorId: string,
  accessibleStoreIds: string[] | null,
): Promise<{ attached: number; bufferEntriesPromoted: number }> {
  await guardProfiles(orgId, profileIds, accessibleStoreIds);
  await guardVariants(orgId, variantIds, accessibleStoreIds);
  const storeId = await assertSameStore(orgId, profileIds, variantIds);

  // Build Cartesian product of (profileId, variantId) pairs
  const data = profileIds.flatMap((profileId) =>
    variantIds.map((productVariantId) => ({
      productVariantId,
      profileId,
      organizationId: orgId,
      attachedBy: actorId,
    })),
  );

  // One transaction: create the links + flip any now-calculable buffer entries +
  // queue a profit recompute for the affected variants' orders (COST_CHANGED).
  return await prisma.$transaction(async (tx) => {
    const result = await tx.productVariantCostProfile.createMany({
      data,
      skipDuplicates: true,
    });
    const bufferEntriesPromoted =
      storeId === null
        ? 0
        : await flipBufferForVariants(tx, { organizationId: orgId, storeId, variantIds });
    await enqueueProfitRecomputeForVariants(tx, {
      organizationId: orgId,
      variantIds,
      reason: ProfitRecomputeReason.COST_CHANGED,
    });
    return { attached: result.count, bufferEntriesPromoted };
  });
}

/**
 * Detach cost profiles from product variants.
 *
 * Cross-org guard: verifies all profileIds and variantIds belong to `orgId`
 * before deleting. The deleteMany includes `organizationId` in the WHERE so
 * cross-org rows are never touched even if the guard somehow missed one.
 *
 * Returns `{ detached }` — the number of link rows removed.
 */
export async function detachCostProfiles(
  orgId: string,
  profileIds: string[],
  variantIds: string[],
  accessibleStoreIds: string[] | null,
): Promise<{ detached: number }> {
  await guardProfiles(orgId, profileIds, accessibleStoreIds);
  await guardVariants(orgId, variantIds, accessibleStoreIds);

  // One transaction: remove the links + queue a profit recompute for the
  // detached variants' orders (COST_CHANGED). The detach ran without a
  // transaction before this slice; wrapping it keeps the mark atomic with the
  // delete so a crash cannot drop one without the other.
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.productVariantCostProfile.deleteMany({
      where: {
        profileId: { in: profileIds },
        productVariantId: { in: variantIds },
        organizationId: orgId,
      },
    });
    await enqueueProfitRecomputeForVariants(tx, {
      organizationId: orgId,
      variantIds,
      reason: ProfitRecomputeReason.COST_CHANGED,
    });
    return deleted;
  });

  return { detached: result.count };
}

/**
 * Replace cost profiles for a set of variants atomically.
 *
 * For each variant in `variantIds`:
 *   1. Delete all existing links for that variant within `orgId`.
 *   2. Insert new links for each profileId in `profileIds`.
 *
 * `profileIds` may be empty — this clears all profiles for the listed variants.
 *
 * Cross-org guard: verifies all profileIds (if any) and variantIds belong to
 * `orgId` before the transaction begins.
 *
 * Returns `{ variantsAffected, finalProfilesPerVariant }`.
 */
export async function replaceCostProfilesForVariants(
  orgId: string,
  variantIds: string[],
  profileIds: string[],
  actorId: string,
  accessibleStoreIds: string[] | null,
): Promise<{
  variantsAffected: number;
  finalProfilesPerVariant: number;
  bufferEntriesPromoted: number;
}> {
  if (profileIds.length > 0) {
    await guardProfiles(orgId, profileIds, accessibleStoreIds);
  }
  await guardVariants(orgId, variantIds, accessibleStoreIds);
  const storeId = await assertSameStore(orgId, profileIds, variantIds);

  const bufferEntriesPromoted = await prisma.$transaction(async (tx) => {
    // Delete all existing links for these variants within the org
    await tx.productVariantCostProfile.deleteMany({
      where: {
        productVariantId: { in: variantIds },
        organizationId: orgId,
      },
    });

    // Insert new Cartesian product (skipped when clearing all profiles).
    if (profileIds.length > 0) {
      const data = variantIds.flatMap((productVariantId) =>
        profileIds.map((profileId) => ({
          productVariantId,
          profileId,
          organizationId: orgId,
          attachedBy: actorId,
        })),
      );
      await tx.productVariantCostProfile.createMany({ data, skipDuplicates: true });
    }

    // Re-evaluate buffer calculability after the final link state is set. A
    // clear (empty profileIds) leaves variants cost-missing → flip is a no-op.
    const promoted =
      storeId === null
        ? 0
        : await flipBufferForVariants(tx, { organizationId: orgId, storeId, variantIds });
    await enqueueProfitRecomputeForVariants(tx, {
      organizationId: orgId,
      variantIds,
      reason: ProfitRecomputeReason.COST_CHANGED,
    });
    return promoted;
  });

  return {
    variantsAffected: variantIds.length,
    finalProfilesPerVariant: profileIds.length,
    bufferEntriesPromoted,
  };
}

/**
 * List cost profiles attached to a product variant.
 *
 * Verifies the variant belongs to `orgId` AND — for a MEMBER/VIEWER — to a
 * store the caller was granted (non-disclosure: returns
 * `CostProfileVariantOrgMismatchError` if the variant doesn't exist for the org
 * or lives in an ungranted store). `accessibleStoreIds` is `null` for
 * OWNER/ADMIN (every store, no narrowing). Returns non-archived profiles
 * ordered by `attachedAt` DESC.
 */
export async function listCostProfilesForVariant(
  orgId: string,
  variantId: string,
  accessibleStoreIds: string[] | null,
): Promise<CostProfile[]> {
  const variant = await prisma.productVariant.findFirst({
    where: {
      id: variantId,
      organizationId: orgId,
      ...(accessibleStoreIds !== null ? { storeId: { in: accessibleStoreIds } } : {}),
    },
    select: { id: true },
  });

  if (variant === null) {
    throw new CostProfileVariantOrgMismatchError('(unknown)', variantId);
  }

  const links = await prisma.productVariantCostProfile.findMany({
    where: {
      productVariantId: variantId,
      organizationId: orgId,
      profile: { archivedAt: null },
    },
    include: { profile: true },
    orderBy: { attachedAt: 'desc' },
  });

  return links.map((link) => link.profile);
}
