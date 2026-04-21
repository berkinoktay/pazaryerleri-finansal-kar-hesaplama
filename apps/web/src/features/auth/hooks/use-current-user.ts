'use client';

import { useQuery } from '@tanstack/react-query';

import { createClient } from '@/lib/supabase/client';

export const currentUserKeys = {
  all: ['currentUser'] as const,
  get: () => [...currentUserKeys.all, 'get'] as const,
};

/**
 * Current Supabase user, fetched via the browser client. Suspense-free,
 * meant for UI that needs email / name / avatar without blocking
 * render. Proxy.ts has already done the authoritative session check
 * before any Client Component runs, so this hook is display-only.
 */
export function useCurrentUser() {
  const supabase = createClient();

  return useQuery({
    queryKey: currentUserKeys.get(),
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error !== null) throw error;
      return data.user;
    },
    staleTime: 5 * 60 * 1000, // 5 min — proxy refreshes session cookies
    meta: { silent: true },
  });
}
