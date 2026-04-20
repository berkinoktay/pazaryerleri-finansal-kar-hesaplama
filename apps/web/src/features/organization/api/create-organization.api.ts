import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';

export type OrganizationCreatedResponse = components['schemas']['OrganizationCreatedResponse'];
export type CreateOrganizationBody = components['schemas']['CreateOrganizationInput'];

/**
 * POST /v1/organizations — create an organization with the caller
 * as OWNER. Returns the org + membership pair, or throws with the
 * RFC 7807 ProblemDetails payload so the hook can map it to a code
 * the form recognises for i18n.
 */
export async function createOrganization(
  body: CreateOrganizationBody,
): Promise<OrganizationCreatedResponse> {
  const { data, error, response } = await apiClient.POST('/v1/organizations', { body });
  if (error) {
    const err = new Error('CREATE_ORGANIZATION_FAILED') as Error & {
      status?: number;
      problem?: unknown;
    };
    err.status = response?.status;
    err.problem = error;
    throw err;
  }
  return data;
}
