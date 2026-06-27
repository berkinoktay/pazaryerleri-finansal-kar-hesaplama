import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { SecuritySettings } from '@/features/account/components/security-settings';
import { SecuritySummaryCard } from '@/features/account/components/security-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsPageShell } from '../settings-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.security' });
  return { title: t('title') };
}

/**
 * Güvenlik (Hesabım > Güvenlik). Lays out four draft sections — password
 * change, two-factor authentication, active sessions, and danger zone —
 * in the standard 2/3 + 1/3 settings layout with a security status aside.
 * All sections are draft: the backend endpoints are not wired yet.
 */
export default async function SettingsSecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.security' });

  return (
    <SettingsPageShell title={t('title')} intent={t('intent')} aside={<SecuritySummaryCard />}>
      <SecuritySettings />
    </SettingsPageShell>
  );
}
