'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { EstimateDiscountItemResult } from '../api/estimate-discount-item.api';
import { useDiscountReasonLabel } from '../hooks/use-discount-reason-label';

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
}

/**
 * İndirimler adapter over the shared {@link CampaignProfitBreakdown}: resolves this vertical's
 * not-calculable reason (which INCLUDES `NO_COMMISSION`, unlike Flash) and forwards the estimate
 * for the chosen scenario. Wired exactly like the Flash breakdown — the client owns the estimate
 * mutation + which item/scenario is open, this only renders the result.
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
}: DiscountBreakdownProps): React.ReactElement {
  const t = useTranslations('discountsPage.breakdown');
  const reasonLabel = useDiscountReasonLabel();
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
      currentNetProfit={currentNetProfit}
    />
  );
}
