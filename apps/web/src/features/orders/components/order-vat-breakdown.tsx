'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DefinitionList, type DefinitionListItem } from '@/components/patterns/definition-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { type OrderDetail } from '../api/get-order.api';

export interface OrderVatBreakdownProps {
  order: Pick<OrderDetail, 'saleSubtotalNet' | 'saleVatTotal' | 'items'>;
}

/**
 * Net + VAT breakdown card. Aggregates per-line commission and seller
 * discount via Decimal so the totals exactly mirror the design doc's
 * KDV-split contract (no floating point). When the order is sparse
 * (no items synced yet), the card still renders to preserve visual
 * stability — fields fall back to "—".
 */
export function OrderVatBreakdown({ order }: OrderVatBreakdownProps): React.ReactElement {
  const t = useTranslations('orderDetail.vatBreakdown');

  const totals = aggregateLineTotals(order.items);

  const items: DefinitionListItem[] = [
    {
      id: 'saleSubtotalNet',
      term: t('saleSubtotalNet'),
      description: <Currency value={order.saleSubtotalNet ?? '0'} />,
    },
    {
      id: 'saleVatTotal',
      term: t('saleVatTotal'),
      description: <Currency value={order.saleVatTotal ?? '0'} />,
    },
    {
      id: 'grossCommissionNet',
      term: t('grossCommissionNet'),
      description: <Currency value={totals.grossCommissionNet} />,
    },
    {
      id: 'refundedCommissionNet',
      term: t('refundedCommissionNet'),
      description: <Currency value={totals.refundedCommissionNet} />,
    },
    {
      id: 'effectiveCommissionNet',
      term: t('effectiveCommissionNet'),
      hint: t('effectiveCommissionHint'),
      description: (
        <Currency
          value={totals.grossCommissionNet.sub(totals.refundedCommissionNet).toString()}
          emphasis
        />
      ),
    },
    {
      id: 'sellerDiscountNet',
      term: t('sellerDiscountNet'),
      description: <Currency value={totals.sellerDiscountNet} />,
    },
    {
      id: 'costSnapshotNet',
      term: t('costSnapshotNet'),
      hint: totals.costSnapshotMissing ? t('costSnapshotMissing') : undefined,
      description:
        totals.costSnapshotNet === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Currency value={totals.costSnapshotNet} />
        ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <DefinitionList items={items} dividers />
      </CardContent>
    </Card>
  );
}

interface LineTotals {
  grossCommissionNet: Decimal;
  refundedCommissionNet: Decimal;
  sellerDiscountNet: Decimal;
  costSnapshotNet: Decimal | null;
  costSnapshotMissing: boolean;
}

function aggregateLineTotals(items: OrderDetail['items']): LineTotals {
  let grossCommissionNet = new Decimal(0);
  let refundedCommissionNet = new Decimal(0);
  let sellerDiscountNet = new Decimal(0);
  let costSnapshotNet = new Decimal(0);
  let costSnapshotMissing = false;
  let costSnapshotPresent = false;

  for (const item of items) {
    grossCommissionNet = grossCommissionNet.add(item.grossCommissionAmountNet);
    refundedCommissionNet = refundedCommissionNet.add(item.refundedCommissionAmountNet);
    sellerDiscountNet = sellerDiscountNet.add(item.sellerDiscountNet);

    if (item.unitCostSnapshotNet === null) {
      costSnapshotMissing = true;
    } else {
      costSnapshotPresent = true;
      costSnapshotNet = costSnapshotNet.add(
        new Decimal(item.unitCostSnapshotNet).mul(item.quantity),
      );
    }
  }

  return {
    grossCommissionNet,
    refundedCommissionNet,
    sellerDiscountNet,
    costSnapshotNet: costSnapshotPresent ? costSnapshotNet : null,
    costSnapshotMissing,
  };
}
