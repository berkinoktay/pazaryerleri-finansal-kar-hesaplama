'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

/**
 * Sign the current user out, clear all React Query caches (anything
 * cached under the previous identity must not leak into the next),
 * and push to /login. `router.refresh()` forces the proxy to re-check
 * session on the next request so the redirect lands cleanly.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();

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
  });
}
