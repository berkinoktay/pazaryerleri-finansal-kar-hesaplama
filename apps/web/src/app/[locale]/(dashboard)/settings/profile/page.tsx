import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns/page-header';
import { AccountSummaryCard } from '@/features/account/components/account-summary-card';
import { ProfileSettings } from '@/features/account/components/profile-settings';
import { routing } from '@/i18n/routing';
import { getServerApiClient } from '@/lib/api-client/server';

import { SettingsDetail } from '../settings-detail';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.profile' });
  return { title: t('title') };
}

/**
 * Profil (Hesabım > Profil). Reads the signed-in user's profile server-side and
 * lays it out as a main column (identity + region/language forms) plus a
 * contextual aside (account summary). The update endpoint (`PATCH /v1/me`)
 * doesn't exist yet, so the forms are draft — they show the developer-only
 * marker and the save action is a no-op-with-toast until the backend lands.
 */
export default async function SettingsProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.profile' });

  const api = await getServerApiClient();
  const { data: me } = await api.GET('/v1/me', {});
  const email = me?.email ?? '';
  const timezone = me?.timezone ?? 'Europe/Istanbul';
  const language = me?.preferredLanguage ?? 'tr';
  const createdAt = me?.createdAt ?? null;

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={t('title')} intent={t('intent')} />
      <SettingsDetail
        aside={<AccountSummaryCard email={email} fullName={null} createdAt={createdAt} />}
      >
        <ProfileSettings email={email} fullName={null} timezone={timezone} language={language} />
      </SettingsDetail>
    </div>
  );
}
