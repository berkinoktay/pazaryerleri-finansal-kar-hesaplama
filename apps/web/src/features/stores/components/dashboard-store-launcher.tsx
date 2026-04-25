'use client';

import { useState, type ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import type { Store as ApiStore } from '@/features/stores/api/list-stores.api';
import { useStores } from '@/features/stores/hooks/use-stores';
import { toUiStore } from '@/features/stores/lib/to-ui-store';
import { setActiveStoreIdAction } from '@/lib/active-store-actions';

import { ConnectStoreModal } from './connect-store-modal';

export interface DashboardStoreLauncherProps {
  orgSwitcher: ReactNode;
  activeOrgId: string | undefined;
  initialStores: ApiStore[];
  initialActiveStoreId: string | undefined;
  children: ReactNode;
}

/**
 * Client wrapper around AppShell. Owns three pieces of state:
 *   1. Connect-store modal open/close.
 *   2. The currently selected store id (initial = server-resolved
 *      cookie value; updates flow back to the cookie on selection).
 *   3. The hot list of stores (RQ hook hydrated from `initialStores`,
 *      revalidated in background after connect/disconnect).
 *
 * Backend Store → UI Store mapping happens here (via `toUiStore`) so
 * the rail components stay decoupled from the OpenAPI shape.
 */
export function DashboardStoreLauncher({
  orgSwitcher,
  activeOrgId,
  initialStores,
  initialActiveStoreId,
  children,
}: DashboardStoreLauncherProps): React.ReactElement {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeStoreId, setActiveStoreId] = useState<string | undefined>(initialActiveStoreId);

  const storesQuery = useStores(activeOrgId ?? null, initialStores);
  const stores = (storesQuery.data ?? []).map(toUiStore);
  const effectiveActiveId = activeStoreId ?? stores[0]?.id ?? '';

  function handleSelect(storeId: string): void {
    setActiveStoreId(storeId);
    void setActiveStoreIdAction(storeId);
  }

  return (
    <>
      <AppShell
        orgSwitcher={orgSwitcher}
        stores={stores}
        activeStoreId={effectiveActiveId}
        onSelectStore={handleSelect}
        onAddStore={activeOrgId !== undefined ? () => setModalOpen(true) : undefined}
      >
        {children}
      </AppShell>
      {activeOrgId !== undefined ? (
        <ConnectStoreModal orgId={activeOrgId} open={modalOpen} onOpenChange={setModalOpen} />
      ) : null}
    </>
  );
}
