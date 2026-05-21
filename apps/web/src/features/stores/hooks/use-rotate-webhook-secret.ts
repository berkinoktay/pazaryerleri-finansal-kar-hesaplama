'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  rotateWebhookSecret,
  type RotateWebhookSecretResponse,
} from '../api/rotate-webhook-secret.api';
import { storeKeys } from '../query-keys';

export function useRotateWebhookSecret(
  orgId: string,
): UseMutationResult<RotateWebhookSecretResponse, Error, string> {
  const queryClient = useQueryClient();

  return useMutation<RotateWebhookSecretResponse, Error, string>({
    mutationFn: (storeId) => rotateWebhookSecret(orgId, storeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: storeKeys.list(orgId) });
    },
  });
}
