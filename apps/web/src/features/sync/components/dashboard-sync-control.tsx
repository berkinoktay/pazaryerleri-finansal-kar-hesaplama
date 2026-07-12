'use client';

import * as React from 'react';

import { SyncCenter, type SyncCenterStore } from '@/components/patterns/sync-center';
import { useCurrentScope } from '@/providers/current-scope';

import { toSyncCenterLogs } from '../lib/derive-sync-snapshot';
import { useOrgSyncs } from '../providers/org-syncs-provider';

import { PageSyncControl } from './page-sync-control';

/**
 * Dashboard freshness control. The dashboard page is a server component, so the
 * client boundary lives here: it renders the PageSyncControl and owns the
 * SyncCenter sheet it opens.
 *
 * Scope: like every PageSyncControl, the freshness pill is scoped to the ACTIVE
 * STORE — on the dashboard "Tüm veriler" means all of that store's flow types,
 * not the whole org. Other stores never drive the pill; their in-flight or
 * failing flows only surface in the popover's "Panelin geri kalanı" section
 * (the "varsayılan kapsam = seçili mağaza" principle).
 *
 * The SyncCenter sheet is the exception: it is fed the whole org's sync buckets
 * (every store) plus the accessible-store lookup, so its cross-store grouping
 * kicks in when the logs span 2+ stores.
 */
export function DashboardSyncControl(): React.ReactElement {
  const { accessibleStores } = useCurrentScope();
  const { activeSyncs, recentSyncs } = useOrgSyncs();
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);

  const logs = toSyncCenterLogs(activeSyncs, recentSyncs);
  const stores: SyncCenterStore[] = accessibleStores.map((store) => ({
    id: store.id,
    name: store.name,
    platform: store.platform,
  }));

  return (
    <>
      <PageSyncControl pageKey="dashboard" onOpenHistory={() => setSyncCenterOpen(true)} />
      <SyncCenter
        open={syncCenterOpen}
        onOpenChange={setSyncCenterOpen}
        logs={logs}
        triggers={[]}
        stores={stores}
      />
    </>
  );
}
