import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { FlashProductDetailClient } from '@/features/campaigns/components/flash-product-detail-client';
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
  return { title: t('flashProducts.title') };
}

/**
 * Server shell for one saved Flash Products upload's DETAIL. Reads the `listId` route param,
 * resolves the active org + store (mirroring the list shell), and hands all three to the
 * client, which loads the upload, drives flash-offer selection, and saves/exports.
 */
export default async function FlashProductDetailPage({
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
    <FlashProductDetailClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      listId={listId}
    />
  );
}
