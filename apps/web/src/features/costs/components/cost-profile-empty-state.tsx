'use client';

import { LayerAddIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

interface CostProfileEmptyStateProps {
  onCreateClick: () => void;
}

/**
 * Empty-state for the Costs list page when no profiles exist.
 * Composed from the `EmptyState` pattern — no new primitives.
 *
 * Always rendered INSIDE the DataTable's `empty` slot (the page keeps the
 * table chrome — toolbar + headers + pagination — visible even with zero
 * profiles), so it uses `embedded` to drop the standalone dashed-card frame
 * and span the table body. The "create first profile" CTA is preserved.
 */
export function CostProfileEmptyState({
  onCreateClick,
}: CostProfileEmptyStateProps): React.ReactElement {
  const t = useTranslations('costs');

  return (
    <EmptyState
      embedded
      icon={LayerAddIcon}
      title={t('empty.title')}
      description={t('empty.description')}
      action={
        <Button onClick={onCreateClick} size="sm">
          {t('empty.action')}
        </Button>
      }
    />
  );
}
