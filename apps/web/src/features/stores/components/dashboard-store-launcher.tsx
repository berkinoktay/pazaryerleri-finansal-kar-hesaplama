'use client';

import { useState, type ReactElement, type ReactNode } from 'react';

import { CAPABILITIES } from '@pazarsync/utils';

import { AppShell } from '@/components/layout/app-shell';
import type { Organization as SwitcherOrg } from '@/components/patterns/org-store-switcher';
import type { Organization as OrgApiData } from '@/features/organization/api/organizations.api';
import type { Store as ApiStore } from '@/features/stores/api/list-stores.api';
import { useStores } from '@/features/stores/hooks/use-stores';
import { useSwitcherPreviewStores } from '@/features/stores/hooks/use-switcher-preview-stores';
import { toSwitcherStore } from '@/features/stores/lib/to-ui-store';
import { useCurrentScope } from '@/providers/current-scope';

import { ConnectStoreModal } from './connect-store-modal';

export interface DashboardStoreLauncherProps {
  orgs: OrgApiData[];
  activeOrgId: string | undefined;
  initialStores: ApiStore[];
  initialActiveStoreId: string | undefined;
  children: ReactNode;
}

/**
 * Adapter — API Organization → switcher's Organization shape. The switcher is
 * a pure org/store picker, so it consumes only identity fields (id, name,
 * role) — a flat subset of the `GET /v1/organizations` payload.
 */
function toSwitcherOrg(org: OrgApiData): SwitcherOrg {
  return {
    id: org.id,
    name: org.name,
    role: org.role,
  };
}

/**
 * Client wrapper around the new single-sidebar AppShell. Owns three
 * pieces of state plus an org-switch handler:
 *   1. Connect-store modal open/close.
 *   2. The currently selected store id (initial = server-resolved
 *      cookie value; updates flow back to the cookie on selection).
 *   3. The hot list of stores (RQ hook hydrated from `initialStores`,
 *      revalidated in background after connect/disconnect).
 *
 * The org switch handler persists the cookie via setActiveOrgIdAction
 * then router.refresh() so the server layout re-fetches stores for the
 * newly active org.
 *
 * Backend Store/Organization → switcher shape mapping happens here so
 * the AppShell stays decoupled from the OpenAPI shape.
 */
export function DashboardStoreLauncher({
  orgs,
  activeOrgId,
  initialStores,
  initialActiveStoreId,
  children,
}: DashboardStoreLauncherProps): ReactElement {
  const { setStore, setOrg, setScope, can } = useCurrentScope();
  const canConnectStore = can(CAPABILITIES.STORES_CONNECT);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeStoreId, setActiveStoreId] = useState<string | undefined>(initialActiveStoreId);

  const storesQuery = useStores(activeOrgId ?? null, { initialData: initialStores });
  const switcherStores = (storesQuery.data ?? []).map(toSwitcherStore);
  const switcherOrgs = orgs.map(toSwitcherOrg);
  const effectiveActiveId = activeStoreId ?? switcherStores[0]?.id;

  function handleSelectStore(storeId: string): void {
    // Re-selecting the already-active store is a no-op — avoids a misleading
    // "switched" toast and a wasted server refresh.
    if (storeId === effectiveActiveId) return;
    // Optimistically highlight the newly selected store in the switcher chip,
    // then delegate to the scope provider — it toasts, persists the cookie, and
    // refreshes the server-rendered pages (awaiting the cookie write so the
    // refresh can't re-read the previous store's cookie and paint stale data).
    setActiveStoreId(storeId);
    setStore(storeId);
  }

  function handleSelectOrg(orgId: string): void {
    if (orgId === activeOrgId) return;
    // Delegate to the scope provider — it clears the React Query cache (tenant
    // boundary), persists the cookie, then refreshes.
    setOrg(orgId);
  }

  function handleSelectScope(orgId: string, storeId: string, storeName: string): void {
    // A same-org pick is really just a store switch — avoid the extra org
    // cookie write and the cache clear that a true cross-org jump needs.
    // The panel routes same-org picks to onSelectStore; this branch is defensive only.
    if (orgId === activeOrgId) {
      handleSelectStore(storeId);
      return;
    }
    // Cross-org jump — the scope provider persists both cookies, clears the
    // React Query cache (tenant boundary), then does a single refresh.
    setScope(orgId, storeId, storeName);
  }

  return (
    <>
      <AppShell
        orgs={switcherOrgs}
        stores={switcherStores}
        activeOrgId={activeOrgId}
        activeStoreId={effectiveActiveId}
        onSelectOrg={handleSelectOrg}
        onSelectStore={handleSelectStore}
        onSelectScope={handleSelectScope}
        usePreviewStores={useSwitcherPreviewStores}
        onAddStore={
          activeOrgId !== undefined && canConnectStore ? () => setModalOpen(true) : undefined
        }
      >
        {children}
      </AppShell>
      {activeOrgId !== undefined ? (
        <ConnectStoreModal orgId={activeOrgId} open={modalOpen} onOpenChange={setModalOpen} />
      ) : null}
    </>
  );
}
