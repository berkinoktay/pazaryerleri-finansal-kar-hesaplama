'use client';

import * as React from 'react';

import type { SyncLog } from '../api/list-org-sync-logs.api';

/**
 * Fires `onFailure(log)` once when a watched flow (the active store) transitions
 * from the active set (PENDING / RUNNING / FAILED_RETRYABLE) into a terminal
 * FAILED recent row. Mirrors useFlowsSettled's id-diff, inverted to the failure
 * case:
 *   - Only a terminal FAILED exit fires it. FAILED_RETRYABLE stays in the active
 *     set (isActive), so a between-attempts failure never leaves → never fires.
 *   - COMPLETED exits are ignored (only failures toast).
 *   - Deduped per sync-log id via a ref, so a re-claimed id that fails twice
 *     still toasts at most once.
 *   - Nothing fires on mount for a pre-existing FAILED row (it was never in the
 *     tracked active set), so historical failures never toast.
 *
 * External-system sync (surface a toast in reaction to Realtime cache state), so
 * a `useEffect` is the right tool. Store-scoped: only the active store's flows
 * are watched, and the storeId guard blocks a cross-store toast on a store switch.
 */
export function useSyncFailureToaster(params: {
  storeId: string | null;
  activeSyncs: readonly SyncLog[];
  recentSyncs: readonly SyncLog[];
  onFailure: (log: SyncLog) => void;
}): void {
  const { storeId, activeSyncs, recentSyncs, onFailure } = params;

  const activeStoreFlowIds = React.useMemo<Set<string>>(() => {
    if (storeId === null) return new Set<string>();
    return new Set(activeSyncs.filter((s) => s.storeId === storeId).map((s) => s.id));
  }, [activeSyncs, storeId]);

  const prevActiveFlowIdsRef = React.useRef<Set<string>>(new Set());
  // Ids we've already toasted a failure for — one toast per run, ever.
  const toastedRef = React.useRef<Set<string>>(new Set());
  // Keep the latest callback in a ref so its identity does not re-trigger the
  // detection effect (which must key only on the sync data).
  const onFailureRef = React.useRef(onFailure);
  React.useEffect(() => {
    onFailureRef.current = onFailure;
  }, [onFailure]);

  React.useEffect(() => {
    const prev = prevActiveFlowIdsRef.current;
    prevActiveFlowIdsRef.current = activeStoreFlowIds;
    for (const id of prev) {
      if (activeStoreFlowIds.has(id)) continue; // still active
      if (toastedRef.current.has(id)) continue; // already toasted this run
      const row = recentSyncs.find((s) => s.id === id);
      // Only a terminal FAILED for THIS store toasts (guards a store switch).
      if (row === undefined || row.status !== 'FAILED' || row.storeId !== storeId) continue;
      toastedRef.current.add(id);
      onFailureRef.current(row);
    }
  }, [activeStoreFlowIds, recentSyncs, storeId]);
}
