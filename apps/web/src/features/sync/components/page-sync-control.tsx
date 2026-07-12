'use client';

import type { SyncStatus, SyncType } from '@pazarsync/db/enums';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { SyncControl } from '@/components/patterns/sync-control';
import {
  SyncSourcesPopover,
  type SyncOtherFlowVM,
  type SyncSourceRowVM,
} from '@/components/patterns/sync-sources-popover';
import { useCurrentScope } from '@/providers/current-scope';

import { type TriggerSyncType } from '../api/start-sync.api';
import { PAGE_SYNC_SOURCES, type PageSyncKey } from '../config/page-sync-sources';
import { useFlowsSettled } from '../hooks/use-flows-settled';
import { useJustSynced } from '../hooks/use-just-synced';
import { usePageSyncSnapshot } from '../hooks/use-page-sync-snapshot';
import { useStartSync, type StartSyncResult } from '../hooks/use-start-sync';
import { useFormatSyncError } from '../lib/format-sync-error';
import { useOrgSyncs } from '../providers/org-syncs-provider';

interface PageSyncControlProps {
  pageKey: PageSyncKey;
  onOpenHistory: () => void;
  /**
   * Fired once each time a page-source sync flow leaves the active set with a
   * COMPLETED final status. Wires the page's query-cache invalidation (the job
   * the removed manual "Yenile" button used to do) so the list/KPI refresh the
   * moment a sync finishes. Optional — surfaces without extra caches omit it.
   */
  onFlowsSettled?: () => void;
}

/** The four user-triggerable sync surfaces (mirrors TriggerSyncType). */
function isTriggerable(type: SyncType): type is TriggerSyncType {
  return type === 'ORDERS' || type === 'PRODUCTS' || type === 'SETTLEMENTS' || type === 'CLAIMS';
}

/** SyncStatus → the popover's coarse "other flow" state. deriveOthers only ever
 *  emits active/retrying/failed rows; COMPLETED is unreachable but kept in the
 *  lookup so the mapping stays total over SyncStatus. */
const OTHER_STATUS_VM: Record<SyncStatus, SyncOtherFlowVM['status']> = {
  PENDING: 'active',
  RUNNING: 'active',
  FAILED_RETRYABLE: 'retrying',
  FAILED: 'failed',
  COMPLETED: 'active',
};

/**
 * The unified per-page sync-freshness control. Wraps the presentation-only
 * SyncControl + SyncSourcesPopover with the page's live data: it derives the
 * page's view model via usePageSyncSnapshot and wires the "Eşitle" button to the
 * page's config-driven trigger types.
 *
 * Four unconditional useStartSync instances (a static count — no React rules
 * violation) give every triggerable type its own manual-trigger mutation; the
 * "Eşitle" button fires each of the page's `triggerTypes` that is not already in
 * flight or in cooldown (proactive skip → no 409/429 noise), and pages whose
 * `triggerTypes` is empty (dashboard / profitability) drop the action half.
 *
 * orgId + active store come from the same CurrentScope the pages already read;
 * the store list resolves the "rest of the panel" flow names in the popover.
 */
export function PageSyncControl({
  pageKey,
  onOpenHistory,
  onFlowsSettled,
}: PageSyncControlProps): React.ReactElement {
  const t = useTranslations('syncControl');
  const formatSyncError = useFormatSyncError();
  const { org, store, accessibleStores } = useCurrentScope();
  const { activeSyncs, recentSyncs } = useOrgSyncs();

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

  const vm = usePageSyncSnapshot(pageKey);
  const spec = PAGE_SYNC_SOURCES[pageKey];

  // The page's config-driven manual-trigger set, filtered to the triggerable
  // union for type-safe indexing. Empty (dashboard / profitability) → no action.
  const triggerTypes = React.useMemo<TriggerSyncType[]>(
    () => spec.triggerTypes.filter(isTriggerable),
    [spec],
  );

  // Transient "everything updated" confirmation: raised when a page-source flow
  // settles COMPLETED (below), cleared the instant a new run starts (state
  // 'syncing') and after its own TTL. Even trigger-less pages (dashboard /
  // profitability) surface it when a background flow finishes.
  const { justSynced, markSynced } = useJustSynced(vm.control.state === 'syncing');

  // The page's full source set (primary ∪ secondary) scoped to the active store
  // — onFlowsSettled watches ALL of these, including background flows that are
  // not manually triggerable, so a settlement finishing off-screen still
  // refreshes the page.
  const pageSourceTypes = React.useMemo<Set<SyncType>>(
    () => new Set<SyncType>([...spec.primary, ...spec.secondary]),
    [spec],
  );
  // A settled flow both raises the local confirmation flag AND runs the page's
  // cache invalidation — the existing onFlowsSettled chain is untouched.
  const handleFlowsSettled = React.useCallback((): void => {
    markSynced();
    onFlowsSettled?.();
  }, [markSynced, onFlowsSettled]);
  useFlowsSettled({
    storeId,
    pageSourceTypes,
    activeSyncs,
    recentSyncs,
    onFlowsSettled: handleFlowsSettled,
  });

  const storeNameById = new Map<string, string>();
  for (const s of accessibleStores) storeNameById.set(s.id, s.name);

  const sources: SyncSourceRowVM[] = vm.sources.map((row) => ({
    syncType: row.syncType,
    state: row.state,
    lastSyncedAt: row.lastSyncedAt,
    progress: row.progress,
    nextAttemptAt: row.nextAttemptAt,
    errorLabel: formatSyncError(row.errorCode)?.title ?? null,
  }));

  const others: SyncOtherFlowVM[] = vm.others.map((flow) => ({
    storeName: storeNameById.get(flow.storeId) ?? null,
    domainLabel: t(`domain.${flow.syncType}`),
    status: OTHER_STATUS_VM[flow.status],
    progress: flow.progress,
  }));

  // Aggregate cooldown: the action is cooldown-disabled only when EVERY trigger
  // type is cooling. Passing the earliest-freeing deadline lets the
  // presentational SyncControl derive both the disabled window and the
  // remaining-seconds title from its own useNow (the min deadline = when the
  // first type frees = when the button re-enables).
  const cooldownDeadlines = triggerTypes.map((type) => triggerByType[type].cooldownUntil);
  const allInCooldown = triggerTypes.length > 0 && cooldownDeadlines.every((d) => d !== null);
  const cooldownUntil = allInCooldown
    ? Math.min(...cooldownDeadlines.filter((d): d is number => d !== null))
    : null;
  const anyPending = triggerTypes.some((type) => triggerByType[type].isPending);

  function handleSync(): void {
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

  return (
    <SyncControl
      state={vm.control.state}
      lastSyncedAt={vm.control.lastSyncedAt}
      now={vm.now ?? undefined}
      progress={vm.control.progress}
      nextAttemptAt={vm.control.nextAttemptAt}
      onSync={handleSync}
      syncPending={anyPending}
      cooldownUntil={cooldownUntil}
      successLabel={justSynced ? t(`justSynced.${pageKey}`) : null}
      hideAction={triggerTypes.length === 0}
    >
      <SyncSourcesPopover
        title={t(`pageData.${pageKey}`)}
        storeName={store?.name ?? null}
        sources={sources}
        others={others}
        scheduleLabel={t(`schedule.${pageKey}`)}
        now={vm.now ?? undefined}
        onOpenHistory={onOpenHistory}
      />
    </SyncControl>
  );
}
