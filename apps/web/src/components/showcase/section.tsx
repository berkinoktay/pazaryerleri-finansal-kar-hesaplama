import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ShowcaseSectionProps {
  /** Section heading (h2) — names a cluster of related demos. */
  title: string;
  /** One-line intro under the heading. Keep it to a single sentence. */
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Groups a cluster of `<Preview>` demos under an h2 section header so a
 * long showcase page reads as scannable clusters instead of a flat list
 * of equal-weight blocks. Sits in the heading hierarchy between the page
 * `<PageHeader>` (h1, text-3xl) and each `<Preview>` (h3, text-md): the
 * h2 lands at text-xl in between. A hairline top rule starts each cluster
 * without a heavy panel — the same restraint as the rest of the system.
 *
 * @useWhen a showcase page has enough demos that a flat Preview list stops being scannable
 */
export function ShowcaseSection({
  title,
  description,
  children,
  className,
}: ShowcaseSectionProps): React.ReactElement {
  return (
    <section className={cn('gap-lg flex flex-col', className)}>
      <div className="gap-2xs border-border pt-lg flex flex-col border-t">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-muted-foreground max-w-prose-max text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
