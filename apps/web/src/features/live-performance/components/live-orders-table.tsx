'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useFormatter, useTranslations } from 'next-intl';
import { parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { OrderStatus } from '@pazarsync/db/enums';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { EmptyState } from '@/components/patterns/empty-state';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { PromotionIndicator } from '@/components/patterns/promotion-indicator';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { LiveOrderRow, LivePerformanceOrders } from '../api/get-live-orders.api';
import { useLiveOrders } from '../hooks/use-live-orders';
import { LIVE_ORDERS_FILTERS, type LiveOrdersFilter } from '../query-keys';

interface LiveOrdersTableProps {
  orgId: string;
  storeId: string;
  onRowClick?: (row: LiveOrderRow) => void;
}

const EMPTY_COUNTS: LivePerformanceOrders['counts'] = {
  all: 0,
  calculated: 0,
  pending: 0,
  cancelled: 0,
};

const TAB_LABEL_KEY = {
  all: 'tabs.all',
  calculated: 'tabs.calculated',
  pending: 'tabs.pending',
  cancelled: 'tabs.cancelled',
} as const satisfies Record<LiveOrdersFilter, string>;

/** What the status column says about a row. */
type LiveRowStatus = 'calculated' | 'pending' | 'cancelled';

const ROW_STATUS_BADGE = {
  calculated: { tone: 'success', labelKey: 'statusCalculated' },
  pending: { tone: 'warning', labelKey: 'statusPending' },
  cancelled: { tone: 'neutral', labelKey: 'statusCancelled' },
} as const satisfies Record<
  LiveRowStatus,
  {
    tone: NonNullable<BadgeProps['tone']>;
    labelKey: 'statusCalculated' | 'statusPending' | 'statusCancelled';
  }
>;

function liveRowStatus(row: LiveOrderRow): LiveRowStatus {
  // A cancelled order has no profit either, but it is not waiting for anything.
  if (row.status === OrderStatus.CANCELLED) return 'cancelled';
  // The API serves a profit only for a calculated row, so a null profit is
  // pending -- whether a buffer entry or an order not computed yet.
  return row.profit !== null ? 'calculated' : 'pending';
}

/**
 * Today's orders feed: each row is either an order whose profit is calculated or a
 * pending row -- a cost-missing buffer entry, or an order whose profit is not
 * calculated yet. The served profit decides the status badge (a null profit is
 * pending), not the row's source. The all / calculated / pending tabs drive a
 * server-side filter; `counts` always reports every tab's total so the chips stay
 * honest. Rows persist all day: attaching a cost moves a row from pending into
 * calculated, never off the feed (until the 00:00 reset).
 *
 * The cancelled tab lists today's cancelled orders on their own. They carry no
 * profit or margin (a cancellation is not an earning), are badged as cancelled
 * rather than pending, and never count towards the other tabs.
 */
export function LiveOrdersTable({
  orgId,
  storeId,
  onRowClick,
}: LiveOrdersTableProps): React.ReactElement {
  const t = useTranslations('livePerformance.orders');
  const formatter = useFormatter();
  // Read once at the component level — never inside cell render functions.
  const scale = useMarginColoring();
  // URL state (nuqs) — the selected tab survives reload/share; distinct param
  // name because the products table on the same page owns its own tab/search.
  const [{ ordersFilter: filter }, setUrlState] = useQueryStates({
    ordersFilter: parseAsStringEnum<LiveOrdersFilter>([...LIVE_ORDERS_FILTERS]).withDefault('all'),
  });
  const setFilter = (next: LiveOrdersFilter): void => void setUrlState({ ordersFilter: next });
  const query = useLiveOrders(orgId, storeId, filter);

  const counts = query.data?.counts ?? EMPTY_COUNTS;
  const rows = query.data?.data ?? [];

  const columns = React.useMemo<ColumnDef<LiveOrderRow>[]>(
    () => [
      {
        accessorKey: 'platformOrderNumber',
        header: () => t('columns.orderNumber'),
        cell: ({ row }) => <span>{row.original.platformOrderNumber ?? '—'}</span>,
      },
      {
        accessorKey: 'orderDate',
        header: () => t('columns.time'),
        cell: ({ row }) => (
          <time dateTime={row.original.orderDate} className="tabular-nums">
            {formatter.dateTime(new Date(row.original.orderDate), 'time')}
          </time>
        ),
      },
      {
        accessorKey: 'revenue',
        header: () => t('columns.revenue'),
        meta: { numeric: true },
        cell: ({ row }) => (
          <span className="gap-xs inline-flex items-center">
            {/* İndirim adlarını gösteren gürültüsüz rozet — her zaman satış/ciro
                tutarının yanında. Buffer satırlarında indirim yok → çizilmez. */}
            <PromotionIndicator promotions={row.original.promotionDisplays} />
            <Currency value={row.original.revenue} />
          </span>
        ),
      },
      {
        // Tahmini kâr — tıklanabilir, marj-renkli rozet (siparişler tablosuyla aynı
        // bileşen). Arka plan rengi satırın marj'ından beslenir; rozete tıklamak
        // satır detayını (yan panel) açar. Bekleyen satırlarda (tampon kaydı ya da kârı
        // henüz hesaplanmamış sipariş) profit/margin null → nötr ama yine tıklanabilir
        // "—" rozet. Satır-tıklaması da korunur (DataTable onRowClick), böylece
        // bekleyen akış ve köklü davranış bozulmaz.
        accessorKey: 'profit',
        header: () => t('columns.profit'),
        meta: { numeric: true },
        cell: ({ row }) => (
          <ProfitBadge
            value={row.original.profit}
            marginPct={row.original.margin}
            scale={scale}
            onOpen={() => onRowClick?.(row.original)}
          />
        ),
      },
      {
        // Marj % — backend yüzde-birimi string'ini (örn. "26.67") tr-TR yüzde
        // biçimine çevirir (%26,67); siparişler tablosuyla aynı yardımcı.
        accessorKey: 'margin',
        header: () => t('columns.margin'),
        meta: { numeric: true },
        cell: ({ row }) =>
          row.original.margin === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">{formatPercentDisplay(row.original.margin)}</span>
          ),
      },
      {
        id: 'status',
        header: () => t('columns.status'),
        cell: ({ row }) => {
          const badge = ROW_STATUS_BADGE[liveRowStatus(row.original)];
          return <Badge tone={badge.tone}>{t(badge.labelKey)}</Badge>;
        },
      },
    ],
    [t, formatter, scale, onRowClick],
  );

  const tabs = (
    <FilterTabs<LiveOrdersFilter>
      value={filter}
      onValueChange={setFilter}
      loading={query.isPending}
      options={LIVE_ORDERS_FILTERS.map((value) => ({
        value,
        label: t(TAB_LABEL_KEY[value]),
        count: counts[value],
      }))}
    />
  );

  return (
    <section className="gap-sm flex flex-col">
      <h2 className="text-foreground text-lg font-semibold">{t('title')}</h2>
      <DataTable
        columns={columns}
        data={rows}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onRowClick={onRowClick !== undefined ? (row) => onRowClick(row) : undefined}
        tabs={tabs}
        empty={
          <EmptyState
            title={filter === 'cancelled' ? t('emptyCancelledTitle') : t('emptyTitle')}
            embedded
          />
        }
      />
    </section>
  );
}
