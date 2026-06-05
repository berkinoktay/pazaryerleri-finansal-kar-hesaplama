import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

// Source the types from the generated client (single source of truth) -- NOT from
// `@/features/orders/...` -- so this api fn creates no cross-feature edge at all.
export type SetOrderItemCostBody = components['schemas']['SetOrderItemCostBody'];
export type OrderDetail = components['schemas']['OrderDetail'];

export interface SetOrderItemCostArgs {
  orgId: string;
  storeId: string;
  orderId: string;
  itemId: string;
  body: SetOrderItemCostBody;
}

export async function setOrderItemCost(args: SetOrderItemCostArgs): Promise<OrderDetail> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}/items/{itemId}/cost',
    {
      params: {
        path: {
          orgId: args.orgId,
          storeId: args.storeId,
          orderId: args.orderId,
          itemId: args.itemId,
        },
      },
      body: args.body,
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
