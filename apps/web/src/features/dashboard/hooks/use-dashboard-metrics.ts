import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  fetchDashboardMetrics,
  type DashboardMetrics,
  type DashboardMetricsParams,
} from '@/features/dashboard/api/dashboard.api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  metrics: (params: DashboardMetricsParams) => [...dashboardKeys.all, 'metrics', params] as const,
};

export function useDashboardMetrics(
  params: DashboardMetricsParams,
): UseQueryResult<DashboardMetrics> {
  return useQuery({
    queryKey: dashboardKeys.metrics(params),
    queryFn: () => fetchDashboardMetrics(params),
    enabled: Boolean(params.orgId && params.storeId),
  });
}
