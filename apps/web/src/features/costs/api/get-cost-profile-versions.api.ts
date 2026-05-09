import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ListCostProfileVersionsResponse } from '../types/cost-profile.types';

export interface GetCostProfileVersionsArgs {
  orgId: string;
  profileId: string;
  cursor?: string;
  limit?: number;
}

export async function getCostProfileVersions(
  args: GetCostProfileVersionsArgs,
): Promise<ListCostProfileVersionsResponse> {
  const { orgId, profileId, cursor, limit } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/cost-profiles/{id}/versions',
    {
      params: {
        path: { orgId, id: profileId },
        query: {
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
