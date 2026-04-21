'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

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
import { ApiError } from '@/lib/api-error';

import { useConnectStore } from '../hooks/use-connect-store';
import type { Store } from '../api/list-stores.api';
import {
  ConnectStoreFormSchema,
  type ConnectStoreFormValues,
} from '../validation/connect-store.schema';

import { EnvironmentTabs, type StoreEnvironment } from './environment-tabs';
import { PlatformCard, type PlatformKey } from './platform-card';

const KNOWN_CODES = new Set([
  'INVALID_NAME_TOO_SHORT',
  'INVALID_NAME_TOO_LONG',
  'INVALID_SUPPLIER_ID_FORMAT',
  'INVALID_API_KEY_FORMAT',
  'INVALID_CREDENTIALS_SHAPE',
  'SANDBOX_NOT_ALLOWED',
  'PLATFORM_NOT_YET_AVAILABLE',
  'DUPLICATE_STORE_CONNECTION',
]);

function knownCodeFor(value: string | undefined): string | undefined {
  return value !== undefined && KNOWN_CODES.has(value) ? value : undefined;
}

/**
 * Paths in the form schema that backend VALIDATION_ERROR issues can
 * point at. Used to gate `form.setError` so we never try to set an
 * error on a field react-hook-form doesn't know about.
 */
const FIELD_PATHS = new Set([
  'name',
  'environment',
  'credentials.platform',
  'credentials.supplierId',
  'credentials.apiKey',
  'credentials.apiSecret',
]);

export interface ConnectStoreFormProps {
  orgId: string;
  onSuccess?: (store: Store) => void;
  onSkip?: () => void;
  autoFocus?: boolean;
}

export function ConnectStoreForm({
  orgId,
  onSuccess,
  onSkip,
  autoFocus,
}: ConnectStoreFormProps): React.ReactElement {
  const t = useTranslations('stores.connect');
  const tErr = useTranslations('stores.connect.errors');

  // Platform selector state (local — today there is only Trendyol).
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>('TRENDYOL');

  const connectMutation = useConnectStore(orgId);

  const form = useForm<ConnectStoreFormValues>({
    resolver: zodResolver(ConnectStoreFormSchema),
    defaultValues: {
      name: '',
      environment: 'PRODUCTION',
      credentials: { platform: 'TRENDYOL', supplierId: '', apiKey: '', apiSecret: '' },
    },
  });

  useEffect(() => {
    const error = connectMutation.error;
    if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return;
    for (const issue of error.problem.errors ?? []) {
      if (!FIELD_PATHS.has(issue.field)) continue;
      // Cast needed because issue.field is a plain string from the wire;
      // FIELD_PATHS above gates us to valid react-hook-form paths only.
      form.setError(issue.field as Parameters<typeof form.setError>[0], {
        type: 'server',
        message: issue.code,
      });
    }
  }, [connectMutation.error, form]);

  function onSubmit(values: ConnectStoreFormValues): void {
    connectMutation.mutate(values, {
      onSuccess: (store) => {
        form.reset();
        onSuccess?.(store);
      },
    });
  }

  const environment = form.watch('environment');

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-sm grid grid-cols-1 md:grid-cols-2">
        <PlatformCard
          platform="TRENDYOL"
          selected={selectedPlatform === 'TRENDYOL'}
          comingSoon={false}
          onSelect={() => setSelectedPlatform('TRENDYOL')}
        />
        <PlatformCard platform="HEPSIBURADA" selected={false} comingSoon />
      </div>

      <EnvironmentTabs
        value={environment as StoreEnvironment}
        onChange={(v) => form.setValue('environment', v)}
      />

      <Form {...form}>
        <form
          method="post"
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="gap-md flex flex-col"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field, fieldState }) => {
              const code = knownCodeFor(fieldState.error?.message);
              return (
                <FormItem>
                  <FormLabel>{t('labels.name')}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      autoComplete="organization"
                      placeholder={t('placeholders.name')}
                      {...field}
                      {...(autoFocus ? { autoFocus: true } : {})}
                    />
                  </FormControl>
                  {code !== undefined ? (
                    <p className="text-destructive text-sm">
                      {tErr(code as Parameters<typeof tErr>[0])}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <FormField
            control={form.control}
            name="credentials.supplierId"
            render={({ field, fieldState }) => {
              const code = knownCodeFor(fieldState.error?.message);
              return (
                <FormItem>
                  <FormLabel>{t('labels.supplierId')}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      autoComplete="off"
                      placeholder={t('placeholders.supplierId')}
                      {...field}
                    />
                  </FormControl>
                  {code !== undefined ? (
                    <p className="text-destructive text-sm">
                      {tErr(code as Parameters<typeof tErr>[0])}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <FormField
            control={form.control}
            name="credentials.apiKey"
            render={({ field, fieldState }) => {
              const code = knownCodeFor(fieldState.error?.message);
              return (
                <FormItem>
                  <FormLabel>{t('labels.apiKey')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="off" {...field} />
                  </FormControl>
                  {code !== undefined ? (
                    <p className="text-destructive text-sm">
                      {tErr(code as Parameters<typeof tErr>[0])}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <FormField
            control={form.control}
            name="credentials.apiSecret"
            render={({ field, fieldState }) => {
              const code = knownCodeFor(fieldState.error?.message);
              return (
                <FormItem>
                  <FormLabel>{t('labels.apiSecret')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="off" {...field} />
                  </FormControl>
                  {code !== undefined ? (
                    <p className="text-destructive text-sm">
                      {tErr(code as Parameters<typeof tErr>[0])}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <p className="text-muted-foreground text-sm">{t('hints.credentials')}</p>

          {connectMutation.isError &&
          !(
            connectMutation.error instanceof ApiError &&
            connectMutation.error.code === 'VALIDATION_ERROR'
          ) ? (
            <p className="text-destructive text-sm" role="alert">
              {tErr('generic')}
            </p>
          ) : null}

          <div className="gap-sm flex items-center justify-between">
            {onSkip ? (
              <Button type="button" variant="ghost" onClick={onSkip}>
                {t('actions.skip')}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={connectMutation.isPending}>
              {connectMutation.isPending ? t('actions.submitting') : t('actions.submit')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
