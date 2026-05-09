import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { CostProfileDetail } from '@/features/costs/components/cost-profile-detail';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';
import { routing } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; profileId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'costs.page' });
  return { title: t('title') };
}

/**
 * Server component shell for the /costs/[profileId] detail page.
 *
 * Resolves the active org from cookies (same pattern as the costs list page)
 * and hands orgId + profileId down to the client CostProfileDetail component
 * which owns query state, tab state, and mutation wiring.
 */
export default async function CostProfileDetailPage({
  params,
}: {
  params: Promise<{ locale: string; profileId: string }>;
}): Promise<React.ReactElement> {
  const { locale, profileId } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  void effectiveLocale; // resolved for metadata; client uses next-intl provider

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  // If org resolution fails, CostProfileDetail's useCostProfile will
  // remain disabled (orgId null) and show the loading state. The 404
  // from the API will be surfaced via the global error pipeline once
  // the client component activates after the session resolves.
  return <CostProfileDetail orgId={activeOrgId ?? ''} profileId={profileId} />;
}
