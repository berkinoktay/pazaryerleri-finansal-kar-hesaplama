import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type LivePerformanceKpis = components['schemas']['LivePerformanceKpis'];

/** Today-vs-yesterday revenue / net profit / order count / margin for the store. */
export async function getLiveKpis(args: {
  orgId: string;
  storeId: string;
}): Promise<LivePerformanceKpis> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/kpis',
    { params: { path: { orgId: args.orgId, storeId: args.storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
