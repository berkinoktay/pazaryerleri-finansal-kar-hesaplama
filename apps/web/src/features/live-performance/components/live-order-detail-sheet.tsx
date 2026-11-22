'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { OrderDetailClient } from '@/features/orders/components/order-detail-client';

import type { LiveOrderRow } from '../api/get-live-orders.api';
import { BufferOrderDetail } from './buffer-order-detail';

interface LiveOrderDetailSheetProps {
  orgId: string;
  storeId: string;
  selected: LiveOrderRow | null;
  onClose: () => void;
}

/**
 * In-page detail Sheet for the live-performance order feed.
 *
 * Two order kinds drive two detail flavors:
 * - source='orders': reuses the canonical OrderDetailClient in modal chrome —
 *   read-only money cells; the late per-item cost entry was removed by spec
 *   2026-06-12 (K2): a persisted order is either CALCULATED or EXCLUDED.
 * - source='buffer': shows BufferOrderDetail with the enriched buffer lines,
 *   the midnight deadline notice, and variant-level cost-profile attach via
 *   CostCellPopover (attach → flip → promote chain).
 *
 * Layout: SheetContent as flex column (fixed header + flex-1 scroll body) with
 * no arbitrary height values -- token-free flex layout fills remaining height.
 * On a phone the sheet spans the screen between the floating insets.
 */
export function LiveOrderDetailSheet({
  orgId,
  storeId,
  selected,
  onClose,
}: LiveOrderDetailSheetProps): React.ReactElement | null {
  const formatter = useFormatter();

  if (selected === null) return null;

  const title = selected.platformOrderNumber ?? selected.platformOrderId;

  let body: React.ReactNode = null;
  if (selected.source === 'orders' && selected.orderId !== null) {
    body = (
      <OrderDetailClient
        orgId={orgId}
        storeId={storeId}
        orderId={selected.orderId}
        chrome="modal"
      />
    );
  } else if (selected.source === 'buffer' && selected.bufferId !== null) {
    body = <BufferOrderDetail orgId={orgId} storeId={storeId} bufferId={selected.bufferId} />;
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* flex column: fixed header + flex-1 scroll body -- no magic-number height.
          gap-0 p-0 override SheetContent's base gap-md/p-lg (cn extends twMerge with
          the custom spacing scale, so the overrides win -- feedback_cn_twmerge_custom_spacing).
          Phone: left-xs + w-auto stretch the floating sheet between both insets; ml-auto
          keeps it on the right edge once max-w caps it. sm+: back to three quarters. */}
      <SheetContent
        side="right"
        variant="floating"
        className="max-w-sheet-wide left-xs ml-auto flex w-auto flex-col gap-0 p-0 sm:left-auto sm:w-3/4"
      >
        <SheetHeader className="px-lg pt-lg pb-md">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {formatter.dateTime(new Date(selected.orderDate), 'long')}
          </SheetDescription>
        </SheetHeader>
        {/* A plain overflow body, not ScrollArea: Radix wraps ScrollArea content in a
            display:table box that grows to the content's min-content width, so one
            unbreakable line widened the whole body past a phone-width sheet and clipped
            its right edge. A block body is never wider than the sheet. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-lg pb-lg">{body}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
