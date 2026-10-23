import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { MarketplaceCampaignDetailClient } from '@/features/campaigns/components/marketplace-campaign-detail-client';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; campaignId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'campaignsPages' });
  return { title: t('marketplaceCampaigns.title') };
}

/**
 * Server shell for one saved Kampanyalar upload's DETAIL. Reads the `campaignId` route param,
 * resolves the active org + store (mirroring the list shell), and hands all three to the client,
 * which loads the campaign, drives the price choices, and saves/exports.
 */
export default async function MarketplaceCampaignDetailPage({
  params,
}: {
  params: Promise<{ locale: string; campaignId: string }>;
}): Promise<React.ReactElement> {
  const { campaignId } = await params;

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
    <MarketplaceCampaignDetailClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      campaignId={campaignId}
    />
  );
}
