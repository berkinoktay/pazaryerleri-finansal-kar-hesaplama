import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Empty state — shown in place of a table, chart, or list when there is
 * genuinely no data to display. Opinionated: an empty state always offers
 * a next step (import, sync, connect) rather than just announcing nothing.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
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
    </div>
  );
}
