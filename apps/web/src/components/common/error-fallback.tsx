'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export interface ErrorFallbackProps {
  /** Next's `error.tsx` passes the thrown error here. Logged for debugging. */
  error?: Error & { digest?: string };
  /** Next's `error.tsx` passes a retry-the-segment callback here. */
  reset?: () => void;
}

export function ErrorFallback({ error, reset }: ErrorFallbackProps): React.ReactElement {
  const t = useTranslations('errorBoundary');

  useEffect(() => {
    // Ops diagnostic — stays out of the UI, surfaces in browser devtools
    // and (once Sentry lands) in error tracking.
    if (error !== undefined && process.env.NODE_ENV !== 'production') {
      console.error('[error-boundary]', error);
    }
  }, [error]);

  return (
    <main
      className="bg-background text-foreground flex min-h-screen items-center justify-center"
      role="alert"
    >
      <div className="gap-lg max-w-form px-lg flex flex-col text-center">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
        <div className="gap-sm flex justify-center">
          {reset !== undefined ? <Button onClick={reset}>{t('retry')}</Button> : null}
          <Button variant="ghost" asChild>
            <Link href="/">{t('home')}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
