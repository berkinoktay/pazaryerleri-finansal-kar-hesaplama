'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * Developer-only "draft" marker for a settings page whose backend is not
 * wired yet. We ship to production only once everything is finished, so
 * this is purely an internal cue — it renders in development and test, and
 * is compiled away in production (`NODE_ENV === 'production'`). A `ready`
 * feature renders nothing in every environment.
 *
 * Two shapes:
 *   - `dot`   — a small amber dot for the nav, next to the item label.
 *   - `badge` — a labelled "Taslak" chip for a page or section header.
 *
 * Uses the semantic warning tone contract (`bg-warning-surface` + `text-warning`)
 * — never a one-off color. The hint is a native `title` so the marker can sit
 * inside a nav <a> without nesting an interactive Radix tooltip trigger
 * (invalid HTML → hydration mismatch).
 */

export type FeatureStatus = 'ready' | 'draft';

const SHOW_DEV_MARKERS = process.env.NODE_ENV !== 'production';

export interface FeatureStatusMarkerProps {
  status: FeatureStatus;
  variant?: 'dot' | 'badge';
  className?: string;
}

export function FeatureStatusMarker({
  status,
  variant = 'badge',
  className,
}: FeatureStatusMarkerProps): React.ReactElement | null {
  const t = useTranslations('featureStatus');

  if (status !== 'draft' || !SHOW_DEV_MARKERS) return null;

  const hint = t('draftHint');

  if (variant === 'dot') {
    return (
      <span
        title={hint}
        aria-label={t('draftLabel')}
        className={cn('bg-warning size-1.5 shrink-0 rounded-full', className)}
      />
    );
  }

  return (
    <span
      title={hint}
      className={cn(
        'bg-warning-surface text-warning gap-3xs px-xs py-3xs text-2xs inline-flex items-center rounded-full font-medium',
        className,
      )}
    >
      <span className="bg-warning size-1.5 rounded-full" aria-hidden />
      {t('draftLabel')}
    </span>
  );
}
