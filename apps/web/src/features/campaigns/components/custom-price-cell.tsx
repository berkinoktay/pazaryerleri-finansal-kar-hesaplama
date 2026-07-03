'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import type { EstimateItemPriceResult } from '../api/estimate-item-price.api';
import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { asBandKey } from '../lib/band-key';
import type { CustomChoice } from '../lib/bulk-actions';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';
import { TariffSelectControl } from './tariff-select-control';

const DEBOUNCE_MS = 400;
// What-if ceiling ≈10M TL — far above any real Trendyol price. Decimal-aware
// (a separator-free ten-digit entry would otherwise reach ~10 billion and
// stretch the profit badge past the cell).
const MAX_WHAT_IF_PRICE = new Decimal('9999999.99');

export interface CustomPriceCellProps {
  row: CommissionTariffRow;
  /** Whether THIS row's custom price is the seller's active selection. */
  isSelected: boolean;
  /**
   * Commit the typed custom price as the selection. The price derives a band
   * (`band`), and the estimated profit is carried so the summary can total it
   * without re-estimating.
   */
  onSelect: (band: string, choice: CustomChoice) => void;
  /** Un-commit the custom price for this row. */
  onDeselect: () => void;
  /** Center the content (desktop table column) vs left-align (mobile card, default). */
  centered?: boolean;
}

/**
 * Custom-price "what-if" AND a selectable choice — the fifth option next to the
 * four price bands. The seller types any price; a debounced backend estimate
 * DERIVES the applicable band and returns the real profit at that band's
 * commission (shown via the shared {@link ProfitBadge}). When they are sure, an
 * EXPLICIT {@link TariffSelectControl} commits that price — the export then
 * writes the custom amount (at the derived band's commission) instead of a
 * band-boundary price.
 *
 * Click-conflict resolution (three separate, non-overlapping targets): the INPUT
 * only types, the badge opens the breakdown, and the SELECT control commits.
 * There is no stretched-overlay here (unlike the band cards) precisely because
 * the input would fight it. Editing a committed price un-commits it, so the
 * selected amount is always the last value the seller confirmed. No client-side
 * math — the engine computes the authoritative value
 * (feedback_no_frontend_financial_calculation).
 */
export function CustomPriceCell({
  row,
  isSelected,
  onSelect,
  onDeselect,
  centered = false,
}: CustomPriceCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const tBreakdown = useTranslations('commissionTariffsPage.breakdown');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  // Seed the input from any persisted custom price so reopening a tariff shows it.
  const [price, setPrice] = React.useState<Decimal | null>(
    row.customPrice !== null ? new Decimal(row.customPrice) : null,
  );
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  // Last SUCCESSFUL estimate. `mutate()` resets `estimate.data` to undefined,
  // which would unmount the badge on every debounced keystroke; keeping the
  // previous figures on screen kills that flicker. react-query fires a
  // mutate-level onSuccess only for the LATEST call, so an out-of-order older
  // response can never overwrite a newer estimate.
  const [lastResult, setLastResult] = React.useState<EstimateItemPriceResult | null>(null);

  // Debounced what-if: fire the estimate ~400ms after the seller stops typing.
  // useEffect is correct here — it syncs an external system (the estimate API) to
  // the typed price, and the cleanup cancels the pending call on each keystroke.
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
    // Editing a committed custom price un-commits it — the seller re-confirms the
    // new value, so the selected amount is always the last confirmed one.
    if (isSelected) onDeselect();
  }

  // The band derived for the CURRENT typed price (null until a calculable
  // estimate for exactly this price is back).
  const derivedBand =
    price !== null &&
    lastResult !== null &&
    lastResult.calculable &&
    lastResult.price === price.toFixed(2)
      ? asBandKey(lastResult.bandKey)
      : undefined;
  // "Seç" is only meaningful once the estimate maps the typed price to a band —
  // otherwise there is no confirmed choice to commit.
  const canSelect = derivedBand !== undefined;

  function handleToggleSelect(): void {
    if (isSelected) {
      onDeselect();
      return;
    }
    if (derivedBand !== undefined && lastResult?.breakdown != null && price !== null) {
      onSelect(derivedBand, {
        price: price.toFixed(2),
        netProfit: lastResult.breakdown.netProfit ?? null,
        marginPct: lastResult.breakdown.saleMarginPct ?? null,
      });
    }
  }

  const items = centered ? 'items-center' : 'items-start';
  const self = centered ? 'self-center' : 'self-start';

  return (
    <div className={cn('gap-sm flex flex-col', items, centered && 'w-full text-center')}>
      {/* Label + input as one tight group so the roomy outer gap-sm sits between
          the input, the estimate, and the select control — not inside the field. */}
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
          max={MAX_WHAT_IF_PRICE}
          aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
          placeholder={t('table.enterPrice')}
          className="md:max-w-input-narrow w-full"
          // The applied commission depends on which band the price lands in —
          // the Input's help-text slot spells this out under the field.
          helpText={t('table.customCommissionHint')}
        />
      </div>
      {/* Profit block is ALWAYS visible: a neutral em-dash badge until the seller
          types a price, then the estimated profit + the derived band's commission.
          Same "Hesaplanan kâr" + badge structure and alignment as the band cards. */}
      <div className={cn('gap-3xs flex flex-col', items)}>
        <span className="text-2xs text-muted-foreground">{t('table.calculatedProfit')}</span>
        <ProfitBadge
          value={lastResult?.breakdown?.netProfit ?? null}
          marginPct={lastResult?.breakdown?.saleMarginPct ?? null}
          scale={scale}
          onOpen={() => {
            // The empty em-dash badge has no breakdown to open; only open once a
            // typed price has an estimate.
            if (lastResult !== null) setBreakdownOpen(true);
          }}
          showMarginPct
          className={self}
        />
        {/* Which commission the typed price earns (the derived band's rate) —
            parallel to each band card's "komisyon %X" line. */}
        {lastResult !== null && lastResult.calculable ? (
          <span className="text-2xs text-muted-foreground tabular-nums">
            {t('table.commission')} {formatPercentDisplay(lastResult.commissionPct)}
          </span>
        ) : null}
        <CommissionTariffBreakdown
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
          Enabled only once the typed price maps to a band. Shares the exact
          affordance the band cards use (the same checkmark-circle). */}
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
