import * as React from 'react';

import type { Organization } from '@/features/organization/api/organizations.api';
import { OrgSwitcher } from '@/features/organization/components/org-switcher';
import type { Store as ApiStore } from '@/features/stores/api/list-stores.api';
import { DashboardStoreLauncher } from '@/features/stores/components/dashboard-store-launcher';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';

/**
 * Dashboard shell — three-column AppShell wrapped around every
 * authenticated route. Server fetches orgs + stores once per request
 * so the rail can paint the active store on first byte; the client
 * launcher keeps that state fresh via React Query and persists the
 * user's selection through `last_store_id` cookie.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const api = await getServerApiClient();
  const { data } = await api.GET('/v1/organizations', {});
  const orgs: Organization[] = data?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  let stores: ApiStore[] = [];
  if (activeOrgId !== undefined) {
    const result = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrgId } },
    });
    stores = result.data?.data ?? [];
  }
  const activeStoreId = await resolveActiveStoreId(stores);

  return (
    <div className="h-screen">
      <DashboardStoreLauncher
        orgSwitcher={<OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />}
        activeOrgId={activeOrgId}
        initialStores={stores}
        initialActiveStoreId={activeStoreId}
      >
        {children}
      </DashboardStoreLauncher>
    </div>
  );
}
