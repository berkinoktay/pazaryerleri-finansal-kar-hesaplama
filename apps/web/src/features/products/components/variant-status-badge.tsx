'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type { VariantSummary } from '../api/list-products.api';

interface VariantStatusBadgeProps {
  status: VariantSummary['status'];
  /** When the parent has multiple variants of mixed status, append an overflow chip like "+2". */
  overflowCount?: number;
  className?: string;
}

const TONE_FOR_STATUS: Record<VariantSummary['status'], NonNullable<BadgeProps['tone']>> = {
  onSale: 'success',
  archived: 'neutral',
  locked: 'warning',
  blacklisted: 'destructive',
  inactive: 'outline',
};

export function VariantStatusBadge({
  status,
  overflowCount,
  className,
}: VariantStatusBadgeProps): React.ReactElement {
  const t = useTranslations('products.filters.statusOptions');
  // Map our VariantSummary status to a translated label. `inactive` is a
  // computed catch-all not used as a filter, so reuse the closest filter label.
  const label = status === 'inactive' ? t('archived') : t(status);

  return (
    <span className={cn('gap-2xs inline-flex items-center', className)}>
      <Badge tone={TONE_FOR_STATUS[status]}>{label}</Badge>
      {overflowCount !== undefined && overflowCount > 0 ? (
        <span className="text-muted-foreground text-2xs">+{overflowCount}</span>
      ) : null}
    </span>
  );
}
