'use client';

import { can as roleCan, capabilitiesFor, type Capability } from '@pazarsync/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { Organization } from '@/features/organization/api/organizations.api';
import type { Store } from '@/features/stores/api/list-stores.api';
import { setActiveOrgIdAction } from '@/lib/active-org-actions';
import { setActiveStoreIdAction } from '@/lib/active-store-actions';

/**
 * The caller's current dashboard scope: which org/store is active, their role
 * in that org, and what that role lets them do. Derived from data the dashboard
 * layout already fetches — the org list carries `role`, and the store list is
 * already access-filtered by the API (Phase 3) — so this needs no extra request.
 *
 * Lets any client component read the active scope and gate UI without prop
 * drilling (`useCurrentStore`, `useCan`), and switch scope without re-rolling
 * the cookie + refresh dance (`setStore`, `setOrg`). Role checks here are UX
 * only — the backend enforces every permission.
 */
export interface CurrentScope {
  org: Organization;
  store: Store | null;
  /** Every store the caller may see in this org (already access-filtered). */
  accessibleStores: Store[];
  role: Organization['role'];
  capabilities: Capability[];
  can: (capability: Capability) => boolean;
  /** Switch the active store: persist the choice, then re-resolve server state. */
  setStore: (storeId: string) => void;
  /** Switch the active org: persist the choice, then re-resolve server state. */
  setOrg: (orgId: string) => void;
}

const CurrentScopeContext = createContext<CurrentScope | null>(null);

export function CurrentScopeProvider({
  org,
  store,
  accessibleStores,
  children,
}: {
  org: Organization;
  store: Store | null;
  accessibleStores: Store[];
  children: ReactNode;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('orgStoreSwitcher');

  const value = useMemo<CurrentScope>(() => {
    const role = org.role;
    return {
      org,
      store,
      accessibleStores,
      role,
      capabilities: capabilitiesFor(role),
      can: (capability) => roleCan(role, capability),
      setStore: (storeId) => {
        const target = accessibleStores.find((s) => s.id === storeId);
        if (target !== undefined) {
          toast.success(t('switchedStore', { name: target.name }));
        }
        // Persist the choice, THEN refresh. Awaiting the cookie write before
        // router.refresh() closes a race where the server would re-render from
        // the PREVIOUS store's cookie and briefly paint the old store's data.
        // Refresh on both outcomes: a rejected cookie write still gets a refresh
        // (best-effort) and never leaves an unhandled promise rejection.
        void setActiveStoreIdAction(storeId).then(
          () => router.refresh(),
          () => router.refresh(),
        );
      },
      setOrg: (orgId) => {
        // Tenant boundary crossing: every cached query is scoped to the
        // now-previous org. Store/org switch only calls router.refresh() (server
        // re-render) and does NOT reset the React Query cache, so a query whose
        // key omits orgId would otherwise serve the previous tenant's data from
        // cache. Clearing here makes that whole bug class non-exploitable —
        // belt-and-suspenders on top of org-scoped query keys. Store switches
        // stay within one org (store-scoped keys carry storeId), so setStore
        // does not clear.
        queryClient.clear();
        // Await the cookie write before refreshing (same race as setStore);
        // refresh on both outcomes so a rejected write can't leave an unhandled
        // rejection or skip the refresh.
        void setActiveOrgIdAction(orgId).then(
          () => router.refresh(),
          () => router.refresh(),
        );
      },
    };
  }, [org, store, accessibleStores, router, queryClient, t]);

  return <CurrentScopeContext.Provider value={value}>{children}</CurrentScopeContext.Provider>;
}

export function useCurrentScope(): CurrentScope {
  const ctx = useContext(CurrentScopeContext);
  if (ctx === null) {
    throw new Error('useCurrentScope must be used within a CurrentScopeProvider');
  }
  return ctx;
}

export function useCurrentOrg(): Organization {
  return useCurrentScope().org;
}

export function useCurrentStore(): Store | null {
  return useCurrentScope().store;
}

/** Whether the caller's role grants `capability`. UX gating only. */
export function useCan(capability: Capability): boolean {
  return useCurrentScope().can(capability);
}
