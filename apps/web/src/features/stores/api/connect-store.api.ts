import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type Store = components['schemas']['Store'];
export type ConnectStoreBody = components['schemas']['ConnectStoreInput'];

export async function connectStore(orgId: string, body: ConnectStoreBody): Promise<Store> {
  const { data, error, response } = await apiClient.POST('/v1/organizations/{orgId}/stores', {
    params: { path: { orgId } },
    body,
  });
  if (error !== undefined) throwApiError(error, response);
  return data;
}
