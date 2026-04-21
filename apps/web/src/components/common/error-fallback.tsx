'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-error';

export interface ErrorFallbackProps {
  /** Next's `error.tsx` passes the thrown error here. Logged for debugging. */
  error?: Error & { digest?: string };
  /** Next's `error.tsx` passes a retry-the-segment callback here. */
  reset?: () => void;
}

/**
 * Extract a user-facing support correlation id from the thrown error,
 * in priority order:
 *   1. `ApiError.requestId` — our backend's X-Request-Id, stamped onto
 *      the error body's `meta.requestId` and exposed by `throwApiError`.
 *   2. Next's `digest` — a hash Next attaches to server-rendered errors
 *      so logs can be correlated to the client-side crash.
 */
function pickSupportId(error: unknown): string | undefined {
  if (error instanceof ApiError && error.requestId !== undefined) {
    return error.requestId;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string'
  ) {
    return (error as { digest: string }).digest;
  }
  return undefined;
}

export function ErrorFallback({ error, reset }: ErrorFallbackProps): React.ReactElement {
  const t = useTranslations('errorBoundary');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Ops diagnostic — stays out of the UI, surfaces in browser devtools
    // and (once Sentry lands) in error tracking.
    if (error !== undefined && process.env.NODE_ENV !== 'production') {
      console.error('[error-boundary]', error);
    }
  }, [error]);

  const supportId = pickSupportId(error);

  async function copySupportId(): Promise<void> {
    if (supportId === undefined) return;
    try {
      await navigator.clipboard.writeText(supportId);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard API blocked (insecure context, permission denied) —
      // fail silently; the id is still visible in the DOM for manual copy.
    }
  }

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
        {supportId !== undefined ? (
          <div
            className="border-border gap-xs mt-md pt-md flex flex-col items-center border-t text-xs"
            data-testid="error-fallback-support-id"
          >
            <span className="text-muted-foreground">{t('supportIdLabel')}</span>
            <div className="gap-xs flex items-center">
              <code className="bg-muted text-muted-foreground px-xs rounded py-1 font-mono">
                {supportId}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void copySupportId();
                }}
              >
                {copied ? t('supportIdCopied') : t('supportIdCopy')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
