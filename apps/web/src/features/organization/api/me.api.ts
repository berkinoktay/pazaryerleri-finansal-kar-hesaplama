import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type Me = components['schemas']['MeResponse'];

export async function getMe(): Promise<Me> {
  const { data, error, response } = await apiClient.GET('/v1/me', {});
  if (error !== undefined) throwApiError(error, response);
  return data;
}
