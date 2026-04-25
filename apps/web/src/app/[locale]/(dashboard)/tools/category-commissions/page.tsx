import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { routing } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'navSections.tools.tools',
  });
  return { title: t('categoryCommissions') };
}

export default async function CategoryCommissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({
    locale: effectiveLocale,
    namespace: 'navSections.tools.tools',
  });
  const tEmpty = await getTranslations({ locale: effectiveLocale, namespace: 'placeholderPage' });
  return (
    <>
      <PageHeader title={t('categoryCommissions')} />
      <EmptyState title={tEmpty('comingSoon')} description={tEmpty('description')} />
    </>
  );
}
