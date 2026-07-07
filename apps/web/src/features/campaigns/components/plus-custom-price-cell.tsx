'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { EstimatePlusPriceResult } from '../api/estimate-plus-item-price.api';
import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { usePlusReasonEmptyLabel } from '../hooks/use-plus-reason-label';
import { plusOffer, type PlusCustomChoice } from '../lib/plus-bulk-actions';
import type { PlusTariffRow } from '../lib/adapt-plus-tariff';
import { useTariffScope } from '../lib/tariff-scope';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

const DEBOUNCE_MS = 400;

export interface PlusCustomPriceCellProps {
  row: PlusTariffRow;
  /** Whether THIS row's custom price is the seller's active selection. */
  isSelected: boolean;
  /** Commit the typed custom price as the selection (carrying its estimated profit). */
  onSelect: (choice: PlusCustomChoice) => void;
  /** Un-commit the custom price for this row. */
  onDeselect: () => void;
  /**
   * The custom price currently held in the edit buffer for this row (a decimal string),
   * if any. Seeds the input over the persisted `row.customPrice` so the same amount
   * picked in another sub-period shows here too; null → fall back to the server value.
   */
  committedPrice?: string | null;
  /**
   * The net profit / margin CAPTURED when this row's custom price was committed — the Plus
   * ceiling figures the parent seeds into `customPrices` on reload. Shown as the badge value
   * until the live estimate refines it, so a reloaded committed price reads as a real figure,
   * not a loading pill. `null` (Advantage / Flash never seed one) means the badge waits on
   * the estimate and shows a skeleton meanwhile.
   */
  committedNetProfit?: string | null;
  committedMarginPct?: string | null;
  /** Whether the typed custom price is the row's most profitable option (an "En kârlı" ribbon). */
  isBest?: boolean;
  /**
   * Reports the estimated profit CURRENTLY SHOWN in this card back to the parent — the
   * debounced what-if `netProfit` when it returns, or `null` when the input is cleared.
   * The row's "En kârlı" marker races this LIVE (uncommitted) figure so the badge moves
   * the instant the estimate lands. It feeds ONLY the badge race — export/summary key
   * off the committed `customPrices`. The callback carries the `rowId` so the parent's
   * ONE stable handler can be passed DIRECTLY (no per-row inline arrow).
   */
  onEstimate?: (rowId: string, netProfit: string | null) => void;
  /**
   * Reads this row's surviving DRAFT price from the parent's ref-based store, so a price
   * typed but NOT committed comes back after the cell unmounts (pagination / filter /
   * tab switch). `undefined` = no draft (seed from committed / server price), `null` =
   * the seller deliberately cleared it (start EMPTY), a string = the draft price.
   */
  getDraft?: (rowId: string) => string | null | undefined;
  /**
   * Persists this row's draft price into the parent's ref store on every keystroke so it
   * survives an unmount. A cleared input reports `null`; a typed value its decimal string.
   */
  onDraftChange?: (rowId: string, price: string | null) => void;
}

/**
 * Custom Plus-price "what-if" AND a selectable choice — the third card beside the
 * current baseline and the Plus offer, wearing the same {@link TariffOptionCard} shell +
 * {@link TariffProfitBlock} so the row reads as one uniform set: the INPUT stands in for
 * the offer's static ceiling price, then the reduced Plus commission, the calculated
 * profit + "vs current" delta, and a {@link TariffSelectFoot}.
 *
 * Unlike the click-the-card offer, the foot here is a REAL button (the `onToggle` form)
 * rather than a card overlay — the overlay would fight the input. Three separate,
 * non-overlapping targets keep it unambiguous: the input types, the badge opens the
 * breakdown, the foot commits. The debounced backend estimate returns the real profit at
 * the reduced Plus commission; editing a committed price un-commits it. No client-side
 * money math — the engine computes the authoritative value
 * (feedback_no_frontend_financial_calculation).
 */
export function PlusCustomPriceCell({
  row,
  isSelected,
  onSelect,
  onDeselect,
  committedPrice = null,
  committedNetProfit = null,
  committedMarginPct = null,
  isBest = false,
  onEstimate,
  getDraft,
  onDraftChange,
}: PlusCustomPriceCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const tCommon = useTranslations('common');
  const tBreakdown = useTranslations('plusCommissionTariffsPage.breakdown');
  const reasonEmptyLabel = usePlusReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  // The Plus offer's ceiling: the seller may try any price up to (and including) it,
  // never above — that is the whole point of the ceiling.
  const offer = plusOffer(row);
  const ceiling = React.useMemo(
    () => (offer !== undefined ? new Decimal(offer.price) : null),
    [offer],
  );
  // Seed the input, highest priority first: a surviving DRAFT from the parent's ref
  // store, then the edit-buffer's committed custom price, then the persisted server
  // value. A `null` draft means the seller deliberately cleared the field — start empty.
  const [price, setPrice] = React.useState<Decimal | null>(() => {
    const draft = getDraft?.(row.id);
    const seed = draft !== undefined ? draft : (committedPrice ?? row.customPrice);
    return seed !== null ? new Decimal(seed) : null;
  });
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  // Last SUCCESSFUL estimate. `mutate()` resets `estimate.data` to undefined, which
  // would unmount the badge on every debounced keystroke; keeping the previous figures
  // on screen kills that flicker. react-query fires a mutate-level onSuccess only for
  // the LATEST call, so an out-of-order older response can never overwrite a newer one.
  const [lastResult, setLastResult] = React.useState<EstimatePlusPriceResult | null>(null);

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
            // Event-driven report of the figure shown here so the row's "En kârlı"
            // badge races this live estimate — no watcher effect, fired on success.
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
  // Show the "Hesaplanan kâr" block only once the card carries a price in the input (a typed
  // draft, or a seeded committed / server price) — an empty card shows just the input + hint
  // + passive foot, never a mute "—" profit chip. Derived from the input state, so a
  // deliberate clear (price → null) hides the block again.
  const showProfitBlock = price !== null;
  // The figures the badge shows: the live estimate when it is in, else the committed seed
  // (Plus carries the ceiling profit; Advantage / Flash carry null). Live takes FULL
  // precedence — a not-calculable live result (breakdown null) must fall to the reason chip,
  // never the stale seed.
  const displayNetProfit =
    lastResult !== null ? (lastResult.breakdown?.netProfit ?? null) : committedNetProfit;
  const displayMarginPct =
    lastResult !== null ? (lastResult.breakdown?.saleMarginPct ?? null) : committedMarginPct;
  // Skeleton the badge slot while an estimate is on the way: a positive price is in the
  // input, no live result yet, and nothing seeds the figure — so a "—" would misread as
  // "no data". An errored estimate falls back to the default badge, never a stuck skeleton.
  const showEstimateSkeleton =
    price !== null &&
    price.greaterThan(0) &&
    lastResult === null &&
    committedNetProfit === null &&
    !estimate.isError;

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
    <TariffOptionCard selected={isSelected}>
      {/* "En kârlı" — the same absolute ribbon the offer wears (the card is already
          relative+isolate), rendered only when the typed custom price wins the row. */}
      {isBest ? <TariffBestRibbon label={t('table.best')} /> : null}

      {/* Input group — the field stands in for the offer's static ceiling price, the
          derived line for the offer's "Plus komisyon" line. */}
      <div className="gap-3xs flex w-full flex-col items-start">
        {/* Desktop has the "Plus Fiyatı" column header; the mobile card has none, so
            label it here (md:hidden). */}
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
            <>
              {t('table.plusCommission')}{' '}
              <span className="text-foreground font-semibold">
                {formatPercentDisplay(lastResult.commissionPct)}
              </span>
            </>
          ) : (
            t('table.customPriceHint')
          )}
        </span>
      </div>

      {/* The calculated-profit block appears only once a price is in the input; an empty
          card is just input + hint + passive foot (no mute "—" chip). */}
      {showProfitBlock ? (
        <TariffProfitBlock
          netProfit={displayNetProfit}
          marginPct={displayMarginPct}
          currentNetProfit={row.currentNetProfit}
          scale={scale}
          loading={showEstimateSkeleton}
          loadingLabel={tCommon('loading')}
          onOpenBreakdown={() => {
            // The empty badge has no breakdown to open; only open once a typed price has
            // an estimate.
            if (lastResult !== null) setBreakdownOpen(true);
          }}
          // A not-calculable row (e.g. no cost) can never estimate a profit — the badge
          // carries the short reason as a warning-soft chip; a calculable row keeps "—".
          emptyLabel={reasonEmptyLabel(row.reason)}
          calculatedLabel={t('table.calculatedProfit')}
          vsCurrentLabel={t('table.vsCurrent')}
        />
      ) : null}

      {/* Real button foot — the input rules out a card overlay, so typing never
          selects and this is the explicit commit. Disabled until an estimate is in. */}
      <TariffSelectFoot
        selected={isSelected}
        label={t('table.selectCustom')}
        selectedLabel={t('table.customSelected')}
        onToggle={handleToggleSelect}
        disabled={!isSelected && !canSelect}
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
    </TariffOptionCard>
  );
}
