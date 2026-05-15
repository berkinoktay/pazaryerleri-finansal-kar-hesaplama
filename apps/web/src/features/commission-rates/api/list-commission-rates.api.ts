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
  page: number;
  perPage: number;
}

export async function listCommissionRates(
  args: ListCommissionRatesArgs,
): Promise<ListCommissionRatesResponse> {
  const { orgId, storeId, ruleKind, productScope, q, sort, page, perPage } = args;
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
          page,
          perPage,
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
