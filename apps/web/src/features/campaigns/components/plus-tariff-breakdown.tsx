'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { EstimatePlusPriceResult } from '../api/estimate-plus-item-price.api';
import { usePlusReasonLabel } from '../hooks/use-plus-reason-label';

import { CampaignProfitBreakdown } from './campaign-profit-breakdown';

export interface PlusTariffBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Product code (stok kodu) shown under the title; optional. */
  stockCode?: string | null;
  /** Backend estimate result — null before the first fetch. */
  result: EstimatePlusPriceResult | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /** Final profit-row label; defaults to "Tahmini kâr". */
  profitLabel?: string;
  /** Current-scenario net profit — the "Güncele göre" delta baseline. */
  currentNetProfit?: string | null;
}

/**
 * Plus-tariff adapter over the shared {@link CampaignProfitBreakdown}: resolves this
 * vertical's not-calculable reason and forwards the estimate.
 */
export function PlusTariffBreakdown({
  open,
  onOpenChange,
  productTitle,
  imageUrl,
  stockCode,
  result,
  loading,
  profitLabel,
  currentNetProfit,
}: PlusTariffBreakdownProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.breakdown');
  const reasonLabel = usePlusReasonLabel();
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
