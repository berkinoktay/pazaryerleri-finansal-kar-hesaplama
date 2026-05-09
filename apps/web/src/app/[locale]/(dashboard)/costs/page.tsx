import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { CostsPageClient } from '@/features/costs/components/costs-page-client';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';
import { routing } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'costs.page' });
  return { title: t('title') };
}

/**
 * Server component shell for the /costs list page.
 *
 * Resolves the active org from cookies (same pattern as products page) and
 * hands orgId down to CostsPageClient which owns query state, filters, and
 * mutation wiring. No store-scoping needed — cost profiles are org-scoped.
 */
export default async function CostsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  void effectiveLocale; // locale resolved for metadata; client uses next-intl provider

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  return <CostsPageClient orgId={activeOrgId ?? null} />;
}
