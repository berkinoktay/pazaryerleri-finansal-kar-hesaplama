import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { NotificationsSettings } from '@/features/account/components/notifications-settings';
import { NotificationsSummaryCard } from '@/features/account/components/notifications-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsPageShell } from '../settings-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.notifications' });
  return { title: t('title') };
}

/**
 * Bildirimler (Ayarlar > Bildirimler). Lets users configure which email and
 * alert notifications they receive. System notifications (security, billing,
 * announcements) are always on and shown as informational text only. The
 * preference backend is not wired yet, so all blocks are draft — they show
 * the developer-only marker and save actions surface a "coming soon" toast.
 */
export default async function SettingsNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.notifications' });

  return (
    <SettingsPageShell title={t('title')} intent={t('intent')} aside={<NotificationsSummaryCard />}>
      <NotificationsSettings />
    </SettingsPageShell>
  );
}
