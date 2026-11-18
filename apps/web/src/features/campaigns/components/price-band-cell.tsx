'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { useReasonEmptyLabel } from '../hooks/use-reason-label';
import { asBandKey } from '../lib/band-key';
import { useCampaignAccess } from '../lib/campaign-access-context';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';
import { TariffUnknownPrice } from './tariff-unknown-price';

export interface PriceBandCellProps {
  row: CommissionTariffRow;
  band: PriceBand;
  /** Whether the seller has chosen this band (at its boundary price) for the product. */
  selected: boolean;
  /** Whether this is the most profitable band (a quiet "En kârlı" badge). */
  isBest?: boolean;
  onSelect: (key: string) => void;
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
  // Neither limit: the band's price is the current price, null when that is unknown.
  if (band.price === null) {
    return { priceText: t('priceUnknown'), qualifier: '' };
  }
  return { priceText: formatCurrency(band.price), qualifier: '' };
}

/**
 * One price band as a CLICKABLE CARD — the whole {@link TariffOptionCard} is the
 * select target (a stretched-overlay button), so the seller picks a band by clicking
 * anywhere on it. Left-aligned, matching the mock: the PRICE (with its "ve altı / ve
 * üzeri" qualifier) is the hero, then commission, the shared {@link TariffProfitBlock},
 * and a {@link TariffSelectFoot} ("Bu aralığı seç" ring → "Seçildi" tick). Selected =
 * brand border + soft brand fill + a featured "En kârlı" ribbon on the best band.
 *
 * Selection is a TOGGLE (one OR none per product) owned by the parent: choosing a
 * band clears any custom price; re-clicking the chosen band clears it.
 *
 * A11y: the overlay `<button>` is a SIBLING of the ProfitBadge (which is itself a
 * `<button>` opening the breakdown), never an ancestor — nesting `<button>` in
 * `<button>` is invalid HTML and breaks hydration. The badge (and the ribbon) are
 * raised (`z-10`) so the badge's click still reaches it; the price, commission and
 * foot sit below the overlay and select.
 *
 * A band with no price (neither limit, and the row's current price is unknown) shows
 * "Bilinmiyor" with a short explanation line under it, has no profit and never wears
 * the "En kârlı" ribbon. The backend refuses to store it as a selection, so while
 * unselected the card has no select target and its foot reads "Seçilemez". If it is
 * somehow already selected, the overlay stays so the seller can still deselect it.
 */
export function PriceBandCell({
  row,
  band,
  selected,
  isBest = false,
  onSelect,
}: PriceBandCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.table');
  const reasonEmptyLabel = useReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const { priceText, qualifier } = useBandLabel(band);
  const priceUnknown = band.price === null;
  // A band with no price can only be deselected, never newly chosen.
  const selectable = !priceUnknown || selected;
  const { canWrite } = useCampaignAccess();
  // A member who cannot write reads the band but gets no select target.
  const hasSelectTarget = canWrite && selectable;

  function openBreakdown(): void {
    setBreakdownOpen(true);
    // A band with no price has nothing to estimate; the dialog opens with no result.
    if (band.price === null) return;
    estimate.mutate({ itemId: row.id, body: { price: band.price, bandKey: asBandKey(band.key) } });
  }

  return (
    <TariffOptionCard selected={selected} interactive={hasSelectTarget}>
      {/* Stretched-overlay select target. Sibling of the ProfitBadge (never an
          ancestor) so the badge's own <button> is not nested inside it. Price,
          commission and the foot ring sit below the overlay → clicking them selects.
          Absent on a band that cannot be selected, and for a member who cannot write. */}
      {hasSelectTarget ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={selected ? t('bandSelected') : t('selectBand')}
          onClick={() => onSelect(band.key)}
          // Tailwind v4 strips the native button cursor; the overlay covers the whole
          // card, so its cursor is what the seller sees hovering the band.
          className="focus-visible:shadow-focus absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none"
        />
      ) : null}

      {/* "En kârlı" — a featured ribbon straddling the top border. Absolute, so it
          adds NO height: every card starts at the price, keeping cards short and the
          prices aligned. pointer-events-none → clicking it still selects via the
          overlay. Only the best band shows it, and never a band with no price. */}
      {isBest && !priceUnknown ? <TariffBestRibbon label={t('best')} /> : null}

      {/* Price boundary + its "ve altı / ve üzeri" qualifier as one hero unit, then
          the band's commission. An unknown price reads muted, never as an amount. */}
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        {priceUnknown ? (
          // "Bilinmiyor" and, on its own line under it, why: plain text, so it reads on
          // touch devices too (no hover needed).
          <TariffUnknownPrice label={priceText} hint={t('bandPriceUnknownHint')} />
        ) : (
          <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
            <span className="text-base font-bold tabular-nums">{priceText}</span>
            <span className="text-xs font-normal">{qualifier}</span>
          </span>
        )}
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('commission')} {formatPercentDisplay(band.commissionPct)}
        </span>
      </div>

      <TariffProfitBlock
        netProfit={band.netProfit}
        marginPct={band.marginPct}
        currentNetProfit={row.currentNetProfit}
        scale={scale}
        onOpenBreakdown={openBreakdown}
        // The row's not-calculable reason (or undefined when calculable) rides the empty
        // badge as a warning-soft chip — the same reason-aware signal every option in the
        // row shows, now that the product cell no longer prints it inline.
        emptyLabel={reasonEmptyLabel(row.reason)}
        calculatedLabel={t('calculatedProfit')}
        vsCurrentLabel={t('vsCurrent')}
      />

      {/* Visual foot only — the card overlay owns the click. A band that cannot be
          selected says so, dimmed like a disabled foot. */}
      <TariffSelectFoot
        selected={selected}
        label={selectable ? t('selectBand') : t('bandNotSelectable')}
        selectedLabel={t('bandSelected')}
        disabled={!selectable}
      />

      <CommissionTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.stockCode}
        currentNetProfit={row.currentNetProfit}
        result={priceUnknown ? null : (estimate.data ?? null)}
        loading={priceUnknown ? false : estimate.isPending}
      />
    </TariffOptionCard>
  );
}
