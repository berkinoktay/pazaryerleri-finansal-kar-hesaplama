import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PreviewProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Where the demo should sit on a dark surface to assess border contrast. */
  onDark?: boolean;
}

/**
 * Showcase section wrapper — title, optional description, and a framed
 * demo area below. Used to wrap each component demo so the page has a
 * scannable rhythm.
 */
export function Preview({
  title,
  description,
  onDark = false,
  className,
  children,
  ...props
}: PreviewProps): React.ReactElement {
  return (
    <section className={cn('gap-sm flex flex-col', className)} {...props}>
      <div className="gap-3xs flex flex-col">
        <h3 className="text-md text-foreground font-semibold">{title}</h3>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      <div
        className={cn(
          'border-border p-lg rounded-lg border',
          onDark ? 'bg-foreground text-background' : 'bg-background',
        )}
      >
        {children}
      </div>
    </section>
  );
}
