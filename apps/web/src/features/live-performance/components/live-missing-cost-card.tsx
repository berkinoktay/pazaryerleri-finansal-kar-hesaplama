'use client';

import { Alert02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { CopyableValue } from '@/components/patterns/copyable-value';
import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { ImageCell } from '@/components/patterns/image-cell';
import { InfoHint } from '@/components/patterns/info-hint';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CostCellPopover } from '@/features/costs/components/cost-cell-popover';

import type { MissingCostRow } from '../api/get-live-missing-cost.api';
import { useLiveMissingCost } from '../hooks/use-live-missing-cost';

interface LiveMissingCostCardProps {
  orgId: string;
  storeId: string;
}

const SKELETON_ROW_COUNT = 3;

/**
 * Today's cost-missing orders, grouped by variant — the seller's actionable
 * surface. Each variant is one table row: its two copyable identifiers (stock
 * code + barcode, the strings the seller pastes back into the Trendyol panel),
 * the labelled blocked-revenue column, and an inline CostCellPopover. Attaching
 * a cost flips the buffer entry to PROMOTING; on the next Realtime tick the row
 * leaves this list and folds into the KPIs / orders feed — never deleted, only
 * promoted.
 */
export function LiveMissingCostCard({
  orgId,
  storeId,
}: LiveMissingCostCardProps): React.ReactElement {
  const t = useTranslations('livePerformance.missingCost');
  const query = useLiveMissingCost(orgId, storeId);
  const rows = query.data?.data;

  return (
    <Card>
      <CardHeader leadingIcon={<Alert02Icon className="text-warning" />}>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="gap-md flex flex-col">
        {rows === undefined ? (
          <MissingCostTable>
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <MissingCostSkeletonRow key={index} />
            ))}
          </MissingCostTable>
        ) : rows.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <>
            <p role="status" className="text-warning text-sm">
              {t('warning', {
                count: rows.length,
                orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
              })}
            </p>
            <MissingCostTable>
              {rows.map((row) => (
                <MissingCostRowItem key={row.variantId} orgId={orgId} row={row} />
              ))}
            </MissingCostTable>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The table shell + column headers. The header band labels every column — the
 * "give the right-hand number a heading" fix — and the blocked-revenue header
 * carries an InfoHint that spells out exactly what the amount represents.
 */
function MissingCostTable({ children }: { children: React.ReactNode }): React.ReactElement {
  const t = useTranslations('livePerformance.missingCost');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-full">{t('productColumn')}</TableHead>
          <TableHead className="whitespace-nowrap">{t('stockCodeLabel')}</TableHead>
          <TableHead className="whitespace-nowrap">{t('barcodeLabel')}</TableHead>
          <TableHead className="text-right whitespace-nowrap">
            <span className="gap-3xs inline-flex items-center">
              {t('revenueImpactLabel')}
              {/* No `label` prop: it would re-announce "Bekleyen ciro" as the icon's
                  accessible name, stuttering the column header. The hint body stands
                  alone; the button falls back to the generic "Bilgi" aria-label. */}
              <InfoHint>{t('revenueImpactHint')}</InfoHint>
            </span>
          </TableHead>
          <TableHead className="text-right">
            <span className="sr-only">{t('actionColumn')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

interface MissingCostRowItemProps {
  orgId: string;
  row: MissingCostRow;
}

function MissingCostRowItem({ orgId, row }: MissingCostRowItemProps): React.ReactElement {
  const t = useTranslations('livePerformance.missingCost');
  return (
    <TableRow>
      <TableCell>
        <div className="gap-sm flex items-center">
          <ImageCell src={row.thumbUrl} alt={row.productName} size="md" />
          <div className="min-w-0">
            <p className="text-foreground line-clamp-1 text-sm font-medium">{row.productName}</p>
            <p className="text-muted-foreground text-xs">
              {t('orderCountLabel', { count: row.orderCount })}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <CopyableValue value={row.stockCode} label={t('stockCodeLabel')}>
          <span className="text-foreground font-mono text-xs">{row.stockCode}</span>
        </CopyableValue>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <CopyableValue value={row.barcode} label={t('barcodeLabel')}>
          <span className="text-foreground font-mono text-xs">{row.barcode}</span>
        </CopyableValue>
      </TableCell>
      <TableCell data-numeric>
        <Currency value={row.revenueImpact} className="text-foreground text-sm font-medium" />
      </TableCell>
      <TableCell className="text-right">
        <CostCellPopover orgId={orgId} variantId={row.variantId}>
          <Button type="button" size="sm" variant="outline" className="shrink-0">
            {t('addCostButton')}
          </Button>
        </CostCellPopover>
      </TableCell>
    </TableRow>
  );
}

function MissingCostSkeletonRow(): React.ReactElement {
  return (
    <TableRow aria-hidden>
      <TableCell>
        <div className="gap-sm flex items-center">
          <Skeleton className="size-thumb-md rounded-md" />
          <div className="gap-2xs flex flex-col">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell data-numeric>
        <Skeleton className="ml-auto h-4 w-16" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="ml-auto h-8 w-24" />
      </TableCell>
    </TableRow>
  );
}
