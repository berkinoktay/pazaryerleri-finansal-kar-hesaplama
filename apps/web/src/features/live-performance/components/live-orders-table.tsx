'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { EmptyState } from '@/components/patterns/empty-state';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { PromotionIndicator } from '@/components/patterns/promotion-indicator';
import { Badge } from '@/components/ui/badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { LiveOrderRow } from '../api/get-live-orders.api';
import { useLiveOrders } from '../hooks/use-live-orders';
import { type LiveOrdersFilter } from '../query-keys';

interface LiveOrdersTableProps {
  orgId: string;
  storeId: string;
  onRowClick?: (row: LiveOrderRow) => void;
}

const EMPTY_COUNTS = { all: 0, calculated: 0, pending: 0 } as const;

/**
 * Today's orders feed: a UNION of fully-calculated orders and cost-missing
 * buffer entries. The Tümü / Hesaplanmış / Bekliyor FilterTabs drive a
 * server-side filter; `counts` always reports every tab's total so the chips
 * stay honest. Rows persist all day — attaching a cost moves a row from Bekliyor
 * into Hesaplanmış, never off the feed (until the 00:00 reset).
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
  const [filter, setFilter] = React.useState<LiveOrdersFilter>('all');
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
        // satır detayını (yan panel) açar. Buffer satırlarında profit/margin null →
        // nötr ama yine tıklanabilir "—" rozet. Satır-tıklaması da korunur (DataTable
        // onRowClick), böylece buffer akışı ve köklü davranış bozulmaz.
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
          const calculated = row.original.source === 'orders';
          return (
            <Badge tone={calculated ? 'success' : 'warning'}>
              {calculated ? t('statusCalculated') : t('statusPending')}
            </Badge>
          );
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
      options={[
        { value: 'all', label: t('tabs.all'), count: counts.all },
        { value: 'calculated', label: t('tabs.calculated'), count: counts.calculated },
        { value: 'pending', label: t('tabs.pending'), count: counts.pending },
      ]}
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
        empty={<EmptyState title={t('emptyTitle')} embedded />}
      />
    </section>
  );
}
