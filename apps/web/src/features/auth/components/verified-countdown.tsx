'use client';

import { CheckmarkCircle02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

const COUNTDOWN_SECONDS = 5;

/**
 * Post-verification welcome screen. Shows a success badge, a countdown
 * timer, and auto-navigates to /dashboard when it hits zero. Users
 * who don't want to wait can click the "Go now" button.
 *
 * Mount only when the user has a fresh session (proxy gates access via
 * PROTECTED list), so the countdown's assumption that /dashboard will
 * accept them is safe.
 */
export function VerifiedCountdown(): React.ReactElement {
  const t = useTranslations('auth.verified');
  const router = useRouter();
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (seconds <= 0) {
      router.push('/dashboard');
      router.refresh();
      return;
    }
    const timer = setTimeout(() => {
      setSeconds((s) => s - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [seconds, router]);

  return (
    <div className="gap-lg flex flex-col items-center text-center">
      <div
        className="bg-success-surface text-success flex size-16 items-center justify-center rounded-full"
        aria-hidden
      >
        <CheckmarkCircle02Icon className="size-10" />
      </div>
      <div className="gap-xs flex flex-col">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
      </div>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {t('redirecting', { seconds })}
      </p>
      <Button
        onClick={() => {
          router.push('/dashboard');
          router.refresh();
        }}
      >
        {t('goNow')}
      </Button>
    </div>
  );
}
