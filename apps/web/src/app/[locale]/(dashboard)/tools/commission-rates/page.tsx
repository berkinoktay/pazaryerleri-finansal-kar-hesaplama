import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { CommissionRatesPageClient } from '@/features/commission-rates/components/commission-rates-page-client';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';
import { routing } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'features.commissionRates.page',
  });
  return { title: t('title') };
}

/**
 * Server component shell. Same orchestration as
 * apps/web/src/app/[locale]/(dashboard)/products/page.tsx — resolve
 * active org from cookie/first, then resolve active store, then hand
 * the ids to the client component which owns URL filter state and
 * React Query hooks.
 */
export default async function CommissionRatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'features.commissionRates.page',
  });

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
    <CommissionRatesPageClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      pageTitle={t('title')}
      pageIntent={t('intent')}
    />
  );
}
