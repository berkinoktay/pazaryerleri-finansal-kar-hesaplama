'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useDiscountReasonEmptyLabel } from '../hooks/use-discount-reason-label';
import { useEstimateCampaignItem } from '../hooks/use-estimate-campaign-item';
import type { MarketplaceCampaignRow } from '../lib/adapt-marketplace-campaign';
import { useTariffScope } from '../lib/tariff-scope';
import { MarketplaceCampaignBreakdown } from './marketplace-campaign-breakdown';
import { TariffCurrentCell } from './tariff-current-cell';

export interface MarketplaceCampaignCurrentCellProps {
  row: MarketplaceCampaignRow;
}

/**
 * The campaign row's CURRENT baseline — the "do nothing" reference both price cards are
 * compared with: today's price, its commission and the per-unit profit (not participating is a
 * single-unit sale), as the same clickable {@link ProfitBadge} the cards show. Presentation lives
 * in the shared {@link TariffCurrentCell}; this owns the current-scenario estimate and the
 * breakdown modal. No client-side money math.
 */
export function MarketplaceCampaignCurrentCell({
  row,
}: MarketplaceCampaignCurrentCellProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.table');
  const reasonEmptyLabel = useDiscountReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateCampaignItem(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { scenario: 'current' } });
  }

  return (
    <TariffCurrentCell
      price={row.currentPrice}
      commissionPct={row.current.commissionPct}
      commissionLabel={t('commission')}
      calculatedLabel={t('calculatedProfit')}
      netProfit={row.current.netProfit}
      marginPct={row.current.marginPct}
      scale={scale}
      onOpenBreakdown={openBreakdown}
      emptyLabel={reasonEmptyLabel(row.reason)}
      minWidth="current"
    >
      <MarketplaceCampaignBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.barcode}
        campaignPrice={null}
        result={estimate.data ?? null}
        loading={estimate.isPending}
        currentNetProfit={row.current.netProfit}
      />
    </TariffCurrentCell>
  );
}
