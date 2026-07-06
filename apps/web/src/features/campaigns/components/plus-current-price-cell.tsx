'use client';

import { SparklesIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
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
 * price, which the current profit is computed from), its current commission, and the
 * calculated profit as the SAME clickable {@link ProfitBadge} the offer shows.
 * Presentation lives in the shared {@link TariffCurrentCell}; this owns the data, the
 * current-scenario estimate call, and the breakdown modal. Left-aligned and a touch
 * narrower than a card cell (`minWidth="current"`). Renders the starred "En kârlı"
 * badge ONLY when keeping the current price is the row's most profitable choice — so
 * the whole-row marker can land here. No client-side money math — the badge and modal
 * are backend-computed.
 */
export function PlusCurrentPriceCell({
  row,
  isBest = false,
}: PlusCurrentPriceCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    // `scenario: 'current'` — the backend derives BOTH price and commission from the
    // item itself, so the breakdown matches this row's `currentNetProfit` badge.
    estimate.mutate({ itemId: row.id, body: { scenario: 'current' } });
  }

  return (
    <TariffCurrentCell
      // The price the buyer sees — the current net profit is computed from it, so
      // badge/modal/price stay in sync (Plus always carries a commission-base price).
      price={row.commissionBasePrice}
      commissionPct={row.currentCommissionPct}
      commissionLabel={t('table.currentCommission')}
      calculatedLabel={t('table.calculatedProfit')}
      netProfit={row.currentNetProfit}
      marginPct={row.currentMarginPct}
      scale={scale}
      onOpenBreakdown={openBreakdown}
      emptyLabel={row.reason === 'NO_COST' ? t('table.enterCost') : undefined}
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
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </TariffCurrentCell>
  );
}
