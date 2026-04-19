import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { routing } from '@/i18n/routing';

export default async function CheckEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('auth.checkEmail');

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <div className="gap-md max-w-form px-lg flex w-full flex-col text-center">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{t('body')}</p>
      </div>
    </main>
  );
}
