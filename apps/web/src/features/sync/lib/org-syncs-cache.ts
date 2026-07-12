import type { SyncLogRealtimeEvent } from '@/lib/supabase/realtime';

import type { SyncFreshness, SyncLog } from '../api/list-org-sync-logs.api';
import { isActive } from './sync-refetch-interval';

/**
 * Cap on the recent (non-active) tail kept in the org-syncs cache. Mirrors
 * the REST endpoint's recent-N so the Realtime-reconciled cache and a fresh
 * hydrate converge on the same list shape.
 */
export const RECENT_LIMIT = 5;

/**
 * In-memory shape React Query holds for the org-wide sync feature. `logs`
 * feeds activeSyncs / recentSyncs; `freshness` carries the per
 * (store, syncType) last success independent of the recent-N cap on `logs`.
 */
export interface OrgSyncsCache {
  logs: SyncLog[];
  freshness: SyncFreshness[];
}

/**
 * Reconcile a single Realtime event against the cached org-syncs state.
 * Pure: returns a new cache, never mutates the input. The two feeds are
 * reconciled independently — the log list follows the recent-N ordering
 * rules, while freshness upserts the last-success timestamp.
 */
export function applySyncLogEvent(
  cache: OrgSyncsCache,
  event: SyncLogRealtimeEvent,
): OrgSyncsCache {
  return {
    logs: applyLogEvent(cache.logs, event),
    freshness: applyFreshnessEvent(cache.freshness, event),
  };
}

/**
 * Reconcile a Realtime event against the cached log list. Active rows
 * always come first; recent rows are kept newest-first and capped at
 * RECENT_LIMIT to match the REST endpoint's response shape.
 */
function applyLogEvent(existing: SyncLog[], event: SyncLogRealtimeEvent): SyncLog[] {
  const filtered = existing.filter((log) => log.id !== event.id);

  if (event.eventType === 'DELETE' || event.row === null) {
    return filtered;
  }

  const incoming: SyncLog = {
    id: event.row.id,
    organizationId: event.row.organizationId,
    storeId: event.row.storeId,
    syncType: event.row.syncType,
    status: event.row.status,
    startedAt: event.row.startedAt,
    completedAt: event.row.completedAt,
    recordsProcessed: event.row.recordsProcessed,
    progressCurrent: event.row.progressCurrent,
    progressTotal: event.row.progressTotal,
    progressStage: event.row.progressStage,
    errorCode: event.row.errorCode,
    errorMessage: event.row.errorMessage,
    attemptCount: event.row.attemptCount,
    nextAttemptAt: event.row.nextAttemptAt,
    skippedPages: event.row.skippedPages,
  };

  const next = [...filtered, incoming];
  next.sort((a, b) => {
    const aActive = isActive(a.status);
    const bActive = isActive(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });

  // Cap the recent (non-active) tail at RECENT_LIMIT so the cache
  // doesn't grow unbounded under a high-event stream.
  const activeCount = next.findIndex((log) => !isActive(log.status));
  if (activeCount === -1) return next;
  return next.slice(0, activeCount + RECENT_LIMIT);
}

/**
 * Upsert the per (store, syncType) freshness feed from a Realtime event.
 * Only a COMPLETED row with a completedAt timestamp advances freshness, and
 * only when its completedAt is strictly newer than the stored one — so a
 * late-arriving older event can never regress the last-success timestamp.
 * DELETE and non-COMPLETED events leave freshness untouched.
 */
function applyFreshnessEvent(
  existing: SyncFreshness[],
  event: SyncLogRealtimeEvent,
): SyncFreshness[] {
  if (event.eventType === 'DELETE' || event.row === null) {
    return existing;
  }

  const { row } = event;
  if (row.status !== 'COMPLETED' || row.completedAt === null) {
    return existing;
  }

  const completedAt = row.completedAt;
  const incoming: SyncFreshness = {
    storeId: row.storeId,
    syncType: row.syncType,
    completedAt,
    recordsProcessed: row.recordsProcessed,
  };

  const current = existing.find(
    (entry) => entry.storeId === row.storeId && entry.syncType === row.syncType,
  );
  if (current === undefined) {
    return [...existing, incoming];
  }

  // A late (out-of-order) event must not roll the last-success timestamp back.
  if (Date.parse(completedAt) <= Date.parse(current.completedAt)) {
    return existing;
  }

  return existing.map((entry) =>
    entry.storeId === row.storeId && entry.syncType === row.syncType ? incoming : entry,
  );
}
