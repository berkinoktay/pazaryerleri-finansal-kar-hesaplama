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
 */
export function CostProfileEmptyState({
  onCreateClick,
}: CostProfileEmptyStateProps): React.ReactElement {
  const t = useTranslations('costs');

  return (
    <EmptyState
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
