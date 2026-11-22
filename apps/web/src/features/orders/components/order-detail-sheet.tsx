'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

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
 * a fixed header over a `flex-1` scroll body, so the header stays put while the
 * body scrolls. Width comes from the sheet tokens (max-w-sheet-detail), never
 * arbitrary values; on a phone the sheet spans the screen between the floating
 * insets so the profit cards have room.
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
      {/* Phone: left-xs + w-auto stretch the floating sheet between both insets; ml-auto
          keeps it on the right edge once max-w caps it. sm+: back to three quarters. */}
      <SheetContent
        side="right"
        variant="floating"
        className="max-w-sheet-detail sm:max-w-sheet-detail left-xs ml-auto flex w-auto flex-col gap-0 p-0 sm:left-auto sm:w-3/4"
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
        {/* A plain overflow body, not ScrollArea: Radix wraps ScrollArea content in a
            display:table box that grows to the content's min-content width, so one
            unbreakable line widened the whole body past a phone-width sheet and clipped
            its right edge. A block body is never wider than the sheet. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-lg pb-lg">
            <OrderDetailClient orgId={orgId} storeId={storeId} orderId={order.id} chrome="modal" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
