import { redirect } from 'next/navigation';
import * as React from 'react';

import type { Organization } from '@/features/organization/api/organizations.api';
import type { Store as ApiStore } from '@/features/stores/api/list-stores.api';
import { DashboardStoreLauncher } from '@/features/stores/components/dashboard-store-launcher';
import { StoreAccessGate } from '@/features/stores/components/store-access-gate';
import { MarginColoringProvider } from '@/features/account/components/margin-coloring-provider';
import { NewOrderNotifierProvider } from '@/features/live-performance/providers/new-order-notifier-provider';
import { OrgSyncsProvider } from '@/features/sync/providers/org-syncs-provider';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';
import { CurrentScopeProvider } from '@/providers/current-scope';

/**
 * Dashboard shell — single-sidebar AppShell wrapped around every
 * authenticated route. Server fetches orgs + stores once per request
 * so the sidebar can paint the active store on first byte; the client
 * launcher keeps that state fresh via React Query and persists the
 * user's selection through `last_org_id` / `last_store_id` cookies.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const api = await getServerApiClient();
  const { data } = await api.GET('/v1/organizations', {});
  const orgs: Organization[] = data?.data ?? [];

  // A registered user must always belong to an organization to use the panel.
  // No memberships → route them through onboarding to create their first org.
  if (orgs.length === 0) {
    redirect('/onboarding/create-organization');
  }

  const activeOrgId = await resolveActiveOrgId(orgs);

  let stores: ApiStore[] = [];
  if (activeOrgId !== undefined) {
    const result = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrgId } },
    });
    stores = result.data?.data ?? [];
  }
  const activeStoreId = await resolveActiveStoreId(stores);

  const activeOrg = orgs.find((o) => o.id === activeOrgId);
  if (activeOrg === undefined) {
    // Unreachable in practice — orgs is non-empty and resolveActiveOrgId returns
    // a member org's id. Guards the type and the stale-cookie edge.
    redirect('/onboarding/create-organization');
  }
  const activeStore = stores.find((s) => s.id === activeStoreId) ?? null;

  return (
    <div className="h-screen">
      <OrgSyncsProvider orgId={activeOrgId ?? null}>
        <MarginColoringProvider>
          <CurrentScopeProvider org={activeOrg} store={activeStore} accessibleStores={stores}>
            <NewOrderNotifierProvider>
              {/* key={activeOrgId} remounts the launcher on an org switch so its
                  internal activeStoreId useState resets — otherwise the previous
                  org's store id lingers and the switcher chip disagrees with the
                  server-resolved store the pages actually render. */}
              <DashboardStoreLauncher
                key={activeOrgId ?? 'no-org'}
                orgs={orgs}
                activeOrgId={activeOrgId}
                initialStores={stores}
                initialActiveStoreId={activeStoreId}
              >
                <StoreAccessGate>{children}</StoreAccessGate>
              </DashboardStoreLauncher>
            </NewOrderNotifierProvider>
          </CurrentScopeProvider>
        </MarginColoringProvider>
      </OrgSyncsProvider>
    </div>
  );
}
