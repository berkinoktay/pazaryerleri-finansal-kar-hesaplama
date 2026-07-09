'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { EstimateFlashPriceResult } from '../api/estimate-flash-item-price.api';
import { useFlashReasonLabel } from '../hooks/use-flash-reason-label';

import { CampaignProfitBreakdown } from './campaign-profit-breakdown';

export interface FlashProductBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Product code (stok kodu) shown under the title; optional. */
  stockCode?: string | null;
  /** Backend estimate result — null before the first fetch. */
  result: EstimateFlashPriceResult | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /** Final profit-row label; defaults to "Tahmini kâr". */
  profitLabel?: string;
  /** Current-scenario net profit — the "Güncele göre" delta baseline. */
  currentNetProfit?: string | null;
}

/**
 * Flash-product adapter over the shared {@link CampaignProfitBreakdown}: resolves this
 * vertical's not-calculable reason and forwards the estimate.
 */
export function FlashProductBreakdown({
  open,
  onOpenChange,
  productTitle,
  imageUrl,
  stockCode,
  result,
  loading,
  profitLabel,
  currentNetProfit,
}: FlashProductBreakdownProps): React.ReactElement {
  const t = useTranslations('flashProductsPage.breakdown');
  const reasonLabel = useFlashReasonLabel();
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
