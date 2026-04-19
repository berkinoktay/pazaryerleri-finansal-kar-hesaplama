'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useForgotPassword } from '@/features/auth/hooks/use-forgot-password';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm(): React.ReactElement {
  const t = useTranslations('auth.forgotPassword');
  const tErr = useTranslations('auth.forgotPassword.errors');

  const forgotPassword = useForgotPassword();

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  function onSubmit(values: ForgotPasswordInput): void {
    forgotPassword.mutate(values);
  }

  if (forgotPassword.isSuccess) {
    return (
      <div className="border-border bg-muted/40 p-md rounded-md border text-sm" role="status">
        <p className="text-foreground font-medium">{t('sent.title')}</p>
        <p className="text-muted-foreground mt-xs">{t('sent.body')}</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="gap-md grid">
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
        {forgotPassword.isError ? (
          <p className="text-destructive text-sm" role="alert">
            {tErr('generic')}
          </p>
        ) : null}
        <Button type="submit" disabled={forgotPassword.isPending}>
          {forgotPassword.isPending ? t('submitting') : t('submit')}
        </Button>
      </form>
    </Form>
  );
}
