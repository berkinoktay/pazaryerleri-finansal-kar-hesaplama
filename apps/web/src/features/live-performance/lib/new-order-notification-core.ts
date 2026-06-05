// Pure decision logic for the global new-order notifier. No React, no timers,
// no side effects -- the provider owns the imperative shell (subscribe, fetch,
// toast, sound); this module decides WHAT to do so the decisions are unit-tested.

export interface NewOrderEvent {
  table: 'orders' | 'buffer';
  id: string;
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

/**
 * Drop a summary when it is not today's (backfill / historical) or when its
 * platformOrderNumber was already toasted this session (a promotion of an
 * already-shown buffer order, or a split-shipment repeat). Summaries with a
 * null platformOrderNumber can't be deduped by number, so they pass the dedup
 * gate (still subject to isToday).
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
