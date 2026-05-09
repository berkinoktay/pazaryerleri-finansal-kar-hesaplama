import { prisma } from '@pazarsync/db';
import type { CostProfile } from '@pazarsync/db';

import {
  CostProfileArchivedCannotAttachError,
  CostProfileNotFoundError,
  CostProfileVariantOrgMismatchError,
} from '../lib/errors';

// ─── Cross-org guard helpers ─────────────────────────────────────────────────

/**
 * Verify all profileIds belong to `orgId` and are not archived.
 *
 * Throws:
 *  - `CostProfileArchivedCannotAttachError` for the first archived profile found.
 *  - `CostProfileNotFoundError` for the first missing or cross-org profile.
 *
 * The backend uses the postgres service role which bypasses RLS, so this
 * check is the service-layer enforcement (SECURITY.md §3).
 */
async function guardProfiles(orgId: string, profileIds: string[]): Promise<void> {
  const rows = await prisma.costProfile.findMany({
    where: { id: { in: profileIds }, organizationId: orgId },
    select: { id: true, archivedAt: true },
  });

  // First check for archived profiles among those we found
  const archived = rows.find((r) => r.archivedAt !== null);
  if (archived !== undefined) {
    throw new CostProfileArchivedCannotAttachError(archived.id);
  }

  // Check if all requested profiles were found (missing = cross-org or non-existent)
  if (rows.length !== profileIds.length) {
    const foundIds = new Set(rows.map((r) => r.id));
    const missingId = profileIds.find((id) => !foundIds.has(id));
    throw new CostProfileNotFoundError(missingId ?? profileIds[0]!);
  }
}

/**
 * Verify all variantIds belong to `orgId`.
 *
 * Throws `CostProfileVariantOrgMismatchError` if any variant is missing or
 * belongs to a different org. HTTP 422 per spec §6.7.
 */
async function guardVariants(orgId: string, variantIds: string[]): Promise<void> {
  const count = await prisma.productVariant.count({
    where: { id: { in: variantIds }, organizationId: orgId },
  });

  if (count !== variantIds.length) {
    throw new CostProfileVariantOrgMismatchError('(multiple)', '(multiple)');
  }
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
): Promise<{ attached: number }> {
  await guardProfiles(orgId, profileIds);
  await guardVariants(orgId, variantIds);

  // Build Cartesian product of (profileId, variantId) pairs
  const data = profileIds.flatMap((profileId) =>
    variantIds.map((productVariantId) => ({
      productVariantId,
      profileId,
      organizationId: orgId,
      attachedBy: actorId,
    })),
  );

  const result = await prisma.productVariantCostProfile.createMany({
    data,
    skipDuplicates: true,
  });

  return { attached: result.count };
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
): Promise<{ detached: number }> {
  await guardProfiles(orgId, profileIds);
  await guardVariants(orgId, variantIds);

  const result = await prisma.productVariantCostProfile.deleteMany({
    where: {
      profileId: { in: profileIds },
      productVariantId: { in: variantIds },
      organizationId: orgId,
    },
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
): Promise<{ variantsAffected: number; finalProfilesPerVariant: number }> {
  if (profileIds.length > 0) {
    await guardProfiles(orgId, profileIds);
  }
  await guardVariants(orgId, variantIds);

  await prisma.$transaction(async (tx) => {
    // Delete all existing links for these variants within the org
    await tx.productVariantCostProfile.deleteMany({
      where: {
        productVariantId: { in: variantIds },
        organizationId: orgId,
      },
    });

    if (profileIds.length === 0) return;

    // Insert new Cartesian product
    const data = variantIds.flatMap((productVariantId) =>
      profileIds.map((profileId) => ({
        productVariantId,
        profileId,
        organizationId: orgId,
        attachedBy: actorId,
      })),
    );

    await tx.productVariantCostProfile.createMany({ data, skipDuplicates: true });
  });

  return {
    variantsAffected: variantIds.length,
    finalProfilesPerVariant: profileIds.length,
  };
}

/**
 * List cost profiles attached to a product variant.
 *
 * Verifies the variant belongs to `orgId` (non-disclosure: returns
 * `CostProfileVariantOrgMismatchError` if the variant doesn't exist for the
 * org). Returns non-archived profiles ordered by `attachedAt` DESC.
 */
export async function listCostProfilesForVariant(
  orgId: string,
  variantId: string,
): Promise<CostProfile[]> {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, organizationId: orgId },
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
