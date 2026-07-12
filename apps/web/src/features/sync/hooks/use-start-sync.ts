'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';

import { orgSyncKeys } from '@/features/sync/query-keys';
import { ApiError } from '@/lib/api-error';

import { type SyncLog } from '../api/list-org-sync-logs.api';
import { startSync, type StartSyncResponse, type TriggerSyncType } from '../api/start-sync.api';
import { type OrgSyncsCache } from '../lib/org-syncs-cache';

/**
 * The mutation result augmented with the manual-trigger cooldown deadline.
 * `cooldownUntil` is an epoch-ms timestamp when the cooldown expires, or
 * `null` when no cooldown is active. It is set from the `Retry-After` on
 * the last 429 RATE_LIMITED response and cleared once a trigger succeeds.
 * It intentionally does NOT tick — the SyncControl's cooldown action leaf
 * derives the live remaining seconds via `useNow`, so that 1 Hz cooldown
 * re-render stays confined to that leaf and only while a cooldown is active. The
 * freshness label no longer ticks at all (usePageSyncSnapshot latches `now` at
 * mount), so no per-second subscription reaches the page client.
 */
export type StartSyncResult = UseMutationResult<StartSyncResponse, Error, void> & {
  cooldownUntil: number | null;
};

/**
 * Generic manual-sync trigger for any triggerable sync type. Kicks off a
 * marketplace sync for the given (store, syncType) and returns the new SyncLog
 * id immediately (the worker runs the actual sync in the background).
 *
 * On success, writes an optimistic PENDING row directly into the org-wide
 * sync-logs cache so the SyncControl transitions within the same React commit
 * as the click — no flicker between "user clicked" and "active sync visible".
 * Realtime delivers the canonical RUNNING row a beat later
 * (typically <1 s); the subsequent invalidateQueries reconciles in case
 * Realtime missed the INSERT for any reason.
 *
 * The OrgSyncsProvider (mounted in the dashboard layout) owns the cache for
 * `orgSyncKeys.list(orgId)`, so writing/invalidating it propagates to every
 * consumer of `useStoreSyncs` / `useOrgSyncs`.
 *
 * Errors fall through to the global onError pipeline (translates the code →
 * toast). 409 SYNC_IN_PROGRESS surfaces as "Senkronizasyon zaten çalışıyor";
 * 429 RATE_LIMITED sets `cooldownUntil` from Retry-After without toasting a
 * second time (the global layer already localizes RATE_LIMITED).
 */
export function useStartSync(
  orgId: string | null,
  storeId: string | null,
  syncType: TriggerSyncType,
): StartSyncResult {
  const queryClient = useQueryClient();
  // Epoch-ms deadline for the manual-trigger cooldown, captured from the
  // last 429 Retry-After. `null` when no cooldown is active.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const mutation = useMutation<StartSyncResponse, Error, void>({
    mutationFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useStartSync called without orgId/storeId');
      }
      return startSync(orgId, storeId, syncType);
    },
    onSuccess: (data) => {
      // A trigger that actually enqueued clears any prior cooldown.
      setCooldownUntil(null);
      if (orgId === null || storeId === null) return;
      const queryKey = orgSyncKeys.list(orgId);
      queryClient.setQueryData<OrgSyncsCache | undefined>(queryKey, (existing) => {
        const optimistic: SyncLog = {
          id: data.syncLogId,
          organizationId: orgId,
          storeId,
          syncType,
          status: 'PENDING',
          startedAt: data.enqueuedAt,
          completedAt: null,
          recordsProcessed: 0,
          progressCurrent: 0,
          progressTotal: null,
          progressStage: null,
          errorCode: null,
          errorMessage: null,
          attemptCount: 0,
          nextAttemptAt: null,
          skippedPages: null,
        };
        const base = existing ?? { logs: [], freshness: [] };
        const withoutDup = base.logs.filter((s) => s.id !== data.syncLogId);
        return { logs: [optimistic, ...withoutDup], freshness: base.freshness };
      });
      // Reconcile with the canonical row once Realtime/REST surfaces it.
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      // 429 RATE_LIMITED carries a Retry-After (seconds). Capture the
      // absolute expiry so the SyncControl trigger button can render a live
      // countdown and disable itself. We do NOT toast here — the global
      // MutationCache onError already localizes RATE_LIMITED (error
      // contract: one toast, from the global layer).
      if (
        error instanceof ApiError &&
        error.code === 'RATE_LIMITED' &&
        error.retryAfterSeconds !== undefined
      ) {
        setCooldownUntil(Date.now() + error.retryAfterSeconds * 1000);
      }
    },
  });

  return Object.assign(mutation, { cooldownUntil });
}
