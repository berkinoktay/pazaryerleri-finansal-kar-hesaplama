'use client';

import { SparklesIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { usePlusReasonEmptyLabel } from '../hooks/use-plus-reason-label';
import type { PlusTariffRow } from '../lib/adapt-plus-tariff';
import { useTariffScope } from '../lib/tariff-scope';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';
import { TariffCurrentCell } from './tariff-current-cell';

export interface PlusCurrentPriceCellProps {
  row: PlusTariffRow;
  /** Whether keeping the current price/commission is the row's most profitable option (an "En kârlı" badge). */
  isBest?: boolean;
}

/**
 * The Plus-tariff product's CURRENT baseline — the "do nothing" reference the seller
 * compares the Plus offer against. Shows the price the buyer sees (the commission-base
 * price, else the sale price; the current profit is computed from the same one), its
 * current commission, and the calculated profit as the SAME clickable {@link
 * ProfitBadge} the offer shows.
 * Presentation lives in the shared {@link TariffCurrentCell}; this owns the data, the
 * current-scenario estimate call, and the breakdown modal. Left-aligned and a touch
 * narrower than a card cell (`minWidth="current"`). Renders the starred "En kârlı"
 * badge ONLY when keeping the current price is the row's most profitable choice — so
 * the whole-row marker can land here. No client-side money math — the badge and modal
 * are backend-computed.
 *
 * The hero is the commission-base price, else the sale price; either can be unknown.
 * "Unknown" (with a short explanation line under it, visible on touch too) shows only
 * when BOTH are unknown. The backend then has no baseline, so the badge stays empty and
 * its click opens the not-calculable dialog without an estimate request.
 *
 * An unknown current commission percent (the file's cell was blank or unreadable) reads
 * as an unknown commission line with its own caption under it, while the price stays the
 * hero. The backend has no current profit then either, so the badge click also opens the
 * not-calculable dialog without an estimate request.
 */
export function PlusCurrentPriceCell({
  row,
  isBest = false,
}: PlusCurrentPriceCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const reasonEmptyLabel = usePlusReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  // DISPLAY choice only (not a calculation): the price the buyer sees, else the sale
  // price. The backend's current scenario uses the same baseline, so badge/modal/price
  // stay in sync. Null when both are unknown.
  const price = row.commissionBasePrice ?? row.currentPrice;
  const priceUnknown = price === null;
  // No baseline price, or no current commission: the backend has no current scenario
  // (it answers 422 to one), so there is nothing to estimate.
  const currentUnknown = priceUnknown || row.currentCommissionPct === null;

  function openBreakdown(): void {
    setBreakdownOpen(true);
    // The dialog opens on its not-calculable text without a request.
    if (currentUnknown) return;
    // `scenario: 'current'` — the backend derives BOTH price and commission from the
    // item itself, so the breakdown matches this row's `currentNetProfit` badge.
    estimate.mutate({ itemId: row.id, body: { scenario: 'current' } });
  }

  return (
    <TariffCurrentCell
      price={price}
      unknownPriceLabel={t('table.priceUnknown')}
      // Shown under the unknown label only while the price is unknown.
      unknownPriceHint={t('table.priceUnknownHint')}
      commissionPct={row.currentCommissionPct}
      // Shown (with its caption under it) only while the current commission is unknown.
      unknownCommissionLabel={t('table.commissionUnknown')}
      unknownCommissionHint={t('table.commissionUnknownHint')}
      commissionLabel={t('table.currentCommission')}
      calculatedLabel={t('table.calculatedProfit')}
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
      bestBadge={
        isBest === true ? { label: t('table.best'), visible: true, icon: <SparklesIcon /> } : null
      }
    >
      <PlusTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.stockCode}
        currentNetProfit={row.currentNetProfit}
        result={currentUnknown ? null : (estimate.data ?? null)}
        loading={currentUnknown ? false : estimate.isPending}
      />
    </TariffCurrentCell>
  );
}
