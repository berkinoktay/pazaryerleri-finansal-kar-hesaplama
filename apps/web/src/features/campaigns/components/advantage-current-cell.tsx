'use client';

import { SparklesIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateAdvantageItemPrice } from '../hooks/use-estimate-advantage-item-price';
import type { AdvantageTariffRow } from '../lib/adapt-advantage-tariff';
import { useTariffScope } from '../lib/tariff-scope';
import { AdvantageTariffBreakdown } from './advantage-tariff-breakdown';
import { TariffCurrentCell } from './tariff-current-cell';

export interface AdvantageCurrentCellProps {
  row: AdvantageTariffRow;
  /** Whether keeping the current price/commission is the row's most profitable option (an "En kârlı" badge). */
  isBest?: boolean;
}

/**
 * The Advantage product's CURRENT baseline — the "do nothing" reference the seller
 * compares each tier against. Shows the price the buyer currently pays (Müşterinin gördüğü
 * fiyat, which the current profit is computed from), its resolved commission, and the
 * calculated profit as the SAME clickable {@link ProfitBadge} the tiers show. Presentation
 * lives in the shared {@link TariffCurrentCell}; this owns the data, the current-scenario
 * estimate call, and the breakdown modal. Left-aligned and a touch narrower than a card
 * cell (`minWidth="current"`). Renders the starred "En kârlı" badge ONLY when keeping the
 * current price is the row's most profitable choice — so the whole-row marker can land
 * here. No client-side money math — the badge and modal are backend-computed.
 */
export function AdvantageCurrentCell({
  row,
  isBest = false,
}: AdvantageCurrentCellProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateAdvantageItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
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
      commissionLabel={t('tierCommission')}
      calculatedLabel={t('calculatedProfit')}
      netProfit={row.currentNetProfit}
      marginPct={row.currentMarginPct}
      scale={scale}
      onOpenBreakdown={openBreakdown}
      emptyLabel={row.reason === 'NO_COST' ? t('enterCost') : undefined}
      minWidth="current"
      // "En kârlı" badge only when keeping the current price wins the row — no reserved
      // slot, so a non-best current cell adds no height. Sparkles icon so the marker
      // matches the tier/custom ribbons on this row.
      bestBadge={isBest ? { label: t('bestTier'), visible: true, icon: <SparklesIcon /> } : null}
    >
      <AdvantageTariffBreakdown
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
