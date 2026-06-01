'use client';

import { Alert02Icon, FilterRemoveIcon, InboxIcon, RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

/**
 * The three NON-LOADING zero-states a DataTable can resolve to, each an
 * EmptyState preset reading copy from `common.dataTable.*`. DataTable picks the
 * right one via its precedence ladder (loading > error > no-results > first-run
 * > rows); feature pages can also render them directly.
 *
 * Why three distinct presets instead of one generic "empty":
 *  - first-run (TableEmptyState)  — data has never arrived; CTA = connect / sync
 *    / import (domain-specific, so the feature passes `action`).
 *  - no-results (TableNoResultsState) — data exists but the active search /
 *    filters exclude everything; CTA = clear filters.
 *  - error (TableErrorState) — the fetch failed; CTA = retry. Generic,
 *    non-leaky copy per the tenant-isolation rule (never reveal whether a
 *    resource exists in another org).
 *
 * Folding these into one node (the previous behaviour) forced a single hedging
 * line — "clear the filters OR refresh the sync" — that committed to neither
 * and offered no real button.
 */

export interface TableEmptyStateProps {
  /** Domain-specific first-run CTA (connect store / sync now / import). */
  action?: React.ReactNode;
  className?: string;
}

/** First-run / genuinely-empty: no data has ever arrived for this table. */
export function TableEmptyState({ action, className }: TableEmptyStateProps): React.ReactElement {
  const t = useTranslations('common.dataTable.empty');
  return (
    <EmptyState
      embedded
      icon={InboxIcon}
      title={t('title')}
      description={t('description')}
      action={action}
      className={className}
    />
  );
}

export interface TableNoResultsStateProps {
  /** Resets the active search + filters. When omitted, no clear button shows. */
  onClearFilters?: () => void;
  className?: string;
}

/** Filtered-to-zero: data exists but the active search / filters match nothing. */
export function TableNoResultsState({
  onClearFilters,
  className,
}: TableNoResultsStateProps): React.ReactElement {
  const t = useTranslations('common.dataTable.noResults');
  return (
    <EmptyState
      embedded
      icon={FilterRemoveIcon}
      title={t('title')}
      description={t('description')}
      action={
        onClearFilters !== undefined ? (
          <Button variant="outline" onClick={onClearFilters}>
            {t('clearFilters')}
          </Button>
        ) : undefined
      }
      className={className}
    />
  );
}

export interface TableErrorStateProps {
  /** Re-runs the failed query. When omitted, no retry button shows. */
  onRetry?: () => void;
  className?: string;
}

/** Fetch failed: the query errored. Distinct destructive-tone icon chip. */
export function TableErrorState({ onRetry, className }: TableErrorStateProps): React.ReactElement {
  const t = useTranslations('common.dataTable.error');
  return (
    <EmptyState
      embedded
      icon={Alert02Icon}
      iconTone="destructive"
      title={t('title')}
      description={t('description')}
      action={
        onRetry !== undefined ? (
          <Button variant="outline" onClick={onRetry}>
            <RefreshIcon className="size-icon-sm" />
            {t('retry')}
          </Button>
        ) : undefined
      }
      className={className}
    />
  );
}
