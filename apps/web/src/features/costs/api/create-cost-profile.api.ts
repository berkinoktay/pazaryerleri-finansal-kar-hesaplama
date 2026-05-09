import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { CostProfile, CreateCostProfileInput } from '../types/cost-profile.types';

export interface CreateCostProfileArgs {
  orgId: string;
  body: CreateCostProfileInput;
}

export async function createCostProfile(args: CreateCostProfileArgs): Promise<CostProfile> {
  const { orgId, body } = args;
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/cost-profiles',
    {
      params: { path: { orgId } },
      body,
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
