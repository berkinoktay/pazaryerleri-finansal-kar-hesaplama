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

import { UnmatchedVariantBadge } from '@/components/patterns/unmatched-variant-badge';

export interface OrderItemsTableProps {
  items: OrderItemDetail[];
  /**
   * Kâr-dışı sipariş (spec 2026-06-12): maliyet hücresi "Maliyet eksik" uyarısı
   * yerine nötr "Kâr hesabı dışı" gösterir — pencere kapandı, doldurulacak bir
   * eksik yok (eski satır-bazlı maliyet girişi K2 ile kalktı).
   */
  profitExcluded?: boolean;
}

/**
 * Per-line OrderItem grid. Each row exposes the variant identity (barcode +
 * marketplace code) plus the GROSS (KDV-dahil) sale/commission split and the
 * cost snapshot — NO per-item profit/margin (kâr sipariş-seviyesinde, dökümde).
 * The table uses the ui/ primitives directly — DataTable is overkill here (no
 * sorting, no pagination, no row-click navigation; the order detail is
 * already the deepest level).
 */
export function OrderItemsTable({
  items,
  profitExcluded = false,
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
                <TableHead className="text-right">{t('columns.lineSaleGross')}</TableHead>
                <TableHead className="text-right">{t('columns.commissionGross')}</TableHead>
                <TableHead className="text-right">{t('columns.refundedCommissionGross')}</TableHead>
                <TableHead className="text-right">{t('columns.unitCostSnapshotGross')}</TableHead>
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
                      <Currency value={item.lineSaleGross} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Currency value={item.commissionGross} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Currency value={item.refundedCommissionGross} dimWhenZero />
                    </TableCell>
                    <TableCell className="text-right">
                      {item.unitCostSnapshotGross !== null ? (
                        <Currency value={item.unitCostSnapshotGross} />
                      ) : profitExcluded ? (
                        <span className="text-muted-foreground">{t('costFrozen')}</span>
                      ) : (
                        <span className="text-warning">{t('costMissing')}</span>
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
