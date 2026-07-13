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

import { PAGE_SYNC_SOURCES, type PageSyncKey } from '../config/page-sync-sources';
import { useFlowsSettled } from '../hooks/use-flows-settled';
import { useJustSynced } from '../hooks/use-just-synced';
import { usePageSyncSnapshot } from '../hooks/use-page-sync-snapshot';
import { useStartPageSync } from '../hooks/use-start-page-sync';
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
 * The manual-trigger path (which types fire, the proactive in-flight / cooldown
 * skip, and the aggregate cooldown) lives in useStartPageSync — the same hook
 * the stale-data banner fires, so both buttons drive one behavior. Pages whose
 * `triggerTypes` is empty (dashboard / profitability) drop the action half.
 *
 * The active store comes from the same CurrentScope the pages already read; the
 * store list resolves the "rest of the panel" flow names in the popover.
 */
export function PageSyncControl({
  pageKey,
  onOpenHistory,
  onFlowsSettled,
}: PageSyncControlProps): React.ReactElement {
  const t = useTranslations('syncControl');
  const formatSyncError = useFormatSyncError();
  const { store, accessibleStores } = useCurrentScope();
  const { activeSyncs, recentSyncs } = useOrgSyncs();

  const storeId = store?.id ?? null;

  const vm = usePageSyncSnapshot(pageKey);
  const spec = PAGE_SYNC_SOURCES[pageKey];

  // The shared manual-sync trigger — the same path the stale-data banner fires.
  const { startPageSync, cooldownUntil, pending, hasAction } = useStartPageSync(pageKey);

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

  return (
    <SyncControl
      state={vm.control.state}
      lastSyncedAt={vm.control.lastSyncedAt}
      now={vm.now ?? undefined}
      progress={vm.control.progress}
      nextAttemptAt={vm.control.nextAttemptAt}
      onSync={startPageSync}
      syncPending={pending}
      cooldownUntil={cooldownUntil}
      successLabel={justSynced ? t(`justSynced.${pageKey}`) : null}
      hideAction={!hasAction}
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
