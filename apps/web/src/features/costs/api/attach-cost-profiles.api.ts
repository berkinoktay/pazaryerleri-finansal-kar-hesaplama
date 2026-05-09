import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { AttachResponse } from '../types/cost-profile.types';

export interface AttachCostProfilesArgs {
  orgId: string;
  profileIds: string[];
  variantIds: string[];
}

export type { AttachResponse };

export async function attachCostProfiles(args: AttachCostProfilesArgs): Promise<AttachResponse> {
  const { orgId, profileIds, variantIds } = args;
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/cost-profile-attachments/attach',
    {
      params: { path: { orgId } },
      body: { profileIds, variantIds },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
