'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

/**
 * Update the current user's password. Caller must already be in a
 * recovery session — typically arriving via /auth/callback from a
 * Supabase reset-password email link.
 */
export function useResetPassword() {
  const router = useRouter();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({ password }: { password: string }) => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error !== null) throw error;
    },
    onSuccess: () => {
      router.push('/dashboard');
      router.refresh();
    },
  });
}
