import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type RotateWebhookSecretResponse = components['schemas']['RotateWebhookSecretResponse'];

export async function rotateWebhookSecret(
  orgId: string,
  storeId: string,
): Promise<RotateWebhookSecretResponse> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/webhook/rotate-secret',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
