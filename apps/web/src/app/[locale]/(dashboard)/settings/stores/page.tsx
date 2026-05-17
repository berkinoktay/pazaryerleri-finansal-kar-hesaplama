import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns/page-header';
import { StoresSettingsPageClient } from '@/features/stores/components/stores-settings-page-client';
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
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.nav' });
  return { title: t('stores') };
}

/**
 * Stores settings page (server shell). Resolves the active org and
 * store cookie-side, then passes the org id, the active store id, and
 * the full store list (with platform) into the client component. The
 * client owns the rendering of the per-store sections — today just
 * the "Kargo" config form; product / order policies will compose
 * onto this same surface later.
 */
export default async function StoresSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.nav' });

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  let stores: Array<{
    id: string;
    name: string;
    platform: 'TRENDYOL' | 'HEPSIBURADA';
  }> = [];
  let activeStoreId: string | undefined;

  if (activeOrgId !== undefined) {
    const { data: storesResponse } = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrgId } },
    });
    stores =
      storesResponse?.data.map((s) => ({
        id: s.id,
        name: s.name,
        platform: s.platform,
      })) ?? [];
    activeStoreId = await resolveActiveStoreId(stores);
  }

  return (
    <>
      <PageHeader title={t('stores')} />
      <StoresSettingsPageClient
        orgId={activeOrgId ?? null}
        activeStoreId={activeStoreId ?? null}
        stores={stores}
      />
    </>
  );
}
