import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ReplaceResponse } from '../types/cost-profile.types';

export type { ReplaceResponse };

export interface ReplaceCostProfilesArgs {
  orgId: string;
  profileIds: string[];
  variantIds: string[];
}

export async function replaceCostProfiles(args: ReplaceCostProfilesArgs): Promise<ReplaceResponse> {
  const { orgId, profileIds, variantIds } = args;
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/cost-profile-attachments/replace',
    {
      params: { path: { orgId } },
      body: { profileIds, variantIds },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
