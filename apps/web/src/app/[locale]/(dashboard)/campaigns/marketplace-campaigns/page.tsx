import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { MarketplaceCampaignsListClient } from '@/features/campaigns/components/marketplace-campaigns-list-client';
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
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'campaignsPages' });
  return { title: t('marketplaceCampaigns.title') };
}

/**
 * Server shell for the Kampanyalar LIST. Resolves the active org then store (cookie or first,
 * mirroring the dashboard layout) and hands the ids to the client, which lists the saved uploads
 * and owns export/delete.
 */
export default async function MarketplaceCampaignsPage(): Promise<React.ReactElement> {
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
    <MarketplaceCampaignsListClient orgId={activeOrgId ?? null} storeId={activeStoreId ?? null} />
  );
}
