import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { CreateOrganizationForm } from '@/features/organization/components/create-organization-form';
import { routing } from '@/i18n/routing';
import { getServerApiClient } from '@/lib/api-client/server';

export const metadata = {
  title: 'Yeni organizasyon',
};

export default async function CreateOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // Mirror of the dashboard guard: if the user already has an org,
  // they shouldn't see onboarding again. Send them home. On API error
  // we let the page render — better to show the form (resilient) than
  // redirect based on a failed fetch.
  const api = await getServerApiClient();
  const { data } = await api.GET('/v1/organizations', {});
  if (data !== undefined && data.data.length > 0) {
    redirect('/dashboard');
  }

  const t = await getTranslations('onboarding.createOrganization');

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <div className="gap-lg max-w-form px-lg flex w-full flex-col">
        <div className="gap-sm flex flex-col">
          <h1 className="text-foreground text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <CreateOrganizationForm autoFocus />
      </div>
    </main>
  );
}
