'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import type { EstimateAdvantagePriceResult } from '../api/estimate-advantage-item-price.api';
import { useEstimateAdvantageItemPrice } from '../hooks/use-estimate-advantage-item-price';
import type { AdvantageCustomChoice } from '../lib/advantage-bulk-actions';
import { useTariffScope } from '../lib/tariff-scope';
import type { AdvantageTariffDetailItem } from '../types';
import { AdvantageTariffBreakdown } from './advantage-tariff-breakdown';
import { ProfitDelta } from './profit-delta';
import { TariffSelectControl } from './tariff-select-control';

const DEBOUNCE_MS = 400;

export interface AdvantageCustomPriceCellProps {
  row: AdvantageTariffDetailItem;
  /** Whether THIS row's custom price is the seller's active selection. */
  isSelected: boolean;
  /** Commit the typed custom price as the selection (carrying its estimated profit). */
  onSelect: (choice: AdvantageCustomChoice) => void;
  /** Un-commit the custom price for this row. */
  onDeselect: () => void;
  /** Center the content (desktop table column) vs left-align (mobile card, default). */
  centered?: boolean;
}

/**
 * Custom Advantage-price "what-if" AND a selectable choice. The seller types any price;
 * a debounced backend estimate returns the real profit at whichever commission band the
 * price lands in (shown via the shared {@link ProfitBadge}). When they are sure, an
 * EXPLICIT "Bu fiyatı seç" control commits that price as the row's selection — the
 * export then writes the custom amount instead of a tier's target price.
 *
 * Click-conflict resolution (three separate, non-overlapping targets): the INPUT only
 * types, the badge opens the breakdown, and the SELECT control commits. There is no
 * stretched-overlay here (unlike a tier cell) precisely because the input would fight
 * it. Editing a committed price un-commits it, so the selected amount is always the last
 * value the seller confirmed with "Seç". No client-side math — the engine computes the
 * authoritative value (feedback_no_frontend_financial_calculation).
 */
export function AdvantageCustomPriceCell({
  row,
  isSelected,
  onSelect,
  onDeselect,
  centered = false,
}: AdvantageCustomPriceCellProps): React.ReactElement {
  const t = useTranslations('productLabelsPage');
  const tBreakdown = useTranslations('productLabelsPage.breakdown');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateAdvantageItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  // Seed the input from any persisted custom price so reopening a tariff shows it.
  const [price, setPrice] = React.useState<Decimal | null>(
    row.customPrice !== null ? new Decimal(row.customPrice) : null,
  );
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<EstimateAdvantagePriceResult | null>(null);

  // Debounced what-if: fire the estimate ~400ms after the seller stops typing.
  React.useEffect(() => {
    if (price === null || !price.greaterThan(0)) return undefined;
    const priceStr = price.toFixed(2);
    const handle = setTimeout(() => {
      estimateMutate(
        { itemId: row.id, body: { price: priceStr } },
        { onSuccess: (data) => setLastResult(data) },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [price, row.id, estimateMutate]);

  function handleChange(next: Decimal | null): void {
    setPrice(next);
    // Editing a committed custom price un-commits it — the seller re-confirms the new
    // value with "Seç", so the selected amount is always the last confirmed one.
    if (isSelected) onDeselect();
  }

  // "Seç" is only meaningful once the estimate for the CURRENT typed price is back and
  // calculable — otherwise there is no confirmed profit to commit.
  const canSelect =
    price !== null &&
    lastResult !== null &&
    lastResult.calculable &&
    lastResult.price === price.toFixed(2);

  function handleToggleSelect(): void {
    if (isSelected) {
      onDeselect();
      return;
    }
    if (canSelect && lastResult?.breakdown != null && price !== null) {
      onSelect({
        price: price.toFixed(2),
        netProfit: lastResult.breakdown.netProfit ?? null,
        marginPct: lastResult.breakdown.saleMarginPct ?? null,
      });
    }
  }

  const items = centered ? 'items-center' : 'items-start';
  const self = centered ? 'self-center' : 'self-start';

  return (
    <div
      className={cn(
        'gap-sm md:min-w-tariff-band flex flex-col',
        items,
        centered && 'w-full text-center',
      )}
    >
      {/* Label + input as one tight group so the roomy outer gap-sm sits between the
          input, the estimate, and the select control — not inside the field. */}
      <div className={cn('gap-3xs flex flex-col', items, centered && 'w-full')}>
        {/* On mobile the field has no column header, so label it here; the desktop
            table's "Özel Fiyat" column header hides this (md:hidden). */}
        <span className="text-2xs text-muted-foreground font-medium md:hidden">
          {t('table.customPrice')}
        </span>
        <MoneyInput
          value={price}
          onChange={handleChange}
          nonNegative
          aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
          placeholder={t('table.enterPrice')}
          className="md:max-w-input-narrow w-full"
          // Any price earns the reduced commission of whichever band it lands in —
          // the Input's help-text slot spells this out under the field with an info icon.
          helpText={t('table.customCommissionApplies')}
        />
      </div>
      {/* Profit block is ALWAYS visible — same as a tier cell: a neutral em-dash badge
          until the seller types a price, then the estimated profit + "vs current" delta.
          Same "Hesaplanan kâr" + badge + delta structure and alignment as the tiers, so
          the columns read identically. */}
      <div className={cn('gap-3xs flex flex-col', items)}>
        <span className="text-2xs text-muted-foreground">{t('table.calculatedProfit')}</span>
        <ProfitBadge
          value={lastResult?.breakdown?.netProfit ?? null}
          marginPct={lastResult?.breakdown?.saleMarginPct ?? null}
          scale={scale}
          onOpen={() => {
            // The empty em-dash badge has no breakdown to open; only open once a typed
            // price has an estimate.
            if (lastResult !== null) setBreakdownOpen(true);
          }}
          showMarginPct
          className={self}
        />
        <ProfitDelta
          optionNetProfit={lastResult?.breakdown?.netProfit ?? null}
          currentNetProfit={row.current.netProfit}
          label={t('table.vsCurrent')}
        />
        <AdvantageTariffBreakdown
          open={breakdownOpen}
          onOpenChange={setBreakdownOpen}
          productTitle={row.productTitle}
          imageUrl={row.imageUrl}
          result={lastResult}
          loading={estimate.isPending}
          profitLabel={tBreakdown('estimatedProfit')}
        />
      </div>

      {/* SELECT control — a separate target from the input, so typing never selects.
          Enabled only once a calculable estimate for the typed price is in. Shares the
          exact affordance the tier cells use (no click-anywhere overlay). */}
      <TariffSelectControl
        selected={isSelected}
        disabled={!isSelected && !canSelect}
        onToggle={handleToggleSelect}
        label={t('table.selectCustom')}
        selectedLabel={t('table.customSelected')}
        className={cn(centered && 'self-center')}
      />
    </div>
  );
}
