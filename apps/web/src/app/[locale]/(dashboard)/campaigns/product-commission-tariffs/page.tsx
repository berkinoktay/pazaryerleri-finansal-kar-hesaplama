import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { CommissionTariffsPageClient } from '@/features/campaigns/components/commission-tariffs-page-client';
import { routing } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'campaignsPages' });
  return { title: t('productCommissionTariffs.title') };
}

export default function ProductCommissionTariffsPage(): React.ReactElement {
  return <CommissionTariffsPageClient />;
}
