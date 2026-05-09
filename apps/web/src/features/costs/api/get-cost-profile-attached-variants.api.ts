import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ListAttachedVariantsResponse } from '../types/cost-profile.types';

export interface GetCostProfileAttachedVariantsArgs {
  orgId: string;
  profileId: string;
  cursor?: string;
  limit?: number;
}

export async function getCostProfileAttachedVariants(
  args: GetCostProfileAttachedVariantsArgs,
): Promise<ListAttachedVariantsResponse> {
  const { orgId, profileId, cursor, limit } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/cost-profiles/{id}/attached-variants',
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
