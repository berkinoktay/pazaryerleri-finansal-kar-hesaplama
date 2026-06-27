import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns/page-header';
import { OrganizationSettings } from '@/features/organization/components/organization-settings';
import { OrganizationSummaryCard } from '@/features/organization/components/organization-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsDetail } from '../settings-detail';

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
    <div className="gap-lg flex flex-col">
      <PageHeader title={t('title')} intent={t('intent')} />
      <SettingsDetail aside={<OrganizationSummaryCard />}>
        <OrganizationSettings />
      </SettingsDetail>
    </div>
  );
}
