'use client';

import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot, type StatusDotProps } from '@/components/ui/status-dot';
import { type RealtimeHealth } from '@/lib/supabase/realtime';
import { cn } from '@/lib/utils';

import { useLiveRealtime } from '../hooks/use-live-realtime';
import { liveKeys } from '../query-keys';

import { LiveKpiRow } from './live-kpi-row';
import { LiveMissingCostCard } from './live-missing-cost-card';
import { LiveOrdersTable } from './live-orders-table';
import { LiveTopProducts } from './live-top-products';

// Recharts is client-only and untestable in happy-dom — load it lazily
// (ssr:false) behind a skeleton so it never enters the server render or the
// initial bundle.
const LiveProfitChart = dynamic(
  () => import('./live-profit-chart').then((module) => module.LiveProfitChart),
  { loading: () => <ChartSkeleton />, ssr: false },
);

interface LivePerformancePageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

/**
 * Orchestration root for /live-performance. Owns the Realtime subscription
 * (health drives the live indicator + polling fallback) and composes the four
 * sections in the locked vertical order: KPI strip + cumulative-profit chart
 * (hero) → missing-cost → top-3 → orders feed. Each section owns its own query
 * so it loads and errors independently. Renders the no-store empty state until
 * a marketplace account is connected.
 */
export function LivePerformancePageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: LivePerformancePageClientProps): React.ReactElement {
  const t = useTranslations('livePerformance');
  const health = useLiveRealtime(orgId, storeId);
  const queryClient = useQueryClient();
  const isFetching = useIsFetching({ queryKey: liveKeys.all }) > 0;

  if (orgId === null || storeId === null) {
    return (
      <>
        <PageHeader title={pageTitle} intent={pageIntent} />
        <EmptyState title={t('noStore.title')} description={t('noStore.description')} />
      </>
    );
  }

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        title={pageTitle}
        intent={pageIntent}
        meta={<LiveStatusPill health={health} />}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => void queryClient.invalidateQueries({ queryKey: liveKeys.all })}
            disabled={isFetching}
            className="gap-xs"
          >
            <RefreshIcon className={cn('size-icon-sm', isFetching && 'animate-spin')} />
            {t('refresh')}
          </Button>
        }
      />
      <LiveKpiRow orgId={orgId} storeId={storeId} />
      <LiveProfitChart orgId={orgId} storeId={storeId} />
      <LiveMissingCostCard orgId={orgId} storeId={storeId} />
      <LiveTopProducts orgId={orgId} storeId={storeId} />
      <LiveOrdersTable orgId={orgId} storeId={storeId} />
    </div>
  );
}

const HEALTH_DOT_TONE: Record<RealtimeHealth, NonNullable<StatusDotProps['tone']>> = {
  healthy: 'success',
  errored: 'warning',
  connecting: 'neutral',
  paused: 'neutral',
};

const HEALTH_LABEL_KEY: Record<RealtimeHealth, 'live' | 'offline' | 'connecting'> = {
  healthy: 'live',
  errored: 'offline',
  connecting: 'connecting',
  paused: 'connecting',
};

/**
 * Quiet "canlı / bağlantı yok" indicator driven by Realtime channel health.
 * A steady StatusDot, never a pulsing ticker — the live character comes from
 * the today-vs-yesterday framing and smooth invalidation, not motion.
 */
function LiveStatusPill({ health }: { health: RealtimeHealth }): React.ReactElement {
  const t = useTranslations('livePerformance.status');
  return (
    <span
      className="gap-2xs text-2xs text-muted-foreground inline-flex items-center font-medium"
      aria-live="polite"
    >
      <StatusDot tone={HEALTH_DOT_TONE[health]} size="sm" />
      {t(HEALTH_LABEL_KEY[health])}
    </span>
  );
}

function ChartSkeleton(): React.ReactElement {
  return (
    <Card aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="aspect-[16/6] w-full" />
      </CardContent>
    </Card>
  );
}
