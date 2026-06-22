'use client';

import { Tag01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ImageCell } from '@/components/patterns/image-cell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { ProductPricingItem } from '../api/list-product-pricing.api';

import { LabeledIdentifier } from './labeled-identifier';
import { PricingStatusChip } from './pricing-status-chip';

const EMPTY_VALUE = '—';
const SKELETON_COUNT = 8;

// Same auto-fill grid idiom as StatGroup — a tokenized minmax so the gallery
// reflows from a single column on mobile up to as many as fit, no device-ladder
// breakpoints. The min track references the shared `--spacing-tile-min-sm`
// (220px) token so cards stay legible while packing densely.
const GALLERY_GRID =
  'gap-md grid grid-cols-[repeat(auto-fill,minmax(var(--spacing-tile-min-sm),1fr))]';

interface ProductPricingCardsProps {
  rows: ProductPricingItem[];
  loading: boolean;
  /** First-run / no-matches / error states — same nodes the table consumes. */
  state?: React.ReactNode;
  /** Fires with the row's variantId — carried to the future pricing panel. */
  onPriceRow: (variantId: string) => void;
}

/**
 * Gallery card view for forward pricing. Each card leads with a large product
 * image, then the name, the labeled/copyable identifiers, a prominent profit
 * area (Kâr ₺ + Marj %), the sale price, the quiet-when-healthy status chip,
 * and the "Fiyatla" stub action. Mirrors the table's data + interactions so
 * the two views are interchangeable; the page client owns pagination + state.
 */
export function ProductPricingCards({
  rows,
  loading,
  state,
  onPriceRow,
}: ProductPricingCardsProps): React.ReactElement {
  const t = useTranslations('features.productPricing');
  const tIdentifiers = useTranslations('features.productPricing.identifiers');

  if (loading) {
    return (
      <div className={GALLERY_GRID}>
        {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
          <ProductPricingCardSkeleton key={`pricing-card-skeleton-${index}`} />
        ))}
      </div>
    );
  }

  // Reuse the table's empty / no-results / error nodes inside the same bordered
  // shell the table uses, so the page reads consistently across views.
  if (rows.length === 0 && state !== undefined) {
    return (
      <div className="border-border bg-card rounded-lg border">
        <div className="min-h-table-empty flex items-center justify-center">{state}</div>
      </div>
    );
  }

  return (
    <div className={GALLERY_GRID}>
      {rows.map((item) => (
        <ProductPricingCard
          key={item.variantId}
          item={item}
          priceLabel={t('action.price')}
          priceAriaLabel={t('action.ariaLabel')}
          skuLabel={tIdentifiers('sku')}
          barcodeLabel={tIdentifiers('barcode')}
          salePriceLabel={t('columns.salePrice')}
          profitLabel={t('columns.netProfit')}
          marginLabel={t('columns.saleMarginPct')}
          onPriceRow={onPriceRow}
        />
      ))}
    </div>
  );
}

interface ProductPricingCardProps {
  item: ProductPricingItem;
  priceLabel: string;
  priceAriaLabel: string;
  skuLabel: string;
  barcodeLabel: string;
  salePriceLabel: string;
  profitLabel: string;
  marginLabel: string;
  onPriceRow: (variantId: string) => void;
}

function ProductPricingCard({
  item,
  priceLabel,
  priceAriaLabel,
  skuLabel,
  barcodeLabel,
  salePriceLabel,
  profitLabel,
  marginLabel,
  onPriceRow,
}: ProductPricingCardProps): React.ReactElement {
  const hasProfit = item.netProfit !== null;
  const isPositive = hasProfit && !item.netProfit?.startsWith('-');

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      {/* Square image header — aspect-square keeps every card the same height
          regardless of marketplace image ratio. */}
      <div className="bg-muted aspect-square w-full">
        <ImageCell
          src={item.imageUrl}
          alt={item.productName}
          size="xl"
          className="size-full rounded-none"
        />
      </div>
      <CardContent className="p-md gap-sm flex flex-1 flex-col">
        <span className="text-foreground line-clamp-2 text-sm leading-snug font-medium">
          {item.productName}
        </span>

        <div className="gap-y-3xs flex flex-col">
          <LabeledIdentifier label={skuLabel} value={item.sku} />
          <LabeledIdentifier label={barcodeLabel} value={item.barcode} />
        </div>

        {/* Prominent profit area: Kâr ₺ headline + Marj % beside it. Tone reads
            success when profitable, destructive when negative, muted dash when
            uncostable. */}
        <div className="border-border gap-3xs pt-sm mt-auto flex flex-col border-t">
          <span className="text-muted-foreground text-2xs">{profitLabel}</span>
          <div className="gap-sm flex items-baseline justify-between">
            {hasProfit ? (
              <Currency
                value={item.netProfit ?? '0'}
                emphasis
                className={cn('text-lg', isPositive ? 'text-success' : 'text-destructive')}
              />
            ) : (
              <span className="text-muted-foreground-dim text-lg font-semibold tabular-nums">
                {EMPTY_VALUE}
              </span>
            )}
            <span className="text-muted-foreground text-2xs tabular-nums">
              {marginLabel} {item.saleMarginPct !== null ? `${item.saleMarginPct}%` : EMPTY_VALUE}
            </span>
          </div>
        </div>

        <div className="gap-sm flex items-center justify-between">
          <span className="text-muted-foreground text-2xs gap-2xs flex items-baseline">
            {salePriceLabel}
            <Currency value={item.salePrice} className="text-foreground text-xs" />
          </span>
          <PricingStatusChip item={item} />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          aria-label={priceAriaLabel}
          onClick={() => onPriceRow(item.variantId)}
        >
          <Tag01Icon aria-hidden className="size-icon-xs" />
          {priceLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

function ProductPricingCardSkeleton(): React.ReactElement {
  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <Skeleton className="aspect-square w-full rounded-none" radius="none" />
      <CardContent className="p-md gap-sm flex flex-col">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}
