'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { AUTH_SESSION_EXPIRED, authEvents } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';

/**
 * Global listener for 401 responses. The apiClient middleware
 * dispatches an AUTH_SESSION_EXPIRED event on its shared EventTarget
 * whenever the backend rejects a request as unauthenticated; this
 * component reacts by signing out, clearing query cache, showing a
 * toast, and redirecting to /login.
 *
 * Mounted once under QueryProvider in the root layout. `ref`-gated so
 * rapid-fire 401s (e.g. two parallel requests) only trigger one
 * sign-out flow.
 */
export function SessionExpiredHandler(): null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('auth');
  const handlingRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();

    async function handleExpired(): Promise<void> {
      if (handlingRef.current) return;
      handlingRef.current = true;
      try {
        await supabase.auth.signOut();
        queryClient.clear();
        toast.error(t('sessionExpired'));
        router.push('/login');
        router.refresh();
      } finally {
        // Re-arm once navigation settles; a fresh session means
        // subsequent 401s are their own, legitimate signal again.
        setTimeout(() => {
          handlingRef.current = false;
        }, 1000);
      }
    }

    authEvents.addEventListener(AUTH_SESSION_EXPIRED, handleExpired);
    return () => {
      authEvents.removeEventListener(AUTH_SESSION_EXPIRED, handleExpired);
    };
  }, [router, queryClient, t]);

  return null;
}
