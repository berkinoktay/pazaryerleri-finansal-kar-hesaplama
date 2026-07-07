'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { MoneyInput } from '@/components/patterns/money-input';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { EstimateFlashPriceResult } from '../api/estimate-flash-item-price.api';
import { useEstimateFlashItemPrice } from '../hooks/use-estimate-flash-item-price';
import type { FlashProductRow } from '../lib/adapt-flash-product';
import { flashCustomCeiling, type FlashCustomChoice } from '../lib/flash-bulk-actions';
import { findBandForPrice, formatBandRange } from '../lib/commission-band-range';
import { useTariffScope } from '../lib/tariff-scope';
import { CommissionBandsPopover, type CommissionBandsLabels } from './commission-bands-popover';
import { FlashProductBreakdown } from './flash-product-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

const DEBOUNCE_MS = 400;

/**
 * The Flash vertical's band-range + popover-chrome templates, bound to
 * `flashProductsPage.commissionBands`. The Advantage caller has its own equivalent — the
 * ONE shared {@link CommissionBandsPopover} takes the labels as props so neither namespace
 * is hard-coded into it.
 */
function useFlashCommissionBandLabels(): CommissionBandsLabels {
  const t = useTranslations('flashProductsPage.commissionBands');
  return {
    above: (price) => t('above', { price }),
    range: (lower, upper) => t('range', { lower, upper }),
    below: (price) => t('below', { price }),
    title: t('title'),
    hint: t('hint'),
  };
}

export interface FlashCustomPriceCellProps {
  row: FlashProductRow;
  /** Whether THIS row's custom price is the seller's active selection. */
  isSelected: boolean;
  /** Commit the typed custom price as the selection (carrying its estimated profit). */
  onSelect: (choice: FlashCustomChoice) => void;
  /** Un-commit the custom price for this row. */
  onDeselect: () => void;
  /**
   * The custom price currently held in the edit buffer for this row (a decimal string),
   * if any. Seeds the input over the persisted `row.customPrice`; null → fall back to the
   * server value.
   */
  committedPrice?: string | null;
  /** Whether the typed custom price is the row's most profitable option (an "En kârlı" ribbon). */
  isBest?: boolean;
  /**
   * Reports the estimated profit CURRENTLY SHOWN in this card back to the parent — the
   * debounced what-if `netProfit` when it returns, or `null` when the input is cleared. The
   * row's "En kârlı" marker races this LIVE (uncommitted) figure so the badge moves the
   * instant the estimate lands. It feeds ONLY the badge race — export/summary key off the
   * committed `customPrices`. The callback carries the `rowId` so the parent's ONE stable
   * handler can be passed DIRECTLY (no per-row inline arrow).
   */
  onEstimate?: (rowId: string, netProfit: string | null) => void;
  /**
   * Reads this row's surviving DRAFT price from the parent's ref-based store, so a price
   * typed but NOT committed comes back after the cell unmounts (pagination / filter
   * switch). `undefined` = no draft (seed from committed / server price), `null` = the
   * seller deliberately cleared it (start EMPTY), a string = the draft price.
   */
  getDraft?: (rowId: string) => string | null | undefined;
  /**
   * Persists this row's draft price into the parent's ref store on every keystroke so it
   * survives an unmount. A cleared input reports `null`; a typed value its decimal string.
   */
  onDraftChange?: (rowId: string, price: string | null) => void;
}

/**
 * Custom Flash-price "what-if" AND a selectable choice — the card beside the current
 * baseline and the two flash offers, wearing the same {@link TariffOptionCard} shell +
 * {@link TariffProfitBlock} so the row reads as one uniform set: the INPUT stands in for an
 * offer's static price, then the derived commission, the calculated profit + "vs current"
 * delta, and a {@link TariffSelectFoot}.
 *
 * Unlike the click-the-card offers, the foot here is a REAL button (the `onToggle` form)
 * rather than a card overlay — the overlay would fight the input. The debounced backend
 * estimate returns the real profit at whichever commission band the price lands in; editing
 * a committed price un-commits it. No client-side money math — the engine computes the
 * authoritative value. A custom flash price has a CEILING — the LOWEST present offer price
 * (`min(offer24, offer3)`) — so the input carries a `max` and a "Maks. {price} girebilirsin"
 * hint.
 */
export function FlashCustomPriceCell({
  row,
  isSelected,
  onSelect,
  onDeselect,
  committedPrice = null,
  isBest = false,
  onEstimate,
  getDraft,
  onDraftChange,
}: FlashCustomPriceCellProps): React.ReactElement {
  const t = useTranslations('flashProductsPage');
  const tBreakdown = useTranslations('flashProductsPage.breakdown');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateFlashItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  // The custom-price ceiling: the lowest of the row's present offer prices — a custom flash
  // price may never exceed the best offer the seller was given.
  const ceiling = React.useMemo(() => flashCustomCeiling(row), [row]);
  // Seed the input, highest priority first: a surviving DRAFT from the parent's ref store,
  // then the edit-buffer's committed custom price, then the persisted server value. A
  // `null` draft means the seller deliberately cleared the field — start empty.
  const [price, setPrice] = React.useState<Decimal | null>(() => {
    const draft = getDraft?.(row.id);
    const seed = draft !== undefined ? draft : (committedPrice ?? row.customPrice);
    return seed !== null ? new Decimal(seed) : null;
  });
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  // Last SUCCESSFUL estimate. `mutate()` resets `estimate.data` to undefined, which would
  // unmount the badge on every debounced keystroke; keeping the previous figures on screen
  // kills that flicker. react-query fires a mutate-level onSuccess only for the LATEST
  // call, so an out-of-order older response can never overwrite a newer one.
  const [lastResult, setLastResult] = React.useState<EstimateFlashPriceResult | null>(null);

  // Debounced what-if: fire the estimate ~400ms after the seller stops typing.
  React.useEffect(() => {
    if (price === null || !price.greaterThan(0)) return undefined;
    const priceStr = price.toFixed(2);
    const handle = setTimeout(() => {
      estimateMutate(
        { itemId: row.id, body: { price: priceStr } },
        {
          onSuccess: (data) => {
            setLastResult(data);
            // Event-driven report of the figure shown here so the row's "En kârlı" badge
            // races this live estimate — no watcher effect, fired on success.
            onEstimate?.(row.id, data.breakdown?.netProfit ?? null);
          },
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [price, row.id, estimateMutate, onEstimate]);

  function handleChange(next: Decimal | null): void {
    setPrice(next);
    // Persist the draft into the parent's ref so it survives an unmount; a cleared input
    // records `null` — a deliberate clear that keeps the remounted input empty.
    onDraftChange?.(row.id, next !== null ? next.toFixed(2) : null);
    // Clearing the input drops the custom candidate from the "En kârlı" race at once.
    if (next === null) onEstimate?.(row.id, null);
    // Editing a committed custom price un-commits it — the seller re-confirms the new
    // value, so the selected amount is always the last confirmed one.
    if (isSelected) onDeselect();
  }

  // "Seç" is only meaningful once the estimate for the CURRENT typed price is back and
  // calculable — otherwise there is no confirmed profit to commit.
  const hasEstimate =
    price !== null &&
    lastResult !== null &&
    lastResult.calculable &&
    lastResult.price === price.toFixed(2);
  const canSelect = hasEstimate;

  // The commission band the estimated price landed in, so the derived line can name the
  // window ("≈ ₺146,00 ve altı") — only when a ladder exists AND the estimate resolved via
  // a band (a flat-rate item has no ladder to point at). Pure comparison; the profit itself
  // is server-computed.
  const commissionBands = row.commissionBands;
  const bandLabels = useFlashCommissionBandLabels();
  const estimatedBand =
    hasEstimate && commissionBands !== null && lastResult.commissionSource === 'band'
      ? findBandForPrice(commissionBands, new Decimal(lastResult.price))
      : null;
  const rangeLabel =
    estimatedBand !== null ? formatBandRange(estimatedBand, formatCurrency, bandLabels) : null;

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

  // Placeholder hint (before an estimate): name the ceiling when the row has one, so the
  // seller knows the cap up front.
  const placeholderHint =
    ceiling !== null
      ? t('table.customPriceCeilingHint', { price: formatCurrency(ceiling.toFixed(2)) })
      : t('table.customPriceHint');

  return (
    <TariffOptionCard selected={isSelected}>
      {/* "En kârlı" — the same absolute ribbon the offers wear (the card is already
          relative+isolate), rendered only when the typed custom price wins the row. */}
      {isBest ? <TariffBestRibbon label={t('table.bestOffer')} /> : null}

      {/* Input group — the field stands in for an offer's static price, the derived line
          for its commission. */}
      <div className="gap-3xs flex w-full flex-col items-start">
        {/* Desktop has the "Özel Fiyat" column header; the mobile card has none, so label
            it here (md:hidden). */}
        <span className="text-2xs text-muted-foreground font-medium md:hidden">
          {t('table.customPrice')}
        </span>
        <MoneyInput
          value={price}
          onChange={handleChange}
          nonNegative
          max={ceiling ?? undefined}
          aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
          placeholder={t('table.enterPrice')}
          className="md:max-w-input-price w-full"
        />
        <span className="text-2xs text-muted-foreground">
          {hasEstimate && lastResult.commissionPct != null ? (
            rangeLabel !== null ? (
              <>
                ≈ <span className="text-foreground font-semibold">{rangeLabel}</span> ·{' '}
                {t('table.offerCommission')} {formatPercentDisplay(lastResult.commissionPct)}{' '}
                {/* The ⓘ rides at the END of the derived range line so the price window and
                    the ladder that produced it read as one unit. Band-sourced estimates
                    only — a flat-rate item has no ladder (rangeLabel is null). */}
                {commissionBands !== null ? (
                  <CommissionBandsPopover bands={commissionBands} labels={bandLabels} />
                ) : null}
              </>
            ) : (
              <>
                {t('table.offerCommission')}{' '}
                <span className="text-foreground font-semibold">
                  {formatPercentDisplay(lastResult.commissionPct)}
                </span>
              </>
            )
          ) : (
            placeholderHint
          )}
        </span>
      </div>

      <TariffProfitBlock
        netProfit={lastResult?.breakdown?.netProfit ?? null}
        marginPct={lastResult?.breakdown?.saleMarginPct ?? null}
        currentNetProfit={row.currentNetProfit}
        scale={scale}
        onOpenBreakdown={() => {
          // The empty badge has no breakdown to open; only open once a typed price has an
          // estimate.
          if (lastResult !== null) setBreakdownOpen(true);
        }}
        emptyLabel={row.reason === 'NO_COST' ? t('table.enterCost') : undefined}
        calculatedLabel={t('table.calculatedProfit')}
        vsCurrentLabel={t('table.vsCurrent')}
      />

      {/* Real button foot — the input rules out a card overlay, so typing never selects and
          this is the explicit commit. Disabled until an estimate is in. */}
      <TariffSelectFoot
        selected={isSelected}
        label={t('table.selectCustom')}
        selectedLabel={t('table.customSelected')}
        onToggle={handleToggleSelect}
        disabled={!isSelected && !canSelect}
      />

      <FlashProductBreakdown
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
