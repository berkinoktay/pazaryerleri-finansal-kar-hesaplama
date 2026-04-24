import * as React from 'react';

import { OrgSwitcher } from '@/features/organization/components/org-switcher';
import type { Organization } from '@/features/organization/api/organizations.api';
import { DashboardStoreLauncher } from '@/features/stores/components/dashboard-store-launcher';
import { getServerApiClient } from '@/lib/api-client/server';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * Dashboard shell — three-column AppShell (IconRail + ContextRail +
 * Main, with MobileTopBar + Sheet replacing the rails below md)
 * wrapped around every authenticated route. Milestone #1 wires the
 * organisation switcher to real data; stores + activity remain
 * placeholder until milestone #2 ships store-connect.
 *
 * This layout is a Server Component because it does server-side data
 * fetching (orgs + cookie-resolved activeOrgId) and embeds the
 * OrgSwitcher as a Client Component child. The child only receives
 * serialisable props (the orgs array and an id string).
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

  return (
    <div className="h-screen">
      <DashboardStoreLauncher
        orgSwitcher={<OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />}
        activeOrgId={activeOrgId}
      >
        {children}
      </DashboardStoreLauncher>
    </div>
  );
}
