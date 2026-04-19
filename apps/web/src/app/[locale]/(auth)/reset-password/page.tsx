import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ResetPasswordForm } from '@/features/auth/components/reset-password-form';
import { routing } from '@/i18n/routing';

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('auth.resetPassword');

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <div className="gap-lg max-w-form px-lg flex w-full flex-col">
        <div className="gap-sm flex flex-col">
          <h1 className="text-foreground text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
