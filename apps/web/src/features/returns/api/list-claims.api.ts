import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ClaimStatusFilterValue } from '../lib/returns-filter-parsers';

export type ClaimListItem = components['schemas']['ClaimListItem'];
export type ListClaimsResponse = components['schemas']['ListClaimsResponse'];

export interface ListClaimsArgs {
  orgId: string;
  storeId: string;
  q?: string;
  /** `all` tab maps to an absent param — only the wire values appear here. */
  status?: ClaimStatusFilterValue;
  from?: string;
  to?: string;
  page: number;
  perPage: number;
}

export async function listClaims(args: ListClaimsArgs): Promise<ListClaimsResponse> {
  const { orgId, storeId, ...query } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/claims',
    {
      params: {
        path: { orgId, storeId },
        query: {
          ...(query.q !== undefined && query.q.length > 0 ? { q: query.q } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
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
