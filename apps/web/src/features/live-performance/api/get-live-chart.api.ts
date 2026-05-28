import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type LivePerformanceChart = components['schemas']['LivePerformanceChart'];

/** Hourly cumulative-profit series for today and yesterday (each 24 points). */
export async function getLiveChart(args: {
  orgId: string;
  storeId: string;
}): Promise<LivePerformanceChart> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/chart',
    { params: { path: { orgId: args.orgId, storeId: args.storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
