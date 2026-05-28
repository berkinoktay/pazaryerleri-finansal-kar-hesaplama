'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { ImageCell } from '@/components/patterns/image-cell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import type { TopProductRow } from '../api/get-live-top-products.api';
import { useLiveTopProducts } from '../hooks/use-live-top-products';

interface LiveTopProductsProps {
  orgId: string;
  storeId: string;
}

/** Today's three best sellers (from calculated orders). */
export function LiveTopProducts({ orgId, storeId }: LiveTopProductsProps): React.ReactElement {
  const t = useTranslations('livePerformance.topProducts');
  const query = useLiveTopProducts(orgId, storeId);

  if (query.data === undefined) {
    return <TopProductsSkeleton title={t('title')} />;
  }

  const rows = query.data.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title={t('emptyTitle')} />
        ) : (
          <div className="gap-md grid sm:grid-cols-3">
            {rows.map((row) => (
              <TopProductCard
                key={row.variantId}
                row={row}
                orderCountLabel={t('orderCountLabel', { count: row.orderCount })}
                profitEmptyLabel={t('profitEmpty')}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TopProductCardProps {
  row: TopProductRow;
  orderCountLabel: string;
  profitEmptyLabel: string;
}

function TopProductCard({
  row,
  orderCountLabel,
  profitEmptyLabel,
}: TopProductCardProps): React.ReactElement {
  return (
    <div className="border-border gap-sm p-md flex flex-col rounded-lg border">
      <div className="gap-sm flex items-center">
        <span className="bg-muted text-muted-foreground gap-xs flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
          {row.rank}
        </span>
        <ImageCell src={row.thumbUrl} alt={row.productName} size="lg" />
      </div>
      <p className="text-foreground line-clamp-2 text-sm font-medium">{row.productName}</p>
      <div className="gap-3xs mt-auto flex flex-col">
        <span className="text-muted-foreground text-xs tabular-nums">{orderCountLabel}</span>
        <div className="gap-sm flex items-baseline justify-between">
          <Currency
            value={row.revenue}
            className="text-foreground text-sm font-medium tabular-nums"
          />
          {row.profit !== null ? (
            <Currency
              value={row.profit}
              className="text-success text-sm font-medium tabular-nums"
            />
          ) : (
            <span className="text-muted-foreground text-xs">{profitEmptyLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TopProductsSkeleton({ title }: { title: string }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="gap-md grid sm:grid-cols-3" aria-hidden>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="border-border gap-sm p-md flex flex-col rounded-lg border">
              <Skeleton className="size-thumb-lg rounded-md" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
