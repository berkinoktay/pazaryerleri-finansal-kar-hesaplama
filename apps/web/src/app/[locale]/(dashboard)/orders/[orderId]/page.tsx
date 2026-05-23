import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { OrderDetailClient } from '@/features/orders/components/order-detail-client';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { resolveActiveStoreId } from '@/lib/active-store';
import { getServerApiClient } from '@/lib/api-client/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'orderDetail' });
  return { title: t('title.placeholder') };
}

/**
 * Server shell for the order detail. Resolves the active org + store via
 * the same cookie-first lookup the orders list uses, so a direct link to
 * /orders/:orderId still works as long as the user has a matching active
 * store. The detail page does not currently scope by storeId — the orderId
 * is globally unique and the backend re-verifies tenant ownership — but
 * the resolution is kept consistent with the list page so the same query
 * client cache key invariants hold.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  let activeStoreId: string | undefined;
  if (activeOrgId !== undefined) {
    const { data: storesResponse } = await api.GET('/v1/organizations/{orgId}/stores', {
      params: { path: { orgId: activeOrgId } },
    });
    const stores = storesResponse?.data ?? [];
    activeStoreId = await resolveActiveStoreId(stores);
  }

  return (
    <OrderDetailClient
      orgId={activeOrgId ?? null}
      storeId={activeStoreId ?? null}
      orderId={orderId}
    />
  );
}
