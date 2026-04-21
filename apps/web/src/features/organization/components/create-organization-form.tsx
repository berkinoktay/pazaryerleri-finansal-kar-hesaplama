'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-error';

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

import { useCreateOrganization } from '../hooks/use-create-organization';
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
} from '../validation/create-organization.schema';

type KnownErrorCode =
  | 'INVALID_NAME_TOO_SHORT'
  | 'INVALID_NAME_TOO_LONG'
  | 'INVALID_NAME_NO_ALPHANUMERIC'
  | 'INVALID_NAME_RESERVED';

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'INVALID_NAME_TOO_SHORT',
  'INVALID_NAME_TOO_LONG',
  'INVALID_NAME_NO_ALPHANUMERIC',
  'INVALID_NAME_RESERVED',
]);

function knownCodeFor(value: string | undefined): KnownErrorCode | undefined {
  return value !== undefined && KNOWN_CODES.has(value) ? (value as KnownErrorCode) : undefined;
}

export interface CreateOrganizationFormProps {
  autoFocus?: boolean;
  onCancel?: () => void;
  /**
   * Fired AFTER the hook's own onSuccess (cookie + invalidate + toast).
   * The modal variant uses this to close itself; the full-page variant
   * (onboarding) ignores it because router.push handles the transition.
   */
  onSuccess?: () => void;
}

export function CreateOrganizationForm({
  autoFocus,
  onCancel,
  onSuccess,
}: CreateOrganizationFormProps): React.ReactElement {
  const t = useTranslations('organizations.create');
  const tErr = useTranslations('organizations.create.errors');
  const createMutation = useCreateOrganization();

  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    const error = createMutation.error;
    if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return;
    for (const issue of error.problem.errors ?? []) {
      if (issue.field === 'name') {
        // issue.code is e.g. 'INVALID_NAME_TOO_SHORT' — knownCodeFor already
        // recognises these from client-side zod, and the FormField render
        // pulls the i18n copy from tErr(code).
        form.setError('name', { type: 'server', message: issue.code });
      }
    }
  }, [createMutation.error, form]);

  function onSubmit(values: CreateOrganizationInput): void {
    createMutation.mutate(
      { name: values.name },
      {
        onSuccess: () => {
          form.reset();
          onSuccess?.();
        },
      },
    );
  }

  return (
    <Form {...form}>
      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)} className="gap-md grid">
        <FormField
          control={form.control}
          name="name"
          render={({ field, fieldState }) => {
            const code = knownCodeFor(fieldState.error?.message);
            return (
              <FormItem>
                <FormLabel>{t('nameLabel')}</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    autoComplete="organization"
                    placeholder={t('namePlaceholder')}
                    {...field}
                    {...(autoFocus ? { autoFocus: true } : {})}
                  />
                </FormControl>
                {code !== undefined ? (
                  <p className="text-destructive text-sm">{tErr(code)}</p>
                ) : (
                  <p className="text-muted-foreground text-sm">{t('nameHint')}</p>
                )}
                <FormMessage />
              </FormItem>
            );
          }}
        />
        {createMutation.isError &&
        !(
          createMutation.error instanceof ApiError &&
          createMutation.error.code === 'VALIDATION_ERROR'
        ) ? (
          <p className="text-destructive text-sm" role="alert">
            {tErr('generic')}
          </p>
        ) : null}
        <div className="gap-xs flex items-center justify-end">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('cancel')}
            </Button>
          ) : null}
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? t('submitting') : t('submit')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
