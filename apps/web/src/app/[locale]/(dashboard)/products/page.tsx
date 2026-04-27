import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { ProductsPageClient } from '@/features/products/components/products-page-client';
import { readActiveOrgId } from '@/lib/active-org';
import { readActiveStoreId } from '@/lib/active-store';
import { routing } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'products.page' });
  return { title: t('title') };
}

/**
 * Server component shell. Reads the active org + store ids from the
 * server-side cookie helpers (the dashboard layout above already
 * resolved them and the cookie acts as the durable selection). Hands
 * off to the client component which owns URL filter state, React Query
 * hooks, and the table composition.
 */
export default async function ProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'products.page' });

  const [activeOrgId, activeStoreId] = await Promise.all([readActiveOrgId(), readActiveStoreId()]);

  return (
    <ProductsPageClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      pageTitle={t('title')}
      pageIntent={t('intent')}
    />
  );
}
