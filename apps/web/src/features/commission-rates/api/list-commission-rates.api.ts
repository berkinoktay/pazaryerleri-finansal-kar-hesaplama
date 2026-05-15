import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type {
  CommissionRateProductScope,
  CommissionRateRuleKind,
  CommissionRateSort,
} from '../query-keys';

export type CommissionRateListItem = components['schemas']['CommissionRateListItem'];
export type ListCommissionRatesResponse = components['schemas']['ListCommissionRatesResponse'];

export interface ListCommissionRatesArgs {
  orgId: string;
  storeId: string;
  ruleKind: CommissionRateRuleKind;
  productScope: CommissionRateProductScope;
  q?: string;
  sort: CommissionRateSort;
  cursor?: string;
  limit?: number;
}

export async function listCommissionRates(
  args: ListCommissionRatesArgs,
): Promise<ListCommissionRatesResponse> {
  const { orgId, storeId, ruleKind, productScope, q, sort, cursor, limit } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-rates',
    {
      params: {
        path: { orgId, storeId },
        query: {
          ruleKind,
          productScope,
          ...(q !== undefined && q.length > 0 ? { q } : {}),
          sort,
          ...(cursor !== undefined && cursor.length > 0 ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
