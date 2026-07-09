'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { UnmatchedVariantBadge } from '@/components/patterns/unmatched-variant-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPercentDisplay } from '@/lib/format-percent';

import { type OrderItemDetail } from '../api/get-order.api';

export interface OrderItemsListProps {
  items: OrderItemDetail[];
  /**
   * Profit-excluded order (spec 2026-06-12): the cost cell shows a neutral
   * "out of profit scope" note instead of the "cost missing" warning.
   */
  profitExcluded?: boolean;
}

/**
 * Siparişteki ürünler — resimleriyle zengin kartlar. Her satır: ürün görseli
 * (tıkla→tam ekran), ad + sağda satır satışı, barkod, ve hizalı 3-sütun meta
 * (adet · birim maliyet · komisyon). Per-item kâr YOK (kâr sipariş düzeyinde).
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
        <div className="gap-xs flex items-baseline justify-between">
          <CardTitle>{t('title')}</CardTitle>
          {items.length > 0 ? (
            <span className="text-2xs text-muted-foreground tabular-nums">
              {t('count', { count: items.length })}
            </span>
          ) : null}
        </div>
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
                  className="border-border gap-md p-md hover:bg-row-hover flex items-start rounded-md border transition-colors"
                >
                  <ProductImageCell
                    url={item.variant?.productImageUrl ?? null}
                    alt={item.variant?.productName ?? t('unknownVariant')}
                    size="lg"
                  />
                  <div className="gap-2xs flex min-w-0 flex-1 flex-col">
                    <div className="gap-sm flex items-start justify-between">
                      <span className="text-sm font-medium">
                        {item.variant?.productName ?? t('unknownVariant')}
                      </span>
                      <Currency
                        className="shrink-0 text-base font-semibold"
                        value={item.lineSaleGross}
                      />
                    </div>
                    {item.variant === null ? (
                      <UnmatchedVariantBadge className="w-fit" vendorMissing={item.vendorMissing} />
                    ) : null}
                    {displayBarcode !== null ? (
                      <span className="text-2xs gap-xs flex items-baseline">
                        <span className="text-muted-foreground">{t('barcode')}</span>
                        <span className="text-foreground tabular-nums">{displayBarcode}</span>
                      </span>
                    ) : null}
                    <div className="border-border-muted gap-x-md gap-y-sm mt-xs pt-sm grid grid-cols-2 border-t">
                      <MetaCol
                        label={t('meta.quantity')}
                        value={formatter.number(item.quantity, 'integer')}
                      />
                      <MetaCol
                        label={t('meta.cost')}
                        value={
                          item.unitCostSnapshotGross !== null ? (
                            <Currency value={item.unitCostSnapshotGross} />
                          ) : profitExcluded ? (
                            <span className="text-muted-foreground">{t('costFrozen')}</span>
                          ) : (
                            <span className="text-warning">{t('costMissing')}</span>
                          )
                        }
                      />
                      <MetaCol
                        label={t('meta.commissionRate')}
                        value={formatPercentDisplay(item.commissionRate)}
                      />
                      <MetaCol
                        label={t('meta.commissionAmount')}
                        value={<Currency value={item.commissionGross} />}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MetaCol({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="gap-3xs flex min-w-0 flex-col">
      <span className="text-2xs text-muted-foreground truncate">{label}</span>
      <span className="text-foreground truncate text-sm tabular-nums">{value}</span>
    </div>
  );
}
