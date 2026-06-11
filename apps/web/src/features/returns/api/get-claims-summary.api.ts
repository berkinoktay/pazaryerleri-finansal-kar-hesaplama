import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type ClaimsSummary = components['schemas']['ClaimsSummaryResponse'];

export interface GetClaimsSummaryArgs {
  orgId: string;
  storeId: string;
  /** ISO date (YYYY-MM-DD); empty/absent → backend defaults the period. */
  from?: string;
  to?: string;
}

export async function getClaimsSummary(args: GetClaimsSummaryArgs): Promise<ClaimsSummary> {
  const { orgId, storeId, ...range } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/claims/summary',
    {
      params: {
        path: { orgId, storeId },
        query: {
          ...(range.from !== undefined && range.from.length > 0 ? { from: range.from } : {}),
          ...(range.to !== undefined && range.to.length > 0 ? { to: range.to } : {}),
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
