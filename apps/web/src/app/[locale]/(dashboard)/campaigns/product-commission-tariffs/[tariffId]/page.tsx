import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { CommissionTariffDetailClient } from '@/features/campaigns/components/commission-tariff-detail-client';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';
import { routing } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; tariffId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'campaignsPages' });
  return { title: t('productCommissionTariffs.title') };
}

/**
 * Server shell for one saved tariff's DETAIL. Reads the `tariffId` route param,
 * resolves the active org + store (mirroring the list shell), and hands all three
 * to the client, which loads the tariff, drives band selection, and saves/exports.
 */
export default async function CommissionTariffDetailPage({
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
    <CommissionTariffDetailClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      tariffId={tariffId}
    />
  );
}
