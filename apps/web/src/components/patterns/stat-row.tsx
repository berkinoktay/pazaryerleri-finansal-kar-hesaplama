import { ArrowRight01Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { type ToneKey, toneTextClass } from '@/lib/variants';

/**
 * Nested action row for a KPI / status Card — a soft `surface-subtle` strip
 * carrying a leading icon, a two-line label (title + tone-colored status
 * meta), and a trailing affordance. The premium-dashboard motif that makes a
 * flat Card feel rich without elevation: the card stays a hairline surface,
 * the richness is this nested row. Shadowless by design (nested surfaces sit,
 * they do not float) — keeps the Card-family shadow language consistent.
 *
 * Presentational by design — it renders a static row. For a navigable row,
 * wrap it in a `Link` / `button`: the `interactive` styling + trailing chevron
 * then read as clickable, and the wrapper owns focus and the click target.
 * Lives on a Card body, never standalone.
 *
 * @useWhen adding a nested icon + label + status row inside a KPI / summary Card (wrap in a Link for navigation; use DefinitionList for plain key/value pairs)
 */

export interface StatRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Leading visual — typically a `SoftSquareIcon`. */
  icon?: React.ReactNode;
  /** Primary line. */
  title: React.ReactNode;
  /** Secondary line below the title (e.g. a status word). */
  meta?: React.ReactNode;
  /** Tone-color the `meta` line for status semantics. Default muted. */
  metaTone?: ToneKey;
  /** Trailing slot. Defaults to a chevron when `interactive`. */
  trailing?: React.ReactNode;
  /** Hover affordance + default chevron + pointer (pair with a Link/button wrapper for real navigation). */
  interactive?: boolean;
}

export function StatRow({
  icon,
  title,
  meta,
  metaTone = 'neutral',
  trailing,
  interactive = false,
  className,
  ...props
}: StatRowProps): React.ReactElement {
  const resolvedTrailing =
    trailing ??
    (interactive ? (
      <ArrowRight01Icon className="size-icon-sm text-muted-foreground-dim shrink-0" />
    ) : null);

  return (
    <div
      className={cn(
        'gap-sm bg-surface-subtle px-sm py-xs flex items-center rounded-md',
        interactive && 'hover:bg-surface-row-hover duration-fast cursor-pointer transition-colors',
        className,
      )}
      {...props}
    >
      {icon !== undefined ? <span className="shrink-0">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground truncate text-sm font-medium">{title}</span>
        {meta !== undefined ? (
          <span className={cn('text-xs font-medium', toneTextClass[metaTone])}>{meta}</span>
        ) : null}
      </span>
      {resolvedTrailing}
    </div>
  );
}
