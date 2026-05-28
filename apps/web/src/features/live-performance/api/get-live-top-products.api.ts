import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type LivePerformanceTopProducts = components['schemas']['LivePerformanceTopProducts'];
export type TopProductRow = LivePerformanceTopProducts['data'][number];

/** Today's top 3 selling variants (from calculated orders). */
export async function getLiveTopProducts(args: {
  orgId: string;
  storeId: string;
}): Promise<LivePerformanceTopProducts> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/top-products',
    { params: { path: { orgId: args.orgId, storeId: args.storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
