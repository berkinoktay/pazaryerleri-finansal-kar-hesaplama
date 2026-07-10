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

    // Persist a scope choice to its cookie, then re-render the server components
    // that read it. The refresh runs only AFTER the cookie write settles, so it
    // can't re-read the previous scope's cookie and paint stale data. A failed
    // write is logged (a broken switch stays debuggable) and still refreshes
    // (best-effort); catching the rejection also avoids an unhandled promise.
    const persistThenRefresh = (write: Promise<void>, label: string): void => {
      void write
        .catch((err: unknown) => {
          console.error(`[current-scope] failed to persist ${label}`, err);
        })
        .then(() => router.refresh());
    };

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
        persistThenRefresh(setActiveStoreIdAction(storeId), 'active store');
      },
      setOrg: (orgId) => {
        // Tenant boundary crossing: every cached query is scoped to the
        // now-previous org. Clearing the React Query cache stops a query whose
        // key omits orgId from serving the previous tenant's data — belt-and-
        // suspenders on top of org-scoped query keys. Store switches stay within
        // one org (store-scoped keys carry storeId), so setStore does not clear.
        queryClient.clear();
        persistThenRefresh(setActiveOrgIdAction(orgId), 'active org');
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
