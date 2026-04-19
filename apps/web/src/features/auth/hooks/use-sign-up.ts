'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

export interface SignUpInput {
  email: string;
  password: string;
}

/**
 * Sign up a new user via Supabase Auth. After signUp, Supabase sends a
 * confirmation email with a link to `/auth/callback`. Until the user
 * clicks it, they have no confirmed session — signInWithPassword will
 * fail with "Email not confirmed".
 *
 * On success we push to `/check-email` so the user knows to open their
 * inbox.
 */
export function useSignUp() {
  const router = useRouter();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({ email, password }: SignUpInput) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error !== null) throw error;
      return data;
    },
    onSuccess: () => {
      router.push('/check-email');
      router.refresh();
    },
  });
}
