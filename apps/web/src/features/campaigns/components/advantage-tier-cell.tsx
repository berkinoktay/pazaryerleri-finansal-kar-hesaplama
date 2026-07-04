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
import type { AdvantageTariffDetailItem, AdvantageTier } from '../types';
import { AdvantageTariffBreakdown } from './advantage-tariff-breakdown';
import { ProfitDelta } from './profit-delta';
import { TariffSelectControl } from './tariff-select-control';

export interface AdvantageTierCellProps {
  row: AdvantageTariffDetailItem;
  /** The tier this cell renders (one of the row's up-to-three star tiers). */
  tier: AdvantageTier;
  /** Whether this tier is the row's most-profitable one (`bestTierKey`). */
  isBest: boolean;
  /** Whether the seller has chosen THIS tier for the product. */
  selected: boolean;
  /** Toggle choosing this tier (re-tap clears it; choosing clears the other tiers/custom). */
  onToggle: () => void;
  /**
   * Center the cell's content — used in the desktop table columns (all non-product
   * columns are centered). Off (left-aligned) for the mobile card zone.
   */
  centered?: boolean;
}

/**
 * One Advantage star tier as a flat, un-boxed choice: the tier's target price + reduced
 * commission, the calculated profit + "vs current" delta, then a single explicit
 * {@link TariffSelectControl}. The three tier cells sit side by side in the table; the
 * most-profitable one carries an "En kârlı" marker. No click-anywhere overlay — every
 * selectable option on the row shares the same distinct radio-button affordance, and
 * choosing one tier clears the others (1-of-4 per product).
 */
export function AdvantageTierCell({
  row,
  tier,
  isBest,
  selected,
  onToggle,
  centered = false,
}: AdvantageTierCellProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateAdvantageItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: tier.price } });
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
        {/* "En kârlı" holds a reserved top slot in EVERY tier column (invisible unless
            this is the best tier) so all tier prices stay aligned across the columns —
            the same brand-blue marker as the commission vertical's price-band cell. */}
        <Badge
          tone="primary"
          variant="solid"
          radius="full"
          leadingIcon={<StarIcon />}
          className={cn(
            'text-2xs px-2xs gap-3xs py-0 font-medium [&_svg]:size-3',
            !isBest && 'invisible',
          )}
        >
          {t('bestTier')}
        </Badge>
        {/* Target price + its "ve altı" qualifier as one hero unit. */}
        <span
          className={cn(
            'gap-x-2xs flex min-w-0 flex-wrap items-baseline',
            centered && 'justify-center',
          )}
        >
          <span className="text-base font-bold tabular-nums">{formatCurrency(tier.price)}</span>
          <span className="text-xs font-normal">{t('tierQualifier')}</span>
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('tierCommission')} {formatPercentDisplay(tier.commissionPct)}
        </span>
      </div>

      <div className={cn('gap-3xs flex flex-col', items)}>
        <span className="text-2xs text-muted-foreground">{t('calculatedProfit')}</span>
        <ProfitBadge
          value={tier.netProfit}
          marginPct={tier.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          showMarginPct
          className={self}
        />
        {/* "Güncele göre +₺X" — how much this tier beats doing nothing. */}
        <ProfitDelta
          optionNetProfit={tier.netProfit}
          currentNetProfit={row.current.netProfit}
          label={t('vsCurrent')}
        />
      </div>

      <TariffSelectControl
        selected={selected}
        onToggle={onToggle}
        label={t('selectTier')}
        selectedLabel={t('tierSelected')}
        className={self}
      />

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
