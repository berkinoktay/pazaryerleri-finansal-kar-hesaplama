import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { CostProfile } from '../types/cost-profile.types';

export async function getCostProfile(orgId: string, profileId: string): Promise<CostProfile> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/cost-profiles/{id}',
    {
      params: { path: { orgId, id: profileId } },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
