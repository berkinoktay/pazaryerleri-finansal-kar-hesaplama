'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';

import { type SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { orgSyncKeys } from '@/features/sync/query-keys';
import { ApiError } from '@/lib/api-error';

import { startProductSync, type StartSyncResponse } from '../api/start-product-sync.api';

/**
 * The mutation result augmented with the manual-trigger cooldown deadline.
 * `cooldownUntil` is an epoch-ms timestamp when the cooldown expires, or
 * `null` when no cooldown is active. It is set from the `Retry-After` on
 * the last 429 RATE_LIMITED response and cleared once a trigger succeeds.
 * It intentionally does NOT tick — the SyncCenter button derives the live
 * remaining seconds via `useNow`, so the 1 Hz re-render stays localized to
 * the sheet instead of the whole products page.
 */
export type StartProductSyncResult = UseMutationResult<StartSyncResponse, Error, void> & {
  cooldownUntil: number | null;
};

/**
 * Mutation that kicks off a Trendyol product sync. Returns the new
 * SyncLog id immediately (the BFF spawns the actual sync as a
 * background task).
 *
 * On success, writes an optimistic PENDING row directly into the
 * org-wide sync-logs cache so the SyncBadge and SyncCenter transition
 * within the same React commit as the click — no flicker between
 * "user clicked" and "active sync visible". Realtime delivers the
 * canonical RUNNING row a beat later (typically <1 s); the
 * subsequent invalidateQueries reconciles in case Realtime missed
 * the INSERT for any reason.
 *
 * The OrgSyncsProvider (mounted in the dashboard layout) owns the
 * cache for `orgSyncKeys.list(orgId)`, so writing/invalidating it
 * propagates to every consumer of `useStoreSyncs` / `useOrgSyncs`.
 *
 * Errors fall through to the global onError pipeline (translates
 * the code → toast). 409 SYNC_IN_PROGRESS surfaces as "Senkronizasyon
 * zaten çalışıyor" via `common.errors.SYNC_IN_PROGRESS` (added in
 * this PR's i18n keys).
 */
export function useStartProductSync(
  orgId: string | null,
  storeId: string | null,
): StartProductSyncResult {
  const queryClient = useQueryClient();
  // Epoch-ms deadline for the manual-trigger cooldown, captured from the
  // last 429 Retry-After. `null` when no cooldown is active.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const mutation = useMutation<StartSyncResponse, Error, void>({
    mutationFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useStartProductSync called without orgId/storeId');
      }
      return startProductSync(orgId, storeId);
    },
    onSuccess: (data) => {
      // A trigger that actually enqueued clears any prior cooldown.
      setCooldownUntil(null);
      if (orgId === null || storeId === null) return;
      const queryKey = orgSyncKeys.list(orgId);
      queryClient.setQueryData<SyncLog[] | undefined>(queryKey, (existing) => {
        const optimistic: SyncLog = {
          id: data.syncLogId,
          organizationId: orgId,
          storeId,
          syncType: 'PRODUCTS',
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
        const withoutDup = (existing ?? []).filter((s) => s.id !== data.syncLogId);
        return [optimistic, ...withoutDup];
      });
      // Reconcile with the canonical row once Realtime/REST surfaces it.
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      // 429 RATE_LIMITED carries a Retry-After (seconds). Capture the
      // absolute expiry so the SyncCenter trigger button can render a live
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
