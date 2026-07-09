'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { EstimateAdvantagePriceResult } from '../api/estimate-advantage-item-price.api';
import { useAdvantageReasonLabel } from '../hooks/use-advantage-reason-label';

import { CampaignProfitBreakdown } from './campaign-profit-breakdown';

export interface AdvantageTariffBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Product code (stok kodu) shown under the title; optional. */
  stockCode?: string | null;
  /** Backend estimate result — null before the first fetch. */
  result: EstimateAdvantagePriceResult | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /** Final profit-row label; defaults to "Tahmini kâr". */
  profitLabel?: string;
  /** Current-scenario net profit — the "Güncele göre" delta baseline. */
  currentNetProfit?: string | null;
}

/**
 * Advantage-tariff adapter over the shared {@link CampaignProfitBreakdown}: resolves
 * this vertical's not-calculable reason and forwards the estimate.
 */
export function AdvantageTariffBreakdown({
  open,
  onOpenChange,
  productTitle,
  imageUrl,
  stockCode,
  result,
  loading,
  profitLabel,
  currentNetProfit,
}: AdvantageTariffBreakdownProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.breakdown');
  const reasonLabel = useAdvantageReasonLabel();
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
      reasonText={result?.reason != null ? reasonLabel(result.reason) : null}
      loading={loading}
      profitLabel={profitLabel}
      currentNetProfit={currentNetProfit}
    />
  );
}
