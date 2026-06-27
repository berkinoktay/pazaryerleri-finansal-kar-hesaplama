import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { SettingsAsideCard } from '@/components/patterns/settings-section';
import { StoreConnectionsList } from '@/features/stores/components/store-connections-list';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

import { SettingsPageShell } from '../settings-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.connections' });
  return { title: t('title') };
}

/**
 * Bağlantılar (Mağaza > Bağlantılar). Lists the org's connected marketplace
 * stores with status + last sync, the wired connect/disconnect flows, and a
 * supported-marketplaces aside. Resolves the active org server-side; the list
 * stays fresh via React Query.
 */
export default async function SettingsStoresPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.connections' });
  const tStores = await getTranslations({ locale: effectiveLocale, namespace: 'stores' });

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  const stores =
    activeOrgId !== undefined
      ? ((
          await api.GET('/v1/organizations/{orgId}/stores', {
            params: { path: { orgId: activeOrgId } },
          })
        ).data?.data ?? [])
      : [];

  const aside = (
    <SettingsAsideCard title={t('supported.title')} icon={<DOMAIN_ICONS.stores />}>
      <div className="gap-2xs flex flex-col">
        <div className="gap-lg flex items-center">
          <MarketplaceLogo platform="TRENDYOL" size="md" alt={tStores('platforms.TRENDYOL')} />
          <MarketplaceLogo
            platform="HEPSIBURADA"
            size="md"
            alt={tStores('platforms.HEPSIBURADA')}
          />
        </div>
        <p className="text-2xs text-muted-foreground leading-relaxed">{t('supported.body')}</p>
      </div>
    </SettingsAsideCard>
  );

  return (
    <SettingsPageShell
      title={t('title')}
      intent={t('intent')}
      aside={activeOrgId !== undefined ? aside : undefined}
    >
      {activeOrgId !== undefined ? (
        <StoreConnectionsList orgId={activeOrgId} initialStores={stores} />
      ) : null}
    </SettingsPageShell>
  );
}
