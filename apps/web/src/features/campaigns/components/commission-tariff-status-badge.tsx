'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { type ToneKey } from '@/lib/variants';

import type { TariffValidity } from '../types';

/**
 * Period-validity status pill for a saved tariff. The status is two-dimensional
 * in the data (validity × exported); this badge carries the VALIDITY axis only —
 * the export axis is shown separately so each signal stays legible. A `null`
 * validity (no parseable dates) reads as "Taslak" (draft).
 */
type TariffStatusKey = TariffValidity | 'draft';

const STATUS_TONE: Record<TariffStatusKey, ToneKey> = {
  active: 'success',
  upcoming: 'info',
  past: 'neutral',
  draft: 'warning',
};

export interface CommissionTariffStatusBadgeProps {
  validity: TariffValidity | null;
}

export function CommissionTariffStatusBadge({
  validity,
}: CommissionTariffStatusBadgeProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.listStatus');
  const key: TariffStatusKey = validity ?? 'draft';
  return (
    <Badge tone={STATUS_TONE[key]} variant="surface" size="sm" className="gap-2xs">
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {t(key)}
    </Badge>
  );
}
