import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type OrganizationCreatedResponse = components['schemas']['OrganizationCreatedResponse'];
export type CreateOrganizationBody = components['schemas']['CreateOrganizationInput'];

export async function createOrganization(
  body: CreateOrganizationBody,
): Promise<OrganizationCreatedResponse> {
  const { data, error, response } = await apiClient.POST('/v1/organizations', { body });
  if (error !== undefined) throwApiError(error, response);
  return data;
}
