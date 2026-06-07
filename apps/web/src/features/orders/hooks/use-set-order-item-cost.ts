'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { setOrderItemCost, type SetOrderItemCostBody } from '../api/set-order-item-cost.api';
import { orderKeys } from '../query-keys';

interface Vars {
  itemId: string;
  body: SetOrderItemCostBody;
}

export function useSetOrderItemCost(
  orgId: string,
  storeId: string,
  orderId: string,
): UseMutationResult<unknown, Error, Vars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: Vars) =>
      setOrderItemCost({ orgId, storeId, orderId, itemId: vars.itemId, body: vars.body }),
    onSuccess: () => {
      // Detail refresh (cost snapshot lands) + list/counts refresh (the order
      // graduates pending -> calculated, so the Maliyet Bekleyen badge ticks down).
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orgId, storeId, orderId) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists(orgId, storeId) });
    },
  });
}
