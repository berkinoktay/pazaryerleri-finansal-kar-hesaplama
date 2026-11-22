'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { type MarginScale } from '@/lib/margin-coloring';

import { type OrderListItem } from '../api/list-orders.api';
import { useProfitBlockerReasons } from '../hooks/use-profit-blocker-reasons';

import { ProfitBlockerReasonList } from './profit-blocker-reason-list';

export interface OrderProfitCellProps {
  order: Pick<OrderListItem, 'estimatedNetProfit' | 'saleMarginPct' | 'profitBlockers'>;
  /** Active margin scale, read once by the table (never inside a cell render). */
  scale: MarginScale | null;
  /** Opens the order's profit detail (the in-page sheet). */
  onOpen: () => void;
}

/**
 * The orders table's estimated-profit cell. A computed estimate renders the usual
 * margin-colored badge. `profitBlockers` is filled only while the order's profit is
 * not computable: the API reads it from the order's best-known profit, the same view
 * and the same reasons as the detail sheet's alert. A null estimate with blockers
 * renders a warning `profitBlockers.badge` chip whose tooltip names the reasons; on
 * touch (no hover) the click opens the detail sheet. A null estimate without blockers
 * stays the neutral em-dash, e.g. an order whose cargo invoice made its profit
 * computable while the order-time estimate stayed blocked.
 */
export function OrderProfitCell({
  order,
  scale,
  onOpen,
}: OrderProfitCellProps): React.ReactElement {
  const t = useTranslations('profitBlockers');
  const reasons = useProfitBlockerReasons(order.profitBlockers);

  if (order.estimatedNetProfit !== null || order.profitBlockers.length === 0) {
    return (
      <ProfitBadge
        value={order.estimatedNetProfit}
        marginPct={order.saleMarginPct}
        scale={scale}
        onOpen={onOpen}
      />
    );
  }

  return (
    <ProfitBadge
      value={null}
      marginPct={order.saleMarginPct}
      scale={scale}
      onOpen={onOpen}
      emptyLabel={t('badge')}
      // No sentence for a code newer than this build: keep the default click hint.
      tooltip={reasons.length > 0 ? <ProfitBlockerReasonList reasons={reasons} /> : undefined}
    />
  );
}
