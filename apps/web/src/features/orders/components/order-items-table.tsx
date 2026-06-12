'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { type OrderItemDetail } from '../api/get-order.api';

import { UnmatchedVariantBadge } from './unmatched-variant-badge';

export interface OrderItemsTableProps {
  items: OrderItemDetail[];
  /**
   * Optional per-item override for the cost cell. When provided, replaces the
   * read-only cost snapshot cell - used by the live-performance order-detail Sheet
   * to inject inline per-item cost entry without orders importing live-performance.
   */
  renderCostCell?: (item: OrderItemDetail) => React.ReactNode;
}

/**
 * Per-line OrderItem grid. Each row exposes the variant identity (barcode +
 * marketplace code) plus the net+VAT split and the cost snapshot. The table
 * uses the ui/ primitives directly — DataTable is overkill here (no
 * sorting, no pagination, no row-click navigation; the order detail is
 * already the deepest level).
 */
export function OrderItemsTable({
  items,
  renderCostCell,
}: OrderItemsTableProps): React.ReactElement {
  const t = useTranslations('orderDetail.items');
  const formatter = useFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title={t('empty.title')} description={t('empty.description')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.variant')}</TableHead>
                <TableHead className="text-right">{t('columns.quantity')}</TableHead>
                <TableHead className="text-right">{t('columns.unitPriceNet')}</TableHead>
                <TableHead className="text-right">{t('columns.grossCommissionNet')}</TableHead>
                <TableHead className="text-right">{t('columns.refundedCommissionNet')}</TableHead>
                <TableHead className="text-right">{t('columns.unitCostSnapshotNet')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                // Variant barkodu önceliklidir; eşleşmemiş satırda kalem-düzeyi
                // barkod tek ürün izidir (PR-1 her zaman yazar).
                const displayBarcode = item.variant?.barcode ?? item.barcode;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="gap-3xs flex flex-col">
                        <span className="font-medium">
                          {item.variant?.productName ?? t('unknownVariant')}
                        </span>
                        {item.variant === null ? <UnmatchedVariantBadge className="w-fit" /> : null}
                        {displayBarcode !== null ? (
                          <span className="text-2xs text-muted-foreground tabular-nums">
                            {displayBarcode}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatter.number(item.quantity, 'integer')}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.unitPriceNet === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Currency value={item.unitPriceNet} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Currency value={item.grossCommissionAmountNet} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Currency value={item.refundedCommissionAmountNet} dimWhenZero />
                    </TableCell>
                    <TableCell className="text-right">
                      {renderCostCell !== undefined ? (
                        renderCostCell(item)
                      ) : item.unitCostSnapshotNet === null ? (
                        <span className="text-warning">{t('costMissing')}</span>
                      ) : (
                        <Currency value={item.unitCostSnapshotNet} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
