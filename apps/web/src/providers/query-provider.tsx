'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-error';

const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * Codes handled elsewhere — must NOT trigger the global toast:
 *   - UNAUTHENTICATED → SessionExpiredHandler (sign-out + redirect)
 *   - VALIDATION_ERROR → forms render field-level errors inline
 */
const SILENT_CODES: ReadonlySet<string> = new Set(['UNAUTHENTICATED', 'VALIDATION_ERROR']);

/**
 * Codes with a matching i18n entry under common.errors.<CODE>.
 * Kept in sync manually with messages/tr.json → common.errors.
 * Unknown codes fall back to 'generic'.
 */
type KnownErrorKey =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_REFERENCE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'
  | 'MARKETPLACE_AUTH_FAILED'
  | 'MARKETPLACE_ACCESS_DENIED'
  | 'MARKETPLACE_UNREACHABLE'
  | 'SYNC_IN_PROGRESS'
  | 'generic';

const KNOWN_CODES: ReadonlySet<string> = new Set<KnownErrorKey>([
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_REFERENCE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
  'MARKETPLACE_AUTH_FAILED',
  'MARKETPLACE_ACCESS_DENIED',
  'MARKETPLACE_UNREACHABLE',
  'SYNC_IN_PROGRESS',
]);

/**
 * Retry policy: bail immediately on 4xx (the client can't fix it by
 * retrying). Keep the single retry for 5xx / network-level failures.
 */
function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

export function QueryProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const t = useTranslations('common.errors');

  const [client] = useState(() => {
    function surfaceError(error: unknown, silent: boolean): void {
      if (silent) return;
      if (!(error instanceof ApiError)) {
        toast.error(t('generic'));
        return;
      }
      if (SILENT_CODES.has(error.code)) return;
      // When the browser is offline, NetworkStatusBanner already shows
      // a persistent top banner. Suppress the toast so we don't stack
      // two signals for the same condition.
      if (
        error.code === 'NETWORK_ERROR' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
      ) {
        return;
      }
      const key: KnownErrorKey = KNOWN_CODES.has(error.code)
        ? (error.code as KnownErrorKey)
        : 'generic';
      toast.error(t(key));
    }

    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: DEFAULT_STALE_TIME_MS,
          retry: retryPolicy,
          refetchOnWindowFocus: false,
        },
        mutations: {
          retry: 0,
        },
      },
      queryCache: new QueryCache({
        onError: (error, query) => {
          surfaceError(error, query.meta?.['silent'] === true);
        },
      }),
      mutationCache: new MutationCache({
        onError: (error, _vars, _ctx, mutation) => {
          surfaceError(error, mutation.meta?.['silent'] === true);
        },
      }),
    });
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
