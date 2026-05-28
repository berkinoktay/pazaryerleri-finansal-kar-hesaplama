import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type LivePerformanceMissingCost = components['schemas']['LivePerformanceMissingCost'];
export type MissingCostRow = LivePerformanceMissingCost['data'][number];

/** Variant-grouped list of today's cost-missing orders blocking profit calc. */
export async function getLiveMissingCost(args: {
  orgId: string;
  storeId: string;
}): Promise<LivePerformanceMissingCost> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/missing-cost',
    { params: { path: { orgId: args.orgId, storeId: args.storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
