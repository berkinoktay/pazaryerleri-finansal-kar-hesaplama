import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { LivePerformancePageClient } from '@/features/live-performance/components/live-performance-page-client';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'livePerformance' });
  return { title: t('metaTitle') };
}

/**
 * Server shell. Resolves the active org + store via cookie-first lookup with a
 * "first member / first store" fallback (matches the dashboard layout + orders
 * page). Hands the ids to the client, which owns the Realtime subscription and
 * the section composition. "Today" is computed entirely server-side per
 * endpoint — the client only displays.
 */
export default async function LivePerformancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'livePerformance' });

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  let activeStoreId: string | undefined;
  if (activeOrgId !== undefined) {
    const { data: storesResponse } = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrgId } },
    });
    const stores = storesResponse?.data ?? [];
    activeStoreId = await resolveActiveStoreId(stores);
  }

  return (
    <LivePerformancePageClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      pageTitle={t('title')}
      pageIntent={t('subtitle')}
    />
  );
}
