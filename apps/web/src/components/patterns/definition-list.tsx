import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Semantic key/value pair list — renders as `<dl>` / `<dt>` / `<dd>`
 * so screen readers announce term-description grouping correctly.
 *
 * PazarSync use cases — order detail rows, commission breakdowns,
 * settlement summaries, store-credential metadata. Reach for it
 * whenever a region of the UI is a flat sequence of "label → value"
 * facts; for multi-row data prefer DataTable.
 *
 * Layouts:
 * - `inline` (default) — term column left, description column right.
 *   2-col CSS grid with the term column sized by content. Right-
 *   aligns the description's text when the term reads as a label
 *   ("Komisyon" → "23,64%"). Wraps gracefully on narrow viewports.
 * - `stacked` — term on top, description below. Use for longer
 *   descriptions or sidebar / context-rail layouts where horizontal
 *   space is tight.
 *
 * Density:
 * - default — page-rhythm padding (`py-xs`)
 * - `dense` — sidebar / popover-rhythm padding (`py-3xs`)
 *
 * Optional `dividers` adds a 1px border between items — useful when
 * the list lives directly on a card surface without surrounding
 * grouping.
 *
 * @useWhen rendering a flat list of label→value facts (use DataTable for multi-row tabular data; use Card with arbitrary children for non-list grouped content)
 */

export interface DefinitionListItem {
  /** Stable React key — prefer the term string when unique. */
  id?: string;
  /** Bold first column / top line. Typically a translated label. */
  term: React.ReactNode;
  /** Value rendered in the second column / bottom line. */
  description: React.ReactNode;
  /** Optional secondary text under the term (small + muted). */
  hint?: React.ReactNode;
}

export interface DefinitionListProps {
  items: DefinitionListItem[];
  /** Default `'inline'`. */
  layout?: 'inline' | 'stacked';
  /** Adds a 1px border between rows. Defaults to `false`. */
  dividers?: boolean;
  /** Tighter padding for sidebar / popover contexts. */
  dense?: boolean;
  /** Right-align the description text in `inline` mode (numeric data). */
  alignRight?: boolean;
  className?: string;
}

export function DefinitionList({
  items,
  layout = 'inline',
  dividers = false,
  dense = false,
  alignRight = false,
  className,
}: DefinitionListProps): React.ReactElement {
  const padding = dense ? 'py-3xs' : 'py-xs';
  const dividerClass = dividers ? 'border-border border-b last:border-0' : undefined;

  if (layout === 'stacked') {
    return (
      <dl className={cn('gap-xs flex flex-col', className)}>
        {items.map((item, index) => (
          <div
            key={item.id ?? index}
            className={cn('gap-3xs flex flex-col', padding, dividerClass)}
          >
            <dt className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
              {item.term}
              {item.hint !== undefined ? (
                <span className="text-muted-foreground/70 ml-xs tracking-normal normal-case">
                  {item.hint}
                </span>
              ) : null}
            </dt>
            <dd className="text-foreground text-sm">{item.description}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl
      className={cn('grid grid-cols-[max-content_1fr]', dense ? 'gap-x-md' : 'gap-x-lg', className)}
    >
      {items.map((item, index) => (
        <React.Fragment key={item.id ?? index}>
          <dt className={cn('text-muted-foreground text-sm', padding, dividerClass)}>
            {item.term}
            {item.hint !== undefined ? (
              <span className="text-muted-foreground/70 ml-xs text-2xs">{item.hint}</span>
            ) : null}
          </dt>
          <dd
            className={cn(
              'text-foreground text-sm',
              padding,
              alignRight && 'text-right tabular-nums',
              dividerClass,
            )}
          >
            {item.description}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
