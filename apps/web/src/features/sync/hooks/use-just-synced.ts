'use client';

import * as React from 'react';

/**
 * How long the transient post-sync confirmation ("Tüm siparişleriniz
 * güncellendi") stays up before the control falls back to its normal
 * elapsed-time label.
 */
export const JUST_SYNCED_TTL_MS = 90_000;

export interface UseJustSyncedResult {
  /** True while the transient confirmation should replace the elapsed-time label. */
  justSynced: boolean;
  /** Raise the confirmation — wire to the moment a page flow settles COMPLETED. */
  markSynced: () => void;
}

/**
 * Drives the transient "everything updated" confirmation on the sync control.
 *
 * - `markSynced()` (wired to the moment a page-source flow settles COMPLETED)
 *   raises the flag.
 * - It clears itself `JUST_SYNCED_TTL_MS` after the last mark, so the control
 *   naturally reverts to the elapsed-time label.
 * - Passing `isSyncing = true` (a fresh run is in flight) drops the flag
 *   immediately — a new sync outranks the previous confirmation. Derived rather
 *   than stored so no extra effect / cascading render is needed; the next
 *   completion re-arms it via `markSynced`.
 *
 * `Date.now()` lives only in the `markSynced` handler, and the auto-expire write
 * lives in the timer callback — never synchronously in an effect body (React
 * Compiler flags that as a cascading render).
 */
export function useJustSynced(isSyncing: boolean): UseJustSyncedResult {
  const [syncedAt, setSyncedAt] = React.useState<number | null>(null);

  const markSynced = React.useCallback((): void => {
    setSyncedAt(Date.now());
  }, []);

  // Auto-expire: revert to the normal label a TTL after the latest mark. Each
  // mark re-anchors `syncedAt`, so the effect re-runs and restarts the timer.
  React.useEffect(() => {
    if (syncedAt === null) return undefined;
    const timer = setTimeout(() => setSyncedAt(null), JUST_SYNCED_TTL_MS);
    return () => clearTimeout(timer);
  }, [syncedAt]);

  return { justSynced: syncedAt !== null && !isSyncing, markSynced };
}
