'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import type { ToneKey } from '@/lib/variants';

import type { ClaimListItem } from '../api/list-claims.api';

type DerivedStatus = ClaimListItem['derivedStatus'];

const STATUS_TONES: Record<DerivedStatus, ToneKey> = {
  OPEN: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'neutral',
  MIXED: 'neutral',
};

export interface ClaimStatusBadgeProps {
  status: DerivedStatus;
  className?: string;
}

/**
 * Renders the derived claim status. OPEN=warning is the "needs attention"
 * signal a seller scans for; ACCEPTED=success / REJECTED=destructive read
 * the resolution outcome at a glance.
 */
export function ClaimStatusBadge({ status, className }: ClaimStatusBadgeProps): React.ReactElement {
  const t = useTranslations('returnsPage.status');
  return (
    <Badge tone={STATUS_TONES[status]} size="sm" className={className}>
      {t(status)}
    </Badge>
  );
}
