'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AuthApiError } from '@supabase/supabase-js';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useSignUp } from '@/features/auth/hooks/use-sign-up';
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

const registerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    // Keyed to auth.register.errors.passwordMismatch below — the FormMessage
    // translates the code via tErr().
    message: 'passwordMismatch',
  });

type RegisterInput = z.infer<typeof registerSchema>;

function errorKeyFor(error: unknown): 'userAlreadyExists' | 'weakPassword' | 'generic' {
  if (error instanceof AuthApiError) {
    if (error.code === 'user_already_exists') return 'userAlreadyExists';
    if (error.code === 'weak_password') return 'weakPassword';
  }
  return 'generic';
}

export function RegisterForm(): React.ReactElement {
  const t = useTranslations('auth.register');
  const tErr = useTranslations('auth.register.errors');

  const signUp = useSignUp();

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirm: '' },
  });

  function onSubmit(values: RegisterInput): void {
    signUp.mutate({ email: values.email, password: values.password });
  }

  return (
    <Form {...form}>
      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)} className="gap-md grid">
        <FormField
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" autoFocus {...field} />
              </FormControl>
              {fieldState.error !== undefined ? (
                <p className="text-destructive text-sm">{tErr('invalidEmail')}</p>
              ) : null}
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              {fieldState.error !== undefined ? (
                <p className="text-destructive text-sm">{tErr('passwordTooShort')}</p>
              ) : null}
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('confirm')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              {fieldState.error !== undefined ? (
                <p className="text-destructive text-sm">{tErr('passwordMismatch')}</p>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
        {signUp.isError ? (
          <p className="text-destructive text-sm" role="alert">
            {tErr(errorKeyFor(signUp.error))}
          </p>
        ) : null}
        <Button type="submit" disabled={signUp.isPending}>
          {signUp.isPending ? t('submitting') : t('submit')}
        </Button>
      </form>
    </Form>
  );
}
