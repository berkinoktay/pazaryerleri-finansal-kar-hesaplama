'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { PlusTariffDetailItem } from '../types';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';
import { TariffSelectControl } from './tariff-select-control';

export interface PlusBandCellProps {
  row: PlusTariffDetailItem;
  /** Whether the seller has joined Plus AT THE CEILING for this product. */
  selected: boolean;
  /** Toggle the ceiling join (re-tap un-joins). */
  onToggle: () => void;
}

/**
 * The Plus offer as a flat, un-boxed choice: the ceiling price + reduced commission
 * + estimated profit, then a single explicit {@link TariffSelectControl} ("Plus'e
 * Katıl") to opt in. There is NO click-anywhere card overlay — every selectable
 * option on the row (this offer and the custom price) shares the same distinct
 * radio-button affordance, so the interaction is consistent and never fights an
 * input. Elements are generously spaced (gap-sm) for a clean, roomy read.
 */
export function PlusBandCell({ row, selected, onToggle }: PlusBandCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: row.plus.price } });
  }

  return (
    <div className="gap-sm flex min-w-0 flex-col">
      <div className="gap-3xs flex min-w-0 flex-col">
        {/* Price ceiling + its "ve altı" qualifier as one hero unit, with a subtle
            inline "Plus daha kârlı" chip when joining beats the current terms. */}
        <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
          <span className="text-base font-bold tabular-nums">{formatCurrency(row.plus.price)}</span>
          <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
          {row.plusIsBetter ? (
            <span className="text-2xs text-success bg-success-surface px-2xs py-3xs gap-3xs inline-flex items-center rounded-full font-medium">
              <span className="bg-success size-1.5 shrink-0 rounded-full" aria-hidden />
              {t('plusIsBetter')}
            </span>
          ) : null}
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('plusCommission')} {formatPercentDisplay(row.plus.commissionPct)}
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground">{t('calculatedProfit')}</span>
        <ProfitBadge
          value={row.plus.netProfit}
          marginPct={row.plus.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          showMarginPct
          className="self-start"
        />
      </div>

      <TariffSelectControl
        selected={selected}
        onToggle={onToggle}
        label={t('join')}
        selectedLabel={t('joined')}
      />

      <PlusTariffBreakdown
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
