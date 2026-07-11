// Pure decision logic for the global new-order notifier. No React, no timers,
// no side effects -- the provider owns the imperative shell (subscribe, fetch,
// toast, sound); this module decides WHAT to do so the decisions are unit-tested.

import { getBusinessDate } from '@pazarsync/utils';

export interface NewOrderEvent {
  table: 'orders' | 'buffer';
  id: string;
  /** The row's `order_date`, straight off the Realtime INSERT payload. Used by
   *  {@link isBusinessToday} to drop past-day inserts before they coalesce. */
  orderDate: string;
}

/**
 * Normalize a Realtime `order_date` wire value so `new Date` yields the intended
 * instant. Two wire shapes reach here, and only one needs fixing:
 *
 *   - `orders.order_date` is a `timestamp WITHOUT time zone` column, so Postgres /
 *     supabase realtime-js emit the stored UTC wall clock with NO offset, e.g.
 *     '2026-07-08T14:00:00' (a space separator is also possible). ECMAScript
 *     parses an offset-less date-TIME value as CLIENT-LOCAL, shifting the instant
 *     by the browser's offset — on an Istanbul browser an order placed
 *     00:00-02:59 would read as YESTERDAY and its toast would be dropped (a daily
 *     recurring dead zone; also wrong for clients east of UTC+3). We stamp such
 *     values UTC so the wall clock is read as the UTC instant the column holds.
 *   - `live_performance_buffer.order_date` is a `@db.Date`, emitted date-only
 *     ('2026-07-08'). ECMAScript already parses a date-only value as UTC midnight,
 *     and the column is a business-date anchor, so we leave it untouched.
 *
 * A value that already carries an explicit offset ('Z', '+HH..', '-HH..') is
 * trusted as-is. Anything unrecognized flows through unchanged and fails closed
 * at the NaN guard in {@link isBusinessToday}.
 */
function normalizeOrderDateWire(orderDate: string): string {
  // Date-only (buffer @db.Date): ECMAScript already parses this as UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return orderDate;
  // Unify the separator so the time part is trivial to isolate.
  const withT = orderDate.includes(' ') ? orderDate.replace(' ', 'T') : orderDate;
  const tIndex = withT.indexOf('T');
  if (tIndex === -1) return orderDate; // not a datetime we recognize -> fail closed
  const timePart = withT.slice(tIndex + 1);
  // The date hyphens are behind us, so a '+' / '-' in the time part is an offset.
  if (/Z/.test(timePart) || /[+-]\d{2}/.test(timePart)) return withT;
  // Offset-less datetime = a UTC wall clock from a timestamp-without-tz column.
  return `${withT}Z`;
}

/**
 * Whether `orderDate` (a Realtime `order_date` wire value) falls in the same
 * business day as `now`, using the single business-timezone source of truth
 * ({@link getBusinessDate}) — never a hand-rolled offset. The wire value is
 * normalized first ({@link normalizeOrderDateWire}) because the orders wire is an
 * offset-less UTC wall clock (a `timestamp` column) while the buffer wire is a
 * plain business date (`@db.Date`); both must resolve to the correct Istanbul
 * business day. A non-string (schema drift; see `newOrderInsertEvent`) or an
 * unparseable date returns false so a malformed event is never toasted; data
 * invalidation runs on a separate channel, so dropping a suspect toast costs
 * nothing. This is the FIRST gate the provider applies, so a midnight buffer
 * flush or a historical backfill (both past-day) never enters the coalesce window
 * and can never trigger a "N new orders" burst.
 */
export function isBusinessToday(orderDate: string, now: Date): boolean {
  // Runtime fail-close: a non-string wire value would throw in the normalizer;
  // the compile-time constraint does not bind a drifted Realtime payload.
  if (typeof orderDate !== 'string') return false;
  const parsed = new Date(normalizeOrderDateWire(orderDate));
  if (Number.isNaN(parsed.getTime())) return false;
  return getBusinessDate(parsed) === getBusinessDate(now);
}

/**
 * The summary fields the toast / dedup decisions read. Structurally a subset of
 * the API's NewOrderNotificationSummary so the provider passes the fetched
 * object straight in.
 */
export interface NotificationSummaryLike {
  source: 'orders' | 'buffer';
  orderId: string | null;
  bufferId: string | null;
  platformOrderNumber: string | null;
  revenue: string;
  profit: string | null;
  costStatus: 'costed' | 'pending';
  isToday: boolean;
  /** Order lifecycle status for orders; null for buffer entries (not yet an
   *  order). CANCELLED / RETURNED are dropped by {@link selectSurvivors}. Typed as
   *  `string | null` (not the OrderStatus union) to stay structurally compatible
   *  with the api-client-generated summary the provider passes straight in. */
  status: string | null;
  /** True when an order graduated from the live-performance buffer (the seller
   *  already saw it) — {@link selectSurvivors} drops it. Always false for buffer. */
  isPromotion: boolean;
}

/** Max per-event summary fetches per coalesce window. Beyond this a burst is
 *  assumed (backfill / refocus storm) and one count toast is emitted instead. */
export const MAX_FETCH_PER_WINDOW = 5;

/** Minimum gap between dings (ms) -- the sound frequency cap. */
export const MIN_DING_INTERVAL_MS = 3_000;

/** Dedupe a window's raw events by id, preserving first-seen order. */
export function dedupeEvents(events: readonly NewOrderEvent[]): NewOrderEvent[] {
  const seen = new Set<string>();
  const out: NewOrderEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

export interface CoalesceDecision {
  /** 'fetch' -> fetch each id and decide per-summary; 'burst' -> too many, skip
   *  the fetches and emit a single count toast. */
  mode: 'fetch' | 'burst';
  /** Unique events to fetch (only when mode === 'fetch'). */
  toFetch: NewOrderEvent[];
  /** Total unique events in the window (drives the burst count). */
  total: number;
}

export function decideCoalesce(
  events: readonly NewOrderEvent[],
  cap: number = MAX_FETCH_PER_WINDOW,
): CoalesceDecision {
  const unique = dedupeEvents(events);
  if (unique.length > cap) {
    return { mode: 'burst', toFetch: [], total: unique.length };
  }
  return { mode: 'fetch', toFetch: unique, total: unique.length };
}

export interface SurvivorSelection {
  /** Summaries surviving the isToday + seen-set dedup, in input order. */
  survivors: NotificationSummaryLike[];
  /** platformOrderNumbers to add to the session seen-set. */
  newlySeen: string[];
}

/** Statuses that must never surface a "new order" toast: a cancelled order (or
 *  one whose very first record already dropped to RETURNED) is not a sale to
 *  celebrate. Checked against the summary's `status` (null for buffer sources,
 *  which never match). */
const NON_TOASTABLE_STATUSES: ReadonlySet<string> = new Set(['CANCELLED', 'RETURNED']);

/**
 * Drop a summary when it fails any survivor gate:
 *   - not today's (backfill / historical) — the isToday gate;
 *   - a promotion from the buffer (isPromotion) — the seller already saw this order
 *     as a cost-missing buffer entry, so its graduation into `orders` is NOT a new
 *     order even if the tab was closed when it was first buffered;
 *   - a CANCELLED / first-seen-RETURNED order — never a sale to announce;
 *   - a platformOrderNumber already toasted this session (a split-shipment repeat).
 *
 * A dropped promotion / cancelled summary is NOT added to the seen-set: only
 * survivors are recorded (via newlySeen), keeping the set from growing on rows
 * that were never toasted. Summaries with a null platformOrderNumber can't be
 * deduped by number, so they pass the dedup gate (still subject to the gates above).
 */
export function selectSurvivors(
  summaries: readonly NotificationSummaryLike[],
  seen: ReadonlySet<string>,
): SurvivorSelection {
  const survivors: NotificationSummaryLike[] = [];
  const newlySeen: string[] = [];
  const windowSeen = new Set<string>();
  for (const s of summaries) {
    if (!s.isToday) continue;
    if (s.isPromotion) continue;
    if (s.status !== null && NON_TOASTABLE_STATUSES.has(s.status)) continue;
    const num = s.platformOrderNumber;
    if (num !== null) {
      if (seen.has(num) || windowSeen.has(num)) continue;
      windowSeen.add(num);
      newlySeen.push(num);
    }
    survivors.push(s);
  }
  return { survivors, newlySeen };
}

export type ToastPlan =
  | { kind: 'none' }
  | { kind: 'single'; summary: NotificationSummaryLike }
  | { kind: 'burst'; count: number; newest: NotificationSummaryLike | null };

/**
 * From the surviving summaries, decide the toast: nothing, one rich single
 * toast, or a "N yeni siparis" burst toast. A positive `burstTotal` (from a cap
 * overflow) forces a burst even with zero fetched survivors.
 */
export function planToast(
  survivors: readonly NotificationSummaryLike[],
  burstTotal = 0,
): ToastPlan {
  if (burstTotal > 0) {
    return { kind: 'burst', count: burstTotal, newest: null };
  }
  if (survivors.length === 0) return { kind: 'none' };
  if (survivors.length === 1) {
    const only = survivors[0];
    if (only === undefined) return { kind: 'none' };
    return { kind: 'single', summary: only };
  }
  return {
    kind: 'burst',
    count: survivors.length,
    newest: survivors[survivors.length - 1] ?? null,
  };
}

/**
 * Whether to play a ding now: only when the pref is on, there is something to
 * notify, and the last ding was at least MIN_DING_INTERVAL_MS ago. `lastDingAt`
 * is null when no ding has played yet.
 */
export function shouldPlaySound(args: {
  soundEnabled: boolean;
  hasNotification: boolean;
  lastDingAt: number | null;
  now: number;
  minIntervalMs?: number;
}): boolean {
  const min = args.minIntervalMs ?? MIN_DING_INTERVAL_MS;
  if (!args.soundEnabled || !args.hasNotification) return false;
  if (args.lastDingAt === null) return true;
  return args.now - args.lastDingAt >= min;
}

/**
 * A live-performance orders row reduced to the fields the missed-order catch-up
 * needs. Structurally a subset of the API's LivePerformanceOrders row (same
 * pattern as {@link NotificationSummaryLike}): this module stays free of the
 * generated api-client type, so the provider passes a freshly-fetched row
 * straight in.
 */
export interface LiveOrderRowLike {
  source: 'orders' | 'buffer';
  orderId: string | null;
  bufferId: string | null;
  orderDate: string;
}

/**
 * The session "known orders" key for a row. Namespaced by table because an
 * `orders.id` and a `buffer.id` are distinct entities that could otherwise
 * collide as bare UUIDs. A buffer row that later graduates into `orders` gets a
 * NEW key (a different row id) and so looks like a newcomer in the diff — that is
 * INTENTIONAL: the summary's `isPromotion === true` drops it in
 * {@link selectSurvivors}, so the existing promotion gate (not this key) owns the
 * graduation dedup.
 */
export function knownOrderKey(table: 'orders' | 'buffer', id: string): string {
  return `${table}:${id}`;
}

/** The outcome of diffing a fresh live-orders list against the known-key set. */
export interface MissedOrderDiff {
  /** Rows not in `known`, as {@link NewOrderEvent}s ready for the notification
   *  window. */
  events: NewOrderEvent[];
  /** Every (batch-deduped) row's key, whether or not it became an event — the
   *  caller folds these into the known set so a later diff can't re-surface them. */
  allKeys: string[];
}

/**
 * Diff a freshly-fetched live-orders list against the session's known keys to
 * find orders that arrived while the tab was hidden (the Realtime channel is torn
 * down when hidden, so their INSERTs never reached the live notifier). Behavior:
 *
 *   - A row whose id is null (an `orders` row with a null `orderId`, or a `buffer`
 *     row with a null `bufferId` — a source/id mismatch) is SKIPPED entirely: it
 *     is neither toasted nor recorded, failing closed on a malformed row.
 *   - Rows are keyed via {@link knownOrderKey} and deduped within the batch, so a
 *     row that appears twice contributes exactly one key and at most one event.
 *   - Every surviving (deduped) key lands in `allKeys` so the caller can prime or
 *     extend the known set; only keys NOT already in `known` become `events`.
 *   - Input order is preserved verbatim. Note the backend returns the 'all' list
 *     newest-first (descending order_date), so `events` are NOT newest-last —
 *     harmless today because {@link planToast}'s only order-sensitive field
 *     (`newest`) is never read by the provider's burst path.
 */
export function diffMissedOrders(
  rows: readonly LiveOrderRowLike[],
  known: ReadonlySet<string>,
): MissedOrderDiff {
  const events: NewOrderEvent[] = [];
  const allKeys: string[] = [];
  const batchSeen = new Set<string>();
  for (const row of rows) {
    const rowId = row.source === 'orders' ? row.orderId : row.bufferId;
    if (rowId === null) continue; // fail closed: a malformed row toasts nothing
    const key = knownOrderKey(row.source, rowId);
    if (batchSeen.has(key)) continue;
    batchSeen.add(key);
    allKeys.push(key);
    if (known.has(key)) continue;
    events.push({ table: row.source, id: rowId, orderDate: row.orderDate });
  }
  return { events, allKeys };
}
