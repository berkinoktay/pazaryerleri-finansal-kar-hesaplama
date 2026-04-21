'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { ApiError } from '@/lib/api-error';

import { connectStore, type ConnectStoreBody, type Store } from '../api/connect-store.api';
import { storeKeys } from '../query-keys';

/**
 * Connect a marketplace account to the organization.
 *
 * VALIDATION_ERROR is silenced for this hook (the form component walks
 * `error.problem.errors[]` and feeds field-level messages into
 * react-hook-form). Other errors flow through the global QueryProvider
 * onError — no custom toast here.
 */
export function useConnectStore(orgId: string): UseMutationResult<Store, Error, ConnectStoreBody> {
  const queryClient = useQueryClient();

  return useMutation<Store, Error, ConnectStoreBody>({
    mutationFn: (body) => connectStore(orgId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: storeKeys.list(orgId) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        // form-level handler owns the inline rendering.
        return;
      }
      // Non-validation errors fall through to the global onError toast.
    },
  });
}
