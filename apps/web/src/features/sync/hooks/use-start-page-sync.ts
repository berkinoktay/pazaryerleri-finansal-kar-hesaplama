'use client';

import type { SyncType } from '@pazarsync/db/enums';
import * as React from 'react';

import { useCurrentScope } from '@/providers/current-scope';

import { type TriggerSyncType } from '../api/start-sync.api';
import { PAGE_SYNC_SOURCES, type PageSyncKey } from '../config/page-sync-sources';
import { useOrgSyncs } from '../providers/org-syncs-provider';

import { useStartSync, type StartSyncResult } from './use-start-sync';

/** The four user-triggerable sync surfaces (mirrors TriggerSyncType). */
function isTriggerable(type: SyncType): type is TriggerSyncType {
  return type === 'ORDERS' || type === 'PRODUCTS' || type === 'SETTLEMENTS' || type === 'CLAIMS';
}

export interface StartPageSyncResult {
  /**
   * Fire the page's manual sync. Fires each of the page's `triggerTypes` that is
   * not already in flight (would 409) or in cooldown (would 429) — proactive
   * skip so no wasted request; remaining real errors still reach the global
   * toast. No-op when no store is selected or the page has no trigger types.
   */
  startPageSync: () => void;
  /**
   * Aggregate cooldown deadline (epoch ms): the EARLIEST-freeing type's deadline
   * when EVERY trigger type is cooling, else `null`. Lets the caller render a
   * live countdown and disable the action; the min deadline = when the first
   * type frees = when the button re-enables.
   */
  cooldownUntil: number | null;
  /** Any trigger mutation currently pending (optimistic enqueue in flight). */
  pending: boolean;
  /** Whether the page has any triggerable sync (dashboard / profitability: no). */
  hasAction: boolean;
  /** Convenience: no action to fire, or every trigger type is in cooldown. */
  disabled: boolean;
}

/**
 * The page's manual-sync trigger, extracted so BOTH the header PageSyncControl
 * and the stale-data banner fire the exact same sync path (issue #466). Four
 * unconditional useStartSync instances (a static count — no React-rules
 * violation) give every triggerable type its own manual-trigger mutation; the
 * page's config-driven `triggerTypes` select which ones the action fires.
 *
 * orgId + active store come from the CurrentScope the pages already read; the
 * org-wide active syncs gate the proactive in-flight skip.
 */
export function useStartPageSync(pageKey: PageSyncKey): StartPageSyncResult {
  const { org, store } = useCurrentScope();
  const { activeSyncs } = useOrgSyncs();

  const orgId = org.id;
  const storeId = store?.id ?? null;

  // Four fixed trigger hooks — one per triggerable sync type. The order matches
  // TriggerSyncType so the record below is exhaustive without a cast.
  const ordersSync = useStartSync(orgId, storeId, 'ORDERS');
  const productsSync = useStartSync(orgId, storeId, 'PRODUCTS');
  const settlementsSync = useStartSync(orgId, storeId, 'SETTLEMENTS');
  const claimsSync = useStartSync(orgId, storeId, 'CLAIMS');
  const triggerByType: Record<TriggerSyncType, StartSyncResult> = {
    ORDERS: ordersSync,
    PRODUCTS: productsSync,
    SETTLEMENTS: settlementsSync,
    CLAIMS: claimsSync,
  };

  const spec = PAGE_SYNC_SOURCES[pageKey];
  // The page's config-driven manual-trigger set, filtered to the triggerable
  // union for type-safe indexing. Empty (dashboard / profitability) → no action.
  const triggerTypes = React.useMemo<TriggerSyncType[]>(
    () => spec.triggerTypes.filter(isTriggerable),
    [spec],
  );

  // Aggregate cooldown: disabled only when EVERY trigger type is cooling; the
  // earliest-freeing deadline is when the action re-enables.
  const cooldownDeadlines = triggerTypes.map((type) => triggerByType[type].cooldownUntil);
  const allInCooldown = triggerTypes.length > 0 && cooldownDeadlines.every((d) => d !== null);
  const cooldownUntil = allInCooldown
    ? Math.min(...cooldownDeadlines.filter((d): d is number => d !== null))
    : null;
  const pending = triggerTypes.some((type) => triggerByType[type].isPending);
  const hasAction = triggerTypes.length > 0;

  function startPageSync(): void {
    if (storeId === null) return;
    const nowMs = Date.now();
    const activeTypes = new Set<SyncType>(
      activeSyncs.filter((s) => s.storeId === storeId).map((s) => s.syncType),
    );
    for (const type of triggerTypes) {
      // Proactively skip types already in flight (would 409 SYNC_IN_PROGRESS) or
      // in cooldown (would 429 RATE_LIMITED) — no wasted request; remaining real
      // errors still reach the global toast.
      if (activeTypes.has(type)) continue;
      const deadline = triggerByType[type].cooldownUntil;
      if (deadline !== null && deadline > nowMs) continue;
      triggerByType[type].mutate();
    }
  }

  return {
    startPageSync,
    cooldownUntil,
    pending,
    hasAction,
    disabled: !hasAction || cooldownUntil !== null,
  };
}
