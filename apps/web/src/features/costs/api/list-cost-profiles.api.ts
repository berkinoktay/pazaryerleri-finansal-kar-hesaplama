import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ListCostProfileFilters, ListCostProfilesResponse } from '../types/cost-profile.types';

export interface ListCostProfilesArgs {
  orgId: string;
  storeId: string;
  filters?: ListCostProfileFilters;
}

export async function listCostProfiles(
  args: ListCostProfilesArgs,
): Promise<ListCostProfilesResponse> {
  const { orgId, storeId, filters } = args;
  const { data, error, response } = await apiClient.GET('/v1/organizations/{orgId}/cost-profiles', {
    params: {
      path: { orgId },
      query: {
        storeId,
        ...(filters?.type !== undefined
          ? {
              type: filters.type as
                | 'COGS'
                | 'PACKAGING'
                | 'SHIPPING'
                | 'SOFTWARE'
                | 'MARKETING'
                | 'OTHER',
            }
          : {}),
        ...(filters?.archived !== undefined ? { archived: filters.archived } : {}),
        ...(filters?.q !== undefined && filters.q.length > 0 ? { q: filters.q } : {}),
        ...(filters?.cursor !== undefined ? { cursor: filters.cursor } : {}),
        ...(filters?.limit !== undefined ? { limit: filters.limit } : {}),
      },
    },
  });
  if (error !== undefined) throwApiError(error, response);
  return data;
}
