import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type NewOrderNotificationSummary = components['schemas']['NewOrderNotificationSummary'];

export interface GetNotificationSummaryArgs {
  orgId: string;
  storeId: string;
  source: 'orders' | 'buffer';
  id: string;
}

export async function getNotificationSummary(
  args: GetNotificationSummaryArgs,
): Promise<NewOrderNotificationSummary> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/live-performance/notification-summary',
    {
      params: {
        path: { orgId: args.orgId, storeId: args.storeId },
        query: { source: args.source, id: args.id },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
