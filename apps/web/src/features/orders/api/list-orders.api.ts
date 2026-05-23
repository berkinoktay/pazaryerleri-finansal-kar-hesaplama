import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type OrderListItem = components['schemas']['OrderListItem'];
export type ListOrdersResponse = components['schemas']['ListOrdersResponse'];

export interface ListOrdersArgs {
  orgId: string;
  storeId: string;
  q?: string;
  status?: OrderListItem['status'];
  reconciliationStatus?: OrderListItem['reconciliationStatus'];
  from?: string;
  to?: string;
  page: number;
  perPage: number;
}

export async function listOrders(args: ListOrdersArgs): Promise<ListOrdersResponse> {
  const { orgId, storeId, ...query } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/orders',
    {
      params: {
        path: { orgId, storeId },
        query: {
          ...(query.q !== undefined && query.q.length > 0 ? { q: query.q } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.reconciliationStatus !== undefined
            ? { reconciliationStatus: query.reconciliationStatus }
            : {}),
          ...(query.from !== undefined && query.from.length > 0 ? { from: query.from } : {}),
          ...(query.to !== undefined && query.to.length > 0 ? { to: query.to } : {}),
          page: query.page,
          perPage: query.perPage,
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
