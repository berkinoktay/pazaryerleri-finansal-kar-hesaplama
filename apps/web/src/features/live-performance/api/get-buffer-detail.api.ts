import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type BufferDetail = components['schemas']['BufferDetail'];
export type BufferDetailLine = BufferDetail['lines'][number];

export interface GetBufferDetailArgs {
  orgId: string;
  storeId: string;
  bufferId: string;
}

export async function getBufferDetail(args: GetBufferDetailArgs): Promise<BufferDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/buffer/{bufferId}',
    { params: { path: { orgId: args.orgId, storeId: args.storeId, bufferId: args.bufferId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
