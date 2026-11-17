'use client';

import { SparklesIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateFlashItemPrice } from '../hooks/use-estimate-flash-item-price';
import { useFlashReasonEmptyLabel } from '../hooks/use-flash-reason-label';
import type { FlashProductRow } from '../lib/adapt-flash-product';
import { useTariffScope } from '../lib/tariff-scope';
import { FlashProductBreakdown } from './flash-product-breakdown';
import { TariffCurrentCell } from './tariff-current-cell';

export interface FlashCurrentCellProps {
  row: FlashProductRow;
  /** Whether keeping the current price/commission is the row's most profitable option (an "En kârlı" badge). */
  isBest?: boolean;
}

/**
 * The Flash row's CURRENT baseline — the "do nothing" reference the seller compares each
 * offer against. Shows the price the buyer currently pays (Müşterinin gördüğü fiyat, which
 * the current profit is computed from), its resolved commission, and the calculated profit
 * as the SAME clickable {@link ProfitBadge} the offers show. Presentation lives in the
 * shared {@link TariffCurrentCell}; this owns the data, the current-scenario estimate call,
 * and the breakdown modal. No client-side money math — the badge and modal are
 * backend-computed.
 *
 * An unknown current commission percent (the file's cell was blank or unreadable) reads
 * as an unknown commission line with its own caption under it, while the price stays the
 * hero. The backend has no current profit then, so the badge click opens the
 * not-calculable dialog without an estimate request.
 */
export function FlashCurrentCell({
  row,
  isBest = false,
}: FlashCurrentCellProps): React.ReactElement {
  const t = useTranslations('flashProductsPage.table');
  const reasonEmptyLabel = useFlashReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateFlashItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  // No current commission: the backend has no current scenario (it answers 422 to one),
  // so there is nothing to estimate.
  const currentUnknown = row.currentCommissionPct === null;

  function openBreakdown(): void {
    setBreakdownOpen(true);
    // The dialog opens on its not-calculable text without a request.
    if (currentUnknown) return;
    // `scenario: 'current'` — the backend derives BOTH the customer price and its
    // commission from the item itself, so the breakdown matches this row's
    // `currentNetProfit` badge.
    estimate.mutate({ itemId: row.id, body: { scenario: 'current' } });
  }

  return (
    <TariffCurrentCell
      // The price the buyer sees — the current net profit is computed from it, so
      // badge/modal/price stay in sync.
      price={row.customerPrice}
      commissionPct={row.currentCommissionPct}
      // Shown (with its caption under it) only while the current commission is unknown.
      unknownCommissionLabel={t('commissionUnknown')}
      unknownCommissionHint={t('commissionUnknownHint')}
      commissionLabel={t('offerCommission')}
      calculatedLabel={t('calculatedProfit')}
      netProfit={row.currentNetProfit}
      marginPct={row.currentMarginPct}
      scale={scale}
      onOpenBreakdown={openBreakdown}
      // The row's not-calculable reason (or undefined when calculable) rides the badge as a
      // warning-soft chip — the same signal the product cell used to print inline.
      emptyLabel={reasonEmptyLabel(row.reason)}
      minWidth="current"
      // "En kârlı" badge only when keeping the current price wins the row — no reserved
      // slot, so a non-best current cell adds no height. Sparkles icon so the marker
      // matches the offer/custom ribbons on this row.
      bestBadge={isBest ? { label: t('bestOffer'), visible: true, icon: <SparklesIcon /> } : null}
    >
      <FlashProductBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.barcode}
        currentNetProfit={row.currentNetProfit}
        result={currentUnknown ? null : (estimate.data ?? null)}
        loading={currentUnknown ? false : estimate.isPending}
      />
    </TariffCurrentCell>
  );
}
