import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { CommissionSettings } from '@/features/stores/components/commission-settings';
import { CommissionSummaryCard } from '@/features/stores/components/commission-summary-card';
import { routing } from '@/i18n/routing';

import { SettingsPageShell } from '../../settings-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.commission' });
  return { title: t('title') };
}

/**
 * Komisyon (Commission) settings page — store-scoped.
 *
 * Lets the seller inspect their level (which affects commission tiers)
 * and view a reference table of category commission rates for the active
 * store. Both blocks are DRAFT — the backend for persisting seller level
 * overrides and importing custom category rates does not exist yet. The
 * dev-only FeatureStatusMarker appears next to each card title, and any
 * save/import action surfaces a "coming soon" toast instead of persisting.
 */
export default async function SettingsCommissionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.commission' });

  return (
    <SettingsPageShell title={t('title')} intent={t('intent')} aside={<CommissionSummaryCard />}>
      <CommissionSettings />
    </SettingsPageShell>
  );
}
