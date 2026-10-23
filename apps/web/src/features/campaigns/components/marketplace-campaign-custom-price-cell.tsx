'use client';

import { Decimal } from 'decimal.js';
import { Alert02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { MoneyInput } from '@/components/patterns/money-input';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useCustomPriceWhatIf } from '../hooks/use-custom-price-what-if';
import { useDiscountReasonEmptyLabel } from '../hooks/use-discount-reason-label';
import type {
  CampaignScenarioPresentation,
  MarketplaceCampaignRow,
} from '../lib/adapt-marketplace-campaign';
import {
  campaignRowBestOption,
  customOptionFigures,
  customPriceStatus,
  estimateOptionFigures,
  type CampaignTargetMarginMark,
} from '../lib/marketplace-campaign-selection';
import { MarketplaceCampaignBreakdown } from './marketplace-campaign-breakdown';
import { CampaignOptionDetails } from './marketplace-campaign-option-details';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

export interface MarketplaceCampaignCustomPriceCellProps {
  row: MarketplaceCampaignRow;
  /** UNIT rows show the per-unit scenario; ORDER rows the assumed order at the typed price. */
  presentation: CampaignScenarioPresentation;
  /** The buffered custom price (2-decimal string); null when none is typed. */
  price: string | null;
  /** Whether the row joins the campaign with this custom price. */
  selected: boolean;
  /**
   * Writes a typed price into the parent's buffer (null when the input is cleared). Carries the
   * row so the parent's ONE stable handler can check the price against the row's ceiling.
   */
  onPriceChange: (row: MarketplaceCampaignRow, price: string | null) => void;
  /** Toggles joining with the custom price (re-choosing clears it). */
  onToggle: () => void;
  /** Why the last target-margin run could not price this row, if it could not. */
  targetMarginMark?: CampaignTargetMarginMark | null;
}

/**
 * The seller's OWN campaign price — a what-if AND a selectable option, in the same {@link
 * TariffOptionCard} shell as the maximum card so the row reads as one set. The input stands in
 * for a static price; the buffer (the parent) owns its value, so a bulk action that fills or
 * clears prices shows up here too.
 *
 * The ceiling is the maximum price. Unlike `MoneyInput`'s `max` (which silently refuses the
 * keystroke and can leave "125" where "1250" was meant), a price above it IS accepted and flagged
 * inline, the select control stays disabled and nothing is estimated — the backend would refuse
 * it anyway. The what-if for a new valid price comes from {@link useCustomPriceWhatIf}, shared
 * with the maximum card; the SAVED price needs no request, its scenario and basket already ride on
 * the row. No client-side money math — the engine computes every figure.
 */
export function MarketplaceCampaignCustomPriceCell({
  row,
  presentation,
  price,
  selected,
  onPriceChange,
  onToggle,
  targetMarginMark = null,
}: MarketplaceCampaignCustomPriceCellProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.table');
  const tCommon = useTranslations('common');
  const reasonEmptyLabel = useDiscountReasonEmptyLabel();
  const scale = useMarginColoring();
  const errorId = React.useId();
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  // An open breakdown prices the input at once — the saved price included.
  const whatIf = useCustomPriceWhatIf(row, price, breakdownOpen);

  const status = customPriceStatus(price, row);
  const isSavedPrice = price !== null && price === row.customPrice;
  const liveResult = whatIf.result;
  const live =
    liveResult !== null && price !== null
      ? { price, figures: estimateOptionFigures(liveResult, row.current) }
      : undefined;
  const figures = customOptionFigures(row, presentation, price, live);
  const isBest = campaignRowBestOption(row, presentation, price, live) === 'custom';
  const commissionPct =
    liveResult !== null
      ? liveResult.commissionPct
      : isSavedPrice
        ? (row.customScenario?.commissionPct ?? null)
        : null;
  // One Decimal per price, so the input's controlled sync does not re-run on every render.
  const inputValue = React.useMemo(() => (price !== null ? new Decimal(price) : null), [price]);

  function handleChange(next: Decimal | null): void {
    const nextPrice = next !== null ? next.toFixed(2) : null;
    // "12," and "12" parse to the same price — nothing changed for the buffer.
    if (nextPrice === price) return;
    onPriceChange(row, nextPrice);
  }

  function openBreakdown(): void {
    if (status === 'valid') setBreakdownOpen(true);
  }

  const ceiling = formatCurrency(row.maxPrice);
  const error =
    status === 'aboveMax'
      ? t('customPriceAboveMax', { price: ceiling })
      : status === 'notPositive'
        ? t('customPriceNotPositive')
        : null;
  const orderFramed = figures?.order != null;

  return (
    <TariffOptionCard selected={selected}>
      {isBest ? <TariffBestRibbon label={t('bestOption')} /> : null}

      <div className="gap-3xs flex w-full flex-col items-start">
        {/* Desktop has the column header; the mobile card has none, so label it here. */}
        <span className="text-2xs text-muted-foreground font-medium md:hidden">
          {t('customPrice')}
        </span>
        <MoneyInput
          value={inputValue}
          onChange={handleChange}
          nonNegative
          invalid={error !== null}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          aria-label={t('customPriceAria', { product: row.productTitle })}
          placeholder={t('enterPrice')}
          className="md:max-w-input-price w-full"
        />
        {error !== null ? (
          <span id={errorId} className="text-2xs text-destructive">
            {error}
          </span>
        ) : figures !== null || commissionPct !== null ? (
          <CampaignOptionDetails
            order={figures?.order ?? null}
            commissionPct={commissionPct}
            commissionBands={row.commissionBands}
          />
        ) : (
          <span className="text-2xs text-muted-foreground">
            {t('customPriceCeilingHint', { price: ceiling })}
          </span>
        )}
        {targetMarginMark !== null ? (
          <span className="gap-3xs text-2xs text-warning flex items-start">
            <Alert02Icon className="size-icon-xs mt-3xs shrink-0" aria-hidden />
            {targetMarginMark === 'UNREACHABLE'
              ? t('targetMarginUnreachable')
              : t('targetMarginNotCalculable')}
          </span>
        ) : null}
      </div>

      {/* The profit block appears once a valid price is in; an empty card is just the input, the
          ceiling hint and the foot (no mute "—" chip). */}
      {status === 'valid' ? (
        <TariffProfitBlock
          netProfit={figures?.netProfit ?? null}
          marginPct={figures?.marginPct ?? null}
          currentNetProfit={figures?.baselineNetProfit ?? null}
          scale={scale}
          // The estimate is on its way: hold the badge's slot instead of a "—" that would read as
          // "no data". A failed estimate falls back to the default badge, never a stuck skeleton.
          loading={figures === null && !whatIf.isError}
          loadingLabel={tCommon('loading')}
          onOpenBreakdown={openBreakdown}
          emptyLabel={reasonEmptyLabel(row.reason)}
          calculatedLabel={orderFramed ? t('orderProfit') : t('calculatedProfit')}
          vsCurrentLabel={orderFramed ? t('vsWithoutCampaign') : t('vsCurrent')}
        />
      ) : null}

      {/* A real button — the input rules out a card overlay, so typing never selects. */}
      <TariffSelectFoot
        selected={selected}
        label={t('selectPrice')}
        selectedLabel={t('selected')}
        onToggle={onToggle}
        disabled={!selected && status !== 'valid'}
      />

      <MarketplaceCampaignBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.barcode}
        campaignPrice={price}
        result={liveResult}
        loading={whatIf.isFetching && liveResult === null}
        currentNetProfit={row.current.netProfit}
      />
    </TariffOptionCard>
  );
}
