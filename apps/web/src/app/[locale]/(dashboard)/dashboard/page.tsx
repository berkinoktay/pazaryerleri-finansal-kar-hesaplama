import type { components } from '@pazarsync/api-client';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { NotificationBell } from '@/components/patterns/notification-bell';
import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { DashboardBody } from '@/features/dashboard/components/dashboard-body';
import type { Organization } from '@/features/organization/api/organizations.api';
import { ActiveOrganizationPanel } from '@/features/organization/components/active-organization-panel';
import { StoresPanel } from '@/features/stores/components/stores-panel';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';

type Store = components['schemas']['Store'];

const PLATFORM_LABEL: Record<Store['platform'], string> = {
  TRENDYOL: 'Trendyol',
  HEPSIBURADA: 'Hepsiburada',
};

function formatPlatformLabel(platform: Store['platform']): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'dashboardPage' });
  return { title: t('title') };
}

// Mock value hoisted out of render so it doesn't re-construct on every pass
// and so React Compiler doesn't flag `new Date(...)` as an impure call in
// the render body. Real value will flow from the latest sync log when the
// backend ships that endpoint.
const MOCK_LAST_SYNCED = new Date('2026-04-22T00:13:00Z');

// MOCK ENTRIES — replaced by useNotifications() when the feed endpoint ships.
// Inline TR is acceptable for mock fixtures; production strings come from
// the backend payload which is already localised.
const MOCK_NOTIFICATIONS = [
  {
    id: '1',
    icon: 'success' as const,
    title: 'Sipariş senkronizasyonu tamam',
    timestamp: '3 dk',
  },
  { id: '2', icon: 'warning' as const, title: '2 iade incelemeyi bekliyor', timestamp: '15 dk' },
];

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'dashboardPage' });
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
  let activeStore: Pick<Store, 'id' | 'name' | 'platform'> | undefined;
  if (activeOrg) {
    const storesResult = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrg.id } },
    });
    const first = storesResult.data?.data?.[0];
    if (first) {
      activeStore = { id: first.id, name: first.name, platform: first.platform };
    }
  }
  const activeStoreId = activeStore?.id ?? '';

  return (
    <>
      <PageHeader
        title={t('title')}
        intent={
          activeOrg
            ? activeStore
              ? `${activeOrg.name} · ${formatPlatformLabel(activeStore.platform)} ${activeStore.name}`
              : activeOrg.name
            : undefined
        }
        meta={<SyncBadge state="fresh" lastSyncedAt={MOCK_LAST_SYNCED} source="Trendyol" />}
        actions={<NotificationBell entries={MOCK_NOTIFICATIONS} unreadCount={2} />}
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
