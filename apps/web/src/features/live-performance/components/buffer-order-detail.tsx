'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Tick02Icon } from 'hugeicons-react';
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
import { DesiCellPopover } from '@/features/products/components/desi-cell-popover';
import { ApiError } from '@/lib/api-error';

import { useBufferDetail } from '../hooks/use-buffer-detail';
import { liveKeys } from '../query-keys';

interface BufferOrderDetailProps {
  orgId: string;
  storeId: string;
  bufferId: string;
}

/**
 * Lines of a pending (buffer) order. Each resolved line shows only what it is
 * still missing (cost, desi, or both; flags come from the backend), else a
 * quiet "ready" mark; an unresolved line shows only the unmatched badge. A
 * cost or desi saved here refreshes the live queries directly: while the
 * order still waits on another input its buffer row does not change, so no
 * realtime event arrives.
 */
export function BufferOrderDetail({
  orgId,
  storeId,
  bufferId,
}: BufferOrderDetailProps): React.ReactElement {
  const t = useTranslations('livePerformance.orderDetail.buffer');
  const tCommon = useTranslations('common');
  const query = useBufferDetail(orgId, storeId, bufferId);
  const queryClient = useQueryClient();
  const refreshLive = React.useCallback(
    () => void queryClient.invalidateQueries({ queryKey: liveKeys.all }),
    [queryClient],
  );

  if (query.isLoading) {
    // Mirrors the loaded layout: a single-line Alert bar, then a table stub
    // (one header line + a few row-height lines) so nothing shifts on load.
    return (
      <div role="status" aria-busy aria-label={tCommon('loading')} className="gap-md flex flex-col">
        <Skeleton radius="lg" className="h-12 w-full" />
        <div className="gap-sm flex flex-col">
          <Skeleton className="h-4 w-2/5" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // A 404 means the worker promoted the order and deleted its buffer entry
  // (typically right after the last missing input was entered here); the page
  // then follows the Sheet to the order's new row. Not a failure, so no error.
  if (query.error instanceof ApiError && query.error.code === 'NOT_FOUND') {
    return (
      <Alert tone="info" size="md">
        <AlertDescription>{t('noLongerWaiting')}</AlertDescription>
      </Alert>
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
  // Every line has its cost and desi: the order is about to be promoted.
  const isReady =
    detail.lines.length > 0 &&
    detail.lines.every((l) => !l.isCostMissing && !l.isDimensionalWeightMissing);

  return (
    <div className="gap-md flex flex-col">
      {isReady ? (
        <Alert tone="info" size="md">
          <AlertDescription>{t('readyNotice')}</AlertDescription>
        </Alert>
      ) : (
        <Alert tone="warning" size="md">
          <AlertDescription>{t('pendingNotice')}</AlertDescription>
        </Alert>
      )}
      {detail.lines.length === 0 ? (
        <EmptyState title={t('columns.product')} embedded />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.product')}</TableHead>
              <TableHead className="text-right">{t('columns.quantity')}</TableHead>
              <TableHead className="text-right">{t('columns.lineSaleGross')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((line) => (
              <TableRow key={line.barcode}>
                <TableCell>
                  <div className="gap-3xs flex flex-col">
                    <span className="font-medium">{line.productName}</span>
                    {line.variantId === null ? (
                      <UnmatchedVariantBadge className="w-fit" />
                    ) : (
                      <div className="gap-xs flex flex-wrap items-center">
                        {line.isCostMissing ? (
                          <CostCellPopover
                            orgId={orgId}
                            storeId={storeId}
                            variantId={line.variantId}
                            onChanged={refreshLive}
                          >
                            <Button variant="outline" size="sm" data-row-action>
                              {t('addCost')}
                            </Button>
                          </CostCellPopover>
                        ) : null}
                        {line.isDimensionalWeightMissing ? (
                          <DesiCellPopover
                            orgId={orgId}
                            storeId={storeId}
                            variant={{
                              id: line.variantId,
                              dimensionalWeight: line.dimensionalWeight,
                              syncedDimensionalWeight: line.syncedDimensionalWeight,
                              isDimensionalWeightOverridden: line.isDimensionalWeightOverridden,
                            }}
                            onSaved={refreshLive}
                          >
                            <Button variant="outline" size="sm" data-row-action>
                              {t('addDesi')}
                            </Button>
                          </DesiCellPopover>
                        ) : null}
                        {!line.isCostMissing && !line.isDimensionalWeightMissing ? (
                          <span className="text-muted-foreground gap-3xs inline-flex items-center text-xs">
                            <Tick02Icon aria-hidden className="size-icon-xs text-success" />
                            {t('lineReady')}
                          </span>
                        ) : null}
                      </div>
                    )}
                    <span className="text-2xs text-muted-foreground tabular-nums">
                      {line.barcode}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                <TableCell className="text-right">
                  <Currency value={line.lineSaleGross} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
