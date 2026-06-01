import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * Tone of the circular icon chip. `muted` (default) for data-absent
   * states (first-run, no-results); `destructive` for an error/failure
   * state so a fetch failure reads distinctly from "nothing here yet".
   * Uses the semantic-tone contract (`bg-<tone>-surface` + `text-<tone>`),
   * never `text-<tone>-foreground` on a surface.
   */
  iconTone?: 'muted' | 'destructive';
  /**
   * `embedded` drops the standalone card chrome (dashed border, surface
   * background, rounding) and spans the full width of its container — for use
   * INSIDE a surface that already has its own frame, e.g. a DataTable body cell.
   * Without it the centered card shrinks to its content width and reads as a
   * floating inner card against the table body. Default `false` keeps the
   * standalone dashed-card look for page-level / hero empties.
   */
  embedded?: boolean;
  /**
   * Optional slot rendered beneath the action. Useful for secondary
   * context (supported integrations, "learn more" links, freshness
   * timestamps). Kept separate from `action` so the primary CTA stays
   * visually distinct.
   */
  footer?: React.ReactNode;
}

const ICON_CHIP_TONE: Record<NonNullable<EmptyStateProps['iconTone']>, string> = {
  muted: 'bg-muted text-muted-foreground',
  destructive: 'bg-destructive-surface text-destructive',
};

/**
 * Empty state — shown in place of a table, chart, or list when there is
 * genuinely no data to display. Opinionated: an empty state always offers
 * a next step (import, sync, connect) rather than just announcing nothing.
 * Use inside DataTable's `empty` slot, on first-load list pages before
 * any data exists, and as the fallback when filters yield zero results
 * (in which case the action should be "Clear filters", not "Import data").
 *
 * @useWhen filling a region that has genuinely no data with an icon, title, description, and a next-step action (always offer an action; empty without a next step is a dead end)
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  iconTone = 'muted',
  embedded = false,
  footer,
  className,
  ...props
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        'gap-sm p-2xl flex flex-col items-center justify-center text-center',
        // Standalone → dashed card; embedded → chromeless, full-width so it
        // never shrinks into a floating inner card inside a framed surface.
        embedded ? 'w-full' : 'border-border bg-background rounded-lg border border-dashed',
        className,
      )}
      {...props}
    >
      {Icon ? (
        <div
          className={cn(
            'size-2xl flex items-center justify-center rounded-full',
            ICON_CHIP_TONE[iconTone],
          )}
        >
          <Icon className="size-icon-xl" />
        </div>
      ) : null}
      <div className="gap-3xs flex flex-col">
        <h3 className="text-md text-foreground font-semibold">{title}</h3>
        {description ? (
          <p className="max-w-prose-max text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-xs">{action}</div> : null}
      {footer ? <div className="pt-md w-full">{footer}</div> : null}
    </div>
  );
}
