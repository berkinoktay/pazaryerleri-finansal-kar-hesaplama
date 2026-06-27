import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { MarginColoringSettings } from '@/features/account/components/margin-coloring-settings';
import { PreferencesSettings } from '@/features/account/components/preferences-settings';
import { PreferencesSummaryCard } from '@/features/account/components/preferences-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsPageShell } from '../settings-page-shell';

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
    <SettingsPageShell title={t('title')} intent={t('intent')} aside={<PreferencesSummaryCard />}>
      <PreferencesSettings />
      <MarginColoringSettings />
    </SettingsPageShell>
  );
}
