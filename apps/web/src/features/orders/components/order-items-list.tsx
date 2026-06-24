'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { ImageCell } from '@/components/patterns/image-cell';
import { UnmatchedVariantBadge } from '@/components/patterns/unmatched-variant-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { type OrderItemDetail } from '../api/get-order.api';

export interface OrderItemsListProps {
  items: OrderItemDetail[];
  /**
   * Profit-excluded order (spec 2026-06-12): the cost cell shows a neutral
   * "out of profit scope" note instead of the "cost missing" warning — the
   * window closed, nothing to fill.
   */
  profitExcluded?: boolean;
}

/**
 * Per-line order items as image cards (replaces the dense table in the detail
 * surface). Each card shows the product thumbnail (productImageUrl already on
 * the wire), variant identity, the GROSS sale total, commission, and the cost
 * snapshot. No per-item profit — profit is order-level, in the breakdown.
 */
export function OrderItemsList({
  items,
  profitExcluded = false,
}: OrderItemsListProps): React.ReactElement {
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
          <ul className="gap-sm flex flex-col">
            {items.map((item) => {
              // Variant barkodu önceliklidir; eşleşmemiş satırda kalem-düzeyi barkod.
              const displayBarcode = item.variant?.barcode ?? item.barcode;
              return (
                <li
                  key={item.id}
                  className="border-border gap-md p-md flex items-start rounded-md border"
                >
                  <ImageCell
                    src={item.variant?.productImageUrl ?? null}
                    alt={item.variant?.productName ?? t('unknownVariant')}
                    size="lg"
                  />
                  <div className="gap-2xs flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">
                      {item.variant?.productName ?? t('unknownVariant')}
                    </span>
                    {item.variant === null ? (
                      <UnmatchedVariantBadge className="w-fit" vendorMissing={item.vendorMissing} />
                    ) : null}
                    {displayBarcode !== null ? (
                      <span className="text-2xs text-muted-foreground tabular-nums">
                        {displayBarcode}
                      </span>
                    ) : null}
                    <div className="gap-md mt-3xs flex flex-wrap items-center text-xs">
                      <span className="text-muted-foreground">
                        {t('columns.quantity')}:{' '}
                        <span className="text-foreground tabular-nums">
                          {formatter.number(item.quantity, 'integer')}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {t('columns.commissionGross')}:{' '}
                        <Currency className="text-foreground" value={item.commissionGross} />
                      </span>
                      <span className="text-muted-foreground">
                        {t('columns.unitCostSnapshotGross')}:{' '}
                        {item.unitCostSnapshotGross !== null ? (
                          <Currency
                            className="text-foreground"
                            value={item.unitCostSnapshotGross}
                          />
                        ) : profitExcluded ? (
                          <span className="text-muted-foreground">{t('costFrozen')}</span>
                        ) : (
                          <span className="text-warning">{t('costMissing')}</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <Currency className="shrink-0" value={item.lineSaleGross} emphasis />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
