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

import { useQueryState } from 'nuqs';

import type { LiveOrderRow } from '../api/get-live-orders.api';
import { useLiveOrders } from '../hooks/use-live-orders';
import { resolveDeepLinkRow } from '../lib/resolve-deep-link-row';
import { liveKeys } from '../query-keys';
import { useNewOrderNotifier } from '../providers/new-order-notifier-provider';

import { LiveKpiRow } from './live-kpi-row';
import { LiveOrderDetailSheet } from './live-order-detail-sheet';
import { LiveOrdersTable } from './live-orders-table';
import { LiveTodayProducts } from './live-today-products';

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
 * (health drives the live indicator + polling fallback) and composes the three
 * sections in the locked vertical order: KPI strip + cumulative-profit chart
 * (hero) → today's products → orders feed. Each section owns its own query
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
  const { health } = useNewOrderNotifier();
  const queryClient = useQueryClient();
  const isFetching = useIsFetching({ queryKey: liveKeys.all }) > 0;
  const [selected, setSelected] = React.useState<LiveOrderRow | null>(null);

  // Deep-link: a toast's "Detayi gor" routes here with ?order=/?buffer=. We
  // resolve the row from today's feed DURING RENDER (not an effect, so no
  // setState-in-effect) and let it drive the Sheet. The param is cleared only
  // when the user closes the Sheet -- so a brand-new order whose row arrives a
  // beat later (via the realtime refetch) still opens instead of being dropped.
  const [orderParam, setOrderParam] = useQueryState('order');
  const [bufferParam, setBufferParam] = useQueryState('buffer');
  const deepLinkOrders = useLiveOrders(orgId, storeId, 'all');
  const deepLinkRow = resolveDeepLinkRow(deepLinkOrders.data?.data, orderParam, bufferParam);

  // A row click takes precedence; otherwise the deep-linked row drives the Sheet.
  const activeRow = selected ?? deepLinkRow;

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
      <LiveProfitChart orgId={orgId} storeId={storeId} live={health === 'healthy'} />
      <LiveTodayProducts orgId={orgId} storeId={storeId} />
      <LiveOrdersTable orgId={orgId} storeId={storeId} onRowClick={setSelected} />
      <LiveOrderDetailSheet
        orgId={orgId}
        storeId={storeId}
        selected={activeRow}
        onClose={() => {
          setSelected(null);
          void setOrderParam(null);
          void setBufferParam(null);
        }}
      />
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

/**
 * Chunk-load fallback for the dynamically-imported chart (shown only while the
 * recharts bundle downloads — once mounted, ChartFrame owns its own loading
 * state). Sized to `h-chart` so swapping in the real frame causes no layout jump.
 */
function ChartSkeleton(): React.ReactElement {
  return (
    <Card aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-chart w-full" />
      </CardContent>
    </Card>
  );
}
