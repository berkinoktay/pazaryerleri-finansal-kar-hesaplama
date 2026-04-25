import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { EmptyState } from '@/components/patterns/empty-state';
import { NotificationBell } from '@/components/patterns/notification-bell';
import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge } from '@/components/patterns/sync-badge';
import {
  QuickAccessPanel,
  type QuickAccessItem,
} from '@/features/dashboard/components/quick-access-panel';
import type { Organization } from '@/features/organization/api/organizations.api';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';

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

// MOCK COUNTS — replaced by real "needs action" queries when the
// dashboard summary endpoint ships. Hoisted to module scope so the
// array reference is stable across renders (otherwise React Query /
// React Compiler treat it as a new prop on every pass).
const QUICK_ACCESS_ITEMS: QuickAccessItem[] = [
  { key: 'pendingOrders', href: '/orders?status=pending', count: 5, tone: 'warning' },
  { key: 'noCostProducts', href: '/products?filter=no-cost', count: 12, tone: 'warning' },
  { key: 'returnReviews', href: '/orders?status=returned', count: 3, tone: 'warning' },
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
  const orgsResult = await api.GET('/v1/organizations', {});

  const orgs: Organization[] = orgsResult.data?.data ?? [];
  if (orgsResult.data !== undefined && orgs.length === 0) {
    redirect('/onboarding/create-organization');
  }

  const activeOrgId = await resolveActiveOrgId(orgs);
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];

  return (
    <>
      <PageHeader
        title={t('title')}
        intent={activeOrg?.name}
        meta={<SyncBadge state="fresh" lastSyncedAt={MOCK_LAST_SYNCED} source="Trendyol" />}
        actions={<NotificationBell entries={MOCK_NOTIFICATIONS} unreadCount={2} />}
      />
      <QuickAccessPanel items={QUICK_ACCESS_ITEMS} />
      <EmptyState title={t('empty.title')} description={t('empty.description')} />
    </>
  );
}
