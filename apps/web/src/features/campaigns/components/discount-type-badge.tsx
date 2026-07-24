'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { DiscountType } from '@pazarsync/db/enums';

import { MappedBadge } from '@/components/patterns/mapped-badge';
import { type ToneKey } from '@/lib/variants';

/**
 * The discount kurgu (type) chip for a saved İndirimler upload. All six types read as a quiet
 * neutral chip — the discount VALUE (percent / amount / min basket …) is carried by the
 * one-line config summary next to it, so the type badge stays a calm category marker rather
 * than competing for the row's one accent.
 */
const TYPE_TONE: Record<DiscountType, ToneKey> = {
  NET: 'neutral',
  CONDITIONAL_BASKET: 'neutral',
  CONDITIONAL_QUANTITY: 'neutral',
  BUY_X_PAY_Y: 'neutral',
  NTH_PRODUCT: 'neutral',
  CODE: 'neutral',
};

export interface DiscountTypeBadgeProps {
  type: DiscountType;
}

export function DiscountTypeBadge({ type }: DiscountTypeBadgeProps): React.ReactElement {
  const t = useTranslations('discountsPage.types');
  const labelMap: Record<DiscountType, string> = {
    NET: t('NET'),
    CONDITIONAL_BASKET: t('CONDITIONAL_BASKET'),
    CONDITIONAL_QUANTITY: t('CONDITIONAL_QUANTITY'),
    BUY_X_PAY_Y: t('BUY_X_PAY_Y'),
    NTH_PRODUCT: t('NTH_PRODUCT'),
    CODE: t('CODE'),
  };
  return <MappedBadge value={type} toneMap={TYPE_TONE} labelMap={labelMap} size="sm" />;
}
