import * as React from 'react';

import { StatStripSkeleton } from '@/components/patterns/stat-strip';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/* Deterministic width cycle so the placeholder rows read as content of
   differing lengths, not a barcode wall (mirrors DataTable's skeleton). */
const ROW_WIDTHS = ['w-4/5', 'w-3/5', 'w-2/3'] as const;
const PANEL_ROW_COUNT = 8;

export interface PageSkeletonProps {
  /** Accessible name for the region (pass `t('common.loading')`). */
  label: string;
  /** Mirror a `PageHeader` `leading` row (back link / breadcrumb) above the title. */
  withBackLink?: boolean;
  /** Cells of a `StatStrip` summary band under the header; `0` renders none. */
  statCells?: number;
  className?: string;
}

/**
 * Whole-page loading placeholder mirroring the standard dashboard page
 * anatomy: `PageHeader` (optional leading row, title, intent, bottom rule) →
 * optional `StatStrip` band → a bordered data panel with a toolbar line and
 * content rows. One source of truth for the shape that was previously
 * copy-pasted as ad-hoc gray-bar stacks per feature.
 *
 * Two intended callers: route-level `loading.tsx` files (instant feedback the
 * moment navigation starts, while the page's server fetches run) and feature
 * clients whose whole screen hangs off one query. A feature that can keep its
 * REAL chrome mounted (DataTable `loading`, `StatStrip loading`) should do
 * that instead — real chrome beats a mirror of it.
 *
 * @useWhen showing a full-page loading placeholder for the standard dashboard page shape (route loading.tsx or a screen-level query gate); prefer component-level loading states when the page chrome can stay mounted
 */
export function PageSkeleton({
  label,
  withBackLink = false,
  statCells = 0,
  className,
}: PageSkeletonProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-busy
      aria-label={label}
      className={cn('gap-lg flex flex-col', className)}
    >
      <div className="border-border gap-sm pb-lg flex flex-col border-b">
        {withBackLink ? <Skeleton className="h-4 w-40 max-w-full" /> : null}
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {statCells > 0 ? <StatStripSkeleton cells={statCells} /> : null}
      <div className="border-border bg-card animate-panel-enter-delayed overflow-hidden rounded-lg border shadow-xs">
        <div className="border-border px-md py-sm border-b">
          <Skeleton className="h-8 w-56 max-w-full" />
        </div>
        {Array.from({ length: PANEL_ROW_COUNT }).map((_, idx) => (
          <div key={idx} className="border-border px-md py-sm border-b last:border-b-0">
            <Skeleton className={cn('h-4', ROW_WIDTHS[idx % ROW_WIDTHS.length])} />
          </div>
        ))}
      </div>
    </div>
  );
}
