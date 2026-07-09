'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { EstimateItemPriceResult } from '../api/estimate-item-price.api';
import { useReasonLabel } from '../hooks/use-reason-label';

import { CampaignProfitBreakdown } from './campaign-profit-breakdown';

export interface CommissionTariffBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Product code (stok kodu) shown under the title; optional. */
  stockCode?: string | null;
  /** Backend estimate result — null before the first fetch. */
  result: EstimateItemPriceResult | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /** Final profit-row label; defaults to "Tahmini kâr". */
  profitLabel?: string;
  /** Current-scenario net profit — the "Güncele göre" delta baseline. */
  currentNetProfit?: string | null;
}

/**
 * Commission-tariff adapter over the shared {@link CampaignProfitBreakdown}: resolves
 * this vertical's not-calculable reason and forwards the estimate. All layout, the
 * what-if header and the allocation live in the shared dialog.
 */
export function CommissionTariffBreakdown({
  open,
  onOpenChange,
  productTitle,
  imageUrl,
  stockCode,
  result,
  loading,
  profitLabel,
  currentNetProfit,
}: CommissionTariffBreakdownProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.breakdown');
  const reasonLabel = useReasonLabel();
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
