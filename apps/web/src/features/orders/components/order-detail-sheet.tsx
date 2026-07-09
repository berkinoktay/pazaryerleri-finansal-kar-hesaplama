'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { OrderDetailClient } from './order-detail-client';

export interface OrderDetailSelection {
  id: string;
  /** Header title — platform order number (falls back to the platform id). */
  title: string;
  /** ISO order date for the header subtitle. */
  orderDate: string;
}

interface OrderDetailSheetProps {
  orgId: string;
  storeId: string;
  /** The selected order, or null when the sheet is closed. */
  order: OrderDetailSelection | null;
  onClose: () => void;
}

/**
 * In-page order detail as a right-side Sheet, opened from an orders-table profit
 * badge so the seller never leaves the list (no route change) and the list stays
 * visible beside the panel. Reuses the canonical OrderDetailClient in modal
 * chrome — the same profit-led composition Live Performance renders. Flex column:
 * a fixed header over a `flex-1` ScrollArea, so the header stays put while the
 * body scrolls. Width comes from the sheet tokens (max-w-sheet-wide), never
 * arbitrary values.
 */
export function OrderDetailSheet({
  orgId,
  storeId,
  order,
  onClose,
}: OrderDetailSheetProps): React.ReactElement | null {
  const formatter = useFormatter();
  const t = useTranslations('orderDetail');

  if (order === null) return null;

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* flex column: fixed header + flex-1 scroll body — no magic-number height.
          gap-0 p-0 override SheetContent's base gap-md/p-lg so the header and the
          scroll body own their own padding (mirrors LiveOrderDetailSheet). */}
      <SheetContent
        side="right"
        variant="floating"
        className="max-w-sheet-detail flex w-3/4 flex-col gap-0 p-0"
      >
        <SheetHeader className="px-lg pt-lg pb-md gap-3xs">
          <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            {t('sheetNumberLabel')}
          </span>
          <SheetTitle className="tabular-nums">{order.title}</SheetTitle>
          <SheetDescription className="tabular-nums">
            {formatter.dateTime(new Date(order.orderDate), 'long')}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-lg pb-lg">
            <OrderDetailClient orgId={orgId} storeId={storeId} orderId={order.id} chrome="modal" />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
