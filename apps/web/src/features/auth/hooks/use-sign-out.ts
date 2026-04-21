'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';

/**
 * Sign the current user out, clear all React Query caches (anything
 * cached under the previous identity must not leak into the next),
 * and push to /login. `router.refresh()` forces the proxy to re-check
 * session on the next request so the redirect lands cleanly.
 *
 * On failure, surfaces a localized toast so the user knows their
 * session is still live (previously silent — clicks produced no
 * feedback). `meta.silent` prevents the global QueryProvider onError
 * from stacking a second generic toast on top of ours.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();
  const tErr = useTranslations('auth.signOut');

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error !== null) throw error;
    },
    onSuccess: () => {
      queryClient.clear();
      router.push('/login');
      router.refresh();
    },
    onError: () => {
      toast.error(tErr('error'));
    },
    meta: { silent: true },
  });
}
