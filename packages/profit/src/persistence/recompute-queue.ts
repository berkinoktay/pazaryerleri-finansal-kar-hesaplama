import { Prisma, type PrismaClient } from '@pazarsync/db';
import {
  OrderStatus,
  Platform,
  ProfitIssueCode,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
  ShippingTariffSource,
} from '@pazarsync/db/enums';

import { PROFIT_ENGINE_VERSION } from '../core/engine-version';
import { ParcelNotFoundError, UnsupportedPlatformError } from './errors';
import { loadActiveTrendyolCarriers, resolveOrderCarrier } from './load-trendyol-parcel';
import { PROFIT_ENGINE_PLATFORMS, recomputeParcelProfit } from './recompute-parcel-profit';

/**
 * The profit recompute queue (Phase 3B). Every producer writes a single per-order
 * mark inside its own transaction; the sync-worker tick drains it. All writes are
 * raw SQL with bound parameters (never string concatenation): the enqueue is one
 * `INSERT ... SELECT ... ON CONFLICT`, and the drain claims marks with
 * `FOR UPDATE SKIP LOCKED` so two workers never take the same row.
 *
 * Tenant isolation: every enqueue selects orders through an organization (and, where
 * given, store) filter, so a caller's raw id list can never pull another tenant's
 * order into the queue. The sweep is global across tenants, but each swept row
 * carries its own order's organization and store.
 *
 * These tables have no DB-level `updated_at` trigger, so every raw UPDATE sets
 * `updated_at = clock_timestamp()` by hand. `clock_timestamp()` (not `now()`) is used
 * throughout so a later statement in a long transaction still gets a fresh instant.
 */

/**
 * How many marks one drain pass claims. Each claimed mark is recomputed in its own
 * short transaction, so this bounds the work (and the lock window) per pass. The
 * sync-worker tick and the operator drain script both use it.
 */
export const PROFIT_RECOMPUTE_BATCH_SIZE = 50;

/** How long a claimed request is leased before another worker may re-claim it. */
export const PROFIT_RECOMPUTE_LEASE_MS = 120_000;

/** The interactive-transaction maxWait for one recompute (Prisma's 5s default is tight). */
export const PROFIT_RECOMPUTE_TX_MAX_WAIT_MS = 10_000;

/** The interactive-transaction timeout for one recompute (lock wait + parcel load + write). */
export const PROFIT_RECOMPUTE_TX_TIMEOUT_MS = 30_000;

/** The backoff base: first retry waits this long, doubling each further failure. */
export const PROFIT_RECOMPUTE_BACKOFF_BASE_MS = 30_000;

/** The backoff cap: the retry delay never exceeds one hour. */
export const PROFIT_RECOMPUTE_BACKOFF_CAP_MS = 3_600_000;

/** The stored `last_error` is truncated to this many characters. */
export const PROFIT_RECOMPUTE_ERROR_MAX_LENGTH = 1000;

/** The organization and reason every enqueue carries. */
export interface EnqueueScope {
  readonly organizationId: string;
  readonly reason: ProfitRecomputeReason;
}

/**
 * Enqueues the given orders of one organization and store. The org and store filter
 * is applied to the caller's id list, so an id that is not this tenant's is dropped.
 * An empty id list returns 0 without a query. Returns the affected row count.
 */
export function enqueueProfitRecompute(
  tx: Prisma.TransactionClient,
  params: EnqueueScope & { readonly storeId: string; readonly orderIds: readonly string[] },
): Promise<number> {
  const { organizationId, reason, storeId, orderIds } = params;
  if (orderIds.length === 0) {
    return Promise.resolve(0);
  }
  const ids = [...orderIds];
  return enqueueFromOrders(
    tx,
    reason,
    Prisma.sql`o.id = ANY(${ids}::uuid[])
      AND o.organization_id = ${organizationId}::uuid
      AND o.store_id = ${storeId}::uuid`,
  );
}

/**
 * Enqueues every order of the organization that carries at least one item of the
 * given variants. An empty variant list returns 0 without a query. Returns the
 * affected row count.
 */
export function enqueueProfitRecomputeForVariants(
  tx: Prisma.TransactionClient,
  params: EnqueueScope & { readonly variantIds: readonly string[] },
): Promise<number> {
  const { organizationId, reason, variantIds } = params;
  if (variantIds.length === 0) {
    return Promise.resolve(0);
  }
  const ids = [...variantIds];
  return enqueueFromOrders(
    tx,
    reason,
    Prisma.sql`o.organization_id = ${organizationId}::uuid
      AND EXISTS (
        SELECT 1 FROM order_items i
        WHERE i.order_id = o.id AND i.product_variant_id = ANY(${ids}::uuid[])
      )`,
  );
}

/** Enqueues every order of one store. Returns the affected row count. */
export function enqueueProfitRecomputeForStore(
  tx: Prisma.TransactionClient,
  params: EnqueueScope & { readonly storeId: string },
): Promise<number> {
  const { organizationId, reason, storeId } = params;
  return enqueueFromOrders(
    tx,
    reason,
    Prisma.sql`o.organization_id = ${organizationId}::uuid AND o.store_id = ${storeId}::uuid`,
  );
}

/**
 * The single enqueue statement shared by every scope: one `INSERT ... SELECT ...
 * ON CONFLICT (order_id) DO UPDATE`. The DISTINCT subquery means a scope that
 * fans out over items (variants) cannot touch the same conflict row twice, which
 * Postgres rejects. On conflict the mark is refreshed: new reason, fresh request
 * and next-attempt times, attempts back to 0 and last_error cleared.
 *
 * The outer SELECT is ordered by `o.id` so the INSERT inserts (and so locks the
 * conflicting queue rows) in a single global order. Producers upsert overlapping
 * orders inside longer transactions -- settlement ingest batches, the cost
 * profile variant scope, the operator's store-wide recompute -- and without one
 * global order two of them can lock the same rows in opposite orders and deadlock
 * (40P01). Order id is that global order: every producer takes the shared rows the
 * same way, so they queue instead of deadlocking.
 */
function enqueueFromOrders(
  tx: Prisma.TransactionClient,
  reason: ProfitRecomputeReason,
  orderFilter: Prisma.Sql,
): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO profit_recompute_queue (
      id, organization_id, store_id, order_id, reason,
      requested_at, next_attempt_at, attempts, last_error, created_at, updated_at
    )
    SELECT
      gen_random_uuid(), o.organization_id, o.store_id, o.id,
      ${reason}::"ProfitRecomputeReason",
      clock_timestamp(), clock_timestamp(), 0, NULL::text, clock_timestamp(), clock_timestamp()
    FROM (
      SELECT DISTINCT o.id, o.organization_id, o.store_id
      FROM orders o
      WHERE ${orderFilter}
    ) o
    ORDER BY o.id
    ON CONFLICT (order_id) DO UPDATE SET
      reason = EXCLUDED.reason,
      requested_at = clock_timestamp(),
      -- A re-request of an order that is being computed resets next_attempt_at to now,
      -- so the mark is claimable again before its lease ends: a second worker may pick
      -- it up while the first is still computing. Correctness is kept by the per-order
      -- advisory lock in recomputeParcelProfit -- the second waits, then sees an
      -- unchanged content hash. The only cost is one redundant load.
      next_attempt_at = clock_timestamp(),
      attempts = 0,
      last_error = NULL,
      updated_at = clock_timestamp()
  `;
}

/**
 * The migration sweep: enqueues orders that have no queue row and whose best-known
 * profit is missing or stamped by an older engine, newest order first, up to `limit`.
 * It is global across tenants, and each enqueued row carries its own order's
 * organization and store. `ON CONFLICT DO NOTHING` leaves an already-queued order's
 * richer reason intact. Returns the number of rows inserted.
 *
 * Only orders whose store's platform the engine can compute are swept: a platform the
 * engine cannot compute has no writer, so enqueuing its orders would only have them
 * dropped on drain. Orders carry no platform column, so the store's platform is checked
 * through an EXISTS on stores.
 *
 * The candidates are picked newest first with the LIMIT, but the INSERT inserts them
 * ordered by their id, for the same lock-order reason as `enqueueFromOrders`: the
 * sweep can wait on a producer's uncommitted insert of a shared order, so it must
 * take rows in the one global id order every producer uses, or the two deadlock.
 */
export function enqueueStaleProfitStatements(
  db: PrismaClient,
  params: { readonly limit: number },
): Promise<number> {
  const { limit } = params;
  return db.$executeRaw`
    INSERT INTO profit_recompute_queue (
      id, organization_id, store_id, order_id, reason,
      requested_at, next_attempt_at, attempts, last_error, created_at, updated_at
    )
    SELECT
      gen_random_uuid(), o.organization_id, o.store_id, o.id,
      ${ProfitRecomputeReason.STALE_STATEMENT}::"ProfitRecomputeReason",
      clock_timestamp(), clock_timestamp(), 0, NULL::text, clock_timestamp(), clock_timestamp()
    FROM (
      SELECT o.id, o.organization_id, o.store_id
      FROM orders o
      WHERE EXISTS (
          SELECT 1 FROM stores s
          WHERE s.id = o.store_id
            AND s.platform = ANY(${[...PROFIT_ENGINE_PLATFORMS]}::"Platform"[])
        )
        AND NOT EXISTS (
          SELECT 1 FROM profit_recompute_queue q WHERE q.order_id = o.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM order_profit_statements s
          WHERE s.order_id = o.id
            AND s.view = ${ProfitStatementView.BEST_KNOWN}::"ProfitStatementView"
            AND s.engine_version >= ${PROFIT_ENGINE_VERSION}
        )
      ORDER BY o.order_date DESC
      LIMIT ${limit}
    ) o
    ORDER BY o.id
    ON CONFLICT (order_id) DO NOTHING
  `;
}

/**
 * An order whose capture holds a cargo name no carrier was recognised from, and whose
 * shipping is priced from that carrier (alias `c`): captured on the Trendyol-contract
 * tariff source (an own-contract capture is priced from the store's own desi tariff and
 * never consults the carrier or Barem), no carrier, not shipped under the seller's own
 * cargo agreement (that order is exempt from the carrier rule), not excluded from profit
 * and not cancelled. Only Trendyol stores: the carriers are Trendyol's and only a
 * Trendyol order is captured. An order that already has a queue row is left to that
 * row: re-enqueuing it would reset a failing request's backoff on every sweep.
 */
const CARRIER_GAP_ORDER = Prisma.sql`c.profit_snapshot_at IS NOT NULL
  AND c.snapshot_shipping_tariff_source = ${ShippingTariffSource.TRENDYOL_CONTRACT}::"ShippingTariffSource"
  AND c.snapshot_carrier_id IS NULL
  AND c.uses_seller_cargo_agreement = false
  AND c.profit_excluded_at IS NULL
  AND c.status <> ${OrderStatus.CANCELLED}::"OrderStatus"
  AND EXISTS (
    SELECT 1 FROM stores st
    WHERE st.id = c.store_id AND st.platform = ${Platform.TRENDYOL}::"Platform"
  )
  AND NOT EXISTS (
    SELECT 1 FROM profit_recompute_queue q WHERE q.order_id = c.id
  )`;

/**
 * The carrier gap sweep (plan PR-3a, Gorev 4): enqueues the orders that wait only because
 * their captured cargo name was not recognised, once a carrier claims that name. Newest
 * order first, up to `limit`; returns the number of orders enqueued.
 *
 * It reads the distinct captured names of the waiting orders (a small set), matches each
 * against the active carriers with `resolveOrderCarrier` -- the same matcher and the same
 * normaliser as the capture, in TypeScript so the two can never drift -- and enqueues only
 * the orders whose name is recognised now. An order on a recognised carrier never enters
 * the queue this way, whoever added the mapping (seed, migration, admin screen). The
 * recompute then fills the carrier on the capture (`captureOrderProfitSnapshot` gap fill),
 * which takes the order out of the candidates.
 *
 * Global across tenants by design: the carriers and their cargo names are platform-wide
 * reference data shared by every organization, so a new mapping concerns every tenant's
 * orders at once. No caller id reaches the query -- the candidates are selected by their
 * own columns only -- and `enqueueFromOrders` writes each row with its own order's
 * organization and store, so no row can cross a tenant.
 */
export async function enqueueCarrierGapRecomputes(
  db: PrismaClient,
  params: { readonly limit: number },
): Promise<number> {
  const { limit } = params;
  const nameRows = await db.$queryRaw<unknown[]>`
    SELECT DISTINCT c.snapshot_cargo_provider_name AS "name"
    FROM orders c
    WHERE ${CARRIER_GAP_ORDER}
      AND c.snapshot_cargo_provider_name IS NOT NULL
      AND btrim(c.snapshot_cargo_provider_name) <> ''
  `;
  const names = nameRows.map(toCargoProviderName);
  if (names.length === 0) {
    return 0;
  }
  const carriers = await loadActiveTrendyolCarriers(db);
  const recognised = names.filter((name) => resolveOrderCarrier(name, carriers) !== null);
  if (recognised.length === 0) {
    return 0;
  }
  return enqueueFromOrders(
    db,
    ProfitRecomputeReason.REFERENCE_CHANGED,
    Prisma.sql`o.id IN (
      SELECT c.id
      FROM orders c
      WHERE ${CARRIER_GAP_ORDER}
        AND c.snapshot_cargo_provider_name = ANY(${recognised}::text[])
      ORDER BY c.order_date DESC
      LIMIT ${limit}
    )`,
  );
}

/** The stored issue list fragment a statement missing reference data contains. */
const REFERENCE_DATA_MISSING_ISSUES_JSON = JSON.stringify([
  { code: ProfitIssueCode.REFERENCE_DATA_MISSING },
]);

/**
 * A best-known statement that is not computable because some dated reference data (a fee
 * definition or a micro-export return tier) was missing on the order date (alias `s`).
 */
const REFERENCE_GAP_STATEMENT = Prisma.sql`s.view = ${ProfitStatementView.BEST_KNOWN}::"ProfitStatementView"
  AND s.status = ${ProfitStatus.NOT_COMPUTABLE}::"ProfitStatus"
  AND s.issues @> ${REFERENCE_DATA_MISSING_ISSUES_JSON}::jsonb`;

/**
 * The newest change instant across the reference data a REFERENCE_DATA_MISSING gap can be
 * filled from: fee definitions, micro-export return tier versions and their tier rows.
 * A row's change instant is the later of its `created_at` and `updated_at`, so a fix made
 * in place counts as well as a new row, provided the write moves `updated_at` (below): an
 * amount column filled, `effective_to` extended, `effective_from` moved back, an
 * `ON CONFLICT DO UPDATE` that sets `updated_at`, or a tier row added to an existing
 * version. NULL when all three tables are empty.
 *
 * `updated_at` on these tables is a Prisma `@updatedAt` column with no database default
 * or trigger: Prisma Client sets it on every write, but a raw SQL INSERT or UPDATE must set
 * `updated_at` itself (to `now()`), or the sweep never sees that fix. A DELETE leaves no
 * instant behind, so a fix that only deletes a row is not seen either.
 */
const NEWEST_GAP_REFERENCE_CHANGE_AT = Prisma.sql`(
  SELECT MAX(r.changed_at) FROM (
    SELECT GREATEST(created_at, updated_at) AS changed_at FROM fee_definitions
    UNION ALL
    SELECT GREATEST(created_at, updated_at) FROM micro_export_return_fee_tier_versions
    UNION ALL
    SELECT GREATEST(created_at, updated_at) FROM micro_export_return_fee_tiers
  ) r
)`;

/**
 * The reference data gap sweep (plan PR-3a, Gorev 4): enqueues the orders whose best-known
 * statement is not computable for missing reference data (REFERENCE_DATA_MISSING) and was
 * last written before the newest change to the fee definitions or the micro-export tiers
 * (`NEWEST_GAP_REFERENCE_CHANGE_AT`: a new row or one fixed in place). So once a
 * definition is added or fixed, every such order is recomputed once; an order the change
 * does not fill is not taken again until a newer change arrives (the drain stamps its
 * statement as re-checked, `markReferenceGapRechecked`). Newest order first, up to
 * `limit`; returns the number of orders enqueued.
 *
 * Only orders of a platform the engine can compute (as the stale sweep), and none that
 * already has a queue row (as the carrier gap sweep).
 *
 * Global across tenants by design: fee definitions and tier versions are platform-wide
 * reference data shared by every organization, so a new definition concerns every
 * tenant's orders at once. No caller id reaches the query, and `enqueueFromOrders` writes
 * each row with its own order's organization and store, so no row can cross a tenant.
 */
export function enqueueReferenceDataGapRecomputes(
  db: PrismaClient,
  params: { readonly limit: number },
): Promise<number> {
  const { limit } = params;
  return enqueueFromOrders(
    db,
    ProfitRecomputeReason.REFERENCE_CHANGED,
    Prisma.sql`o.id IN (
      SELECT c.id
      FROM orders c
      JOIN order_profit_statements s ON s.order_id = c.id
      WHERE ${REFERENCE_GAP_STATEMENT}
        AND s.updated_at < ${NEWEST_GAP_REFERENCE_CHANGE_AT}
        AND EXISTS (
          SELECT 1 FROM stores st
          WHERE st.id = c.store_id
            AND st.platform = ANY(${[...PROFIT_ENGINE_PLATFORMS]}::"Platform"[])
        )
        AND NOT EXISTS (
          SELECT 1 FROM profit_recompute_queue q WHERE q.order_id = c.id
        )
      ORDER BY c.order_date DESC
      LIMIT ${limit}
    )`,
  );
}

/** Narrows a raw distinct-name row to its cargo name, throwing on an unexpected shape. */
function toCargoProviderName(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('name' in value) ||
    typeof value.name !== 'string'
  ) {
    throw new Error('carrier gap sweep returned an unexpected row shape');
  }
  return value.name;
}

/** One request claimed off the queue, with the request time the claimer must match back. */
export interface ClaimedRecompute {
  readonly id: string;
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly requestedAt: Date;
}

/** The result of processing one claimed request. */
export type RecomputeOutcome =
  | 'CHANGED'
  | 'UNCHANGED'
  | 'FAILED'
  | 'ORDER_GONE'
  | 'UNSUPPORTED_PLATFORM';

/**
 * Claims up to `batchSize` due requests (`next_attempt_at <= now`), oldest first,
 * leasing each for `PROFIT_RECOMPUTE_LEASE_MS` so a crashed worker's rows become
 * claimable again. `FOR UPDATE SKIP LOCKED` keeps concurrent claims disjoint. The
 * claimed `requested_at` is returned so the processor can tell a stale delete from
 * a re-requested row.
 */
export async function claimProfitRecomputeRequests(
  db: PrismaClient,
  params: { readonly batchSize: number },
): Promise<ClaimedRecompute[]> {
  const rows = await db.$queryRaw<unknown[]>`
    UPDATE profit_recompute_queue q
    SET next_attempt_at = clock_timestamp() + (${PROFIT_RECOMPUTE_LEASE_MS} * interval '1 millisecond'),
        updated_at = clock_timestamp()
    FROM (
      SELECT id FROM profit_recompute_queue
      WHERE next_attempt_at <= clock_timestamp()
      ORDER BY next_attempt_at, id
      LIMIT ${params.batchSize}
      FOR UPDATE SKIP LOCKED
    ) c
    WHERE q.id = c.id
    RETURNING
      q.id AS "id",
      q.organization_id AS "organizationId",
      q.store_id AS "storeId",
      q.order_id AS "orderId",
      q.requested_at AS "requestedAt"
  `;
  return rows.map(toClaimedRecompute);
}

/**
 * Recomputes one claimed request in its own short transaction and removes the mark.
 * A statement still missing reference data is stamped as re-checked in the same
 * transaction (`markReferenceGapRechecked`), so the reference gap sweep does not take
 * the order again. The delete matches both `id` and the claimed `requested_at`: a request that arrived
 * while we were computing changed `requested_at`, so the mark survives for another
 * pass. A vanished order yields `ORDER_GONE` (the FK cascade may already have removed
 * the mark; the delete is then a harmless no-op). An order whose store platform the
 * engine cannot compute yet yields `UNSUPPORTED_PLATFORM`, dropped the same unguarded
 * way (no backoff). Any other error backs the request off outside the rolled-back
 * transaction and yields `FAILED`; the backoff carries the same `requested_at` guard,
 * so a request re-enqueued mid-failure is not demoted. It never throws, so one bad
 * order cannot stop the drain.
 */
export async function processClaimedRecompute(
  db: PrismaClient,
  claimed: ClaimedRecompute,
): Promise<RecomputeOutcome> {
  try {
    const changed = await db.$transaction(
      async (tx) => {
        const result = await recomputeParcelProfit(tx, {
          organizationId: claimed.organizationId,
          orderId: claimed.orderId,
        });
        await markReferenceGapRechecked(tx, claimed);
        await tx.$executeRaw`
          DELETE FROM profit_recompute_queue
          WHERE id = ${claimed.id}::uuid AND requested_at = ${claimed.requestedAt}::timestamp(3)
        `;
        return result.changed;
      },
      { maxWait: PROFIT_RECOMPUTE_TX_MAX_WAIT_MS, timeout: PROFIT_RECOMPUTE_TX_TIMEOUT_MS },
    );
    return changed ? 'CHANGED' : 'UNCHANGED';
  } catch (error) {
    if (error instanceof ParcelNotFoundError) {
      await db.$executeRaw`DELETE FROM profit_recompute_queue WHERE id = ${claimed.id}::uuid`;
      return 'ORDER_GONE';
    }
    if (error instanceof UnsupportedPlatformError) {
      // The platform is the store's property; a retry can never succeed, so the mark is
      // dropped the same unguarded way ORDER_GONE drops it -- no backoff, not FAILED.
      // Once that platform's writer ships, the sweep enqueues those orders again because
      // they have no statement, so nothing is lost.
      await db.$executeRaw`DELETE FROM profit_recompute_queue WHERE id = ${claimed.id}::uuid`;
      return 'UNSUPPORTED_PLATFORM';
    }
    await recordRecomputeFailure(db, claimed, error);
    return 'FAILED';
  }
}

/**
 * Stamps the order's best-known statement as re-checked against the reference data while
 * it still misses some (REFERENCE_DATA_MISSING); matches no other statement. A recompute
 * whose content hash did not change writes nothing, so without this stamp the statement
 * would stay older than the newest reference change, and the reference gap sweep would
 * take the order again on every sweep. The stamp is at least the newest reference change
 * instant (`NEWEST_GAP_REFERENCE_CHANGE_AT`, the same one the sweep compares against), so
 * the order leaves the sweep's candidates even when the clock that wrote the change runs
 * ahead of the database's, until a newer change arrives. Only `updated_at` moves:
 * `computed_at` stays the time the content was computed. Scoped by the claimed order's
 * organization.
 */
function markReferenceGapRechecked(
  tx: Prisma.TransactionClient,
  claimed: ClaimedRecompute,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE order_profit_statements s
    SET updated_at = GREATEST(clock_timestamp()::timestamp(3), ${NEWEST_GAP_REFERENCE_CHANGE_AT})
    WHERE s.order_id = ${claimed.orderId}::uuid
      AND s.organization_id = ${claimed.organizationId}::uuid
      AND ${REFERENCE_GAP_STATEMENT}
  `;
}

/**
 * Records a failed recompute on its mark, outside the rolled-back transaction:
 * attempts + 1, the truncated error, and an exponential backoff of
 * `min(base * 2^attempts, cap)` from now. `power` reads the pre-update `attempts`, so
 * the first failure waits `base`, the next `2 * base`, and so on up to `cap`.
 *
 * The UPDATE carries the same `requested_at` guard the success-path DELETE uses: a
 * request that arrived while we were failing bumped `requested_at`, so the guard matches
 * nothing and the fresh mark is left untouched (attempts 0, next_attempt_at now, no
 * error) to be processed again. `requested_at` is a `timestamp(3)` without a time zone,
 * so the claimed value is cast explicitly rather than relying on an implicit
 * timestamptz-to-timestamp conversion.
 */
function recordRecomputeFailure(
  db: PrismaClient,
  claimed: ClaimedRecompute,
  error: unknown,
): Promise<number> {
  const message = recomputeErrorMessage(error).slice(0, PROFIT_RECOMPUTE_ERROR_MAX_LENGTH);
  return db.$executeRaw`
    UPDATE profit_recompute_queue
    SET attempts = attempts + 1,
        last_error = ${message},
        next_attempt_at = clock_timestamp()
          + (LEAST(
                ${PROFIT_RECOMPUTE_BACKOFF_BASE_MS} * power(2, attempts),
                ${PROFIT_RECOMPUTE_BACKOFF_CAP_MS}
             ) * interval '1 millisecond'),
        updated_at = clock_timestamp()
    WHERE id = ${claimed.id}::uuid AND requested_at = ${claimed.requestedAt}::timestamp(3)
  `;
}

/** The counts one drain pass produced, with the failed orders for the caller's log. */
export interface DrainResult {
  readonly claimed: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly unsupported: number;
  readonly failedOrderIds: readonly string[];
}

/**
 * One drain pass: claim a batch, then process each claimed request in turn. Returns
 * the outcome counts; `claimed` may exceed `changed + unchanged + failed` when some
 * orders had already vanished (`ORDER_GONE`) or their platform is not computable yet
 * (`UNSUPPORTED_PLATFORM`, counted in `unsupported`).
 */
export async function drainProfitRecomputeQueue(
  db: PrismaClient,
  params: { readonly batchSize: number },
): Promise<DrainResult> {
  const claimed = await claimProfitRecomputeRequests(db, { batchSize: params.batchSize });
  let changed = 0;
  let unchanged = 0;
  let unsupported = 0;
  const failedOrderIds: string[] = [];
  for (const request of claimed) {
    const outcome = await processClaimedRecompute(db, request);
    switch (outcome) {
      case 'CHANGED':
        changed += 1;
        break;
      case 'UNCHANGED':
        unchanged += 1;
        break;
      case 'FAILED':
        failedOrderIds.push(request.orderId);
        break;
      case 'UNSUPPORTED_PLATFORM':
        unsupported += 1;
        break;
      case 'ORDER_GONE':
        break;
      default: {
        const _exhaustive: never = outcome;
        throw new Error(`Unhandled recompute outcome: ${_exhaustive}`);
      }
    }
  }
  return {
    claimed: claimed.length,
    changed,
    unchanged,
    failed: failedOrderIds.length,
    unsupported,
    failedOrderIds,
  };
}

/** Narrows a raw claim row to `ClaimedRecompute`, throwing on an unexpected shape. */
function toClaimedRecompute(value: unknown): ClaimedRecompute {
  if (!isClaimedRow(value)) {
    throw new Error('profit recompute claim returned an unexpected row shape');
  }
  return {
    id: value.id,
    organizationId: value.organizationId,
    storeId: value.storeId,
    orderId: value.orderId,
    requestedAt: value.requestedAt,
  };
}

/** True when `value` has the five columns the claim query returns, each well typed. */
function isClaimedRow(value: unknown): value is {
  readonly id: string;
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly requestedAt: Date;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'organizationId' in value &&
    typeof value.organizationId === 'string' &&
    'storeId' in value &&
    typeof value.storeId === 'string' &&
    'orderId' in value &&
    typeof value.orderId === 'string' &&
    'requestedAt' in value &&
    value.requestedAt instanceof Date
  );
}

/** The message a thrown value carries, for the stored `last_error`. */
function recomputeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
