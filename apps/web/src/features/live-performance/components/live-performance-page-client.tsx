'use client';

import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot, type StatusDotProps } from '@/components/ui/status-dot';
import { type RealtimeHealth } from '@/lib/supabase/realtime';
import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';

import { useQueryState } from 'nuqs';

import type { LiveOrderRow } from '../api/get-live-orders.api';
import { useLiveKpis } from '../hooks/use-live-kpis';
import { useLiveOrders } from '../hooks/use-live-orders';
import { followPromotedRow } from '../lib/follow-promoted-row';
import { resolveDeepLinkRow } from '../lib/resolve-deep-link-row';
import { liveKeys } from '../query-keys';
import { useNewOrderNotifier } from '../providers/new-order-notifier-provider';

import { LiveHeroCaption } from './live-hero-caption';
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
 * (health drives the live indicator + polling fallback) and composes the page
 * in the locked vertical order: the framed number-first header (today's net
 * profit hero + the satellite KPI strip) → cumulative-profit chart → today's
 * products → orders feed. Each section owns its own query so it loads and errors
 * independently. Renders the no-store empty state until a marketplace account is
 * connected.
 */
export function LivePerformancePageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: LivePerformancePageClientProps): React.ReactElement {
  const t = useTranslations('livePerformance');
  const tCommon = useTranslations('common');
  const { health } = useNewOrderNotifier();
  const queryClient = useQueryClient();
  const mounted = useIsMounted();
  // The refresh control derives from `useIsFetching`, which counts the CLIENT
  // cache. The server never fetches, so its markup is always idle — but the
  // dashboard layout's NewOrderNotifierProvider starts a live query (its
  // baseline `fetchQuery`) before this segment hydrates (the route group's
  // loading boundary hydrates the page after the layout has committed), and
  // `useIsFetching` reads that live count during the hydration render too.
  // Gate on mount so the first client render matches the server; the
  // post-mount re-render then surfaces the in-flight state.
  const liveFetchCount = useIsFetching({ queryKey: liveKeys.all });
  const isFetching = mounted && liveFetchCount > 0;
  const [selected, setSelected] = React.useState<LiveOrderRow | null>(null);

  // The page client reads the KPI query itself to drive the header hero
  // (today's net profit). LiveKpiRow reads the SAME query for its satellites —
  // React Query dedupes on the shared key, so there's no prop drilling and no
  // second fetch.
  const kpiQuery = useLiveKpis(orgId, storeId);
  const kpis = kpiQuery.data;
  // React Query keeps the last successful `data` through a failed background
  // refetch, so treat the hero as 'error' only when the failure has NO prior
  // data to fall back on — otherwise show the stale figures and avoid a layout
  // flicker between the metric and title-fallback layouts.
  const heroStatus: 'ready' | 'loading' | 'error' = kpiQuery.isPending
    ? 'loading'
    : kpiQuery.isError && kpis === undefined
      ? 'error'
      : 'ready';

  // Deep-link: a toast's "Detayi gor" routes here with ?order=/?buffer=. We
  // resolve the row from today's feed DURING RENDER (not an effect, so no
  // setState-in-effect) and let it drive the Sheet. The param is cleared only
  // when the user closes the Sheet -- so a brand-new order whose row arrives a
  // beat later (via the realtime refetch) still opens instead of being dropped.
  const [orderParam, setOrderParam] = useQueryState('order');
  const [bufferParam, setBufferParam] = useQueryState('buffer');
  const deepLinkOrders = useLiveOrders(orgId, storeId, 'all');
  const deepLinkRow = resolveDeepLinkRow(deepLinkOrders.data?.data, orderParam, bufferParam);

  // A deep-linked buffer row leaves the feed once the order is promoted, so
  // `resolveDeepLinkRow` turns null even though the Sheet should stay on the
  // sale. Keep the last row the link resolved to (React's "store information
  // from previous renders" pattern: a guarded setState during render, no effect)
  // for as long as the link itself is unchanged. Closing the Sheet clears both
  // params, which changes the key and drops the kept row.
  const deepLinkKey = `${orderParam ?? ''}|${bufferParam ?? ''}`;
  const [stickyDeepLink, setStickyDeepLink] = React.useState<{
    key: string;
    row: LiveOrderRow;
  } | null>(null);
  if (
    deepLinkRow !== null &&
    (stickyDeepLink?.key !== deepLinkKey || stickyDeepLink.row !== deepLinkRow)
  ) {
    setStickyDeepLink({ key: deepLinkKey, row: deepLinkRow });
  }
  const resolvedDeepLinkRow =
    deepLinkRow ?? (stickyDeepLink?.key === deepLinkKey ? stickyDeepLink.row : null);

  // A row click takes precedence; otherwise the deep-linked row drives the Sheet.
  // A pending (buffer) order that gets promoted, whether selected by a click or
  // opened from a link, is followed to its orders row in the same feed, so the
  // Sheet stays on the sale instead of showing a vanished buffer entry.
  const activeRow = followPromotedRow(deepLinkOrders.data?.data, selected ?? resolvedDeepLinkRow);

  if (orgId === null || storeId === null) {
    return (
      <>
        <PageHeader variant="framed" title={pageTitle} intent={pageIntent} />
        <EmptyState title={t('noStore.title')} description={t('noStore.description')} />
      </>
    );
  }

  // Identity row next to the small title: the quiet live/offline pill plus a
  // fixed "since 00:00" scope chip — the page is calendar-day bounded.
  const metaNode = (
    <span className="gap-xs inline-flex items-center">
      <LiveStatusPill health={health} />
      <span className="text-2xs text-muted-foreground tabular-nums">{t('scopeToday')}</span>
    </span>
  );

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        variant="framed"
        title={pageTitle}
        intent={pageIntent}
        meta={metaNode}
        hero={{
          value: <Currency animate value={kpis?.netProfitToday ?? '0'} />,
          caption: kpis !== undefined ? <LiveHeroCaption kpis={kpis} /> : undefined,
          status: heroStatus,
          loadingLabel: tCommon('chart.loading'),
        }}
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
        summary={
          heroStatus === 'error' ? undefined : <LiveKpiRow orgId={orgId} storeId={storeId} />
        }
      />
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
