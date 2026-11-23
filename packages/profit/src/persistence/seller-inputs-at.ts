/**
 * A variant's seller inputs at an instant `at`, normally an order's Istanbul
 * business-day end T (same-day edit window, plan PR-1). Owner rule (Berkin
 * 2026-11-23): an order's cost and desi are the values in force at the end of its
 * business day; changes during the day reach all of that day's orders. Every gate
 * that judges an order's seller inputs reads this one loader, so a stored order and
 * its buffered twin end the day the same way.
 *
 * Cost links at `at` = the live links plus every removed link that was attached at
 * or before `at` and detached after it (`cost_link_removals`, written by a trigger on
 * every direct link delete). Each link comes with its profile's full version history;
 * the caller prices it with `chooseOrderCostVersion(link, { at })`. A link attached
 * after `at` is still returned (it is simply not in force at `at`).
 *
 * Read order (NB1): the live links first, the removal log strictly after. Callers may
 * pass the plain client, so the two reads can run on different connections, each
 * statement with its own READ COMMITTED snapshot. A detach that commits between them
 * is then seen twice (live and logged, merged to one entry). The reverse order would
 * see it in neither and the caller would stamp a wrongful COST_DEADLINE_MISSED.
 *
 * Desi at `at`, per column (seller override, synced marketplace value), from
 * `variant_desi_changes` (written by a trigger on every real change of either
 * column): a change's `changed_at` (its transaction's start instant) only decides
 * which side of `at` it is on. Among a column's changes stamped at or before `at` the
 * one with the highest `seq` (the physical write order under the variant's row lock)
 * gives the value, its NEW; when every logged change of the column is after `at` the
 * value is the OLD of the first one; with no logged change it is the live value. Two
 * transactions can stamp and write in opposite orders, so a pick by stamp could
 * answer a value the row never ended with; picking by `seq` makes an open day equal
 * the live row by construction, the way cost versions are ordered by version number
 * (`latestVersionAt`). The desi is one statement, so it is one snapshot.
 *
 * Every read is filtered by the organization; a variant id that is not this
 * organization's is absent from the result.
 */

import { Prisma } from '@pazarsync/db';
import { SnapshotDesiSource } from '@pazarsync/db/enums';

import {
  loadIdentifiedCostProfilesById,
  loadIdentifiedCostProfilesByVariant,
  type IdentifiedItemCostProfileInput,
} from './trendyol-reference-loaders';

/** A variant's two desi columns as they stood at an instant. */
export interface SellerDesiAt {
  readonly override: Prisma.Decimal | null;
  readonly synced: Prisma.Decimal | null;
}

/** A variant's seller inputs (cost links with their version histories, desi) at an instant. */
export interface SellerInputsAt {
  readonly costProfiles: readonly IdentifiedItemCostProfileInput[];
  readonly desi: SellerDesiAt;
}

/**
 * The effective desi and its source from a reconstructed pair: the seller's override
 * wins over the synced value. With neither, no value and no source. Any value counts,
 * 0 included.
 */
export function resolveDesiAtDayEnd(desi: SellerDesiAt): {
  readonly value: Prisma.Decimal | null;
  readonly source: SnapshotDesiSource | null;
} {
  if (desi.override !== null) {
    return { value: desi.override, source: SnapshotDesiSource.OVERRIDE };
  }
  if (desi.synced !== null) {
    return { value: desi.synced, source: SnapshotDesiSource.SYNCED };
  }
  return { value: null, source: null };
}

/**
 * The seller inputs of each given variant at `at`, keyed by variant id. Every
 * variant of the organization among `variantIds` is in the map (an empty cost list
 * when it has no link at `at`); empty `variantIds` returns an empty map without a
 * query.
 */
export async function loadSellerInputsAt(
  db: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly variantIds: readonly string[];
    readonly at: Date;
  },
): Promise<ReadonlyMap<string, SellerInputsAt>> {
  const { organizationId, at } = params;
  const requestedIds = [...new Set(params.variantIds)];
  const result = new Map<string, SellerInputsAt>();
  if (requestedIds.length === 0) {
    return result;
  }

  // The organization's variants among the requested ids, with their desi at `at`;
  // every later read uses only these ids.
  const desiByVariant = await loadDesiAt(db, { organizationId, variantIds: requestedIds, at });
  const variantIds = [...desiByVariant.keys()];
  const costProfiles = await loadCostLinksAt(db, { organizationId, variantIds, at });

  for (const [variantId, desi] of desiByVariant) {
    result.set(variantId, { costProfiles: costProfiles.get(variantId) ?? [], desi });
  }
  return result;
}

/** The two SQL pieces that rebuild one desi column at an instant. */
interface DesiColumnAtSql {
  /** The column's value at the instant (a CASE over the two lookups and the live column). */
  readonly value: Prisma.Sql;
  /** The two lookups: the last change stamped at or before the instant, the first change. */
  readonly lookups: Prisma.Sql;
}

/**
 * The seller override (`dimensional_weight_override`) at `at`. `at` is a UTC
 * wall-clock timestamp expression, like the `changed_at` it is compared with.
 */
function overrideDesiAtSql(at: Prisma.Sql): DesiColumnAtSql {
  return {
    value: Prisma.sql`CASE WHEN o_in.seq IS NOT NULL THEN o_in.new_override
                           WHEN o_first.seq IS NOT NULL THEN o_first.old_override
                           ELSE v.dimensional_weight_override END`,
    lookups: Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT c.seq, c.new_override FROM variant_desi_changes c
         WHERE c.product_variant_id = v.id AND c.organization_id = v.organization_id
           AND c.override_changed AND c.changed_at <= ${at}
         ORDER BY c.seq DESC LIMIT 1
      ) o_in ON true
      LEFT JOIN LATERAL (
        SELECT c.seq, c.old_override FROM variant_desi_changes c
         WHERE c.product_variant_id = v.id AND c.organization_id = v.organization_id
           AND c.override_changed
         ORDER BY c.seq ASC LIMIT 1
      ) o_first ON true`,
  };
}

/**
 * The synced marketplace desi (`synced_dimensional_weight`) at `at`, the logged value
 * as is. Owner rule (B2, decided 2026-11-23): a Trendyol 0 or missing desi is no desi,
 * and catalog sync never overwrites a known synced desi with null, so a logged synced
 * value is null only while the variant never had a Trendyol desi. This fragment is the
 * one place that reads what a null synced desi means at a day end; a change to that
 * rule changes only this function.
 */
function syncedDesiAtSql(at: Prisma.Sql): DesiColumnAtSql {
  return {
    value: Prisma.sql`CASE WHEN s_in.seq IS NOT NULL THEN s_in.new_synced
                           WHEN s_first.seq IS NOT NULL THEN s_first.old_synced
                           ELSE v.synced_dimensional_weight END`,
    lookups: Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT c.seq, c.new_synced FROM variant_desi_changes c
         WHERE c.product_variant_id = v.id AND c.organization_id = v.organization_id
           AND c.synced_changed AND c.changed_at <= ${at}
         ORDER BY c.seq DESC LIMIT 1
      ) s_in ON true
      LEFT JOIN LATERAL (
        SELECT c.seq, c.old_synced FROM variant_desi_changes c
         WHERE c.product_variant_id = v.id AND c.organization_id = v.organization_id
           AND c.synced_changed
         ORDER BY c.seq ASC LIMIT 1
      ) s_first ON true`,
  };
}

/**
 * The desi pair at `at` of the organization's variants among `variantIds`, in ONE
 * statement (one snapshot). Both lookups of each column walk the
 * (product_variant_id, seq) index: backwards with the `changed_at` filter, forwards
 * for the first change. `at` is passed as an ISO instant and turned into a UTC wall
 * clock in SQL, so the session time zone never takes part.
 */
async function loadDesiAt(
  db: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly variantIds: readonly string[];
    readonly at: Date;
  },
): Promise<Map<string, SellerDesiAt>> {
  const atSql = Prisma.sql`(${params.at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const override = overrideDesiAtSql(atSql);
  const synced = syncedDesiAtSql(atSql);
  const rows = await db.$queryRaw<unknown[]>`
    SELECT v.id::text AS "variantId",
           (${override.value})::text AS "override",
           (${synced.value})::text AS "synced"
      FROM product_variants v
      ${override.lookups}
      ${synced.lookups}
     WHERE v.organization_id = ${params.organizationId}::uuid
       AND v.id = ANY(${[...params.variantIds]}::uuid[])`;

  const desiByVariant = new Map<string, SellerDesiAt>();
  for (const row of rows) {
    if (!isDesiAtRow(row)) {
      throw new Error('desi reconstruction returned an unexpected row shape');
    }
    desiByVariant.set(row.variantId, {
      override: row.override === null ? null : new Prisma.Decimal(row.override),
      synced: row.synced === null ? null : new Prisma.Decimal(row.synced),
    });
  }
  return desiByVariant;
}

/** True when `value` is one row of the desi statement: a variant id and two nullable numeric texts. */
function isDesiAtRow(value: unknown): value is {
  readonly variantId: string;
  readonly override: string | null;
  readonly synced: string | null;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'variantId' in value &&
    typeof value.variantId === 'string' &&
    'override' in value &&
    (value.override === null || typeof value.override === 'string') &&
    'synced' in value &&
    (value.synced === null || typeof value.synced === 'string')
  );
}

/** The cost links of each variant at `at`: live links merged with the removals that span `at`. */
async function loadCostLinksAt(
  db: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly variantIds: readonly string[];
    readonly at: Date;
  },
): Promise<Map<string, IdentifiedItemCostProfileInput[]>> {
  const { organizationId, variantIds, at } = params;
  const linksByVariant = new Map<string, IdentifiedItemCostProfileInput[]>();
  if (variantIds.length === 0) {
    return linksByVariant;
  }

  // 1. The live links. Must resolve before the removal read starts (NB1): never Promise.all.
  const live = await loadIdentifiedCostProfilesByVariant(db, { organizationId, variantIds });

  // 2. The removed links that were attached at `at` (attached on or before it, detached after it).
  const removed = await db.costLinkRemoval.findMany({
    where: {
      organizationId,
      productVariantId: { in: [...variantIds] },
      attachedAt: { lte: at },
      detachedAt: { gt: at },
    },
    select: { productVariantId: true, profileId: true, attachedAt: true },
    orderBy: { id: 'asc' },
  });
  const removedProfiles = await loadIdentifiedCostProfilesById(db, {
    organizationId,
    profileIds: removed.map((row) => row.profileId),
  });

  const removedByVariant = new Map<string, IdentifiedItemCostProfileInput[]>();
  for (const link of removed) {
    const history = removedProfiles.get(link.profileId);
    if (history === undefined) {
      continue; // the profile no longer exists (or has no version): nothing to price
    }
    const list = removedByVariant.get(link.productVariantId) ?? [];
    list.push({
      profileId: link.profileId,
      profileType: history.profileType,
      attachedAt: link.attachedAt,
      versions: history.versions,
    });
    removedByVariant.set(link.productVariantId, list);
  }

  for (const variantId of variantIds) {
    const merged = mergeCostLinks(
      live.get(variantId) ?? [],
      removedByVariant.get(variantId) ?? [],
      at,
    );
    if (merged.length > 0) {
      linksByVariant.set(variantId, merged);
    }
  }
  return linksByVariant;
}

/**
 * One entry per profile from the live links and the removed links of one variant:
 * the candidate attached by `at` (the earliest if several), else the live one. So a
 * link detached and re-attached after `at` counts through its removal, and a profile
 * seen both live and in the log (a detach committed between the two reads, or a
 * relink) is returned once. Live links keep their order; removal-only profiles follow.
 */
function mergeCostLinks(
  live: readonly IdentifiedItemCostProfileInput[],
  removed: readonly IdentifiedItemCostProfileInput[],
  at: Date,
): IdentifiedItemCostProfileInput[] {
  const chosen = new Map<string, IdentifiedItemCostProfileInput>();
  for (const candidate of [...live, ...removed]) {
    const current = chosen.get(candidate.profileId);
    if (current === undefined || isPreferredAt(candidate, current, at)) {
      chosen.set(candidate.profileId, candidate);
    }
  }
  return [...chosen.values()];
}

/** True when `candidate` should replace `current`: attached by `at`, and earlier unless `current` is not. */
function isPreferredAt(
  candidate: IdentifiedItemCostProfileInput,
  current: IdentifiedItemCostProfileInput,
  at: Date,
): boolean {
  const time = at.getTime();
  const candidateTime = candidate.attachedAt.getTime();
  if (candidateTime > time) return false;
  const currentTime = current.attachedAt.getTime();
  return currentTime > time || candidateTime < currentTime;
}
