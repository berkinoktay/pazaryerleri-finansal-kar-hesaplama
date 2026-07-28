'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { cn } from '@/lib/utils';

import type { EstimateDiscountItemResult } from '../api/estimate-discount-item.api';
import { useDiscountReasonLabel } from '../hooks/use-discount-reason-label';
import type { DiscountBasketScenario } from '../lib/adapt-discount-list';

import { CampaignProfitBreakdown } from './campaign-profit-breakdown';

export interface DiscountBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Product code (barkod / model kodu) shown under the title; optional. */
  stockCode?: string | null;
  /** Backend estimate result — null before the first fetch. */
  result: EstimateDiscountItemResult | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /** Current-scenario net profit — the "Güncele göre" delta baseline (self-cancels for `current`). */
  currentNetProfit?: string | null;
  /**
   * The row's single-product-basket settlement scenario — passed ONLY when the DISCOUNTED scenario
   * is open (the client gates on the scenario key). Non-null only for basket-scoped discount types;
   * when set it renders the order-level settlement rows in the modal footer. Backend-computed —
   * this only renders.
   */
  scenario?: DiscountBasketScenario | null;
}

/**
 * İndirimler adapter over the shared {@link CampaignProfitBreakdown}: resolves this vertical's
 * not-calculable reason (which INCLUDES `NO_COMMISSION`, unlike Flash) and forwards the estimate
 * for the chosen scenario. Unlike the sibling verticals it also annotates the commission with its
 * SOURCE (tariff band / product / category) next to the rate inside the modal — the rows
 * themselves only show price + profit. Wired like the Flash breakdown — the client owns the
 * estimate mutation + which item/scenario is open, this only renders the result.
 */
export function DiscountBreakdown({
  open,
  onOpenChange,
  productTitle,
  imageUrl,
  stockCode,
  result,
  loading,
  currentNetProfit,
  scenario,
}: DiscountBreakdownProps): React.ReactElement {
  const t = useTranslations('discountsPage.breakdown');
  const tSource = useTranslations('discountsPage.commissionSource');
  const tScenario = useTranslations('discountsPage.scenario');
  const reasonLabel = useDiscountReasonLabel();

  // Concrete-key label map (next-intl's typed `t` takes a literal, not the source union).
  const sourceLabel: Record<'band' | 'product' | 'category', string> = {
    band: tSource('band'),
    product: tSource('product'),
    category: tSource('category'),
  };
  const source = result?.commissionSource ?? null;

  // For a 'band' source, append the resolving tariff PERIOD next to the label (e.g.
  // "Tarife bandı · 7 - 14 Temmuz") and expose the tariff NAME as a hover tooltip — the
  // seller sees which future-anchored week actually fed the rate. Labels are data, not i18n.
  const periodLabel = result?.commissionPeriodLabel ?? null;
  const baseSourceLabel = source !== null ? sourceLabel[source] : null;
  const commissionSourceLabel =
    baseSourceLabel !== null && source === 'band' && periodLabel !== null && periodLabel !== ''
      ? `${baseSourceLabel} · ${periodLabel}`
      : baseSourceLabel;
  const commissionSourceTitle = source === 'band' ? (result?.commissionTariffName ?? null) : null;

  // Basket-scoped discounts (scenario passed only for the DISCOUNTED view) append an order-level
  // settlement block below the breakdown: the assumed single-product basket, its discount, what the
  // customer pays, and — when calculable — the order's net profit. Every figure is backend-computed
  // (the row scenario), this only renders. Independent of the chip's popover by design (same visual
  // language, no shared abstraction — both are small and local).
  const footer =
    scenario != null ? (
      <div className="border-border pt-md gap-2xs flex flex-col border-t">
        <ScenarioRow label={tScenario('assumedBasket', { qty: scenario.assumedQuantity })}>
          <Currency value={scenario.basketTotal} />
        </ScenarioRow>
        <ScenarioRow label={tScenario('basketDiscount')}>
          {/* Signed as a reduction — the "−" sits flush against the amount as one unit. */}
          <span>−</span>
          <Currency value={scenario.basketDiscountTotal} />
        </ScenarioRow>
        <ScenarioRow label={tScenario('paidTotal')}>
          <Currency value={scenario.basketPaidTotal} />
        </ScenarioRow>
        {scenario.orderNetProfit !== null ? (
          <ScenarioRow label={tScenario('orderProfit', { qty: scenario.assumedQuantity })} emphasis>
            <Currency value={scenario.orderNetProfit} />
          </ScenarioRow>
        ) : null}
      </div>
    ) : undefined;

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
      currentNetProfit={currentNetProfit}
      footer={footer}
    />
  );
}

/**
 * One label → value row of the settlement-scenario footer: muted label on the left, the amount
 * right-aligned with tabular numerics. `emphasis` bumps the value to medium weight (the order
 * profit row). Local to this file — the sibling chip popover keeps its own copy by design.
 */
function ScenarioRow({
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
