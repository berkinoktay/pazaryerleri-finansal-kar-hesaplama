// Day-close tick (same-day edit window, plan P1-18; notes NB5).
//
// Owner rule (Berkin 2026-11-23): an order's cost and desi are the values in force at
// the end of its Istanbul business day T; a change during the day reaches all of that
// day's orders, and at 00:00 the seller inputs become final. This tick makes them final.
// Each tick resolves the settled cutoff once from the database clock
// (`resolveSettledCutoff`: T + SELLER_INPUT_SETTLE_MS and no open transaction that began
// before T, or forced past the cap), then finalises, in bounded chunks, every order whose
// marker `seller_inputs_final_at` is still NULL and whose day is settled
// (`order_date < cutoff`). A stopped worker only delays the pass: the finaliser re-derives
// each order at its own T, so the outcome does not depend on when the tick runs.
//
// The candidate scan is cross-tenant by design (like the recompute drain); each order is
// then finalised in its own transaction under its own organization and store
// (`finalizeOrderSellerInputs`), so one order never holds locks for another.
//
// Failure handling (NB5): an order whose finaliser throws is kept out of the candidate
// scan for a doubling backoff (DAY_CLOSE_BACKOFF_BASE_MS up to DAY_CLOSE_BACKOFF_CAP_MS),
// so a failing order never stalls the others. The backoff lives in this process only
// (bounded, oldest evicted); a restart only means an early retry, and a second worker
// instance would retry independently. A `busy` order (a recompute or intake holds it) is
// not a failure: the next tick retries it. An order of a store whose platform the engine
// cannot compute is still marked final by the finaliser.
//
// A single-process "in flight" flag skips an overlapping tick: the interval can fire again
// while a long pass is still running.

import { prisma } from '@pazarsync/db';
import { finalizeOrderSellerInputs, type FinalizeOutcome } from '@pazarsync/order-sync';
import {
  PROFIT_RECOMPUTE_TX_MAX_WAIT_MS,
  PROFIT_RECOMPUTE_TX_TIMEOUT_MS,
  resolveSettledCutoff,
  type SettledCutoff,
} from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

/** How often the tick fires (index.ts registers it). */
export const DAY_CLOSE_INTERVAL_MS = 5_000;

/** How long one tick keeps starting new orders; below the interval. */
export const DAY_CLOSE_BUDGET_MS = 4_000;

/** How many candidates one scan reads. */
export const DAY_CLOSE_CHUNK_SIZE = 50;

/** The first retry of a failed order waits this long, doubling each further failure. */
export const DAY_CLOSE_BACKOFF_BASE_MS = 30_000;

/** The retry delay of a failed order never exceeds one hour. */
export const DAY_CLOSE_BACKOFF_CAP_MS = 3_600_000;

/** At most this many failed orders are remembered; the oldest is evicted first. */
export const DAY_CLOSE_BACKOFF_MAX_ENTRIES = 500;

/** The waiting-for-writers line is logged at most this often. */
const WAITING_LOG_THROTTLE_MS = 60_000;

/** What one tick did. */
export interface DayCloseTickResult {
  /** True when a previous tick was still running and this one did nothing. */
  readonly skipped: boolean;
  /** The settled cutoff of the tick (null when skipped). */
  readonly cutoff: Date | null;
  readonly finalized: number;
  /** Of the finalised orders, those stamped with a past-day exclusion. */
  readonly excluded: number;
  readonly busy: number;
  readonly failed: number;
}

/** One failed order's retry state. */
interface BackoffEntry {
  readonly attempts: number;
  /** App-clock epoch ms before which the order is not a candidate. */
  readonly nextAttemptAt: number;
}

/** Failed orders by id, in failure order (the map's insertion order is the eviction order). */
const backoffByOrderId = new Map<string, BackoffEntry>();
let tickInFlight = false;
let lastWaitingLogAt = 0;

/** Test seam: clears the in-memory backoff map. */
export function resetDayCloseBackoff(): void {
  backoffByOrderId.clear();
}

/** The failed orders whose retry is not due yet. */
function backingOffOrderIds(now: number): string[] {
  const ids: string[] = [];
  for (const [orderId, entry] of backoffByOrderId) {
    if (entry.nextAttemptAt > now) {
      ids.push(orderId);
    }
  }
  return ids;
}

/** Records one more failure of the order and returns its new retry state. */
function recordFailure(orderId: string, now: number): BackoffEntry {
  const attempts = (backoffByOrderId.get(orderId)?.attempts ?? 0) + 1;
  const delay = Math.min(DAY_CLOSE_BACKOFF_BASE_MS * 2 ** (attempts - 1), DAY_CLOSE_BACKOFF_CAP_MS);
  const entry: BackoffEntry = { attempts, nextAttemptAt: now + delay };
  // Re-inserted at the end, so the first key is always the longest-standing failure.
  backoffByOrderId.delete(orderId);
  backoffByOrderId.set(orderId, entry);
  while (backoffByOrderId.size > DAY_CLOSE_BACKOFF_MAX_ENTRIES) {
    const oldest = backoffByOrderId.keys().next();
    if (oldest.done === true) {
      break;
    }
    backoffByOrderId.delete(oldest.value);
  }
  return entry;
}

/**
 * Logs, at most once a minute, that open transactions begun before the day end hold the
 * cutoff back. Only pids and start instants are logged, never a session's query text. A
 * forced cutoff is logged once by `resolveSettledCutoff` itself.
 */
function logWaitingForWriters(settle: SettledCutoff): void {
  if (settle.openWriters.length === 0 || settle.forced) {
    return;
  }
  const now = Date.now();
  if (now - lastWaitingLogAt < WAITING_LOG_THROTTLE_MS) {
    return;
  }
  lastWaitingLogAt = now;
  syncLog.info('day-close.waiting-for-writers', {
    cutoff: settle.cutoff.toISOString(),
    dbNow: settle.dbNow.toISOString(),
    openWriters: settle.openWriters.map((writer) => ({
      pid: writer.pid,
      xactStart: writer.xactStart.toISOString(),
    })),
  });
}

/** One candidate of the scan: the order and the scope it is finalised under. */
interface DayCloseCandidate {
  readonly id: string;
  readonly organizationId: string;
  readonly storeId: string;
}

/** Why the finaliser skipped an order. */
type SkipReason = Extract<FinalizeOutcome, { readonly kind: 'skipped' }>['reason'];

/**
 * Whether a skipped order would still match the candidate scan: a busy order does until
 * its holder ends; an order finalised meanwhile by another pass leaves it by itself; a
 * not-settled order cannot come from this scan's own cutoff, and is kept out all the same.
 */
const SKIP_STAYS_CANDIDATE: Readonly<Record<SkipReason, boolean>> = {
  busy: true,
  already_final: false,
  not_settled: true,
};

/** Running totals of one tick. */
interface DayCloseCounts {
  finalized: number;
  excluded: number;
  busy: number;
  failed: number;
}

/**
 * Finalises one order in its own transaction and adds its outcome to `counts`. Returns
 * true when the order may still be a candidate later in this tick (it was skipped or it
 * failed), so the caller leaves it out of the next scan; a failed order is kept out of
 * this tick even when the bounded backoff map has evicted it. Never throws: a failure is
 * recorded in the backoff map and logged.
 */
async function finalizeCandidate(
  candidate: DayCloseCandidate,
  settle: SettledCutoff,
  finalize: typeof finalizeOrderSellerInputs,
  counts: DayCloseCounts,
): Promise<boolean> {
  const { id: orderId, organizationId, storeId } = candidate;
  let outcome: FinalizeOutcome;
  try {
    outcome = await prisma.$transaction(
      (tx) =>
        finalize(tx, {
          organizationId,
          storeId,
          orderId,
          cutoff: settle.cutoff,
          dbNow: settle.dbNow,
        }),
      { maxWait: PROFIT_RECOMPUTE_TX_MAX_WAIT_MS, timeout: PROFIT_RECOMPUTE_TX_TIMEOUT_MS },
    );
  } catch (error) {
    const entry = recordFailure(orderId, Date.now());
    counts.failed += 1;
    syncLog.error('day-close.order-error', {
      orderId,
      organizationId,
      storeId,
      attempts: entry.attempts,
      nextAttemptAt: new Date(entry.nextAttemptAt).toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
  backoffByOrderId.delete(orderId);

  switch (outcome.kind) {
    case 'finalized':
      counts.finalized += 1;
      if (outcome.exclusion !== null) {
        counts.excluded += 1;
      }
      return false;
    case 'skipped':
      if (outcome.reason === 'busy') {
        counts.busy += 1;
      }
      return SKIP_STAYS_CANDIDATE[outcome.reason];
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`Unhandled day-close outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** One tick's work, under the in-flight flag. */
async function runDayClose(opts: {
  readonly dbNow?: Date;
  readonly finalize?: typeof finalizeOrderSellerInputs;
}): Promise<DayCloseTickResult> {
  const startedAt = Date.now();
  const finalize = opts.finalize ?? finalizeOrderSellerInputs;
  const settle = await resolveSettledCutoff(prisma, { dbNow: opts.dbNow });
  logWaitingForWriters(settle);

  const counts: DayCloseCounts = { finalized: 0, excluded: 0, busy: 0, failed: 0 };
  // Orders skipped or failed in this tick: not picked again until the next tick.
  const skippedThisTick = new Set<string>();
  const budgetSpent = (): boolean => Date.now() - startedAt >= DAY_CLOSE_BUDGET_MS;

  while (!budgetSpent()) {
    // Cross-tenant scan by design: each order is finalised under its own organization
    // and store. `order_date < cutoff` is "the order's day end is at or before the
    // cutoff", since the cutoff is a business-day start.
    const candidates = await prisma.order.findMany({
      where: {
        sellerInputsFinalAt: null,
        orderDate: { lt: settle.cutoff },
        id: { notIn: [...backingOffOrderIds(Date.now()), ...skippedThisTick] },
      },
      orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
      take: DAY_CLOSE_CHUNK_SIZE,
      select: { id: true, organizationId: true, storeId: true },
    });
    for (const candidate of candidates) {
      if (budgetSpent()) {
        break;
      }
      if (await finalizeCandidate(candidate, settle, finalize, counts)) {
        skippedThisTick.add(candidate.id);
      }
    }
    if (candidates.length < DAY_CLOSE_CHUNK_SIZE) {
      break;
    }
  }

  if (counts.finalized + counts.busy + counts.failed > 0) {
    syncLog.info('day-close.tick', {
      cutoff: settle.cutoff.toISOString(),
      dbNow: settle.dbNow.toISOString(),
      ...counts,
    });
  }
  return { skipped: false, cutoff: settle.cutoff, ...counts };
}

/**
 * One day-close tick: finalises the settled non-final orders until none is left or
 * DAY_CLOSE_BUDGET_MS is spent. `opts.dbNow` is a test seam for the database clock and
 * `opts.finalize` one for the per-order finaliser; production passes neither.
 */
export async function processDayClose(
  opts: {
    readonly dbNow?: Date;
    readonly finalize?: typeof finalizeOrderSellerInputs;
  } = {},
): Promise<DayCloseTickResult> {
  if (tickInFlight) {
    return { skipped: true, cutoff: null, finalized: 0, excluded: 0, busy: 0, failed: 0 };
  }
  tickInFlight = true;
  try {
    return await runDayClose(opts);
  } finally {
    tickInFlight = false;
  }
}
