import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { AdvantageTariffDetailClient } from '@/features/campaigns/components/advantage-tariff-detail-client';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; tariffId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'campaignsPages' });
  return { title: t('productLabels.title') };
}

/**
 * Server shell for one saved Advantage tariff's DETAIL. Reads the `tariffId` route
 * param, resolves the active org + store (mirroring the list shell), and hands all
 * three to the client, which loads the tariff, drives star-tier selection, and
 * saves/exports.
 */
export default async function AdvantageTariffDetailPage({
  params,
}: {
  params: Promise<{ locale: string; tariffId: string }>;
}): Promise<React.ReactElement> {
  const { tariffId } = await params;

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
    <AdvantageTariffDetailClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      tariffId={tariffId}
    />
  );
}
