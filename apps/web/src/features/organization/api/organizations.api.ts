import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type Organization = components['schemas']['Organization'];

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error, response } = await apiClient.GET('/v1/organizations', {});
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
