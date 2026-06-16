import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { CostProfile, CostProfileVersion } from '@pazarsync/db';

import { CostProfileNameTakenError, CostProfileNotFoundError } from '../lib/errors';
import type {
  CreateCostProfileInput,
  UpdateCostProfileInput,
} from '../validators/cost-profile.validator';

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
    name: row.name,
    type: row.type,
    amountGross: row.amountGross,
    currency: row.currency,
    vatRate: row.vatRate,
    fxRateMode: row.fxRateMode,
    manualFxRate: row.manualFxRate,
    note: row.note,
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Intercept Prisma P2002 on the (organization_id, name) unique constraint
 * and translate to the domain-specific error. Re-throws everything else.
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
  const TRACKED = [
    'name',
    'type',
    'amountGross',
    'currency',
    'vatRate',
    'fxRateMode',
    'manualFxRate',
    'note',
    'archivedAt',
  ] as const;

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

// ─── Service functions ───────────────────────────────────────────────────────

/**
 * List cost profiles for an organization with optional filters and cursor
 * pagination. Returns active (non-archived) profiles by default when the
 * `archived` filter is omitted.
 */
export async function listCostProfiles(
  orgId: string,
  filters: ListCostProfilesFilters,
): Promise<{ items: CostProfile[]; nextCursor: string | null }> {
  const limit = filters.limit ?? 25;

  // Decode cursor: the id of the last item on the previous page
  const cursorId = filters.cursor !== undefined ? decodeCursor(filters.cursor) : undefined;

  const rows = await prisma.costProfile.findMany({
    where: {
      organizationId: orgId,
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
          name: input.name,
          type: input.type,
          amountGross,
          currency: input.currency ?? 'TRY',
          vatRate,
          fxRateMode: input.fxRateMode ?? 'AUTO',
          manualFxRate: input.manualFxRate !== undefined ? new Decimal(input.manualFxRate) : null,
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
          currency: row.currency,
          vatRate: row.vatRate,
          fxRateMode: row.fxRateMode,
          manualFxRate: row.manualFxRate,
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
      // it returns raw snake_case columns (`vat_rate`, `fx_rate_mode`, ...),
      // and the camelCase property accesses in diffFields silently resolve
      // to `undefined`, which then flags every mapped field as changed.
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
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.vatRate !== undefined ? { vatRate: patch.vatRate } : {}),
        ...(patch.fxRateMode !== undefined ? { fxRateMode: patch.fxRateMode } : {}),
        ...(patch.manualFxRate !== undefined
          ? { manualFxRate: patch.manualFxRate !== null ? new Decimal(patch.manualFxRate) : null }
          : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      };

      const changedFields = diffFields(locked, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.amountGross !== undefined ? { amountGross: new Decimal(patch.amountGross) } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.vatRate !== undefined ? { vatRate: new Decimal(patch.vatRate) } : {}),
        ...(patch.fxRateMode !== undefined ? { fxRateMode: patch.fxRateMode } : {}),
        ...(patch.manualFxRate !== undefined
          ? { manualFxRate: patch.manualFxRate !== null ? new Decimal(patch.manualFxRate) : null }
          : {}),
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
          currency: row.currency,
          vatRate: row.vatRate,
          fxRateMode: row.fxRateMode,
          manualFxRate: row.manualFxRate,
          note: row.note,
          archivedAt: row.archivedAt,
          changedFields,
          changedBy: actorId,
        },
      });

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
        currency: row.currency,
        vatRate: row.vatRate,
        fxRateMode: row.fxRateMode,
        manualFxRate: row.manualFxRate,
        note: row.note,
        archivedAt: now,
        changedFields: ['archivedAt'],
        changedBy: actorId,
      },
    });

    return row;
  });

  return toWireProfile(archived);
}

/**
 * Restore an archived cost profile: clears archivedAt, appends a version with
 * changedFields: ['archivedAt'].
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
        currency: row.currency,
        vatRate: row.vatRate,
        fxRateMode: row.fxRateMode,
        manualFxRate: row.manualFxRate,
        note: row.note,
        archivedAt: null,
        changedFields: ['archivedAt'],
        changedBy: actorId,
      },
    });

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

  const rows = await prisma.productVariantCostProfile.findMany({
    where: { profileId, organizationId: orgId },
    include: {
      productVariant: {
        include: {
          product: {
            select: {
              id: true,
              title: true,
              // First image only (by ascending position) is the "primary".
              // Cheap because ProductImage has @@index([productId, position]).
              images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
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
    productImageUrl: link.productVariant.product.images[0]?.url ?? null,
    attachedAt: link.attachedAt,
    attachedBy: link.attachedBy,
  }));

  return { items: dtos, nextCursor };
}
