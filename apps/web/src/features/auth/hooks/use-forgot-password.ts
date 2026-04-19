'use client';

import { useMutation } from '@tanstack/react-query';

import { createClient } from '@/lib/supabase/client';

/**
 * Send a password-reset email via Supabase. Supabase crafts an email
 * with a link to `${redirectTo}?code=...`; our /auth/callback route
 * exchanges the code for a recovery session and forwards to
 * /reset-password where the user can pick a new password.
 */
export function useForgotPassword() {
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error !== null) throw error;
    },
  });
}
