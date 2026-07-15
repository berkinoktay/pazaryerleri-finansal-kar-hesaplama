import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { DiscountDetailClient } from '@/features/campaigns/components/discount-detail-client';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; listId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'campaignsPages' });
  return { title: t('discounts.title') };
}

/**
 * Server shell for one saved İndirimler upload's DETAIL. Reads the `listId` route param,
 * resolves the active org + store (mirroring the list shell), and hands all three to the client,
 * which loads the upload, drives config edit + product selection, and saves/exports.
 */
export default async function DiscountDetailPage({
  params,
}: {
  params: Promise<{ locale: string; listId: string }>;
}): Promise<React.ReactElement> {
  const { listId } = await params;

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
    <DiscountDetailClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      listId={listId}
    />
  );
}
