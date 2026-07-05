'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateAdvantageItemPrice } from '../hooks/use-estimate-advantage-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { AdvantageTariffDetailItem } from '../types';
import { AdvantageTariffBreakdown } from './advantage-tariff-breakdown';
import { TariffCurrentCell } from './tariff-current-cell';

export interface AdvantageCurrentCellProps {
  row: AdvantageTariffDetailItem;
  /**
   * Center the cell's content — used in the desktop table columns (all non-product
   * columns are centered). Off (left-aligned) for the mobile card zone.
   */
  centered?: boolean;
}

/**
 * The product's CURRENT baseline as a flat, un-boxed cell that mirrors {@link AdvantageTierCell}:
 * the price the buyer currently pays (Müşterinin Gördüğü Fiyat), its resolved commission (from the
 * band that price falls into, else the category rate — the same lookup the tiers use), and the
 * calculated profit as the SAME {@link ProfitBadge} the tiers show. This lets the seller compare
 * "do nothing" against each advantage tier on identical terms. No vs-current delta (it is the
 * baseline) and no select control (there is nothing to choose about the current state); the reserved
 * "En kârlı" slot lights up only when keeping the current price is the single most-profitable option.
 * Clicking the badge opens the breakdown for the current price. The presentation lives in the shared
 * {@link TariffCurrentCell}; this owns the Advantage data, estimate call, and breakdown modal.
 */
export function AdvantageCurrentCell({
  row,
  centered = false,
}: AdvantageCurrentCellProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateAdvantageItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: row.customerPrice } });
  }

  return (
    <TariffCurrentCell
      price={row.customerPrice}
      commissionPct={row.current.commissionPct}
      commissionLabel={t('tierCommission')}
      calculatedLabel={t('calculatedProfit')}
      netProfit={row.current.netProfit}
      marginPct={row.current.marginPct}
      scale={scale}
      onOpenBreakdown={openBreakdown}
      bestBadge={{ label: t('bestTier'), visible: row.current.isBest }}
      centered={centered}
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
