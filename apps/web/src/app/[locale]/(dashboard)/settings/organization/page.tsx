import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { OrganizationSettings } from '@/features/organization/components/organization-settings';
import { OrganizationSummaryCard } from '@/features/organization/components/organization-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsPageShell } from '../settings-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'settings.organization',
  });
  return { title: t('title') };
}

/**
 * Genel (Organizasyon > Genel). Organization-wide identity and accounting
 * preferences. The PATCH /v1/organizations/:id endpoint does not exist yet,
 * so both blocks are draft — they show the developer-only marker and the save
 * action is a no-op-with-toast until the backend lands.
 */
export default async function SettingsOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'settings.organization',
  });

  return (
    <SettingsPageShell title={t('title')} intent={t('intent')} aside={<OrganizationSummaryCard />}>
      <OrganizationSettings />
    </SettingsPageShell>
  );
}
