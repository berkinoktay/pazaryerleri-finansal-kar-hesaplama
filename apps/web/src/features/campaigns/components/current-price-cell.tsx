'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';
import { TariffCurrentCell } from './tariff-current-cell';

export interface CurrentPriceCellProps {
  row: CommissionTariffRow;
}

/**
 * The commission-tariff product's CURRENT baseline — the "do nothing" reference the
 * seller compares each price band against. Shows only the price the buyer sees (the
 * commission-base price, or the sale price for imports before that column existed),
 * its current commission, and the calculated profit as the SAME clickable {@link
 * ProfitBadge} the bands show. Presentation lives in the shared {@link
 * TariffCurrentCell}; this owns the data, the current-scenario estimate call, and the
 * breakdown modal. No "En kârlı" slot and left-aligned (the commission column has no
 * "best" concept). No client-side money math — the badge and modal are backend-computed.
 */
export function CurrentPriceCell({ row }: CurrentPriceCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    // `scenario: 'current'` — the backend derives BOTH price and commission from the
    // item itself, so the breakdown matches this row's `currentNetProfit` badge.
    estimate.mutate({ itemId: row.id, body: { scenario: 'current' } });
  }

  // DISPLAY choice only (not a calculation): show the price the buyer sees, falling
  // back to the sale price for imports before the commission-base column existed. The
  // backend's current scenario uses the same price, so badge/modal/price stay in sync.
  const price = row.commissionBasePrice ?? row.currentPrice;

  return (
    <TariffCurrentCell
      price={price}
      commissionPct={row.currentCommissionPct}
      commissionLabel={t('table.currentCommission')}
      calculatedLabel={t('table.calculatedProfit')}
      netProfit={row.currentNetProfit}
      marginPct={row.currentMarginPct}
      scale={scale}
      onOpenBreakdown={openBreakdown}
      emptyLabel={row.reason === 'NO_COST' ? t('table.enterCost') : undefined}
    >
      <CommissionTariffBreakdown
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
