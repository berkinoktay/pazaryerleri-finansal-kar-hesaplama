'use client';

import { CheckmarkCircle02Icon, CircleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { usePlusReasonLabel } from '../hooks/use-plus-reason-label';
import { useTariffScope } from '../lib/tariff-scope';
import type { PlusTariffDetailItem } from '../types';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';

/**
 * Profit badge for ONE scenario (current or Plus). Clicking it opens the full
 * income-vs-expense breakdown computed by the estimate endpoint AT THIS SCENARIO'S
 * commission — the `scenario` param tells the backend to apply the current rate or
 * the reduced Plus rate, so the breakdown always matches the badge's own profit.
 * Each badge owns its estimate + modal so the two never share state.
 */
function ScenarioProfitBadge({
  row,
  price,
  netProfit,
  marginPct,
  scenario,
}: {
  row: PlusTariffDetailItem;
  price: string;
  netProfit: string | null;
  marginPct: string | null;
  scenario: 'current' | 'plus';
}): React.ReactElement {
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price, scenario } });
  }

  return (
    <>
      <ProfitBadge
        value={netProfit}
        marginPct={marginPct}
        scale={scale}
        onOpen={openBreakdown}
        showMarginPct
        // pointer-events-auto: inside the Plus block's stretched-button overlay
        // the content is pointer-events-none, so the badge must re-enable clicks
        // to open its breakdown instead of toggling the join. Harmless in the
        // static current block.
        className="mt-3xs pointer-events-auto self-start"
      />
      <PlusTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </>
  );
}

export interface PlusOfferCellProps {
  row: PlusTariffDetailItem;
  /** Whether the seller has joined Plus for this product. */
  selected: boolean;
  /** Toggle the join state (re-tap un-joins). */
  onToggle: () => void;
}

/**
 * The single-offer decision cell: the CURRENT price/commission/profit next to the
 * PLUS offer (ceiling price + reduced commission + profit), so the seller can read
 * "is joining Plus worth the price drop?" at a glance. The Plus block is a pressable
 * JOIN toggle (stretched-button overlay, `aria-pressed`); its profit badge stays
 * clickable to open the breakdown. `plusIsBetter` gets a subtle success dot (no
 * banned left-stripe); when Plus is worse a muted cue nudges the seller not to join.
 * Uncalculable rows show the reason inline instead of profit and have no toggle.
 */
export function PlusOfferCell({ row, selected, onToggle }: PlusOfferCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.table');
  const reasonLabel = usePlusReasonLabel();

  return (
    <div className="gap-xs flex min-w-0 flex-col sm:flex-row sm:items-stretch">
      {/* CURRENT block — static reference. */}
      <div className="p-xs border-border gap-2xs flex min-w-0 flex-1 flex-col rounded-md border">
        <span className="text-2xs text-muted-foreground font-medium">{t('current')}</span>
        <span className="text-base font-bold tabular-nums">
          <Currency value={row.current.price} />
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('currentCommission')} {formatPercentDisplay(row.current.commissionPct)}
        </span>
        {row.calculable ? (
          <ScenarioProfitBadge
            row={row}
            price={row.current.price}
            netProfit={row.current.netProfit}
            marginPct={row.current.marginPct}
            scenario="current"
          />
        ) : null}
      </div>

      {/* PLUS block — the offer, and (when calculable) a pressable JOIN toggle. */}
      <div
        className={cn(
          'p-xs gap-2xs relative flex min-w-0 flex-1 flex-col rounded-md border',
          row.calculable && 'hover-lift',
          selected ? 'border-primary bg-surface-row-selected' : 'border-border',
        )}
      >
        {row.calculable ? (
          <>
            {/* Stretched toggle button: covers the whole Plus block so clicking
                anywhere (except the profit badge) joins / un-joins. */}
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`${selected ? t('joined') : t('join')} — ${row.productTitle}`}
              onClick={onToggle}
              className={cn(
                'duration-fast ease-out-quart absolute inset-0 cursor-pointer rounded-md transition-colors',
                'focus-visible:shadow-focus focus-visible:outline-none',
                !selected && 'hover:bg-muted',
              )}
            />
            <div className="gap-2xs pointer-events-none relative flex flex-col">
              <span className="gap-2xs flex flex-wrap items-center">
                {selected ? (
                  <CheckmarkCircle02Icon className="text-primary size-4 shrink-0" aria-hidden />
                ) : (
                  <CircleIcon className="text-border-strong size-4 shrink-0" aria-hidden />
                )}
                <span className="text-2xs text-muted-foreground font-medium">{t('plus')}</span>
                {row.plusIsBetter ? (
                  <span className="text-2xs text-success gap-3xs flex items-center">
                    <span className="bg-success size-1.5 shrink-0 rounded-full" aria-hidden />
                    {t('plusIsBetter')}
                  </span>
                ) : (
                  <span className="text-2xs text-muted-foreground gap-3xs flex items-center">
                    <span className="bg-border-strong size-1.5 shrink-0 rounded-full" aria-hidden />
                    {t('plusIsWorse')}
                  </span>
                )}
              </span>
              <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
                <span className="text-base font-bold tabular-nums">
                  <Currency value={row.plus.price} />
                </span>
                <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
              </span>
              <span className="text-2xs text-muted-foreground tabular-nums">
                {t('plusCommission')} {formatPercentDisplay(row.plus.commissionPct)}
              </span>
              <ScenarioProfitBadge
                row={row}
                price={row.plus.price}
                netProfit={row.plus.netProfit}
                marginPct={row.plus.marginPct}
                scenario="plus"
              />
              <span
                className={cn(
                  'text-2xs mt-3xs font-medium',
                  selected ? 'text-primary' : 'text-foreground',
                )}
              >
                {selected ? t('joined') : t('join')}
              </span>
            </div>
          </>
        ) : (
          <div className="gap-2xs flex flex-col">
            <span className="text-2xs text-muted-foreground font-medium">{t('plus')}</span>
            <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
              <span className="text-base font-bold tabular-nums">
                <Currency value={row.plus.price} />
              </span>
              <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
            </span>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {t('plusCommission')} {formatPercentDisplay(row.plus.commissionPct)}
            </span>
            {row.reason !== null ? (
              <span className="text-warning text-2xs">{reasonLabel(row.reason)}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
