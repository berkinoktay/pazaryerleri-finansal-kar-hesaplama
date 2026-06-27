import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { ShippingConfigForm } from '@/features/shipping/components/shipping-config-form';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';

import { SettingsDetail } from '../../settings-detail';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.nav' });
  return { title: t('shipping') };
}

interface StoreOption {
  id: string;
  name: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
}

/**
 * Kargo (Mağaza > Kargo) — store-scoped. Operates on the active store from the
 * dashboard rail's global switcher, renders the wired `ShippingConfigForm` in a
 * main column with a "how shipping is calculated" aside. With no connected
 * store, shows a "connect a store first" empty state.
 */
export default async function ShippingSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const tNav = await getTranslations({ locale: effectiveLocale, namespace: 'settings.nav' });
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.shipping' });

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
    stores =
      storesResponse?.data.map((s) => ({ id: s.id, name: s.name, platform: s.platform })) ?? [];
    const activeStoreId = await resolveActiveStoreId(stores);
    selectedStore = stores.find((s) => s.id === activeStoreId) ?? stores[0];
  }

  const aside = (
    <Card>
      <CardContent className="gap-2xs flex flex-col">
        <span className="text-foreground text-sm font-semibold">{t('infoTitle')}</span>
        <p className="text-2xs text-muted-foreground leading-relaxed">{t('infoBody')}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={tNav('shipping')} intent={t('intent')} />
      {activeOrgId !== undefined && selectedStore !== undefined ? (
        <SettingsDetail aside={aside}>
          <ShippingConfigForm
            orgId={activeOrgId}
            storeId={selectedStore.id}
            platform={selectedStore.platform}
          />
        </SettingsDetail>
      ) : (
        <EmptyState
          title={tNav('storePicker.empty')}
          description={tNav('storePicker.connectFirst')}
        />
      )}
    </div>
  );
}
