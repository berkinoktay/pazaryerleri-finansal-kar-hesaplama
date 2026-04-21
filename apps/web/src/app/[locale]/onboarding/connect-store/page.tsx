import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { ConnectStoreFlow } from '@/features/stores/components/connect-store-flow';
import { routing } from '@/i18n/routing';
import { getServerApiClient } from '@/lib/api-client/server';
import { resolveActiveOrgId } from '@/lib/active-org';

export const metadata = {
  title: 'Mağazanı bağla',
};

/**
 * Onboarding step 2 — fresh org → connect your first store.
 *
 * Guards:
 *  - 0 orgs → `/onboarding/create-organization` (step 1)
 *  - active org already has ≥1 store → `/dashboard` (skip the form)
 *
 * The "skip" affordance is a plain <Link href="/dashboard"> inside the
 * form; no persistence. Returning to the dashboard with zero stores
 * leaves the empty-state CTA visible (Task 10) so the user can connect
 * any time.
 */
export default async function ConnectStorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const api = await getServerApiClient();

  const { data: orgs, error: orgsError } = await api.GET('/v1/organizations', {});
  if (orgsError !== undefined) {
    throw new Error(`onboarding.connectStore.listOrgs: ${JSON.stringify(orgsError)}`);
  }
  if (orgs.data.length === 0) {
    redirect('/onboarding/create-organization');
  }

  const orgId = await resolveActiveOrgId(orgs.data);
  if (orgId === undefined) {
    redirect('/onboarding/create-organization');
  }

  // If the active org already has a store, skip forward.
  const { data: stores, error: storesError } = await api.GET('/v1/organizations/{orgId}/stores', {
    params: { path: { orgId } },
  });
  if (storesError !== undefined) {
    throw new Error(`onboarding.connectStore.listStores: ${JSON.stringify(storesError)}`);
  }
  if (stores.data.length > 0) {
    redirect('/dashboard');
  }

  const t = await getTranslations('stores.connect');

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <div className="gap-lg max-w-form px-lg flex w-full flex-col py-8">
        <div className="gap-sm flex flex-col">
          <h1 className="text-foreground text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <ConnectStoreFlow orgId={orgId} redirectOnSuccess="/dashboard" />
      </div>
    </main>
  );
}
