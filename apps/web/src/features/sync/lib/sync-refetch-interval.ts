import type { RealtimeHealth } from '@/lib/supabase/realtime';

import type { SyncLog } from '../api/list-org-sync-logs.api';

// Slow reconcile tempo used while the Realtime channel is HEALTHY but an active
// sync is in flight. Realtime stays the fast path; this slow reconcile is the
// delivery-liveness backstop -- channel membership is not delivery proof, so a
// silently dead-but-SUBSCRIBED WAL pipe can no longer freeze the SyncCenter
// progress bar until an F5 (audit 2026-07-11).
export const RECONCILE_INTERVAL_MS = 30_000;

// Outage tempo used while the channel is errored/connecting. Faster than the
// reconcile floor because the fast path is actively degraded and the UI needs
// to catch up on its own.
export const OUTAGE_POLL_INTERVAL_MS = 10_000;

/**
 * The sync statuses that are still in flight (SyncCenter renders a live
 * progress bar for these). Single source of truth -- the provider imports this
 * rather than re-declaring the status set.
 */
export function isActive(status: SyncLog['status']): boolean {
  return status === 'PENDING' || status === 'RUNNING' || status === 'FAILED_RETRYABLE';
}

/**
 * Derive the React Query refetchInterval for the org-syncs list from the
 * current Realtime channel health and the cached rows.
 *
 * Decision table:
 *   - paused (tab hidden)   -> false. No polling while nobody is watching.
 *   - healthy               -> rows contain an active sync ? RECONCILE_INTERVAL_MS : false.
 *   - errored | connecting  -> OUTAGE_POLL_INTERVAL_MS, unconditionally.
 */
export function computeSyncRefetchInterval(
  health: RealtimeHealth,
  rows: SyncLog[] | undefined,
): number | false {
  // paused (tab hidden) -> no polling while nobody is watching anyway.
  if (health === 'paused') return false;

  if (health === 'healthy') {
    // Realtime stays the fast path; this slow reconcile is the delivery-liveness
    // backstop -- channel membership is not delivery proof (audit 2026-07-11), so
    // an active sync gets a floor poll that a dead WAL pipe cannot freeze.
    const hasActive = rows?.some((row) => isActive(row.status)) ?? false;
    return hasActive ? RECONCILE_INTERVAL_MS : false;
  }

  // errored | connecting -> poll unconditionally. Discovery of externally-started
  // syncs (cron/worker/another device) must not depend on the channel whose
  // failure this poll is guarding against, so there is no rows gate and no
  // undefined gate here.
  return OUTAGE_POLL_INTERVAL_MS;
}
