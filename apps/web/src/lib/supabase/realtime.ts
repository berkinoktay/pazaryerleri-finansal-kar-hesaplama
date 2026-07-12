'use client';

import type { components } from '@pazarsync/api-client';
import {
  isSyncErrorCode,
  type BufferEntryStatus,
  type OrderStatus,
  type SyncErrorCode,
  type SyncStatus,
  type SyncType,
} from '@pazarsync/db/enums';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { createClient } from './client';

/**
 * Wire shape of a sync_logs row arriving over postgres_changes. Mirrors
 * what Postgres logical decoding emits for our schema. We map this to
 * the same JSON shape our REST endpoint returns so consumers don't have
 * to deal with two response types.
 */
interface SyncLogsRowWire {
  id: string;
  /**
   * Tenant id. Postgres logical decoding emits it because the column was
   * denormalized onto sync_logs in PR #60 — keeping it on the wire shape
   * lets the in-memory SyncLog we hand React Query carry tenant identity
   * even though the channel filter already gates the row server-side.
   */
  organization_id: string;
  store_id: string;
  sync_type: SyncType;
  /**
   * Full worker-pipeline lifecycle. PENDING + FAILED_RETRYABLE are
   * emitted by the worker (apps/sync-worker) — `tryClaimNext` writes
   * RUNNING; `markRetryable` writes FAILED_RETRYABLE; `acquireSlot`
   * inserts PENDING. Logical decoding sees all five over the channel.
   */
  status: SyncStatus;
  started_at: string;
  completed_at: string | null;
  records_processed: number;
  progress_current: number;
  progress_total: number | null;
  progress_stage: string | null;
  error_code: SyncErrorCode | null;
  error_message: string | null;
  /** Worker (re)claim count. Bumped in tryClaimNext. */
  attempt_count: number;
  /**
   * Set by markRetryable when a chunk fails transiently. Drives the
   * "Yeniden denenecek HH:MM" countdown in the SyncCenter retry section.
   */
  next_attempt_at: string | null;
  /**
   * Diagnostic record of pages the worker advanced past after exhausting
   * MAX_ATTEMPTS on a `MARKETPLACE_UNREACHABLE` (a deterministic upstream
   * 5xx on a single Trendyol page). Drives the "X sayfa atlandı" chip on
   * COMPLETED rows. Logical decoding emits the jsonb column; we leave the
   * shape loose here (`unknown`) and validate the wire shape in the API
   * layer's normalizer.
   */
  skipped_pages: unknown | null;
}

/**
 * Wire shape of an `orders` row arriving over postgres_changes (INSERT only).
 * Mirrors Postgres logical-decoding output; the notifier consumes `id` and
 * `order_date` (the past-day drop gate), while the scope columns document what
 * the row carries.
 */
interface OrdersRowWire {
  id: string;
  organization_id: string;
  store_id: string;
  status: OrderStatus;
  order_date: string;
  platform_order_number: string | null;
}

/** Wire shape of a `live_performance_buffer` row over postgres_changes. */
interface BufferRowWire {
  id: string;
  organization_id: string;
  store_id: string;
  status: BufferEntryStatus;
  order_date: string;
  platform_order_number: string;
}

export interface SkippedPageWireShape {
  page: number;
  attemptedAt: string;
  errorCode: SyncErrorCode;
  httpStatus: number;
  xRequestId?: string;
  responseBodySnippet?: string;
}

export interface SyncLogRealtimeShape {
  id: string;
  organizationId: SyncLogsRowWire['organization_id'];
  storeId: SyncLogsRowWire['store_id'];
  syncType: SyncLogsRowWire['sync_type'];
  status: SyncLogsRowWire['status'];
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  progressStage: string | null;
  errorCode: SyncErrorCode | null;
  errorMessage: string | null;
  attemptCount: SyncLogsRowWire['attempt_count'];
  nextAttemptAt: string | null;
  skippedPages: SkippedPageWireShape[] | null;
}

// Drift guard (issue #266): SyncLogRealtimeShape is hand-sourced from the DB wire
// row above — the Realtime payload IS the sync_logs row, mapped snake->camel — NOT
// derived from the OpenAPI DTO. But the web client reconstructs a SyncLog from a
// Realtime event, so the two must stay structurally identical. `pnpm api:sync` does
// not touch this file, so without this compile-time assertion a change to
// SyncLogResponse (a field added, removed, or retyped) would drift here silently.
// The bidirectional check resolves to `never` — and fails typecheck — on divergence.
type SyncLogResponseDto = components['schemas']['SyncLogResponse'];
type ExactShape<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// This binding exists only to evaluate the assertion above — it's never read at
// runtime. apps/web's ESLint (next's config, not the shared base) doesn't honor
// the `_` unused-var convention, so disable the rule explicitly here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _syncLogShapeMatchesApiDto: ExactShape<SyncLogRealtimeShape, SyncLogResponseDto> = true;

export interface SyncLogRealtimeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  /** New row state. Null only on DELETE events. */
  row: SyncLogRealtimeShape | null;
  /** Row id — present on every event including DELETE. */
  id: string;
}

/**
 * Channel health, surfaced to consumers so they can gate a polling
 * fallback on it. `healthy` is true only while we believe the WebSocket
 * is delivering events; everything else (connecting, dropped, errored,
 * tab hidden) is unhealthy and the consumer should poll.
 */
export type RealtimeHealth = 'healthy' | 'connecting' | 'errored' | 'paused';

function snakeToCamel(row: SyncLogsRowWire): SyncLogRealtimeShape {
  return {
    id: row.id,
    organizationId: row.organization_id,
    storeId: row.store_id,
    syncType: row.sync_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    recordsProcessed: row.records_processed,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    progressStage: row.progress_stage,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    skippedPages: normalizeSkippedPages(row.skipped_pages),
  };
}

/**
 * Loose validation of the jsonb skipped_pages column as it arrives over
 * postgres_changes. The worker is the only writer; the API layer applies
 * the same shape contract. We do a structural check here so a single bad
 * row from a future schema drift can't crash the SyncCenter.
 */
function normalizeSkippedPages(raw: unknown): SkippedPageWireShape[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: SkippedPageWireShape[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o['page'] !== 'number' ||
      typeof o['attemptedAt'] !== 'string' ||
      !isSyncErrorCode(o['errorCode']) ||
      typeof o['httpStatus'] !== 'number'
    ) {
      continue;
    }
    out.push({
      page: o['page'],
      attemptedAt: o['attemptedAt'],
      errorCode: o['errorCode'],
      httpStatus: o['httpStatus'],
      ...(typeof o['xRequestId'] === 'string' ? { xRequestId: o['xRequestId'] } : {}),
      ...(typeof o['responseBodySnippet'] === 'string'
        ? { responseBodySnippet: o['responseBodySnippet'] }
        : {}),
    });
  }
  return out.length > 0 ? out : null;
}

// R2d one-time diagnostic (mirrors warnedNonStringOrderDate below): logical
// decoding can drift so a sync_logs INSERT/UPDATE arrives without the id/status
// this cache patch keys on. We skip the patch (the trickle poll reconciles the
// row) and warn ONCE per page session (this flag is module-scoped, not per
// channel) so the drift is diagnosable without spamming the console -- naming
// only the table, never any payload contents.
let warnedMalformedSyncLogsRow = false;

/**
 * Minimal, cheap wire guard for a sync_logs INSERT/UPDATE row before it is
 * mapped into the React Query cache. The Realtime payload's `new` is typed but
 * only at compile time; a drifted row could be missing the fields the patch
 * keys on. We validate just those two — a non-empty string `id` and a string
 * `status` — and trust snakeToCamel + the trickle poll for the rest.
 */
function isPatchableSyncLogsRow(row: unknown): row is SyncLogsRowWire {
  return (
    typeof row === 'object' &&
    row !== null &&
    'id' in row &&
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    'status' in row &&
    typeof row.status === 'string'
  );
}

export interface SubscribeToOrgSyncsOptions {
  /** Per-event handler. Fires once per Realtime postgres_changes payload. */
  onEvent: (event: SyncLogRealtimeEvent) => void;
  /**
   * Channel health changed. Consumers use this to gate a polling
   * fallback: poll only when health is not `'healthy'`. Called
   * synchronously with `'connecting'` immediately after subscribe(),
   * then again on each transition (SUBSCRIBED → `'healthy'`,
   * CHANNEL_ERROR / TIMED_OUT / CLOSED → `'errored'`, visibilitychange
   * `hidden` → `'paused'`).
   */
  onHealthChange?: (health: RealtimeHealth) => void;
  /**
   * R2c delivery watchdog opt-in. Returns whether the consumer currently expects
   * events (for the org-syncs surface: the cache holds an active sync). When it
   * reports `true` but the channel has gone silent past DELIVERY_TIMEOUT_MS while
   * still 'healthy', the core degrades health to 'errored' so the poll fallback
   * and resubscribe kick in. Omit it to leave the watchdog off.
   */
  expectDelivery?: () => boolean;
}

/**
 * PostgreSQL change events a postgres_changes binding can listen to. Mirrors
 * supabase-js's `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT}` string union, where
 * '*' means "all events".
 */
type PostgresChangesListenEvent = '*' | 'INSERT' | 'UPDATE' | 'DELETE';

// supabase-js's RealtimeChannel.on() bounds its postgres_changes row generic to
// `{ [key: string]: any }`. We mirror that exact bound so the wire-row interfaces
// above (which have no index signature and therefore do NOT satisfy
// Record<string, unknown>) are accepted here just as the standalone `.on<Row>(...)`
// calls accepted them before this extraction. Narrowing to unknown would reject
// the interfaces and force casts, which this refactor must not introduce.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors supabase-js's own .on() row bound
type RealtimeRowShape = { [key: string]: any };

/**
 * One postgres_changes binding: the server-side row filter plus the handler that
 * maps the delivered payload. The row type is per-binding so each handler keeps
 * its own wire shape and casts, exactly as the standalone `.on<Row>(...)` calls did.
 */
interface ChannelBinding<Row extends RealtimeRowShape> {
  event: PostgresChangesListenEvent;
  schema: string;
  table: string;
  filter: string;
  handler: (payload: RealtimePostgresChangesPayload<Row>) => void;
}

interface ChannelLifecycleConfig<Row extends RealtimeRowShape> {
  /** supabase channel name, e.g. `sync_logs:org:<id>` or `live-performance:<id>`. */
  topic: string;
  /**
   * postgres_changes bindings, attached to the channel in array order. Order is
   * observable (it is the order supabase-js registers the listeners), so it is
   * preserved verbatim from the caller.
   */
  bindings: ReadonlyArray<ChannelBinding<Row>>;
  /** Channel health transition sink; see RealtimeHealth for the state contract. */
  onHealthChange?: (health: RealtimeHealth) => void;
  /**
   * R2c delivery watchdog opt-in. When present, the core polls it every
   * DELIVERY_CHECK_INTERVAL_MS: if it returns `true` (the consumer is expecting
   * events) while the channel reads 'healthy' but has delivered nothing for
   * longer than DELIVERY_TIMEOUT_MS, health is degraded to 'errored'. Left
   * undefined by consumers whose freshness does not depend on a steady event
   * stream (the live-performance notifier self-heals via signal+refetch).
   */
  expectDelivery?: () => boolean;
  /**
   * Opt out of the visibilitychange teardown. When `true`, the channel is NOT
   * removed when the tab reports `hidden`: it stays open and keeps delivering
   * events (so toasts fire live) in the background. Omitted / `false` keeps the
   * default behavior — tear the channel down while hidden, rebuild on return.
   *
   * Only the live-performance channel opts in (issue #452). Chrome can report a
   * window as `hidden` even while it is fully visible on a second monitor when
   * another application holds focus; under the default teardown that
   * misclassification silently kills the live toast stream for a merchant who is
   * actively watching the panel. Keeping this channel alive trades a little
   * background socket cost for a live stream that never drops in that state.
   *
   * The org-syncs channel keeps the default teardown: its freshness is not
   * time-critical, so freeing the background socket is the better trade there.
   *
   * Do NOT combine this with `expectDelivery`: keeping the channel alive skips the
   * on-hide watchdog disarm, so a throttled background tab could trip a
   * delivery-watchdog false positive and churn needless resubscribes. No caller
   * pairs them today; anyone who wants to must resolve that watchdog interaction
   * first.
   */
  keepAliveWhenHidden?: boolean;
}

interface ChannelLifecycle {
  /** Unsubscribe the channel and detach the visibility listener. */
  cleanup: () => void;
}

/**
 * R2b auto-resubscribe timing. Once a channel has been continuously 'errored'
 * for RESUBSCRIBE_AFTER_MS, the core tears it down and rebuilds it, then keeps
 * retrying with capped exponential backoff between consecutive rebuild attempts
 * (INITIAL, doubling each attempt, clamped at MAX). A successful SUBSCRIBED
 * resets the backoff and cancels the loop.
 */
export const RESUBSCRIBE_AFTER_MS = 15_000;
export const RESUBSCRIBE_BACKOFF_INITIAL_MS = 5_000;
export const RESUBSCRIBE_BACKOFF_MAX_MS = 60_000;

/**
 * R2c delivery watchdog timing. When a consumer's `expectDelivery()` reports
 * events are due but none have arrived for DELIVERY_TIMEOUT_MS while the channel
 * still reads 'healthy', the watchdog degrades health to 'errored' — which wakes
 * both the poll fallback (#435) and the R2b resubscribe. The check runs on a
 * DELIVERY_CHECK_INTERVAL_MS cadence.
 */
export const DELIVERY_TIMEOUT_MS = 20_000;
export const DELIVERY_CHECK_INTERVAL_MS = 5_000;

/**
 * Shared Realtime channel lifecycle used by both subscription helpers below.
 * Owns every mechanic they used to duplicate: the browser Supabase client, the
 * channel build, the postgres_changes bindings, the subscribe-status ->
 * RealtimeHealth mapping (SUBSCRIBED -> 'healthy'; CHANNEL_ERROR / TIMED_OUT /
 * CLOSED -> 'errored'), the one-shot suppression of the CLOSED that a visibility
 * teardown emits (so health stays 'paused', not 'errored', in a hidden tab), the
 * channel-identity guard that drops a late status from a channel we already
 * replaced during a fast hidden->visible rebuild, and the visibilitychange
 * pause/teardown + resume/rebuild.
 *
 * Callers stay thin: each passes its `topic` (channel name), its postgres_changes
 * `bindings` (server-side filters + row handlers), and an optional
 * `onHealthChange` sink. Returns `{ cleanup }`; the helpers hand their own callers
 * `cleanup` directly so their unsubscribe contract is unchanged.
 *
 * See RealtimeHealth for the meaning of each health state and why the consumer's
 * polling fallback is gated on it.
 */
function createChannelLifecycle<Row extends RealtimeRowShape>(
  config: ChannelLifecycleConfig<Row>,
): ChannelLifecycle {
  const { topic, bindings, onHealthChange, expectDelivery, keepAliveWhenHidden } = config;
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let unsubscribed = false;
  // One-shot flag: a visibility-triggered teardown removes the channel, which
  // makes supabase-js fire the subscribe callback once with 'CLOSED'. That is
  // our own teardown, not a real drop -- swallow exactly one CLOSED so health
  // stays 'paused'. It is one-shot on purpose: a genuine later CLOSED (an actual
  // outage) must still surface as 'errored'.
  let suppressClosedOnce = false;
  // Wall-clock ms of the most recently delivered payload on the live channel,
  // ALSO reset on every SUBSCRIBED (a fresh join is itself a delivery signal).
  // Read by the R2c delivery watchdog to detect a channel that is SUBSCRIBED but
  // has gone silent while the consumer expects events.
  let lastEventAt: number | null = null;
  // Latest health we reported. Tracked so the resubscribe loop and the delivery
  // watchdog can read the current state without racing the onHealthChange sink.
  let currentHealth: RealtimeHealth = 'connecting';
  // R2b resubscribe scheduling. `resubscribeTimer` holds either the 15s
  // "continuously errored" countdown or a pending backoff rebuild; `backoffMs`
  // is the delay for the NEXT rebuild after the current one (reset on SUBSCRIBED).
  let resubscribeTimer: number | null = null;
  let backoffMs = RESUBSCRIBE_BACKOFF_INITIAL_MS;
  // R2c delivery watchdog interval handle. Armed on mount and on visibility
  // resume when a consumer opted in; disarmed on hide and on cleanup so a hidden
  // background tab holds no timer.
  let deliveryCheckInterval: number | null = null;
  // Monotonic per-lifecycle counter that suffixes each build's phoenix topic (see
  // buildChannel for the mechanism). It guarantees every rebuild asks for a topic
  // realtime-js has never seen, so a channel(topic) call can never hand the rebuild
  // the still-registered corpse of the channel we are tearing down.
  let generation = 0;
  // True once the async `initialize()` below has built the first channel. Read by
  // the visibility handler's visible branch so a `visible` event that lands while
  // initialize() is still awaiting session hydration does NOT race a second build:
  // initialize() owns the first build unconditionally (see issue #456).
  let initialized = false;

  const clearResubscribeTimer = (): void => {
    if (resubscribeTimer !== null) {
      window.clearTimeout(resubscribeTimer);
      resubscribeTimer = null;
    }
  };

  const reportHealth = (next: RealtimeHealth): void => {
    currentHealth = next;
    if (onHealthChange !== undefined) onHealthChange(next);

    // R2b: drive the auto-resubscribe loop off health transitions.
    if (next === 'errored') {
      // Start the "continuously errored" countdown once. If a backoff rebuild is
      // already pending (we are mid-loop), let it keep ticking -- do NOT restart
      // the clock on repeated 'errored' emits.
      if (resubscribeTimer === null) {
        resubscribeTimer = window.setTimeout(() => void attemptResubscribe(), RESUBSCRIBE_AFTER_MS);
      }
    } else if (next === 'healthy') {
      // A successful join cancels any pending rebuild and resets the backoff.
      backoffMs = RESUBSCRIBE_BACKOFF_INITIAL_MS;
      clearResubscribeTimer();
    } else if (next === 'paused') {
      // Never resubscribe while hidden -- the visibility resume rebuilds. Reset
      // the backoff so the next visible cycle starts a fresh loop.
      backoffMs = RESUBSCRIBE_BACKOFF_INITIAL_MS;
      clearResubscribeTimer();
    }
    // 'connecting' -- a (re)build is in flight; leave any pending backoff timer.
  };

  const buildChannel = (): RealtimeChannel => {
    // A stale flag from a silent teardown must not mask a later real outage.
    suppressClosedOnce = false;
    reportHealth('connecting');
    // Suffix the phoenix topic with a per-lifecycle generation counter so
    // supabase.channel() can NEVER return a previous instance. realtime-js's
    // RealtimeClient.channel(topic) DEDUPES BY TOPIC: while a channel with the same
    // topic is still registered -- e.g. mid phx_leave, because removeChannel only
    // unregisters after the leave ack resolves -- channel(topic) returns THAT
    // leaving corpse instead of minting a fresh one. .on() would then bind onto the
    // corpse, .subscribe() would no-op (the channel is not closed yet), and the
    // pending removal would wipe the bindings, leaving a silently dead channel. A
    // monotonic suffix makes every build a distinct topic, so a teardown still in
    // flight can never be re-acquired -- this also neutralizes the React dev
    // StrictMode double-mount, whose un-awaited cleanup leave would otherwise be
    // re-acquired by the immediate second mount. The suffix is client-namespace
    // only; the postgres_changes bindings below carry the real server-side filters,
    // so it does not change which rows the channel receives.
    const suffixedTopic = `${topic}#g${(generation += 1)}`;
    // Capture the instance being built so the async subscribe callback can tell
    // whether it still owns the current channel. A fast hidden->visible flip
    // rebuilds the channel; the OLD channel's delayed teardown-CLOSED can still be
    // in flight after the rebuild reset suppressClosedOnce, and would otherwise be
    // misread as a genuine 'errored' against the NEW channel's health.
    const thisChannel = supabase.channel(suffixedTopic);
    for (const binding of bindings) {
      thisChannel.on<Row>(
        'postgres_changes',
        {
          event: binding.event,
          schema: binding.schema,
          table: binding.table,
          filter: binding.filter,
        },
        (payload) => {
          lastEventAt = Date.now();
          // A delivered event IS liveness proof. If a flap (or a watchdog
          // false-positive) had degraded us to 'errored', recover to 'healthy':
          // reportHealth then clears the pending resubscribe countdown so we do
          // not needlessly tear down a channel that is actually delivering.
          if (currentHealth === 'errored') reportHealth('healthy');
          binding.handler(payload);
        },
      );
    }
    thisChannel.subscribe((status) => {
      if (unsubscribed) return;
      // Swallow the single CLOSED our own visibility teardown produces so
      // health stays 'paused' (see suppressClosedOnce above).
      if (status === 'CLOSED' && suppressClosedOnce) {
        suppressClosedOnce = false;
        return;
      }
      // Identity guard: a status delivered late for a channel we already
      // replaced (fast hidden->visible rebuild) must not touch the current
      // channel's health -- otherwise the old teardown-CLOSED spuriously errors.
      if (channel !== thisChannel) return;
      // Status values: SUBSCRIBED | TIMED_OUT | CLOSED | CHANNEL_ERROR | (transient others)
      if (status === 'SUBSCRIBED') {
        // A fresh join is itself a delivery signal -- reset the watchdog clock so
        // it cannot instantly re-trip right after a resubscribe.
        lastEventAt = Date.now();
        reportHealth('healthy');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        reportHealth('errored');
      }
    });
    return thisChannel;
  };

  const teardown = async (): Promise<void> => {
    if (channel === null) return;
    const c = channel;
    channel = null;
    await supabase.removeChannel(c);
  };

  // A resubscribe must not fire once the subscription is torn down ('unsubscribed'),
  // while the tab is hidden ('paused'), or after the channel recovered ('healthy').
  // Read as a nested predicate so both call sites re-evaluate the live values fresh
  // -- a read inside this function is not subject to the caller's control-flow
  // narrowing, so the after-await re-check sees a concurrent hide/recovery.
  const shouldStopResubscribe = (): boolean =>
    unsubscribed || currentHealth === 'healthy' || currentHealth === 'paused';

  // R2b: tear the dead channel down and rebuild, then arm the next attempt with
  // capped exponential backoff. Fired by the resubscribe timer (see reportHealth).
  const attemptResubscribe = async (): Promise<void> => {
    resubscribeTimer = null;
    // A recovery, a hidden tab, or a teardown already cleared the timer; guard
    // defensively against a fire that raced past that.
    if (shouldStopResubscribe()) return;

    // AWAIT the teardown before rebuilding. removeChannel only unregisters the
    // channel after its phx_leave ack resolves, so building before that returns
    // would race the leave. The generation-suffixed topic already makes
    // re-acquiring the leaving instance impossible; awaiting keeps the leave->build
    // ordering clean and gives us the re-check point below. We deliberately do NOT
    // arm suppressClosedOnce here (that is reserved for the visibility teardown,
    // which stays 'paused'); the identity guard makes the torn-down channel's late
    // status callbacks inert.
    await teardown();
    // cleanup() (unsubscribed) or a visibility hide ('paused') may have run while we
    // awaited the leave; a late recovery could have flipped us back to 'healthy'. In
    // any of those cases we must NOT rebuild -- resurrecting a channel after
    // unsubscribe, while hidden, or after a recovery would all be wrong.
    if (shouldStopResubscribe()) return;
    channel = buildChannel();

    // Arm the next attempt in case this rebuild also fails to reach SUBSCRIBED.
    // A successful SUBSCRIBED resets backoffMs and clears this timer.
    resubscribeTimer = window.setTimeout(() => void attemptResubscribe(), backoffMs);
    backoffMs = Math.min(backoffMs * 2, RESUBSCRIBE_BACKOFF_MAX_MS);
  };

  // R2c delivery watchdog: only meaningful when a consumer opted in via
  // `expectDelivery`. Runs on an interval and degrades a silently-dead channel.
  const checkDelivery = (): void => {
    if (unsubscribed) return;
    if (expectDelivery === undefined) return;
    if (currentHealth !== 'healthy') return;
    if (lastEventAt === null) return;
    if (!expectDelivery()) return;
    if (Date.now() - lastEventAt <= DELIVERY_TIMEOUT_MS) return;
    // Channel reads SUBSCRIBED but has delivered nothing past the timeout while
    // the consumer expected events. Degrade so the poll fallback (#435) and the
    // R2b resubscribe both take over. The health gate limits this to one warn
    // per healthy window; a sustained dead-but-joinable outage (each rebuild
    // reaches SUBSCRIBED yet delivers nothing) therefore warns roughly once per
    // rebuild cycle -- about every 35s (15s countdown + 20s timeout) -- by design.
    console.warn(
      '[realtime] delivery watchdog: channel is SUBSCRIBED but has delivered no events ' +
        "past the delivery timeout while delivery was expected; degrading to 'errored' so " +
        'the poll fallback and resubscribe take over.',
    );
    reportHealth('errored');
  };

  // R2c: arm/disarm the watchdog interval. Guarded on `window` so a node-only
  // (non-happy-dom) context can't crash on the timer API, and idempotent so
  // repeated arm calls (mount + resume) never stack intervals.
  const startDeliveryWatchdog = (): void => {
    if (deliveryCheckInterval !== null) return;
    if (expectDelivery === undefined || typeof window === 'undefined') return;
    deliveryCheckInterval = window.setInterval(checkDelivery, DELIVERY_CHECK_INTERVAL_MS);
  };

  const stopDeliveryWatchdog = (): void => {
    if (deliveryCheckInterval === null) return;
    window.clearInterval(deliveryCheckInterval);
    deliveryCheckInterval = null;
  };

  // Visibility handler -- only wired in real browsers. SSR / vitest-happy-dom
  // both expose `document` so the typeof check is enough to keep node-only
  // test contexts safe.
  const handleVisibility = (): void => {
    if (typeof document === 'undefined') return;
    // keepAliveWhenHidden channels (live-performance, issue #452) are never torn
    // down on hide: bail before any teardown, 'paused' report, or watchdog stop --
    // and the visible branch is skipped too, because the channel was never closed.
    // A consequence worth stating: health can therefore never read 'paused' on this
    // channel, so shouldStopResubscribe() never latches on 'paused'. If the channel
    // errors while hidden, the R2b errored->resubscribe chain runs in the background
    // and self-heals automatically. One caveat: deep-background timer throttling can
    // delay the heartbeat and drop the channel; that same errored->resubscribe chain
    // rebuilds it, and the tab-return catch-up (#448) stays the safety net for any
    // events missed in between.
    if (keepAliveWhenHidden === true) return;
    if (document.visibilityState === 'hidden') {
      reportHealth('paused');
      // Arm the CLOSED suppressor BEFORE teardown so the resulting CLOSED does
      // not overwrite 'paused' with 'errored' and wake the polling fallback.
      suppressClosedOnce = true;
      // A hidden tab expects no delivery -- disarm the watchdog so a background
      // tab holds no timer (mirrors the channel teardown below).
      stopDeliveryWatchdog();
      void teardown();
    } else {
      // Visible branch. If the async initialize() below has not built the first
      // channel yet (a `visible` event landed while it was awaiting session
      // hydration), do nothing: initialize() owns that first build and would
      // otherwise race a second one here (a double subscribe). Once initialized,
      // a null channel means a hide tore it down -- rebuild and re-arm the watchdog.
      if (!initialized) return;
      if (channel === null) {
        channel = buildChannel();
        // Re-arm the watchdog for the freshly rebuilt channel on resume.
        startDeliveryWatchdog();
      }
    }
  };

  // Build the first channel only after the auth session has hydrated. On a fresh
  // page load the cookie session is not yet available when this runs; joining at
  // that moment registers the subscription with ANON claims, and RLS then delivers
  // nothing -- permanently, because join-time claims stick to the subscription and
  // a later socket-level setAuth does not upgrade them (live-verified, issue #456).
  // Rebuild paths (visibility resume, R2b resubscribe) reuse buildChannel directly:
  // by the time they run the socket token is long since set.
  const initialize = async (): Promise<void> => {
    try {
      const { data } = await supabase.auth.getSession();
      if (unsubscribed) return;
      const token = data.session?.access_token;
      if (token !== undefined) await supabase.realtime.setAuth(token);
      if (unsubscribed) return;
      // Init-window visibility race: the tab may have hidden WHILE we awaited
      // hydration. For a default-teardown channel, handleVisibility already reported
      // 'paused' and skipped its teardown (the channel was still null). Building now
      // would leave a live channel open in a hidden tab with the delivery watchdog
      // off, and the visible-return branch -- seeing channel !== null -- would neither
      // rebuild nor arm the watchdog. So skip the build here: mark initialized and
      // leave the channel null; the visible-return branch then builds the channel AND
      // arms the watchdog. keepAlive channels build unconditionally (they never tear
      // down or rebuild on visibility, so there is no return path to defer to).
      const hiddenNow = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (keepAliveWhenHidden !== true && hiddenNow) {
        initialized = true;
        return;
      }
      channel = buildChannel();
      initialized = true;
    } catch (error) {
      // Session hydration failed (getSession / setAuth rejected). Degrade to
      // 'errored' so the R2b loop recovers: reportHealth('errored') arms the ~15s
      // countdown, then attemptResubscribe tears down (a no-op while channel is null)
      // and buildChannel()s a fresh channel. By then supabase-js's own accessToken
      // bridge has set the socket token, so the rebuilt channel joins authenticated.
      // Mark initialized so the visible-return branch can also recover if it runs.
      console.warn(
        '[realtime] initial session hydration failed; degrading to errored so the ' +
          'resubscribe loop can recover.',
        error,
      );
      initialized = true;
      reportHealth('errored');
    }
  };
  void initialize();

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  // R2c: arm the watchdog for the initial channel (a no-op unless a consumer
  // opted in and `window` exists). Safe to arm before initialize() finishes:
  // checkDelivery is a no-op while lastEventAt is null (no channel has delivered
  // or subscribed yet). Likewise no R2b resubscribe timer can be armed before the
  // first build -- health starts at 'connecting' and nothing has reported 'errored'.
  startDeliveryWatchdog();

  const cleanup = (): void => {
    unsubscribed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    clearResubscribeTimer();
    stopDeliveryWatchdog();
    void teardown();
  };

  return { cleanup };
}

/**
 * Subscribe to postgres_changes on `public.sync_logs` filtered by
 * `organization_id`. Org-wide subscription — used by the dashboard-shell
 * OrgSyncsProvider so a single channel surfaces every sync across every
 * store the user can see in the active org.
 *
 * The initial channel build waits for the auth session to hydrate before joining
 * (issue #456): on a fresh page load the cookie session is not yet loaded, and
 * joining then would register the subscription with anon claims that RLS silently
 * mutes forever. See {@link createChannelLifecycle} for the mechanism.
 *
 * The `can_access_store(store_id)` RLS policy on sync_logs (a SECURITY DEFINER
 * STABLE plain-function call) lets Realtime's postgres_changes evaluator gate
 * rows without a cross-table walk. Note this is a per-STORE grant check, not a
 * bare org-membership check: the client channel filters by organization_id for
 * efficiency, but RLS is the actual boundary — a MEMBER/VIEWER receives events
 * only for the stores they were granted, and the client filter is not itself a
 * security boundary.
 *
 * **Connection lifecycle.** Supabase's Realtime client retries the
 * underlying WebSocket on its own, but the per-channel subscription
 * status drives the consumer's polling-fallback decision. We translate
 * the four meaningful states into a `RealtimeHealth` union and push
 * them through `onHealthChange`:
 *
 *   - `connecting` — initial state until SUBSCRIBED arrives.
 *   - `healthy`    — the channel is live and delivering events. Polling
 *                    should be off.
 *   - `errored`    — CHANNEL_ERROR / TIMED_OUT / CLOSED from a genuine
 *                    drop. Polling fills in until the next SUBSCRIBED.
 *   - `paused`     — we explicitly removed the channel because the tab
 *                    is hidden (see visibility handling below). Polling
 *                    is also off because nobody is watching, and it
 *                    STAYS `paused` — the CLOSED that `removeChannel`
 *                    triggers is swallowed (see `suppressClosedOnce`) so
 *                    it can't flip the tab back to `errored` and wake the
 *                    fallback in a hidden tab.
 *
 * **Tab visibility.** Browsers throttle background tabs aggressively;
 * we go further and tear the channel down entirely on `visibilitychange`
 * (`hidden`), then re-subscribe on `visible`. Saves WebSocket overhead
 * for the common case of a merchant leaving the dashboard in a
 * background tab — and frees the consumer's polling-gate logic from
 * trying to distinguish "channel is up but tab is dormant" from
 * "channel is up and we're watching." Because teardown makes supabase-js
 * emit one CLOSED, we arm `suppressClosedOnce` before removing the
 * channel so health remains `paused` rather than briefly reading
 * `errored`. The live-performance channel makes the opposite choice
 * (`keepAliveWhenHidden: true`, see {@link subscribeToLivePerformance}): it
 * stays open while hidden because a merchant may be watching a window Chrome
 * has misreported as hidden — this org-syncs channel keeps the teardown because
 * its freshness is not time-critical.
 *
 * Returns an unsubscribe function. Caller calls on unmount;
 * OrgSyncsProvider does this in its cleanup.
 */
export function subscribeToOrgSyncs(
  orgId: string,
  options: SubscribeToOrgSyncsOptions,
): () => void {
  const { onEvent, onHealthChange, expectDelivery } = options;
  return createChannelLifecycle<SyncLogsRowWire>({
    topic: `sync_logs:org:${orgId}`,
    bindings: [
      {
        event: '*',
        schema: 'public',
        table: 'sync_logs',
        filter: `organization_id=eq.${orgId}`,
        handler: (payload) => {
          const eventType = payload.eventType;
          if (eventType === 'DELETE') {
            // With sync_logs at REPLICA IDENTITY DEFAULT the deleted row carries only
            // the PK, so postgres_changes cannot evaluate the organization_id filter
            // against it — in practice this branch does not fire. Kept as defense in
            // depth; stale deleted rows are reconciled by the polling fallback.
            const oldRow = payload.old as Partial<SyncLogsRowWire>;
            if (oldRow.id === undefined) return;
            onEvent({ eventType: 'DELETE', id: oldRow.id, row: null });
            return;
          }
          // R2d wire cast guard: validate the fields this patch keys on before
          // mapping the row. A malformed row (a logical-decoding drift) is
          // skipped and the trickle poll reconciles it; we warn once so the
          // drift is diagnosable. Replaces the former `payload.new as` cast.
          const newRow = payload.new;
          if (!isPatchableSyncLogsRow(newRow)) {
            if (!warnedMalformedSyncLogsRow) {
              warnedMalformedSyncLogsRow = true;
              console.warn(
                '[realtime] sync_logs cache patch skipped: an INSERT/UPDATE arrived with a ' +
                  'malformed row (missing/non-string id or non-string status); the trickle ' +
                  'poll will reconcile it. Suppressing further warnings for this page session.',
              );
            }
            return;
          }
          onEvent({
            eventType,
            id: newRow.id,
            row: snakeToCamel(newRow),
          });
        },
      },
    ],
    onHealthChange,
    expectDelivery,
  }).cleanup;
}

// One-time diagnostic: the generic constraint below is COMPILE-TIME only. If a
// live Realtime payload drifts (a replica-identity change, a column rename, a
// schema migration) so `order_date` is not a string, `isBusinessToday` fails
// closed and EVERY new-order toast on the channel is silently suppressed. We warn
// once so that whole-channel outage is diagnosable from the console — naming only
// the table, never any payload contents (no PII).
let warnedNonStringOrderDate = false;

/**
 * Map a postgres_changes payload to a new-order event, or null when the event
 * is not an INSERT. Extracted so the INSERT-narrowing is unit-testable without
 * mocking a Realtime channel. The INSERT discriminant gives `payload.new: T`.
 *
 * Carries `orderDate` (the row's `order_date` — both `orders` and
 * `live_performance_buffer` wire shapes have it) so the notifier can drop
 * past-day inserts (midnight buffer flush, historical backfill) BEFORE they
 * enter the coalesce window — those must never trigger a "N new orders" burst.
 *
 * Fail-closed mode: the `order_date` type is only guaranteed at compile time. If
 * a drifted payload delivers a non-string value we still return the event with
 * the raw value — `isBusinessToday` then classifies it as not-today and drops the
 * toast — but we emit a one-time console warning first, because in that state the
 * gate suppresses the ENTIRE channel's toasts until the wire shape is restored.
 */
export function newOrderInsertEvent<T extends { id: string; order_date: string }>(
  table: 'orders' | 'buffer',
  payload: RealtimePostgresChangesPayload<T>,
): { table: 'orders' | 'buffer'; id: string; orderDate: string } | null {
  if (payload.eventType !== 'INSERT') return null;
  const orderDate = payload.new.order_date;
  if (typeof orderDate !== 'string' && !warnedNonStringOrderDate) {
    warnedNonStringOrderDate = true;
    console.warn(
      `[realtime] new-order toasts suppressed: '${table}' INSERT arrived with a non-string ` +
        'order_date; the business-day gate now fails closed for this channel until the wire ' +
        'shape is restored.',
    );
  }
  return { table, id: payload.new.id, orderDate };
}

export interface SubscribeToLivePerformanceOptions {
  /**
   * Fires on any relevant row change. The live-performance aggregates
   * (KPIs, chart, missing-cost, top-products, orders) are all derived
   * server-side, so the consumer can't reconstruct them from a single row —
   * it invalidates and refetches rather than reading the payload. That's why
   * this callback carries no row data (unlike the sync_logs subscription).
   */
  onEvent: () => void;
  /** Fires ONLY on a buffer/orders INSERT -- a genuinely new order for the toast.
   *  `orderDate` is the row's business date so the consumer can drop past-day
   *  inserts before they count toward a coalesce burst. */
  onNewOrder?: (event: { table: 'orders' | 'buffer'; id: string; orderDate: string }) => void;
  onHealthChange?: (health: RealtimeHealth) => void;
}

/**
 * Subscribe to the two tables that drive a store's live-performance surface,
 * both filtered by `store_id`:
 *
 *   - `live_performance_buffer` (event `*`) — a cost-missing order arriving
 *     (INSERT) or a cost being attached (UPDATE PENDING → PROMOTING). Refreshes
 *     the missing-cost list + orders feed. NOTE: promotion completion is NOT
 *     observed here — the buffer table is REPLICA IDENTITY DEFAULT (tenant-
 *     isolation fix, see supabase/sql/realtime-publications.sql), so its DELETE
 *     old-row carries only the PK and never matches the store_id filter. That is
 *     intentional: the promotion refresh rides on the orders INSERT below.
 *   - `orders` (event `INSERT`) — a brand-new fully-calculable order written
 *     straight to `orders` (cost already known, never buffered), or the
 *     promote worker writing a promoted order (the promotion-complete signal).
 *     Refreshes KPIs + top-products + orders feed.
 *
 * Shares {@link subscribeToOrgSyncs}'s client/auth setup: browser Supabase
 * client, and health reported through `onHealthChange` so the consumer can gate a
 * polling fallback. Like every channel through {@link createChannelLifecycle}, the
 * initial build waits for the auth session to hydrate and sets the socket token
 * once before joining, so a fresh page load never subscribes with anon claims that
 * RLS would silently mute (issue #456).
 *
 * DIFFERS from subscribeToOrgSyncs on tab visibility: this channel passes
 * `keepAliveWhenHidden: true`, so there is NO visibility teardown — it stays open
 * in a hidden/background tab and keeps delivering events so live toasts never
 * stop. This is the fix for issue #452: Chrome can misreport a fully-visible
 * second-monitor window as `hidden` when another app holds focus, and the old
 * teardown then killed the live toast stream while the merchant was actively
 * watching the panel. Health therefore never reads `paused` on this channel. The
 * cost of a background-open socket is the accepted trade; the tab-return catch-up
 * (#448) still backfills anything missed if the channel does drop. Returns an
 * unsubscribe function.
 *
 * Single store channel: `live-performance:${storeId}`.
 */
export function subscribeToLivePerformance(
  storeId: string,
  options: SubscribeToLivePerformanceOptions,
): () => void {
  const { onEvent, onNewOrder, onHealthChange } = options;
  return createChannelLifecycle<BufferRowWire | OrdersRowWire>({
    topic: `live-performance:${storeId}`,
    bindings: [
      {
        event: '*',
        schema: 'public',
        table: 'live_performance_buffer',
        filter: `store_id=eq.${storeId}`,
        handler: (payload) => {
          const event = newOrderInsertEvent('buffer', payload);
          if (event !== null) onNewOrder?.(event);
          onEvent();
        },
      },
      {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
        filter: `store_id=eq.${storeId}`,
        handler: (payload) => {
          const event = newOrderInsertEvent('orders', payload);
          if (event !== null) onNewOrder?.(event);
          onEvent();
        },
      },
    ],
    onHealthChange,
    keepAliveWhenHidden: true,
  }).cleanup;
}
