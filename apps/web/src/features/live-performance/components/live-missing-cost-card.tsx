'use client';

import { Alert02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { ImageCell } from '@/components/patterns/image-cell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CostCellPopover } from '@/features/costs/components/cost-cell-popover';

import type { MissingCostRow } from '../api/get-live-missing-cost.api';
import { useLiveMissingCost } from '../hooks/use-live-missing-cost';

interface LiveMissingCostCardProps {
  orgId: string;
  storeId: string;
}

/**
 * Today's cost-missing orders, grouped by variant. The seller's actionable
 * surface: attaching a cost (inline CostCellPopover) flips the buffer entry to
 * PROMOTING, and on the next Realtime tick the row leaves this list and folds
 * into the KPIs / orders feed — it is never deleted, only promoted.
 */
export function LiveMissingCostCard({
  orgId,
  storeId,
}: LiveMissingCostCardProps): React.ReactElement {
  const t = useTranslations('livePerformance.missingCost');
  const query = useLiveMissingCost(orgId, storeId);

  if (query.data === undefined) {
    return <MissingCostSkeleton title={t('title')} />;
  }

  const rows = query.data.data;
  const orderCount = rows.reduce((sum, row) => sum + row.orderCount, 0);

  return (
    <Card>
      <CardHeader leadingIcon={<Alert02Icon className="text-warning" />}>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="gap-md flex flex-col">
        {rows.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <>
            <p role="status" className="text-warning text-sm">
              {t('warning', { count: rows.length, orderCount })}
            </p>
            <ul className="gap-2xs flex flex-col">
              {rows.map((row) => (
                <MissingCostRowItem
                  key={row.variantId}
                  orgId={orgId}
                  row={row}
                  addCostLabel={t('addCostButton')}
                  metaLabel={t('orderCountLabel', { count: row.orderCount })}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface MissingCostRowItemProps {
  orgId: string;
  row: MissingCostRow;
  addCostLabel: string;
  metaLabel: string;
}

function MissingCostRowItem({
  orgId,
  row,
  addCostLabel,
  metaLabel,
}: MissingCostRowItemProps): React.ReactElement {
  return (
    <li className="gap-sm hover:bg-muted/60 duration-fast -mx-xs px-xs py-2xs flex items-center rounded-md transition-colors">
      <ImageCell src={row.thumbUrl} alt={row.productName} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-medium">{row.productName}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {row.barcode} · {metaLabel}
        </p>
      </div>
      <Currency
        value={row.revenueImpact}
        className="text-foreground shrink-0 text-sm font-medium tabular-nums"
      />
      <CostCellPopover orgId={orgId} variantId={row.variantId}>
        <Button type="button" size="sm" variant="outline" className="shrink-0">
          {addCostLabel}
        </Button>
      </CostCellPopover>
    </li>
  );
}

function MissingCostSkeleton({ title }: { title: string }): React.ReactElement {
  return (
    <Card>
      <CardHeader leadingIcon={<Alert02Icon className="text-warning" />}>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="gap-sm flex flex-col" aria-hidden>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="gap-sm flex items-center">
            <Skeleton className="size-thumb-md rounded-md" />
            <div className="gap-2xs flex flex-1 flex-col">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
