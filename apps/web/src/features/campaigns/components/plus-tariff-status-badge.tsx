'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { type ToneKey } from '@/lib/variants';

import type { PlusTariffValidity } from '../types';

/**
 * Period-validity status pill for a saved Plus tariff. The status is
 * two-dimensional in the data (validity × exported); this badge carries the
 * VALIDITY axis only — the export axis is shown separately so each signal stays
 * legible. A Plus tariff is always a 7-day period (no draft state); a `null`
 * validity (unparseable dates, a parse edge case) degrades to the "past" pill.
 */
type PlusStatusKey = 'active' | 'upcoming' | 'past';

/** Plus validity → semantic tone. Shared with PeriodTabs' validity dot so a split-week
 * Plus tariff's period tabs read the same color vocabulary as this badge. */
export const STATUS_TONE: Record<PlusStatusKey, ToneKey> = {
  active: 'success',
  upcoming: 'info',
  past: 'neutral',
};

export interface PlusTariffStatusBadgeProps {
  validity: PlusTariffValidity;
}

export function PlusTariffStatusBadge({
  validity,
}: PlusTariffStatusBadgeProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.listStatus');
  const key: PlusStatusKey = validity ?? 'past';
  return (
    <Badge tone={STATUS_TONE[key]} variant="surface" size="sm" className="gap-2xs">
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {t(key)}
    </Badge>
  );
}
