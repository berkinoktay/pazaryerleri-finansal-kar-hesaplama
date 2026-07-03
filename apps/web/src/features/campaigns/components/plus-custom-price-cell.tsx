'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import type { EstimatePlusPriceResult } from '../api/estimate-plus-item-price.api';
import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import type { PlusCustomChoice } from '../lib/plus-bulk-actions';
import { useTariffScope } from '../lib/tariff-scope';
import type { PlusTariffDetailItem } from '../types';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';
import { TariffSelectControl } from './tariff-select-control';

const DEBOUNCE_MS = 400;

export interface PlusCustomPriceCellProps {
  row: PlusTariffDetailItem;
  /** Whether THIS row's custom price is the seller's active selection. */
  isSelected: boolean;
  /** Commit the typed custom price as the selection (carrying its estimated profit). */
  onSelect: (choice: PlusCustomChoice) => void;
  /** Un-commit the custom price for this row. */
  onDeselect: () => void;
}

/**
 * Custom Plus-price "what-if" AND a selectable choice. The seller types a price at
 * or below the ceiling; a debounced backend estimate returns the real profit at the
 * reduced Plus commission (shown via the shared {@link ProfitBadge}). When they are
 * sure, an EXPLICIT "Bu fiyatı seç" control commits that price as the row's Plus
 * selection — the export then writes the custom amount instead of the ceiling.
 *
 * Click-conflict resolution (three separate, non-overlapping targets): the INPUT
 * only types, the badge opens the breakdown, and the SELECT control commits. There
 * is no stretched-overlay here (unlike the band card) precisely because the input
 * would fight it. Editing a committed price un-commits it, so the selected amount is
 * always the last value the seller confirmed with "Seç". No client-side math — the
 * engine computes the authoritative value (feedback_no_frontend_financial_calculation).
 */
export function PlusCustomPriceCell({
  row,
  isSelected,
  onSelect,
  onDeselect,
}: PlusCustomPriceCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const tBreakdown = useTranslations('plusCommissionTariffsPage.breakdown');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  // Seed the input from any persisted custom price so reopening a tariff shows it.
  const [price, setPrice] = React.useState<Decimal | null>(
    row.customPrice !== null ? new Decimal(row.customPrice) : null,
  );
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  // The Plus offer's ceiling: the seller may try any price up to (and including)
  // it, never above — that is the whole point of the ceiling.
  const ceiling = React.useMemo(() => new Decimal(row.plus.price), [row.plus.price]);
  const [lastResult, setLastResult] = React.useState<EstimatePlusPriceResult | null>(null);

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
    // Editing a committed custom price un-commits it — the seller re-confirms the
    // new value with "Seç", so the selected amount is always the last confirmed one.
    if (isSelected) onDeselect();
  }

  const showEstimate = price !== null && price.greaterThan(0) && lastResult !== null;
  // "Seç" is only meaningful once the estimate for the CURRENT typed price is back
  // and calculable — otherwise there is no confirmed profit to commit.
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

  return (
    <div className="gap-sm flex flex-col">
      {/* Label + input as one tight group so the roomy outer gap-sm sits between
          the input, the estimate, and the select control — not inside the field. */}
      <div className="gap-3xs flex flex-col">
        {/* On mobile the field has no column header, so label it here; the desktop
            table's "Plus Fiyatı" column header hides this (md:hidden). */}
        <span className="text-2xs text-muted-foreground font-medium md:hidden">
          {t('table.customPrice')}
        </span>
        <MoneyInput
          value={price}
          onChange={handleChange}
          nonNegative
          max={ceiling}
          aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
          placeholder={t('table.enterPrice')}
          className="md:max-w-input-narrow w-full"
        />
      </div>
      {showEstimate && lastResult !== null ? (
        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground">{tBreakdown('estimatedProfit')}</span>
          <ProfitBadge
            value={lastResult.breakdown?.netProfit ?? null}
            marginPct={lastResult.breakdown?.saleMarginPct ?? null}
            scale={scale}
            onOpen={() => setBreakdownOpen(true)}
            showMarginPct
            className={cn(
              'duration-fast self-start transition-opacity',
              estimate.isPending && 'opacity-60',
            )}
          />
          <PlusTariffBreakdown
            open={breakdownOpen}
            onOpenChange={setBreakdownOpen}
            productTitle={row.productTitle}
            imageUrl={row.imageUrl}
            result={lastResult}
            loading={estimate.isPending}
            profitLabel={tBreakdown('estimatedProfit')}
          />
        </div>
      ) : (
        <span className="text-2xs text-muted-foreground">{t('table.customPriceHint')}</span>
      )}

      {/* SELECT control — a separate target from the input, so typing never selects.
          Enabled only once a calculable estimate for the typed price is in. Shares the
          exact affordance the Plus offer uses (no click-anywhere overlay). */}
      <TariffSelectControl
        selected={isSelected}
        disabled={!isSelected && !canSelect}
        onToggle={handleToggleSelect}
        label={t('table.selectCustom')}
        selectedLabel={t('table.customSelected')}
      />
    </div>
  );
}
