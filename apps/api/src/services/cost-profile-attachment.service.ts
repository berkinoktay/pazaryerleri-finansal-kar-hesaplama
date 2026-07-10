import { prisma } from '@pazarsync/db';
import type { CostProfile, Prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { buildCalcCheckLines, resolveOrderCalculability } from '@pazarsync/profit';

import {
  CostProfileArchivedCannotAttachError,
  CostProfileNotFoundError,
  CostProfileVariantOrgMismatchError,
} from '../lib/errors';

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
 */
async function assertSameStore(
  orgId: string,
  profileIds: string[],
  variantIds: string[],
): Promise<void> {
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
}

/**
 * Live Performance side-effect: flip PENDING buffer entries to PROMOTING when a
 * cost attach makes their order FULLY calculable. Runs inside the attach/replace
 * transaction so the flip commits atomically with the cost-link write.
 *
 * Only an entry whose EVERY line barcode now resolves to a cost-attached variant
 * is flipped (resolveOrderCalculability — the same gate the webhook receiver
 * uses). A multi-line order with one still-cost-missing line stays PENDING, so a
 * partially-costed order is never promoted into `orders` (cost-driven storage
 * discipline). Forward-only — never reverts PROMOTING → PENDING. The PR-C promote
 * worker then writes the PROMOTING entries to `orders` on its next tick.
 *
 * Returns the number of entries flipped (surfaced to the UI as
 * `bufferEntriesPromoted` for the "X sipariş kâr hesabına eklendi" toast).
 */
async function flipBufferForVariants(
  tx: Prisma.TransactionClient,
  orgId: string,
  variantIds: string[],
): Promise<number> {
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds }, organizationId: orgId },
    select: { barcode: true, storeId: true },
  });
  if (variants.length === 0) return 0;

  const barcodesByStore = new Map<string, string[]>();
  for (const v of variants) {
    const list = barcodesByStore.get(v.storeId) ?? [];
    list.push(v.barcode);
    barcodesByStore.set(v.storeId, list);
  }

  let promoted = 0;
  for (const [storeId, barcodes] of barcodesByStore.entries()) {
    // Narrow to PENDING entries in this store whose mapped_order has a line with
    // one of the just-attached barcodes — the only orders that could have just
    // become calculable.
    const candidates = await tx.$queryRaw<Array<{ id: string; mapped_order: unknown }>>`
      SELECT id, mapped_order
      FROM live_performance_buffer
      WHERE store_id = ${storeId}::uuid
        AND organization_id = ${orgId}::uuid
        AND status = 'PENDING'::buffer_entry_status
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(mapped_order->'lines') AS line
          WHERE line->>'barcode' = ANY(${barcodes}::text[])
        )
    `;

    const promotableIds: string[] = [];
    for (const row of candidates) {
      const mapped = row.mapped_order as unknown as MappedOrder;
      const calcLines = await buildCalcCheckLines(tx, {
        storeId,
        lines: mapped.lines.map((line) => ({ barcode: line.barcode })),
      });
      if (resolveOrderCalculability(calcLines).kind === 'calculable') {
        promotableIds.push(row.id);
      }
    }

    if (promotableIds.length > 0) {
      const result = await tx.livePerformanceBuffer.updateMany({
        where: { id: { in: promotableIds }, status: 'PENDING' },
        data: { status: 'PROMOTING' },
      });
      promoted += result.count;
    }
  }

  return promoted;
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
  await assertSameStore(orgId, profileIds, variantIds);

  // Build Cartesian product of (profileId, variantId) pairs
  const data = profileIds.flatMap((profileId) =>
    variantIds.map((productVariantId) => ({
      productVariantId,
      profileId,
      organizationId: orgId,
      attachedBy: actorId,
    })),
  );

  // One transaction: create the links + flip any now-calculable buffer entries.
  return await prisma.$transaction(async (tx) => {
    const result = await tx.productVariantCostProfile.createMany({
      data,
      skipDuplicates: true,
    });
    const bufferEntriesPromoted = await flipBufferForVariants(tx, orgId, variantIds);
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
  await assertSameStore(orgId, profileIds, variantIds);

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
    return await flipBufferForVariants(tx, orgId, variantIds);
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
