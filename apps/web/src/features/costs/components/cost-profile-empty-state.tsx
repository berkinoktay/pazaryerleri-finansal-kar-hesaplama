'use client';

import { LayerAddIcon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

interface CostProfileEmptyStateProps {
  /**
   * `no-store` when the active org has no store yet — cost profiles are
   * store-scoped, so there is nothing to create against. Defaults to `list`
   * (zero profiles for the active store).
   */
  variant?: 'list' | 'no-store';
  onCreateClick?: () => void;
}

/**
 * Empty-state for the Costs list page.
 * Composed from the `EmptyState` pattern — no new primitives.
 *
 * The `list` variant is rendered INSIDE the DataTable's `empty` slot (the page
 * keeps the table chrome — toolbar + headers + pagination — visible even with
 * zero profiles), so it uses `embedded` to drop the standalone dashed-card
 * frame. The `no-store` variant replaces the whole page body when the org has
 * no store: cost profiles can't be created without one, so the CTA links to the
 * stores page instead of opening the create dialog.
 */
export function CostProfileEmptyState({
  variant = 'list',
  onCreateClick,
}: CostProfileEmptyStateProps): React.ReactElement {
  const t = useTranslations('costs');

  if (variant === 'no-store') {
    return (
      <EmptyState
        embedded
        icon={StoreLocation01Icon}
        title={t('noStore.title')}
        description={t('noStore.description')}
        action={
          <Button asChild>
            <Link href="/settings/stores">{t('noStore.cta')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      embedded
      icon={LayerAddIcon}
      title={t('empty.title')}
      description={t('empty.description')}
      action={
        onCreateClick !== undefined ? (
          <Button onClick={onCreateClick} size="sm">
            {t('empty.action')}
          </Button>
        ) : undefined
      }
    />
  );
}
