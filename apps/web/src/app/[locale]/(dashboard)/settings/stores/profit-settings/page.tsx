import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/patterns/empty-state';
import { SettingsAsideCard } from '@/components/patterns/settings-section';
import { ProfitSettingsForm } from '@/features/profit-settings/components/profit-settings-form';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

import { SettingsPageShell } from '../../settings-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'settings.profitSettings',
  });
  return { title: t('title') };
}

interface StoreOption {
  id: string;
  name: string;
}

/**
 * Kâr Formülü (Mağaza > Kâr Formülü) — store-scoped. Operates on the active store
 * from the dashboard rail's global switcher. Renders the wired ProfitSettingsForm
 * with a "how these settings work" aside. With no connected store, shows a
 * "connect a store first" empty state.
 */
export default async function ProfitSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'settings.profitSettings',
  });
  const tNav = await getTranslations({ locale: effectiveLocale, namespace: 'settings.nav' });

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  let stores: StoreOption[] = [];
  let selectedStore: StoreOption | undefined;
  if (activeOrgId !== undefined) {
    const { data: storesResponse } = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrgId } },
    });
    stores = storesResponse?.data.map((s) => ({ id: s.id, name: s.name })) ?? [];
    const activeStoreId = await resolveActiveStoreId(stores);
    selectedStore = stores.find((s) => s.id === activeStoreId) ?? stores[0];
  }

  const aside = (
    <SettingsAsideCard title={t('infoTitle')} icon={<DOMAIN_ICONS.info />}>
      <p className="text-2xs text-muted-foreground leading-relaxed">{t('infoBody')}</p>
    </SettingsAsideCard>
  );

  return (
    <SettingsPageShell
      title={t('title')}
      intent={t('intent')}
      aside={activeOrgId !== undefined && selectedStore !== undefined ? aside : undefined}
    >
      {activeOrgId !== undefined && selectedStore !== undefined ? (
        <ProfitSettingsForm orgId={activeOrgId} storeId={selectedStore.id} />
      ) : (
        <EmptyState
          title={tNav('storePicker.empty')}
          description={tNav('storePicker.connectFirst')}
        />
      )}
    </SettingsPageShell>
  );
}
