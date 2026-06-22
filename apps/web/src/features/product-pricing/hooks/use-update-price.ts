'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  updatePrice,
  type UpdatePriceArgs,
  type UpdatePriceResponse,
} from '../api/update-price.api';
import { productPricingKeys } from '../query-keys';

/**
 * Mutation hook for the live marketplace price write.
 *
 * On success it invalidates the product-pricing list (salePrice / profit /
 * margin columns change once the new price lands) and toasts an outcome-specific
 * message: a confirmed write (`status: 'SUCCESS'`) reads "updated on Trendyol",
 * while a queued-but-unconfirmed write (`status: 'PENDING'`) reads "awaiting
 * Trendyol approval" — the local price was NOT changed in that case.
 *
 * Errors (including the 422 MARKETPLACE_WRITE_FAILED per-item rejection) flow
 * through the global QueryProvider onError pipeline, which localizes the
 * `ApiError.code` — no custom `onError` here.
 */
export function useUpdatePrice(
  orgId: string,
  storeId: string,
): UseMutationResult<UpdatePriceResponse, Error, UpdatePriceArgs> {
  const queryClient = useQueryClient();
  const t = useTranslations('features.productPricing.panel.save');

  return useMutation<UpdatePriceResponse, Error, UpdatePriceArgs>({
    mutationFn: (args) => updatePrice(args),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: productPricingKeys.lists(orgId, storeId),
      });
      toast.success(result.status === 'SUCCESS' ? t('successToast') : t('pendingToast'));
    },
  });
}
