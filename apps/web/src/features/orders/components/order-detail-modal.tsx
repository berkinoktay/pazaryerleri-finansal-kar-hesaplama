'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

import { OrderDetailClient } from './order-detail-client';

export interface OrderDetailModalSelection {
  id: string;
  /** Header title — platform order number (falls back to the platform id). */
  title: string;
  /** ISO order date for the header subtitle. */
  orderDate: string;
}

interface OrderDetailModalProps {
  orgId: string;
  storeId: string;
  /** The selected order, or null when the modal is closed. */
  order: OrderDetailModalSelection | null;
  onClose: () => void;
}

/**
 * In-page order detail as a wide centered modal, opened from an orders-table
 * row so the seller never leaves the list (no route change). Reuses the
 * canonical OrderDetailClient in modal chrome — the same composition Live
 * Performance uses with a Sheet. Fixed-height flex column: the header stays put
 * while the dense body scrolls. Width / height come from the M1 tokens
 * (max-w-modal-wide / max-h-modal-tall), never arbitrary values.
 */
export function OrderDetailModal({
  orgId,
  storeId,
  order,
  onClose,
}: OrderDetailModalProps): React.ReactElement | null {
  const formatter = useFormatter();

  if (order === null) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* gap-0 p-0 override DialogContent's base gap-md/p-lg so the header and the
          scroll body own their own padding (cn extends twMerge with the custom
          spacing scale, so the overrides win — feedback_cn_twmerge_custom_spacing). */}
      <DialogContent className="max-w-modal-wide max-h-modal-tall flex w-full flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-lg pt-lg pb-md">
          <DialogTitle>{order.title}</DialogTitle>
          <DialogDescription>
            {formatter.dateTime(new Date(order.orderDate), 'long')}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-lg pb-lg">
            <OrderDetailClient orgId={orgId} storeId={storeId} orderId={order.id} chrome="modal" />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
