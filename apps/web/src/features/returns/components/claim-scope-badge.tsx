'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import type { ToneKey } from '@/lib/variants';

import type { ClaimListItem } from '../api/list-claims.api';

type Scope = ClaimListItem['scope'];

const SCOPE_TONES: Record<Scope, ToneKey> = {
  FULL: 'neutral',
  PARTIAL: 'info',
};

export interface ClaimScopeBadgeProps {
  scope: Scope;
  className?: string;
}

/**
 * FULL = the claim covers every ordered unit; PARTIAL (info tone) flags the
 * split case where item-level attribution matters (#299).
 */
export function ClaimScopeBadge({ scope, className }: ClaimScopeBadgeProps): React.ReactElement {
  const t = useTranslations('returnsPage.scope');
  return (
    <Badge tone={SCOPE_TONES[scope]} size="sm" className={className}>
      {t(scope)}
    </Badge>
  );
}
