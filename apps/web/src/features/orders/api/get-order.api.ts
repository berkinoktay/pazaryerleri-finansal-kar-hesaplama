import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type OrderDetail = components['schemas']['OrderDetail'];
export type OrderItemDetail = components['schemas']['OrderItemDetail'];
export type OrderFeeDetail = components['schemas']['OrderFeeDetail'];
export type OrderClaimDetail = components['schemas']['OrderClaimDetail'];

export interface GetOrderArgs {
  orgId: string;
  storeId: string;
  orderId: string;
}

export async function getOrder(args: GetOrderArgs): Promise<OrderDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}',
    {
      params: {
        path: { orgId: args.orgId, storeId: args.storeId, orderId: args.orderId },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
