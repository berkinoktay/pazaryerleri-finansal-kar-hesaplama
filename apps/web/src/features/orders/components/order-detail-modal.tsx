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
      {/* order-detail-modal (tokens/components.css) caps width/height with
          viewport-relative values — a CSS class, not a Tailwind max-* utility,
          per the .image-modal-img escape hatch. gap-0 p-0 override DialogContent's
          base gap-md/p-lg so the header and scroll body own their own padding. */}
      <DialogContent className="order-detail-modal flex flex-col gap-0 overflow-hidden p-0">
        {/* shrink-0 header stays put; the body is a native overflow-y-auto flex
            child (flex-1 + min-h-0) — bulletproof scroll in a max-height dialog
            without relying on percentage-height resolution. The scrollbar is
            token-styled globally (globals.css), so it matches the design system. */}
        <DialogHeader className="px-lg pt-lg pb-md shrink-0">
          <DialogTitle>{order.title}</DialogTitle>
          <DialogDescription>
            {formatter.dateTime(new Date(order.orderDate), 'long')}
          </DialogDescription>
        </DialogHeader>
        <div className="px-lg pb-lg min-h-0 flex-1 overflow-y-auto">
          <OrderDetailClient orgId={orgId} storeId={storeId} orderId={order.id} chrome="modal" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
