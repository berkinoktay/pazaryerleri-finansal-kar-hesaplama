import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { CostProfile, CostProfileVersion, Prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { enqueueProfitRecomputeForVariants } from '@pazarsync/profit';

import { CostProfileNameTakenError, CostProfileNotFoundError } from '../lib/errors';
import type {
  CreateCostProfileInput,
  UpdateCostProfileInput,
} from '../validators/cost-profile.validator';
import { flipBufferForVariants } from './live-performance-buffer-flip.service';

// ─── DTO types ───────────────────────────────────────────────────────────────

export type { CostProfile, CostProfileVersion };

export interface AttachedVariantDTO {
  linkId: string;
  productVariantId: string;
  barcode: string;
  stockCode: string;
  productId: string;
  productTitle: string;
  productImageUrl: string | null;
  attachedAt: Date;
  attachedBy: string | null;
}

export interface ListCostProfilesFilters {
  type?: CostProfile['type'];
  archived?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginationOpts {
  cursor?: string;
  limit?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Encode / decode opaque cursors. The cursor is the profile's id
 * (UUID), base64-encoded so callers treat it as opaque.
 */
function encodeCursor(id: string): string {
  return Buffer.from(id).toString('base64url');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf-8');
}

/**
 * DB row → public wire shape. Explicit field allow-list so internal
 * Prisma relations never leak to the API layer.
 */
function toWireProfile(row: CostProfile): CostProfile {
  return {
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    name: row.name,
    type: row.type,
    amountGross: row.amountGross,
    vatRate: row.vatRate,
    note: row.note,
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Intercept Prisma P2002 on the (store_id, name) unique constraint and
 * translate to the domain-specific error. Re-throws everything else.
 */
function handlePrismaError(err: unknown, context: { name?: string }): never {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  ) {
    throw new CostProfileNameTakenError(context.name ?? 'unknown');
  }
  throw err;
}

/**
 * Compute which top-level profile fields changed between two states.
 * Returns an array of camelCase field names for the changedFields column.
 */
function diffFields(before: CostProfile, after: Partial<CostProfile>): string[] {
  const TRACKED = ['name', 'type', 'amountGross', 'vatRate', 'note', 'archivedAt'] as const;

  const changed: string[] = [];
  for (const field of TRACKED) {
    const bv = before[field];
    const av = after[field];
    if (av === undefined) continue;
    // Decimal comparison via string to avoid floating-point drift
    if (bv instanceof Decimal || av instanceof Decimal) {
      const bs = bv instanceof Decimal ? bv.toString() : String(bv ?? '');
      const as_ = av instanceof Decimal ? av.toString() : String(av ?? '');
      if (bs !== as_) changed.push(field);
    } else {
      // Date / string / number / null comparison
      const bStr = bv instanceof Date ? bv.toISOString() : String(bv ?? '');
      const aStr = av instanceof Date ? av.toISOString() : String(av ?? '');
      if (bStr !== aStr) changed.push(field);
    }
  }
  return changed;
}

/** The ids of the variants this profile is attached to, within the organization. */
async function loadProfileVariantIds(
  tx: Prisma.TransactionClient,
  orgId: string,
  profileId: string,
): Promise<string[]> {
  const links = await tx.productVariantCostProfile.findMany({
    where: { profileId, organizationId: orgId },
    select: { productVariantId: true },
  });
  return links.map((link) => link.productVariantId);
}

/**
 * Enqueue a profit recompute (COST_CHANGED) for every order carrying one of these
 * variants. Runs inside the mutation's own transaction. An empty id list enqueues
 * nothing (it short-circuits without a query).
 */
async function enqueueVariantsRecompute(
  tx: Prisma.TransactionClient,
  orgId: string,
  variantIds: string[],
): Promise<void> {
  await enqueueProfitRecomputeForVariants(tx, {
    organizationId: orgId,
    variantIds,
    reason: ProfitRecomputeReason.COST_CHANGED,
  });
}

/**
 * Enqueue a profit recompute for every order carrying a variant this profile is
 * attached to. A cost change (amount/vat, archive, or restore) reshapes those
 * orders' profit, so they must be recomputed. Runs inside the
 * mutation's own transaction. A profile with no attached variants enqueues
 * nothing.
 */
async function enqueueProfileVariants(
  tx: Prisma.TransactionClient,
  orgId: string,
  profileId: string,
): Promise<void> {
  const variantIds = await loadProfileVariantIds(tx, orgId, profileId);
  await enqueueVariantsRecompute(tx, orgId, variantIds);
}

// ─── Service functions ───────────────────────────────────────────────────────

/**
 * List cost profiles for an organization with optional filters and cursor
 * pagination. Returns active (non-archived) profiles by default when the
 * `archived` filter is omitted.
 */
export async function listCostProfiles(
  orgId: string,
  storeId: string,
  filters: ListCostProfilesFilters,
): Promise<{ items: CostProfile[]; nextCursor: string | null }> {
  const limit = filters.limit ?? 25;

  // Decode cursor: the id of the last item on the previous page
  const cursorId = filters.cursor !== undefined ? decodeCursor(filters.cursor) : undefined;

  const rows = await prisma.costProfile.findMany({
    where: {
      organizationId: orgId,
      // Cost profiles are store-scoped: list only the active store's profiles.
      storeId,
      ...(filters.type !== undefined ? { type: filters.type } : {}),
      // archived filter: undefined → only active (archivedAt IS NULL)
      ...(filters.archived === true
        ? { archivedAt: { not: null } }
        : filters.archived === false
          ? { archivedAt: null }
          : { archivedAt: null }),
      ...(filters.q !== undefined ? { name: { contains: filters.q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: limit + 1, // fetch one extra to determine if there's a next page
    ...(cursorId !== undefined
      ? {
          cursor: { id: cursorId },
          skip: 1,
        }
      : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem !== undefined ? encodeCursor(lastItem.id) : null;

  return { items: items.map(toWireProfile), nextCursor };
}

/**
 * Get a single cost profile by id. Returns the profile if it belongs to the
 * given organization; throws `CostProfileNotFoundError` otherwise (non-disclosure).
 */
export async function getCostProfile(orgId: string, profileId: string): Promise<CostProfile> {
  const row = await prisma.costProfile.findFirst({
    where: { id: profileId, organizationId: orgId },
  });
  if (row === null) {
    throw new CostProfileNotFoundError(profileId);
  }
  return toWireProfile(row);
}

/**
 * Create a new cost profile and seed its first version (version=1,
 * changedFields=[]) in a single transaction.
 */
export async function createCostProfile(
  orgId: string,
  input: CreateCostProfileInput,
  actorId: string,
): Promise<CostProfile> {
  try {
    const profile = await prisma.$transaction(async (tx) => {
      const amountGross = new Decimal(input.amountGross);
      const vatRate = input.vatRate ?? 0;

      const row = await tx.costProfile.create({
        data: {
          organizationId: orgId,
          storeId: input.storeId,
          name: input.name,
          type: input.type,
          amountGross,
          vatRate,
          note: input.note ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });

      await tx.costProfileVersion.create({
        data: {
          profileId: row.id,
          organizationId: orgId,
          version: 1,
          name: row.name,
          type: row.type,
          amountGross: row.amountGross,
          vatRate: row.vatRate,
          note: row.note,
          archivedAt: null,
          changedFields: [],
          changedBy: actorId,
        },
      });

      return row;
    });

    return toWireProfile(profile);
  } catch (err) {
    handlePrismaError(err, { name: input.name });
  }
}

/**
 * Update an existing cost profile. Uses SELECT ... FOR UPDATE inside the
 * transaction to prevent (profileId, version) collisions under concurrent
 * PATCH requests (spec §8.4). Computes changedFields diff between the
 * current row and the patch, then appends a new version row.
 */
export async function updateCostProfile(
  orgId: string,
  profileId: string,
  patch: UpdateCostProfileInput,
  actorId: string,
): Promise<CostProfile> {
  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Take a row-level lock for concurrency: $queryRaw with FOR UPDATE
      // acquires the lock; the subsequent Prisma findFirst inside the same
      // tx reads the locked row with proper camelCase mapping + Decimal
      // boxing. Reading directly via $queryRaw<CostProfile[]> is wrong —
      // it returns raw snake_case columns (`vat_rate`, ...), and the camelCase
      // property accesses in diffFields silently resolve to `undefined`, which
      // then flags every mapped field as changed.
      const lockRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cost_profiles
        WHERE id = ${profileId}::uuid
          AND organization_id = ${orgId}::uuid
        FOR UPDATE
      `;

      if (lockRows.length === 0) {
        throw new CostProfileNotFoundError(profileId);
      }

      const locked = await tx.costProfile.findFirst({
        where: { id: profileId, organizationId: orgId },
      });
      if (locked === null) {
        throw new CostProfileNotFoundError(profileId);
      }

      // Compute next version number atomically inside the tx
      const agg = await tx.costProfileVersion.aggregate({
        where: { profileId },
        _max: { version: true },
      });
      const nextVersion = (agg._max.version ?? 0) + 1;

      // Build update data from non-undefined patch fields.
      const updateData: Parameters<typeof tx.costProfile.update>[0]['data'] = {
        updatedBy: actorId,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.amountGross !== undefined ? { amountGross: new Decimal(patch.amountGross) } : {}),
        ...(patch.vatRate !== undefined ? { vatRate: patch.vatRate } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      };

      const changedFields = diffFields(locked, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.amountGross !== undefined ? { amountGross: new Decimal(patch.amountGross) } : {}),
        ...(patch.vatRate !== undefined ? { vatRate: new Decimal(patch.vatRate) } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      });

      const row = await tx.costProfile.update({
        where: { id: profileId },
        data: updateData,
      });

      await tx.costProfileVersion.create({
        data: {
          profileId,
          organizationId: orgId,
          version: nextVersion,
          name: row.name,
          type: row.type,
          amountGross: row.amountGross,
          vatRate: row.vatRate,
          note: row.note,
          archivedAt: row.archivedAt,
          changedFields,
          changedBy: actorId,
        },
      });

      await enqueueProfileVariants(tx, orgId, profileId);

      return row;
    });

    return toWireProfile(updated);
  } catch (err) {
    if (err instanceof CostProfileNotFoundError) throw err;
    handlePrismaError(err, {});
  }
}

/**
 * Archive a cost profile: sets archivedAt to now, appends a version with
 * changedFields: ['archivedAt'].
 */
export async function archiveCostProfile(
  orgId: string,
  profileId: string,
  actorId: string,
): Promise<CostProfile> {
  const archived = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<CostProfile[]>`
      SELECT * FROM cost_profiles
      WHERE id = ${profileId}::uuid
        AND organization_id = ${orgId}::uuid
      FOR UPDATE
    `;

    if (locked === undefined) {
      throw new CostProfileNotFoundError(profileId);
    }

    const agg = await tx.costProfileVersion.aggregate({
      where: { profileId },
      _max: { version: true },
    });
    const nextVersion = (agg._max.version ?? 0) + 1;

    const now = new Date();
    const row = await tx.costProfile.update({
      where: { id: profileId },
      data: { archivedAt: now, updatedBy: actorId },
    });

    await tx.costProfileVersion.create({
      data: {
        profileId,
        organizationId: orgId,
        version: nextVersion,
        name: row.name,
        type: row.type,
        amountGross: row.amountGross,
        vatRate: row.vatRate,
        note: row.note,
        archivedAt: now,
        changedFields: ['archivedAt'],
        changedBy: actorId,
      },
    });

    await enqueueProfileVariants(tx, orgId, profileId);

    return row;
  });

  return toWireProfile(archived);
}

/**
 * Restore an archived cost profile: clears archivedAt, appends a version with
 * changedFields: ['archivedAt'].
 *
 * The restore puts the profile's cost back in force, so it re-checks the Live
 * Performance buffer of the profile's store in the same transaction: a waiting order
 * of today whose every line is now calculable is flipped to PROMOTING
 * (flipBufferForVariants). Archive, detach and version edits need no such call: they
 * can never make an order calculable, and the promote worker re-runs the gate under
 * the row lock before it writes an entry to `orders`.
 */
export async function restoreCostProfile(
  orgId: string,
  profileId: string,
  actorId: string,
): Promise<CostProfile> {
  const restored = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<CostProfile[]>`
      SELECT * FROM cost_profiles
      WHERE id = ${profileId}::uuid
        AND organization_id = ${orgId}::uuid
      FOR UPDATE
    `;

    if (locked === undefined) {
      throw new CostProfileNotFoundError(profileId);
    }

    const agg = await tx.costProfileVersion.aggregate({
      where: { profileId },
      _max: { version: true },
    });
    const nextVersion = (agg._max.version ?? 0) + 1;

    const row = await tx.costProfile.update({
      where: { id: profileId },
      data: { archivedAt: null, updatedBy: actorId },
    });

    await tx.costProfileVersion.create({
      data: {
        profileId,
        organizationId: orgId,
        version: nextVersion,
        name: row.name,
        type: row.type,
        amountGross: row.amountGross,
        vatRate: row.vatRate,
        note: row.note,
        archivedAt: null,
        changedFields: ['archivedAt'],
        changedBy: actorId,
      },
    });

    // Lock order: flip the buffer BEFORE enqueueing the recompute, the same order the
    // attach and replace services use, so a restore takes the buffer rows and then
    // the recompute queue rows in the same order as a concurrent attach or replace.
    const variantIds = await loadProfileVariantIds(tx, orgId, profileId);
    await flipBufferForVariants(tx, { organizationId: orgId, storeId: row.storeId, variantIds });
    await enqueueVariantsRecompute(tx, orgId, variantIds);

    return row;
  });

  return toWireProfile(restored);
}

/**
 * Paginate through version history for a cost profile. Ordered by version
 * descending (newest first). Cursor is the version row id.
 */
export async function getCostProfileVersions(
  orgId: string,
  profileId: string,
  opts: PaginationOpts,
): Promise<{ items: CostProfileVersion[]; nextCursor: string | null }> {
  // Verify org ownership first (non-disclosure)
  const profileExists = await prisma.costProfile.findFirst({
    where: { id: profileId, organizationId: orgId },
    select: { id: true },
  });
  if (profileExists === null) {
    throw new CostProfileNotFoundError(profileId);
  }

  const limit = opts.limit ?? 25;
  const cursorId = opts.cursor !== undefined ? decodeCursor(opts.cursor) : undefined;

  const rows = await prisma.costProfileVersion.findMany({
    where: { profileId, organizationId: orgId },
    orderBy: [{ version: 'desc' }],
    take: limit + 1,
    ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem !== undefined ? encodeCursor(lastItem.id) : null;

  return { items, nextCursor };
}

/**
 * Paginate through product variants attached to a cost profile.
 * Ordered by attachedAt descending. Cursor is the link row id.
 */
export async function getAttachedVariants(
  orgId: string,
  profileId: string,
  opts: PaginationOpts,
): Promise<{ items: AttachedVariantDTO[]; nextCursor: string | null }> {
  // Verify org ownership first (non-disclosure). Store-access narrowing for a
  // MEMBER/VIEWER is enforced one layer up by requireCostProfileStoreAccess in
  // the route, against the profile's own store.
  const profileExists = await prisma.costProfile.findFirst({
    where: { id: profileId, organizationId: orgId },
    select: { id: true },
  });
  if (profileExists === null) {
    throw new CostProfileNotFoundError(profileId);
  }

  const limit = opts.limit ?? 25;
  const cursorId = opts.cursor !== undefined ? decodeCursor(opts.cursor) : undefined;

  const rows = await prisma.productVariantCostProfile.findMany({
    where: { profileId, organizationId: orgId },
    include: {
      productVariant: {
        include: {
          product: {
            select: {
              id: true,
              title: true,
              // imageUrls[0] is the primary image (Trendyol order).
              imageUrls: true,
            },
          },
        },
      },
    },
    orderBy: [{ attachedAt: 'desc' }],
    take: limit + 1,
    ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem !== undefined ? encodeCursor(lastItem.id) : null;

  const dtos: AttachedVariantDTO[] = items.map((link) => ({
    linkId: link.id,
    productVariantId: link.productVariantId,
    barcode: link.productVariant.barcode,
    stockCode: link.productVariant.stockCode,
    productId: link.productVariant.product.id,
    productTitle: link.productVariant.product.title,
    productImageUrl: link.productVariant.product.imageUrls[0] ?? null,
    attachedAt: link.attachedAt,
    attachedBy: link.attachedBy,
  }));

  return { items: dtos, nextCursor };
}
