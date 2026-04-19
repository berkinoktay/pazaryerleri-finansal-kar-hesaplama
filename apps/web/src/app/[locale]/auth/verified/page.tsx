import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { VerifiedCountdown } from '@/features/auth/components/verified-countdown';
import { routing } from '@/i18n/routing';

/**
 * Post-verification transition screen. Entered via /auth/callback after
 * Supabase confirms the user's email. Shows a welcome + countdown, then
 * auto-advances to /dashboard.
 *
 * Proxy PROTECTED list includes `/auth/verified` so anonymous users who
 * somehow land here (bookmark, stale link) get bounced to /login rather
 * than seeing a countdown to a page they cannot access.
 */
export default async function VerifiedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <div className="max-w-form px-lg w-full">
        <VerifiedCountdown />
      </div>
    </main>
  );
}
