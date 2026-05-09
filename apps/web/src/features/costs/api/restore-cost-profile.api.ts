import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { CostProfile } from '../types/cost-profile.types';

export async function restoreCostProfile(orgId: string, profileId: string): Promise<CostProfile> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/cost-profiles/{id}/restore',
    {
      params: { path: { orgId, id: profileId } },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
