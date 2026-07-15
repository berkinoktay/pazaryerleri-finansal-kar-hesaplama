'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useDiscountReasonEmptyLabel } from '../hooks/use-discount-reason-label';
import type { DiscountRow } from '../lib/adapt-discount-list';
import { DiscountBuyboxBadge } from './discount-buybox-badge';
import type { DiscountScenarioKey } from './discount-items-table';
import { ProfitDelta } from './profit-delta';

export interface DiscountItemsMobileCardsProps {
  rows: readonly DiscountRow[];
  selectionsPending: boolean;
  onToggleInclude: (itemId: string, included: boolean) => void;
  onOpenBreakdown: (row: DiscountRow, scenario: DiscountScenarioKey) => void;
}

/**
 * Mobile layout for the İndirimler detail — one card per product as a TOP-TO-BOTTOM flow so
 * nothing competes horizontally. Full data parity with the desktop table: the participation
 * checkbox + identity + buybox on top, then the CURRENT and DISCOUNTED price scenarios (price +
 * clickable profit badge, plus the discounted scenario's commission source and the "güncele
 * göre" delta). Shown below the `md` breakpoint; the desktop table is hidden there.
 */
export function DiscountItemsMobileCards({
  rows,
  selectionsPending,
  onToggleInclude,
  onOpenBreakdown,
}: DiscountItemsMobileCardsProps): React.ReactElement {
  const t = useTranslations('discountsPage.table');
  const tSource = useTranslations('discountsPage.commissionSource');
  const reasonEmptyLabel = useDiscountReasonEmptyLabel();
  const scale = useMarginColoring();

  const sourceLabel: Record<'band' | 'product' | 'category', string> = {
    band: tSource('band'),
    product: tSource('product'),
    category: tSource('category'),
  };

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [row.brand, row.color, row.modelCode]
          .filter((value): value is string => value !== null && value !== '')
          .join(' · ');
        const source = row.discounted.commissionSource;
        const emptyLabel = reasonEmptyLabel(row.reason);
        return (
          <div
            key={row.id}
            className="border-border bg-card gap-md p-md flex flex-col rounded-lg border"
          >
            {/* Identity — checkbox + image + title/meta + buybox. */}
            <div className="gap-sm flex min-w-0 items-start">
              <Checkbox
                checked={row.included}
                disabled={selectionsPending}
                aria-label={t('includeRow')}
                onCheckedChange={(next) => onToggleInclude(row.id, next === true)}
                className="mt-3xs cursor-pointer"
              />
              <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="xl" fit="contain" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium">{row.productTitle}</div>
                <div className="text-2xs text-muted-foreground mt-3xs tabular-nums">
                  {meta !== '' ? <span>{meta}</span> : null}
                  {meta !== '' ? <span> · </span> : null}
                  <span>{row.barcode}</span>
                </div>
                <div className="mt-2xs flex">
                  <DiscountBuyboxBadge status={row.buyboxStatus} />
                </div>
              </div>
            </div>

            {/* Current baseline. */}
            <div className="border-border pt-md gap-2xs flex flex-col border-t">
              <span className="text-2xs text-muted-foreground font-medium">
                {t('currentPrice')}
              </span>
              <div className="gap-sm flex items-center justify-between">
                <Currency value={row.current.price} className="text-sm font-medium" />
                <ProfitBadge
                  value={row.current.netProfit}
                  marginPct={row.current.marginPct}
                  scale={scale}
                  onOpen={() => onOpenBreakdown(row, 'current')}
                  emptyLabel={emptyLabel}
                />
              </div>
            </div>

            {/* Discounted scenario — price + profit + commission source + delta. */}
            <div className="border-border pt-md gap-2xs flex flex-col border-t">
              <span className="text-2xs text-muted-foreground font-medium">
                {t('discountedPrice')}
              </span>
              <div className="gap-sm flex items-center justify-between">
                <Currency value={row.discounted.price} className="text-sm font-medium" />
                <ProfitBadge
                  value={row.discounted.netProfit}
                  marginPct={row.discounted.marginPct}
                  scale={scale}
                  onOpen={() => onOpenBreakdown(row, 'discounted')}
                  emptyLabel={emptyLabel}
                />
              </div>
              {source !== null ? (
                <span className="text-2xs text-muted-foreground">{sourceLabel[source]}</span>
              ) : null}
              <ProfitDelta
                optionNetProfit={row.discounted.netProfit}
                currentNetProfit={row.current.netProfit}
                label={t('delta')}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
