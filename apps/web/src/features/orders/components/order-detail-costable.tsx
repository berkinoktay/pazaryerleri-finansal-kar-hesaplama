'use client';

import * as React from 'react';

import { CostEntryCell } from './cost-entry-cell';
import { OrderDetailClient } from './order-detail-client';

interface OrderDetailCostableProps {
  orgId: string | null;
  storeId: string | null;
  orderId: string;
}

/**
 * Client wrapper that makes the canonical order detail editable on the
 * /orders/[orderId] page: it renders OrderDetailClient in full page chrome and
 * injects CostEntryCell as the per-item cost render-prop. This is the worklist's
 * costing surface — a Maliyet Bekleyen row navigates here, the seller costs each
 * cost-missing item, and once the last item is filled the order graduates into
 * the ledger. No liveKeys invalidation: costing a past-day order never affects
 * today's live-performance view.
 */
export function OrderDetailCostable({
  orgId,
  storeId,
  orderId,
}: OrderDetailCostableProps): React.ReactElement {
  const renderItemCostCell =
    orgId !== null && storeId !== null
      ? (item: React.ComponentProps<typeof CostEntryCell>['item']) => (
          <CostEntryCell orgId={orgId} storeId={storeId} orderId={orderId} item={item} />
        )
      : undefined;

  return (
    <OrderDetailClient
      orgId={orgId}
      storeId={storeId}
      orderId={orderId}
      chrome="page"
      renderItemCostCell={renderItemCostCell}
    />
  );
}
