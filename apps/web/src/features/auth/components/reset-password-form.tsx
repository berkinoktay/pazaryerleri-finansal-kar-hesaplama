'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { supabaseAuthErrorKey } from '@/features/auth/lib/supabase-auth-error-key';
import { useCurrentUser } from '@/features/auth/hooks/use-current-user';
import { useResetPassword } from '@/features/auth/hooks/use-reset-password';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const resetPasswordSchema = z
  .object({
    password: z.string().min(8),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'passwordMismatch',
  });

type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm(): React.ReactElement {
  const t = useTranslations('auth.resetPassword');
  const tErr = useTranslations('auth.resetPassword.errors');
  const tSupabaseErr = useTranslations('auth.errors.supabase');

  const { data: user, isLoading } = useCurrentUser();
  const resetPassword = useResetPassword();

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  function onSubmit(values: ResetPasswordInput): void {
    resetPassword.mutate({ password: values.password });
  }

  // No recovery session → link expired or user came here without going
  // through the email. Offer a clear path forward.
  if (!isLoading && user === null) {
    return (
      <div
        className="border-destructive/40 bg-destructive/10 p-md rounded-md border text-sm"
        role="alert"
      >
        <p className="text-foreground font-medium">{t('invalidSession.title')}</p>
        <p className="text-muted-foreground mt-xs">{t('invalidSession.body')}</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)} className="gap-md grid">
        <FormField
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" autoFocus {...field} />
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
            </FormItem>
          )}
        />
        {resetPassword.isError ? (
          <p className="text-destructive text-sm" role="alert">
            {tSupabaseErr(supabaseAuthErrorKey(resetPassword.error))}
          </p>
        ) : null}
        <Button type="submit" disabled={resetPassword.isPending}>
          {resetPassword.isPending ? t('submitting') : t('submit')}
        </Button>
      </form>
    </Form>
  );
}
