import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client';

export type Organization = components['schemas']['Organization'];

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await apiClient.GET('/v1/organizations', {});
  if (error) {
    throw new Error(`Failed to fetch organizations: ${JSON.stringify(error)}`);
  }
  return data.data;
}
