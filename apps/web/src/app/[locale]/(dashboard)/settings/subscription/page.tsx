import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns/page-header';
import { SubscriptionSettings } from '@/features/organization/components/subscription-settings';
import { SubscriptionSummaryCard } from '@/features/organization/components/subscription-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsDetail } from '../settings-detail';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.subscription' });
  return { title: t('title') };
}

/**
 * Abonelik (Hesabım > Abonelik). Displays the active plan details, billing
 * information form, and invoice history alongside a compact usage aside.
 * The billing backend does not exist yet, so all three blocks are draft —
 * they show the developer-only marker and save actions surface a toast.
 */
export default async function SettingsSubscriptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.subscription' });

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={t('title')} intent={t('intent')} />
      <SettingsDetail aside={<SubscriptionSummaryCard />}>
        <SubscriptionSettings />
      </SettingsDetail>
    </div>
  );
}
