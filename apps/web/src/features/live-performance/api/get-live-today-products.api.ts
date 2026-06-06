import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type LivePerformanceTodayProducts = components['schemas']['LivePerformanceTodayProducts'];
export type TodayProductRow = LivePerformanceTodayProducts['data'][number];

/** Every product variant that sold today (orders ∪ buffer), one row per barcode. */
export async function getLiveTodayProducts(args: {
  orgId: string;
  storeId: string;
}): Promise<LivePerformanceTodayProducts> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/today-products',
    { params: { path: { orgId: args.orgId, storeId: args.storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
