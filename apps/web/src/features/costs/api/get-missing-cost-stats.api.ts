import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type MissingCostStats = components['schemas']['MissingCostStatsResponse'];

export async function getMissingCostStats(orgId: string): Promise<MissingCostStats> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/products/missing-cost-stats',
    { params: { path: { orgId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
