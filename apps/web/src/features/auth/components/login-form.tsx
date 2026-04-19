'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AuthApiError } from '@supabase/supabase-js';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useSignIn } from '@/features/auth/hooks/use-sign-in';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginInput = z.infer<typeof loginSchema>;

/**
 * Translate a Supabase AuthApiError into an i18n key. Missing/unknown
 * errors fall back to a generic "try again" message — we never surface
 * raw Supabase strings to end users.
 */
function errorKeyFor(error: unknown): 'invalidCredentials' | 'generic' {
  if (error instanceof AuthApiError && error.code === 'invalid_credentials') {
    return 'invalidCredentials';
  }
  return 'generic';
}

export function LoginForm(): React.ReactElement {
  const t = useTranslations('auth.login');
  const tErr = useTranslations('auth.login.errors');
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? undefined;

  const signIn = useSignIn();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  function onSubmit(values: LoginInput): void {
    signIn.mutate({ ...values, redirect: redirectTo });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="gap-md grid">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {signIn.isError ? (
          <p className="text-destructive text-sm" role="alert">
            {tErr(errorKeyFor(signIn.error))}
          </p>
        ) : null}
        <Button type="submit" disabled={signIn.isPending}>
          {signIn.isPending ? t('submitting') : t('submit')}
        </Button>
      </form>
    </Form>
  );
}
