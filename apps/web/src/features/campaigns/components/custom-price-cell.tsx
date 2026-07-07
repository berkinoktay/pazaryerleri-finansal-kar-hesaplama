'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { EstimateItemPriceResult } from '../api/estimate-item-price.api';
import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { useReasonEmptyLabel } from '../hooks/use-reason-label';
import { asBandKey } from '../lib/band-key';
import type { CustomChoice } from '../lib/bulk-actions';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
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
  /**
   * The net profit / margin CAPTURED when this row's custom price was committed — the band
   * figures the parent seeds into `customPrices` on reload. Shown as the badge value until
   * the live estimate refines it, so a reloaded committed price reads as a real figure, not
   * a loading pill. `null` (Advantage / Flash never seed one) means the badge waits on the
   * estimate and shows a skeleton meanwhile.
   */
  committedNetProfit?: string | null;
  committedMarginPct?: string | null;
  /** Whether the typed custom price is the row's most profitable option (an "En kârlı" ribbon). */
  isBest?: boolean;
  /**
   * Reports the estimated profit CURRENTLY SHOWN in this card back to the parent — the
   * debounced what-if `netProfit` when it returns, or `null` when the input is cleared.
   * The row's "En kârlı" marker races this LIVE (uncommitted) figure so the badge moves
   * the instant the estimate lands, without waiting for "Bu fiyatı seç". It feeds ONLY
   * the badge race — export/summary still key off the committed `customPrices`.
   *
   * The callback carries the `rowId` so the parent's ONE stable handler can be passed
   * DIRECTLY (no per-row inline arrow). A fresh closure here would change the effect's
   * dependency identity every render and needlessly restart the debounce.
   */
  onEstimate?: (rowId: string, netProfit: string | null) => void;
  /**
   * Reads this row's surviving DRAFT price from the parent's ref-based store, so a price
   * typed but NOT committed comes back after the cell unmounts — the DataTable unmounts
   * off-page rows on pagination, and a filter / tab switch unmounts the whole set. Return
   * value: `undefined` = no draft (seed from the committed / server price), `null` = the
   * seller deliberately cleared it (start EMPTY, do not fall back), a string = the draft
   * price. Read only in the mount-time lazy initializer — the draft must not drive renders
   * (the "En kârlı" race keys off `customEstimates`), so a ref is the right store.
   */
  getDraft?: (rowId: string) => string | null | undefined;
  /**
   * Persists this row's draft price into the parent's ref store on every keystroke so it
   * survives an unmount. A cleared input reports `null` (a deliberate clear that keeps the
   * remounted input empty); a typed value reports its decimal string.
   */
  onDraftChange?: (rowId: string, price: string | null) => void;
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
  committedNetProfit = null,
  committedMarginPct = null,
  isBest = false,
  onEstimate,
  getDraft,
  onDraftChange,
}: CustomPriceCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const tCommon = useTranslations('common');
  const tBreakdown = useTranslations('commissionTariffsPage.breakdown');
  const reasonEmptyLabel = useReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  // Seed the input, highest priority first: a surviving DRAFT from the parent's ref store
  // (so a price typed but not committed comes back after a pagination / filter / tab
  // unmount), then the edit-buffer's committed custom price (the same amount picked in
  // another sub-period), then the persisted server value (so reopening a tariff shows it).
  // A `null` draft means the seller deliberately cleared the field, so start empty — do
  // NOT fall through to the committed / server price. Reading the ref here, only in the
  // mount-time lazy initializer, is the accepted escape hatch: the draft must not drive
  // renders, so it lives in a ref. The debounced effect then re-estimates for this item.
  const [price, setPrice] = React.useState<Decimal | null>(() => {
    const draft = getDraft?.(row.id);
    const seed = draft !== undefined ? draft : (committedPrice ?? row.customPrice);
    return seed !== null ? new Decimal(seed) : null;
  });
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
    // Persist the draft into the parent's ref so it survives an unmount (pagination /
    // filter / tab switch); a cleared input records `null` — a deliberate clear that keeps
    // the remounted input empty rather than re-seeding from the committed / server price.
    onDraftChange?.(row.id, next !== null ? next.toFixed(2) : null);
    // Clearing the input drops the custom candidate from the "En kârlı" race at once.
    if (next === null) onEstimate?.(row.id, null);
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
  // Show the "Hesaplanan kâr" block only once the card carries a price in the input (a typed
  // draft, or a seeded committed / server price) — an empty card shows just the input + hint
  // + passive foot, never a mute "—" profit chip. Derived from the input state, so a
  // deliberate clear (price → null) hides the block again.
  const showProfitBlock = price !== null;
  // The figures the badge shows: the live estimate when it is in, else the committed seed
  // (commission carries a band profit; Advantage / Flash carry null). Live takes FULL
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
      {/* "En kârlı" — the same absolute ribbon the bands wear (the card is already
          relative+isolate), rendered only when the typed custom price is the row's
          most profitable option. */}
      {isBest ? <TariffBestRibbon label={t('table.best')} /> : null}

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
            // The empty badge has no breakdown to open; only open once a typed price
            // has an estimate.
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
