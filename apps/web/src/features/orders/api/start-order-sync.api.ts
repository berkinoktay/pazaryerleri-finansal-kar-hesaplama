import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type StartSyncResponse = components['schemas']['StartSyncResponse'];

export async function startOrderSync(orgId: string, storeId: string): Promise<StartSyncResponse> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/orders/sync',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
