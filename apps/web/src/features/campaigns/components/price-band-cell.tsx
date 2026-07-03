'use client';

import { SparklesIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { Badge } from '@/components/ui/badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { asBandKey } from '../lib/band-key';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';
import { ProfitDelta } from './profit-delta';
import { TariffSelectControl } from './tariff-select-control';

export interface PriceBandCellProps {
  row: CommissionTariffRow;
  band: PriceBand;
  /** Whether the seller has chosen this band (at its boundary price) for the product. */
  selected: boolean;
  /** Whether this is the most profitable band (a quiet "En kârlı" badge). */
  isBest?: boolean;
  onSelect: (key: string) => void;
  /**
   * Center the cell's content — used in the desktop table column (all non-product
   * columns are centered). Off (left-aligned) for the mobile card grid.
   */
  centered?: boolean;
}

/** The band's boundary price + its "ve altı / ve üzeri" qualifier as one hero unit. */
function useBandLabel(band: PriceBand): { priceText: string; qualifier: string } {
  const t = useTranslations('commissionTariffsPage.table');
  // band1 has no upper bound → show its lower bound + "ve üzeri"; every other band
  // shows its upper bound + "ve altı" (the ceiling the seller drops the price to).
  if (band.upperLimit !== null) {
    return { priceText: formatCurrency(band.upperLimit), qualifier: t('belowQualifier') };
  }
  if (band.lowerLimit !== null) {
    return { priceText: formatCurrency(band.lowerLimit), qualifier: t('aboveQualifier') };
  }
  return { priceText: formatCurrency(band.price), qualifier: '' };
}

/**
 * One price band as a flat, un-boxed selectable choice — the PRICE (with its "ve
 * altı / ve üzeri" qualifier as one unit) is the hero, then the commission, the
 * calculated profit + "vs current" delta, and a single explicit {@link
 * TariffSelectControl}. No click-anywhere card overlay: every selectable option on
 * the row (each band AND the custom price) shares the same distinct radio-button
 * affordance, so the interaction reads as one consistent control across the row.
 *
 * Selection is a TOGGLE (one OR none per product) owned by the parent: choosing a
 * band clears any custom price; re-tapping the chosen band clears it. The most
 * profitable band carries a quiet "En kârlı" badge on its profit label (there is no
 * card edge to pin a ribbon to anymore).
 */
export function PriceBandCell({
  row,
  band,
  selected,
  isBest = false,
  onSelect,
  centered = false,
}: PriceBandCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const { priceText, qualifier } = useBandLabel(band);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: band.price, bandKey: asBandKey(band.key) } });
  }

  const items = centered ? 'items-center' : 'items-start';
  const self = centered ? 'self-center' : 'self-start';

  return (
    <div className={cn('gap-sm flex min-w-0 flex-col', items, centered && 'w-full text-center')}>
      <div className={cn('gap-3xs flex min-w-0 flex-col', items)}>
        {/* Price boundary + its "ve altı / ve üzeri" qualifier as one hero unit. */}
        <span
          className={cn(
            'gap-x-2xs flex min-w-0 flex-wrap items-baseline',
            centered && 'justify-center',
          )}
        >
          <span className="text-base font-bold tabular-nums">{priceText}</span>
          <span className="text-xs font-normal">{qualifier}</span>
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('commission')} {formatPercentDisplay(band.commissionPct)}
        </span>
      </div>

      <div className={cn('gap-3xs flex flex-col', items)}>
        {/* "En kârlı" rides the profit label (it IS the highest-profit band). Placing
            it here — not above the price — keeps every band's price row aligned across
            the columns; only the best band's label line grows slightly. */}
        <span
          className={cn(
            'gap-2xs text-2xs text-muted-foreground flex items-center',
            centered && 'justify-center',
          )}
        >
          {t('calculatedProfit')}
          {isBest ? (
            <Badge
              tone="primary"
              variant="solid"
              radius="full"
              leadingIcon={<SparklesIcon />}
              className="text-2xs px-2xs gap-3xs py-0 font-medium [&_svg]:size-3"
            >
              {t('best')}
            </Badge>
          ) : null}
        </span>
        <ProfitBadge
          value={band.netProfit}
          marginPct={band.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          showMarginPct
          className={self}
        />
        {/* "Güncele göre +₺X" — how much this band beats the current price/commission. */}
        <ProfitDelta
          optionNetProfit={band.netProfit}
          currentNetProfit={row.currentNetProfit}
          label={t('vsCurrent')}
        />
      </div>

      <TariffSelectControl
        selected={selected}
        onToggle={() => onSelect(band.key)}
        label={t('selectBand')}
        selectedLabel={t('bandSelected')}
        className={self}
      />

      <CommissionTariffBreakdown
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
