'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

export interface SignInInput {
  email: string;
  password: string;
  /** Where to send the user after a successful sign-in. Defaults to `/dashboard`. */
  redirect?: string;
}

/**
 * Sign in with email + password via Supabase Auth. On success, pushes
 * the user to `redirect` (or `/dashboard`) and calls `router.refresh()`
 * so Server Components and the proxy see the fresh session cookie.
 *
 * Uses a browser Supabase client — the cookie side-effect is handled
 * by `@supabase/ssr`. No Server Action needed for the thin MVP.
 */
export function useSignIn() {
  const router = useRouter();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({ email, password }: SignInInput) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error !== null) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      router.push(variables.redirect ?? '/dashboard');
      router.refresh();
    },
  });
}
