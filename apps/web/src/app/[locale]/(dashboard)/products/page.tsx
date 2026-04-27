import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { ProductsPageClient } from '@/features/products/components/products-page-client';
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
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'products.page' });
  return { title: t('title') };
}

/**
 * Server component shell. Mirrors the dashboard layout's resolution:
 * fetch orgs → resolve active org (cookie or first), then fetch that
 * org's stores → resolve active store (cookie or first). Reading the
 * cookie alone is not enough — `resolveActiveStoreId` falls back to
 * the first store when the cookie is absent or stale, but that fallback
 * is not persisted server-side, so a cold-load page render that only
 * reads the cookie misses the user's actual active store.
 *
 * Hands the resolved ids to ProductsPageClient which owns the URL
 * filter state, React Query hooks, and SyncCenter composition. When
 * the user has no orgs or no stores yet, the client renders the
 * "no store" empty state with a CTA into /settings/stores.
 */
export default async function ProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'products.page' });

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
    <ProductsPageClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      pageTitle={t('title')}
      pageIntent={t('intent')}
    />
  );
}
