import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * Optional slot rendered beneath the action. Useful for secondary
   * context (supported integrations, "learn more" links, freshness
   * timestamps). Kept separate from `action` so the primary CTA stays
   * visually distinct.
   */
  footer?: React.ReactNode;
}

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
  footer,
  className,
  ...props
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        'gap-sm border-border bg-background p-2xl flex flex-col items-center justify-center rounded-lg border border-dashed text-center',
        className,
      )}
      {...props}
    >
      {Icon ? (
        <div className="size-icon-xl bg-muted text-muted-foreground flex items-center justify-center rounded-full">
          <Icon className="size-icon" />
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
