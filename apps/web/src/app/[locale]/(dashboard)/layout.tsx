'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { AppShell } from '@/components/layout/app-shell';
import { MOCK_ACTIVITY, MOCK_STORES } from '@/components/showcase/showcase-mocks';

/**
 * Dashboard shell — scaffolding layout that wires the dual-rail AppShell
 * into every authenticated route. Store list and activity feed are served
 * from mocks for now; these will plug into React Query hooks (useStores,
 * useActivityFeed) once the feature layer is built.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations('toast');
  const [activeStoreId, setActiveStoreId] = React.useState(MOCK_STORES[0]!.id);

  return (
    <div className="h-screen">
      <AppShell
        stores={MOCK_STORES}
        activeStoreId={activeStoreId}
        onSelectStore={setActiveStoreId}
        onAddStore={() => toast.info(t('storeFlowNotReady'))}
        onSyncNow={() => toast.success(t('syncStarted'))}
        activity={MOCK_ACTIVITY}
      >
        {children}
      </AppShell>
    </div>
  );
}
