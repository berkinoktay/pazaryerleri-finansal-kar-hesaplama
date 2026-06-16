'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { UnmatchedVariantBadge } from '@/components/patterns/unmatched-variant-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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

import { useBufferDetail } from '../hooks/use-buffer-detail';

interface BufferOrderDetailProps {
  orgId: string;
  storeId: string;
  bufferId: string;
}

export function BufferOrderDetail({
  orgId,
  storeId,
  bufferId,
}: BufferOrderDetailProps): React.ReactElement {
  const t = useTranslations('livePerformance.orderDetail.buffer');
  const query = useBufferDetail(orgId, storeId, bufferId);

  if (query.isLoading) {
    return (
      <div className="gap-md flex flex-col">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.error !== null || query.data === undefined) {
    return (
      <Alert tone="destructive" size="md">
        <AlertDescription>{t('loadError')}</AlertDescription>
      </Alert>
    );
  }

  const detail = query.data;

  return (
    <div className="gap-md flex flex-col">
      <Alert tone="warning" size="md">
        <AlertDescription>{t('pendingNotice')}</AlertDescription>
      </Alert>
      {detail.lines.length === 0 ? (
        <EmptyState title={t('columns.product')} embedded />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.product')}</TableHead>
              <TableHead className="text-right">{t('columns.quantity')}</TableHead>
              <TableHead className="text-right">{t('columns.lineSaleGross')}</TableHead>
              <TableHead className="text-right" aria-label={t('addCost')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((line) => (
              <TableRow key={line.barcode}>
                <TableCell>
                  <div className="gap-3xs flex flex-col">
                    <span className="font-medium">{line.productName}</span>
                    {line.variantId === null ? <UnmatchedVariantBadge className="w-fit" /> : null}
                    <span className="text-2xs text-muted-foreground tabular-nums">
                      {line.barcode}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                <TableCell className="text-right">
                  <Currency value={line.lineSaleGross} />
                </TableCell>
                <TableCell className="text-right">
                  {line.variantId !== null ? (
                    <CostCellPopover orgId={orgId} variantId={line.variantId}>
                      <Button variant="outline" size="sm" data-row-action>
                        {t('addCost')}
                      </Button>
                    </CostCellPopover>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
