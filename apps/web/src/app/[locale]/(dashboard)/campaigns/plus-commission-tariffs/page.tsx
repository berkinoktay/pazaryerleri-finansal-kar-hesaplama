import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { PlusTariffsListClient } from '@/features/campaigns/components/plus-tariffs-list-client';
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
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'campaignsPages' });
  return { title: t('plusCommissionTariffs.title') };
}

/**
 * Server shell for the Plus Commission Tariffs LIST. Resolves the active org
 * then store (cookie or first, mirroring the dashboard layout) and hands the ids
 * to the client, which lists the saved tariffs and owns upload/export/delete.
 */
export default async function PlusCommissionTariffsPage(): Promise<React.ReactElement> {
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

  return <PlusTariffsListClient orgId={activeOrgId ?? null} storeId={activeStoreId ?? null} />;
}
