import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type Store = components['schemas']['Store'];

export async function listStores(orgId: string): Promise<Store[]> {
  const { data, error, response } = await apiClient.GET('/v1/organizations/{orgId}/stores', {
    params: { path: { orgId } },
  });
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
