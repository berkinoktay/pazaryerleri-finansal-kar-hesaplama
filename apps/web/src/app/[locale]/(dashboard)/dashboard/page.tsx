import { redirect } from 'next/navigation';

import { NotificationBell } from '@/components/patterns/notification-bell';
import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { DashboardBody } from '@/features/dashboard/components/dashboard-body';
import type { Organization } from '@/features/organization/api/organizations.api';
import { ActiveOrganizationPanel } from '@/features/organization/components/active-organization-panel';
import { StoresPanel } from '@/features/stores/components/stores-panel';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';

export const metadata = {
  title: 'Gösterge paneli',
};

// Mock value hoisted out of render so it doesn't re-construct on every pass
// and so React Compiler doesn't flag `new Date(...)` as an impure call in
// the render body. Real value will flow from the latest sync log when the
// backend ships that endpoint.
const MOCK_LAST_SYNCED = new Date('2026-04-22T00:13:00Z');

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  // Server-side onboarding guard: a freshly-signed-up user with zero
  // orgs lands on /dashboard by default (see `/auth/verified`). Send
  // them to the create-org flow before they see an empty shell.
  //
  // If the API call fails (network blip, backend down), we let the
  // page render — better to show the shell with an error panel than
  // to bounce an authenticated user back to onboarding every time.
  const api = await getServerApiClient();
  const [orgsResult, meResult] = await Promise.all([
    api.GET('/v1/organizations', {}),
    api.GET('/v1/me', {}),
  ]);

  const orgs: Organization[] = orgsResult.data?.data ?? [];
  if (orgsResult.data !== undefined && orgs.length === 0) {
    redirect('/onboarding/create-organization');
  }

  const activeOrgId = await resolveActiveOrgId(orgs);
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const viewerTimezone = meResult.data?.timezone;

  // Active store: backend doesn't yet expose a "last selected store"
  // cookie/endpoint. For now, fetch the org's stores server-side and
  // pick the first one as the dashboard scope. Future iteration will
  // read a cookie set by the StoreSwitcher.
  let activeStoreId = '';
  if (activeOrg) {
    const storesResult = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrg.id } },
    });
    activeStoreId = storesResult.data?.data?.[0]?.id ?? '';
  }

  return (
    <>
      <PageHeader
        title="Gösterge paneli"
        intent={activeOrg ? `${activeOrg.name} · Trendyol TR` : undefined}
        meta={<SyncBadge state="fresh" lastSyncedAt={MOCK_LAST_SYNCED} source="Trendyol" />}
        actions={
          <NotificationBell
            entries={[
              {
                id: '1',
                icon: 'success',
                title: 'Sipariş senkronizasyonu tamam',
                timestamp: '3 dk',
              },
              { id: '2', icon: 'warning', title: '2 iade incelemeyi bekliyor', timestamp: '15 dk' },
            ]}
            unreadCount={2}
          />
        }
      />
      {activeOrg ? (
        <>
          <ActiveOrganizationPanel
            org={activeOrg}
            locale={locale}
            viewerTimezone={viewerTimezone}
          />
          <StoresPanel orgId={activeOrg.id} />
          {activeStoreId ? <DashboardBody orgId={activeOrg.id} storeId={activeStoreId} /> : null}
        </>
      ) : null}
    </>
  );
}
