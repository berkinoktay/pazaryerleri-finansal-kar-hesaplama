import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns/page-header';
import { PreferencesSettings } from '@/features/account/components/preferences-settings';
import { PreferencesSummaryCard } from '@/features/account/components/preferences-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsDetail } from '../settings-detail';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.preferences' });
  return { title: t('title') };
}

/**
 * Tercihler (Hesabım > Tercihler). Görünüm ve biçim ayarlarını barındırır.
 * Tema seçici (`useTheme` + ToggleGroup) anında çalışır; biçimler ve
 * klavye kısayolları henüz bağlanmamış bölümlerdir — taslak işaretçisi
 * ve draft toast ile gösterilirler.
 */
export default async function SettingsPreferencesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.preferences' });

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={t('title')} intent={t('intent')} />
      <SettingsDetail aside={<PreferencesSummaryCard />}>
        <PreferencesSettings />
      </SettingsDetail>
    </div>
  );
}
