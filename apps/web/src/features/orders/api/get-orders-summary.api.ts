import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { OrderListItem } from './list-orders.api';
import type { CostStatusValue } from '../lib/orders-filter-parsers';

export type OrderSummary = components['schemas']['OrderSummaryResponse'];

export interface OrdersSummaryArgs {
  orgId: string;
  storeId: string;
  q?: string;
  status?: OrderListItem['status'];
  reconciliationStatus?: OrderListItem['reconciliationStatus'];
  costStatus?: CostStatusValue;
  from?: string;
  to?: string;
  lossOnly?: boolean;
}

/**
 * Filter-aware KPI summary for the orders page header. Mirrors the list query
 * (same filters) minus pagination/sort. lossOnly goes on the wire as the
 * string 'true' (the backend transforms it) — matching list-orders.api.
 */
export async function getOrdersSummary(args: OrdersSummaryArgs): Promise<OrderSummary> {
  const { orgId, storeId, ...query } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/orders/summary',
    {
      params: {
        path: { orgId, storeId },
        query: {
          ...(query.q !== undefined && query.q.length > 0 ? { q: query.q } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.reconciliationStatus !== undefined
            ? { reconciliationStatus: query.reconciliationStatus }
            : {}),
          ...(query.costStatus !== undefined ? { costStatus: query.costStatus } : {}),
          ...(query.lossOnly === true ? { lossOnly: 'true' as const } : {}),
          ...(query.from !== undefined && query.from.length > 0 ? { from: query.from } : {}),
          ...(query.to !== undefined && query.to.length > 0 ? { to: query.to } : {}),
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
