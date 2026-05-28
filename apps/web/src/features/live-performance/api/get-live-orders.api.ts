import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { LiveOrdersFilter } from '../query-keys';

export type LivePerformanceOrders = components['schemas']['LivePerformanceOrders'];
export type LiveOrderRow = LivePerformanceOrders['data'][number];

/**
 * Today's orders as a UNION of the `orders` table (fully calculated) and
 * cost-missing buffer entries. `filter` selects the Tümü / Hesaplanmış /
 * Bekliyor tab; `counts` always reports every tab's total regardless of filter.
 */
export async function getLiveOrders(args: {
  orgId: string;
  storeId: string;
  filter?: LiveOrdersFilter;
}): Promise<LivePerformanceOrders> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/orders',
    {
      params: {
        path: { orgId: args.orgId, storeId: args.storeId },
        query: args.filter !== undefined ? { filter: args.filter } : {},
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
