'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { LiveOrderRow } from '../api/get-live-orders.api';
import { useLiveOrders } from '../hooks/use-live-orders';
import { type LiveOrdersFilter } from '../query-keys';

interface LiveOrdersTableProps {
  orgId: string;
  storeId: string;
}

const EMPTY_COUNTS = { all: 0, calculated: 0, pending: 0 } as const;

/** Narrow an arbitrary tab value back to the filter union without a type assertion. */
function toFilter(value: string): LiveOrdersFilter {
  return value === 'calculated' || value === 'pending' ? value : 'all';
}

/**
 * Today's orders feed: a UNION of fully-calculated orders and cost-missing
 * buffer entries. The Tümü / Hesaplanmış / Bekliyor tabs drive a server-side
 * filter; `counts` always reports every tab's total so the labels stay honest.
 * Rows persist all day — a cost being attached moves a row from Bekliyor into
 * Hesaplanmış, never off the feed (until the 00:00 reset).
 */
export function LiveOrdersTable({ orgId, storeId }: LiveOrdersTableProps): React.ReactElement {
  const t = useTranslations('livePerformance.orders');
  const formatter = useFormatter();
  const [filter, setFilter] = React.useState<LiveOrdersFilter>('all');
  const query = useLiveOrders(orgId, storeId, filter);

  const counts = query.data?.counts ?? EMPTY_COUNTS;
  const rows = query.data?.data ?? [];

  const columns = React.useMemo<ColumnDef<LiveOrderRow>[]>(
    () => [
      {
        accessorKey: 'platformOrderNumber',
        header: () => t('columns.orderNumber'),
        cell: ({ row }) => row.original.platformOrderNumber ?? '—',
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
        cell: ({ row }) => <Currency value={row.original.revenue} />,
      },
      {
        accessorKey: 'profit',
        header: () => t('columns.profit'),
        meta: { numeric: true },
        cell: ({ row }) =>
          row.original.profit !== null ? (
            <Currency value={row.original.profit} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'margin',
        header: () => t('columns.margin'),
        meta: { numeric: true },
        cell: ({ row }) =>
          row.original.margin !== null ? (
            <span className="tabular-nums">
              {formatter.number(Number(row.original.margin) / 100, 'percent')}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
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
    [t, formatter],
  );

  const tabs = (
    <Tabs variant="underline" value={filter} onValueChange={(value) => setFilter(toFilter(value))}>
      <TabsList>
        <TabsTrigger value="all">{t('tabs.all', { count: counts.all })}</TabsTrigger>
        <TabsTrigger value="calculated">
          {t('tabs.calculated', { count: counts.calculated })}
        </TabsTrigger>
        <TabsTrigger value="pending">{t('tabs.pending', { count: counts.pending })}</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  return (
    <section className="gap-sm flex flex-col">
      <h2 className="text-foreground text-lg font-semibold">{t('title')}</h2>
      <DataTable
        columns={columns}
        data={rows}
        loading={query.isLoading}
        tabs={tabs}
        empty={<EmptyState title={t('emptyTitle')} />}
      />
    </section>
  );
}
