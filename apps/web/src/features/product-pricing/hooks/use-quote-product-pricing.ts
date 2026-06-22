'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  quoteProductPricing,
  type QuoteInput,
  type ProductPriceQuote,
} from '../api/quote-product-pricing.api';

/**
 * Mutation hook for the reverse-pricing solver.
 *
 * Call `mutateAsync({ variantId, target: { type, value } })` to compute the
 * sale price that achieves the requested target. The hook has no cache
 * invalidation because quote is a pure compute — it produces no persistent
 * side effects.
 *
 * Important: `calculable:false` is a normal 200 response, NOT an error.
 * `mutateAsync` resolves with the full `ProductPriceQuote`; callers must
 * check `result.calculable` before reading `result.price` / `result.breakdown`.
 * Real errors (network failures, 4xx/5xx) are thrown and handled by the
 * global QueryProvider onError pipeline — do not add a custom toast here.
 */
export function useQuoteProductPricing(
  orgId: string,
  storeId: string,
): UseMutationResult<ProductPriceQuote, Error, QuoteInput> {
  return useMutation<ProductPriceQuote, Error, QuoteInput>({
    mutationFn: (body) => quoteProductPricing(orgId, storeId, body),
  });
}
