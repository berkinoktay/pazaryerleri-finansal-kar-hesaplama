'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useFormatter } from 'next-intl';
import * as React from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CostEntryCell } from '@/features/orders/components/cost-entry-cell';
import { OrderDetailClient } from '@/features/orders/components/order-detail-client';

import type { LiveOrderRow } from '../api/get-live-orders.api';
import { liveKeys } from '../query-keys';
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
 * - source='orders': reuses the canonical OrderDetailClient in modal chrome,
 *   injecting CostEntryCell as the per-item cost render-prop so the orders
 *   feature never imports live-performance (boundary-clean).
 * - source='buffer': shows BufferOrderDetail with the enriched buffer lines
 *   and variant-level cost entry via CostCellPopover.
 *
 * Layout: SheetContent as flex column (fixed header + flex-1 ScrollArea) with
 * no arbitrary height values -- token-free flex layout fills remaining height.
 */
export function LiveOrderDetailSheet({
  orgId,
  storeId,
  selected,
  onClose,
}: LiveOrderDetailSheetProps): React.ReactElement | null {
  const formatter = useFormatter();
  const queryClient = useQueryClient();

  if (selected === null) return null;

  const title = selected.platformOrderNumber ?? selected.platformOrderId;

  // Narrow the id into a const so the render-prop closure captures a string
  // (TS widens `selected.orderId` back to string|null inside the closure).
  let body: React.ReactNode = null;
  if (selected.source === 'orders' && selected.orderId !== null) {
    const orderId = selected.orderId;
    body = (
      <OrderDetailClient
        orgId={orgId}
        storeId={storeId}
        orderId={orderId}
        chrome="modal"
        renderItemCostCell={(item) => (
          <CostEntryCell
            orgId={orgId}
            storeId={storeId}
            orderId={orderId}
            item={item}
            onCosted={() => queryClient.invalidateQueries({ queryKey: liveKeys.all })}
          />
        )}
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
          the custom spacing scale, so the overrides win -- feedback_cn_twmerge_custom_spacing). */}
      <SheetContent
        side="right"
        variant="floating"
        className="max-w-sheet-wide flex w-3/4 flex-col gap-0 p-0"
      >
        <SheetHeader className="px-lg pt-lg pb-md">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {formatter.dateTime(new Date(selected.orderDate), 'long')}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-lg pb-lg">{body}</div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
