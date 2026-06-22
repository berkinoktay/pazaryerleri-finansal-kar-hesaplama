'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import type { ProductPricingItem } from '../api/list-product-pricing.api';

import { PricingCalculator } from './pricing-calculator';

export interface PricingPanelSheetProps {
  /** The row to price; `null` keeps the sheet closed. */
  item: ProductPricingItem | null;
  orgId: string;
  storeId: string;
  onClose: () => void;
}

/**
 * Mobile shell for the pricing calculator. The desktop surface is an inline
 * row-expand (wired in `product-pricing-table.tsx`); this Sheet is the mobile
 * counterpart, mounting the SAME `PricingCalculator` so there is one calculator
 * implementation across both shells.
 *
 * Layout mirrors `live-order-detail-sheet.tsx`: a flex column with a fixed
 * header over a `flex-1` ScrollArea, so the (tall) calculator scrolls without
 * any magic-number height. `gap-0 p-0` override the Sheet's base spacing — the
 * calculator owns its own internal padding.
 */
export function PricingPanelSheet({
  item,
  orgId,
  storeId,
  onClose,
}: PricingPanelSheetProps): React.ReactElement {
  const t = useTranslations('features.productPricing.panel');

  return (
    <Sheet
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        variant="floating"
        className="max-w-sheet sm:max-w-sheet-wide flex w-3/4 flex-col gap-0 p-0"
      >
        <SheetHeader className="px-lg pt-lg pb-md">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-lg pb-lg">
            {item !== null ? (
              <PricingCalculator item={item} orgId={orgId} storeId={storeId} onClose={onClose} />
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
