'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MappedBadge } from '@/components/patterns/mapped-badge';
import { type BadgeProps } from '@/components/ui/badge';

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
  // `inactive` is a computed catch-all not used as a filter, so reuse the
  // closest filter label. Building the label map fresh per render keeps
  // the labels in sync with the active locale without a dedicated hook.
  const labelMap: Record<VariantSummary['status'], React.ReactNode> = {
    onSale: t('onSale'),
    archived: t('archived'),
    locked: t('locked'),
    blacklisted: t('blacklisted'),
    inactive: t('archived'),
  };

  return (
    <MappedBadge
      value={status}
      toneMap={TONE_FOR_STATUS}
      labelMap={labelMap}
      overflowCount={overflowCount}
      className={className}
    />
  );
}
