'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { asBandKey } from '../lib/band-key';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

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
 */
export function PriceBandCell({
  row,
  band,
  selected,
  isBest = false,
  onSelect,
}: PriceBandCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const { priceText, qualifier } = useBandLabel(band);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: band.price, bandKey: asBandKey(band.key) } });
  }

  return (
    <TariffOptionCard selected={selected} interactive>
      {/* Stretched-overlay select target. Sibling of the ProfitBadge (never an
          ancestor) so the badge's own <button> is not nested inside it. Price,
          commission and the foot ring sit below the overlay → clicking them selects. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={selected ? t('bandSelected') : t('selectBand')}
        onClick={() => onSelect(band.key)}
        // Tailwind v4 strips the native button cursor; the overlay covers the whole
        // card, so its cursor is what the seller sees hovering the band.
        className="focus-visible:shadow-focus absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none"
      />

      {/* "En kârlı" — a featured ribbon straddling the top border. Absolute, so it
          adds NO height: every card starts at the price, keeping cards short and the
          prices aligned. pointer-events-none → clicking it still selects via the
          overlay. Only the best band shows it. */}
      {isBest ? <TariffBestRibbon label={t('best')} /> : null}

      {/* Price boundary + its "ve altı / ve üzeri" qualifier as one hero unit, then
          the band's commission. */}
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
          <span className="text-base font-bold tabular-nums">{priceText}</span>
          <span className="text-xs font-normal">{qualifier}</span>
        </span>
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
        // A missing cost profile is the one empty-profit cause worth naming inline
        // ("Maliyet girin"); other non-calculable reasons keep the mute dash (their
        // full reason shows in the product identity cell).
        emptyLabel={row.reason === 'NO_COST' ? t('enterCost') : undefined}
        calculatedLabel={t('calculatedProfit')}
        vsCurrentLabel={t('vsCurrent')}
      />

      {/* Visual foot only — the card overlay owns the click. */}
      <TariffSelectFoot
        selected={selected}
        label={t('selectBand')}
        selectedLabel={t('bandSelected')}
      />

      <CommissionTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </TariffOptionCard>
  );
}
