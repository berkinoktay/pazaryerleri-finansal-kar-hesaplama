'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { EstimateItemPriceResult } from '../api/estimate-item-price.api';
import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { asBandKey } from '../lib/band-key';
import type { CustomChoice } from '../lib/bulk-actions';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

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
  /**
   * The custom price currently held in the edit buffer for this row (a decimal
   * string), if any. Seeds the input over the persisted `row.customPrice` so the
   * same amount picked in another sub-period shows here too; null → fall back to
   * the server value.
   */
  committedPrice?: string | null;
}

/**
 * Custom-price "what-if" AND a selectable choice — the fifth card beside the four
 * preset bands, wearing the same {@link TariffOptionCard} shell + {@link
 * TariffProfitBlock} so the row reads as one uniform set: the INPUT stands in for the
 * band's static price, then the derived preset range + commission, the calculated
 * profit + "vs current" delta, and a {@link TariffSelectFoot}.
 *
 * Unlike the click-the-card bands, the foot here is a REAL button (the `onToggle`
 * form) rather than a card overlay — the overlay would fight the input. Three
 * separate, non-overlapping targets keep it unambiguous: the input types, the badge
 * opens the breakdown, the foot commits. The debounced backend estimate DERIVES the
 * band and its real profit; editing a committed price un-commits it. No client-side
 * money math — the engine computes the authoritative value
 * (feedback_no_frontend_financial_calculation).
 */
export function CustomPriceCell({
  row,
  isSelected,
  onSelect,
  onDeselect,
  committedPrice = null,
}: CustomPriceCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const tBreakdown = useTranslations('commissionTariffsPage.breakdown');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  // Seed the input from the edit-buffer's custom price (so the same amount picked in
  // another sub-period shows here), falling back to the persisted value so reopening
  // a tariff shows it. The debounced effect then re-estimates for THIS period's item.
  const seededPrice = committedPrice ?? row.customPrice;
  const [price, setPrice] = React.useState<Decimal | null>(
    seededPrice !== null ? new Decimal(seededPrice) : null,
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
  // Band key ("band2") → its human number (2) for the "≈ 2. Fiyat Aralığı" label.
  const derivedBandNum = derivedBand !== undefined ? Number(derivedBand.replace('band', '')) : null;
  const hasEstimate = lastResult !== null && lastResult.calculable && derivedBandNum !== null;

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

  return (
    <TariffOptionCard selected={isSelected}>
      {/* Input group — the field stands in for the band's static price, the derived
          line for the band's "komisyon %" line. */}
      <div className="gap-3xs flex w-full flex-col items-start">
        {/* Desktop has the "Özel Fiyat" column header; the mobile card has none, so
            label it here (md:hidden). */}
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
          className="md:max-w-input-price w-full"
        />
        <span className="text-2xs text-muted-foreground">
          {hasEstimate ? (
            <>
              ≈{' '}
              <span className="text-foreground font-semibold">
                {t('table.band', { n: derivedBandNum })}
              </span>{' '}
              · {t('table.commission')} {formatPercentDisplay(lastResult.commissionPct)}
            </>
          ) : (
            t('table.customPriceHint')
          )}
        </span>
      </div>

      <TariffProfitBlock
        netProfit={lastResult?.breakdown?.netProfit ?? null}
        marginPct={lastResult?.breakdown?.saleMarginPct ?? null}
        currentNetProfit={row.currentNetProfit}
        scale={scale}
        onOpenBreakdown={() => {
          // The empty badge has no breakdown to open; only open once a typed price
          // has an estimate.
          if (lastResult !== null) setBreakdownOpen(true);
        }}
        // A no-cost product can never estimate a profit — say why. With a cost, the
        // empty badge stays "—" (the input placeholder already prompts).
        emptyLabel={row.reason === 'NO_COST' ? t('table.enterCost') : undefined}
        calculatedLabel={t('table.calculatedProfit')}
        vsCurrentLabel={t('table.vsCurrent')}
      />

      {/* Real button foot — the input rules out a card overlay, so typing never
          selects and this is the explicit commit. Disabled until a band is derived. */}
      <TariffSelectFoot
        selected={isSelected}
        label={t('table.selectCustom')}
        selectedLabel={t('table.customSelected')}
        onToggle={handleToggleSelect}
        disabled={!isSelected && !canSelect}
      />

      <CommissionTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        result={lastResult}
        loading={estimate.isPending}
        profitLabel={tBreakdown('estimatedProfit')}
      />
    </TariffOptionCard>
  );
}
