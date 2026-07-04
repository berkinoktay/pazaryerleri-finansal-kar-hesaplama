'use client';

import { StarIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { Badge } from '@/components/ui/badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import { useEstimateAdvantageItemPrice } from '../hooks/use-estimate-advantage-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { AdvantageTariffDetailItem } from '../types';
import { AdvantageTariffBreakdown } from './advantage-tariff-breakdown';

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
 * "do nothing" against each advantage tier on identical terms. No "En kârlı" marker, no vs-current
 * delta (it is the baseline), and no select control (there is nothing to choose about the current
 * state); clicking the badge opens the breakdown for the current price.
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

  const items = centered ? 'items-center' : 'items-start';
  const self = centered ? 'self-center' : 'self-start';

  return (
    <div
      className={cn(
        'gap-sm md:min-w-tariff-band flex min-w-0 flex-col',
        items,
        centered && 'w-full text-center',
      )}
    >
      <div className={cn('gap-3xs flex min-w-0 flex-col', items)}>
        {/* Reserved "En kârlı" slot — invisible unless keeping the current price is the
            single most-profitable (positive) option (ComputedCurrentScenario.isBest). The
            reserved height keeps the price aligned with the tier columns' price rows. */}
        <Badge
          tone="primary"
          variant="solid"
          radius="full"
          leadingIcon={<StarIcon />}
          className={cn(
            'text-2xs px-2xs gap-3xs py-0 font-medium [&_svg]:size-3',
            !row.current.isBest && 'invisible',
          )}
        >
          {t('bestTier')}
        </Badge>
        <span className="text-base font-bold tabular-nums">
          {formatCurrency(row.customerPrice)}
        </span>
        {row.current.commissionPct !== null ? (
          <span className="text-2xs text-muted-foreground tabular-nums">
            {t('tierCommission')} {formatPercentDisplay(row.current.commissionPct)}
          </span>
        ) : null}
      </div>

      <div className={cn('gap-3xs flex flex-col', items)}>
        <span className="text-2xs text-muted-foreground">{t('calculatedProfit')}</span>
        <ProfitBadge
          value={row.current.netProfit}
          marginPct={row.current.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          showMarginPct
          className={self}
        />
      </div>

      <AdvantageTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </div>
  );
}
