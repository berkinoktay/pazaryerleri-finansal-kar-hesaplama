'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { cn } from '@/lib/utils';

import type { EstimateCampaignItemResult } from '../api/estimate-campaign-item.api';
import { useDiscountReasonLabel } from '../hooks/use-discount-reason-label';
import { compareFixedDecimal } from '../lib/best-choice';
import { CampaignProfitBreakdown } from './campaign-profit-breakdown';

export interface MarketplaceCampaignBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Barcode shown under the title. */
  stockCode?: string | null;
  /**
   * The campaign price the examined option sells at — the first line of the per-unit funding
   * chain. Null for the campaign-free current scenario.
   */
  campaignPrice: string | null;
  /** Backend estimate result — null before the first fetch. */
  result: EstimateCampaignItemResult | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /**
   * The row's current UNIT profit — the hero delta's baseline at unit scope. An order-scoped
   * result brings its own same-order baseline (`basket.currentOrderNetProfit`) instead.
   */
  currentNetProfit: string | null;
}

const isFunded = (amount: string | null): amount is string =>
  amount !== null && compareFixedDecimal(amount, '0') > 0;

/**
 * Kampanyalar adapter over the shared {@link CampaignProfitBreakdown}: resolves the
 * not-calculable reason and, below the allocation, spells out how the campaign splits the money
 * between the customer, Trendyol and the seller:
 *
 *  - an ORDER-scoped breakdown (the maximum / custom card of an X Al Y Öde-style campaign) walks
 *    the assumed order — basket total, campaign discount, what the customer pays, Trendyol's
 *    share, the seller's settlement and the order profit;
 *  - a UNIT-scoped breakdown of a funded campaign walks one unit — campaign price, what the
 *    customer pays, Trendyol's share and the seller's settlement.
 *
 * Every figure is backend-computed; this only renders. The client owns the estimate mutation and
 * which option is open.
 */
export function MarketplaceCampaignBreakdown({
  open,
  onOpenChange,
  productTitle,
  imageUrl,
  stockCode,
  campaignPrice,
  result,
  loading,
  currentNetProfit,
}: MarketplaceCampaignBreakdownProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.breakdown');
  const tSource = useTranslations('discountsPage.commissionSource');
  const reasonLabel = useDiscountReasonLabel();

  const basket = result?.basket ?? null;
  // An order is compared with the SAME order campaign-free; a unit with the row's current unit.
  const baseline = basket !== null ? basket.currentOrderNetProfit : currentNetProfit;
  const profitLabel =
    basket !== null ? t('orderProfitLabel', { qty: basket.assumedQuantity }) : undefined;

  // Which tier fed the commission ("Tarife bandı · 7 - 14 Temmuz"); the tariff name rides as a
  // hover tooltip. Concrete keys — next-intl's typed `t` takes a literal, not the source union.
  const sourceLabel: Record<'band' | 'product' | 'category', string> = {
    band: tSource('band'),
    product: tSource('product'),
    category: tSource('category'),
  };
  const source = result?.commissionSource ?? null;
  const periodLabel = result?.commissionPeriodLabel ?? null;
  const baseSourceLabel = source !== null ? sourceLabel[source] : null;
  const commissionSourceLabel =
    baseSourceLabel !== null && source === 'band' && periodLabel !== null && periodLabel !== ''
      ? `${baseSourceLabel} · ${periodLabel}`
      : baseSourceLabel;
  const commissionSourceTitle = source === 'band' ? (result?.commissionTariffName ?? null) : null;

  let footer: React.ReactNode;
  if (result !== null && basket !== null) {
    const qty = basket.assumedQuantity;
    const funded = isFunded(basket.trendyolFundedTotal);
    footer = (
      <ChainSection title={t('basketTitle')} intro={t('basketIntro', { qty })}>
        <ChainRow label={t('basketTotal', { qty })}>
          <Currency value={basket.basketTotal} />
        </ChainRow>
        <ChainRow label={t('campaignDiscount')}>
          {/* Signed as a reduction — the "−" sits flush against the amount as one unit. */}
          <span>−</span>
          <Currency value={basket.basketDiscountTotal} />
        </ChainRow>
        <ChainRow label={t('customerPaid')}>
          <Currency value={basket.basketPaidTotal} />
        </ChainRow>
        {funded ? (
          <>
            <ChainRow label={t('trendyolFunded')}>
              <span>+</span>
              <Currency value={basket.trendyolFundedTotal} />
            </ChainRow>
            <ChainRow label={t('sellerSettlement')}>
              <Currency value={result.price} />
            </ChainRow>
          </>
        ) : null}
        {basket.orderNetProfit !== null ? (
          <>
            <ChainRow label={t('orderProfit', { qty })} emphasis>
              <Currency value={basket.orderNetProfit} />
            </ChainRow>
            {/* The order ships as ONE parcel, so shipping is counted once — spell that out right
                under the figure it drives. */}
            <ChainNote>{t('singleParcelNote', { qty })}</ChainNote>
          </>
        ) : null}
        <ChainNote>{t('distributionNote')}</ChainNote>
        {funded ? <ChainNote>{t('fundingNote')}</ChainNote> : null}
      </ChainSection>
    );
  } else if (
    result !== null &&
    campaignPrice !== null &&
    result.customerPaidUnitPrice !== null &&
    isFunded(result.trendyolFundedUnitAmount)
  ) {
    footer = (
      <ChainSection title={t('fundingTitle')}>
        <ChainRow label={t('campaignPrice')}>
          <Currency value={campaignPrice} />
        </ChainRow>
        <ChainRow label={t('customerPaid')}>
          <Currency value={result.customerPaidUnitPrice} />
        </ChainRow>
        <ChainRow label={t('trendyolFunded')}>
          <span>+</span>
          <Currency value={result.trendyolFundedUnitAmount} />
        </ChainRow>
        <ChainRow label={t('sellerSettlement')} emphasis>
          <Currency value={result.price} />
        </ChainRow>
        <ChainNote>{t('fundingNote')}</ChainNote>
      </ChainSection>
    );
  }

  return (
    <CampaignProfitBreakdown
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      productTitle={productTitle}
      imageUrl={imageUrl}
      stockCode={stockCode}
      breakdown={result?.breakdown ?? null}
      commissionPct={result?.commissionPct ?? null}
      commissionSourceLabel={commissionSourceLabel}
      commissionSourceTitle={commissionSourceTitle}
      reasonText={result?.reason != null ? reasonLabel(result.reason) : null}
      loading={loading}
      profitLabel={profitLabel}
      currentNetProfit={baseline}
      footer={footer}
    />
  );
}

/** The footer block: a divider, a small heading, an optional intro sentence, then the rows. */
function ChainSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="border-border pt-md gap-2xs flex flex-col border-t">
      <span className="text-foreground text-xs font-medium">{title}</span>
      {intro !== undefined ? <p className="text-2xs text-muted-foreground">{intro}</p> : null}
      {children}
    </div>
  );
}

/** One label → amount row: muted label left, the amount right-aligned with tabular numerics. */
function ChainRow({
  label,
  emphasis = false,
  children,
}: {
  label: string;
  emphasis?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums', emphasis && 'font-medium')}>{children}</span>
    </div>
  );
}

function ChainNote({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="text-2xs text-muted-foreground">{children}</p>;
}
